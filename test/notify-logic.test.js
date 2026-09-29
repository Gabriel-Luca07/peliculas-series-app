const test = require('node:test');
const assert = require('node:assert/strict');
const {
  notificationBody, emptyDigest, queueForDigest, digestDue, buildDigest,
} = require('../lib/notify-logic');

test('notificationBody shows three lines and counts the rest', () => {
  assert.equal(notificationBody(['a', 'b']), 'a\nb');
  assert.equal(notificationBody(['a', 'b', 'c', 'd', 'e']), 'a\nb\nc\n...y 2 más');
});

test('queueForDigest appends lines with their view', () => {
  let state = queueForDigest(null, ['uno'], 'novedades');
  state = queueForDigest(state, ['dos', 'tres'], 'viendo');
  assert.deepEqual(state.items, [
    { line: 'uno', view: 'novedades' },
    { line: 'dos', view: 'viendo' },
    { line: 'tres', view: 'viendo' },
  ]);
  assert.equal(state.lastSent, null);
});

test('digestDue: something queued, at or after the hour, once a day', () => {
  const queued = queueForDigest(emptyDigest(), ['x'], 'novedades');
  assert.equal(digestDue(queued, '2026-09-29', 19, 20), false);
  assert.equal(digestDue(queued, '2026-09-29', 20, 20), true);
  assert.equal(digestDue({ ...queued, lastSent: '2026-09-29' }, '2026-09-29', 22, 20), false);
  assert.equal(digestDue({ ...queued, lastSent: '2026-09-28' }, '2026-09-29', 22, 20), true);
  assert.equal(digestDue(emptyDigest(), '2026-09-29', 22, 20), false);
  assert.equal(digestDue(null, '2026-09-29', 22, 20), false);
});

test('buildDigest', async (t) => {
  await t.test('one view: opens it', () => {
    const { notification, state } = buildDigest(queueForDigest(null, ['a', 'b'], 'viendo'), '2026-09-29');
    assert.deepEqual(notification, { title: 'Tu resumen de hoy: 2 novedades', body: 'a\nb', view: 'viendo' });
    assert.deepEqual(state, { items: [], lastSent: '2026-09-29' });
  });
  await t.test('mixed views: Novedades', () => {
    let s = queueForDigest(null, ['a'], 'viendo');
    s = queueForDigest(s, ['b'], 'novedades');
    assert.equal(buildDigest(s, '2026-09-29').notification.view, 'novedades');
    assert.equal(buildDigest(queueForDigest(null, ['a'], 'x'), '2026-09-29').notification.title, 'Tu resumen de hoy: 1 novedad');
  });
});
