const test = require('node:test');
const assert = require('node:assert/strict');
const { shuffle, makePager, nextPoolPage, pickShareItems } = require('../lib/pool-logic');

// Deterministic pseudo-random numbers in [0, 1).
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const pool = (n, prefix = 'm') => Array.from({ length: n }, (_, i) => ({ tmdbId: i + 1, title: `${prefix}${i + 1}` }));

test('shuffle keeps every element and does not modify the input', () => {
  const input = pool(10);
  const out = shuffle(input, seeded(1));
  assert.equal(out.length, 10);
  assert.deepEqual(out.map((x) => x.tmdbId).sort((a, b) => a - b), input.map((x) => x.tmdbId));
  assert.deepEqual(input, pool(10));
});

test('nextPoolPage walks the whole pool before repeating', () => {
  const items = pool(9);
  const pager = makePager();
  const random = seeded(7);
  const seen = [
    ...nextPoolPage(items, pager, 3, random),
    ...nextPoolPage(items, pager, 3, random),
    ...nextPoolPage(items, pager, 3, random),
  ].map((x) => x.tmdbId);
  assert.equal(new Set(seen).size, 9);
});

test('nextPoolPage edge cases', () => {
  assert.deepEqual(nextPoolPage([], makePager(), 3), []);
  assert.deepEqual(nextPoolPage(null, makePager(), 3), []);
  assert.equal(nextPoolPage(pool(2), makePager(), 5).length, 2);
});

test('pickShareItems', async (t) => {
  const watched = [
    { tmdbId: 1, type: 'pelicula', title: 'Heat', rating: 9, genres: ['Crimen'], platform: 'Netflix' },
    { tmdbId: 2, type: 'pelicula', title: 'Alien', rating: 8, genres: ['Terror'], platform: 'HBO Max' },
    { tmdbId: 3, type: 'serie', title: 'Dark', rating: 10, genres: ['Drama'], platform: 'Netflix' },
  ];
  const pending = [
    { tmdbId: 4, type: 'pelicula', title: 'Ronin', genres: ['Crimen'], platform: 'Netflix' },
    { tmdbId: 5, type: 'pelicula', title: 'Sin TMDB', genres: [] },
  ];
  const sources = {
    watched,
    pending,
    libraryTmdbIds: new Set([1, 2, 3, 4]),
    discoveryMovies: [{ tmdbId: 1, title: 'Heat', mediaType: 'movie' }, { tmdbId: 9, title: 'Nueva', mediaType: 'movie' }],
    discoveryTv: [],
  };
  const pagers = () => ({ rated: makePager(), pending: makePager(), discovery: makePager() });
  const options = (extra) => ({
    types: new Set(['pelicula', 'serie']), genres: new Set(), platforms: new Set(),
    count: 4, useRated: true, usePending: true, useDiscovery: true, ...extra,
  });

  await t.test('mixes sources, never repeats and skips discovery titles you already have', () => {
    const items = pickShareItems(options(), sources, pagers(), seeded(3));
    const ids = items.map((i) => i.tmdbId);
    assert.equal(items.length, 4);
    assert.equal(new Set(ids).size, 4);
    assert.ok(ids.includes(9), 'one discovery title');
    assert.ok(!ids.includes(5), 'titles without TMDB data are left out');
    assert.equal(items.find((i) => i.tmdbId === 9).source, 'discovery');
    assert.equal(items.find((i) => i.tmdbId === 9).type, 'pelicula');
  });

  await t.test('type, genre and platform filters', () => {
    const onlySeries = pickShareItems(options({ types: new Set(['serie']), useDiscovery: false }), sources, pagers(), seeded(3));
    assert.deepEqual(onlySeries.map((i) => i.title), ['Dark']);
    const crime = pickShareItems(options({ genres: new Set(['Crimen']), useDiscovery: false }), sources, pagers(), seeded(3));
    assert.deepEqual(crime.map((i) => i.title).sort(), ['Heat', 'Ronin']);
    const hbo = pickShareItems(options({ platforms: new Set(['HBO Max']), useDiscovery: false }), sources, pagers(), seeded(3));
    assert.deepEqual(hbo.map((i) => i.title), ['Alien']);
  });

  await t.test('other sources fill the gap when one runs short', () => {
    const items = pickShareItems(options({ count: 5, usePending: false, useDiscovery: false }), sources, pagers(), seeded(3));
    assert.equal(items.length, 3, 'only 3 rated titles exist');
  });
});
