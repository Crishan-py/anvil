/**
 * Terminal escape-sequence handling.
 *
 * Output of a compiled program is untrusted text, so this module only ever
 * produces structured spans. The renderer turns those into DOM nodes with
 * `textContent`; nothing here is ever interpolated into HTML.
 */

export interface AnsiSpan {
  readonly text: string
  readonly fg: number | null
  readonly bg: number | null
  readonly bold: boolean
  readonly dim: boolean
  readonly italic: boolean
  readonly underline: boolean
}

interface Style {
  fg: number | null
  bg: number | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

const ESC = '\u001b'
const BEL = '\u0007'

function blankStyle(): Style {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }
}

function isFinalByte(code: number): boolean {
  return code >= 0x40 && code <= 0x7e
}

/**
 * Splits terminal output into styled spans, in document order.
 *
 * Newlines survive as their own spans so the renderer can use `pre-wrap` and let
 * the browser do the line breaking. A carriage return discards the current line,
 * which is what a progress bar re-writing itself looks like once it settles.
 */
export function parseAnsi(input: string): AnsiSpan[] {
  const out: AnsiSpan[] = []
  let style = blankStyle()
  let buf = ''
  let line: AnsiSpan[] = []

  const flushBuffer = (): void => {
    if (buf !== '') {
      line.push({ text: buf, ...style })
      buf = ''
    }
  }

  const endLine = (withNewline: boolean): void => {
    flushBuffer()
    for (const span of line) out.push(span)
    if (withNewline) out.push({ text: '\n', ...blankStyle() })
    line = []
  }

  /** A carriage return rewinds: whatever was on this line is replaced, not kept. */
  const discardLine = (): void => {
    flushBuffer()
    line = []
  }

  let i = 0
  while (i < input.length) {
    const ch = input[i] as string

    if (ch === ESC) {
      const next = input[i + 1]

      if (next === '[') {
        let j = i + 2
        while (j < input.length && !isFinalByte(input.charCodeAt(j))) j++
        const final = input[j] ?? ''
        const body = input.slice(i + 2, j)
        // Text already buffered was emitted under the old style; it must be
        // closed off before the new one takes effect.
        if (final === 'm') {
          flushBuffer()
          style = applySgr(style, body)
        }
        i = j + 1
        continue
      }

      if (next === ']') {
        // OSC (hyperlinks, window titles) runs until BEL or ST (ESC backslash).
        let j = i + 2
        while (j < input.length) {
          if (input[j] === BEL) {
            j++
            break
          }
          if (input[j] === ESC && input[j + 1] === '\\') {
            j += 2
            break
          }
          j++
        }
        i = j
        continue
      }

      i += 2
      continue
    }

    if (ch === '\n') {
      endLine(true)
      i++
      continue
    }

    if (ch === '\r') {
      discardLine()
      i++
      continue
    }

    if (ch === '\t') {
      const width = line.reduce((n, span) => n + span.text.length, buf.length)
      buf += ' '.repeat(8 - (width % 8))
      i++
      continue
    }

    const code = input.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      i++
      continue
    }

    buf += ch
    i++
  }

  endLine(false)
  return out
}

function applySgr(style: Style, body: string): Style {
  const next = { ...style }
  const params = body.split(';').map((part) => (part === '' ? 0 : Number.parseInt(part, 10)))

  for (let i = 0; i < params.length; i++) {
    const code = params[i]
    if (code === undefined || Number.isNaN(code)) continue

    if (code === 0) Object.assign(next, blankStyle())
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 22) {
      next.bold = false
      next.dim = false
    } else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code >= 30 && code <= 37) next.fg = code - 30
    else if (code === 38) {
      const mode = params[i + 1]
      if (mode === 5) {
        const index = params[i + 2]
        if (index !== undefined) next.fg = index
        i += 2
      } else if (mode === 2) {
        // Truecolour collapses onto the 256-colour cube; the renderer only has
        // indexed swatches to offer.
        const index = params[i + 2]
        if (index !== undefined) next.fg = index
        i += 4
      }
    } else if (code === 39) next.fg = null
    else if (code >= 40 && code <= 47) next.bg = code - 40
    else if (code === 48) {
      const mode = params[i + 1]
      if (mode === 5) {
        const index = params[i + 2]
        if (index !== undefined) next.bg = index
        i += 2
      } else if (mode === 2) {
        const index = params[i + 2]
        if (index !== undefined) next.bg = index
        i += 4
      }
    } else if (code === 49) next.bg = null
  }

  return next
}

/**
 * Indexes in standard ANSI order, on paper. */
const BASE_16 = [
  '#2b2721',
  '#a63d2f',
  '#4a7043',
  '#8f6a17',
  '#2f5d8a',
  '#7c4a8c',
  '#2c6b70',
  '#8f887c',
  '#6b6459',
  '#c0523f',
  '#5c8a52',
  '#a87f22',
  '#3d76ab',
  '#9a5fae',
  '#3a8a90',
  '#eae3d6',
] as const

/** Maps a terminal colour index to a hex value. Indices outside 0-255 clamp. */
export function ansiColor(index: number): string {
  if (!Number.isFinite(index)) return BASE_16[0] as string
  const i = Math.trunc(index)

  if (i >= 0 && i < 16) return BASE_16[i] as string
  if (i >= 232) {
    const level = 8 + (i - 232) * 10
    return rgb(level, level, level)
  }

  const cube = i - 16
  const r = Math.floor(cube / 36)
  const g = Math.floor(cube / 6) % 6
  const b = cube % 6
  return rgb(r * 51, g * 51, b * 51)
}

function rgb(r: number, g: number, b: number): string {
  const clamp = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`
}
