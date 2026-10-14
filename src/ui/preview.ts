/**
 * Preview construction for the two rendering languages.
 *
 * The iframe is sandboxed without `allow-same-origin`, so it is an opaque
 * origin: the previewed page cannot read this editor's storage or reach
 * `window.parent`. That also means the document has to be complete on arrival —
 * there is no reaching in afterwards to inject the stylesheet.
 */

export const SAMPLE_BODY = `<h1>The quick brown fox</h1>
<p>Paragraph text with an <a href="#">inline link</a>, some <code>inline code</code>,
and a bit of <strong>bold</strong> and <em>emphasis</em>.</p>
<h2>A short list</h2>
<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>
<ol><li>Ordered one</li><li>Ordered two</li></ol>
<blockquote>Quoted text sits here, indented and greyed.</blockquote>
<pre><code>const answer = 42
console.log(answer)</code></pre>
<table>
  <thead><tr><th>Language</th><th>Runs</th></tr></thead>
  <tbody><tr><td>Python</td><td>yes</td></tr><tr><td>C</td><td>yes</td></tr></tbody>
</table>
<div class="card"><strong>Card</strong><p>Nested markup, for your own classes.</p></div>
<button type="button">A button</button>
<input type="text" placeholder="An input">
`

/**
 * `</style` would close the element early. `\/` is a valid CSS escape for the
 * solidus, so the stylesheet still parses as the author wrote it while the
 * HTML tokenizer no longer sees an end tag.
 */
function inlineable(css: string): string {
  return css.replace(/<\//g, '<\\/')
}

export function buildHtmlDocument(source: string): string {
  return source
}

export function buildCssDocument(css: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<title>CSS preview</title>',
    `<style>\n${inlineable(css)}\n</style>`,
    '</head><body>',
    SAMPLE_BODY,
    '</body></html>',
  ].join('')
}

export function buildDocument(language: 'html' | 'css', source: string): string {
  return language === 'html' ? buildHtmlDocument(source) : buildCssDocument(source)
}

/**
 * Blob URLs are intentionally not revoked: the document that created them is
 * the editor, and revoking one while a tab still shows it breaks that tab on
 * reload. They are released when the editor itself closes.
 */
export function openInNewTab(language: 'html' | 'css', source: string): Window | null {
  const blob = new Blob([buildDocument(language, source)], { type: 'text/html' })
  return window.open(URL.createObjectURL(blob), '_blank', 'noopener')
}
