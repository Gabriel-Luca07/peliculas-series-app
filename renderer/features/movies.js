// The core movies/series feature: platform selects, list rendering
// (Pendientes/Vistas), multi-select & bulk actions, genre multiselect, the
// add/edit modal, bulk quick-add, and CSV history import. Uses
// extractSeriesTitle and buildMovieKey from lib/csv-import-utils.js. Plain
// global-scope script — see updater.js for the load-order note.

/* ---------- Platform selects ---------- */

function fillPlatformSelects() {
  const plainOptions = PLATFORMS.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  $('#f-platform-select').innerHTML = plainOptions;
  $('#csv-platform').innerHTML = plainOptions;
  $('#bulk-platform').innerHTML = plainOptions;
  $('#bulk-platform-select-pendientes').innerHTML = plainOptions;
  $('#bulk-platform-select-vistas').innerHTML = plainOptions;

  fillSelectOptions('#filter-platform', 'Todas las plataformas',
    [...new Set(getPending().map((m) => m.platform).filter(Boolean))].sort());
  fillSelectOptions('#filter-genre', 'Todos los géneros',
    [...new Set(getPending().flatMap((m) => m.genres || []))].sort());
  fillSelectOptions('#filter-platform-vistas', 'Todas las plataformas',
    [...new Set(getWatched().map((m) => m.platform).filter(Boolean))].sort());
  fillSelectOptions('#filter-genre-vistas', 'Todos los géneros',
    [...new Set(getWatched().flatMap((m) => m.genres || []))].sort());
}

function fillSelectOptions(selector, placeholder, values) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(current)) select.value = current;
}


/* ---------- Movie cards ---------- */

function posterOrPlaceholder(movie) {
  if (movie.poster) return `<img class="poster" src="${movie.poster}" alt="${escapeHtml(movie.title)}">`;
  return `<div class="poster">${escapeHtml(movie.title)}</div>`;
}

function computeFilteredPendientes() {
  const typeValue = $('#filter-type').value;
  const platformValue = $('#filter-platform').value;
  const genreValue = $('#filter-genre').value;
  const searchValue = $('#search-pendientes').value.trim().toLowerCase();
  const sortValue = $('#sort-pendientes').value;

  let list = getPending()
    .filter((m) => !typeValue || (m.type || 'pelicula') === typeValue)
    .filter((m) => !platformValue || m.platform === platformValue)
    .filter((m) => !genreValue || (m.genres || []).includes(genreValue))
    .filter((m) => !searchValue || m.title.toLowerCase().includes(searchValue));

  return list.slice().sort((a, b) => {
    if (sortValue === 'added-asc') return (a.dateAdded || '').localeCompare(b.dateAdded || '');
    if (sortValue === 'title-asc') return a.title.localeCompare(b.title, 'es');
    return (b.dateAdded || '').localeCompare(a.dateAdded || '');
  });
}

function renderPendientes() {
  const list = computeFilteredPendientes();

  const container = $('#list-pendientes');
  const visible = list.slice(0, pendientesPageSize);
  const selecting = selectionMode.pendientes;
  container.innerHTML = visible.map((m, i) => {
    const isViendoSerie = m.status === 'viendo' && m.type === 'serie';
    const isSelected = selectedIds.pendientes.has(m.id);
    const progressLabel = (m.currentSeason || m.currentEpisode)
      ? `Viendo${m.currentSeason ? ` T${m.currentSeason}` : ''}${m.currentEpisode ? ` · E${m.currentEpisode}` : ''}`
      : 'Viendo';
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
        ${m.platform ? `<span class="badge platform"><svg class="icon"><use href="#icon-tv"></use></svg>${escapeHtml(m.platform)}</span>` : ''}
      </div>
    </div>
  `;
  }).join('');

  const emptyEl = $('#empty-pendientes');
  emptyEl.classList.toggle('hidden', list.length > 0);
  emptyEl.textContent = getPending().length
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
  container.querySelectorAll('.quick-watch').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(btn.dataset.id, { markWatched: true });
    });
  });
  container.querySelectorAll('.quick-episode').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const movie = movies.find((m) => m.id === btn.dataset.id);
      if (!movie) return;
      movie.currentEpisode = (movie.currentEpisode || 0) + 1;
      await saveMovies();
      renderAll();
      showToast(`${movie.title}: episodio ${movie.currentEpisode}${movie.currentSeason ? ` (T${movie.currentSeason})` : ''}`);
    });
  });
}

function computeFilteredVistas() {
  const sortValue = $('#sort-vistas').value;
  const searchValue = $('#search-vistas').value.trim().toLowerCase();
  const typeValue = $('#filter-type-vistas').value;
  const platformValue = $('#filter-platform-vistas').value;
  const genreValue = $('#filter-genre-vistas').value;
  const ratingMin = Number($('#filter-rating-min').value) || 0;

  let list = getWatched()
    .filter((m) => !searchValue || m.title.toLowerCase().includes(searchValue))
    .filter((m) => !typeValue || (m.type || 'pelicula') === typeValue)
    .filter((m) => !platformValue || m.platform === platformValue)
    .filter((m) => !genreValue || (m.genres || []).includes(genreValue))
    .filter((m) => !ratingMin || (m.rating || 0) >= ratingMin);

  return list.slice().sort((a, b) => {
    if (sortValue === 'rating-desc') return (b.rating || 0) - (a.rating || 0);
    if (sortValue === 'rating-asc') return (a.rating || 0) - (b.rating || 0);
    if (sortValue === 'date-asc') return (a.dateWatched || '').localeCompare(b.dateWatched || '');
    return (b.dateWatched || '').localeCompare(a.dateWatched || '');
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


/* ---------- Genre multiselect ---------- */

function getGenresArray() {
  return $('#f-genres').value.split(',').map((g) => g.trim()).filter(Boolean);
}

function setGenres(arr) {
  const clean = [...new Set((arr || []).map((g) => g.trim()).filter(Boolean))];
  $('#f-genres').value = clean.join(', ');
  syncGenrePanel();
  updateGenreTriggerLabel();
}

function updateGenreTriggerLabel() {
  const selected = getGenresArray();
  const label = $('#genre-trigger-text');
  if (!selected.length) {
    label.textContent = 'Selecciona géneros...';
    label.classList.add('placeholder');
  } else {
    label.textContent = selected.join(', ');
    label.classList.remove('placeholder');
  }
}

function syncGenrePanel() {
  const selected = getGenresArray();
  const allGenres = [...new Set([...GENRES_LIST, ...selected])];
  const panel = $('#genre-panel');
  panel.innerHTML = allGenres.map((g) => `
    <label class="genre-option">
      <input type="checkbox" value="${escapeHtml(g)}" ${selected.includes(g) ? 'checked' : ''}>
      <span>${escapeHtml(g)}</span>
    </label>
  `).join('') + `
    <div class="genre-custom-add">
      <input type="text" id="genre-custom-input" placeholder="Añadir otro género...">
      <button type="button" class="icon-btn" id="genre-custom-add-btn" title="Añadir"><svg class="icon"><use href="#icon-plus"></use></svg></button>
    </div>
  `;
  panel.querySelectorAll('.genre-option input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const current = getGenresArray();
      if (cb.checked) {
        if (!current.includes(cb.value)) current.push(cb.value);
      } else {
        const idx = current.indexOf(cb.value);
        if (idx >= 0) current.splice(idx, 1);
      }
      $('#f-genres').value = current.join(', ');
      updateGenreTriggerLabel();
    });
  });
  const addCustomGenre = () => {
    const input = $('#genre-custom-input');
    const value = input.value.trim();
    if (!value) return;
    const current = getGenresArray();
    if (!current.includes(value)) current.push(value);
    $('#f-genres').value = current.join(', ');
    updateGenreTriggerLabel();
    syncGenrePanel();
    $('#genre-custom-input').focus();
  };
  $('#genre-custom-add-btn').addEventListener('click', addCustomGenre);
  $('#genre-custom-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomGenre(); }
  });
}

function toggleGenrePanel(forceOpen) {
  const container = $('#genre-multiselect');
  const panel = $('#genre-panel');
  const shouldOpen = forceOpen !== undefined ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  container.classList.toggle('open', shouldOpen);
}


/* ---------- Modal / form ---------- */

function resetForm() {
  editingId = null;
  $('#f-id').value = '';
  $('#f-tmdbid').value = '';
  $('#f-mediatype').value = '';
  $('#f-type').value = 'pelicula';
  $('#f-runtime').value = '';
  $('#f-seasons').value = '';
  $('#f-title').value = '';
  $('#f-year').value = '';
  setGenres([]);
  $('#f-poster').value = '';
  $('#f-poster-preview').src = '';
  $('#f-status').value = 'pendiente';
  $('#f-platform-select').value = PLATFORMS[0];
  $('#f-platform-custom').value = '';
  $('#f-platform-custom').classList.add('hidden');
  $('#f-rating').value = 7;
  $('#f-rating-value').textContent = '7';
  $('#f-notes').value = '';
  $('#f-datewatched').value = todayLocalDateString();
  $('#f-current-season').value = '';
  $('#f-current-episode').value = '';
  $('#search-input').value = '';
  $('#search-results').innerHTML = '';
  $('#search-hint').textContent = '';
  $('#f-delete').classList.add('hidden');
  $('#btn-check-providers').classList.add('hidden');
  $('#btn-watch-trailer').classList.add('hidden');
  $('#providers-status').textContent = '';
  $('#platform-suggestions').innerHTML = '';
  $('#platform-suggestions').classList.add('hidden');
  updateFieldVisibility();
  updateTypeFieldVisibility();
  updateProgressVisibility();
}

function updateFieldVisibility() {
  const status = $('#f-status').value;
  $('#watched-fields').classList.toggle('hidden', status !== 'vista');
}

function updateTypeFieldVisibility() {
  const isSerie = $('#f-type').value === 'serie';
  $('#f-seasons-field').classList.toggle('hidden', !isSerie);
  $('#f-runtime-label').textContent = isSerie ? 'Duración total (min)' : 'Duración (min)';
  $('#f-runtime').placeholder = isSerie ? 'p.ej. 600' : 'p.ej. 118';
}

function updateProgressVisibility() {
  const isViendoSerie = $('#f-status').value === 'viendo' && $('#f-type').value === 'serie';
  $('#progress-fields').classList.toggle('hidden', !isViendoSerie);
}

function openModal(movieId, options = {}) {
  resetForm();
  if (movieId) {
    const m = movies.find((x) => x.id === movieId);
    if (!m) return;
    editingId = m.id;
    $('#modal-title').textContent = options.markWatched ? 'Marcar como vista' : 'Editar título';
    $('#f-id').value = m.id;
    $('#f-tmdbid').value = m.tmdbId || '';
    $('#f-mediatype').value = m.mediaType || '';
    $('#f-type').value = m.type || 'pelicula';
    $('#f-runtime').value = m.runtime || '';
    $('#f-seasons').value = m.seasons || '';
    $('#f-title').value = m.title;
    $('#f-year').value = m.year || '';
    setGenres(m.genres || []);
    $('#f-poster').value = m.poster || '';
    $('#f-poster-preview').src = m.poster || '';
    $('#f-status').value = options.markWatched ? 'vista' : m.status;
    $('#btn-check-providers').classList.toggle('hidden', !m.tmdbId);
    $('#btn-watch-trailer').classList.toggle('hidden', !m.tmdbId);
    if (PLATFORMS.includes(m.platform)) {
      $('#f-platform-select').value = m.platform;
    } else if (m.platform) {
      $('#f-platform-select').value = 'Otra';
      $('#f-platform-custom').value = m.platform;
      $('#f-platform-custom').classList.remove('hidden');
    }
    $('#f-rating').value = m.rating || 7;
    $('#f-rating-value').textContent = m.rating || 7;
    $('#f-notes').value = m.notes || '';
    $('#f-datewatched').value = m.dateWatched || todayLocalDateString();
    $('#f-current-season').value = m.currentSeason || '';
    $('#f-current-episode').value = m.currentEpisode || '';
    $('#f-delete').classList.remove('hidden');
  } else {
    $('#modal-title').textContent = 'Añadir título';
  }
  updateFieldVisibility();
  updateTypeFieldVisibility();
  updateProgressVisibility();
  showOverlay($('#modal-overlay'));
  if (options.markWatched) {
    $('#f-rating').focus();
  } else {
    $('#search-input').focus();
  }
}

function closeModal() {
  hideOverlay($('#modal-overlay'));
}

function currentPlatformValue() {
  const select = $('#f-platform-select').value;
  if (select === 'Otra') return $('#f-platform-custom').value.trim();
  return select;
}

async function saveMovies() {
  await window.api.saveMovies(movies);
}


/* ---------- Bulk quick add ---------- */

function openBulkModal() {
  $('#bulk-type').value = 'pelicula';
  $('#bulk-platform').value = 'No recuerdo';
  $('#bulk-platform-custom').value = '';
  $('#bulk-platform-custom').classList.add('hidden');
  $('#bulk-titles').value = '';
  $('#bulk-status').textContent = '';
  $('#bulk-status').classList.remove('error');
  showOverlay($('#bulk-overlay'));
  $('#bulk-titles').focus();
}

function closeBulkModal() {
  hideOverlay($('#bulk-overlay'));
}

function bulkPlatformValue() {
  const select = $('#bulk-platform').value;
  if (select === 'Otra') return $('#bulk-platform-custom').value.trim();
  return select;
}

async function applyBulkAdd() {
  const status = $('#bulk-status');
  const type = $('#bulk-type').value;
  const platform = bulkPlatformValue();
  if (!platform) {
    status.classList.add('error');
    status.textContent = 'Indica dónde o cómo las viste (o escribe una personalizada).';
    return;
  }
  const titles = $('#bulk-titles').value.split('\n').map((t) => t.trim()).filter(Boolean);
  if (!titles.length) {
    status.classList.add('error');
    status.textContent = 'Escribe al menos un título.';
    return;
  }

  const existingTitles = new Set(movies.filter((m) => (m.type || 'pelicula') === type).map((m) => m.title.trim().toLowerCase()));
  let added = 0;
  let skipped = 0;
  const seenInBatch = new Set();
  titles.forEach((title) => {
    const key = title.toLowerCase();
    if (existingTitles.has(key) || seenInBatch.has(key)) { skipped += 1; return; }
    seenInBatch.add(key);
    movies.push({
      id: uid(),
      tmdbId: null,
      mediaType: null,
      type,
      title,
      year: '',
      runtime: null,
      seasons: null,
      genres: [],
      poster: '',
      platform,
      status: 'vista',
      rating: null,
      notes: '',
      dateWatched: null,
      dateAdded: new Date().toISOString(),
    });
    added += 1;
  });

  await saveMovies();
  renderAll();
  status.classList.remove('error');
  status.textContent = `Se añadieron ${added} título${added === 1 ? '' : 's'} como visto${added === 1 ? '' : 's'}.` +
    (skipped ? ` ${skipped} se omitieron por estar repetidos.` : '');
  $('#bulk-titles').value = '';
}


/* ---------- CSV history import ---------- */

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

function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
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

function guessColumn(headers, pattern) {
  const idx = headers.findIndex((h) => pattern.test(h));
  return idx >= 0 ? idx : 0;
}

function showCsvMappingPanel(fileName) {
  const { headers, rows } = csvParsed;
  const titleSelect = $('#csv-col-title');
  const dateSelect = $('#csv-col-date');

  titleSelect.innerHTML = headers.map((h, i) => `<option value="${i}">${escapeHtml(h)}</option>`).join('');
  dateSelect.innerHTML = '<option value="">(no importar fecha)</option>' +
    headers.map((h, i) => `<option value="${i}">${escapeHtml(h)}</option>`).join('');

  titleSelect.value = guessColumn(headers, /t[íi]tulo|title|pel[íi]cula|name/i);
  const dateGuess = headers.findIndex((h) => /fecha|date|visto|watched/i.test(h));
  dateSelect.value = dateGuess >= 0 ? String(dateGuess) : '';

  const lowerName = fileName.toLowerCase();
  let platformGuess = '';
  if (lowerName.includes('netflix')) platformGuess = 'Netflix';
  else if (lowerName.includes('prime') || lowerName.includes('amazon')) platformGuess = 'Prime Video';
  else if (lowerName.includes('disney')) platformGuess = 'Disney+';
  else if (lowerName.includes('hbo')) platformGuess = 'HBO Max';
  if (platformGuess) $('#csv-platform').value = platformGuess;
  $('#csv-platform-custom').classList.toggle('hidden', $('#csv-platform').value !== 'Otra');

  $('#csv-file-info').textContent = `${fileName} · ${rows.length} fila${rows.length === 1 ? '' : 's'} detectada${rows.length === 1 ? '' : 's'}`;
  $('#csv-mapping').classList.remove('hidden');
  $('#csv-import-status').textContent = '';
}

function csvPlatformValue() {
  const select = $('#csv-platform').value;
  if (select === 'Otra') return $('#csv-platform-custom').value.trim();
  return select;
}

// extractSeriesTitle is defined in lib/csv-import-utils.js (loaded as a global
// <script> before this file).

async function applyCsvImport() {
  if (!csvParsed) return;
  const status = $('#csv-import-status');
  const platform = csvPlatformValue();
  if (!platform) {
    status.classList.add('error');
    status.textContent = 'Indica la plataforma (o escribe una personalizada).';
    return;
  }
  const titleIdx = Number($('#csv-col-title').value);
  const dateValue = $('#csv-col-date').value;
  const dateIdx = dateValue === '' ? -1 : Number(dateValue);
  const defaultType = $('#csv-type').value;

  const parseRow = (row) => {
    const raw = (row[titleIdx] || '').trim();
    if (!raw) return null;
    const seriesMatch = extractSeriesTitle(raw);
    return seriesMatch || { title: raw, type: defaultType };
  };

  const existingTitles = new Map(movies.map((m) => [buildMovieKey(m.type, m.title), m]));
  const countedKeys = new Set();
  let toUpdate = 0;
  let toAdd = 0;
  let skipped = 0;
  csvParsed.rows.forEach((row) => {
    const parsed = parseRow(row);
    if (!parsed) { skipped += 1; return; }
    const key = buildMovieKey(parsed.type, parsed.title);
    if (existingTitles.has(key) || countedKeys.has(key)) toUpdate += 1;
    else { toAdd += 1; countedKeys.add(key); }
  });

  if (!toUpdate && !toAdd) {
    status.classList.add('error');
    status.textContent = 'No se ha detectado ninguna fila con título válido.';
    return;
  }

  const confirmMsg = `Se marcarán ${toUpdate} título${toUpdate === 1 ? '' : 's'} existente${toUpdate === 1 ? '' : 's'} como visto en ${platform}, y se añadirán ${toAdd} nuevo${toAdd === 1 ? '' : 's'} directamente como visto${toAdd === 1 ? '' : 's'}.` +
    (skipped ? ` ${skipped} fila${skipped === 1 ? '' : 's'} sin título se ignorará${skipped === 1 ? '' : 'n'}.` : '') +
    ' ¿Continuar?';
  if (!confirm(confirmMsg)) return;

  csvParsed.rows.forEach((row) => {
    const parsed = parseRow(row);
    if (!parsed) return;
    const dateWatched = dateIdx >= 0 ? (normalizeDate(row[dateIdx]) || todayLocalDateString()) : todayLocalDateString();
    const existing = movies.find((m) => (m.type || 'pelicula') === parsed.type && m.title.trim().toLowerCase() === parsed.title.toLowerCase());
    if (existing) {
      existing.status = 'vista';
      existing.platform = platform;
      existing.dateWatched = dateWatched;
    } else {
      movies.push({
        id: uid(),
        tmdbId: null,
        mediaType: null,
        type: parsed.type,
        title: parsed.title,
        year: '',
        runtime: null,
        seasons: null,
        genres: [],
        poster: '',
        platform,
        status: 'vista',
        rating: null,
        notes: '',
        dateWatched,
        dateAdded: new Date().toISOString(),
      });
    }
  });

  await saveMovies();
  renderAll();
  csvParsed = null;
  $('#csv-mapping').classList.add('hidden');
  status.classList.remove('error');
  status.textContent = `Importación completa: ${toUpdate} actualizada${toUpdate === 1 ? '' : 's'} a vista, ${toAdd} añadida${toAdd === 1 ? '' : 's'} nueva${toAdd === 1 ? '' : 's'}.`;
}
