import type {
  ClientContext, ISessions, ObservableSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { REVISE_PATH, type EditResult, type EditableUserMessage } from '../shared.ts'

export interface ReviseState {
  pending: boolean
  error: string | null
}

export interface ReviseFace {
  hooks: { revise: ObservableSnapshot<ReviseState> }
  edit(message: EditableUserMessage, text: string): Promise<boolean>
  stop(): Promise<boolean>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function postEdit(operation: {
  action: 'edit'
  sessionId: string
  eventSeq: number
  blockIndex: number
  text: string
}): Promise<EditResult> {
  const response = await fetch(REVISE_PATH, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(operation),
  })
  const value = await response.json() as { sessionId?: string; queuedTurns?: number; error?: string }
  if (!response.ok) {
    throw new Error(typeof value.error === 'string' ? value.error : `请求失败：HTTP ${response.status}`)
  }
  if (typeof value.sessionId !== 'string' || typeof value.queuedTurns !== 'number') {
    throw new Error('操作响应无效')
  }
  return { sessionId: value.sessionId, queuedTurns: value.queuedTurns }
}

export class ReviseController {
  readonly face: ReviseFace
  private readonly store = createSnapshotStore<ReviseState>({ pending: false, error: null })
  private readonly sessions: ISessions
  private readonly navigationWaits = new Set<() => void>()

  constructor(
    ctx: ClientContext,
    private readonly sessionId: SessionId,
  ) {
    this.sessions = ctx.sessions as unknown as ISessions
    this.face = {
      hooks: { revise: this.store },
      edit: (message, text) => this.edit(message, text),
      stop: () => this.stop(),
    }
  }

  dispose(): void {
    for (const cancel of [...this.navigationWaits]) cancel()
  }

  private async edit(message: EditableUserMessage, text: string): Promise<boolean> {
    if (this.store.getSnapshot().pending) return false
    this.store.update((state) => { state.pending = true; state.error = null })
    try {
      const session = this.sessions.binding(this.sessionId)?.session
      if (session !== undefined) {
        try { await session.cancel() } catch { /* already idle */ }
      }
      const result = await postEdit({
        action: 'edit',
        sessionId: this.sessionId,
        eventSeq: message.eventSeq,
        blockIndex: message.blockIndex,
        text,
      })
      this.store.update((state) => { state.pending = false })
      await this.openWhenListed(result.sessionId as SessionId)
      return true
    } catch (error) {
      this.store.update((state) => { state.pending = false; state.error = messageOf(error) })
      return false
    }
  }

  private async stop(): Promise<boolean> {
    const session = this.sessions.binding(this.sessionId)?.session
    if (session === undefined) return false
    try {
      const result = await session.cancel()
      return result.ok
    } catch {
      return false
    }
  }

  private openWhenListed(sessionId: SessionId): Promise<void> {
    if (this.sessions.list.getSnapshot().byId[sessionId] !== undefined) {
      this.sessions.open(sessionId)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      let settled = false
      let dispose = (): void => {}
      const finish = (open: boolean): void => {
        if (settled) return
        settled = true
        dispose()
        this.navigationWaits.delete(cancel)
        if (open) this.sessions.open(sessionId)
        resolve()
      }
      const cancel = (): void => { finish(false) }
      this.navigationWaits.add(cancel)
      dispose = this.sessions.list.subscribe(() => {
        if (this.sessions.list.getSnapshot().byId[sessionId] === undefined) return
        finish(true)
      })
      if (this.sessions.list.getSnapshot().byId[sessionId] !== undefined) finish(true)
    })
  }
}
