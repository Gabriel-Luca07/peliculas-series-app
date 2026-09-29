// Pendientes / Viendo / Vistas lists: platform and tag filter selects, the
// cards, "+1 episode", multi-select and bulk actions. The filtering and
// sorting itself is in lib/list-logic.js. Plain global-scope script — see
// updater.js for the load-order note.

/* ---------- Platform selects ---------- */

function fillPlatformSelects() {
  const plainOptions = PLATFORMS.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  $('#f-platform-select').innerHTML = plainOptions;
  $('#csv-platform').innerHTML = plainOptions;
  $('#bulk-platform').innerHTML = plainOptions;
  $('#bulk-platform-select-pendientes').innerHTML = plainOptions;
  $('#bulk-platform-select-vistas').innerHTML = plainOptions;

  fillSelectOptions('#filter-platform', 'Todas las plataformas',
    [...new Set(getPending().map((m) => m.platform).filter(Boolean))].sort(),
    [{ value: ON_MY_SUBSCRIPTIONS, label: 'En mis suscripciones activas' }]);
  fillSelectOptions('#filter-genre', 'Todos los géneros',
    [...new Set(getPending().flatMap((m) => m.genres || []))].sort());
  fillSelectOptions('#filter-platform-vistas', 'Todas las plataformas',
    [...new Set(getWatched().map((m) => m.platform).filter(Boolean))].sort());
  fillSelectOptions('#filter-genre-vistas', 'Todos los géneros',
    [...new Set(getWatched().flatMap((m) => m.genres || []))].sort());
  fillTagFilter('#filter-tag', getPending());
  fillTagFilter('#filter-tag-vistas', getWatched());
  $('#tags-datalist').innerHTML = allTags().map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');
}

// `extra` are special options ({ value, label }) listed right after the
// placeholder, before the plain values.
function fillSelectOptions(selector, placeholder, values, extra = []) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    extra.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('') +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(current) || extra.some((o) => o.value === current)) select.value = current;
}

function allTags() {
  return [...new Set(movies.flatMap((m) => m.tags || []))].sort((a, b) => a.localeCompare(b, 'es'));
}

// The tag filter only shows up once some title in that list has tags.
function fillTagFilter(selector, list) {
  const tags = [...new Set(list.flatMap((m) => m.tags || []))].sort((a, b) => a.localeCompare(b, 'es'));
  fillSelectOptions(selector, 'Todas las etiquetas', tags);
  $(selector).classList.toggle('hidden', !tags.length);
}

function activeSubscriptionPlatforms() {
  return subscriptions.filter((s) => s.active).map((s) => s.platform);
}


/* ---------- Movie cards ---------- */

function posterOrPlaceholder(movie) {
  if (movie.poster) return `<img class="poster" src="${movie.poster}" alt="${escapeHtml(movie.title)}">`;
  return `<div class="poster">${escapeHtml(movie.title)}</div>`;
}

// filterSortPendientes / filterSortVistas live in lib/list-logic.js.
function computeFilteredPendientes() {
  // Titles in progress have their own "Viendo" tab, so they are left out
  // here even though getPending() (stats, planner...) still counts them.
  return filterSortPendientes(getPending().filter((m) => m.status !== 'viendo'), {
    type: $('#filter-type').value,
    platform: $('#filter-platform').value,
    genre: $('#filter-genre').value,
    tag: $('#filter-tag').value,
    search: $('#search-pendientes').value,
    sort: $('#sort-pendientes').value,
    activePlatforms: activeSubscriptionPlatforms(),
  });
}

function tagBadgesHtml(m) {
  return (m.tags || []).slice(0, 2).map((t) => `<span class="badge tag">#${escapeHtml(t)}</span>`).join('');
}

// Card used by both Pendientes and Viendo: quick "mark as watched" button,
// plus "+1 episode" for series in progress. The episode total ("E5/9") comes
// from the shared TMDB cache when the series has TMDB data. Also flags a
// pending title streaming on a subscription you have active, and a series in
// progress with an episode out this week that you haven't watched.
function pendingCardHtml(m, i, selecting, isSelected) {
  const isViendoSerie = m.status === 'viendo' && m.type === 'serie';
  const progressLabel = formatProgress(m.currentSeason, m.currentEpisode,
    m.type === 'serie' ? episodeCountFor(cachedSeasons(m.tmdbId), Number(m.currentSeason) || 1) : null);
  const onYours = activeSubscriptionPlatforms().filter((p) => (m.availableOn || []).includes(p));
  const newEpisode = isViendoSerie && m.tmdbId
    ? recentUnwatchedEpisode(m, tmdbCache()[`tv:${m.tmdbId}`], todayLocalDateString())
    : null;
  return `
  <div class="card${selecting ? ' selecting' : ''}${isSelected ? ' selected' : ''}" data-id="${m.id}" style="animation-delay:${Math.min(i, 20) * 30}ms">
    ${selecting
      ? `<label class="select-check"><input type="checkbox" class="select-checkbox" data-id="${m.id}" ${isSelected ? 'checked' : ''}></label>`
      : `<button class="quick-watch" data-id="${m.id}" title="Marcar como vista"><svg class="icon"><use href="#icon-check"></use></svg></button>
         ${isViendoSerie ? `<button class="quick-episode" data-id="${m.id}" title="Sumar un episodio"><svg class="icon"><use href="#icon-plus"></use></svg></button>` : ''}`}
    ${posterOrPlaceholder(m)}
    <div class="info">
      <div class="title">${escapeHtml(m.title)}</div>
      <div class="meta-row"><span class="type-tag">${TYPE_LABELS[m.type] || TYPE_LABELS.pelicula}</span><span class="year">${escapeHtml(m.year || '')}</span></div>
      ${m.status === 'viendo' ? `<span class="badge viendo">${escapeHtml(progressLabel)}</span>` : ''}
      ${newEpisode ? `<span class="badge new-episode" title="Emitido el ${escapeHtml(newEpisode.airDate)}">Nuevo: T${newEpisode.seasonNumber} · E${newEpisode.episodeNumber}</span>` : ''}
      ${m.platform ? `<span class="badge platform"><svg class="icon"><use href="#icon-tv"></use></svg>${escapeHtml(m.platform)}</span>` : ''}
      ${onYours.length ? `<span class="badge available" title="Incluida en ${escapeHtml(onYours.join(', '))}, que tienes activa">En tu ${escapeHtml(onYours[0])}</span>` : ''}
      ${tagBadgesHtml(m)}
    </div>
  </div>
  `;
}

function bindPendingCardQuickActions(container) {
  container.querySelectorAll('.quick-watch').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(btn.dataset.id, { markWatched: true });
    });
  });
  container.querySelectorAll('.quick-episode').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const movie = movies.find((m) => m.id === btn.dataset.id);
      if (movie) addEpisode(movie);
    });
  });
}

// "+1 episode": moves on to the next season when the current one is over
// (if it's already out), offers to mark the series as watched once you're
// caught up, and always offers an undo in case of a misclick.
async function addEpisode(movie) {
  const before = { currentSeason: movie.currentSeason, currentEpisode: movie.currentEpisode };
  const seasons = await seasonsFor(movie);
  const next = advanceEpisode(movie, seasons, todayLocalDateString());
  movie.currentSeason = next.currentSeason;
  movie.currentEpisode = next.currentEpisode;
  await saveMovies();
  renderAll();

  const undo = {
    label: 'Deshacer',
    onAction: async () => {
      Object.assign(movie, before);
      await saveMovies();
      renderAll();
    },
  };
  if (next.event === 'season-finished') {
    showToast(`${movie.title}: temporada ${next.finishedSeason} terminada, sigues con la ${next.currentSeason}`, 'success', { actions: [undo], duration: 5000 });
  } else if (next.event === 'caught-up') {
    showToast(`${movie.title}: estás al día (T${next.currentSeason} completa)`, 'success', {
      actions: [{ label: 'Marcar como vista', onAction: () => openModal(movie.id, { markWatched: true }) }, undo],
      duration: 7000,
    });
  } else {
    const total = episodeCountFor(seasons, next.currentSeason);
    showToast(`${movie.title}: episodio ${next.currentEpisode}${total ? ` de ${total}` : ''}${next.currentSeason ? ` (T${next.currentSeason})` : ''}`, 'success', { actions: [undo] });
  }
}

function renderPendientes() {
  const list = computeFilteredPendientes();

  const container = $('#list-pendientes');
  const visible = list.slice(0, pendientesPageSize);
  const selecting = selectionMode.pendientes;
  container.innerHTML = visible
    .map((m, i) => pendingCardHtml(m, i, selecting, selectedIds.pendientes.has(m.id)))
    .join('');

  const emptyEl = $('#empty-pendientes');
  emptyEl.classList.toggle('hidden', list.length > 0);
  emptyEl.textContent = getPending().some((m) => m.status !== 'viendo')
    ? 'Nada coincide con la búsqueda o los filtros.'
    : 'No tienes nada pendiente. Añade una película o serie para empezar.';
  $('#count-pendientes').textContent = `${list.length} título${list.length === 1 ? '' : 's'}`;

  const loadMoreBtn = $('#load-more-pendientes');
  const remaining = list.length - visible.length;
  loadMoreBtn.classList.toggle('hidden', remaining <= 0);
  loadMoreBtn.textContent = `Cargar más (${remaining} restantes)`;

  container.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => {
      if (selectionMode.pendientes) { toggleSelection('pendientes', card.dataset.id); return; }
      openModal(card.dataset.id);
    });
  });
  container.querySelectorAll('.select-checkbox').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleSelection('pendientes', cb.dataset.id, cb.checked));
  });
  bindPendingCardQuickActions(container);
}

function renderViendo() {
  const searchValue = $('#search-viendo').value.trim().toLowerCase();
  const inProgress = movies.filter((m) => m.status === 'viendo');
  const list = inProgress
    .filter((m) => !searchValue || m.title.toLowerCase().includes(searchValue))
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));

  const container = $('#list-viendo');
  container.innerHTML = list.map((m, i) => pendingCardHtml(m, i, false, false)).join('');

  const emptyEl = $('#empty-viendo');
  emptyEl.classList.toggle('hidden', list.length > 0);
  emptyEl.textContent = inProgress.length
    ? 'Nada coincide con la búsqueda.'
    : 'No estás viendo nada ahora mismo. Cambia el estado de un pendiente a «Viendo» para seguirlo aquí.';
  $('#count-viendo').textContent = `${list.length} título${list.length === 1 ? '' : 's'}`;
  const badge = $('#viendo-badge');
  badge.textContent = String(inProgress.length);
  badge.classList.toggle('hidden', !inProgress.length);

  container.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
  bindPendingCardQuickActions(container);
}

function computeFilteredVistas() {
  return filterSortVistas(getWatched(), {
    type: $('#filter-type-vistas').value,
    platform: $('#filter-platform-vistas').value,
    genre: $('#filter-genre-vistas').value,
    tag: $('#filter-tag-vistas').value,
    search: $('#search-vistas').value,
    sort: $('#sort-vistas').value,
    ratingMin: $('#filter-rating-min').value,
  });
}

function renderVistas() {
  const list = computeFilteredVistas();

  const container = $('#list-vistas');
  const visible = list.slice(0, vistasPageSize);
  const selecting = selectionMode.vistas;
  container.innerHTML = visible.map((m, i) => {
    const isSelected = selectedIds.vistas.has(m.id);
    return `
    <div class="card${selecting ? ' selecting' : ''}${isSelected ? ' selected' : ''}" data-id="${m.id}" style="animation-delay:${Math.min(i, 20) * 30}ms">
      ${selecting
        ? `<label class="select-check"><input type="checkbox" class="select-checkbox" data-id="${m.id}" ${isSelected ? 'checked' : ''}></label>`
        : `<button class="quick-rewatch" data-id="${m.id}" title="Marcar como vista de nuevo"><svg class="icon"><use href="#icon-repeat"></use></svg></button>`}
      ${posterOrPlaceholder(m)}
      <div class="info">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta-row"><span class="type-tag">${TYPE_LABELS[m.type] || TYPE_LABELS.pelicula}</span><span class="year">${escapeHtml(m.year || '')}</span></div>
        ${m.rating ? `<span class="badge rating"><svg class="icon"><use href="#icon-star"></use></svg>${m.rating}/10</span>` : ''}
        ${m.platform ? `<span class="badge platform"><svg class="icon"><use href="#icon-tv"></use></svg>${escapeHtml(m.platform)}</span>` : ''}
        ${m.type === 'serie' && m.seasons ? `<span class="badge">${m.seasons} temporada${m.seasons === 1 ? '' : 's'}</span>` : ''}
        ${m.watchCount > 1 ? `<span class="badge">Vista ${m.watchCount}x</span>` : ''}
        ${tagBadgesHtml(m)}
      </div>
    </div>
  `;
  }).join('');

  container.querySelectorAll('.quick-rewatch').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const movie = movies.find((m) => m.id === btn.dataset.id);
      if (!movie) return;
      movie.watchCount = (movie.watchCount || 1) + 1;
      movie.dateWatched = todayLocalDateString();
      await saveMovies();
      renderAll();
      showToast(`${movie.title}: vista ${movie.watchCount} veces`);
    });
  });

  const emptyEl = $('#empty-vistas');
  emptyEl.classList.toggle('hidden', list.length > 0);
  emptyEl.textContent = getWatched().length
    ? 'Nada coincide con la búsqueda o los filtros.'
    : 'Todavía no has marcado nada como visto.';
  $('#count-vistas').textContent = `${list.length} título${list.length === 1 ? '' : 's'}`;

  const loadMoreBtn = $('#load-more-vistas');
  const remaining = list.length - visible.length;
  loadMoreBtn.classList.toggle('hidden', remaining <= 0);
  loadMoreBtn.textContent = `Cargar más (${remaining} restantes)`;

  container.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => {
      if (selectionMode.vistas) { toggleSelection('vistas', card.dataset.id); return; }
      openModal(card.dataset.id);
    });
  });
  container.querySelectorAll('.select-checkbox').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleSelection('vistas', cb.dataset.id, cb.checked));
  });
}


/* ---------- Multi-select & bulk actions ---------- */

function toggleSelectionMode(view) {
  if (selectionMode[view]) exitSelectionMode(view);
  else enterSelectionMode(view);
}

function enterSelectionMode(view) {
  selectionMode[view] = true;
  selectedIds[view].clear();
  $(`#bulk-bar-${view}`).classList.remove('hidden');
  $(`#btn-select-${view}`).textContent = 'Cancelar selección';
  if (view === 'pendientes') renderPendientes(); else renderVistas();
  updateBulkBar(view);
}

function exitSelectionMode(view) {
  selectionMode[view] = false;
  selectedIds[view].clear();
  $(`#bulk-bar-${view}`).classList.add('hidden');
  $(`#btn-select-${view}`).innerHTML = '<svg class="icon"><use href="#icon-select"></use></svg>Seleccionar';
  if (view === 'pendientes') renderPendientes(); else renderVistas();
}

function toggleSelection(view, id, forceValue) {
  const set = selectedIds[view];
  const shouldSelect = forceValue !== undefined ? forceValue : !set.has(id);
  if (shouldSelect) set.add(id); else set.delete(id);
  const card = document.querySelector(`#list-${view} .card[data-id="${id}"]`);
  if (card) {
    card.classList.toggle('selected', shouldSelect);
    const cb = card.querySelector('.select-checkbox');
    if (cb) cb.checked = shouldSelect;
  }
  updateBulkBar(view);
}

function updateBulkBar(view) {
  const count = selectedIds[view].size;
  $(`#bulk-count-${view}`).textContent = `${count} seleccionado${count === 1 ? '' : 's'}`;
  $(`#btn-bulk-platform-${view}`).disabled = count === 0;
  $(`#btn-bulk-delete-${view}`).disabled = count === 0;
  updateSelectAllLabel(view);
}

function getVisibleCardIds(view) {
  const list = view === 'pendientes' ? computeFilteredPendientes() : computeFilteredVistas();
  return list.map((m) => m.id);
}

function updateSelectAllLabel(view) {
  const btn = $(`#btn-select-all-${view}`);
  if (!btn) return;
  const ids = getVisibleCardIds(view);
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds[view].has(id));
  btn.textContent = allSelected ? 'Deseleccionar todo' : 'Seleccionar todo';
}

function toggleSelectAll(view) {
  const ids = getVisibleCardIds(view);
  const set = selectedIds[view];
  const allSelected = ids.length > 0 && ids.every((id) => set.has(id));
  ids.forEach((id) => {
    if (allSelected) set.delete(id); else set.add(id);
    const card = document.querySelector(`#list-${view} .card[data-id="${id}"]`);
    if (card) {
      card.classList.toggle('selected', !allSelected);
      const cb = card.querySelector('.select-checkbox');
      if (cb) cb.checked = !allSelected;
    }
  });
  updateBulkBar(view);
}

async function applyBulkPlatformChange(view) {
  const set = selectedIds[view];
  const count = set.size;
  if (!count) return;
  const platform = $(`#bulk-platform-select-${view}`).value;
  movies.forEach((m) => { if (set.has(m.id)) m.platform = platform; });
  await saveMovies();
  exitSelectionMode(view);
  renderAll();
  showToast(`Plataforma actualizada en ${count} título${count === 1 ? '' : 's'}`);
}

async function applyBulkDelete(view) {
  const set = selectedIds[view];
  const count = set.size;
  if (!count) return;
  if (!confirm(`¿Enviar ${count} título${count === 1 ? '' : 's'} a la papelera?`)) return;
  const toDelete = movies.filter((m) => set.has(m.id));
  movies = movies.filter((m) => !set.has(m.id));
  const now = new Date().toISOString();
  toDelete.forEach((m) => trash.push({ ...m, deletedAt: now }));
  await saveMovies();
  await saveTrash();
  exitSelectionMode(view);
  renderAll();
  renderTrash();
  showToast(`${count} título${count === 1 ? '' : 's'} enviados a la papelera`, 'error', {
    actionLabel: 'Deshacer',
    duration: 6000,
    onAction: async () => {
      const ids = new Set(toDelete.map((m) => m.id));
      trash = trash.filter((m) => !ids.has(m.id));
      movies.push(...toDelete);
      await saveMovies();
      await saveTrash();
      renderAll();
      renderTrash();
      showToast('Restaurados');
    },
  });
}

/* ---------- Saving ---------- */

async function saveMovies() {
  await window.api.saveMovies(movies);
}


/* ---------- Event bindings ---------- */

// Promoted from local consts (previously inside bindEvents()) to top-level
// functions because bindAppearanceEvents() (appearance-settings.js) also
// calls these from the #pref-sort-pendientes/#pref-sort-vistas handlers.
function resetPendientesPageAndRender() { pendientesPageSize = PAGE_SIZE; renderPendientes(); }
function resetVistasPageAndRender() { vistasPageSize = PAGE_SIZE; renderVistas(); }

function bindMovieListEvents() {
  $('#filter-type').addEventListener('change', resetPendientesPageAndRender);
  $('#filter-platform').addEventListener('change', resetPendientesPageAndRender);
  $('#filter-genre').addEventListener('change', resetPendientesPageAndRender);
  $('#filter-tag').addEventListener('change', resetPendientesPageAndRender);
  $('#sort-pendientes').addEventListener('change', resetPendientesPageAndRender);
  $('#search-pendientes').addEventListener('input', resetPendientesPageAndRender);
  $('#filter-type-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-platform-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-genre-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-tag-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-rating-min').addEventListener('change', resetVistasPageAndRender);
  $('#sort-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#search-vistas').addEventListener('input', resetVistasPageAndRender);
  $('#search-viendo').addEventListener('input', renderViendo);
  $('#load-more-pendientes').addEventListener('click', () => {
    pendientesPageSize += PAGE_SIZE;
    renderPendientes();
  });
  $('#load-more-vistas').addEventListener('click', () => {
    vistasPageSize += PAGE_SIZE;
    renderVistas();
  });

  $('#btn-select-pendientes').addEventListener('click', () => toggleSelectionMode('pendientes'));
  $('#btn-select-vistas').addEventListener('click', () => toggleSelectionMode('vistas'));
  $('#btn-select-all-pendientes').addEventListener('click', () => toggleSelectAll('pendientes'));
  $('#btn-select-all-vistas').addEventListener('click', () => toggleSelectAll('vistas'));
  $('#btn-bulk-cancel-pendientes').addEventListener('click', () => exitSelectionMode('pendientes'));
  $('#btn-bulk-cancel-vistas').addEventListener('click', () => exitSelectionMode('vistas'));
  $('#btn-bulk-platform-pendientes').addEventListener('click', () => applyBulkPlatformChange('pendientes'));
  $('#btn-bulk-platform-vistas').addEventListener('click', () => applyBulkPlatformChange('vistas'));
  $('#btn-bulk-delete-pendientes').addEventListener('click', () => applyBulkDelete('pendientes'));
  $('#btn-bulk-delete-vistas').addEventListener('click', () => applyBulkDelete('vistas'));
}
