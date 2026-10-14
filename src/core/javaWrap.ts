/**
 * Java sources written in an editor expect to be bare statements. Judge0 will
 * only run a file whose public class is called `Main`, so anything without one
 * gets wrapped — with imports hoisted above the class, where javac requires
 * them to be.
 *
 * Both decisions read a comment- and string-stripped copy of the source.
 * Matching the raw text means a comment as innocent as
 * `// wraps this in class Main` silently disables the wrapper, and the program
 * then fails to compile for a reason that appears nowhere in the error.
 */

export interface JavaWrapResult {
  readonly code: string
  readonly wrapped: boolean
}

const CLASS_DECL = /\b(?:class|record|interface|enum)\s+Main\b/
const LEADING_DIRECTIVE = /^\s*(?:package\s+[\w.]+|import\s+(?:static\s+)?[\w.*]+\s*;)/

/**
 * Replaces comment and literal contents with spaces, preserving every offset
 * and line break so line indices stay aligned with the original.
 */
function stripCommentsAndLiterals(source: string): string {
  const out: string[] = []
  let i = 0

  const blank = (length: number): void => {
    for (let n = 0; n < length; n++) {
      out.push(source[i + n] === '\n' ? '\n' : ' ')
    }
  }

  while (i < source.length) {
    const ch = source[i] as string
    const next = source[i + 1]

    if (ch === '"' || ch === "'") {
      const quote = ch
      const start = i
      i++
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++
        i++
      }
      i = Math.min(i + 1, source.length)
      blank(i - start)
      continue
    }

    if (ch === '/' && next === '/') {
      const start = i
      while (i < source.length && source[i] !== '\n') i++
      blank(i - start)
      continue
    }

    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(i + 2, source.length)
      blank(i - start)
      continue
    }

    out.push(ch)
    i++
  }

  return out.join('')
}

export function wrapJava(source: string): JavaWrapResult {
  const code = stripCommentsAndLiterals(source)
  if (CLASS_DECL.test(code)) return { code: source, wrapped: false }

  const originalLines = source.split('\n')
  const codeLines = code.split('\n')

  const directives: string[] = []
  const body: string[] = []

  for (let index = 0; index < originalLines.length; index++) {
    const original = originalLines[index] ?? ''
    const stripped = codeLines[index] ?? ''

    if (body.length === 0 && LEADING_DIRECTIVE.test(stripped)) {
      directives.push(original.trim())
      continue
    }
    body.push(original)
  }

  while (body.length > 0 && (body[0] ?? '').trim() === '') body.shift()

  const indent = '    '
  const indented = body.map((line) => (line.trim() === '' ? '' : indent + line)).join('\n')

  return {
    wrapped: true,
    code: [
      ...directives,
      '',
      'public class Main {',
      '    public static void main(String[] args) {',
      indented,
      '    }',
      '}',
      '',
    ].join('\n'),
  }
}
