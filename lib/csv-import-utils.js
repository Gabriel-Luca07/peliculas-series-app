// History-import helpers (renderer-only, split out for testability): CSV
// parsing, and turning the exports of Netflix, Letterboxd, IMDb and Trakt
// into plain import records:
//   { title, type: 'pelicula'|'serie', year, date, rating (1-10), status:
//     'vista'|'pendiente', tmdbId, tags }
// (any of them but title/type/status can be null/[]).

// Netflix-style viewing history exports one row per episode, titled like
// "Stranger Things: Season 1: Chapter One" — collapse those down to the series
// itself instead of importing one row per episode as a separate title.
function extractSeriesTitle(rawTitle) {
  const m = rawTitle.match(/^(.*?):\s*(Season|Temporada)\s+\d+/i);
  if (m) return { title: m[1].trim(), type: 'serie' };
  return null;
}

// Canonical dedup key for matching an imported row against existing movies (or
// other rows in the same import) — used consistently by both the "how many
// will be added/updated" preview count and the actual import pass, so they
// agree with each other (a CSV with duplicate titles, e.g. many episodes of
// the same series, must count and import the same way).
function buildMovieKey(type, title) {
  return `${type || 'pelicula'}::${title.trim().toLowerCase()}`;
}

// RFC 4180-ish CSV: quoted fields with "" escapes and newlines inside quotes,
// \n or \r\n line endings, blank lines skipped. First row is the header.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return { headers, rows };
}

// 'YYYY-MM-DD' from ISO dates/timestamps or d/m/y (m/d/y when the day can't
// be the first number), or null.
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = (Number(y) < 70 ? '20' : '19') + y;
    const day = Number(a) > 12 ? a : (Number(b) > 12 ? b : a);
    const month = Number(a) > 12 ? b : (Number(b) > 12 ? a : b);
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function headerIndex(headers, name) {
  const wanted = name.toLowerCase();
  return headers.findIndex((h) => h.trim().replace(/^﻿/, '').toLowerCase() === wanted);
}

function yearOf(raw) {
  const m = String(raw || '').match(/\d{4}/);
  return m ? m[0] : '';
}

// Rating on the app's 1-10 scale, rounded to a whole number, or null.
function scaleRating(raw, multiplier) {
  const n = Number(String(raw || '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(10, Math.max(1, Math.round(n * multiplier)));
}

function splitTags(raw) {
  return String(raw || '').split(',').map((t) => t.trim()).filter(Boolean);
}

function importRecord(fields) {
  return {
    title: fields.title,
    type: fields.type || 'pelicula',
    year: fields.year || '',
    date: fields.date || null,
    rating: fields.rating || null,
    status: fields.status || 'vista',
    tmdbId: fields.tmdbId || null,
    tags: fields.tags || [],
  };
}

// Letterboxd (films only): watched.csv / watchlist.csv / ratings.csv /
// diary.csv. The watchlist has the same columns as watched.csv, so only the
// file name tells them apart. Ratings are 0.5-5 stars.
function parseLetterboxd(headers, rows, fileName) {
  const col = (name) => headerIndex(headers, name);
  const nameIdx = col('Name');
  const yearIdx = col('Year');
  const ratingIdx = col('Rating');
  const tagsIdx = col('Tags');
  const watchedDateIdx = col('Watched Date');
  const dateIdx = watchedDateIdx >= 0 ? watchedDateIdx : col('Date');
  const isWatchlist = /watchlist/i.test(fileName || '');
  let label = 'Letterboxd (películas vistas)';
  if (isWatchlist) label = 'Letterboxd (lista para ver)';
  else if (watchedDateIdx >= 0) label = 'Letterboxd (diario)';
  else if (ratingIdx >= 0) label = 'Letterboxd (valoraciones)';

  const records = rows
    .filter((r) => (r[nameIdx] || '').trim())
    .map((r) => importRecord({
      title: r[nameIdx].trim(),
      year: yearOf(r[yearIdx]),
      date: isWatchlist ? null : normalizeDate(r[dateIdx]),
      rating: isWatchlist || ratingIdx < 0 ? null : scaleRating(r[ratingIdx], 2),
      status: isWatchlist ? 'pendiente' : 'vista',
      tags: tagsIdx >= 0 ? splitTags(r[tagsIdx]) : [],
    }));
  return { format: { id: 'letterboxd', label }, records };
}

// IMDb title types to the app's types; null for what isn't a film or series
// (episodes, games, podcasts...).
function imdbType(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, '');
  if (!t) return 'pelicula';
  if (t.includes('episode') || t.includes('game') || t.includes('podcast')) return null;
  if (t.includes('series')) return 'serie';
  return 'pelicula';
}

// IMDb: ratings.csv (Your Rating, Date Rated) or a list/watchlist export
// (it has a Position column, and those are titles still to watch).
function parseImdb(headers, rows) {
  const col = (name) => headerIndex(headers, name);
  const titleIdx = col('Title');
  const typeIdx = col('Title Type');
  const yearIdx = col('Year');
  const ratingIdx = col('Your Rating');
  const dateIdx = col('Date Rated');
  const isList = col('Position') >= 0;
  const label = isList ? 'IMDb (lista para ver)' : 'IMDb (valoraciones)';

  const records = [];
  rows.forEach((r) => {
    const title = (r[titleIdx] || '').trim();
    const type = imdbType(r[typeIdx]);
    if (!title || !type) return;
    records.push(importRecord({
      title,
      type,
      year: yearOf(r[yearIdx]),
      date: isList ? null : normalizeDate(r[dateIdx]),
      rating: isList ? null : scaleRating(r[ratingIdx], 1),
      status: isList ? 'pendiente' : 'vista',
    }));
  });
  return { format: { id: 'imdb', label }, records };
}

// Trakt's data export (JSON files like watched-movies.json, history.json,
// ratings-shows.json, watchlist.json): arrays of items with a `movie` or
// `show` object that carries the TMDB id. Episodes collapse into their show.
function parseTrakt(items) {
  const records = [];
  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const media = item.movie || item.show;
    if (!media || !media.title) return;
    const onWatchlist = !!item.listed_at;
    records.push(importRecord({
      title: String(media.title).trim(),
      type: item.movie ? 'pelicula' : 'serie',
      year: media.year ? String(media.year) : '',
      date: onWatchlist ? null : normalizeDate(item.last_watched_at || item.watched_at || item.rated_at),
      rating: onWatchlist ? null : scaleRating(item.rating, 1),
      status: onWatchlist ? 'pendiente' : 'vista',
      tmdbId: media.ids && Number(media.ids.tmdb) ? Number(media.ids.tmdb) : null,
    }));
  });
  return { format: { id: 'trakt', label: 'Trakt' }, records };
}

// Recognises a known export from its contents (and, for Letterboxd's
// watchlist, its file name). Returns { format, records } for a known format;
// for any other CSV, { format: null, headers, rows } so the user maps the
// columns by hand. Returns { error: 'INVALID' } when it can't be read at all.
function parseImportFile(text, fileName) {
  const clean = String(text || '').replace(/^﻿/, '');
  const trimmed = clean.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      const items = Array.isArray(json) ? json : null;
      if (items && items.some((i) => i && (i.movie || i.show))) return parseTrakt(items);
    } catch {
      // not JSON after all: fall through to CSV
    }
    return { error: 'INVALID' };
  }
  const { headers, rows } = parseCsv(clean);
  if (!headers.length || !rows.length) return { error: 'INVALID' };
  if (headerIndex(headers, 'Letterboxd URI') >= 0 && headerIndex(headers, 'Name') >= 0) {
    return parseLetterboxd(headers, rows, fileName);
  }
  if (headerIndex(headers, 'Const') >= 0 && headerIndex(headers, 'Title Type') >= 0) {
    return parseImdb(headers, rows);
  }
  return { format: null, headers, rows };
}

// Records from a CSV of unknown format with the columns the user picked
// (titleIdx, dateIdx or -1, defaultType). Netflix-style episode rows become
// their series.
function recordsFromMappedCsv(rows, { titleIdx, dateIdx, defaultType }) {
  const records = [];
  rows.forEach((row) => {
    const raw = (row[titleIdx] || '').trim();
    if (!raw) return;
    const parsed = extractSeriesTitle(raw) || { title: raw, type: defaultType };
    records.push(importRecord({
      title: parsed.title,
      type: parsed.type,
      date: dateIdx >= 0 ? normalizeDate(row[dateIdx]) : null,
    }));
  });
  return records;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractSeriesTitle, buildMovieKey, parseCsv, normalizeDate, parseImportFile, recordsFromMappedCsv,
  };
}
