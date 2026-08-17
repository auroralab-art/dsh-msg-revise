import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadStore, rememberVersion, storePath } from '../src/store.ts'

describe('version store', () => {
  it('writes metadata outside the session log', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-msg-revise-'))
    const path = storePath(home)
    rememberVersion('session-child', {
      effect: {
        id: 'e1',
        operation: 'edit',
        cascade: 'truncate',
        targetTurn: 1,
        targetEventSeq: 1,
        targetBlockIndex: 0,
        blockKind: 'user',
        before: 'a',
        after: 'b',
      },
      inverseSessionId: 'session-src',
      time: 1,
    }, path)
    expect(path.endsWith('storages/dsh-msg-revise/versions.json')).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))['session-child'].inverseSessionId).toBe('session-src')
    expect(loadStore(path)['session-child']?.effect.after).toBe('b')
  })
})
