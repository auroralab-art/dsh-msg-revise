import type {
  ClientContext, ISessions, ObservableSnapshot, SessionFace, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { REVISE_PATH, type EditResult, type EditableUserMessage, type ReviseOperation } from '../shared.ts'
import { shouldUnsendOnIdle, snapshotHasFirstToken } from './ttft.ts'

export interface ReviseState {
  pending: boolean
  error: string | null
}

export interface ReviseFace {
  hooks: { revise: ObservableSnapshot<ReviseState> }
  edit(message: EditableUserMessage, text: string): Promise<boolean>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function postRevise(operation: ReviseOperation): Promise<EditResult> {
  const response = await fetch(REVISE_PATH, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(operation),
  })
  const value = await response.json() as EditResult & { error?: string }
  if (!response.ok) {
    throw new Error(typeof value.error === 'string' ? value.error : `请求失败：HTTP ${response.status}`)
  }
  if (typeof value.sessionId !== 'string' || typeof value.queuedTurns !== 'number') {
    throw new Error('操作响应无效')
  }
  return value
}

export class ReviseController {
  readonly face: ReviseFace
  private readonly store = createSnapshotStore<ReviseState>({ pending: false, error: null })
  private readonly sessions: ISessions
  private readonly navigationWaits = new Set<() => void>()

  constructor(
    private readonly ctx: ClientContext,
    private readonly sessionId: SessionId,
  ) {
    this.sessions = ctx.sessions as unknown as ISessions
    this.face = {
      hooks: { revise: this.store },
      edit: (message, text) => this.edit(message, text),
    }
    ctx.effect(() => this.observeNativeCancel(), `msg-revise: observe native cancel ${sessionId}`)
  }

  dispose(): void {
    for (const cancel of [...this.navigationWaits]) cancel()
  }

  /**
   * Native InputBar owns stop (`session.cancel`). This service only reacts:
   * a running→idle edge before TTFT unsends the last prompt into the composer.
   */
  private observeNativeCancel(): () => void {
    let lastRunning: boolean | undefined
    let sessionFace: SessionFace | undefined
    let sessionDispose: (() => void) | undefined

    const bind = (): void => {
      const next = this.sessions.binding(this.sessionId)?.session
      if (next === sessionFace) return
      sessionDispose?.()
      sessionFace = next
      lastRunning = next?.getSnapshot().running
      sessionDispose = next?.subscribe(() => {
        if (sessionFace !== next) return
        const snapshot = next.getSnapshot()
        const wasRunning = lastRunning
        lastRunning = snapshot.running
        if (!shouldUnsendOnIdle(wasRunning, snapshot.running, snapshotHasFirstToken(snapshot))) return
        void this.unsendAfterNativeStop()
      })
    }

    bind()
    const disposeList = this.sessions.list.subscribe(() => { bind() })
    return () => {
      disposeList()
      sessionDispose?.()
    }
  }

  private async edit(message: EditableUserMessage, text: string): Promise<boolean> {
    if (this.store.getSnapshot().pending) return false
    this.store.update((state) => { state.pending = true; state.error = null })
    try {
      const session = this.sessions.binding(this.sessionId)?.session
      if (session !== undefined) {
        try { await session.cancel() } catch { /* already idle */ }
      }
      const result = await postRevise({
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

  private async unsendAfterNativeStop(): Promise<void> {
    if (this.store.getSnapshot().pending) return
    this.store.update((state) => { state.pending = true; state.error = null })
    try {
      const result = await postRevise({ action: 'unsend', sessionId: this.sessionId })
      this.store.update((state) => { state.pending = false })
      await this.openWhenListed(result.sessionId as SessionId)
      if (typeof result.restoredText === 'string') this.restoreDraft(result.sessionId as SessionId, result.restoredText)
    } catch (error) {
      if (messageOf(error).includes('首字已到达')) {
        this.store.update((state) => { state.pending = false })
        return
      }
      this.store.update((state) => { state.pending = false; state.error = messageOf(error) })
    }
  }

  private restoreDraft(sessionId: SessionId, text: string): void {
    const conversation = this.ctx.get('conversation') as IConversation | undefined
    const scope = this.sessions.scope(sessionId)
    if (conversation === undefined || scope === undefined) return
    conversation.input.for(scope).setDraft(text)
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
