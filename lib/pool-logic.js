// Picking titles out of pools without repeating: the pager behind the
// dashboard recommendations' reload button, and the selection of titles for
// the lists in Recomendar. `random` defaults to Math.random; tests pass a
// seeded one.

function shuffle(arr, random = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makePager() {
  return { shuffled: null, cursor: 0 };
}

// Next `count` items of `pool`, walking a shuffled copy so consecutive pages
// don't repeat until the whole pool has been shown; then it reshuffles.
function nextPoolPage(pool, pager, count, random = Math.random) {
  if (!pool || !pool.length || count <= 0) return [];
  if (pool.length <= count) return shuffle(pool, random);
  if (!pager.shuffled || pager.cursor >= pager.shuffled.length) {
    pager.shuffled = shuffle(pool, random);
    pager.cursor = 0;
  }
  let page = pager.shuffled.slice(pager.cursor, pager.cursor + count);
  pager.cursor += count;
  if (page.length < count) {
    const remaining = pool.filter((r) => !page.some((p) => p.tmdbId === r.tmdbId));
    page = page.concat(shuffle(remaining, random).slice(0, count - page.length));
    pager.shuffled = null;
    pager.cursor = 0;
  }
  return page;
}

function toShareItem(m, source) {
  if (m.mediaType) {
    return { tmdbId: m.tmdbId, title: m.title, year: m.year, poster: m.poster, type: m.mediaType === 'tv' ? 'serie' : 'pelicula', source };
  }
  return { tmdbId: m.tmdbId || null, title: m.title, year: m.year, poster: m.poster, type: m.type, source };
}

// Titles for a Recomendar list. `options`: { types, genres, platforms (Sets),
// count, useRated, usePending, useDiscovery }. `sources`: { watched, pending,
// libraryTmdbIds (Set), discoveryMovies, discoveryTv }. `pagers`: { rated,
// pending, discovery } so "regenerate" gives different titles.
// Mostly your best rated and the pending titles closest to your favourite
// genres, with ~20% discovery (TMDB titles you don't have) for variety; if a
// source runs short, the others fill the gap.
function pickShareItems(options, sources, pagers, random = Math.random) {
  const wantMovie = options.types.has('pelicula');
  const wantTv = options.types.has('serie');
  const typeMatches = (m) => (m.type === 'pelicula' && wantMovie) || (m.type === 'serie' && wantTv);
  const genreMatches = (m) => !options.genres.size || (m.genres || []).some((g) => options.genres.has(g));
  const platformMatches = (m) => !options.platforms.size || options.platforms.has(m.platform);
  const matches = (m) => m.tmdbId && typeMatches(m) && genreMatches(m) && platformMatches(m);

  const ratedPool = options.useRated
    ? sources.watched.filter((m) => m.rating && matches(m)).sort((a, b) => b.rating - a.rating)
    : [];

  let pendingPool = [];
  if (options.usePending) {
    const genreWeight = {};
    sources.watched.filter((m) => m.rating).forEach((m) => {
      (m.genres || []).forEach((g) => { genreWeight[g] = (genreWeight[g] || 0) + m.rating; });
    });
    pendingPool = sources.pending
      .filter(matches)
      .map((m) => ({ m, score: (m.genres || []).reduce((s, g) => s + (genreWeight[g] || 0), 0) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  const discoveryPool = options.useDiscovery
    ? [
      ...(wantMovie ? sources.discoveryMovies || [] : []),
      ...(wantTv ? sources.discoveryTv || [] : []),
    ].filter((r) => !sources.libraryTmdbIds.has(r.tmdbId))
    : [];

  const hasMajoritySource = options.useRated || options.usePending;
  const discoveryQuota = options.useDiscovery && discoveryPool.length
    ? (hasMajoritySource ? Math.max(1, Math.round(options.count * 0.2)) : options.count)
    : 0;
  const majorityQuota = options.count - discoveryQuota;
  let ratedQuota = 0;
  let pendingQuota = 0;
  if (options.useRated && options.usePending) {
    ratedQuota = Math.ceil(majorityQuota / 2);
    pendingQuota = majorityQuota - ratedQuota;
  } else if (options.useRated) {
    ratedQuota = majorityQuota;
  } else if (options.usePending) {
    pendingQuota = majorityQuota;
  }

  const usedIds = new Set();
  const picks = [];
  function take(pool, pager, quota, source) {
    if (!pool.length || quota <= 0) return;
    nextPoolPage(pool, pager, Math.min(quota, pool.length), random).forEach((m) => {
      if (m.tmdbId && usedIds.has(m.tmdbId)) return;
      if (m.tmdbId) usedIds.add(m.tmdbId);
      picks.push(toShareItem(m, source));
    });
  }
  take(ratedPool, pagers.rated, ratedQuota, 'rated');
  take(pendingPool, pagers.pending, pendingQuota, 'pending');
  take(discoveryPool, pagers.discovery, discoveryQuota, 'discovery');

  let shortfall = options.count - picks.length;
  if (shortfall > 0) {
    const extras = [
      [ratedPool, pagers.rated, 'rated'],
      [pendingPool, pagers.pending, 'pending'],
      [discoveryPool, pagers.discovery, 'discovery'],
    ];
    for (const [pool, pager, source] of extras) {
      if (shortfall <= 0) break;
      if (!pool.length) continue;
      const extra = nextPoolPage(pool, pager, Math.min(shortfall, pool.length), random).filter((m) => !usedIds.has(m.tmdbId));
      extra.forEach((m) => {
        if (shortfall <= 0) return;
        usedIds.add(m.tmdbId);
        picks.push(toShareItem(m, source));
        shortfall--;
      });
    }
  }

  return shuffle(picks, random).slice(0, options.count);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shuffle, makePager, nextPoolPage, toShareItem, pickShareItems };
}
