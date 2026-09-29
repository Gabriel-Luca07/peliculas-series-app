const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ON_MY_SUBSCRIPTIONS, filterSortPendientes, filterSortVistas, parseTagsInput,
} = require('../lib/list-logic');

const LIST = [
  { id: '1', type: 'pelicula', title: 'Heat', platform: 'Netflix', genres: ['Crimen'], tags: ['cine'], dateAdded: '2024-01-02', availableOn: ['HBO Max'], rating: 9, dateWatched: '2024-03-01' },
  { id: '2', type: 'serie', title: 'Dark', platform: 'Netflix', genres: ['Drama'], tags: [], dateAdded: '2024-01-03', availableOn: ['Netflix'], rating: 7, dateWatched: '2024-02-01' },
  { id: '3', title: 'Alien', platform: '', genres: ['Terror'], dateAdded: '2024-01-01', rating: null, dateWatched: '2024-04-01' },
];
const ids = (list) => list.map((m) => m.id);

test('filterSortPendientes', async (t) => {
  await t.test('newest first by default', () => {
    assert.deepEqual(ids(filterSortPendientes(LIST, {})), ['2', '1', '3']);
  });
  await t.test('title sort and filters', () => {
    assert.deepEqual(ids(filterSortPendientes(LIST, { sort: 'title-asc' })), ['3', '2', '1']);
    assert.deepEqual(ids(filterSortPendientes(LIST, { type: 'pelicula' })), ['1', '3']);
    assert.deepEqual(ids(filterSortPendientes(LIST, { platform: 'Netflix', genre: 'Crimen' })), ['1']);
    assert.deepEqual(ids(filterSortPendientes(LIST, { tag: 'cine' })), ['1']);
    assert.deepEqual(ids(filterSortPendientes(LIST, { search: ' DA ' })), ['2']);
  });
  await t.test('on my subscriptions uses where each title streams now', () => {
    assert.deepEqual(ids(filterSortPendientes(LIST, { platform: ON_MY_SUBSCRIPTIONS, activePlatforms: ['HBO Max'] })), ['1']);
    assert.deepEqual(ids(filterSortPendientes(LIST, { platform: ON_MY_SUBSCRIPTIONS, activePlatforms: [] })), []);
  });
  await t.test('does not modify the input', () => {
    const copy = LIST.slice();
    filterSortPendientes(LIST, { sort: 'title-asc' });
    assert.deepEqual(LIST, copy);
  });
});

test('filterSortVistas', () => {
  assert.deepEqual(ids(filterSortVistas(LIST, {})), ['3', '1', '2']);
  assert.deepEqual(ids(filterSortVistas(LIST, { sort: 'rating-desc' })), ['1', '2', '3']);
  assert.deepEqual(ids(filterSortVistas(LIST, { ratingMin: '8' })), ['1']);
});

test('parseTagsInput', () => {
  assert.deepEqual(parseTagsInput(' halloween, con Ana ,halloween,, '), ['halloween', 'con Ana']);
  assert.deepEqual(parseTagsInput(''), []);
});
