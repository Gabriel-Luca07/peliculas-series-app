// Adding watched titles in bulk ("Añadir varias vistas") and importing a
// viewing history (Netflix, Letterboxd, IMDb, Trakt or any CSV). Parsing and
// merging are in lib/csv-import-utils.js and lib/merge-logic.js. Plain
// global-scope script — see updater.js for the load-order note.

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


/* ---------- History import (CSV / JSON) ---------- */

// parseImportFile, recordsFromMappedCsv (lib/csv-import-utils.js) and
// applyImportRecords (lib/merge-logic.js) do the work; this is the UI.
// csvParsed is either { format, records } for a recognised export
// (Letterboxd, IMDb, Trakt) or { format: null, headers, rows } for any other
// CSV, whose columns the user maps by hand.

function guessColumn(headers, pattern) {
  const idx = headers.findIndex((h) => pattern.test(h));
  return idx >= 0 ? idx : 0;
}

function showCsvMappingPanel(fileName) {
  const manual = !csvParsed.format;
  $('#csv-manual-fields').classList.toggle('hidden', !manual);

  const lowerName = fileName.toLowerCase();
  let platformGuess = manual ? '' : 'No recuerdo';
  if (lowerName.includes('netflix')) platformGuess = 'Netflix';
  else if (lowerName.includes('prime') || lowerName.includes('amazon')) platformGuess = 'Prime Video';
  else if (lowerName.includes('disney')) platformGuess = 'Disney+';
  else if (lowerName.includes('hbo')) platformGuess = 'HBO Max';
  if (platformGuess && PLATFORMS.includes(platformGuess)) $('#csv-platform').value = platformGuess;
  $('#csv-platform-custom').classList.toggle('hidden', $('#csv-platform').value !== 'Otra');

  if (manual) {
    const { headers, rows } = csvParsed;
    const titleSelect = $('#csv-col-title');
    const dateSelect = $('#csv-col-date');
    titleSelect.innerHTML = headers.map((h, i) => `<option value="${i}">${escapeHtml(h)}</option>`).join('');
    dateSelect.innerHTML = '<option value="">(no importar fecha)</option>' +
      headers.map((h, i) => `<option value="${i}">${escapeHtml(h)}</option>`).join('');
    titleSelect.value = guessColumn(headers, /t[íi]tulo|title|pel[íi]cula|name/i);
    const dateGuess = headers.findIndex((h) => /fecha|date|visto|watched/i.test(h));
    dateSelect.value = dateGuess >= 0 ? String(dateGuess) : '';
    $('#csv-file-info').textContent = `${fileName} · ${rows.length} fila${rows.length === 1 ? '' : 's'} detectada${rows.length === 1 ? '' : 's'}`;
  } else {
    const { records, format } = csvParsed;
    const watched = records.filter((r) => r.status === 'vista').length;
    const pending = records.length - watched;
    const parts = [];
    if (watched) parts.push(`${watched} vista${watched === 1 ? '' : 's'}`);
    if (pending) parts.push(`${pending} pendiente${pending === 1 ? '' : 's'}`);
    $('#csv-file-info').textContent = `${fileName} · formato ${format.label} · ${parts.join(' y ') || 'sin títulos'}`;
  }

  $('#csv-mapping').classList.remove('hidden');
  $('#csv-import-status').textContent = '';
}

function csvPlatformValue() {
  const select = $('#csv-platform').value;
  if (select === 'Otra') return $('#csv-platform-custom').value.trim();
  return select;
}

async function applyCsvImport() {
  if (!csvParsed) return;
  const status = $('#csv-import-status');
  const platform = csvPlatformValue();
  if (!platform) {
    status.classList.add('error');
    status.textContent = 'Indica la plataforma (o escribe una personalizada).';
    return;
  }

  const records = csvParsed.format
    ? csvParsed.records
    : recordsFromMappedCsv(csvParsed.rows, {
      titleIdx: Number($('#csv-col-title').value),
      dateIdx: $('#csv-col-date').value === '' ? -1 : Number($('#csv-col-date').value),
      defaultType: $('#csv-type').value,
    });
  if (!records.length) {
    status.classList.add('error');
    status.textContent = 'No se ha detectado ninguna fila con título válido.';
    return;
  }

  const preview = applyImportRecords(movies, records, {
    platform,
    today: todayLocalDateString(),
    now: new Date().toISOString(),
    newId: uid,
  });
  if (!preview.added && !preview.updated) {
    status.classList.remove('error');
    status.textContent = `No hay nada nuevo que importar: los ${preview.unchanged} títulos del archivo ya están en tu lista.`;
    return;
  }

  const confirmMsg = `Se añadirán ${preview.added} título${preview.added === 1 ? '' : 's'} nuevo${preview.added === 1 ? '' : 's'}`
    + ` y se actualizarán ${preview.updated} que ya tenías`
    + (preview.unchanged ? ` (${preview.unchanged} ya estaba${preview.unchanged === 1 ? '' : 'n'} al día)` : '')
    + '. Las vistas se guardan en la plataforma elegida. ¿Continuar?';
  if (!confirm(confirmMsg)) return;

  movies = preview.movies;
  await saveMovies();
  renderAll();
  csvParsed = null;
  $('#csv-mapping').classList.add('hidden');
  status.classList.remove('error');
  status.textContent = `Importación completa: ${preview.added} añadido${preview.added === 1 ? '' : 's'}, ${preview.updated} actualizado${preview.updated === 1 ? '' : 's'}.`;
  // Imported pending titles may already be on a platform you pay for.
  loadFollowups();
}


/* ---------- Event bindings ---------- */

function bindHistoryImportEvents() {
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
    const parsed = parseImportFile(res.text, res.fileName);
    if (parsed.error || (parsed.format && !parsed.records.length)) {
      status.classList.add('error');
      status.textContent = 'El archivo no parece un historial válido (CSV, o JSON de Trakt).';
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
}
