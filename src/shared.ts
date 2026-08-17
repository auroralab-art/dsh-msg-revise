/** Same-origin endpoint owned by the host half. */
export const REVISE_PATH = '/msg-revise'

export const PLUGIN_ID = 'dsh-msg-revise'

export const VIEW_ORDER = 14

export interface VersionEffect {
  id: string
  operation: 'edit'
  cascade: 'truncate'
  targetTurn: number
  targetEventSeq: number
  targetBlockIndex: number
  blockKind: 'user'
  before: string
  after: string
}

export interface VersionRecord {
  effect: VersionEffect
  inverseSessionId: string
  time: number
}

export interface EditableUserMessage {
  key: string
  turn: number
  eventSeq: number
  blockIndex: number
  text: string
  time: number
  open?: boolean
}

export interface EditOperation {
  action: 'edit'
  sessionId: string
  eventSeq: number
  blockIndex: number
  text: string
}

export interface EditResult {
  sessionId: string
  queuedTurns: number
}

export const MAX_REQUEST_BODY_BYTES = 64 * 1024

export const TRUSTED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
