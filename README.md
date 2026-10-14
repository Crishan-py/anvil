# anvil

A compiler that lives in a browser tab. One buffer, language detected as you
type, markup rendered in a new tab, everything else compiled and run for real.

```bash
npm install
npm run dev      # http://localhost:5183
```

No account, no key, no install beyond `npm install`. The compiled languages run
on the free public Judge0 CE instance, which the browser calls directly — there
is no backend of ours in the path.

## What it does

| You write | It becomes | Where it runs |
| --- | --- | --- |
| HTML, CSS | a rendered page | a new tab, always |
| JavaScript | a program | a Web Worker in this tab |
| Python, C, C++, Java | a compiled program | Judge0 CE, remotely |
| JSON | a parse and a tree | in this tab |

**One Run button.** For markup it opens a new tab straight away — there is nothing
to stream and nowhere for it to go. For everything else it offers the two places a
program can run: **Run in console** (the panel below) or **Run in new tab**, which
opens a terminal window of its own at `terminal.html`.

The output panel and its tabs stay hidden until there is output to show, so the
editor has the whole window until you run something. `Ctrl+Enter` presses the
button. `Ctrl+S` saves.

## How a language is decided

There are no language tabs. `src/core/detect.ts` scores the buffer against
weighted patterns per language and takes the winner, but only if it is both
above a floor and clear of the runner-up. An ambiguous buffer keeps whatever it
was, because swapping the grammar under the cursor mid-word is worse than being
wrong for a moment.

C and C++ are separated by their includes and `std::` rather than by whichever
pattern matched first, so a C++ file that calls `printf` is still C++.

## Deploying

`npm run build` writes a static `dist/` — two HTML files, one CSS file, two JS
chunks and the worker. No server, no API key, no environment variables.

Assets are referenced relatively (`base: './'`) and the terminal tab resolves its
own URL from `document.baseURI`, so the build runs unchanged from a domain root,
a sub-path like `https://example.com/tools/anvil/`, or straight off the
filesystem. Serve the folder with anything; no rewrite rules are needed.

The only network dependency at runtime is Judge0 CE, and only for the compiled
languages. HTML, CSS, JavaScript and JSON work fully offline.

## Things worth knowing

- **The terminal is dark, the editor is paper.** The output panel re-themes by
  overriding the same CSS custom properties the rest of the app uses, so the
  ANSI palette is tuned for `#14130f` rather than for paper. There is a check
  asserting every base colour is brighter than the background it sits on.
- **The splash is removed, not just hidden,** once the editor exists. It waits a
  frame so the browser paints it before the fade, otherwise it appears and
  vanishes in one tick and reads as a flicker.
- **Java is wrapped.** Judge0 only runs a class called `Main`, so bare statements
  are wrapped in one, with `import` lines hoisted above it where javac requires.
  Detection ignores comments and string literals — a comment mentioning
  `class Main` must not silently disable the wrapper.
- **`prompt()` is async here.** A Web Worker cannot block its event loop waiting
  for you to type, so `prompt` returns a promise and must be awaited. Top-level
  `await` works. The same applies to `confirm()`.
- **The worker is killed after 10 seconds.** Nothing cooperative can stop
  `while (true) {}`; terminating the worker can.
- **The preview iframe is opaque.** It is sandboxed without `allow-same-origin`,
  so a page you preview cannot read this editor's storage or reach
  `window.parent`. The cost is that the document has to be complete on arrival.
- **Remote runs are not streamed.** Judge0 returns when the program is finished,
  so the output appears at once. Web Worker output arrives live. The console
  treats both identically and never pretends.
- **Blob URLs for previews are not revoked.** The editor created them, and
  revoking one while a tab still shows it breaks that tab on reload.

## Commands

```bash
npm run dev        # dev server on 5183
npm run typecheck  # tsc over src, then over tools
npm run verify     # 93 checks, including live compilation
npm run build      # both pages into dist/
npm run preview    # serve the build
```

`npm run verify` is the interesting one. It bundles `tools/verify.ts` with
esbuild and runs it in Node, so the DOM-free core — ANSI parsing, console
formatting, the Java wrapper, storage, detection, the terminal payload — is
tested headlessly in about a second. It finishes with live checks that compile
and run the real Python, C, C++ and Java starters on Judge0 and assert on their
output. If the network is unavailable those report `skip`, never `fail`.

## Layout

```
index.html            the editor
terminal.html         the standalone terminal, opened in its own tab
src/core/             no DOM: detection, judge0, java wrap, ansi, console, storage, payload
src/ui/               editor, console renderer, preview, json tree
src/main.ts           wiring
src/terminalTab.ts    the standalone terminal
tools/verify.ts       the check suite
```

`src/core` imports nothing from `src/ui`, which is what lets Node test it.

## Verified

- Python 3.13, GCC 14.1 (C and C++), OpenJDK 17 — real compiles, real output,
  real non-zero exit codes, real compiler diagnostics.
- JavaScript in a worker, including an interactive `prompt()` round trip and a
  10-second kill on an infinite loop.
- Every starter detected as its own language, in Node and in a real browser.
- Persistence across reload, the console/new-tab split, the popup-blocked path,
  and the build served from a **sub-path** as well as from a domain root.
