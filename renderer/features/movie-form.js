// The add/edit modal: TMDB search and autocomplete, genre multiselect,
// availability chips, trailer, delete and submit. Plain global-scope script —
// see updater.js for the load-order note.

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
      <input type="text" id="genre-custom-input" placeholder="Añadir otro género..." aria-label="Añadir otro género">
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
  $('#f-tags').value = '';
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
    $('#f-tags').value = (m.tags || []).join(', ');
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


/* ---------- TMDB search ---------- */

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

  const tmdbId = $('#f-tmdbid').value ? Number($('#f-tmdbid').value) : null;
  const payload = {
    id: editingId || uid(),
    tmdbId,
    mediaType: $('#f-mediatype').value || null,
    type,
    title,
    year: $('#f-year').value.trim(),
    runtime: $('#f-runtime').value ? Number($('#f-runtime').value) : null,
    seasons: type === 'serie' && $('#f-seasons').value ? Number($('#f-seasons').value) : null,
    genres: $('#f-genres').value.split(',').map((g) => g.trim()).filter(Boolean),
    tags: parseTagsInput($('#f-tags').value),
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
  // Where it streams comes from TMDB, not the form: keep it unless the
  // title was pointed at a different TMDB entry.
  if (existingMovie && existingMovie.availableOn && existingMovie.tmdbId === tmdbId) {
    payload.availableOn = existingMovie.availableOn;
  }

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


/* ---------- Event bindings ---------- */

function bindMovieFormEvents() {
  $('#btn-add').addEventListener('click', () => openModal(null));

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
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
}
