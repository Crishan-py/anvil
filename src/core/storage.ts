import { isLanguageId } from './registry'
import type { LanguageId } from './types'

const KEY = 'anvil.document.v1'

/** The slice of the Web Storage API this module needs, so tests can supply a fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Document {
  readonly source: string
  /** Last language the detector settled on, so a reload keeps its highlighting. */
  readonly language: LanguageId | null
}

export interface LoadedDocument {
  readonly source?: string | undefined
  readonly language?: LanguageId | null | undefined
}

/**
 * Private-mode Safari and a full quota both throw from `localStorage`, so the
 * probe writes and removes a key rather than merely reading one.
 */
export function browserStorage(): StorageLike | null {
  try {
    const probe = '__anvil_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

export function loadDocument(storage: StorageLike | null): LoadedDocument {
  if (storage === null) return {}

  let raw: string | null
  try {
    raw = storage.getItem(KEY)
  } catch {
    return {}
  }
  if (raw === null) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const record = parsed as { source?: unknown; language?: unknown }

  return {
    source: typeof record.source === 'string' ? record.source : undefined,
    language: isLanguageId(record.language) ? record.language : null,
  }
}

export function saveDocument(storage: StorageLike | null, document: Document): boolean {
  if (storage === null) return false
  try {
    storage.setItem(KEY, JSON.stringify(document))
    return true
  } catch {
    return false
  }
}

export interface Autosave {
  schedule(document: Document): void
  flush(): boolean
}

/**
 * Typing should not hit localStorage on every keystroke, but a reload must not
 * lose the last few characters either.
 */
export function createAutosave(storage: StorageLike | null, delayMs = 400): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Document | null = null

  const write = (): boolean => {
    if (pending === null) return true
    const ok = saveDocument(storage, pending)
    pending = null
    return ok
  }

  return {
    schedule(document: Document): void {
      pending = document
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        write()
      }, delayMs)
    },
    flush(): boolean {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      return write()
    },
  }
}
