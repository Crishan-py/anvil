import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

import type { LanguageDef } from '../core/registry'

/** Muted pencil colours on warm paper, rather than neon on black. */
const paperHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#9a9184', fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: '#7c4a8c' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#4a7043' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#8f6a17' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#2f5d8a' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: '#a05a2c' },
  { tag: [t.propertyName, t.attributeName], color: '#6b4a8c' },
  { tag: [t.tagName], color: '#a63d2f' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.paren, t.squareBracket], color: '#6b6459' },
  { tag: [t.variableName, t.labelName], color: '#23201b' },
  { tag: [t.meta, t.processingInstruction, t.docComment], color: '#9a9184' },
  { tag: [t.heading], color: '#2f5d8a', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: '#2f5d8a', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.invalid], color: '#a63d2f' },
])

const paperTheme = EditorView.theme(
  {
    '&': { color: '#23201b', backgroundColor: '#fbf8f2', height: '100%', fontSize: '13.5px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.65',
    },
    '.cm-content': { caretColor: '#23201b', padding: '10px 0 40vh' },
    '.cm-line': { padding: '0 14px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#23201b', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#e6dccb',
    },
    '.cm-gutters': {
      backgroundColor: '#f6f2ea',
      color: '#a89f90',
      border: 'none',
      borderRight: '1px solid #e7dfd1',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '38px' },
    '.cm-activeLineGutter': { backgroundColor: '#efe9df', color: '#6b6459' },
    '.cm-activeLine': { backgroundColor: '#f4efe6' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#efe9df',
      border: 'none',
      borderRadius: '3px',
      color: '#6b6459',
      padding: '0 6px',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: '#dfe9f2',
      outline: '1px solid #b9cfe0',
      borderRadius: '2px',
    },
    '.cm-nonmatchingBracket': { backgroundColor: '#f3dedb', outline: '1px solid #d9a9a1' },
    '.cm-panels': { backgroundColor: '#efe9df', color: '#23201b', border: 'none' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #ded5c6' },
    '.cm-searchMatch': { backgroundColor: '#f0e3bd', outline: '1px solid #dcc98a' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e6d3a0' },
    '.cm-tooltip': {
      border: '1px solid #ded5c6',
      backgroundColor: '#fffdf9',
      borderRadius: '6px',
      boxShadow: '0 6px 20px rgba(60, 48, 30, 0.12)',
    },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#2f5d8a',
      color: '#fffdf9',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy #a63d2f',
      textDecorationSkipInk: 'none',
    },
    '.cm-lint-marker-error': { content: '"\\25CF"', color: '#a63d2f' },
  },
  { dark: false },
)

function languageExtension(def: LanguageDef): Extension {
  switch (def.id) {
    case 'html':
      return html({ matchClosingTags: true, autoCloseTags: true })
    case 'css':
      return css()
    case 'javascript':
      return javascript()
    case 'json':
      return json()
    case 'python':
      return python()
    // The C dialect reuses the C++ grammar: there is no separate C mode in the
    // package, and the C grammar is a superset that parses C correctly.
    case 'c':
    case 'cpp':
      return cpp()
    case 'java':
      return java()
  }
}

export interface EditorCallbacks {
  onChange(value: string): void
  onRun(): void
  onSave(): void
}

export type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string; readonly line: number; readonly column: number }

export interface EditorApi {
  readonly view: EditorView
  getValue(): string
  setValue(next: string): void
  applyLanguage(def: LanguageDef): void
  /**
   * Parses with `JSON.parse` rather than trusting the linter: the linter drives
   * the squiggles, this drives what the app believes, and they must not be
   * allowed to disagree quietly.
   */
  parseJson(): JsonParseResult
  focus(): void
}

export function createEditor(
  parent: HTMLElement,
  def: LanguageDef,
  value: string,
  callbacks: EditorCallbacks,
): EditorApi {
  const languageSlot = new Compartment()
  const indentSlot = new Compartment()
  const lintSlot = new Compartment()

  const state = EditorState.create({
    doc: value,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, icons: false }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(paperHighlight),
      paperTheme,
      EditorView.lineWrapping,
      languageSlot.of(languageExtension(def)),
      indentSlot.of(indentUnit.of(' '.repeat(def.indentUnit))),
      lintSlot.of(def.id === 'json' ? linter(jsonParseLinter(), { delay: 250 }) : []),
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: () => (callbacks.onRun(), true) },
          { key: 'Mod-s', preventDefault: true, run: () => (callbacks.onSave(), true) },
        ]),
      ),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.onChange(update.state.doc.toString())
      }),
    ],
  })

  const view = new EditorView({ state, parent })

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(next: string): void {
      if (next === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
    },
    applyLanguage(next: LanguageDef): void {
      view.dispatch({
        effects: [
          languageSlot.reconfigure(languageExtension(next)),
          indentSlot.reconfigure(indentUnit.of(' '.repeat(next.indentUnit))),
          lintSlot.reconfigure(next.id === 'json' ? linter(jsonParseLinter(), { delay: 250 }) : []),
        ],
      })
    },
    parseJson(): JsonParseResult {
      const text = view.state.doc.toString()
      try {
        return { ok: true, value: JSON.parse(text) as unknown }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const match = /at position (\d+)/.exec(message)
        const reported = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10)
        const offset = Math.max(0, Math.min(Number.isNaN(reported) ? 0 : reported, text.length))
        const line = view.state.doc.lineAt(offset)
        return { ok: false, message, line: line.number, column: offset - line.from + 1 }
      }
    },
    focus: () => view.focus(),
  }
}
