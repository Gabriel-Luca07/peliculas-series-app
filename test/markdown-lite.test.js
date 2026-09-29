const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownToHtml } = require('../lib/markdown-lite');

test('headings, lists and paragraphs', () => {
  const html = markdownToHtml('## Novedades\n\n- **Uno**: primero\n- Dos\n  sigue\n\nTexto\nen dos líneas.');
  assert.equal(html, [
    '<h3>Novedades</h3>',
    '<ul>',
    '<li><strong>Uno</strong>: primero</li>',
    '<li>Dos sigue</li>',
    '</ul>',
    '<p>Texto en dos líneas.</p>',
  ].join('\n'));
});

test('links only for http(s), opened outside the app', () => {
  assert.equal(
    markdownToHtml('[ver](https://example.com/a?b=1)'),
    '<p><a href="https://example.com/a?b=1" target="_blank" rel="noopener">ver</a></p>',
  );
  assert.equal(markdownToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
});

test('HTML in the notes is escaped, never rendered', () => {
  const html = markdownToHtml('<img src=x onerror=alert(1)> y `<b>`');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<code>&lt;b&gt;</code>'));
});

test('empty notes', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml(null), '');
});
