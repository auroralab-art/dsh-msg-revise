import { describe, expect, it } from 'vitest'
import { decodeEdit, isTrustedRequest } from '../src/http.ts'

describe('isTrustedRequest', () => {
  it('accepts loopback Origin', () => {
    expect(isTrustedRequest('http://127.0.0.1:3080', undefined)).toBe(true)
    expect(isTrustedRequest('http://localhost:3080', undefined)).toBe(true)
  })

  it('rejects a foreign Origin', () => {
    expect(isTrustedRequest('https://evil.example', '127.0.0.1:3080')).toBe(false)
  })

  it('accepts a loopback Host when Origin is absent', () => {
    expect(isTrustedRequest(undefined, '127.0.0.1:3080')).toBe(true)
  })

  it('allows a request with neither Origin nor Host', () => {
    expect(isTrustedRequest(undefined, undefined)).toBe(true)
  })
})

describe('decodeEdit', () => {
  it('reads a valid edit body', () => {
    expect(decodeEdit({
      action: 'edit',
      sessionId: 'session-1',
      eventSeq: 5,
      blockIndex: 0,
      text: 'hello',
    })).toEqual({
      action: 'edit',
      sessionId: 'session-1',
      eventSeq: 5,
      blockIndex: 0,
      text: 'hello',
    })
  })

  it('reads an unsend body', () => {
    expect(decodeEdit({ action: 'unsend', sessionId: 'session-1' })).toEqual({
      action: 'unsend',
      sessionId: 'session-1',
    })
  })

  it('rejects a non-edit action', () => {
    expect(() => decodeEdit({ action: 'reroll', sessionId: 's' })).toThrow(/action/)
  })

  it('rejects blank text', () => {
    expect(() => decodeEdit({
      action: 'edit',
      sessionId: 'session-1',
      eventSeq: 1,
      blockIndex: 0,
      text: '   ',
    })).toThrow(/空/)
  })
})
