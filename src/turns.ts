import type { EditOperation, EditableUserMessage, VersionOperation, VersionRecord } from './shared.ts'

export interface FoldEvent {
  type: string
  seq: number
  time: number
  data: {
    turn?: number
    source?: { kind?: string }
    content?: ReadonlyArray<{ type: string; text?: string }>
    message?: { content?: ReadonlyArray<{ type: string; text?: string }> }
    chunk?: unknown
  }
}

export interface ClosedTurn {
  turn: number
  startSeq: number
  endSeq: number
  user?: FoldEvent
}

export interface OpenTail {
  turn: number
  startSeq: number
  user?: FoldEvent
}

export interface QueuedUser {
  content: Array<{ type: string; text?: string }>
}

export interface EditPlan {
  boundary: number
  version: VersionRecord
  queuedUsers: QueuedUser[]
}

export interface UnsendPlan {
  boundary: number
  version: VersionRecord
  restoredText: string
}

function pairVersion(
  sourceSessionId: string,
  before: string,
  after: string,
  turn: number,
  eventSeq: number,
  blockIndex: number,
  operation: VersionOperation = 'edit',
): VersionRecord {
  return {
    effect: {
      id: crypto.randomUUID(),
      operation,
      cascade: 'truncate',
      targetTurn: turn,
      targetEventSeq: eventSeq,
      targetBlockIndex: blockIndex,
      blockKind: 'user',
      before,
      after,
    },
    inverseSessionId: sourceSessionId,
    time: Date.now(),
  }
}

function textBlock(event: FoldEvent, blockIndex: number): string {
  const block = event.data.content?.[blockIndex]
  if (block?.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('所选用户消息块不是文本。')
  }
  return block.text
}

function replaceText(event: FoldEvent, blockIndex: number, text: string): QueuedUser {
  const content = (event.data.content ?? []).map((block, index) => {
    if (index !== blockIndex) return { ...block }
    return { ...block, type: 'text', text }
  })
  return { content }
}

/** Fold complete turn brackets plus the optional still-open tail. */
export function foldTurns(events: readonly FoldEvent[]): { closed: ClosedTurn[]; open?: OpenTail } {
  const closed: ClosedTurn[] = []
  let current: { turn: number; startSeq: number; user?: FoldEvent } | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      current = { turn: Number(event.data.turn), startSeq: event.seq }
      continue
    }
    if (current === undefined) continue
    if (event.type === 'user/message' && current.user === undefined && event.data.source?.kind === 'user') {
      current.user = event
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === current.turn) {
      closed.push({ ...current, endSeq: event.seq })
      current = undefined
    }
  }
  if (current !== undefined && current.user !== undefined) {
    return { closed, open: current }
  }
  return { closed }
}

export function editableUsers(closed: readonly ClosedTurn[], open?: OpenTail): EditableUserMessage[] {
  const result: EditableUserMessage[] = []
  const push = (event: FoldEvent, turn: number, openFlag: boolean): void => {
    for (const [blockIndex, block] of (event.data.content ?? []).entries()) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue
      result.push({
        key: `${event.seq}:${blockIndex}`,
        turn,
        eventSeq: event.seq,
        blockIndex,
        text: block.text,
        time: event.time,
        ...(openFlag ? { open: true } : {}),
      })
    }
  }
  for (const turn of closed) {
    if (turn.user !== undefined) push(turn.user, turn.turn, false)
  }
  if (open?.user !== undefined) push(open.user, open.turn, true)
  return result
}

export function planEdit(operation: EditOperation, events: readonly FoldEvent[]): EditPlan {
  const { closed, open } = foldTurns(events)
  if (open?.user !== undefined && open.user.seq === operation.eventSeq) {
    const before = textBlock(open.user, operation.blockIndex)
    return {
      boundary: open.startSeq - 1,
      version: pairVersion(operation.sessionId, before, operation.text, open.turn, open.user.seq, operation.blockIndex),
      queuedUsers: [replaceText(open.user, operation.blockIndex, operation.text)],
    }
  }
  const turn = closed.find(candidate => operation.eventSeq > candidate.startSeq && operation.eventSeq < candidate.endSeq)
  if (turn?.user === undefined || turn.user.seq !== operation.eventSeq) {
    throw new Error('所选消息不属于可修改的用户回合。')
  }
  const before = textBlock(turn.user, operation.blockIndex)
  return {
    boundary: turn.startSeq - 1,
    version: pairVersion(operation.sessionId, before, operation.text, turn.turn, turn.user.seq, operation.blockIndex),
    queuedUsers: [replaceText(turn.user, operation.blockIndex, operation.text)],
  }
}

function userPlainText(event: FoldEvent): string {
  return (event.data.content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

/** Cut before the last user turn and restore its text. Does not queue a followup. */
export function planUnsend(sessionId: string, events: readonly FoldEvent[]): UnsendPlan {
  const { closed, open } = foldTurns(events)
  const openUser = open?.user
  const lastClosed = closed.at(-1)
  const turn = openUser !== undefined && open !== undefined
    ? { startSeq: open.startSeq, turn: open.turn, user: openUser }
    : lastClosed?.user !== undefined
      ? { startSeq: lastClosed.startSeq, turn: lastClosed.turn, user: lastClosed.user }
      : undefined
  if (turn === undefined) throw new Error('没有可收回的提问。')
  const restoredText = userPlainText(turn.user)
  if (restoredText.trim().length === 0) throw new Error('没有可收回的提问。')
  return {
    boundary: turn.startSeq - 1,
    version: pairVersion(sessionId, restoredText, '', turn.turn, turn.user.seq, 0, 'unsend'),
    restoredText,
  }
}
