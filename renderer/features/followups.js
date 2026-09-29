// "Novedades" tab: pending titles that are included in a subscription you
// have active, new seasons of series you've watched and sequels (next parts
// of the same TMDB collection) of movies you've watched, plus system
// notifications when something new shows up (also for new episodes of the
// series in Viendo). TMDB data comes from the shared cache in tmdb-cache.js;
// the matching itself lives in lib/followups-logic.js and
// lib/availability-logic.js. Plain global-scope script — see updater.js for
// the load-order note.

/* ---------- Novedades ---------- */

// While the app stays open, stale TMDB data is looked up again this often
// (each kind of entry still has its own cache lifetime).
const FOLLOWUPS_AUTO_REFRESH_MS = 3 * 60 * 60 * 1000;
// Pending titles that reached one of your platforms count as "new" (badge
// and highlight) for this many days.
const AVAILABILITY_NEW_DAYS = 7;

let followupsLoading = null;

function readStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(pk(key)) || 'null');
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  localStorage.setItem(pk(key), JSON.stringify(value));
}

function isPrefOn(key) {
  return localStorage.getItem(pk(key)) !== 'false';
}

function readDismissedFollowups() {
  try {
    return new Set(JSON.parse(localStorage.getItem(pk('followups-dismissed')) || '[]'));
  } catch {
    return new Set();
  }
}

function dismissFollowup(key) {
  const dismissed = readDismissedFollowups();
  dismissed.add(key);
  localStorage.setItem(pk('followups-dismissed'), JSON.stringify([...dismissed]));
}

function watchedWithTmdb(type) {
  return getWatched().filter((m) => m.type === type && m.tmdbId);
}

// Fetches whatever TMDB data is missing or stale for the watched titles, the
// series in progress (season lengths and new episodes for Viendo) and where
// each pending title streams.
async function refreshFollowupsData(force) {
  const series = movies.filter((m) => m.type === 'serie' && m.tmdbId && (m.status === 'vista' || m.status === 'viendo'));
  const films = watchedWithTmdb('pelicula');
  const pending = getPending().filter((m) => m.tmdbId);
  await Promise.all([
    refreshTvDetails(series, force),
    refreshMovieDetails(films, force),
    refreshProviders(pending, force),
  ]);

  const cache = tmdbCache();
  const collectionIds = [...new Set(films
    .map((m) => cache[`movie:${m.tmdbId}`] && cache[`movie:${m.tmdbId}`].collectionId)
    .filter(Boolean))];
  await refreshCollections(collectionIds, force);
}

// Builds the two lists shown in the view from the cache plus the current
// movie list (so adding a sequel or re-watching a series hides it right away).
function computeFollowups() {
  const cache = tmdbCache();
  const dismissed = readDismissedFollowups();
  const today = todayLocalDateString();

  const series = [];
  watchedWithTmdb('serie').forEach((m) => {
    const entry = cache[`tv:${m.tmdbId}`];
    if (!entry) return;
    const newSeasons = findNewSeasons(m, entry.seasons, today);
    if (!newSeasons.length) return;
    const lastSeason = newSeasons[newSeasons.length - 1].seasonNumber;
    const key = `tv:${m.tmdbId}:${lastSeason}`;
    if (dismissed.has(key)) return;
    // The card is about the first season they haven't seen; later ones are
    // only mentioned in the subtitle.
    const first = newSeasons[0];
    series.push({
      key,
      movieId: m.id,
      title: m.title,
      poster: m.poster || entry.poster || '',
      newSeasons,
      state: first.state,
      date: first.airDate,
      totalSeasons: Math.max(...entry.seasons.map((s) => s.seasonNumber)),
    });
  });

  const knownMovieIds = new Set(movies.filter((m) => m.tmdbId && m.type === 'pelicula').map((m) => m.tmdbId));
  const watchedByCollection = new Map();
  watchedWithTmdb('pelicula').forEach((m) => {
    const entry = cache[`movie:${m.tmdbId}`];
    if (!entry || !entry.collectionId) return;
    if (!watchedByCollection.has(entry.collectionId)) watchedByCollection.set(entry.collectionId, []);
    watchedByCollection.get(entry.collectionId).push({ tmdbId: m.tmdbId, title: m.title, releaseDate: entry.releaseDate });
  });

  const sequels = [];
  watchedByCollection.forEach((watchedParts, collectionId) => {
    const collection = cache[`collection:${collectionId}`];
    if (!collection) return;
    findSequels(watchedParts, collection.parts, knownMovieIds, today).forEach((p) => {
      const key = `movie:${p.tmdbId}`;
      if (dismissed.has(key)) return;
      sequels.push({ ...p, key, collectionName: collection.name, date: p.releaseDate });
    });
  });

  return {
    series: sortByRelease(series, (s) => s.date),
    sequels: sortByRelease(sequels, (s) => s.date),
  };
}

async function loadFollowups(force = false) {
  if (!settings.tmdbApiKey) {
    renderFollowups();
    return null;
  }
  if (followupsLoading) return followupsLoading;
  followupsLoading = (async () => {
    $('#followups-loading').classList.remove('hidden');
    try {
      await refreshFollowupsData(force);
    } finally {
      $('#followups-loading').classList.add('hidden');
      followupsLoading = null;
    }
    const switched = await syncAvailability();
    const fresh = trackAvailability(availabilityMatches());
    if (switched.length) fillPlatformSelects();
    renderFollowups();
    // Season lengths, new episodes and availability may have just arrived.
    renderViendo();
    renderPendientes();
    notifyNewFollowups();
    notifyAvailability(fresh, new Set(switched.map((m) => m.id)));
    notifyNewEpisodes();
  })();
  return followupsLoading;
}

function startFollowupsAutoRefresh() {
  startDigestTimer();
  setInterval(() => {
    loadFollowups();
    loadUpcomingReleases();
  }, FOLLOWUPS_AUTO_REFRESH_MS);
}

/* ---------- Pendientes en tus plataformas ---------- */

function availabilityMatches() {
  const ignored = new Set(readStoredJson('availability-ignored', []));
  return matchPendingToSubscriptions(getPending(), activeSubscriptionPlatforms(), ignored);
}

// Copies what TMDB says about where each pending title streams onto the
// title (availableOn) and, unless turned off in Ajustes, points its platform
// at the active subscription that includes it (remembering the old one so
// Novedades can undo it). Saves only if something changed. Returns the titles
// whose platform was switched.
async function syncAvailability() {
  const cache = tmdbCache();
  let changed = false;
  getPending().forEach((m) => {
    if (!m.tmdbId) return;
    const entry = cache[providersKey(m)];
    if (!entry) return;
    const availableOn = streamingPlatformsFor(entry.providers, normalizeProviderName);
    if (JSON.stringify(availableOn) !== JSON.stringify(m.availableOn || [])) {
      m.availableOn = availableOn;
      changed = true;
    }
  });

  const switched = [];
  if (isPrefOn('pref-auto-platform')) {
    const log = readStoredJson('availability-switched', {});
    availabilityMatches().forEach((match) => {
      if (!match.newPlatform) return;
      const movie = movies.find((m) => m.id === match.movieId);
      log[movie.id] = { from: movie.platform || '', to: match.newPlatform, date: todayLocalDateString() };
      movie.platform = match.newPlatform;
      switched.push(movie);
      changed = true;
    });
    if (switched.length) writeStoredJson('availability-switched', log);
  }
  if (changed) await saveMovies();
  return switched;
}

// Remembers the day each (title, platform) was first seen available and
// returns the matches that weren't there on the previous check.
function trackAvailability(matches) {
  const seen = readStoredJson('availability-seen', {});
  const { toNotify, notifiedKeys } = pickAvailabilityNotifications(matches, Object.keys(seen));
  const today = todayLocalDateString();
  const next = {};
  notifiedKeys.forEach((k) => { next[k] = seen[k] || today; });
  writeStoredJson('availability-seen', next);
  return toNotify;
}

function notifyAvailability(fresh, switchedIds) {
  if (!fresh.length || !isPrefOn('pref-availability-notify')) return;
  const lines = fresh.map((match) => {
    const movie = movies.find((m) => m.id === match.movieId);
    return `${movie ? movie.title : '?'}: incluida en ${match.platforms[0]}${switchedIds.has(match.movieId) ? ' (plataforma actualizada)' : ''}`;
  });
  const title = fresh.length === 1
    ? 'Un pendiente ya está en tus plataformas'
    : `${fresh.length} pendientes ya están en tus plataformas`;
  deliverNotification({ title, lines, view: 'novedades', movieId: fresh.length === 1 ? fresh[0].movieId : null });
}

// After activating (or losing) a subscription: look up whatever availability
// is missing and tell the user in the app itself what they can now watch
// (those don't raise a Windows notification later).
async function onActiveSubscriptionsChanged() {
  if (!settings.tmdbApiKey) return;
  await refreshProviders(getPending().filter((m) => m.tmdbId));
  const switched = await syncAvailability();
  const fresh = trackAvailability(availabilityMatches());
  if (switched.length) fillPlatformSelects();
  renderFollowups();
  renderPendientes();
  renderViendo();
  if (fresh.length) {
    const platforms = [...new Set(fresh.map((m) => m.platforms[0]))].join(', ');
    showToast(`${fresh.length} ${pluralize(fresh.length, 'pendiente')} ya ${fresh.length === 1 ? 'está' : 'están'} en ${platforms}`, 'success', {
      actions: [{ label: 'Ver', onAction: () => switchView('novedades') }],
      duration: 6000,
    });
  }
}

// Puts back the platform a title had before it was switched automatically,
// and stops switching that title to any of the platforms it's on now.
async function undoPlatformSwitch(movieId, platformsNow) {
  const log = readStoredJson('availability-switched', {});
  const entry = log[movieId];
  const movie = movies.find((m) => m.id === movieId);
  if (!entry || !movie) return;
  movie.platform = entry.from;
  delete log[movieId];
  writeStoredJson('availability-switched', log);
  const ignored = new Set(readStoredJson('availability-ignored', []));
  platformsNow.forEach((p) => ignored.add(`${movieId}:${p}`));
  writeStoredJson('availability-ignored', [...ignored]);
  await saveMovies();
  renderAll();
  showToast(`${movie.title}: vuelve a ${entry.from || 'sin plataforma'}`);
}

function computeAvailableItems() {
  const seen = readStoredJson('availability-seen', {});
  const log = readStoredJson('availability-switched', {});
  const dismissed = readDismissedFollowups();
  const newSince = shiftDateString(todayLocalDateString(), -AVAILABILITY_NEW_DAYS);
  const items = [];
  availabilityMatches().forEach((match) => {
    const movie = movies.find((m) => m.id === match.movieId);
    const key = `avail:${match.movieId}:${match.platforms[0]}`;
    if (!movie || dismissed.has(key)) return;
    const since = seen[`${match.movieId}:${match.platforms[0]}`] || null;
    const switchEntry = log[movie.id];
    items.push({
      key,
      movie,
      platforms: match.platforms,
      since,
      isNew: !!since && since >= newSince,
      switchedFrom: switchEntry && switchEntry.to === movie.platform ? switchEntry.from : null,
    });
  });
  return items.sort((a, b) => (b.since || '').localeCompare(a.since || '') || a.movie.title.localeCompare(b.movie.title, 'es'));
}

/* ---------- Episodios nuevos (Viendo) ---------- */

function computeNewEpisodes() {
  const cache = tmdbCache();
  const today = todayLocalDateString();
  const items = [];
  movies.filter((m) => m.status === 'viendo' && m.type === 'serie' && m.tmdbId).forEach((m) => {
    const ep = recentUnwatchedEpisode(m, cache[`tv:${m.tmdbId}`], today);
    if (!ep) return;
    items.push({ key: `ep:${m.tmdbId}:${ep.seasonNumber}:${ep.episodeNumber}`, state: 'released', movieId: m.id, title: m.title, episode: ep });
  });
  return items;
}

// One notification per new episode of a series in Viendo (the very first
// check only records what's there, like Novedades does).
function notifyNewEpisodes() {
  const items = computeNewEpisodes();
  const stored = readStoredJson('episodes-notified', null);
  const { toNotify, notifiedKeys } = pickNotifications(items, stored);
  writeStoredJson('episodes-notified', notifiedKeys.slice(-500));
  if (!toNotify.length || !isPrefOn('pref-episodes-notify')) return;
  const lines = toNotify.map((i) => `${i.title}: T${i.episode.seasonNumber} · E${i.episode.episodeNumber} ya disponible`);
  const title = toNotify.length === 1 ? 'Episodio nuevo de lo que estás viendo' : `${toNotify.length} episodios nuevos de lo que estás viendo`;
  deliverNotification({ title, lines, view: 'viendo', movieId: toNotify.length === 1 ? toNotify[0].movieId : null });
}

/* ---------- Notificaciones ---------- */

function followupNotificationLine(item) {
  if (item.newSeasons) {
    const season = item.newSeasons[0].seasonNumber;
    return item.state === 'released'
      ? `${item.title}: temporada ${season} ya disponible`
      : `${item.title}: temporada ${season} el ${formatFollowupDate(item.date)}`;
  }
  return item.state === 'released'
    ? `${item.title} ya está disponible`
    : `${item.title} se estrena el ${formatFollowupDate(item.date)}`;
}

// Shows one system notification with whatever is new since the last check
// (see pickNotifications for the rules). Opt-out in Ajustes.
function notifyNewFollowups() {
  if (!settings.tmdbApiKey) return;
  const { series, sequels } = computeFollowups();
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(pk('followups-notified')) || 'null');
  } catch {
    stored = null;
  }
  const { toNotify, notifiedKeys } = pickNotifications([...series, ...sequels], stored);
  localStorage.setItem(pk('followups-notified'), JSON.stringify(notifiedKeys));
  if (!toNotify.length || !isPrefOn('pref-followups-notify')) return;

  const lines = toNotify.map(followupNotificationLine);
  const title = toNotify.length === 1 ? 'Novedad de algo que has visto' : `${toNotify.length} novedades de lo que has visto`;
  // Sequels aren't in the list yet: only a new season names a title to open.
  deliverNotification({ title, lines, view: 'novedades', movieId: toNotify.length === 1 ? toNotify[0].movieId || null : null });
}

function formatFollowupDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function followupStateBadge(state, date) {
  if (state === 'released') return `<span class="followup-state released">Ya disponible${date ? ` · ${formatFollowupDate(date)}` : ''}</span>`;
  if (state === 'upcoming') return `<span class="followup-state upcoming">Estreno ${formatFollowupDate(date)}</span>`;
  return '<span class="followup-state announced">Anunciada, sin fecha</span>';
}

function seriesFollowupSubtitle(s) {
  const numbers = s.newSeasons.map((n) => n.seasonNumber);
  if (numbers.length === 1) return `Temporada ${numbers[0]}`;
  return `Temporadas ${numbers[0]}–${numbers[numbers.length - 1]}`;
}

function updateFollowupsBadge(count) {
  const badge = $('#followups-badge');
  badge.textContent = String(count);
  badge.classList.toggle('hidden', !count);
}

function renderAvailableItems(available) {
  $('#followups-available').innerHTML = available.map((a, i) => `
    <div class="followup-item${a.isNew ? ' is-new' : ''}" data-key="${escapeHtml(a.key)}" style="animation-delay:${Math.min(i, 20) * 30}ms">
      ${a.movie.poster ? `<img class="followup-poster" src="${escapeHtml(a.movie.poster)}" alt="">` : '<div class="followup-poster"></div>'}
      <div class="followup-info">
        <div class="followup-title">${escapeHtml(a.movie.title)}</div>
        <div class="followup-sub">${TYPE_LABELS[a.movie.type] || TYPE_LABELS.pelicula} · incluida en ${escapeHtml(a.platforms.join(', '))}</div>
        ${a.switchedFrom !== null ? `<div class="followup-sub">Plataforma cambiada a ${escapeHtml(a.movie.platform)}${a.switchedFrom ? ` (antes: ${escapeHtml(a.switchedFrom)})` : ''}</div>` : ''}
        ${a.isNew ? `<span class="followup-state released">Nuevo${a.since ? ` · ${formatFollowupDate(a.since)}` : ''}</span>` : ''}
      </div>
      <div class="followup-actions">
        ${a.switchedFrom !== null ? '<button class="btn followup-undo-platform" title="Volver a la plataforma que tenía">Deshacer cambio</button>' : ''}
        <button class="btn followup-open" title="Abrir la ficha"><svg class="icon"><use href="#icon-play"></use></svg>Ver ficha</button>
        <button class="icon-btn followup-dismiss" title="Descartar"><svg class="icon"><use href="#icon-x"></use></svg></button>
      </div>
    </div>
  `).join('');
}

function renderFollowups() {
  const { series, sequels } = computeFollowups();
  const available = computeAvailableItems();
  updateFollowupsBadge(series.filter((s) => s.state !== 'announced').length
    + sequels.filter((s) => s.state !== 'announced').length
    + available.filter((a) => a.isNew).length);

  const seriesEl = $('#followups-series');
  const sequelsEl = $('#followups-sequels');
  $('#followups-available-section').classList.toggle('hidden', !available.length);
  $('#followups-series-section').classList.toggle('hidden', !series.length);
  $('#followups-sequels-section').classList.toggle('hidden', !sequels.length);
  $('#followups-empty').classList.toggle('hidden', series.length > 0 || sequels.length > 0 || available.length > 0);
  $('#followups-empty').textContent = settings.tmdbApiKey
    ? 'No hay novedades. Aquí aparecerán tus pendientes que estén incluidos en alguna suscripción activa, las temporadas nuevas de tus series vistas y las secuelas de tus películas vistas (solo títulos con datos de TMDB).'
    : 'Configura tu clave de TMDB en Ajustes para detectar temporadas nuevas, secuelas y pendientes disponibles en tus plataformas.';
  renderAvailableItems(available);

  seriesEl.innerHTML = series.map((s, i) => `
    <div class="followup-item" data-key="${escapeHtml(s.key)}" style="animation-delay:${Math.min(i, 20) * 30}ms">
      ${s.poster ? `<img class="followup-poster" src="${s.poster}" alt="">` : '<div class="followup-poster"></div>'}
      <div class="followup-info">
        <div class="followup-title">${escapeHtml(s.title)}</div>
        <div class="followup-sub">${seriesFollowupSubtitle(s)} · la serie tiene ${s.totalSeasons} temporada${s.totalSeasons === 1 ? '' : 's'}</div>
        ${followupStateBadge(s.state, s.date)}
      </div>
      <div class="followup-actions">
        ${s.state === 'released' ? `<button class="btn followup-watch" title="Pasa la serie a «Viendo» en la temporada ${s.newSeasons[0].seasonNumber}"><svg class="icon"><use href="#icon-play"></use></svg>Empezar T${s.newSeasons[0].seasonNumber}</button>` : ''}
        <button class="icon-btn followup-dismiss" title="Descartar"><svg class="icon"><use href="#icon-x"></use></svg></button>
      </div>
    </div>
  `).join('');

  sequelsEl.innerHTML = sequels.map((p, i) => `
    <div class="followup-item" data-key="${escapeHtml(p.key)}" style="animation-delay:${Math.min(i, 20) * 30}ms">
      ${p.poster ? `<img class="followup-poster" src="${p.poster}" alt="">` : '<div class="followup-poster"></div>'}
      <div class="followup-info">
        <div class="followup-title">${escapeHtml(p.title)}</div>
        <div class="followup-sub">Continuación de ${escapeHtml(p.sequelOf)}${p.collectionName ? ` · ${escapeHtml(p.collectionName)}` : ''}</div>
        ${followupStateBadge(p.state, p.date)}
      </div>
      <div class="followup-actions">
        <button class="btn followup-add" title="Añadir a mi lista"><svg class="icon"><use href="#icon-plus"></use></svg>Añadir</button>
        <button class="icon-btn followup-dismiss" title="Descartar"><svg class="icon"><use href="#icon-x"></use></svg></button>
      </div>
    </div>
  `).join('');

  const byKey = new Map([...series, ...sequels, ...available].map((x) => [x.key, x]));
  const itemOf = (btn) => byKey.get(btn.closest('.followup-item').dataset.key);

  $$('#view-novedades .followup-open').forEach((btn) => {
    btn.addEventListener('click', () => openModal(itemOf(btn).movie.id));
  });

  $$('#view-novedades .followup-undo-platform').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = itemOf(btn);
      undoPlatformSwitch(a.movie.id, a.platforms);
    });
  });

  $$('#view-novedades .followup-dismiss').forEach((btn) => {
    btn.addEventListener('click', () => {
      dismissFollowup(itemOf(btn).key);
      renderFollowups();
    });
  });

  $$('#view-novedades .followup-watch').forEach((btn) => {
    btn.addEventListener('click', () => startNewSeason(itemOf(btn)));
  });

  $$('#view-novedades .followup-add').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = itemOf(btn);
      openModal(null);
      await applyTmdbResultToForm({
        tmdbId: p.tmdbId,
        mediaType: 'movie',
        title: p.title,
        year: p.releaseDate ? p.releaseDate.slice(0, 4) : '',
        poster: p.poster,
      });
    });
  });
}

// Moves a watched series back to "Viendo" at the first new season, keeping
// everything else (rating, platform...) and offering an undo.
async function startNewSeason(s) {
  const movie = movies.find((m) => m.id === s.movieId);
  if (!movie) return;
  const index = movies.indexOf(movie);
  const snapshot = { ...movie };
  const seasonNumber = s.newSeasons[0].seasonNumber;
  movie.status = 'viendo';
  movie.currentSeason = seasonNumber;
  movie.currentEpisode = null;
  movie.seasons = Math.max(Number(movie.seasons) || 0, s.totalSeasons);
  await saveMovies();
  renderAll();
  showToast(`${movie.title}: viendo la temporada ${seasonNumber}`, 'success', {
    actionLabel: 'Deshacer',
    onAction: async () => {
      movies[index] = snapshot;
      await saveMovies();
      renderAll();
    },
  });
}

function bindFollowupsEvents() {
  $('#btn-refresh-followups').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin-once');
    await loadFollowups(true);
    setTimeout(() => btn.classList.remove('spin-once'), 500);
  });
}
