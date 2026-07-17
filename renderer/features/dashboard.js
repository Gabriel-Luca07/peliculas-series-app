// Dashboard stats/charts, anniversary banner, "Wrapped" (yearly recap), and
// upcoming-releases panel. Plain global-scope script — see updater.js for the
// load-order note.

/* ---------- Dashboard ---------- */

function computeStreak(watched) {
  const dayMs = 86400000;
  const daySet = new Set(watched.map((m) => m.dateWatched).filter(Boolean));
  const days = [...daySet].sort();
  if (!days.length) return { current: 0, longest: 0 };

  const toUtcMs = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    const diff = Math.round((toUtcMs(days[i]) - toUtcMs(days[i - 1])) / dayMs);
    if (diff === 1) run += 1; else run = 1;
    longest = Math.max(longest, run);
  }

  const todayStr = todayLocalDateString();
  const yesterdayStr = localDateStringAt(Date.now() - dayMs);
  let cursorMs;
  if (daySet.has(todayStr)) cursorMs = toUtcMs(todayStr);
  else if (daySet.has(yesterdayStr)) cursorMs = toUtcMs(yesterdayStr);
  else return { current: 0, longest };

  let current = 0;
  while (daySet.has(new Date(cursorMs).toISOString().slice(0, 10))) {
    current += 1;
    cursorMs -= dayMs;
  }
  return { current, longest };
}

function renderDashboard() {
  const pending = getPending();
  const watched = getWatched();
  const rated = watched.filter((m) => m.rating);
  const avgRating = rated.length ? (rated.reduce((s, m) => s + m.rating, 0) / rated.length).toFixed(1) : '—';
  const watchedMovies = watched.filter((m) => m.type !== 'serie');
  const watchedSeries = watched.filter((m) => m.type === 'serie');
  const totalMinutes = watchedMovies.reduce((s, m) => s + (Number(m.runtime) || 0), 0);
  const totalHours = Math.round(totalMinutes / 60);
  const totalSeriesMinutes = watchedSeries.reduce((s, m) => s + (Number(m.runtime) || 0), 0);
  const totalSeriesHours = Math.round(totalSeriesMinutes / 60);
  const totalSeasonsWatched = watchedSeries.reduce((s, m) => s + (Number(m.seasons) || 0), 0);
  const pendingMovies = pending.filter((m) => m.type !== 'serie').length;
  const pendingSeries = pending.filter((m) => m.type === 'serie').length;

  const now = Date.now();
  const pendingAges = pending
    .filter((m) => m.dateAdded)
    .map((m) => ({ movie: m, days: Math.floor((now - new Date(m.dateAdded).getTime()) / 86400000) }));
  const avgAge = pendingAges.length ? Math.round(pendingAges.reduce((s, p) => s + p.days, 0) / pendingAges.length) : 0;
  const oldest = pendingAges.length ? pendingAges.reduce((a, b) => (b.days > a.days ? b : a)) : null;
  const streak = computeStreak(watched);

  $('#stat-grid').innerHTML = `
    <div class="stat-tile">
      <div class="stat-label">Pendientes</div>
      <div class="stat-value"><span class="stat-num" data-target="${pending.length}">0</span></div>
      <div class="stat-sub">${pendingMovies} película${pendingMovies === 1 ? '' : 's'} · ${pendingSeries} serie${pendingSeries === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Vistas</div>
      <div class="stat-value"><span class="stat-num" data-target="${watched.length}">0</span></div>
      <div class="stat-sub">${rated.length} valorada${rated.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Películas vistas</div>
      <div class="stat-value"><span class="stat-num" data-target="${watchedMovies.length}">0</span></div>
      <div class="stat-sub">${watchedMovies.length ? `${Math.round((watchedMovies.length / watched.length) * 100)}% de tus vistas` : 'sin películas vistas'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Horas vistas (películas)</div>
      <div class="stat-value"><span class="stat-num" data-target="${totalHours}">0</span><span style="font-size:15px;color:var(--text-muted)"> h</span></div>
      <div class="stat-sub">${totalMinutes ? `${totalMinutes.toLocaleString('es-ES')} min en total` : 'añade duración a tus películas'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Series vistas</div>
      <div class="stat-value"><span class="stat-num" data-target="${watchedSeries.length}">0</span></div>
      <div class="stat-sub">${totalSeasonsWatched ? `${totalSeasonsWatched} temporada${totalSeasonsWatched === 1 ? '' : 's'} en total` : 'añade el número de temporadas'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Horas vistas (series)</div>
      <div class="stat-value"><span class="stat-num" data-target="${totalSeriesHours}">0</span><span style="font-size:15px;color:var(--text-muted)"> h</span></div>
      <div class="stat-sub">${totalSeriesMinutes ? `${totalSeriesMinutes.toLocaleString('es-ES')} min en total` : 'añade duración total a tus series'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Valoración media</div>
      <div class="stat-value">${avgRating}${rated.length ? '<span style="font-size:15px;color:var(--text-muted)">/10</span>' : ''}</div>
      <div class="stat-sub">sobre ${rated.length} título${rated.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Antigüedad media</div>
      <div class="stat-value"><span class="stat-num" data-target="${avgAge}">0</span><span style="font-size:15px;color:var(--text-muted)"> días</span></div>
      <div class="stat-sub">${oldest ? `La más antigua: "${escapeHtml(oldest.movie.title)}" (${oldest.days} días)` : 'sin pendientes'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-label">Racha actual</div>
      <div class="stat-value"><span class="stat-num" data-target="${streak.current}">0</span><span style="font-size:15px;color:var(--text-muted)"> día${streak.current === 1 ? '' : 's'}</span></div>
      <div class="stat-sub">${streak.longest > streak.current ? `Récord: ${streak.longest} días` : streak.longest > 0 ? '¡Tu mejor racha!' : 'Marca algo como visto hoy'}</div>
    </div>
  `;
  animateStatNumbers();

  renderGenreChart(watched);
  renderPlatformChart(pending);
  renderRatingHistogram(rated);
  renderActivityChart(watched);
  renderYearChart(watched);
  renderEraChart(watched);
  renderRecommendationsSection();
  renderUpcomingSection();
  renderAnniversaryBanner(watched);
  updatePickText();
}

/* ---------- Anniversary banner ---------- */

function renderAnniversaryBanner(watched) {
  const banner = $('#anniversary-banner');
  if (localStorage.getItem(pk('pref-anniv-enabled')) === 'false') {
    banner.classList.add('hidden');
    return;
  }
  const today = new Date();
  const todayKey = todayLocalDateString();
  if (localStorage.getItem(pk('anniv-dismissed')) === todayKey) {
    banner.classList.add('hidden');
    return;
  }
  const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const matches = watched
    .filter((m) => m.dateWatched && m.dateWatched.slice(5, 10) === todayMD && m.dateWatched.slice(0, 4) !== String(today.getFullYear()))
    .map((m) => ({ movie: m, years: today.getFullYear() - Number(m.dateWatched.slice(0, 4)) }))
    .sort((a, b) => a.years - b.years);

  if (!matches.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const { movie, years } = matches[0];
  banner.innerHTML = `
    <svg class="icon"><use href="#icon-gift"></use></svg>
    <span>Hace ${years} año${years === 1 ? '' : 's'} viste <strong>${escapeHtml(movie.title)}</strong>${movie.rating ? ` — le pusiste ${movie.rating}/10` : ''}.</span>
    <button class="anniv-dismiss" title="Descartar"><svg class="icon"><use href="#icon-x"></use></svg></button>
  `;
  banner.classList.remove('hidden');
  banner.querySelector('.anniv-dismiss').addEventListener('click', () => {
    localStorage.setItem(pk('anniv-dismissed'), todayKey);
    banner.classList.add('hidden');
  });
}


/* ---------- Wrapped (resumen anual) ---------- */

function openWrappedModal() {
  const years = [...new Set(getWatched().map((m) => (m.dateWatched || '').slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const currentYear = String(new Date().getFullYear());
  if (!years.length) years.push(currentYear);
  const yearSelect = $('#wrapped-year');
  yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = years.includes(currentYear) ? currentYear : years[0];
  renderWrappedContent(yearSelect.value);
  showOverlay($('#wrapped-overlay'));
}

function closeWrappedModal() {
  hideOverlay($('#wrapped-overlay'));
}

function renderWrappedContent(year) {
  const content = $('#wrapped-content');
  const watchedYear = getWatched().filter((m) => (m.dateWatched || '').startsWith(year));

  if (!watchedYear.length) {
    content.innerHTML = `<p class="wrapped-empty">No has marcado nada como visto en ${year}.</p>`;
    return;
  }

  const totalMinutes = watchedYear.reduce((s, m) => s + (Number(m.runtime) || 0), 0);
  const totalHours = Math.round(totalMinutes / 60);

  const genreCounts = {};
  watchedYear.forEach((m) => (m.genres || []).forEach((g) => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];

  const platformCounts = {};
  watchedYear.forEach((m) => { if (m.platform) platformCounts[m.platform] = (platformCounts[m.platform] || 0) + 1; });
  const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0];

  const rated = watchedYear.filter((m) => m.rating).sort((a, b) => b.rating - a.rating);
  const best = rated[0];

  const monthCounts = new Array(12).fill(0);
  watchedYear.forEach((m) => { const mo = Number(m.dateWatched.slice(5, 7)) - 1; if (mo >= 0 && mo < 12) monthCounts[mo] += 1; });
  const topMonthIdx = monthCounts.indexOf(Math.max(...monthCounts));

  const moviesCount = watchedYear.filter((m) => m.type !== 'serie').length;
  const seriesCount = watchedYear.filter((m) => m.type === 'serie').length;

  const blocks = [
    { hero: true, label: `Tu ${year} en cifras`, value: `${watchedYear.length}`, sub: 'títulos vistos en total' },
    { label: 'Tiempo total', value: `${totalHours} h`, sub: `${totalMinutes.toLocaleString('es-ES')} minutos (solo películas)` },
    { label: 'Género favorito', value: topGenre ? topGenre[0] : '—', sub: topGenre ? `${topGenre[1]} título${topGenre[1] === 1 ? '' : 's'}` : 'sin datos de género' },
    { label: 'Plataforma estrella', value: topPlatform ? topPlatform[0] : '—', sub: topPlatform ? `${topPlatform[1]} título${topPlatform[1] === 1 ? '' : 's'}` : 'sin datos' },
    { label: 'Mejor valorada', value: best ? `${best.rating}/10` : '—', sub: best ? `"${best.title}"` : 'sin valoraciones' },
    { label: 'Mes más activo', value: monthCounts[topMonthIdx] ? MONTH_NAMES[topMonthIdx] : '—', sub: monthCounts[topMonthIdx] ? `${monthCounts[topMonthIdx]} título${monthCounts[topMonthIdx] === 1 ? '' : 's'}` : '' },
    { label: 'Películas y series', value: `${moviesCount} · ${seriesCount}`, sub: `${moviesCount} película${moviesCount === 1 ? '' : 's'}, ${seriesCount} serie${seriesCount === 1 ? '' : 's'}` },
  ];

  const gradients = [
    'linear-gradient(135deg, #3987e5, #1c5cab)',
    'linear-gradient(135deg, #199e70, #0f6b4c)',
    'linear-gradient(135deg, #9085e9, #5b4fc7)',
    'linear-gradient(135deg, #e66767, #b23c3c)',
    'linear-gradient(135deg, #d95926, #a53e14)',
    'linear-gradient(135deg, #d55181, #a02f5d)',
  ];

  content.innerHTML = blocks.map((b, i) => `
    <div class="wrapped-block${b.hero ? ' hero' : ''}" style="background:${b.hero ? 'linear-gradient(135deg, var(--accent), var(--accent-hover))' : gradients[i % gradients.length]};animation-delay:${i * 60}ms">
      <div class="wb-label">${escapeHtml(b.label)}</div>
      <div class="wb-value">${escapeHtml(String(b.value))}</div>
      <div class="wb-sub">${escapeHtml(b.sub)}</div>
    </div>
  `).join('');
}

function updatePickText() {
  const el = $('#pick-text');
  if (!el.dataset.touched) {
    const pending = getPending();
    el.textContent = pending.length
      ? 'Elige al azar un título de tu lista de pendientes.'
      : 'Añade algo pendiente para poder sortearlo.';
  }
}

function pickRandomPending() {
  const btn = $('#btn-pick');
  btn.classList.remove('rolling');
  void btn.offsetWidth;
  btn.classList.add('rolling');
  setTimeout(() => btn.classList.remove('rolling'), 550);

  const pending = getPending();
  const el = $('#pick-text');
  if (!pending.length) {
    el.textContent = 'No tienes nada pendiente todavía.';
    el.dataset.touched = '1';
    el.onclick = null;
    return;
  }
  const movie = pending[Math.floor(Math.random() * pending.length)];
  el.dataset.touched = '1';
  el.innerHTML = `<strong style="color:var(--text-primary)">${escapeHtml(movie.title)}</strong> <span class="type-tag">${TYPE_LABELS[movie.type] || TYPE_LABELS.pelicula}</span>${movie.platform ? ` · ${escapeHtml(movie.platform)}` : ''} — haz clic para verla`;
  el.style.cursor = 'pointer';
  el.onclick = () => openModal(movie.id);
}


/* ---------- Upcoming releases ---------- */

async function loadUpcomingReleases(force = false) {
  const lastFetch = Number(localStorage.getItem(pk('upcoming-last-fetch'))) || 0;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (!force && upcomingCache && (Date.now() - lastFetch) < oneDayMs) {
    renderUpcomingSection();
    return;
  }
  const series = movies.filter((m) => m.type === 'serie' && m.tmdbId);
  if (!series.length) {
    upcomingCache = [];
    renderUpcomingSection();
    return;
  }
  const results = [];
  for (const m of series.slice(0, 20)) {
    const details = await window.api.getTmdbDetails(m.tmdbId, 'tv');
    if (details && details.nextEpisode && details.nextEpisode.airDate) {
      results.push({
        title: m.title,
        poster: details.poster || m.poster || '',
        airDate: details.nextEpisode.airDate,
        seasonNumber: details.nextEpisode.seasonNumber,
        episodeNumber: details.nextEpisode.episodeNumber,
      });
    }
  }
  results.sort((a, b) => a.airDate.localeCompare(b.airDate));
  upcomingCache = results.slice(0, 10);
  localStorage.setItem(pk('upcoming-last-fetch'), String(Date.now()));
  renderUpcomingSection();
}

function renderUpcomingSection() {
  const listEl = $('#upcoming-list');
  const emptyEl = $('#upcoming-empty');
  if (!listEl || !emptyEl) return;
  if (!upcomingCache || !upcomingCache.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.innerHTML = upcomingCache.map((u, i) => {
    const dateLabel = new Date(`${u.airDate}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
    <div class="upcoming-item" style="animation-delay:${i * 30}ms">
      ${u.poster ? `<img class="upcoming-poster" src="${u.poster}" alt="">` : '<div class="upcoming-poster"></div>'}
      <div>
        <div class="upcoming-title">${escapeHtml(u.title)}</div>
        <div class="upcoming-sub">Temporada ${u.seasonNumber} · Episodio ${u.episodeNumber}</div>
      </div>
      <div class="upcoming-date">${dateLabel}</div>
    </div>
  `;
  }).join('');
}


function bindDashboardEvents() {
  $('#btn-pick').addEventListener('click', pickRandomPending);

  $('#btn-wrapped').addEventListener('click', openWrappedModal);
  $('#wrapped-close').addEventListener('click', closeWrappedModal);
  $('#wrapped-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'wrapped-overlay') closeWrappedModal();
  });
  $('#wrapped-year').addEventListener('change', (e) => renderWrappedContent(e.target.value));

  $('#btn-refresh-upcoming').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin-once');
    await loadUpcomingReleases(true);
    setTimeout(() => btn.classList.remove('spin-once'), 500);
  });
}
