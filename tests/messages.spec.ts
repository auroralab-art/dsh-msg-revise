import { describe, expect, it } from 'vitest'
import { snapshotUserMessages } from '../src/client/messages.ts'

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
