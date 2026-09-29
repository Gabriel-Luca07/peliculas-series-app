const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCsv, normalizeDate, parseImportFile, recordsFromMappedCsv,
} = require('../lib/csv-import-utils');

test('parseCsv', async (t) => {
  await t.test('quoted fields, escaped quotes, CRLF and blank lines', () => {
    const { headers, rows } = parseCsv('Title,Date\r\n"Hello, world","2020-01-01"\r\n\r\n"Say ""hi""",x\n');
    assert.deepEqual(headers, ['Title', 'Date']);
    assert.deepEqual(rows, [['Hello, world', '2020-01-01'], ['Say "hi"', 'x']]);
  });
});

test('normalizeDate', () => {
  assert.equal(normalizeDate('2024-03-05T10:00:00.000Z'), '2024-03-05');
  assert.equal(normalizeDate('25/12/23'), '2023-12-25');
  assert.equal(normalizeDate('12/25/2023'), '2023-12-25');
  assert.equal(normalizeDate('ayer'), null);
  assert.equal(normalizeDate(''), null);
});

test('parseImportFile', async (t) => {
  await t.test('Letterboxd diary: watched date, rating out of 5 and tags', () => {
    const csv = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n'
      + '2024-01-02,Dune,2021,https://boxd.it/a,4.5,,"sci-fi, cine",2024-01-01\n';
    const res = parseImportFile(csv, 'diary.csv');
    assert.equal(res.format.id, 'letterboxd');
    assert.equal(res.format.label, 'Letterboxd (diario)');
    assert.deepEqual(res.records, [{
      title: 'Dune', type: 'pelicula', year: '2021', date: '2024-01-01', rating: 9, status: 'vista', tmdbId: null, tags: ['sci-fi', 'cine'],
    }]);
  });

  await t.test('Letterboxd watchlist (told apart by the file name) is pending', () => {
    const res = parseImportFile('Date,Name,Year,Letterboxd URI\n2024-01-02,Alien,1979,https://boxd.it/b\n', 'watchlist.csv');
    assert.equal(res.records[0].status, 'pendiente');
    assert.equal(res.records[0].date, null);
  });

  await t.test('IMDb ratings: series type, rating and date, episodes skipped', () => {
    const csv = '﻿Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres\n'
      + 'tt1,8,2023-05-06,Dark,u,TV Series,8.7,60,2017,Drama\n'
      + 'tt2,7,2023-05-07,Some episode,u,TV Episode,8,50,2018,Drama\n'
      + 'tt3,10,2023-05-08,Heat,u,Movie,8.3,170,1995,Crime\n';
    const res = parseImportFile(csv, 'ratings.csv');
    assert.equal(res.format.label, 'IMDb (valoraciones)');
    assert.deepEqual(res.records.map((r) => [r.title, r.type, r.rating, r.date]), [
      ['Dark', 'serie', 8, '2023-05-06'],
      ['Heat', 'pelicula', 10, '2023-05-08'],
    ]);
  });

  await t.test('IMDb watchlist is pending', () => {
    const csv = 'Position,Const,Created,Modified,Description,Title,URL,Title Type,Year,Your Rating\n1,tt9,2024-01-01,,,Heat,u,movie,1995,\n';
    const res = parseImportFile(csv, 'WATCHLIST.csv');
    assert.equal(res.format.label, 'IMDb (lista para ver)');
    assert.equal(res.records[0].status, 'pendiente');
  });

  await t.test('Trakt JSON: movies, shows, watchlist and TMDB ids', () => {
    const json = JSON.stringify([
      { plays: 2, last_watched_at: '2024-02-03T20:00:00.000Z', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949 } } },
      { watched_at: '2024-02-04T20:00:00.000Z', episode: { season: 1 }, show: { title: 'Dark', year: 2017, ids: { tmdb: 70523 } } },
      { rated_at: '2024-02-05T20:00:00.000Z', rating: 9, movie: { title: 'Alien', year: 1979, ids: {} } },
      { listed_at: '2024-02-06T20:00:00.000Z', type: 'movie', movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631 } } },
    ]);
    const res = parseImportFile(json, 'history.json');
    assert.equal(res.format.id, 'trakt');
    assert.deepEqual(res.records.map((r) => [r.title, r.type, r.status, r.date, r.rating, r.tmdbId]), [
      ['Heat', 'pelicula', 'vista', '2024-02-03', null, 949],
      ['Dark', 'serie', 'vista', '2024-02-04', null, 70523],
      ['Alien', 'pelicula', 'vista', '2024-02-05', 9, null],
      ['Dune', 'pelicula', 'pendiente', null, null, 438631],
    ]);
  });

  await t.test('unknown CSV comes back for manual column mapping', () => {
    const res = parseImportFile('Title,Date\nStranger Things: Season 1: Chapter One,01/02/2023\n', 'NetflixViewingHistory.csv');
    assert.equal(res.format, null);
    assert.deepEqual(res.headers, ['Title', 'Date']);
  });

  await t.test('unreadable content', () => {
    assert.deepEqual(parseImportFile('', 'x.csv'), { error: 'INVALID' });
    assert.deepEqual(parseImportFile('{"a":1}', 'x.json'), { error: 'INVALID' });
  });
});

test('recordsFromMappedCsv collapses Netflix episodes into the series', () => {
  const rows = [['Stranger Things: Season 1: Chapter One', '01/02/2023'], ['Heat', '15/02/2023'], ['', 'x']];
  assert.deepEqual(recordsFromMappedCsv(rows, { titleIdx: 0, dateIdx: 1, defaultType: 'pelicula' }).map((r) => [r.title, r.type, r.date]), [
    ['Stranger Things', 'serie', '2023-02-01'],
    ['Heat', 'pelicula', '2023-02-15'],
  ]);
});
