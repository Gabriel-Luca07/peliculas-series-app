// Merging titles into the current list without duplicates: import records
// (lib/csv-import-utils.js) from Netflix/Letterboxd/IMDb/Trakt, and the
// titles of a backup from another profile or computer. Both work on copies
// and return the new list plus counts, so the caller can show a preview
// before saving anything. Loaded as a classic <script> in the renderer (after
// csv-import-utils.js) and required as a CommonJS module from the tests.

const mergeImportUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./csv-import-utils')
  : { buildMovieKey };

const STATUS_RANK = { pendiente: 0, viendo: 1, vista: 2 };

function mediaTypeFor(type) {
  return type === 'serie' ? 'tv' : 'movie';
}

// Finds titles already in a list: by TMDB id when both sides have one,
// otherwise by type + title, where two different known years (a remake) or
// two different TMDB ids mean it's another title.
function createTitleIndex(list) {
  const byTmdb = new Map();
  const byTitle = new Map();
  const add = (m) => {
    if (m.tmdbId) byTmdb.set(`${m.type || 'pelicula'}:${Number(m.tmdbId)}`, m);
    const key = mergeImportUtils.buildMovieKey(m.type, m.title || '');
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(m);
  };
  const find = (item) => {
    const type = item.type || 'pelicula';
    if (item.tmdbId) {
      const hit = byTmdb.get(`${type}:${Number(item.tmdbId)}`);
      if (hit) return hit;
    }
    const candidates = byTitle.get(mergeImportUtils.buildMovieKey(type, item.title || '')) || [];
    return candidates.find((m) => {
      if (item.tmdbId && m.tmdbId && Number(item.tmdbId) !== Number(m.tmdbId)) return false;
      if (item.year && m.year && String(item.year) !== String(m.year)) return false;
      return true;
    }) || null;
  };
  list.forEach(add);
  return { add, find };
}

function unionTags(a, b) {
  return [...new Set([...(a || []), ...(b || [])])];
}

// Platform an imported watch should set on an existing title: only when the
// title had no real platform yet (or it wasn't watched until now), and never
// replacing a known one with "No recuerdo".
function shouldTakeImportPlatform(movie, platform, wasWatched) {
  if (!platform || movie.platform === platform) return false;
  if (platform === 'No recuerdo' && movie.platform) return false;
  return !wasWatched || !movie.platform || movie.platform === 'No recuerdo';
}

// Applies import records to `movies`. Watched records mark the title as
// watched (keeping the most recent date, and adding rating/tags/TMDB id when
// the title didn't have them); pending ones only add titles that aren't in
// the list yet. `platform` is where the watched ones were seen.
function applyImportRecords(movies, records, { platform, today, now, newId }) {
  const result = movies.map((m) => ({ ...m }));
  const index = createTitleIndex(result);
  const addedIds = new Set();
  const updatedIds = new Set();
  const matchedIds = new Set();

  records.forEach((rec) => {
    const existing = index.find(rec);
    if (!existing) {
      const watched = rec.status === 'vista';
      const movie = {
        id: newId(),
        tmdbId: rec.tmdbId || null,
        mediaType: rec.tmdbId ? mediaTypeFor(rec.type) : null,
        type: rec.type,
        title: rec.title,
        year: rec.year || '',
        runtime: null,
        seasons: null,
        genres: [],
        tags: rec.tags || [],
        poster: '',
        platform: watched ? (platform || '') : '',
        status: rec.status,
        rating: watched ? (rec.rating || null) : null,
        notes: '',
        dateWatched: watched ? (rec.date || today) : null,
        watchCount: watched ? 1 : null,
        dateAdded: now,
      };
      result.push(movie);
      index.add(movie);
      addedIds.add(movie.id);
      return;
    }

    matchedIds.add(existing.id);
    if (addedIds.has(existing.id)) {
      // Same title again in this import (another episode, a rewatch...).
      if (rec.status === 'vista' && rec.date && (!existing.dateWatched || rec.date > existing.dateWatched)) {
        existing.dateWatched = rec.date;
      }
      if (rec.rating && !existing.rating && existing.status === 'vista') existing.rating = rec.rating;
      existing.tags = unionTags(existing.tags, rec.tags);
      return;
    }

    const before = JSON.stringify(existing);
    if (rec.status === 'vista') {
      const wasWatched = existing.status === 'vista';
      if (!wasWatched) {
        existing.status = 'vista';
        existing.currentSeason = null;
        existing.currentEpisode = null;
        existing.watchCount = existing.watchCount || 1;
        existing.dateWatched = rec.date || today;
      } else if (rec.date && (!existing.dateWatched || rec.date > existing.dateWatched)) {
        existing.dateWatched = rec.date;
      }
      if (shouldTakeImportPlatform(existing, platform, wasWatched)) existing.platform = platform;
      if (rec.rating && !existing.rating) existing.rating = rec.rating;
    }
    if (rec.tmdbId && !existing.tmdbId) {
      existing.tmdbId = rec.tmdbId;
      existing.mediaType = mediaTypeFor(existing.type);
    }
    if (rec.year && !existing.year) existing.year = rec.year;
    if (rec.tags && rec.tags.length) existing.tags = unionTags(existing.tags, rec.tags);
    if (JSON.stringify(existing) !== before) updatedIds.add(existing.id);
  });

  const unchanged = [...matchedIds].filter((id) => !updatedIds.has(id) && !addedIds.has(id)).length;
  return { movies: result, added: addedIds.size, updated: updatedIds.size, unchanged };
}

const FILLABLE_FIELDS = ['tmdbId', 'mediaType', 'year', 'runtime', 'seasons', 'poster', 'platform'];

// Merges the titles of a backup into `movies`. For a title on both sides the
// most advanced status wins (watched > watching > pending) with its own
// details; between two watched copies the latest date, the higher watch count
// and any rating/notes are kept; empty fields are filled from the backup.
function mergeBackupMovies(movies, incoming, newId) {
  const result = movies.map((m) => ({ ...m }));
  const index = createTitleIndex(result);
  const usedIds = new Set(result.map((m) => m.id));
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  (incoming || []).forEach((raw) => {
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return;
    const inc = { ...raw, type: raw.type || 'pelicula', status: STATUS_RANK[raw.status] !== undefined ? raw.status : 'pendiente' };
    const existing = index.find(inc);
    if (!existing) {
      const copy = { ...inc, id: inc.id && !usedIds.has(inc.id) ? inc.id : newId() };
      usedIds.add(copy.id);
      result.push(copy);
      index.add(copy);
      added += 1;
      return;
    }

    const before = JSON.stringify(existing);
    const rankExisting = STATUS_RANK[existing.status] || 0;
    const rankIncoming = STATUS_RANK[inc.status];
    if (rankIncoming > rankExisting) {
      ['status', 'currentSeason', 'currentEpisode', 'rating', 'notes', 'dateWatched', 'watchCount'].forEach((f) => {
        existing[f] = inc[f] !== undefined ? inc[f] : null;
      });
    } else if (rankIncoming === rankExisting && inc.status === 'vista') {
      if (inc.dateWatched && (!existing.dateWatched || inc.dateWatched > existing.dateWatched)) existing.dateWatched = inc.dateWatched;
      existing.watchCount = Math.max(existing.watchCount || 1, inc.watchCount || 1);
      if (!existing.rating && inc.rating) existing.rating = inc.rating;
      if (!existing.notes && inc.notes) existing.notes = inc.notes;
    } else if (rankIncoming === rankExisting && inc.status === 'viendo') {
      const progress = (m) => [Number(m.currentSeason) || 0, Number(m.currentEpisode) || 0];
      const [es, ee] = progress(existing);
      const [is, ie] = progress(inc);
      if (is > es || (is === es && ie > ee)) {
        existing.currentSeason = inc.currentSeason;
        existing.currentEpisode = inc.currentEpisode;
      }
    }
    FILLABLE_FIELDS.forEach((f) => {
      if (!existing[f] && inc[f]) existing[f] = inc[f];
    });
    if ((!existing.genres || !existing.genres.length) && inc.genres && inc.genres.length) existing.genres = inc.genres;
    if (inc.tags && inc.tags.length) existing.tags = unionTags(existing.tags, inc.tags);

    if (JSON.stringify(existing) !== before) updated += 1;
    else unchanged += 1;
  });

  return { movies: result, added, updated, unchanged };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTitleIndex, applyImportRecords, mergeBackupMovies };
}
