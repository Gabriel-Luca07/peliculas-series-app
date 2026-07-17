// "Recomendar" tab: the recommendation pool/pager shown in the dashboard and
// the Recomendar view. Plain global-scope script — see updater.js for the
// load-order note.

/* ---------- Recommendations ---------- */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makePager() {
  return { shuffled: null, cursor: 0 };
}
const moviePager = makePager();
const tvPager = makePager();

function nextPoolPage(pool, pager, count) {
  if (!pool || !pool.length || count <= 0) return [];
  if (pool.length <= count) return shuffle(pool);
  if (!pager.shuffled || pager.cursor >= pager.shuffled.length) {
    pager.shuffled = shuffle(pool);
    pager.cursor = 0;
  }
  let page = pager.shuffled.slice(pager.cursor, pager.cursor + count);
  pager.cursor += count;
  if (page.length < count) {
    const remaining = pool.filter((r) => !page.some((p) => p.tmdbId === r.tmdbId));
    page = page.concat(shuffle(remaining).slice(0, count - page.length));
    pager.shuffled = null;
    pager.cursor = 0;
  }
  return page;
}

function nextRecommendationsPage() {
  const tvCount = recommendationsTvPool && recommendationsTvPool.length
    ? Math.min(RECS_TV_QUOTA, recommendationsTvPool.length) : 0;
  const movieCount = RECS_DISPLAY_COUNT - tvCount;
  const moviePage = nextPoolPage(recommendationsMoviePool, moviePager, movieCount);
  const tvPage = nextPoolPage(recommendationsTvPool, tvPager, tvCount);
  return shuffle([...moviePage, ...tvPage]);
}

async function loadRecommendations() {
  const rated = getWatched()
    .filter((m) => m.rating && m.tmdbId)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4);
  const signature = rated.map((m) => `${m.tmdbId}:${m.mediaType}:${m.rating}`).join(',');
  if (signature !== recommendationsSignature) {
    recommendationsMoviePool = null;
    recommendationsTvPool = null;
    recommendationsSignature = signature;
  }

  if (recommendationsMoviePool && recommendationsTvPool) {
    recommendationsCache = nextRecommendationsPage();
    renderRecommendationsSection();
    return;
  }

  const existingTmdbIds = new Set(movies.filter((m) => m.tmdbId).map((m) => m.tmdbId));
  const seenMovie = new Set();
  const seenTv = new Set();
  const moviePool = [];
  const tvPool = [];

  function addResult(r) {
    if (existingTmdbIds.has(r.tmdbId)) return;
    if (r.mediaType === 'tv') {
      if (seenTv.has(r.tmdbId)) return;
      seenTv.add(r.tmdbId);
      tvPool.push(r);
    } else {
      if (seenMovie.has(r.tmdbId)) return;
      seenMovie.add(r.tmdbId);
      moviePool.push(r);
    }
  }

  for (const m of rated) {
    const res = await window.api.getRecommendations(m.tmdbId, m.mediaType);
    if (res && res.results) res.results.forEach(addResult);
  }

  // Prefer discovery from a platform you currently have active (actually watchable right now)
  // over generic trending, when we can resolve at least one active platform to a TMDB provider.
  const activeProviderIds = subscriptions
    .filter((s) => s.active)
    .map((s) => resolveProviderId(s.platform))
    .filter(Boolean);

  let discovery = activeProviderIds.length
    ? await window.api.discoverByProviders(activeProviderIds, ['movie', 'tv'])
    : null;
  const hasDiscoveryResults = discovery && !discovery.error
    && ((discovery.movies && discovery.movies.length) || (discovery.tv && discovery.tv.length));
  if (!hasDiscoveryResults) {
    discovery = await window.api.getTrending();
  }
  if (discovery && !discovery.error) {
    (discovery.movies || []).forEach(addResult);
    (discovery.tv || []).forEach(addResult);
  }

  recommendationsMoviePool = moviePool;
  recommendationsTvPool = tvPool;
  recommendationsCache = nextRecommendationsPage();
  renderRecommendationsSection();
}

function renderRecommendationsSection() {
  const listEl = $('#recommendations-list');
  const emptyEl = $('#recommendations-empty');
  if (!listEl || !emptyEl) return;
  if (!recommendationsCache || !recommendationsCache.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.innerHTML = recommendationsCache.map((r, i) => `
    <div class="rec-item" data-idx="${i}" style="animation-delay:${i * 40}ms">
      ${r.poster ? `<img class="rec-poster" src="${r.poster}" alt="${escapeHtml(r.title)}">` : `<div class="rec-poster">${escapeHtml(r.title)}</div>`}
      <button class="rec-add" title="Añadir a mi lista"><svg class="icon"><use href="#icon-plus"></use></svg></button>
      <div class="rec-title">${escapeHtml(r.title)}</div>
      <div class="rec-year">${escapeHtml(r.year)}</div>
    </div>
  `).join('');
  listEl.querySelectorAll('.rec-add').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = recommendationsCache[Number(btn.closest('.rec-item').dataset.idx)];
      openModal(null);
      await applyTmdbResultToForm(item);
    });
  });
}

