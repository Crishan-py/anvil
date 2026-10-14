import type { LanguageId } from './types'

/**
 * Language detection.
 *
 * The editor holds one buffer, so this decides what it is. Scores are additive
 * rather than first-match: a file that opens with `#include <stdio.h>` and then
 * uses `std::vector` is C++, and a rule that stopped at the first hit would get
 * that wrong.
 *
 * Only a clear winner is returned. A tie means the text is genuinely ambiguous,
 * and guessing would swap the highlighting out from under the cursor mid-typing.
 */

export interface Detection {
  readonly id: LanguageId
  readonly score: number
  /** Score over the runner-up. Below `MIN_MARGIN` the caller should hold still. */
  readonly margin: number
}

/** How far ahead the winner must be before the editor changes language. */
export const MIN_MARGIN = 2

type Signal = readonly [pattern: RegExp, weight: number]

const SIGNALS: Record<LanguageId, readonly Signal[]> = {
  json: [
    [/^\s*[[{]/, 1],
  ],
  html: [
    [/<!doctype\s+html/i, 6],
    [/<html[\s>]/i, 6],
    [/<(head|body|div|span|p|a|ul|ol|li|section|article|main|header|footer|nav)\b[^>]*>/i, 3],
    [/<(h1|h2|h3|button|table|tr|td|input|img|label|form)\b[^>]*>/i, 3],
    [/<style[\s>][\s\S]*?<\/style>/i, 3],
    [/<\/(div|span|p|a|ul|li|body|html)>/i, 2],
    [/<[a-z][\w-]*(\s+[\w-]+="[^"]*")*\s*\/?>/i, 1],
  ],
  css: [
    [/^\s*@[\w-]+\s+[\w-]+/m, 4],
    [/^[^<>{}]*\{[^<>{}]*[;:][^<>{}]*\}/m, 4],
    [/(^|\s)(color|background|margin|padding|border|font-size|display|flex|grid)\s*:/, 3],
    [/#[\w-]+\s*[,{]/, 2],
    [/\.[\w-]+\s*[,{]\s*[\w-]*\s*\{/, 3],
  ],
  java: [
    [/\bimport\s+(static\s+)?java\.[\w.]+/, 6],
    [/\bSystem\.(out|err)\.print/, 6],
    [/\bpublic\s+(static\s+)?(final\s+)?class\s+\w+/, 6],
    [/\bnew\s+(Scanner|ArrayList|HashMap|StringBuilder)\s*[(<]/, 4],
    [/\b(public|private|protected)\s+\w[\w<>\[\]]*\s+\w+\s*\([^)]*\)\s*\{/, 3],
    [/\b(String|int|boolean|double|char)\s+\w+\s*=/, 1],
  ],
  cpp: [
    [/#include\s*<(iostream|vector|string|algorithm|memory|map|set|sstream)>/, 6],
    [/\bstd::/, 5],
    [/\b(cout|cerr|cin)\s*(<<|>>)/, 5],
    [/\busing\s+namespace\s+std\s*;/, 5],
    [/\b(nullptr|auto|template\s*<|namespace\s+\w+\s*\{)/, 2],
    [/\bvector\s*<\w+>\s+\w+/, 2],
  ],
  c: [
    [/#include\s*<(stdio|stdlib|string|math|ctype|limits|stdint)\.h>/, 6],
    [/\bprintf\s*\(/, 4],
    [/\bscanf\s*\(/, 4],
    [/\bint\s+main\s*\(\s*(void|)\s*\)\s*\{/, 4],
    [/\b(struct|typedef|size_t|FILE\s*\*)\b/, 2],
  ],
  python: [
    [/^\s*def\s+\w+\s*\(/m, 6],
    [/^\s*(from\s+[\w.]+\s+)?import\s+[\w.]+/m, 5],
    [/\bprint\s*\(/, 4],
    [/\b__name__\b/, 5],
    [/\b(elif|None|True|False)\b/, 3],
    [/\bself\b/, 3],
    [/\bf(["'])[^"']*\{[^}]+\}\1/, 3],
    [/^\s*@\w+(\.\w+)*\s*$/m, 2],
    [/\bfor\s+\w+\s+in\s+[\w.]+\s*:/, 3],
    [/\b(class|try|except|with|lambda)\b/, 1],
  ],
  javascript: [
    [/\b(const|let)\s+[\w$]/, 3],
    [/=>/, 3],
    [/\bconsole\.(log|error|warn|info|debug)\s*\(/, 4],
    [/\b(async\s+)?function\s*\*?\s*\w*\s*\(/, 3],
    [/\bawait\s+/, 3],
    [/`/, 2],
    [/\b(document|window|fetch|JSON|Math|Object|Array)\s*\./, 3],
    [/\b(export|import)\s+(default|const|let|function|\{)/, 3],
    [/\brequire\s*\(/, 2],
    [/\bnew\s+(Promise|Map|Set|Error)\b/, 2],
    [/\.\s*then\s*\(/, 2],
  ],
}

const ORDER: readonly LanguageId[] = ['json', 'html', 'css', 'java', 'cpp', 'c', 'python', 'javascript']

/** Returns the best guess, or null when nothing clears the bar. */
export function detect(source: string): Detection | null {
  const trimmed = source.trim()
  if (trimmed.length === 0) return null

  if (isJson(trimmed)) {
    return { id: 'json', score: Number.POSITIVE_INFINITY, margin: Number.POSITIVE_INFINITY }
  }

  const scores = new Map<LanguageId, number>()
  for (const id of ORDER) {
    let total = 0
    for (const [pattern, weight] of SIGNALS[id]) {
      if (pattern.test(source)) total += weight
    }
    scores.set(id, total)
  }

  // JSON without a leading brace or bracket is still JSON-ish; do not let the
  // weak `[{"` signal alone promote it over real code.
  scores.set('json', 0)

  let best: LanguageId | null = null
  let bestScore = 0
  let runnerUp = 0

  for (const [id, score] of scores) {
    if (score > bestScore) {
      runnerUp = bestScore
      best = id
      bestScore = score
    } else if (score > runnerUp) {
      runnerUp = score
    }
  }

  if (best === null || bestScore < 3) return null

  return { id: best, score: bestScore, margin: bestScore - runnerUp }
}

function isJson(trimmed: string): boolean {
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}
