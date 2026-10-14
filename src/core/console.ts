/**
 * Formatting rules for the console bridge.
 *
 * Lives outside the worker so the Node verify suite can assert on them: a
 * console that renders `[object Object]` for every array is not a console.
 */

export type BridgeMessage =
  | { readonly kind: 'output'; readonly stream: 'stdout' | 'stderr'; readonly text: string }
  | { readonly kind: 'prompt'; readonly token: string; readonly text: string; readonly defaultValue: string }
  | { readonly kind: 'done'; readonly ok: boolean }

const MAX_DEPTH = 4
const MAX_STRING = 200

export function formatArgs(args: readonly unknown[]): string {
  return args.map((arg) => formatValue(arg, 0)).join(' ')
}

/** The one place a string is left unquoted: the top-level console argument. */
export function formatValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  // The root goes in the set first, otherwise an object that points at itself
  // is only recognised as circular one level too late.
  const seen = new WeakSet<object>()
  if (typeof value === 'object' && value !== null) seen.add(value)
  return formatInner(value, depth, seen)
}

function formatInner(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `"${value.slice(0, MAX_STRING)}…"` : `"${value}"`
  }
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  switch (typeof value) {
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value)
    case 'boolean':
      return String(value)
    case 'bigint':
      return `${value}n`
    case 'symbol':
      return value.toString()
    case 'function': {
      const name = (value as { name?: string }).name
      return name ? `[Function: ${name}]` : '[Function (anonymous)]'
    }
    case 'object':
      return describeObject(value, depth, seen)
    default:
      return String(value)
  }
}

function describeObject(value: object, depth: number, seen: WeakSet<object>): string {
  if (value instanceof Error) return describeError(value)
  if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof RegExp) return String(value)

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return '[Array]'
    if (value.length === 0) return '[]'
    return `[ ${value.map((item) => nested(item, depth + 1, seen)).join(', ')} ]`
  }

  if (value instanceof Map) {
    if (depth >= MAX_DEPTH) return '[Map]'
    const entries = [...value.entries()].map(
      ([key, entry]) => `${nested(key, depth + 1, seen)} => ${nested(entry, depth + 1, seen)}`,
    )
    return entries.length === 0 ? 'Map(0) {}' : `Map(${value.size}) { ${entries.join(', ')} }`
  }

  if (value instanceof Set) {
    if (depth >= MAX_DEPTH) return '[Set]'
    const entries = [...value.values()].map((entry) => nested(entry, depth + 1, seen))
    return entries.length === 0 ? 'Set(0) {}' : `Set(${value.size}) { ${entries.join(', ')} }`
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    if (depth >= MAX_DEPTH) return `[${value.constructor.name}]`
    const list = value as unknown as ArrayLike<number>
    const items = Array.from(list, (n) => String(n))
    return `${value.constructor.name}(${list.length}) [ ${items.join(', ')} ]`
  }

  if (depth >= MAX_DEPTH) return '[Object]'

  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, entry]) => `${key}: ${nested(entry, depth + 1, seen)}`,
  )

  const name = constructorName(value)
  const prefix = name === 'Object' ? '' : `${name} `
  return entries.length === 0 ? `${prefix}{}` : `${prefix}{ ${entries.join(', ')} }`
}

/** Renders a child value, marking it as already-seen if it closes a cycle. */
function nested(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const rendered = formatInner(value, depth, seen)
    seen.delete(value)
    return rendered
  }
  return formatInner(value, depth, seen)
}

function constructorName(value: object): string {
  const name = (value as { constructor?: { name?: string } }).constructor?.name
  return name && name !== 'Object' ? name : 'Object'
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const head = `${error.name}: ${error.message}`
  if (!error.stack) return head

  // The stack repeats the head as its first line; showing it twice is noise.
  const stackLines = error.stack.split('\n').filter((line) => line.trim() !== '')
  const frames = stackLines.filter((line) => !line.startsWith(error.name))
  return frames.length === 0 ? head : `${head}\n${frames.join('\n')}`
}

export interface ConsoleBridge {
  /** Drop-in replacement for the native console. */
  readonly console: Console
  /** Replacement for `prompt()`. Each call carries a token the host replies to. */
  ask(question: string, defaultValue?: string): Promise<string>
  /** Called by the host when the user answers a pending prompt. */
  resolvePrompt(token: string, value: string): void
  /** True while a prompt is unanswered — used to focus the stdin box. */
  awaitingInput(): boolean
}

export function createConsoleBridge(
  post: (message: BridgeMessage) => void,
  native: Console,
): ConsoleBridge {
  const pending = new Map<string, (value: string) => void>()
  let promptSeq = 0

  const emit =
    (stream: 'stdout' | 'stderr', method: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      post({ kind: 'output', stream, text: `${formatArgs(args)}\n` })
      method.apply(native, args)
    }

  const bridged = {
    log: emit('stdout', native.log.bind(native)),
    info: emit('stdout', native.info.bind(native)),
    debug: emit('stdout', native.debug.bind(native)),
    warn: emit('stderr', native.warn.bind(native)),
    error: emit('stderr', native.error.bind(native)),
    trace: emit('stderr', (native.trace ?? native.log).bind(native)),
  } as unknown as Console

  const ask = (question: string, defaultValue = ''): Promise<string> =>
    new Promise<string>((resolve) => {
      const token = `prompt-${++promptSeq}`
      pending.set(token, resolve)
      post({ kind: 'prompt', token, text: question, defaultValue })
    })

  const resolvePrompt = (token: string, value: string): void => {
    const settle = pending.get(token)
    if (!settle) return
    pending.delete(token)
    settle(value)
  }

  return { console: bridged, ask, resolvePrompt, awaitingInput: () => pending.size > 0 }
}
