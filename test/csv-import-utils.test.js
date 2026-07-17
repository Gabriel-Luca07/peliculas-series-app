const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSeriesTitle, buildMovieKey } = require('../lib/csv-import-utils');

test('extractSeriesTitle', async (t) => {
  await t.test('collapses a per-episode Netflix row to the series title', () => {
    const result = extractSeriesTitle('Stranger Things: Season 1: Chapter One');
    assert.deepEqual(result, { title: 'Stranger Things', type: 'serie' });
  });

  await t.test('recognizes the Spanish "Temporada" keyword too', () => {
    const result = extractSeriesTitle('La Casa de Papel: Temporada 3: Episodio 5');
    assert.deepEqual(result, { title: 'La Casa de Papel', type: 'serie' });
  });

  await t.test('is case-insensitive on the season keyword', () => {
    const result = extractSeriesTitle('Show Name: SEASON 2: Something');
    assert.equal(result.title, 'Show Name');
  });

  await t.test('returns null for a plain movie title (no series/season match)', () => {
    assert.equal(extractSeriesTitle('Inception'), null);
  });

  await t.test('returns null for a title with a colon but no season marker', () => {
    assert.equal(extractSeriesTitle('Mission: Impossible'), null);
  });
});

test('buildMovieKey', async (t) => {
  await t.test('combines type and lowercased/trimmed title', () => {
    assert.equal(buildMovieKey('serie', '  Stranger Things  '), 'serie::stranger things');
  });

  await t.test('defaults to "pelicula" when type is missing', () => {
    assert.equal(buildMovieKey(null, 'Inception'), 'pelicula::inception');
    assert.equal(buildMovieKey(undefined, 'Inception'), 'pelicula::inception');
  });

  await t.test('two duplicate rows (same title, different casing/whitespace) produce the same key', () => {
    // This is the scenario that caused the CSV-import duplicate-counting bug:
    // a series with many per-episode rows must all collapse to one key.
    const a = buildMovieKey('serie', 'Stranger Things');
    const b = buildMovieKey('serie', '  stranger things ');
    assert.equal(a, b);
  });

  await t.test('different types for the same title produce different keys', () => {
    assert.notEqual(buildMovieKey('pelicula', 'Dune'), buildMovieKey('serie', 'Dune'));
  });
});
