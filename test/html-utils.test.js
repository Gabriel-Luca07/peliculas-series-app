const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../lib/html-utils');

test('escapeHtml', async (t) => {
  await t.test('escapes all five special characters', () => {
    assert.equal(escapeHtml(`<script>alert("x") & 'y'</script>`), '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
  });

  await t.test('leaves ordinary text untouched', () => {
    assert.equal(escapeHtml('Stranger Things'), 'Stranger Things');
  });

  await t.test('coerces non-string input instead of throwing', () => {
    assert.equal(escapeHtml(2026), '2026');
  });

  await t.test('blocks a realistic custom-platform-name injection attempt', () => {
    const malicious = '"><img src=x onerror=alert(1)>';
    const escaped = escapeHtml(malicious);
    assert.ok(!escaped.includes('<img'));
    assert.ok(!escaped.includes('">'));
  });
});
