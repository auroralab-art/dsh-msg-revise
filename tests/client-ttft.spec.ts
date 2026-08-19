import { describe, expect, it } from 'vitest'
import { shouldUnsendOnIdle, snapshotHasFirstToken } from '../src/client/ttft.ts'

describe('snapshotHasFirstToken', () => {
  it('is false with only a user node', () => {
    expect(snapshotHasFirstToken({
      partial: null,
      nodes: [{ kind: 'user' }],
    })).toBe(false)
  })

  it('is true when firstTokenTime is recorded', () => {
    expect(snapshotHasFirstToken({
      partial: null,
      nodes: [{ kind: 'assistant', timing: { firstTokenTime: 10 } }],
    })).toBe(true)
  })

  it('is true when the partial accumulator has text', () => {
    expect(snapshotHasFirstToken({
      partial: { blocks: [{ text: 'H' }] },
      nodes: [{ kind: 'user' }],
    })).toBe(true)
  })

  it('ignores a prior assistant reply when the last prompt has no token yet', () => {
    expect(snapshotHasFirstToken({
      partial: null,
      nodes: [
        { kind: 'user' },
        { kind: 'assistant', timing: { firstTokenTime: 10 }, blocks: [{ text: 'done' }] },
        { kind: 'user' },
      ],
    })).toBe(false)
  })
})

describe('shouldUnsendOnIdle', () => {
  it('fires only on the running→idle edge before the first token', () => {
    expect(shouldUnsendOnIdle(true, false, false)).toBe(true)
  })

  it('ignores first observation of an already-idle session', () => {
    expect(shouldUnsendOnIdle(undefined, false, false)).toBe(false)
  })

  it('leaves a completed or post-TTFT stop to the pencil path', () => {
    expect(shouldUnsendOnIdle(true, false, true)).toBe(false)
  })

  it('ignores still-running snapshots', () => {
    expect(shouldUnsendOnIdle(true, true, false)).toBe(false)
  })
})
