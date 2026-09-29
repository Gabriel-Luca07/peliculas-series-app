const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeById } = require('../lib/sync-merge');

const t = (id, fields = {}) => ({ id, title: id, rating: null, ...fields });
const ids = (list) => list.map((x) => x.id);

test('changes on different titles are both kept', () => {
  const base = [t('a'), t('b')];
  const mine = [t('a', { rating: 8 }), t('b')];
  const theirs = [t('a'), t('b', { rating: 5 })];
  assert.deepEqual(mergeById(base, mine, theirs), [t('a', { rating: 8 }), t('b', { rating: 5 })]);
});

test('same title changed on both sides: this computer wins', () => {
  const merged = mergeById([t('a')], [t('a', { rating: 8 })], [t('a', { rating: 2 })]);
  assert.deepEqual(merged, [t('a', { rating: 8 })]);
});

test('titles added on either side are kept, mine first', () => {
  const merged = mergeById([t('a')], [t('a'), t('mine')], [t('a'), t('theirs')]);
  assert.deepEqual(ids(merged), ['a', 'mine', 'theirs']);
});

test('deleted on one side and untouched on the other: deleted', () => {
  assert.deepEqual(ids(mergeById([t('a'), t('b')], [t('a')], [t('a'), t('b')])), ['a']);
  assert.deepEqual(ids(mergeById([t('a'), t('b')], [t('a'), t('b')], [t('a')])), ['a']);
});

test('deleted on one side but edited on the other: the edit survives', () => {
  assert.deepEqual(mergeById([t('a')], [t('a', { rating: 9 })], []), [t('a', { rating: 9 })]);
  assert.deepEqual(mergeById([t('a')], [], [t('a', { rating: 3 })]), [t('a', { rating: 3 })]);
});

test('nothing changed on the other side: result is just mine', () => {
  const base = [t('a'), t('b')];
  const mine = [t('b', { rating: 1 }), t('c')];
  assert.deepEqual(mergeById(base, mine, base), mine);
});

test('tolerates empty or broken lists', () => {
  assert.deepEqual(mergeById(null, [t('a')], undefined), [t('a')]);
  assert.deepEqual(mergeById([], [null, t('a')], [{ title: 'sin id' }]), [t('a')]);
});
