import type { LanguageId } from './types'

/**
 * Hand-off to the standalone terminal tab.
 *
 * The payload rides in the URL fragment, which never reaches a server, and is
 * base64url so a source full of `#`, `?` or newlines cannot truncate it.
 */

export const TERMINAL_PATH = 'terminal.html'

export interface TerminalPayload {
  readonly language: LanguageId
  readonly source: string
  readonly stdin: string
}

export function encodePayload(payload: TerminalPayload): string {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)

  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodePayload(fragment: string): TerminalPayload | null {
  const cleaned = fragment.replace(/^#/, '')
  if (cleaned === '') return null

  let base64 = cleaned.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='

  let json: string
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    json = new TextDecoder().decode(bytes)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as { language?: unknown; source?: unknown; stdin?: unknown }
  if (typeof record.language !== 'string' || typeof record.source !== 'string') return null

  return {
    language: record.language as LanguageId,
    source: record.source,
    stdin: typeof record.stdin === 'string' ? record.stdin : '',
  }
}

/**
 * `base` is an origin (`http://localhost:5183`) or a directory path. Building
 * the URL through the URL API rather than string concatenation is the point:
 * an origin has no trailing slash, and `origin + 'terminal.html'` silently
 * produces a host called `5183terminal`.
 */
export function terminalUrl(payload: TerminalPayload, base: string): string {
  const url = new URL(TERMINAL_PATH, base.endsWith('/') ? base : `${base}/`)
  url.hash = encodePayload(payload)
  return url.href
}
