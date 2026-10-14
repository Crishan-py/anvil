import './style.css'

import { detect } from './core/detect'
import { terminalUrl } from './core/payload'
import { language } from './core/registry'
import { startRun } from './core/runner'
import { browserStorage, createAutosave, loadDocument } from './core/storage'
import type { LanguageId, RunHandle } from './core/types'
import { createEditor } from './ui/editor'
import { describeValue, renderJsonTree } from './ui/jsonTree'
import { buildDocument, openInNewTab } from './ui/preview'
import { createTerminal } from './ui/terminal'

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`index.html is missing #${id}`)
  return element as T
}

const runButton = must<HTMLButtonElement>('run')
const runMenu = must<HTMLElement>('runMenu')
const engineChip = must<HTMLElement>('engineChip')
const fileChip = must<HTMLElement>('fileChip')
const fileName = must<HTMLElement>('fileName')
const saveChip = must<HTMLElement>('saveChip')
const fmtButton = must<HTMLButtonElement>('fmt')
const resetButton = must<HTMLButtonElement>('reset')
const tabsBar = must<HTMLElement>('tabs')
const statusLabel = must<HTMLElement>('status')
const scrollback = must<HTMLElement>('scrollback')
const stdinForm = must<HTMLFormElement>('stdinForm')
const stdinInput = must<HTMLInputElement>('stdin')
const previewFrame = must<HTMLIFrameElement>('previewFrame')
const previewNote = must<HTMLElement>('previewNote')
const dataBody = must<HTMLElement>('dataBody')
const outputPane = must<HTMLElement>('outputPane')
const splitter = must<HTMLElement>('splitter')
const copyButton = must<HTMLButtonElement>('copy')
const clearButton = must<HTMLButtonElement>('clear')
const reloadButton = must<HTMLButtonElement>('reload')

const editorPane = document.querySelector<HTMLElement>('.editor-pane')
if (editorPane === null) throw new Error('index.html is missing the editor pane')

const storage = browserStorage()
const autosave = createAutosave(storage)
const loaded = loadDocument(storage)
const terminal = createTerminal(scrollback)

/** The language the buffer is currently treated as, independent of detection. */
let current: LanguageId = loaded.language ?? 'html'
let run: RunHandle | null = null
let pendingPrompt: string | null = null
let detectTimer: ReturnType<typeof setTimeout> | null = null
let previewTimer: ReturnType<typeof setTimeout> | null = null
let jsonTimer: ReturnType<typeof setTimeout> | null = null
let outputShown = false

const editor = createEditor(
  must('editor'),
  language(current),
  loaded.source ?? language(current).starter,
  {
    onChange: () => onSourceChanged(),
    onRun: () => onRunPressed(),
    onSave: () => saveNow(),
  },
)

/* ------------------------------------------------------------------ language */

function setLanguage(id: LanguageId): void {
  if (id === current) return
  current = id
  editor.applyLanguage(language(id))
  renderChrome()
}

function onSourceChanged(): void {
  if (detectTimer !== null) clearTimeout(detectTimer)
  detectTimer = setTimeout(() => {
    detectTimer = null
    const found = detect(editor.getValue())
    // Only move when the winner is clear: swapping the grammar mid-word makes
    // the highlighting flicker and loses the indentation unit.
    if (found !== null && found.score >= 3) setLanguage(found.id)
  }, 400)

  const def = language(current)
  if (def.engine === 'preview') schedulePreview()
  if (def.id === 'json') scheduleJsonValidation()

  autosave.schedule({ source: editor.getValue(), language: current })
  saveChip.textContent = 'saving…'
  saveChip.classList.add('is-pending')
}

function saveNow(): void {
  const ok = autosave.flush()
  saveChip.textContent = ok ? 'saved' : 'not saved'
  saveChip.classList.toggle('is-pending', false)
  saveChip.classList.toggle('is-warn', !ok)
}

window.addEventListener('beforeunload', () => {
  autosave.flush()
})

/* -------------------------------------------------------------------- chrome */

function renderChrome(): void {
  const def = language(current)

  engineChip.textContent = def.engineLabel
  fileChip.textContent = `${def.label} · ${def.fileName}`
  fileName.textContent = def.fileName
  fmtButton.hidden = def.id !== 'json'

  const available = new Set<string>(def.tabs)
  for (const button of tabsBar.querySelectorAll<HTMLButtonElement>('.tab')) {
    button.hidden = !available.has(button.dataset.tab ?? '')
  }
  showTab(def.tabs[0] ?? 'console')
}

function showTab(tab: 'console' | 'preview' | 'data'): void {
  for (const button of tabsBar.querySelectorAll<HTMLButtonElement>('.tab')) {
    button.classList.toggle('is-active', button.dataset.tab === tab)
  }
  for (const pane of document.querySelectorAll<HTMLElement>('.tabpane')) {
    pane.hidden = pane.dataset.pane !== tab
  }
}

for (const button of tabsBar.querySelectorAll<HTMLButtonElement>('.tab')) {
  button.addEventListener('click', () => {
    const tab = button.dataset.tab
    if (tab === 'console' || tab === 'preview' || tab === 'data') showTab(tab)
  })
}

/**
 * The output panel and its tabs stay out of the way until there is output to
 * show. Until then the editor has the whole window.
 */
function showOutput(): void {
  if (outputShown) return
  outputShown = true
  outputPane.hidden = false
  splitter.hidden = false
  setEditorHeight(58)
}

function schedulePreview(): void {
  if (previewTimer !== null) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    renderPreview()
  }, 350)
}

function renderPreview(): void {
  const def = language(current)
  if (def.engine !== 'preview') return
  previewFrame.srcdoc = buildDocument(def.id as 'html' | 'css', editor.getValue())
}

function scheduleJsonValidation(): void {
  if (jsonTimer !== null) clearTimeout(jsonTimer)
  jsonTimer = setTimeout(() => {
    jsonTimer = null
    validateJson()
  }, 300)
}

function validateJson(): void {
  const parsed = editor.parseJson()
  dataBody.replaceChildren()

  if (!parsed.ok) {
    terminal.note('error', `line ${parsed.line}, column ${parsed.column}: ${parsed.message}`)
    statusLabel.textContent = 'invalid'
    statusLabel.dataset.tone = 'error'
    return
  }

  const summary = renderJsonTree(dataBody, parsed.value)
  const bytes = new TextEncoder().encode(editor.getValue()).length
  const note = document.createElement('div')
  note.className = 'jt-summary'
  note.textContent = `valid · ${describeValue(parsed.value)} · ${bytes.toLocaleString()} bytes${summary.truncated ? ' · truncated' : ''}`
  dataBody.prepend(note)

  terminal.note('info', `Valid JSON — ${describeValue(parsed.value)}.`)
  statusLabel.textContent = 'valid'
  statusLabel.dataset.tone = 'ok'
}

/* -------------------------------------------------------------- the run button */

/**
 * Markup always opens straight into a new tab — there is nothing to stream and
 * nowhere for it to go. Everything else is a program, so the button offers the
 * two places a program can run.
 */
function onRunPressed(): void {
  if (language(current).engine === 'preview') {
    openRenderTab()
    return
  }
  toggleMenu(runMenu, runButton)
}

function openRenderTab(): void {
  const def = language(current)
  if (def.engine !== 'preview') return

  const opened = openInNewTab(def.id as 'html' | 'css', editor.getValue())
  if (opened === null) {
    showOutput()
    terminal.note('warn', 'The browser blocked the new tab. Allow pop-ups for this site and try again.')
    showTab('console')
  }
}

function runInConsole(): void {
  const def = language(current)

  if (def.engine === 'data') {
    showOutput()
    validateJson()
    showTab('data')
    return
  }
  if (def.engine === 'preview') {
    showOutput()
    showTab('preview')
    renderPreview()
    return
  }

  run?.cancel()
  pendingPrompt = null
  showOutput()
  showTab('console')
  terminal.rule(`${def.label} · ${new Date().toLocaleTimeString()}`)
  runButton.classList.add('is-busy')

  const handle = startRun(
    { language: current, source: editor.getValue(), stdin: stdinInput.value },
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
          terminal.note('info', `Program is waiting for input${event.prompt === '' ? '' : `: ${event.prompt}`}`)
          stdinInput.focus()
          return
        case 'finished': {
          const parts = [`${Math.round(event.durationMs)} ms`]
          if (event.exitCode !== null) parts.push(`exit ${event.exitCode}`)
          if (event.runtimeMs !== null) parts.push(`cpu ${event.runtimeMs.toFixed(0)} ms`)
          statusLabel.textContent = parts.join(' · ')
          statusLabel.dataset.tone = event.ok ? 'ok' : 'error'
          runButton.classList.remove('is-busy')
          return
        }
      }
    },
  )

  run = handle
  void handle.finished.then(() => {
    if (run === handle) run = null
    runButton.classList.remove('is-busy')
  })
}

/** Relative to the current document, so a build served from a sub-path works. */
function terminalBase(): string {
  return new URL('.', window.location.href).href
}

function runInNewTab(): void {
  const url = terminalUrl(
    { language: current, source: editor.getValue(), stdin: stdinInput.value },
    terminalBase(),
  )

  const opened = window.open(url, '_blank', 'noopener')
  if (opened === null) {
    showOutput()
    terminal.note('warn', 'The browser blocked the new tab. Allow pop-ups for this site and try again.')
    showTab('console')
  }
}

/* --------------------------------------------------------------------- menus */

let openMenu: HTMLElement | null = null

function toggleMenu(menu: HTMLElement, anchor: HTMLElement): void {
  if (openMenu === menu) {
    closeMenus()
    return
  }
  closeMenus()
  menu.hidden = false
  anchor.setAttribute('aria-expanded', 'true')
  openMenu = menu
  menu.querySelector<HTMLButtonElement>('.menu-item')?.focus()
}

function closeMenus(): void {
  if (openMenu !== null) openMenu.hidden = true
  openMenu = null
  runButton.setAttribute('aria-expanded', 'false')
}

document.addEventListener('pointerdown', (event) => {
  if (openMenu === null) return
  const target = event.target as Node
  if (openMenu.contains(target) || runButton.contains(target)) return
  closeMenus()
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || openMenu === null) return
  closeMenus()
  runButton.focus()
})

runMenu.addEventListener('click', (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>('.menu-item')
  if (item === null) return
  closeMenus()
  if (item.dataset.action === 'console') runInConsole()
  else runInNewTab()
})

runButton.addEventListener('click', () => onRunPressed())

/* -------------------------------------------------------------------- chrome */

resetButton.addEventListener('click', () => {
  const def = language(current)
  if (!window.confirm(`Replace the buffer with the ${def.label} starter?`)) return
  editor.setValue(def.starter)
  saveNow()
  showOutput()
  terminal.note('info', `Buffer reset to the ${def.label} starter.`)
})

reloadButton.addEventListener('click', () => renderPreview())

fmtButton.addEventListener('click', () => {
  try {
    const pretty = JSON.stringify(JSON.parse(editor.getValue()) as unknown, null, 2)
    editor.setValue(`${pretty}\n`)
    showOutput()
    validateJson()
  } catch (error) {
    showOutput()
    terminal.note('error', `Cannot format: ${error instanceof Error ? error.message : String(error)}`)
  }
})

clearButton.addEventListener('click', () => {
  terminal.clear()
  statusLabel.textContent = ''
  delete statusLabel.dataset.tone
})

copyButton.addEventListener('click', () => {
  const text = terminal.text()
  if (text === '') {
    terminal.note('info', 'Nothing to copy yet.')
    return
  }
  void navigator.clipboard
    .writeText(text)
    .then(() => terminal.note('info', 'Console output copied.'))
    .catch(() => terminal.note('warn', 'The browser refused clipboard access.'))
})

/* --------------------------------------------------------------------- stdin */

stdinForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const answer = stdinInput.value

  if (pendingPrompt !== null && run !== null) {
    terminal.echoPrompt(pendingPrompt, answer)
    run.sendInput(answer.endsWith('\n') ? answer : `${answer}\n`)
    pendingPrompt = null
    stdinInput.value = ''
    return
  }

  statusLabel.textContent = 'stdin ready'
  statusLabel.dataset.tone = 'info'
})

/* ----------------------------------------------------------------- splitter */

const clampEditorHeight = (value: number): number =>
  Math.min(outputShown ? 85 : 100, Math.max(15, value))

const setEditorHeight = (percent: number): void => {
  editorPane.style.height = `${clampEditorHeight(percent)}%`
}

let dragging = false

splitter.addEventListener('pointerdown', (event) => {
  dragging = true
  splitter.setPointerCapture(event.pointerId)
  splitter.classList.add('is-dragging')
})

splitter.addEventListener('pointermove', (event) => {
  if (!dragging) return
  const bounds = splitter.parentElement?.getBoundingClientRect()
  if (!bounds) return
  setEditorHeight(((event.clientY - bounds.top) / bounds.height) * 100)
})

const endDrag = (): void => {
  dragging = false
  splitter.classList.remove('is-dragging')
}

splitter.addEventListener('pointerup', endDrag)
splitter.addEventListener('pointercancel', endDrag)

splitter.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const currentHeight = editorPane.getBoundingClientRect().height
  const total = splitter.parentElement?.getBoundingClientRect().height ?? currentHeight
  setEditorHeight((currentHeight / total) * 100 + (event.key === 'ArrowUp' ? -3 : 3))
})

/* --------------------------------------------------------------------- boot */

function dismissSplash(): void {
  const splash = document.getElementById('splash')
  if (splash === null) return
  // One frame so the browser has painted the splash before it starts fading,
  // otherwise it appears and vanishes in the same tick and reads as a flicker.
  requestAnimationFrame(() => {
    splash.classList.add('is-leaving')
    setTimeout(() => splash.remove(), 320)
  })
}

previewNote.textContent = 'live · renders as you type'
setEditorHeight(100)
// Not `setLanguage(current)`: that short-circuits when the id already matches,
// which on a fresh boot is every time, and the chrome would never be painted.
renderChrome()
dismissSplash()
editor.focus()
