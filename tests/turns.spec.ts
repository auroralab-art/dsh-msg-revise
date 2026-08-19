import { describe, expect, it } from 'vitest'
import { editableUsers, foldTurns, planEdit, planUnsend, type FoldEvent } from '../src/turns.ts'

function ev(type: string, data: FoldEvent['data'], seq: number): FoldEvent {
  return { type, seq, time: seq * 1000, data }
}

function userEvent(seq: number, text: string): FoldEvent {
  return ev('user/message', {
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }, seq)
}

const events: FoldEvent[] = [
  ev('turn/start', { turn: 1 }, 0),
  userEvent(1, 'first question'),
  ev('turn/end', { turn: 1 }, 3),
  ev('turn/start', { turn: 2 }, 4),
  userEvent(5, 'second question (in flight)'),
]

describe('foldTurns', () => {
  it('keeps one closed turn and the open tail', () => {
    const folded = foldTurns(events)
    expect(folded.closed).toHaveLength(1)
    expect(folded.closed[0]?.turn).toBe(1)
    expect(folded.open?.turn).toBe(2)
    expect(folded.open?.user?.seq).toBe(5)
  })

  it('treats an aborted turn/end as closed', () => {
    const aborted: FoldEvent[] = [
      ev('turn/start', { turn: 1 }, 0),
      userEvent(1, 'stop me'),
      ev('turn/end', { turn: 1 }, 2),
    ]
    const folded = foldTurns(aborted)
    expect(folded.closed).toHaveLength(1)
    expect(folded.open).toBeUndefined()
    expect(editableUsers(folded.closed, folded.open)[0]?.text).toBe('stop me')
  })
})

describe('planEdit', () => {
  it('cuts before the open tail', () => {
    const plan = planEdit({
      action: 'edit',
      sessionId: 's-src',
      eventSeq: 5,
      blockIndex: 0,
      text: 'EDITED second',
    }, events)
    expect(plan.boundary).toBe(3)
    expect(plan.queuedUsers).toHaveLength(1)
    expect(plan.queuedUsers[0]?.content[0]?.text).toBe('EDITED second')
    expect(plan.version.effect.operation).toBe('edit')
    expect(plan.version.inverseSessionId).toBe('s-src')
  })

  it('cuts to an empty seed when editing the first closed turn', () => {
    const plan = planEdit({
      action: 'edit',
      sessionId: 's-src',
      eventSeq: 1,
      blockIndex: 0,
      text: 'EDITED first',
    }, events)
    expect(plan.boundary).toBe(-1)
    expect(plan.queuedUsers[0]?.content[0]?.text).toBe('EDITED first')
  })
})

describe('planUnsend', () => {
  it('cuts before the open tail and returns the original text', () => {
    const plan = planUnsend('s-src', events)
    expect(plan.boundary).toBe(3)
    expect(plan.restoredText).toBe('second question (in flight)')
    expect(plan.version.effect.operation).toBe('unsend')
  })
})
