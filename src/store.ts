import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VersionRecord } from './shared.ts'

export function storePath(home = process.env.DSH_HOME ?? process.cwd()): string {
  return join(home, 'storages', 'dsh-msg-revise', 'versions.json')
}

export function loadStore(path = storePath()): Record<string, VersionRecord> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, VersionRecord>
  } catch {
    return {}
  }
}

export function saveStore(store: Record<string, VersionRecord>, path = storePath()): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, path)
}

export function rememberVersion(childId: string, version: VersionRecord, path = storePath()): void {
  const store = loadStore(path)
  store[childId] = version
  saveStore(store, path)
}
