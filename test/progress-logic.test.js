const test = require('node:test');
const assert = require('node:assert/strict');
const { episodeCountFor, advanceEpisode, formatProgress } = require('../lib/progress-logic');

const TODAY = '2026-09-29';
const SEASONS = [
  { seasonNumber: 0, airDate: '2019-01-01', episodeCount: 3 },
  { seasonNumber: 1, airDate: '2020-01-01', episodeCount: 8 },
  { seasonNumber: 2, airDate: '2022-01-01', episodeCount: 10 },
  { seasonNumber: 3, airDate: '2027-01-01', episodeCount: 8 },
];

test('episodeCountFor', async (t) => {
  await t.test('finds the season', () => assert.equal(episodeCountFor(SEASONS, 2), 10));
  await t.test('null when unknown', () => {
    assert.equal(episodeCountFor(SEASONS, 9), null);
    assert.equal(episodeCountFor(null, 1), null);
  });
});

test('advanceEpisode', async (t) => {
  await t.test('plain counter without TMDB data', () => {
    assert.deepEqual(advanceEpisode({ currentSeason: 2, currentEpisode: 4 }, null, TODAY),
      { currentSeason: 2, currentEpisode: 5, event: 'episode' });
  });

  await t.test('keeps a bare episode counter without season or TMDB data', () => {
    assert.deepEqual(advanceEpisode({ currentEpisode: 3 }, null, TODAY),
      { currentSeason: null, currentEpisode: 4, event: 'episode' });
  });

  await t.test('starts at season 1 episode 1 when there is no progress yet', () => {
    assert.deepEqual(advanceEpisode({}, SEASONS, TODAY), { currentSeason: 1, currentEpisode: 1, event: 'episode' });
  });

  await t.test('moves to the next season after its last episode when it is out', () => {
    assert.deepEqual(advanceEpisode({ currentSeason: 1, currentEpisode: 7 }, SEASONS, TODAY),
      { currentSeason: 2, currentEpisode: null, event: 'season-finished', finishedSeason: 1 });
  });

  await t.test('caught up when the next season has not aired yet', () => {
    assert.deepEqual(advanceEpisode({ currentSeason: 2, currentEpisode: 9 }, SEASONS, TODAY),
      { currentSeason: 2, currentEpisode: 10, event: 'caught-up' });
  });

  await t.test('caught up on the last season', () => {
    const seasons = SEASONS.slice(0, 3);
    assert.equal(advanceEpisode({ currentSeason: 2, currentEpisode: 9 }, seasons, TODAY).event, 'caught-up');
  });

  await t.test('clamps a counter that was already past the season length', () => {
    assert.deepEqual(advanceEpisode({ currentSeason: 2, currentEpisode: 12 }, SEASONS, TODAY),
      { currentSeason: 2, currentEpisode: 10, event: 'caught-up' });
  });
});

test('formatProgress', async (t) => {
  await t.test('nothing yet', () => assert.equal(formatProgress(null, null, null), 'Viendo'));
  await t.test('season only', () => assert.equal(formatProgress(3, null, 8), 'Viendo T3'));
  await t.test('with total', () => assert.equal(formatProgress(2, 5, 9), 'Viendo T2 · E5/9'));
  await t.test('without total', () => assert.equal(formatProgress(2, 5, null), 'Viendo T2 · E5'));
  await t.test('episode only', () => assert.equal(formatProgress(null, 4, null), 'Viendo E4'));
});
