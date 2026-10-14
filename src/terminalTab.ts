/**
 * The standalone terminal.
 *
 * Opened as its own tab with the program in the URL fragment. It reuses the
 * runner and the console renderer rather than reimplementing either, so what
 * you read here is exactly what the panel below the editor would have shown.
 */

import './style.css'

import { decodePayload, type TerminalPayload } from './core/payload'
import { language } from './core/registry'
import { startRun } from './core/runner'
import type { RunHandle } from './core/types'
import { describeValue } from './ui/jsonTree'
import { createTerminal } from './ui/terminal'

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`terminal.html is missing #${id}`)
  return element as T
}

const languageChip = must<HTMLElement>('tLanguage')
const engineChip = must<HTMLElement>('tEngine')
const sourceButton = must<HTMLButtonElement>('tSource')
const sourcePane = must<HTMLElement>('tSourcePane')
const rerunButton = must<HTMLButtonElement>('tRerun')
const stdinForm = must<HTMLFormElement>('stdinForm')
const stdinInput = must<HTMLInputElement>('stdin')

const terminal = createTerminal(must('scrollback'))

let payload: TerminalPayload | null = decodePayload(window.location.hash)
let handle: RunHandle | null = null
let pendingPrompt: string | null = null

if (payload === null) {
  languageChip.textContent = 'nothing to run'
  engineChip.textContent = 'the link carried no program'
  terminal.rule('anvil · terminal')
  terminal.note('error', 'This tab was opened without a program. Use Preview › Run in new tab.')
} else {
  const def = language(payload.language)
  languageChip.textContent = def.label
  engineChip.textContent = def.engineLabel
  sourcePane.textContent = payload.source
  document.title = `anvil — ${def.label} terminal`

  if (def.engine === 'preview') {
    rerunButton.hidden = true
    stdinForm.hidden = true
    languageChip.textContent = def.label
    engineChip.textContent = 'markup renders in a browser tab, not a terminal'
    terminal.rule('anvil · terminal')
    terminal.note('info', `${def.label} is rendered, not executed. Preview opens it in a browser tab.`)
  } else {
    run()
  }
}

function run(): void {
  if (payload === null) return
  const def = language(payload.language)

  handle?.cancel()
  handle = null
  pendingPrompt = null
  terminal.clear()
  terminal.rule(`${def.label} · ${new Date().toLocaleTimeString()}`)

  if (def.engine === 'data') {
    reportJson(payload.source)
    rerunButton.hidden = true
    stdinForm.hidden = true
    return
  }

  stdinInput.value = payload.stdin
  rerunButton.hidden = false
  stdinForm.hidden = false

  handle = startRun(
    { language: payload.language, source: payload.source, stdin: payload.stdin },
    (event) => {
      switch (event.kind) {
        case 'note':
          terminal.note(event.tone, event.text)
          return
        case 'output':
          terminal.write(event.stream, event.text)
          return
        case 'awaiting-input':
          pendingPrompt = event.prompt
          terminal.note('info', `waiting for input${event.prompt === '' ? '' : `: ${event.prompt}`}`)
          stdinInput.focus()
          return
        case 'finished': {
          const parts = [`${Math.round(event.durationMs)} ms`]
          if (event.exitCode !== null) parts.push(`exit ${event.exitCode}`)
          if (event.runtimeMs !== null) parts.push(`cpu ${event.runtimeMs.toFixed(0)} ms`)
          engineChip.textContent = parts.join(' · ')
          return
        }
      }
    },
  )
}

function reportJson(source: string): void {
  try {
    const value: unknown = JSON.parse(source)
    const bytes = new TextEncoder().encode(source).length
    terminal.note('info', `Valid JSON — ${describeValue(value)}, ${bytes.toLocaleString()} bytes.`)
    terminal.write('stdout', `${JSON.stringify(value, null, 2)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    terminal.note('error', message)
    const match = /at position (\d+)/.exec(message)
    if (match?.[1] !== undefined) {
      const offset = Math.min(Number.parseInt(match[1], 10), source.length)
      const before = source.slice(0, offset)
      const line = before.split('\n').length
      const column = offset - before.lastIndexOf('\n')
      terminal.note('error', `line ${line}, column ${column}`)
    }
  }
}

rerunButton.addEventListener('click', () => run())

sourceButton.addEventListener('click', () => {
  const showing = sourcePane.hidden
  sourcePane.hidden = !showing
  sourceButton.setAttribute('aria-expanded', String(showing))
})

stdinForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const answer = stdinInput.value

  if (pendingPrompt !== null && handle !== null) {
    terminal.echoPrompt(pendingPrompt, answer)
    handle.sendInput(answer.endsWith('\n') ? answer : `${answer}\n`)
    pendingPrompt = null
    stdinInput.value = ''
  }
})
