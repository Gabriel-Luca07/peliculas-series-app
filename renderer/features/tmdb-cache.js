// Per-profile cache of TMDB details shared by Novedades (new seasons/sequels),
// Viendo (episodes per season) and the dashboard's "Próximos estrenos" (next
// episode), so the same series is only fetched once a day no matter how many
// of them need it. Kept in memory and mirrored to localStorage; every writer
// mutates the same object, so concurrent refreshes can't overwrite each
// other's entries. Plain global-scope script — see updater.js for the
// load-order note.

/* ---------- TMDB details cache ---------- */

const TMDB_CACHE_TTL_MS = {
  tv: 24 * 60 * 60 * 1000,
  movie: 7 * 24 * 60 * 60 * 1000,
  collection: 24 * 60 * 60 * 1000,
};
const TMDB_CACHE_CONCURRENCY = 5;

let tmdbCacheMem = null;
const tmdbInFlight = new Map();

function tmdbCache() {
  if (!tmdbCacheMem) {
    try {
      tmdbCacheMem = JSON.parse(localStorage.getItem(pk('followups-tmdb-cache')) || '{}');
    } catch {
      tmdbCacheMem = {};
    }
  }
  return tmdbCacheMem;
}

function saveTmdbCache() {
  localStorage.setItem(pk('followups-tmdb-cache'), JSON.stringify(tmdbCache()));
}

function isTmdbEntryFresh(key, kind) {
  const entry = tmdbCache()[key];
  // Entries written before `nextEpisode` was cached count as stale.
  if (kind === 'tv' && entry && !('nextEpisode' in entry)) return false;
  return !!entry && (Date.now() - entry.ts) < TMDB_CACHE_TTL_MS[kind];
}

async function runWithConcurrency(items, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

// Fetches `key` with `fetcher` unless it's fresh (or `force`), sharing the
// request if another caller is already fetching the same key. Failed requests
// leave the old entry (if any) so the next refresh simply retries.
function fetchTmdbEntry(key, kind, force, fetcher) {
  if (!force && isTmdbEntryFresh(key, kind)) return Promise.resolve();
  if (tmdbInFlight.has(key)) return tmdbInFlight.get(key);
  const promise = (async () => {
    try {
      const entry = await fetcher();
      if (entry) tmdbCache()[key] = { ts: Date.now(), ...entry };
    } finally {
      tmdbInFlight.delete(key);
    }
  })();
  tmdbInFlight.set(key, promise);
  return promise;
}

async function fetchTvEntry(tmdbId) {
  const details = await window.api.getTmdbDetails(tmdbId, 'tv');
  if (!details || details.error) return null;
  return {
    poster: details.poster || '',
    seasons: details.seasonsList || [],
    nextEpisode: details.nextEpisode || null,
  };
}

async function fetchMovieEntry(tmdbId) {
  const details = await window.api.getTmdbDetails(tmdbId, 'movie');
  if (!details || details.error) return null;
  return { releaseDate: details.releaseDate, collectionId: details.collectionId };
}

async function fetchCollectionEntry(collectionId) {
  const res = await window.api.getTmdbCollection(collectionId);
  if (!res || res.error) return null;
  return { name: res.name, parts: res.parts };
}

async function refreshTmdbEntries(requests, force) {
  await runWithConcurrency(requests, TMDB_CACHE_CONCURRENCY,
    ({ key, kind, fetcher }) => fetchTmdbEntry(key, kind, force, fetcher));
  saveTmdbCache();
}

function refreshTvDetails(series, force = false) {
  return refreshTmdbEntries(series.map((m) => ({
    key: `tv:${m.tmdbId}`, kind: 'tv', fetcher: () => fetchTvEntry(m.tmdbId),
  })), force);
}

function refreshMovieDetails(films, force = false) {
  return refreshTmdbEntries(films.map((m) => ({
    key: `movie:${m.tmdbId}`, kind: 'movie', fetcher: () => fetchMovieEntry(m.tmdbId),
  })), force);
}

function refreshCollections(collectionIds, force = false) {
  return refreshTmdbEntries(collectionIds.map((id) => ({
    key: `collection:${id}`, kind: 'collection', fetcher: () => fetchCollectionEntry(id),
  })), force);
}

// Season list of a series from the cache (even if stale), or null.
function cachedSeasons(tmdbId) {
  const entry = tmdbId ? tmdbCache()[`tv:${tmdbId}`] : null;
  return entry ? entry.seasons : null;
}

// Season list for one series, fetching it first if it has never been cached.
async function seasonsFor(movie) {
  if (!movie.tmdbId) return null;
  if (!cachedSeasons(movie.tmdbId)) await refreshTvDetails([movie]);
  return cachedSeasons(movie.tmdbId);
}
