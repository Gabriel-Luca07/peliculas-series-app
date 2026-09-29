// "Novedades" tab: new seasons of series you've watched and sequels (next
// parts of the same TMDB collection) of movies you've watched, plus a system
// notification when something new shows up. TMDB data comes from the shared
// cache in tmdb-cache.js; the matching itself lives in lib/followups-logic.js.
// Plain global-scope script — see updater.js for the load-order note.

/* ---------- Novedades ---------- */

let followupsLoading = null;

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

// Fetches whatever TMDB data is missing or stale for the watched titles (and
// the series in progress, whose season lengths the Viendo tab uses).
async function refreshFollowupsData(force) {
  const series = movies.filter((m) => m.type === 'serie' && m.tmdbId && (m.status === 'vista' || m.status === 'viendo'));
  const films = watchedWithTmdb('pelicula');
  await Promise.all([refreshTvDetails(series, force), refreshMovieDetails(films, force)]);

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
  if (followupsLoading) return followupsLoading;
  followupsLoading = (async () => {
    $('#followups-loading').classList.remove('hidden');
    try {
      await refreshFollowupsData(force);
    } finally {
      $('#followups-loading').classList.add('hidden');
      followupsLoading = null;
    }
    renderFollowups();
    // Season lengths may have just arrived for the series in progress.
    renderViendo();
    notifyNewFollowups();
  })();
  return followupsLoading;
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
  if (!toNotify.length || localStorage.getItem(pk('pref-followups-notify')) === 'false') return;

  const lines = toNotify.map(followupNotificationLine);
  const title = toNotify.length === 1 ? 'Novedad de algo que has visto' : `${toNotify.length} novedades de lo que has visto`;
  const body = lines.length > 3 ? `${lines.slice(0, 3).join('\n')}\n...y ${lines.length - 3} más` : lines.join('\n');
  window.api.notify(title, body, 'novedades');
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

function renderFollowups() {
  const { series, sequels } = computeFollowups();
  updateFollowupsBadge(series.filter((s) => s.state !== 'announced').length
    + sequels.filter((s) => s.state !== 'announced').length);

  const seriesEl = $('#followups-series');
  const sequelsEl = $('#followups-sequels');
  $('#followups-series-section').classList.toggle('hidden', !series.length);
  $('#followups-sequels-section').classList.toggle('hidden', !sequels.length);
  $('#followups-empty').classList.toggle('hidden', series.length > 0 || sequels.length > 0);
  $('#followups-empty').textContent = settings.tmdbApiKey
    ? 'No hay novedades de lo que has visto. Aquí aparecerán las temporadas nuevas de tus series vistas y las secuelas de tus películas vistas (solo títulos con datos de TMDB).'
    : 'Configura tu clave de TMDB en Ajustes para detectar temporadas nuevas y secuelas.';

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

  const byKey = new Map([...series, ...sequels].map((x) => [x.key, x]));
  const itemOf = (btn) => byKey.get(btn.closest('.followup-item').dataset.key);

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
