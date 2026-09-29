const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseState, findNewSeasons, findSequels, sortByRelease, pickNotifications } = require('../lib/followups-logic');

const TODAY = '2026-09-29';

test('releaseState', async (t) => {
  await t.test('past or today is released', () => {
    assert.equal(releaseState('2026-09-29', TODAY), 'released');
    assert.equal(releaseState('2020-01-01', TODAY), 'released');
  });
  await t.test('future is upcoming', () => {
    assert.equal(releaseState('2026-09-30', TODAY), 'upcoming');
  });
  await t.test('no date is announced', () => {
    assert.equal(releaseState(null, TODAY), 'announced');
  });
});

test('findNewSeasons', async (t) => {
  const seasons = [
    { seasonNumber: 0, airDate: '2019-01-01' },
    { seasonNumber: 1, airDate: '2020-01-01' },
    { seasonNumber: 2, airDate: '2021-01-01' },
    { seasonNumber: 3, airDate: '2025-06-01' },
    { seasonNumber: 4, airDate: '2027-02-01' },
    { seasonNumber: 5, airDate: null },
  ];

  await t.test('uses the stored season count', () => {
    const res = findNewSeasons({ seasons: 2 }, seasons, TODAY);
    assert.deepEqual(res.map((s) => [s.seasonNumber, s.state]), [[3, 'released'], [4, 'upcoming'], [5, 'announced']]);
  });

  await t.test('ignores specials (season 0)', () => {
    const res = findNewSeasons({ dateWatched: '2018-01-01' }, seasons, TODAY);
    assert.ok(!res.some((s) => s.seasonNumber === 0));
  });

  await t.test('drops seasons that aired before the watch date even if the count is stale', () => {
    // Added as pending with 2 seasons, but finished after season 3 was out.
    const res = findNewSeasons({ seasons: 2, dateWatched: '2025-08-01' }, seasons, TODAY);
    assert.deepEqual(res.map((s) => s.seasonNumber), [4, 5]);
  });

  await t.test('falls back to the watch date when there is no season count', () => {
    const res = findNewSeasons({ dateWatched: '2024-01-01' }, seasons, TODAY);
    assert.deepEqual(res.map((s) => s.seasonNumber), [3, 4, 5]);
  });

  await t.test('returns nothing without a season count or watch date', () => {
    assert.deepEqual(findNewSeasons({}, seasons, TODAY), []);
  });

  await t.test('returns nothing when up to date', () => {
    assert.deepEqual(findNewSeasons({ seasons: 5 }, seasons, TODAY), []);
  });
});

test('findSequels', async (t) => {
  const parts = [
    { tmdbId: 1, title: 'Parte 1', releaseDate: '2010-05-01' },
    { tmdbId: 2, title: 'Parte 2', releaseDate: '2013-05-01' },
    { tmdbId: 3, title: 'Parte 3', releaseDate: '2027-05-01' },
    { tmdbId: 4, title: 'Parte 4', releaseDate: null },
  ];

  await t.test('lists later parts not in the list, with the part they follow', () => {
    const res = findSequels([{ tmdbId: 1, title: 'Parte 1', releaseDate: '2010-05-01' }], parts, new Set([1]), TODAY);
    assert.deepEqual(res.map((p) => [p.tmdbId, p.state, p.sequelOf]), [
      [2, 'released', 'Parte 1'],
      [3, 'upcoming', 'Parte 1'],
      [4, 'announced', 'Parte 1'],
    ]);
  });

  await t.test('ignores prequels of the earliest watched part', () => {
    const res = findSequels([{ tmdbId: 2, title: 'Parte 2', releaseDate: '2013-05-01' }], parts, new Set([2]), TODAY);
    assert.deepEqual(res.map((p) => p.tmdbId), [3, 4]);
  });

  await t.test('skips parts already in the list (pending or watched)', () => {
    const res = findSequels([{ tmdbId: 1, title: 'Parte 1', releaseDate: '2010-05-01' }], parts, new Set([1, 2, 3]), TODAY);
    assert.deepEqual(res.map((p) => p.tmdbId), [4]);
  });

  await t.test('sequelOf points at the latest watched part before it', () => {
    const watched = [
      { tmdbId: 1, title: 'Parte 1', releaseDate: '2010-05-01' },
      { tmdbId: 2, title: 'Parte 2', releaseDate: '2013-05-01' },
    ];
    const res = findSequels(watched, parts, new Set([1, 2]), TODAY);
    assert.equal(res.find((p) => p.tmdbId === 3).sequelOf, 'Parte 2');
  });

  await t.test('returns nothing when no watched part has a release date', () => {
    assert.deepEqual(findSequels([{ tmdbId: 1, title: 'X', releaseDate: null }], parts, new Set([1]), TODAY), []);
  });
});

test('sortByRelease', () => {
  const items = [
    { id: 'a', state: 'announced', date: null },
    { id: 'u2', state: 'upcoming', date: '2027-03-01' },
    { id: 'r1', state: 'released', date: '2020-01-01' },
    { id: 'u1', state: 'upcoming', date: '2026-12-01' },
    { id: 'r2', state: 'released', date: '2026-01-01' },
  ];
  assert.deepEqual(sortByRelease(items, (i) => i.date).map((i) => i.id), ['r2', 'r1', 'u1', 'u2', 'a']);
});

test('pickNotifications', async (t) => {
  const items = [
    { key: 'tv:1:2', state: 'released' },
    { key: 'movie:5', state: 'upcoming' },
    { key: 'movie:6', state: 'announced' },
  ];

  await t.test('first run records everything without notifying', () => {
    const res = pickNotifications(items, null);
    assert.deepEqual(res.toNotify, []);
    assert.deepEqual(res.notifiedKeys.sort(), ['movie:5:upcoming', 'tv:1:2:released']);
  });

  await t.test('notifies only what is new, never undated announcements', () => {
    const res = pickNotifications(items, ['tv:1:2:released']);
    assert.deepEqual(res.toNotify.map((i) => i.key), ['movie:5']);
  });

  await t.test('notifies again when an upcoming item comes out', () => {
    const res = pickNotifications([{ key: 'movie:5', state: 'released' }], ['movie:5:upcoming']);
    assert.deepEqual(res.toNotify.map((i) => i.key), ['movie:5']);
    assert.ok(res.notifiedKeys.includes('movie:5:released'));
  });

  await t.test('keeps previously notified keys', () => {
    const res = pickNotifications([], ['old:1:released']);
    assert.deepEqual(res.notifiedKeys, ['old:1:released']);
  });
});
