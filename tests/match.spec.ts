import { describe, expect, it } from 'vitest'
import { matchNeedle, pickUserBlock } from '../src/match.ts'
import type { EditableUserMessage } from '../src/shared.ts'

function user(seq: number, text: string): EditableUserMessage {
  return { key: `${seq}:0`, turn: 1, eventSeq: seq, blockIndex: 0, text, time: seq }
}

describe('pickUserBlock', () => {
  it('claims the first unused matching user block', () => {
    const users = [user(1, 'same prompt'), user(5, 'same prompt')]
    const first = pickUserBlock('copy same prompt', users, new Set())
    expect(first?.eventSeq).toBe(1)
    const second = pickUserBlock('copy same prompt', users, new Set([1]))
    expect(second?.eventSeq).toBe(5)
  })

  it('ignores empty rows and empty prompts', () => {
    expect(pickUserBlock('   ', [user(1, 'hi')], new Set())).toBeUndefined()
    expect(pickUserBlock('copy', [user(1, '')], new Set())).toBeUndefined()
  })

  it('uses a short prefix for long prompts', () => {
    const text = 'x'.repeat(80)
    expect(matchNeedle(text)).toHaveLength(48)
    expect(pickUserBlock(`prefix ${text.slice(0, 48)} suffix`, [user(2, text)], new Set())?.eventSeq).toBe(2)
  })
})
