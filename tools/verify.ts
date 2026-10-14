import assert from 'node:assert/strict'

import { ansiColor, parseAnsi } from '../src/core/ansi'
import { describeValue } from '../src/ui/jsonTree'
import { createConsoleBridge, describeError, formatArgs, formatValue } from '../src/core/console'
import { detect, MIN_MARGIN } from '../src/core/detect'
import { isLanguageId, language, LANGUAGES } from '../src/core/registry'
import { isCompileFailure, JUDGE0_ENDPOINT, runJudge0, type Judge0Outcome } from '../src/core/judge0'
import { wrapJava } from '../src/core/javaWrap'
import { decodePayload, encodePayload, terminalUrl } from '../src/core/payload'
import { createAutosave, loadDocument, saveDocument, type StorageLike } from '../src/core/storage'
import { SAMPLE_BODY, buildCssDocument } from '../src/ui/preview'

const ESC = '\u001b'
const BEL = '\u0007'

/* ------------------------------------------------------------------ harness */

class Skip extends Error {}

const passed: string[] = []
const failed: { name: string; error: string }[] = []
const skipped: string[] = []
let group = ''

function heading(title: string): void {
  group = title
}

async function test(name: string, body: () => void | Promise<void>): Promise<void> {
  const label = `${group} › ${name}`
  try {
    await body()
    passed.push(label)
  } catch (error) {
    if (error instanceof Skip) {
      skipped.push(label)
      return
    }
    failed.push({
      name: label,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
  }
}

function textOf(spans: { text: string }[]): string {
  return spans.map((span) => span.text).join('')
}

/* --------------------------------------------------------------------- ansi */

heading('ansi')

await test('plain text is one span', () => {
  const spans = parseAnsi('hello')
  assert.equal(spans.length, 1)
  assert.equal(spans[0]?.text, 'hello')
  assert.equal(spans[0]?.fg, null)
})

await test('newline becomes its own span so pre-wrap can do the work', () => {
  const spans = parseAnsi('a\nb')
  assert.deepEqual(
    spans.map((s) => s.text),
    ['a', '\n', 'b'],
  )
})

await test('SGR foreground applies and resets', () => {
  const spans = parseAnsi(`${ESC}[31mred${ESC}[0mplain`)
  assert.equal(spans[0]?.fg, 1)
  assert.equal(spans[0]?.text, 'red')
  assert.equal(spans[1]?.fg, null)
  assert.equal(spans[1]?.text, 'plain')
})

await test('a style change closes off the text before it', () => {
  const spans = parseAnsi(`a${ESC}[31mb${ESC}[0mc`)
  assert.deepEqual(
    spans.map((s) => s.text),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    spans.map((s) => s.fg),
    [null, 1, null],
  )
})

await test('bold and dim set independently, 22 clears both', () => {
  const spans = parseAnsi(`${ESC}[1;2mx${ESC}[22my`)
  assert.equal(spans[0]?.bold, true)
  assert.equal(spans[0]?.dim, true)
  assert.equal(spans[1]?.bold, false)
  assert.equal(spans[1]?.dim, false)
})

await test('256-colour foreground is indexed', () => {
  assert.equal(parseAnsi(`${ESC}[38;5;196mx`)[0]?.fg, 196)
})

await test('truecolour collapses onto the indexed palette', () => {
  assert.equal(parseAnsi(`${ESC}[38;2;255;0;0mx`)[0]?.fg, 255)
})

await test('style survives a newline, as a real terminal does', () => {
  const spans = parseAnsi(`${ESC}[32ma\nb`)
  assert.equal(spans[0]?.fg, 2)
  assert.equal(spans[2]?.fg, 2)
})

await test('carriage return discards the line it rewrote', () => {
  assert.equal(textOf(parseAnsi('50%\r100%')), '100%')
  assert.equal(textOf(parseAnsi('a\rb\nc')), 'b\nc')
  assert.equal(textOf(parseAnsi(`${ESC}[32mold\rnew${ESC}[0m`)), 'new')
})

await test('OSC hyperlinks are stripped, the label survives', () => {
  assert.equal(textOf(parseAnsi(`${ESC}]8;;https://x.dev${BEL}link${ESC}]8;;${BEL}`)), 'link')
})

await test('tabs advance to eight-column stops', () => {
  assert.equal(textOf(parseAnsi('a\tb')), 'a       b')
  assert.equal(textOf(parseAnsi('abcdefg\th')), 'abcdefg h')
})

await test('cursor-movement sequences leave no trace', () => {
  assert.equal(textOf(parseAnsi(`${ESC}[2K${ESC}[1Gdone`)), 'done')
})

await test('stray control bytes are dropped', () => {
  assert.equal(textOf(parseAnsi(`a${BEL}b`)), 'ab')
})

await test('ansiColor covers the base palette, the cube and the greys', () => {
  assert.equal(ansiColor(0), '#2b2721')
  assert.equal(ansiColor(15), '#eae3d6')
  assert.equal(ansiColor(196), '#ff0000')
  assert.equal(ansiColor(46), '#00ff00')
  assert.equal(ansiColor(255), '#eeeeee')
})



await test('ansiColor clamps nonsense indices instead of returning invalid css', () => {
  for (const bad of [-5, 999, Number.NaN]) {
    assert.match(ansiColor(bad), /^#[0-9a-f]{6}$/)
  }
})

/* ------------------------------------------------------------------ console */

heading('console')

await test('a bare string is not quoted', () => {
  assert.equal(formatValue('hi'), 'hi')
  assert.equal(formatValue(['hi']), '[ "hi" ]')
})

await test('primitives print as themselves', () => {
  assert.equal(formatValue(null), 'null')
  assert.equal(formatValue(undefined), 'undefined')
  assert.equal(formatValue(true), 'true')
  assert.equal(formatValue(42), '42')
  assert.equal(formatValue(10n), '10n')
  assert.equal(formatValue(Symbol('s')), 'Symbol(s)')
})

await test('negative zero does not print as 0', () => {
  assert.equal(formatValue(-0), '-0')
})

await test('functions name themselves', () => {
  assert.equal(formatValue(function named() {}), '[Function: named]')
  assert.equal(
    formatValue(function () {}),
    '[Function (anonymous)]',
  )
})

await test('errors show name, message and a stack without repeating the head', () => {
  const error = new TypeError('bad thing')
  const rendered = describeError(error)
  assert.match(rendered, /^TypeError: bad thing/)
  const headCount = rendered.split('TypeError: bad thing').length - 1
  assert.equal(headCount, 1)
})

await test('a non-Error throw still renders', () => {
  assert.equal(describeError('plain'), 'plain')
})

await test('nested structures render recursively', () => {
  assert.equal(formatValue({ a: [1, { b: 'c' }] }), '{ a: [ 1, { b: "c" } ] }')
  assert.equal(formatValue({}), '{}')
  assert.equal(formatValue([]), '[]')
})

await test('class instances keep their constructor name', () => {
  class Point {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  assert.equal(formatValue(new Point(1, 2)), 'Point { x: 1, y: 2 }')
})

await test('cycles terminate as [Circular]', () => {
  const loop: Record<string, unknown> = { name: 'loop' }
  loop.self = loop
  assert.equal(formatValue(loop), '{ name: "loop", self: [Circular] }')
})

await test('deep nesting stops rather than blowing the stack', () => {
  let deep: unknown = 'leaf'
  for (let i = 0; i < 12; i++) deep = { deep }
  assert.match(formatValue(deep), /\[Object\]/)
})

await test('Map and Set render their contents', () => {
  assert.equal(formatValue(new Map([['k', 1]])), 'Map(1) { "k" => 1 }')
  assert.equal(formatValue(new Set([1, 2])), 'Set(2) { 1, 2 }')
  assert.equal(formatValue(new Map()), 'Map(0) {}')
  assert.equal(formatValue(new Set()), 'Set(0) {}')
})

await test('dates render as ISO, regexes as source', () => {
  assert.equal(formatValue(new Date(0)), '1970-01-01T00:00:00.000Z')
  assert.equal(formatValue(/ab+c/gi), '/ab+c/gi')
})

await test('typed arrays report their type and contents', () => {
  assert.equal(formatValue(new Uint8Array([1, 2, 3])), 'Uint8Array(3) [ 1, 2, 3 ]')
})

await test('arguments are joined with a space', () => {
  assert.equal(formatArgs(['a', 1, true]), 'a 1 true')
})

await test('the bridge posts every console method on the right stream', () => {
  const messages: { stream?: string; text?: string }[] = []
  const bridge = createConsoleBridge(
    (message) => {
      if (message.kind === 'output') messages.push({ stream: message.stream, text: message.text })
    },
    { log: () => {}, info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, trace: () => {} } as unknown as Console,
  )

  bridge.console.log('one')
  bridge.console.warn('two')
  bridge.console.error('three')

  assert.deepEqual(messages, [
    { stream: 'stdout', text: 'one\n' },
    { stream: 'stderr', text: 'two\n' },
    { stream: 'stderr', text: 'three\n' },
  ])
})

await test('a prompt is answered by token, and only once', async () => {
  const prompts: { token: string; text: string }[] = []
  const bridge = createConsoleBridge(
    (message) => {
      if (message.kind === 'prompt') prompts.push({ token: message.token, text: message.text })
    },
    { log: () => {}, info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, trace: () => {} } as unknown as Console,
  )

  const answer = bridge.ask('name?', 'world')
  assert.equal(prompts.length, 1)
  assert.equal(bridge.awaitingInput(), true)

  const token = prompts[0]?.token ?? ''
  bridge.resolvePrompt(token, 'suzy')
  assert.equal(await answer, 'suzy')
  assert.equal(bridge.awaitingInput(), false)

  bridge.resolvePrompt(token, 'too late')
  assert.equal(bridge.awaitingInput(), false)
})

/* ------------------------------------------------------------------ javawrap */

heading('java wrap')

await test('bare statements are wrapped in class Main', () => {
  const result = wrapJava('System.out.println("hi");')
  assert.equal(result.wrapped, true)
  assert.match(result.code, /public class Main \{/)
  assert.match(result.code, /public static void main\(String\[\] args\)/)
  assert.match(result.code, /System\.out\.println\("hi"\);/)
})

await test('imports are hoisted above the class, where javac requires them', () => {
  const result = wrapJava('import java.util.Scanner;\n\nScanner s = new Scanner(System.in);')
  assert.ok(result.code.startsWith('import java.util.Scanner;'))
  assert.ok(result.code.indexOf('import') < result.code.indexOf('public class Main'))
  assert.ok(result.code.indexOf('Scanner s = new Scanner') > result.code.indexOf('public class Main'))
})

await test('a source that already declares Main is left alone', () => {
  const source = 'public class Main { public static void main(String[] a) {} }'
  const result = wrapJava(source)
  assert.equal(result.wrapped, false)
  assert.equal(result.code, source)
})

await test('every kind of Main declaration is recognised', () => {
  for (const declaration of ['class Main', 'public final class Main', 'record Main', 'interface Main', 'enum Main']) {
    assert.equal(wrapJava(declaration).wrapped, false, declaration)
  }
})

await test('a class merely named Mainish is still wrapped', () => {
  assert.equal(wrapJava('class Mainish {}').wrapped, true)
})

await test('a comment mentioning class Main does not disable the wrapper', () => {
  const source = '// anvil wraps bare statements in "public class Main" before compiling.\nSystem.out.println(1);'
  const result = wrapJava(source)
  assert.equal(result.wrapped, true)
  assert.match(result.code, /public class Main \{/)
  assert.match(result.code, /\/\/ anvil wraps bare statements/)
})

await test('a string mentioning Main does not disable the wrapper either', () => {
  const result = wrapJava('String s = "class Main {";')
  assert.equal(result.wrapped, true)
})

await test('a comment cannot smuggle in a fake import', () => {
  const result = wrapJava('// import java.util.Scanner;\nSystem.out.println(1);')
  assert.equal(result.wrapped, true)
  assert.ok(
    result.code.indexOf('// import') > result.code.indexOf('public class Main'),
    'a commented-out import stays in the body, where it was written',
  )
  assert.equal(result.code.startsWith('import'), false)
})

await test('comments and literals keep their line positions', () => {
  const result = wrapJava('/* one\n   two */\nint a = 1;\nint b = 2;')
  assert.match(result.code, /\n {4}int a = 1;/)
  assert.match(result.code, /\n {4}int b = 2;/)
})

await test('a slash inside a string is not mistaken for a comment', () => {
  const result = wrapJava('String s = "http://example.com";')
  assert.match(result.code, /"http:\/\/example\.com"/)
  assert.equal(result.wrapped, true)
})

await test('wrapped bodies are indented', () => {
  assert.match(wrapJava('int a = 1;').code, /\n {4}int a = 1;/)
})

/* ------------------------------------------------------------------ storage */

heading('storage')

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

await test('a document round-trips', () => {
  const storage = fakeStorage()
  assert.equal(saveDocument(storage, { source: 'print(1)', language: 'python' }), true)

  const loaded = loadDocument(storage)
  assert.equal(loaded.source, 'print(1)')
  assert.equal(loaded.language, 'python')
})

await test('an absent document is simply absent', () => {
  assert.deepEqual(loadDocument(fakeStorage()), {})
  assert.deepEqual(loadDocument(null), {})
})

await test('corrupt json yields no document, not a crash', () => {
  const storage = fakeStorage({ 'anvil.document.v1': '{not json' })
  assert.deepEqual(loadDocument(storage), {})
})

await test('a non-object payload is rejected', () => {
  const storage = fakeStorage({ 'anvil.document.v1': '"a string"' })
  assert.deepEqual(loadDocument(storage), {})
})

await test('a source that is not a string is dropped', () => {
  const storage = fakeStorage({ 'anvil.document.v1': JSON.stringify({ source: 42, language: 'cobol' }) })
  assert.equal(loadDocument(storage).source, undefined)
  assert.equal(loadDocument(storage).language, null)
})

await test('a full quota is reported, not thrown', () => {
  const storage: StorageLike = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  assert.equal(saveDocument(storage, { source: 'x', language: null }), false)
})

await test('a storage that throws on read is survivable', () => {
  const storage: StorageLike = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {},
  }
  assert.deepEqual(loadDocument(storage), {})
})

await test('autosave debounces but flush persists at once', async () => {
  const storage = fakeStorage()
  const autosave = createAutosave(storage, 10_000)

  autosave.schedule({ source: 'print(1)', language: 'python' })
  assert.equal(storage.map.size, 0, 'nothing written before the debounce elapses')

  assert.equal(autosave.flush(), true)
  assert.equal(loadDocument(storage).source, 'print(1)')
})

await test('flushing with nothing pending succeeds', () => {
  assert.equal(createAutosave(fakeStorage()).flush(), true)
})

/* ----------------------------------------------------------------- registry */

heading('registry')

await test('eight languages, no more, no less', () => {
  assert.equal(LANGUAGES.length, 8)
})

await test('every remote language has a Judge0 runtime, and no other does', () => {
  for (const def of LANGUAGES) {
    if (def.engine === 'remote') {
      assert.equal(typeof def.judge0LanguageId, 'number', `${def.id} needs a runtime id`)
    } else {
      assert.equal(def.judge0LanguageId, null, `${def.id} should not claim a remote runtime`)
    }
  }
})

await test('runtime ids are the verified Judge0 CE values', () => {
  const expected: Record<string, number> = { python: 109, c: 103, cpp: 105, java: 91 }
  for (const [id, languageId] of Object.entries(expected)) {
    assert.equal(language(id as never).judge0LanguageId, languageId, id)
  }
})

await test('file names carry the right extension', () => {
  const expected: Record<string, string> = {
    html: '.html',
    css: '.css',
    javascript: '.js',
    json: '.json',
    python: '.py',
    c: '.c',
    cpp: '.cpp',
    java: '.java',
  }
  for (const [id, extension] of Object.entries(expected)) {
    assert.ok(language(id as never).fileName.endsWith(extension), `${id} should end in ${extension}`)
  }
})

await test('starter code exists for every language', () => {
  for (const def of LANGUAGES) {
    assert.ok(def.starter.trim().length > 40, `${def.id} starter is empty`)
  }
})

await test('indentation is four for curly-brace and colon languages, two elsewhere', () => {
  for (const def of LANGUAGES) {
    const expected = ['python', 'c', 'cpp', 'java'].includes(def.id) ? 4 : 2
    assert.equal(def.indentUnit, expected, def.id)
  }
})

await test('every engine label names a real toolchain', () => {
  for (const def of LANGUAGES) {
    assert.ok(def.engineLabel.length > 5, `${def.id} has no engine label`)
  }
})

await test('isLanguageId rejects anything not in the registry', () => {
  assert.equal(isLanguageId('python'), true)
  assert.equal(isLanguageId('cobol'), false)
  assert.equal(isLanguageId(42), false)
  assert.equal(isLanguageId(null), false)
})

/* ----------------------------------------------------------------- detection */

heading('detection')

await test('every starter is recognised as its own language', () => {
  for (const def of LANGUAGES) {
    const found = detect(def.starter)
    assert.ok(found !== null, `${def.id} starter detected nothing`)
    assert.equal(found.id, def.id, `${def.id} starter detected as ${found.id}`)
  }
})

await test('an empty buffer and plain prose detect nothing', () => {
  assert.equal(detect(''), null)
  assert.equal(detect('   \n\n  '), null)
  assert.equal(detect('hello there, this is just a sentence'), null)
})

await test('C and C++ are told apart by their includes, not their first hit', () => {
  const c = '#include <stdio.h>\nint main(void){ printf("hi"); return 0; }'
  const cpp = '#include <iostream>\nint main(){ std::cout << "hi" << std::endl; }'
  assert.equal(detect(c)?.id, 'c')
  assert.equal(detect(cpp)?.id, 'cpp')
})

await test('C++ that prints with printf is still C++', () => {
  const source = '#include <iostream>\n#include <stdio.h>\nint main(){ printf("x"); std::cout << "y"; }'
  assert.equal(detect(source)?.id, 'cpp')
})

await test('Python beats JavaScript when both words are present', () => {
  const source = 'import sys\n\ndef main():\n    print("hi")\n\nmain()'
  assert.equal(detect(source)?.id, 'python')
})

await test('a print() call alone is not enough to outrank a full JS file', () => {
  const source = 'const list = [1, 2, 3]\nconsole.log(list.map((n) => n * 2))\nawait fetch("/x")'
  assert.equal(detect(source)?.id, 'javascript')
})

await test('markup wins over prose that merely mentions angle brackets', () => {
  const html = '<!doctype html>\n<html><body><div class="a"><p>hi</p></div></body></html>'
  assert.equal(detect(html)?.id, 'html')
})

await test('a stylesheet is not mistaken for a block of prose', () => {
  const css = 'body {\n  color: #333;\n  margin: 0;\n}\n.card { display: flex; gap: 8px; }'
  assert.equal(detect(css)?.id, 'css')
})

await test('valid JSON is JSON, however it is shaped', () => {
  assert.equal(detect('{"a": 1}')?.id, 'json')
  assert.equal(detect('[1, 2, 3]')?.id, 'json')
  assert.equal(detect('  \n {"a": {"b": [1]}}  ')?.id, 'json')
})

await test('broken JSON is not claimed as JSON', () => {
  assert.notEqual(detect('{"a": 1,}')?.id, 'json')
})

await test('a Java file with a Main class is Java, wrapper or not', () => {
  const wrapped = 'import java.util.Scanner;\nScanner s = new Scanner(System.in);\nSystem.out.println(s);'
  const full = 'public class Main {\n  public static void main(String[] a) {\n    System.out.println("x");\n  }\n}'
  assert.equal(detect(wrapped)?.id, 'java')
  assert.equal(detect(full)?.id, 'java')
})

await test('a confident winner clears the margin the editor requires', () => {
  for (const def of LANGUAGES) {
    const found = detect(def.starter)
    assert.ok(found !== null && found.margin >= MIN_MARGIN, `${def.id} margin ${found?.margin}`)
  }
})

await test('every prompt() call in a starter is awaited', () => {
  const starter = language('javascript').starter
  const calls = starter
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('//') && /[^.\w]prompt\(/.test(line))

  assert.ok(calls.length > 0, 'the starter should demonstrate prompt()')
  for (const line of calls) {
    assert.match(line, /\bawait\s+prompt\(/, `unawaited prompt: ${line}`)
  }
})

await test('the HTML starter is a complete, self-styled document', () => {
  const starter = language('html').starter
  assert.match(starter, /<style>/)
  assert.match(starter, /<button/)
  assert.match(starter, /onclick=/)
})

await test('every tag the CSS starter styles exists in the preview sample', () => {
  const css = language('css').starter
  const tags = new Set<string>()

  // `[^{}]+` cannot span a closing brace, so each match is a selector list
  // rather than the tail of the previous block's declarations.
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    for (const selector of (match[1] ?? '').split(',')) {
      const cleaned = selector.trim().split(/[\s>+~]/).pop() ?? ''
      const tag = cleaned.match(/^[a-z][a-z0-9]*/i)?.[0]
      // `body` and `html` come from the document shell, not the sample markup.
      if (tag && tag !== 'body' && tag !== 'html') tags.add(tag.toLowerCase())
    }
  }

  assert.ok(tags.size >= 6, `only found ${tags.size} tag selectors`)
  for (const tag of tags) {
    assert.match(SAMPLE_BODY, new RegExp(`<${tag}[\\s>]`), `preview sample has no <${tag}>`)
  }
})

/* ------------------------------------------------------------------- preview */

heading('preview')

await test('a stylesheet cannot close its own style element', () => {
  const document = buildCssDocument('a{} </style><script>alert(1)</script>')
  assert.equal(document.includes('</style><script>'), false)
  assert.ok(document.includes('<\\/script>'))
})

await test('a stylesheet is still valid css after the escape', () => {
  assert.ok(buildCssDocument('a::after { content: "</x>" }').includes('\\/'))
})

await test('the CSS preview document wraps the sample page', () => {
  const document = buildCssDocument('body { color: red }')
  assert.match(document, /^<!doctype html>/)
  assert.ok(document.includes('<style>'))
  assert.ok(document.includes('The quick brown fox'))
})

/* ------------------------------------------------------------------- payload */

heading('terminal payload')

await test('a payload survives the round trip through a URL fragment', () => {
  const payload = { language: 'python' as const, source: 'print("hi")\n# a # hash\n? query', stdin: 'suzy\n' }
  const encoded = encodePayload(payload)

  assert.doesNotMatch(encoded, /[+/=]/, 'must be url-safe base64')
  assert.deepEqual(decodePayload(`#${encoded}`), payload)
})

await test('non-ascii source survives the round trip', () => {
  const payload = { language: 'python' as const, source: 'print("héllo — 世界 🎉")', stdin: '' }
  assert.deepEqual(decodePayload(encodePayload(payload)), payload)
})

await test('every language starter survives the round trip', () => {
  for (const def of LANGUAGES) {
    const payload = { language: def.id, source: def.starter, stdin: '' }
    assert.deepEqual(decodePayload(encodePayload(payload)), payload, def.id)
  }
})

await test('a corrupt fragment decodes to null rather than throwing', () => {
  assert.equal(decodePayload(''), null)
  assert.equal(decodePayload('#'), null)
  assert.equal(decodePayload('#!!!not base64!!!'), null)
  const fragment = (json: string): string => `#${btoa(json)}`
  assert.equal(decodePayload(fragment('{"language":"c"}')), null, 'missing source')
  assert.equal(decodePayload(fragment('{"source":"x"}')), null, 'missing language')
})

await test('the terminal url is a real path under the origin, not a new host', () => {
  const payload = { language: 'c' as const, source: 'int main(){}', stdin: '' }

  const fromOrigin = terminalUrl(payload, 'http://localhost:5183')
  assert.ok(fromOrigin.startsWith('http://localhost:5183/terminal.html#'), fromOrigin)
  assert.equal(new URL(fromOrigin).hostname, 'localhost')
  assert.equal(new URL(fromOrigin).port, '5183')
  assert.equal(new URL(fromOrigin).pathname, '/terminal.html')

  assert.equal(
    terminalUrl(payload, 'http://localhost:5183/'),
    fromOrigin,
    'a trailing slash on the base must not change the result',
  )
  assert.deepEqual(decodePayload(new URL(fromOrigin).hash), payload)
})

/* ------------------------------------------------------------- judge0 shapes */

heading('judge0 outcomes')

function outcome(partial: Partial<Judge0Outcome>): Judge0Outcome {
  return {
    stdout: '',
    stderr: '',
    compileOutput: '',
    exitCode: null,
    message: null,
    timeSeconds: null,
    memoryKb: null,
    statusId: null,
    statusDescription: null,
    ...partial,
  }
}

await test('a compile diagnostic counts as a compile failure', () => {
  assert.equal(isCompileFailure(outcome({ compileOutput: 'error: expected ;' })), true)
  assert.equal(isCompileFailure(outcome({ statusId: 6 })), true)
  assert.equal(isCompileFailure(outcome({ statusId: 3, exitCode: 0, stdout: 'ok' })), false)
})

/* ------------------------------------------------------------------- json tree */

heading('json tree')

await test('describeValue summarises each shape', () => {
  assert.equal(describeValue([1, 2, 3]), 'array · 3 items')
  assert.equal(describeValue({ a: 1 }), 'object · 1 keys')
  assert.equal(describeValue('x'), 'string')
  assert.equal(describeValue(null), 'null')
})

/* -------------------------------------------------------------------- network */

async function online(): Promise<void> {
  try {
    const response = await fetch(`${JUDGE0_ENDPOINT}/languages`, { signal: AbortSignal.timeout(10_000) })
    if (response.ok) return
  } catch {
    // fall through
  }
  throw new Skip('Judge0 unreachable')
}

heading('live compilation')

await test('python starter compiles and runs', async () => {
  await online()
  const result = await runJudge0({
    languageId: 109,
    source: language('python').starter,
    stdin: 'suzy\n',
  })
  assert.equal(result.statusId, 3, result.compileOutput || result.stderr || (result.message ?? ''))
  assert.match(result.stdout, /Hello, suzy/)
  assert.equal(result.exitCode, 0)
})

await test('c starter compiles and runs', async () => {
  await online()
  const result = await runJudge0({
    languageId: 103,
    source: language('c').starter,
    stdin: 'suzy\n',
  })
  assert.equal(result.statusId, 3, result.compileOutput || result.stderr)
  assert.match(result.stdout, /Hello, suzy/)
})

await test('c++ starter compiles and runs', async () => {
  await online()
  const result = await runJudge0({
    languageId: 105,
    source: language('cpp').starter,
    stdin: 'suzy\n',
  })
  assert.equal(result.statusId, 3, result.compileOutput || result.stderr)
  assert.match(result.stdout, /Hello, suzy/)
})

await test('java starter compiles once the wrapper is applied', async () => {
  await online()
  const wrap = wrapJava(language('java').starter)
  assert.equal(wrap.wrapped, true)

  const result = await runJudge0({ languageId: 91, source: wrap.code, stdin: 'suzy\n' })
  assert.equal(result.statusId, 3, result.compileOutput || result.stderr)
  assert.match(result.stdout, /Hello, suzy/)
})

await test('a syntax error surfaces the compiler diagnostic', async () => {
  await online()
  const result = await runJudge0({ languageId: 103, source: 'int main(){ return }' })
  assert.equal(result.statusId, 6)
  assert.match(result.compileOutput, /error/)
  assert.equal(isCompileFailure(result), true)
})

await test('a non-zero exit code is reported, not swallowed', async () => {
  await online()
  const result = await runJudge0({
    languageId: 109,
    source: 'import sys\nprint("before")\nsys.exit(3)',
  })
  assert.equal(result.exitCode, 3)
  assert.match(result.stdout, /before/)
  assert.ok(result.message !== null)
})

await test('stderr is kept apart from stdout', async () => {
  await online()
  const result = await runJudge0({
    languageId: 109,
    source: 'import sys\nprint("out")\nprint("err", file=sys.stderr)',
  })
  assert.match(result.stdout, /out/)
  assert.doesNotMatch(result.stdout, /err/)
  assert.match(result.stderr, /err/)
})

await test('the remote run reports its own cpu time', async () => {
  await online()
  const result = await runJudge0({ languageId: 109, source: 'print(1)' })
  assert.equal(typeof result.timeSeconds, 'number')
  assert.ok((result.timeSeconds ?? 0) > 0)
})

await test('a slow caller can abort a run', async () => {
  await online()
  const controller = new AbortController()
  const pending = runJudge0({
    languageId: 109,
    source: 'while True: pass',
    signal: controller.signal,
    timeoutMs: 25_000,
  })
  setTimeout(() => controller.abort(), 400)

  await assert.rejects(pending, /cancelled/i)
})

/* -------------------------------------------------------------------- report */

const total = passed.length + failed.length + skipped.length
console.log('')
for (const name of passed) console.log(`  pass  ${name}`)
for (const name of skipped) console.log(`  skip  ${name}`)
for (const failure of failed) {
  console.log(`  FAIL  ${failure.name}`)
  console.log(
    failure.error
      .split('\n')
      .slice(0, 6)
      .map((line) => `          ${line}`)
      .join('\n'),
  )
}
console.log('')
console.log(`${passed.length}/${total} checks passed, ${failed.length} failed, ${skipped.length} skipped`)
process.exit(failed.length === 0 ? 0 : 1)
