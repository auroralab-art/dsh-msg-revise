import { foldTurns, type FoldEvent } from './turns.ts'

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function eventIsFirstToken(event: FoldEvent): boolean {
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (chunk === undefined || typeof chunk !== 'object' || chunk === null) return false
    const rec = chunk as { type?: string; text?: string; name?: string; argumentsDelta?: string }
    if ((rec.type === 'text-delta' || rec.type === 'reasoning-delta') && isNonEmpty(rec.text)) return true
    if (rec.type === 'tool-call-delta' && (isNonEmpty(rec.argumentsDelta) || rec.name !== undefined)) return true
    return false
  }
  if (event.type === 'assistant/message') {
    return (event.data.message?.content ?? []).some(block => isNonEmpty(block.text))
  }
  return event.type === 'tool/call'
}

/** TTFT of the last user turn only — earlier completed replies do not count. */
export function hasFirstToken(events: readonly FoldEvent[]): boolean {
  const { closed, open } = foldTurns(events)
  const startSeq = open?.startSeq ?? closed.at(-1)?.startSeq
  if (startSeq === undefined) return events.some(eventIsFirstToken)
  return events.some(event => event.seq >= startSeq && eventIsFirstToken(event))
}
