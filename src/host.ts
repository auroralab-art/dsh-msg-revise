/**
 * Host half: turn-atomic fork of an edited user message.
 * Version metadata is stored outside the session log.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { MAX_REQUEST_BODY_BYTES, REVISE_PATH, type EditResult } from './shared.ts'
import { BodyTooLargeError, decodeEdit, isTrustedRequest } from './http.ts'
import { rememberVersion } from './store.ts'
import { hasFirstToken } from './ttft.ts'
import { planEdit, planUnsend, type FoldEvent } from './turns.ts'

class FirstTokenReachedError extends Error {
  constructor() {
    super('首字已到达')
    this.name = 'FirstTokenReachedError'
  }
}

interface HttpRequestLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: unknown) => void): this
  destroy?(): void
}

interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): void
}

interface HttpServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: HttpRequestLike, response: HttpResponseLike) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: HttpServerLike
  }
}

export const name = 'msg-revise'
export const inject = ['sessions', 'agents', 'sessionQuery', 'workspaceRegistry', 'webServer']

type OperationInverse = () => void | Promise<void>

function headerValue(request: HttpRequestLike, name: string): string | undefined {
  const headers = request.headers
  if (headers === undefined) return undefined
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function asFoldEvents(events: readonly SessionEvent[]): FoldEvent[] {
  return events.map(event => ({
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data as FoldEvent['data'],
  }))
}

function cloneQueuedUser(content: Array<{ type: string; text?: string }>): UserMessage {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: Object.freeze(content),
    source: Object.freeze({ kind: 'user' as const }),
  }) as UserMessage
}

function agentOptions(events: readonly SessionEvent[], fallback?: AgentOptions): AgentOptions {
  const config = events.findLast(event => event.type === 'request/header')?.data.header.config
  const provider = config?.provider ?? fallback?.provider
  const model = config?.model ?? fallback?.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new Error('无法从会话历史解析模型路由。')
  }
  const maxTokens = config?.maxTokens ?? fallback?.maxTokens
  return { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }) }
}

async function settleSource(agent: Agent): Promise<void> {
  agent.cancel({ kind: 'user' }, { keepInbox: false })
  await agent.whenIdle()
}

async function withSourceAgent<T>(
  ctx: Context,
  sessionId: SessionId,
  operation: (agent: Agent) => Promise<T>,
): Promise<T> {
  let handle: AgentHandle | undefined
  let agent = ctx.agents.get(sessionId)
  if (agent === undefined) {
    const snapshot = await ctx.sessionQuery.readSession(sessionId)
    handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: agentOptions(snapshot.events),
    })
    agent = handle.agent
  }
  try {
    await settleSource(agent)
    return await agent.runMaintenance(async () => operation(agent))
  } finally {
    await handle?.dispose()
  }
}

function inheritedSeed(source: Session, boundary: number): SessionEvent[] {
  if (boundary === -1) return []
  const boundaryEvent = source.events[boundary]
  if (boundary < 0 || boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
    throw new Error('分支边界不是连续会话事件。')
  }
  return source.events.slice(0, boundary + 1)
}

function sessionPreset(session: Session): string | undefined {
  const header = session.header as unknown as { agentPreset?: string }
  if (header.agentPreset !== undefined) return header.agentPreset
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index] as unknown as { type?: string; data?: { agentPreset?: string } } | undefined
    if (event?.type === 'agent-preset/selected' && event.data?.agentPreset !== undefined) {
      return event.data.agentPreset
    }
  }
  return undefined
}

interface AgentPresetService {
  resolve(presetId: string): Promise<{ id: string }>
  mount(agentCtx: Context, presetId: string): Promise<void>
}

async function createVersionAgent(
  ctx: Context,
  source: Session,
  childId: SessionId,
  seed: SessionEvent[],
  options: AgentOptions,
): Promise<AgentHandle> {
  const presets = ctx.get('agentPresets') as AgentPresetService | undefined
  const presetId = sessionPreset(source)
  let agentPreset: string | undefined
  let setup: AgentSetup | undefined
  if (presets !== undefined && presetId !== undefined) {
    const resolved = (await presets.resolve(presetId)).id
    agentPreset = resolved
    setup = async (agentCtx) => { await presets.mount(agentCtx, resolved) }
  }
  const child = await ctx.agents.create({
    sessionId: childId,
    seed,
    meta: {
      ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
      parentSession: source.id,
      seedLength: seed.length,
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
    agentOptions: options,
    ...(setup === undefined ? {} : { setup }),
  })
  try {
    await ctx.sessions.flush(child.agent.session)
    return child
  } catch (error: unknown) {
    await child.dispose()
    throw error
  }
}

function sourceWorkspace(ctx: Context, sessionId: SessionId): Workspace | undefined {
  return ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))
}

async function recoverOperation(inverses: OperationInverse[]): Promise<void> {
  const failures: unknown[] = []
  for (const inverse of inverses.reverse()) {
    try {
      await inverse()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, '修改操作恢复失败。')
}

interface SessionTitleService {
  rename(session: Session, title: string): unknown
}

async function inheritTitle(ctx: Context, sourceId: SessionId, childSession: Session): Promise<void> {
  const sessionTitle = ctx.get('sessionTitle') as unknown as SessionTitleService | undefined
  if (sessionTitle === undefined) return
  const snapshot = await ctx.sessionQuery.readTitle(sourceId) as unknown as { title?: string | null } | undefined
  if (snapshot?.title != null && snapshot.title.trim().length > 0) {
    sessionTitle.rename(childSession, snapshot.title)
  }
}

async function finalizeEdit(ctx: Context, sourceId: SessionId, childId: SessionId): Promise<void> {
  try {
    const childSession = ctx.agents.get(childId)?.session
    if (childSession !== undefined) await inheritTitle(ctx, sourceId, childSession)
  } catch (error: unknown) {
    ctx.logger.warn('msg-revise: inherit title failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  try {
    await ctx.workspaceRegistry.archiveSession(sourceId)
  } catch (error: unknown) {
    ctx.logger.warn('msg-revise: archive source failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}

async function runEdit(ctx: Context, sessionId: string, eventSeq: number, blockIndex: number, text: string): Promise<EditResult> {
  const sourceId = sessionId as SessionId
  return withSourceAgent(ctx, sourceId, async (source) => {
    const childId = ('session-' + crypto.randomUUID()) as SessionId
    const inverses: OperationInverse[] = []
    try {
      const events = source.session.events
      const plan = planEdit({
        action: 'edit',
        sessionId,
        eventSeq,
        blockIndex,
        text,
      }, asFoldEvents(events))
      const options = agentOptions(events, source.options)
      const seed = inheritedSeed(source.session, plan.boundary)
      const child = await createVersionAgent(ctx, source.session, childId, seed, options)
      inverses.push(() => child.dispose())
      const workspace = sourceWorkspace(ctx, sourceId)
      if (workspace !== undefined) {
        await workspace.attachSession(childId)
        inverses.push(() => workspace.detachSession(childId))
      }
      for (const queued of plan.queuedUsers) {
        child.agent.followup(cloneQueuedUser(queued.content))
      }
      rememberVersion(childId, plan.version)
      inverses.length = 0
      return { sessionId: childId, queuedTurns: plan.queuedUsers.length }
    } catch (error: unknown) {
      try {
        await recoverOperation(inverses)
      } catch (recoveryError: unknown) {
        throw new AggregateError([error, recoveryError], '修改操作及其恢复均失败。')
      }
      throw error
    }
  })
}

async function runUnsend(ctx: Context, sessionId: string): Promise<EditResult> {
  const sourceId = sessionId as SessionId
  return withSourceAgent(ctx, sourceId, async (source) => {
    const events = source.session.events
    const folded = asFoldEvents(events)
    if (hasFirstToken(folded)) throw new FirstTokenReachedError()
    const childId = ('session-' + crypto.randomUUID()) as SessionId
    const inverses: OperationInverse[] = []
    try {
      const plan = planUnsend(sessionId, folded)
      const options = agentOptions(events, source.options)
      const seed = inheritedSeed(source.session, plan.boundary)
      const child = await createVersionAgent(ctx, source.session, childId, seed, options)
      inverses.push(() => child.dispose())
      const workspace = sourceWorkspace(ctx, sourceId)
      if (workspace !== undefined) {
        await workspace.attachSession(childId)
        inverses.push(() => workspace.detachSession(childId))
      }
      rememberVersion(childId, plan.version)
      inverses.length = 0
      return { sessionId: childId, queuedTurns: 0, restoredText: plan.restoredText }
    } catch (error: unknown) {
      try {
        await recoverOperation(inverses)
      } catch (recoveryError: unknown) {
        throw new AggregateError([error, recoveryError], '收回提问及其恢复均失败。')
      }
      throw error
    }
  })
}

function readJsonBody(request: HttpRequestLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(headerValue(request, 'content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      reject(new BodyTooLargeError())
      return
    }
    const chunks: Uint8Array[] = []
    let total = 0
    request.on('data', (chunk) => {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
      total += bytes.length
      if (total > MAX_REQUEST_BODY_BYTES) {
        reject(new BodyTooLargeError())
        request.destroy?.()
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => {
      try {
        const decoder = new TextDecoder()
        let text = ''
        for (const chunk of chunks) text += decoder.decode(chunk, { stream: true })
        text += decoder.decode()
        resolve(text.length === 0 ? {} : JSON.parse(text) as unknown)
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function respondJson(response: HttpResponseLike, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function handleRoute(ctx: Context, request: HttpRequestLike, response: HttpResponseLike): Promise<void> {
  try {
    if (!isTrustedRequest(headerValue(request, 'origin'), headerValue(request, 'host'))) {
      respondJson(response, 403, { error: '拒绝跨源请求。' })
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end()
      return
    }
    const contentType = headerValue(request, 'content-type') ?? ''
    if (request.headers !== undefined && !contentType.toLowerCase().includes('application/json')) {
      respondJson(response, 415, { error: 'content-type 必须是 application/json。' })
      return
    }
    const operation = decodeEdit(await readJsonBody(request))
    const result = operation.action === 'unsend'
      ? await runUnsend(ctx, operation.sessionId)
      : await runEdit(ctx, operation.sessionId, operation.eventSeq, operation.blockIndex, operation.text)
    void finalizeEdit(ctx, operation.sessionId as SessionId, result.sessionId as SessionId)
    respondJson(response, 200, result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const status = error instanceof TypeError || error instanceof BodyTooLargeError ? 400 : 409
    respondJson(response, status, { error: message })
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REVISE_PATH,
    handler: (request, response) => handleRoute(ctx, request, response),
  }), 'msg-revise: HTTP route')
}
