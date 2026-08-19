import { describe, expect, it } from 'vitest'
import { hasFirstToken } from '../src/ttft.ts'
import type { FoldEvent } from '../src/turns.ts'

function ev(type: string, data: FoldEvent['data'], seq: number): FoldEvent {
  return { type, seq, time: seq * 1000, data }
}

describe('hasFirstToken', () => {
  it('is false before any model output', () => {
    expect(hasFirstToken([
      ev('turn/start', { turn: 1 }, 0),
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, 1),
    ])).toBe(false)
  })

  it('is false on protocol framing without a delta', () => {
    expect(hasFirstToken([
      ev('assistant/chunk', { chunk: { type: 'block-start', index: 0, blockType: 'text' } }, 2),
    ])).toBe(false)
  })

  it('is true on the first non-empty text-delta', () => {
    expect(hasFirstToken([
      ev('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'H' } }, 3),
    ])).toBe(true)
  })

  it('is true on the first non-empty reasoning-delta', () => {
    expect(hasFirstToken([
      ev('assistant/chunk', { chunk: { type: 'reasoning-delta', index: 0, text: '.' } }, 3),
    ])).toBe(true)
  })

  it('ignores tokens from an earlier completed turn', () => {
    expect(hasFirstToken([
      ev('turn/start', { turn: 1 }, 0),
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] }, 1),
      ev('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'A' } }, 2),
      ev('turn/end', { turn: 1 }, 3),
      ev('turn/start', { turn: 2 }, 4),
      ev('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] }, 5),
    ])).toBe(false)
  })
})
