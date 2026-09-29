const test = require('node:test');
const assert = require('node:assert/strict');
const { createTitleIndex, applyImportRecords, mergeBackupMovies } = require('../lib/merge-logic');

const opts = () => {
  let n = 0;
  return { platform: 'Netflix', today: '2026-09-29', now: '2026-09-29T10:00:00.000Z', newId: () => `new${++n}` };
};
const rec = (fields) => ({ type: 'pelicula', year: '', date: null, rating: null, status: 'vista', tmdbId: null, tags: [], ...fields });

test('createTitleIndex', async (t) => {
  const index = createTitleIndex([
    { id: '1', type: 'pelicula', title: 'Dune', year: '1984' },
    { id: '2', type: 'pelicula', title: 'Dune', year: '2021', tmdbId: 438631 },
    { id: '3', type: 'serie', title: 'Dune' },
  ]);

  await t.test('matches by TMDB id first', () => {
    assert.equal(index.find({ type: 'pelicula', title: 'Duna', tmdbId: 438631 }).id, '2');
  });
  await t.test('title + year tells remakes apart', () => {
    assert.equal(index.find({ type: 'pelicula', title: 'dune ', year: '1984' }).id, '1');
    assert.equal(index.find({ type: 'pelicula', title: 'Dune', year: '2021' }).id, '2');
  });
  await t.test('type matters', () => {
    assert.equal(index.find({ type: 'serie', title: 'Dune', year: '2024' }).id, '3');
  });
  await t.test('different TMDB ids never match', () => {
    assert.equal(index.find({ type: 'pelicula', title: 'Dune', year: '2021', tmdbId: 1 }), null);
  });
});

test('applyImportRecords', async (t) => {
  await t.test('adds new watched and pending titles', () => {
    const res = applyImportRecords([], [
      rec({ title: 'Heat', rating: 9, date: '2024-01-01', tags: ['cine'] }),
      rec({ title: 'Alien', status: 'pendiente', tmdbId: 348 }),
    ], opts());
    assert.equal(res.added, 2);
    const [heat, alien] = res.movies;
    assert.equal(heat.status, 'vista');
    assert.equal(heat.platform, 'Netflix');
    assert.equal(heat.rating, 9);
    assert.equal(heat.watchCount, 1);
    assert.deepEqual(heat.tags, ['cine']);
    assert.equal(alien.status, 'pendiente');
    assert.equal(alien.platform, '');
    assert.equal(alien.mediaType, 'movie');
    assert.equal(alien.dateWatched, null);
  });

  await t.test('marks an existing pending title as watched', () => {
    const movies = [{ id: 'm', type: 'serie', title: 'Dark', status: 'viendo', currentSeason: 2, platform: 'No recuerdo' }];
    const res = applyImportRecords(movies, [rec({ type: 'serie', title: 'dark', date: '2024-05-05', rating: 8 })], opts());
    assert.equal(res.updated, 1);
    assert.equal(res.added, 0);
    assert.equal(res.movies[0].status, 'vista');
    assert.equal(res.movies[0].currentSeason, null);
    assert.equal(res.movies[0].dateWatched, '2024-05-05');
    assert.equal(res.movies[0].platform, 'Netflix');
    assert.equal(res.movies[0].rating, 8);
    assert.equal(movies[0].status, 'viendo', 'the original list is not modified');
  });

  await t.test('keeps what the title already had', () => {
    const movies = [{ id: 'm', type: 'pelicula', title: 'Heat', status: 'vista', platform: 'HBO Max', rating: 6, dateWatched: '2025-01-01' }];
    const res = applyImportRecords(movies, [rec({ title: 'Heat', date: '2024-01-01', rating: 10 })], { ...opts(), platform: 'No recuerdo' });
    assert.equal(res.updated, 0);
    assert.equal(res.unchanged, 1);
    assert.deepEqual(res.movies[0], movies[0]);
  });

  await t.test('a pending record never downgrades a watched title', () => {
    const movies = [{ id: 'm', type: 'pelicula', title: 'Heat', status: 'vista' }];
    const res = applyImportRecords(movies, [rec({ title: 'Heat', status: 'pendiente', tmdbId: 949 })], opts());
    assert.equal(res.movies[0].status, 'vista');
    assert.equal(res.movies[0].tmdbId, 949);
    assert.equal(res.updated, 1);
  });

  await t.test('repeated rows of the same new title add it once with the latest date', () => {
    const res = applyImportRecords([], [
      rec({ type: 'serie', title: 'Dark', date: '2024-01-03' }),
      rec({ type: 'serie', title: 'Dark', date: '2024-01-09' }),
      rec({ type: 'serie', title: 'Dark', date: '2024-01-01' }),
    ], opts());
    assert.equal(res.added, 1);
    assert.equal(res.movies.length, 1);
    assert.equal(res.movies[0].dateWatched, '2024-01-09');
  });
});

test('mergeBackupMovies', async (t) => {
  const newId = (() => { let n = 0; return () => `gen${++n}`; })();

  await t.test('adds missing titles and gives them a fresh id if it clashes', () => {
    const res = mergeBackupMovies(
      [{ id: 'x', type: 'pelicula', title: 'Heat', status: 'vista' }],
      [{ id: 'x', type: 'pelicula', title: 'Alien', status: 'pendiente' }],
      newId,
    );
    assert.equal(res.added, 1);
    assert.equal(res.movies[1].title, 'Alien');
    assert.notEqual(res.movies[1].id, 'x');
  });

  await t.test('the most advanced status wins', () => {
    const res = mergeBackupMovies(
      [{ id: 'a', type: 'pelicula', title: 'Heat', status: 'pendiente', platform: 'Netflix' }],
      [{ id: 'b', type: 'pelicula', title: 'Heat', status: 'vista', rating: 9, dateWatched: '2024-01-01', watchCount: 2, platform: 'HBO Max' }],
      newId,
    );
    const heat = res.movies[0];
    assert.equal(res.updated, 1);
    assert.equal(heat.id, 'a');
    assert.equal(heat.status, 'vista');
    assert.equal(heat.rating, 9);
    assert.equal(heat.watchCount, 2);
    assert.equal(heat.platform, 'Netflix', 'keeps its own platform');
  });

  await t.test('two watched copies keep the latest date and the higher count', () => {
    const res = mergeBackupMovies(
      [{ id: 'a', type: 'pelicula', title: 'Heat', status: 'vista', rating: 7, dateWatched: '2023-01-01', watchCount: 1 }],
      [{ id: 'b', type: 'pelicula', title: 'Heat', status: 'vista', rating: 9, dateWatched: '2024-01-01', watchCount: 3, notes: 'top' }],
      newId,
    );
    const heat = res.movies[0];
    assert.deepEqual([heat.rating, heat.dateWatched, heat.watchCount, heat.notes], [7, '2024-01-01', 3, 'top']);
  });

  await t.test('series in progress keep the furthest episode', () => {
    const res = mergeBackupMovies(
      [{ id: 'a', type: 'serie', title: 'Dark', status: 'viendo', currentSeason: 2, currentEpisode: 1 }],
      [{ id: 'b', type: 'serie', title: 'Dark', status: 'viendo', currentSeason: 1, currentEpisode: 8 }],
      newId,
    );
    assert.equal(res.unchanged, 1);
    assert.equal(res.movies[0].currentSeason, 2);
  });

  await t.test('fills empty fields and ignores broken entries', () => {
    const res = mergeBackupMovies(
      [{ id: 'a', type: 'pelicula', title: 'Heat', status: 'pendiente', poster: '', genres: [] }],
      [{ type: 'pelicula', title: 'Heat', status: 'pendiente', poster: 'p.jpg', genres: ['Crimen'], tmdbId: 949, tags: ['cine'] }, { title: '' }, null],
      newId,
    );
    assert.equal(res.movies.length, 1);
    assert.equal(res.movies[0].poster, 'p.jpg');
    assert.deepEqual(res.movies[0].genres, ['Crimen']);
    assert.deepEqual(res.movies[0].tags, ['cine']);
    assert.equal(res.movies[0].tmdbId, 949);
  });
});
