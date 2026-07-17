// Shared CSV-import helpers (renderer-only, split out for testability).

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractSeriesTitle, buildMovieKey };
}
