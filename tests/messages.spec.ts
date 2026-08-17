import { describe, expect, it } from 'vitest'
import { revisableAfterStop, snapshotUserMessages } from '../src/client/messages.ts'

describe('snapshotUserMessages', () => {
  it('pairs a user node with the following assistant turn', () => {
    const blocks = snapshotUserMessages([
      { kind: 'user', seq: 1, time: 1000, content: [{ type: 'text', text: 'first' }] },
      { kind: 'assistant', turn: 1 },
      { kind: 'user', seq: 5, time: 5000, content: [{ type: 'text', text: 'second' }] },
    ])
    expect(blocks).toEqual([
      { key: '1:0', turn: 1, eventSeq: 1, blockIndex: 0, text: 'first', time: 1000 },
      { key: '5:0', turn: 0, eventSeq: 5, blockIndex: 0, text: 'second', time: 5000 },
    ])
  })
})

describe('revisableAfterStop', () => {
  const nodes = [
    { kind: 'user', seq: 1, time: 1000, content: [{ type: 'text', text: 'first' }] },
    { kind: 'assistant', turn: 1 },
    { kind: 'user', seq: 5, time: 5000, content: [{ type: 'text', text: 'second' }] },
  ]
  const users = snapshotUserMessages(nodes)

  it('hides the pencil while the turn is running', () => {
    expect(revisableAfterStop(nodes, users, true)).toBeUndefined()
  })

  it('hides the pencil after a completed reply', () => {
    const finished = [
      ...nodes,
      { kind: 'assistant', turn: 2 },
    ]
    expect(revisableAfterStop(finished, snapshotUserMessages(finished), false)).toBeUndefined()
  })

  it('targets the last user prompt after stop, before any reply', () => {
    expect(revisableAfterStop(nodes, users, false)?.eventSeq).toBe(5)
  })

  it('targets the last user prompt when the assistant was interrupted', () => {
    const stopped = [
      ...nodes,
      { kind: 'assistant', turn: 2, interrupted: true as const },
    ]
    expect(revisableAfterStop(stopped, snapshotUserMessages(stopped), false)?.eventSeq).toBe(5)
  })
})
