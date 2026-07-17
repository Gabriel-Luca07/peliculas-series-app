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


/* ---------- Event bindings ---------- */

// Promoted from local consts (previously inside bindEvents()) to top-level
// functions because bindAppearanceEvents() (appearance-settings.js) also
// calls these from the #pref-sort-pendientes/#pref-sort-vistas handlers.
function resetPendientesPageAndRender() { pendientesPageSize = PAGE_SIZE; renderPendientes(); }
function resetVistasPageAndRender() { vistasPageSize = PAGE_SIZE; renderVistas(); }

function bindMovieEvents() {
  $('#btn-add').addEventListener('click', () => openModal(null));

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  $('#filter-type').addEventListener('change', resetPendientesPageAndRender);
  $('#filter-platform').addEventListener('change', resetPendientesPageAndRender);
  $('#filter-genre').addEventListener('change', resetPendientesPageAndRender);
  $('#sort-pendientes').addEventListener('change', resetPendientesPageAndRender);
  $('#search-pendientes').addEventListener('input', resetPendientesPageAndRender);
  $('#filter-type-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-platform-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-genre-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#filter-rating-min').addEventListener('change', resetVistasPageAndRender);
  $('#sort-vistas').addEventListener('change', resetVistasPageAndRender);
  $('#search-vistas').addEventListener('input', resetVistasPageAndRender);
  $('#load-more-pendientes').addEventListener('click', () => {
    pendientesPageSize += PAGE_SIZE;
    renderPendientes();
  });
  $('#load-more-vistas').addEventListener('click', () => {
    vistasPageSize += PAGE_SIZE;
    renderVistas();
  });

  $('#f-status').addEventListener('change', () => {
    updateFieldVisibility();
    updateProgressVisibility();
  });
  $('#f-type').addEventListener('change', () => {
    updateTypeFieldVisibility();
    updateProgressVisibility();
  });
  $('#f-rating').addEventListener('input', () => {
    const valueEl = $('#f-rating-value');
    valueEl.textContent = $('#f-rating').value;
    valueEl.classList.remove('pulse');
    void valueEl.offsetWidth;
    valueEl.classList.add('pulse');
  });
  $('#f-platform-select').addEventListener('change', () => {
    $('#f-platform-custom').classList.toggle('hidden', $('#f-platform-select').value !== 'Otra');
  });
  $('#f-poster').addEventListener('input', () => {
    $('#f-poster-preview').src = $('#f-poster').value;
  });

  $('#genre-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGenrePanel();
  });
  document.addEventListener('click', (e) => {
    const container = $('#genre-multiselect');
    if (!container.contains(e.target)) toggleGenrePanel(false);
  });

  $('#btn-refresh-tmdb').addEventListener('click', () => {
    const title = $('#f-title').value.trim();
    if (!title) return;
    $('#search-input').value = title;
    clearTimeout(searchTimer);
    $('#search-hint').innerHTML = '<span class="spinner"></span> Buscando...';
    runSearch(title);
  });

  $('#search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = $('#search-input').value.trim();
    if (!query) {
      $('#search-results').innerHTML = '';
      $('#search-hint').textContent = '';
      return;
    }
    $('#search-hint').innerHTML = '<span class="spinner"></span> Buscando...';
    searchTimer = setTimeout(() => runSearch(query), 400);
  });

  $('#movie-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit();
  });

  $('#f-delete').addEventListener('click', async () => {
    if (!editingId) return;
    const deleted = movies.find((m) => m.id === editingId);
    if (!deleted) return;
    const deleteMode = localStorage.getItem(pk('pref-delete-mode')) || 'undo';

    if (deleteMode === 'confirm' && !confirm(`¿Eliminar "${deleted.title}" de tu lista?`)) return;

    movies = movies.filter((m) => m.id !== editingId);
    trash.push({ ...deleted, deletedAt: new Date().toISOString() });
    await saveMovies();
    await saveTrash();
    renderAll();
    renderTrash();
    closeModal();

    if (deleteMode === 'confirm') {
      showToast(`${deleted.title} eliminada`, 'error');
      return;
    }

    showToast(`${deleted.title} eliminada`, 'error', {
      actionLabel: 'Deshacer',
      duration: 5000,
      onAction: async () => {
        trash = trash.filter((m) => m.id !== deleted.id);
        movies.push(deleted);
        await saveMovies();
        await saveTrash();
        renderAll();
        renderTrash();
        showToast(`${deleted.title} restaurada`);
      },
    });
  });

  $('#btn-import-csv').addEventListener('click', async () => {
    const status = $('#csv-import-status');
    status.textContent = '';
    const res = await window.api.pickCsvFile();
    if (res.canceled) return;
    if (res.error) {
      status.classList.add('error');
      status.textContent = 'No se pudo leer el archivo.';
      return;
    }
    const parsed = parseCsv(res.text);
    if (!parsed.headers.length || !parsed.rows.length) {
      status.classList.add('error');
      status.textContent = 'El archivo no parece un CSV válido.';
      return;
    }
    csvParsed = parsed;
    showCsvMappingPanel(res.fileName);
  });

  $('#csv-platform').addEventListener('change', () => {
    $('#csv-platform-custom').classList.toggle('hidden', $('#csv-platform').value !== 'Otra');
  });

  $('#csv-import-cancel').addEventListener('click', () => {
    csvParsed = null;
    $('#csv-mapping').classList.add('hidden');
  });

  $('#csv-import-confirm').addEventListener('click', async () => {
    await applyCsvImport();
  });

  $('#btn-bulk-add').addEventListener('click', openBulkModal);
  $('#bulk-close').addEventListener('click', closeBulkModal);
  $('#bulk-cancel').addEventListener('click', closeBulkModal);
  $('#bulk-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'bulk-overlay') closeBulkModal();
  });
  $('#bulk-platform').addEventListener('change', () => {
    $('#bulk-platform-custom').classList.toggle('hidden', $('#bulk-platform').value !== 'Otra');
  });
  $('#bulk-submit').addEventListener('click', applyBulkAdd);

  $('#btn-check-providers').addEventListener('click', async () => {
    const tmdbId = $('#f-tmdbid').value;
    const mediaType = $('#f-mediatype').value;
    if (!tmdbId) return;
    await fetchAndShowProviders(tmdbId, mediaType);
  });

  $('#btn-watch-trailer').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const tmdbId = $('#f-tmdbid').value;
    const mediaType = $('#f-mediatype').value;
    if (!tmdbId) return;
    const originalLabel = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Buscando tráiler...';
    const res = await window.api.openTrailer(tmdbId, mediaType);
    btn.innerHTML = originalLabel;
    if (res.error === 'NO_API_KEY') showToast('Necesitas configurar tu API key de TMDB en Ajustes', 'error');
    else if (res.error === 'NOT_FOUND') showToast('No se encontró tráiler para este título', 'error');
    else if (res.error) showToast('No se pudo abrir el tráiler', 'error');
    else showToast('Abriendo tráiler en el navegador...');
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

let searchRequestId = 0;
async function runSearch(query) {
  const requestId = ++searchRequestId;
  const res = await window.api.searchTmdb(query);
  if (requestId !== searchRequestId) return;
  const resultsEl = $('#search-results');
  const hintEl = $('#search-hint');

  if (res.error === 'NO_API_KEY') {
    hintEl.textContent = 'Sin API key configurada (ver Ajustes). Puedes rellenar los datos a mano.';
    resultsEl.innerHTML = '';
    return;
  }
  if (res.error === 'INVALID_API_KEY') {
    hintEl.textContent = 'La API key no es válida. Revísala en Ajustes.';
    resultsEl.innerHTML = '';
    return;
  }
  if (res.error) {
    hintEl.textContent = 'No se pudo buscar (sin conexión o error de TMDB). Rellena a mano.';
    resultsEl.innerHTML = '';
    return;
  }

  hintEl.textContent = res.results.length ? '' : 'Sin resultados.';
  resultsEl.innerHTML = res.results.map((r, i) => `
    <div class="search-result" data-idx="${i}" style="animation-delay:${i * 25}ms">
      <img src="${r.poster || ''}" alt="">
      <div>
        <div class="sr-title">${escapeHtml(r.title)} <span class="type-tag">${r.mediaType === 'tv' ? 'Serie' : 'Película'}</span></div>
        <div class="sr-year">${escapeHtml(r.year)}${r.genres.length ? ' · ' + escapeHtml(r.genres.join(', ')) : ''}</div>
      </div>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('click', async () => {
      const r = res.results[Number(el.dataset.idx)];
      resultsEl.innerHTML = '';
      await applyTmdbResultToForm(r);
    });
  });
}

async function applyTmdbResultToForm(r) {
  const type = r.mediaType === 'tv' ? 'serie' : 'pelicula';
  $('#f-title').value = r.title;
  $('#f-year').value = r.year || '';
  setGenres(r.genres || []);
  $('#f-poster').value = r.poster || '';
  $('#f-poster-preview').src = r.poster || '';
  $('#f-tmdbid').value = r.tmdbId;
  $('#f-mediatype').value = r.mediaType;
  $('#f-type').value = type;
  updateTypeFieldVisibility();
  $('#search-hint').textContent = `Seleccionado: ${r.title} · obteniendo detalles...`;
  const details = await window.api.getTmdbDetails(r.tmdbId, r.mediaType);
  if (details) {
    if (details.runtime) $('#f-runtime').value = details.runtime;
    if (details.seasons) $('#f-seasons').value = details.seasons;
  }
  $('#search-hint').textContent = `Seleccionado: ${r.title}`;
  $('#btn-check-providers').classList.remove('hidden');
  $('#btn-watch-trailer').classList.remove('hidden');
  await fetchAndShowProviders(r.tmdbId, r.mediaType);
}

async function fetchAndShowProviders(tmdbId, mediaType) {
  const statusEl = $('#providers-status');
  const chipsEl = $('#platform-suggestions');
  chipsEl.innerHTML = '';
  chipsEl.classList.add('hidden');
  statusEl.innerHTML = '<span class="spinner"></span> Consultando disponibilidad...';
  const res = await window.api.getTmdbProviders(tmdbId, mediaType);
  if (!res || res.error === 'NO_API_KEY') {
    statusEl.textContent = '';
    return;
  }
  if (res.error) {
    statusEl.textContent = 'No se pudo consultar la disponibilidad ahora mismo.';
    return;
  }
  const streamNames = res.providers || [];
  const rentBuyNames = (res.rentBuy || []).filter((n) => !streamNames.includes(n));
  if (!streamNames.length && !rentBuyNames.length) {
    statusEl.textContent = 'TMDB no tiene datos de disponibilidad en España para este título.';
    return;
  }
  statusEl.textContent = streamNames.length ? 'Disponible ahora en (haz clic para elegirla):' : 'Solo encontrada en alquiler/compra:';
  const chips = streamNames.map((name) => ({ name, kind: 'stream' }))
    .concat(rentBuyNames.map((name) => ({ name, kind: 'rentbuy' })));
  chipsEl.innerHTML = chips.map((c, i) => `<span class="chip${c.kind === 'rentbuy' ? ' muted' : ''}" data-name="${escapeHtml(c.name)}" style="animation-delay:${i * 30}ms">${escapeHtml(c.name)}${c.kind === 'rentbuy' ? ' (alquiler/compra)' : ''}</span>`).join('');
  chipsEl.classList.remove('hidden');
  chipsEl.querySelectorAll('.chip:not(.muted)').forEach((chip) => {
    chip.addEventListener('click', () => {
      chipsEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      const rawName = chip.dataset.name;
      const mapped = normalizeProviderName(rawName);
      if (mapped) {
        $('#f-platform-select').value = mapped;
        $('#f-platform-custom').classList.add('hidden');
      } else {
        $('#f-platform-select').value = 'Otra';
        $('#f-platform-custom').value = rawName;
        $('#f-platform-custom').classList.remove('hidden');
      }
    });
  });
}

async function handleSubmit() {
  const title = $('#f-title').value.trim();
  if (!title) return;
  const status = $('#f-status').value;
  const type = $('#f-type').value;
  const platform = currentPlatformValue();
  const existingMovie = editingId ? movies.find((m) => m.id === editingId) : null;

  if (!editingId) {
    const duplicate = movies.find((m) => (m.type || 'pelicula') === type && m.title.trim().toLowerCase() === title.toLowerCase());
    if (duplicate) {
      const statusLabel = duplicate.status === 'vista' ? 'vista' : (duplicate.status === 'viendo' ? 'en curso' : 'pendiente');
      const proceed = confirm(`Ya tienes "${duplicate.title}" (${TYPE_LABELS[duplicate.type] || TYPE_LABELS.pelicula}) en tu lista, marcada como ${statusLabel}. ¿Quieres añadirla de todas formas como una entrada aparte?`);
      if (!proceed) return;
    }
  }

  const payload = {
    id: editingId || uid(),
    tmdbId: $('#f-tmdbid').value ? Number($('#f-tmdbid').value) : null,
    mediaType: $('#f-mediatype').value || null,
    type,
    title,
    year: $('#f-year').value.trim(),
    runtime: $('#f-runtime').value ? Number($('#f-runtime').value) : null,
    seasons: type === 'serie' && $('#f-seasons').value ? Number($('#f-seasons').value) : null,
    genres: $('#f-genres').value.split(',').map((g) => g.trim()).filter(Boolean),
    poster: $('#f-poster').value.trim(),
    platform,
    status,
    currentSeason: status === 'viendo' && type === 'serie' && $('#f-current-season').value ? Number($('#f-current-season').value) : null,
    currentEpisode: status === 'viendo' && type === 'serie' && $('#f-current-episode').value ? Number($('#f-current-episode').value) : null,
    rating: status === 'vista' ? Number($('#f-rating').value) : null,
    notes: status === 'vista' ? $('#f-notes').value.trim() : '',
    dateWatched: status === 'vista' ? $('#f-datewatched').value : null,
    watchCount: status === 'vista' ? (existingMovie && existingMovie.status === 'vista' ? (existingMovie.watchCount || 1) : 1) : null,
    dateAdded: existingMovie ? existingMovie.dateAdded : new Date().toISOString(),
  };

  if (editingId) {
    movies = movies.map((m) => (m.id === editingId ? payload : m));
  } else {
    movies.push(payload);
  }

  await saveMovies();
  renderAll();
  closeModal();
  showToast(editingId ? `${title} actualizada` : `${title} añadida`);
}
