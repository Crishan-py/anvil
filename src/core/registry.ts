import type { EngineKind, LanguageId, TabId } from './types'

export interface LanguageDef {
  readonly id: LanguageId
  readonly label: string
  readonly engine: EngineKind
  readonly fileName: string
  /** Shown in the header chip. Names the real toolchain, not a vibe. */
  readonly engineLabel: string
  readonly tabs: readonly TabId[]
  readonly runLabel: string
  readonly judge0LanguageId: number | null
  readonly indentUnit: number
  readonly starter: string
}

const HTML_STARTER = `<article class="card">
  <h1>Rendered in a sandbox</h1>
  <p>
    This page lives in a sandboxed <code>&lt;iframe&gt;</code> — it can run scripts but
    cannot reach this editor. Edit the markup on the left and it re-renders as you type.
  </p>
  <button onclick="this.textContent = 'clicked at ' + new Date().toLocaleTimeString()">
    Click me
  </button>
  <ul>
    <li>No server, no install</li>
    <li><strong>Open in new tab</strong> puts it in a real window</li>
    <li>Inline <code>&lt;style&gt;</code> and <code>&lt;script&gt;</code> both work</li>
  </ul>
</article>

<style>
  body { font: 16px/1.6 Georgia, serif; padding: 2rem; }
  .card {
    max-width: 34rem;
    padding: 1.5rem 1.75rem;
    border: 1px solid #ded5c6;
    border-radius: 10px;
    background: #fffdf9;
  }
  h1 { margin-top: 0; font-size: 1.5rem; }
  code { background: #efe9df; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
  button {
    font: inherit;
    padding: 0.5rem 1rem;
    border: 1px solid #2f5d8a;
    border-radius: 6px;
    background: #2f5d8a;
    color: #fffdf9;
    cursor: pointer;
  }
</style>
`

const CSS_STARTER = `/* The preview panel shows your CSS applied to a sample page. */

body {
  font: 16px/1.65 Georgia, serif;
  color: #23201b;
}

h1, h2 { line-height: 1.2; }

h1 {
  border-bottom: 2px solid currentColor;
  padding-bottom: 0.2em;
}

a { color: #2f5d8a; }

code {
  background: #efe9df;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

blockquote {
  margin: 1em 0;
  padding-left: 1em;
  border-left: 3px solid #ded5c6;
  color: #6b6459;
}

table { border-collapse: collapse; }

th, td {
  border: 1px solid #ded5c6;
  padding: 0.4rem 0.75rem;
}

th { background: #efe9df; }

button {
  font: inherit;
  padding: 0.45rem 1rem;
  border: 1px solid #23201b;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
`

const JS_STARTER = `// Runs in a Web Worker: console.* reaches the console panel.
//
// prompt() here is asynchronous — a worker cannot block while it waits for you
// to type — so it must be awaited. Top-level await works, as it does in a module.

const name = await prompt('What is your name?', 'stranger')
console.log(\`Hello, \${name}.\`)

const fizzbuzz = (n) =>
  n % 15 === 0 ? 'FizzBuzz' : n % 3 === 0 ? 'Fizz' : n % 5 === 0 ? 'Buzz' : String(n)

for (let n = 1; n <= 15; n++) console.log(String(n).padStart(2), fizzbuzz(n))

const started = performance.now()
console.log(\`That took \${(performance.now() - started).toFixed(3)} ms.\`)
`

const JSON_STARTER = `{
  "name": "anvil",
  "version": 1,
  "compiles": ["python", "c", "cpp", "java"],
  "renders": ["html", "css"],
  "limits": {
    "timeoutMs": 10000,
    "memoryKb": 256000
  },
  "authors": [
    { "name": "Krishan", "role": "author" }
  ]
}
`

const PYTHON_STARTER = `name = input("What is your name? ")
print(f"Hello, {name}.")

total = 0
for i in range(1, 101):
    if i % 15 == 0:
        total += i

print("Multiples of 15 up to 100 add up to:", total)
print("They are:", [i for i in range(1, 101) if i % 15 == 0])
`

const C_STARTER = `#include <stdio.h>

int main(void) {
    char name[64];

    printf("What is your name? ");
    fflush(stdout);
    if (scanf("%63s", name) != 1) return 1;

    printf("Hello, %s.\\n", name);

    int total = 0;
    for (int i = 1; i <= 100; i++)
        if (i % 15 == 0) total += i;

    printf("Multiples of 15 up to 100 add up to: %d\\n", total);
    return 0;
}
`

const CPP_STARTER = `#include <iostream>
#include <string>
#include <vector>

int main() {
    std::cout << "What is your name? ";
    std::string name;
    if (!std::getline(std::cin, name)) return 1;

    std::cout << "Hello, " << name << ".\\n";

    std::vector<int> multiples;
    for (int i = 1; i <= 100; i++)
        if (i % 15 == 0) multiples.push_back(i);

    std::cout << "Multiples of 15 up to 100:";
    for (int v : multiples) std::cout << ' ' << v;
    std::cout << "\\nThey add up to " << multiples.size() * (multiples.front() + multiples.back()) / 2
              << ".\\n";
    return 0;
}
`

const JAVA_STARTER = `import java.util.Scanner;
import java.util.ArrayList;

// anvil wraps bare statements in "public class Main" before compiling.
Scanner keyboard = new Scanner(System.in);

System.out.print("What is your name? ");
String name = keyboard.nextLine();
System.out.println("Hello, " + name + ".");

ArrayList<Integer> multiples = new ArrayList<>();
int total = 0;
for (int i = 1; i <= 100; i++) {
    if (i % 15 == 0) {
        multiples.add(i);
        total += i;
    }
}

System.out.println("Multiples of 15 up to 100: " + multiples);
System.out.println("They add up to " + total + ".");
keyboard.close();
`

export const LANGUAGES: readonly LanguageDef[] = [
  {
    id: 'html',
    label: 'HTML',
    engine: 'preview',
    fileName: 'index.html',
    engineLabel: 'sandboxed iframe · local',
    tabs: ['preview', 'console'],
    runLabel: 'Preview',
    judge0LanguageId: null,
    indentUnit: 2,
    starter: HTML_STARTER,
  },
  {
    id: 'css',
    label: 'CSS',
    engine: 'preview',
    fileName: 'style.css',
    engineLabel: 'sandboxed iframe · local',
    tabs: ['preview', 'console'],
    runLabel: 'Preview',
    judge0LanguageId: null,
    indentUnit: 2,
    starter: CSS_STARTER,
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    engine: 'worker',
    fileName: 'main.js',
    engineLabel: 'Web Worker · async prompt() · local',
    tabs: ['console'],
    runLabel: 'Run',
    judge0LanguageId: null,
    indentUnit: 2,
    starter: JS_STARTER,
  },
  {
    id: 'json',
    label: 'JSON',
    engine: 'data',
    fileName: 'data.json',
    engineLabel: 'parser · local',
    tabs: ['data', 'console'],
    runLabel: 'Validate',
    judge0LanguageId: null,
    indentUnit: 2,
    starter: JSON_STARTER,
  },
  {
    id: 'python',
    label: 'Python',
    engine: 'remote',
    fileName: 'main.py',
    engineLabel: 'CPython 3.13 · Judge0 · remote',
    tabs: ['console'],
    runLabel: 'Run',
    judge0LanguageId: 109,
    indentUnit: 4,
    starter: PYTHON_STARTER,
  },
  {
    id: 'c',
    label: 'C',
    engine: 'remote',
    fileName: 'main.c',
    engineLabel: 'GCC 14.1 · Judge0 · remote',
    tabs: ['console'],
    runLabel: 'Run',
    judge0LanguageId: 103,
    indentUnit: 4,
    starter: C_STARTER,
  },
  {
    id: 'cpp',
    label: 'C++',
    engine: 'remote',
    fileName: 'main.cpp',
    engineLabel: 'GCC 14.1 · Judge0 · remote',
    tabs: ['console'],
    runLabel: 'Run',
    judge0LanguageId: 105,
    indentUnit: 4,
    starter: CPP_STARTER,
  },
  {
    id: 'java',
    label: 'Java',
    engine: 'remote',
    fileName: 'Main.java',
    engineLabel: 'OpenJDK 17 · Judge0 · remote',
    tabs: ['console'],
    runLabel: 'Run',
    judge0LanguageId: 91,
    indentUnit: 4,
    starter: JAVA_STARTER,
  },
]

const BY_ID = new Map<LanguageId, LanguageDef>(LANGUAGES.map((lang) => [lang.id, lang]))

export function language(id: LanguageId): LanguageDef {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`unknown language: ${id}`)
  return found
}

export const LANGUAGE_IDS: readonly LanguageId[] = LANGUAGES.map((lang) => lang.id)

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && BY_ID.has(value as LanguageId)
}
