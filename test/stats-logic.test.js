const test = require('node:test');
const assert = require('node:assert/strict');
const {
  topNWithOther, countGenres, countPlatforms, ratingBuckets, monthlyActivity, watchedPerYear, releaseDecades,
} = require('../lib/stats-logic');

test('topNWithOther keeps the top entries and sums the rest', () => {
  assert.deepEqual(topNWithOther({ a: 1, b: 5, c: 3, d: 2 }, 2), [['b', 5], ['c', 3], ['Otros', 3]]);
  assert.deepEqual(topNWithOther({ a: 1 }, 2), [['a', 1]]);
});

test('countGenres and countPlatforms', () => {
  const titles = [
    { genres: ['Drama', 'Crimen'], platform: 'Netflix' },
    { genres: ['Drama'], platform: '' },
    { platform: 'Netflix' },
  ];
  assert.deepEqual(countGenres(titles), { Drama: 2, Crimen: 1 });
  assert.deepEqual(countPlatforms(titles), { Netflix: 2 });
});

test('ratingBuckets rounds and ignores out-of-range ratings', () => {
  const buckets = ratingBuckets([{ rating: 7.4 }, { rating: 7.6 }, { rating: 10 }, { rating: 0 }]);
  assert.equal(buckets[6], 1);
  assert.equal(buckets[7], 1);
  assert.equal(buckets[9], 1);
  assert.equal(buckets.reduce((a, b) => a + b, 0), 3);
});

test('monthlyActivity covers the last months, oldest first', () => {
  const now = new Date(2026, 0, 15); // January 2026
  const res = monthlyActivity([{ dateWatched: '2025-12-03' }, { dateWatched: '2026-01-01' }, { dateWatched: '2026-01-20' }], now, 3);
  assert.deepEqual(res, [{ month: 10, count: 0 }, { month: 11, count: 1 }, { month: 0, count: 2 }]);
});

test('watchedPerYear spans at least 5 and at most 10 years', () => {
  assert.equal(watchedPerYear([], 2026).length, 5);
  const res = watchedPerYear([{ dateWatched: '2010-05-05' }, { dateWatched: '2026-01-01' }, { dateWatched: '2026-02-01' }], 2026);
  assert.equal(res.length, 10);
  assert.equal(res[0].year, 2017);
  assert.deepEqual(res[res.length - 1], { year: 2026, count: 2 });
});

test('releaseDecades groups by decade and skips implausible years', () => {
  assert.deepEqual(
    releaseDecades([{ year: '1994' }, { year: '1999' }, { year: '2021' }, { year: '' }, { year: '3000' }], 2026),
    [{ decade: 1990, count: 2 }, { decade: 2020, count: 1 }],
  );
});
