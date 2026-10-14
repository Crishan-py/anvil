import { ansiColor, parseAnsi } from '../core/ansi'

export type NoteTone = 'info' | 'warn' | 'error'

export interface TerminalApi {
  clear(): void
  rule(label: string): void
  note(tone: NoteTone, text: string): void
  write(stream: 'stdout' | 'stderr', text: string): void
  echoPrompt(prompt: string, answer: string): void
  /** Everything currently in the scrollback, as plain text. */
  text(): string
}

const BOTTOM_SLACK_PX = 28

/**
 * Program output is written with `textContent` into per-write spans, so a
 * program printing `<script>` prints the characters, not a tag.
 */
export function createTerminal(root: HTMLElement): TerminalApi {
  /**
   * Follows new output only while the reader is already at the bottom, so
   * scrolling back through a long run is not yanked away by the next line.
   */
  const append = (node: Node): void => {
    const wasAtBottom = root.scrollHeight - root.scrollTop - root.clientHeight <= BOTTOM_SLACK_PX
    root.appendChild(node)
    if (wasAtBottom) root.scrollTop = root.scrollHeight
  }

  const appendAnsi = (text: string, className: string): void => {
    const block = document.createElement('span')
    block.className = className

    for (const span of parseAnsi(text)) {
      const piece = document.createElement('span')
      piece.textContent = span.text
      if (span.fg !== null) piece.style.color = ansiColor(span.fg)
      if (span.bg !== null) piece.style.backgroundColor = ansiColor(span.bg)
      if (span.bold) piece.style.fontWeight = '700'
      if (span.dim) piece.style.opacity = '0.6'
      if (span.italic) piece.style.fontStyle = 'italic'
      if (span.underline) piece.style.textDecoration = 'underline'
      block.appendChild(piece)
    }

    append(block)
  }

  return {
    clear(): void {
      root.replaceChildren()
    },

    rule(label: string): void {
      const row = document.createElement('div')
      row.className = 'rule'
      const text = document.createElement('span')
      text.textContent = label
      row.appendChild(text)
      append(row)
    },

    note(tone: NoteTone, text: string): void {
      const row = document.createElement('div')
      row.className = `note note-${tone}`
      row.textContent = text
      append(row)
    },

    write(stream: 'stdout' | 'stderr', text: string): void {
      if (text === '') return
      appendAnsi(text, stream === 'stderr' ? 'stream stream-err' : 'stream')
    },

    echoPrompt(prompt: string, answer: string): void {
      const row = document.createElement('div')
      row.className = 'echo'

      const caret = document.createElement('span')
      caret.className = 'echo-caret'
      caret.textContent = '›'

      const label = document.createElement('span')
      label.textContent = prompt

      const reply = document.createElement('span')
      reply.className = 'echo-reply'
      reply.textContent = answer

      row.append(caret, label, reply)
      append(row)
    },

    text(): string {
      return root.textContent ?? ''
    },
  }
}
