import { MAX_REQUEST_BODY_BYTES, TRUSTED_HOSTNAMES, type ReviseOperation } from './shared.ts'

export function hostnameOf(hostOrOrigin: string): string | undefined {
  if (hostOrOrigin.startsWith('http://') || hostOrOrigin.startsWith('https://')) {
    try {
      return new URL(hostOrOrigin).hostname
    } catch {
      return undefined
    }
  }
  if (hostOrOrigin.startsWith('[')) {
    const end = hostOrOrigin.indexOf(']')
    return end >= 0 ? hostOrOrigin.slice(0, end + 1) : undefined
  }
  return hostOrOrigin.split(':')[0]
}

/**
 * CSRF / DNS-rebinding fence for `webServer.register` routes.
 * Missing both Origin and Host (non-browser internal) is allowed.
 */
export function isTrustedRequest(origin: string | undefined, host: string | undefined): boolean {
  if (origin !== undefined && origin.length > 0) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      return false
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return TRUSTED_HOSTNAMES.has(url.hostname)
  }
  if (host === undefined || host.length === 0) return true
  const hostname = hostnameOf(host)
  return hostname !== undefined && TRUSTED_HOSTNAMES.has(hostname)
}

export class BodyTooLargeError extends Error {
  constructor() {
    super(`请求体超过 ${MAX_REQUEST_BODY_BYTES} 字节上限。`)
    this.name = 'BodyTooLargeError'
  }
}

export function decodeEdit(value: unknown): ReviseOperation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('请求体必须是 JSON 对象。')
  }
  const record = value as Record<string, unknown>
  if (typeof record['sessionId'] !== 'string' || record['sessionId'].length === 0) {
    throw new TypeError('sessionId 必须是非空字符串。')
  }
  if (record['action'] === 'unsend') {
    return { action: 'unsend', sessionId: record['sessionId'] }
  }
  if (record['action'] !== 'edit') throw new TypeError('action 必须是 edit 或 unsend。')
  if (!Number.isSafeInteger(record['eventSeq']) || (record['eventSeq'] as number) < 0) {
    throw new TypeError('eventSeq 必须是非负安全整数。')
  }
  if (!Number.isSafeInteger(record['blockIndex']) || (record['blockIndex'] as number) < 0) {
    throw new TypeError('blockIndex 必须是非负安全整数。')
  }
  if (typeof record['text'] !== 'string') throw new TypeError('text 必须是字符串。')
  if (record['text'].trim().length === 0) throw new TypeError('text 不能为空。')
  return {
    action: 'edit',
    sessionId: record['sessionId'],
    eventSeq: record['eventSeq'] as number,
    blockIndex: record['blockIndex'] as number,
    text: record['text'],
  }
}
