// Entry point: shared state, small core utilities, init(), and bindEvents()
// (all event-listener wiring, kept as one function deliberately — it's the
// riskiest part to split since its handlers close over several of the `let`s
// declared just below). Loaded LAST in index.html, after lib/*.js and every
// renderer/features/*.js file, since its trailing init() call needs every
// function those define to already exist. All of these files are plain
// classic <script>s (no bundler, no import/export) sharing one global scope,
// so cross-file references just work like any other function/variable call.
const DEFAULT_PLATFORMS = [
  'Netflix', 'HBO Max', 'Disney+', 'Prime Video', 'Movistar Plus+',
  'Apple TV+', 'Filmin', 'SkyShowtime', 'Rakuten TV', 'Cine',
  'DVD/Blu-ray', 'Pirata', 'No recuerdo', 'Otra',
];
let PLATFORMS = [...DEFAULT_PLATFORMS];

const GENRES_LIST = [
  'Acción', 'Acción y Aventura', 'Animación', 'Aventura', 'Bélica', 'Ciencia ficción',
  'Ciencia ficción y Fantasía', 'Comedia', 'Crimen', 'Documental', 'Drama', 'Familia',
  'Fantasía', 'Historia', 'Infantil', 'Misterio', 'Música', 'Reality', 'Romance',
  'Suspense', 'Terror', 'Western',
];

const TYPE_LABELS = { pelicula: 'Película', serie: 'Serie' };

const PROVIDER_NAME_MAP = {
  'Amazon Prime Video': 'Prime Video',
  'Amazon Video': 'Prime Video',
  'Disney Plus': 'Disney+',
  'HBO Max': 'HBO Max',
  Max: 'HBO Max',
  'Apple TV Plus': 'Apple TV+',
  'Apple TV': 'Apple TV+',
  'Movistar Plus': 'Movistar Plus+',
};

function normalizeProviderName(name) {
  if (PROVIDER_NAME_MAP[name]) return PROVIDER_NAME_MAP[name];
  const found = PLATFORMS.find((p) => p.toLowerCase() === name.toLowerCase());
  return found || null;
}

const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];
const OTHER_COLOR = 'var(--series-other)';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

let movies = [];
let settings = { tmdbApiKey: '' };
let searchTimer = null;
let editingId = null;
let csvParsed = null;
let activeProfileId = null;
let allProfiles = [];

function pk(key) { return `p:${activeProfileId}:${key}`; }

let PAGE_SIZE = 48;
let pendientesPageSize = PAGE_SIZE;
let vistasPageSize = PAGE_SIZE;
let recommendationsCache = null;
let recommendationsMoviePool = null;
let recommendationsTvPool = null;
let recommendationsSignature = null;
const RECS_DISPLAY_COUNT = 16;
const RECS_TV_QUOTA = 2;
let upcomingCache = null;
let shareLists = [];
let shareConfigPreview = null;
let subscriptions = [];
let subscriptionHistory = [];
let providerLogos = {};
let providerIds = {};
const NON_SUBSCRIPTION_PLATFORMS = new Set(['Cine', 'DVD/Blu-ray', 'Pirata', 'No recuerdo', 'Otra']);
let trash = [];
const TRASH_RETENTION_DAYS = 30;
const selectionMode = { pendientes: false, vistas: false };
const selectedIds = { pendientes: new Set(), vistas: new Set() };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// localDateStringAt, todayLocalDateString (lib/date-utils.js), escapeHtml
// (lib/html-utils.js) are loaded as global <script>s in index.html before this
// file, so they're already available here.

function pluralize(n, singular, plural) {
  return n === 1 ? singular : (plural || `${singular}s`);
}

function getPending() { return movies.filter((m) => m.status === 'pendiente' || m.status === 'viendo'); }
function getWatched() { return movies.filter((m) => m.status === 'vista'); }

async function init() {
  await resolveActiveProfile();
  initTheme();
  initAppearance();
  loadPlatforms();
  initBehaviorPrefs();
  initPanelVisibility();
  movies = await window.api.loadMovies();
  settings = await window.api.loadSettings();
  trash = await window.api.loadTrash();
  shareLists = await window.api.listShareLists();
  subscriptions = await window.api.listSubscriptions();
  subscriptionHistory = await window.api.listSubscriptionHistory();
  await purgeOldTrash();
  $('#tmdb-key').value = settings.tmdbApiKey || '';
  $('#tmdb-language').value = settings.language || 'es-ES';
  $('#tmdb-region').value = settings.region || 'ES';
  $('#auto-backup-toggle').checked = settings.autoBackupEnabled !== false;
  $('#auto-backup-retention').value = settings.autoBackupRetentionDays || 14;
  bindEvents();
  renderPlatformsList();
  renderAll();
  renderTrash();
  renderShareListsGrid();
  renderSubscriptions();
  renderSubscriptionHistory();
  fillSubPlannerPlatforms();
  updateSubPlannerResult();
  updateNavIndicator();
  switchView(localStorage.getItem(pk('pref-start-view')) || 'dashboard');
  if (localStorage.getItem(pk('pref-recs-enabled')) !== 'false') loadRecommendations();
  loadUpcomingReleases();
  loadProviderLogos();
  window.api.getAppVersion().then((v) => { $('#app-version').textContent = `v${v}`; });
  updateProfileBadge();
  initAutoUpdater();
}

/* ---------- Events ---------- */

const NUMERIC_INPUT_ALLOWED_KEYS = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

function isNumericKeydownAllowed(e, currentValue, allowDecimal) {
  if (NUMERIC_INPUT_ALLOWED_KEYS.includes(e.key) || e.ctrlKey || e.metaKey) return true;
  if (allowDecimal && e.key === '.' && !currentValue.includes('.')) return true;
  return /^[0-9]$/.test(e.key);
}

function sanitizeNumericValue(value, allowDecimal) {
  if (!allowDecimal) return value.replace(/\D/g, '');
  let cleaned = value.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  return cleaned;
}

function enforceNumericInput(el) {
  el.addEventListener('input', () => {
    const maxLen = el.getAttribute('maxlength');
    let digits = sanitizeNumericValue(el.value, false);
    if (maxLen) digits = digits.slice(0, Number(maxLen));
    el.value = digits;
  });
  el.addEventListener('keydown', (e) => {
    if (!isNumericKeydownAllowed(e, el.value, false)) e.preventDefault();
  });
}

function bindEvents() {
  ['#f-year', '#f-runtime', '#f-seasons', '#f-current-season', '#f-current-episode', '#auto-backup-retention'].forEach((sel) => {
    enforceNumericInput($(sel));
  });

  // If the app is left running (minimized/backgrounded) with the Suscripciones
  // tab already open across a billing cycle boundary, switchView() won't fire
  // again to trigger the refetch — catch that case when the window regains focus.
  window.addEventListener('focus', async () => {
    const activeSection = $('.view.active');
    if (!activeSection || activeSection.id !== 'view-suscripciones') return;
    subscriptions = await window.api.listSubscriptions();
    subscriptionHistory = await window.api.listSubscriptionHistory();
    renderSubscriptions();
    renderSubscriptionHistory();
    updateSubPlannerResult();
  });

  document.addEventListener('mousemove', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn, .icon-btn');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });

  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('#btn-add').addEventListener('click', () => openModal(null));
  $('#btn-pick').addEventListener('click', pickRandomPending);
  $('#btn-theme-toggle').addEventListener('click', toggleTheme);

  $$('.swatch[data-accent]').forEach((s) => s.addEventListener('click', () => setAccent(s.dataset.accent)));
  $$('.swatch[data-chart-color]').forEach((s) => s.addEventListener('click', () => setChartColor(s.dataset.chartColor)));
  $$('.segment').forEach((s) => s.addEventListener('click', () => setDensity(s.dataset.density)));
  $('#motion-toggle').addEventListener('change', (e) => setMotion(e.target.checked));

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  const resetPendientesPageAndRender = () => { pendientesPageSize = PAGE_SIZE; renderPendientes(); };
  const resetVistasPageAndRender = () => { vistasPageSize = PAGE_SIZE; renderVistas(); };

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

  $('#pref-start-view').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-start-view'), e.target.value);
  });
  $('#pref-sort-pendientes').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-sort-pendientes'), e.target.value);
    $('#sort-pendientes').value = e.target.value;
    resetPendientesPageAndRender();
  });
  $('#pref-sort-vistas').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-sort-vistas'), e.target.value);
    $('#sort-vistas').value = e.target.value;
    resetVistasPageAndRender();
  });
  $('#pref-page-size').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-page-size'), e.target.value);
    PAGE_SIZE = Number(e.target.value) || 48;
    pendientesPageSize = PAGE_SIZE;
    vistasPageSize = PAGE_SIZE;
    renderPendientes();
    renderVistas();
  });
  $('#pref-delete-mode').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-delete-mode'), e.target.value);
  });
  $('#pref-recs-toggle').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-recs-enabled'), String(e.target.checked));
    if (e.target.checked && !recommendationsCache) loadRecommendations();
  });
  $('#pref-anniv-toggle').addEventListener('change', (e) => {
    localStorage.setItem(pk('pref-anniv-enabled'), String(e.target.checked));
    renderDashboard();
  });
  $$('.panel-toggle').forEach((toggle) => {
    toggle.addEventListener('change', (e) => {
      setPanelVisibility(toggle.dataset.panel, e.target.checked);
    });
  });

  $('#btn-add-platform').addEventListener('click', () => {
    addCustomPlatform($('#new-platform-input').value);
    $('#new-platform-input').value = '';
  });
  $('#new-platform-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomPlatform($('#new-platform-input').value);
      $('#new-platform-input').value = '';
    }
  });

  $('#btn-open-data-folder').addEventListener('click', () => window.api.openDataFolder());
  $('#btn-open-backups-folder').addEventListener('click', () => window.api.openBackupsFolder());
  $('#btn-backup-now').addEventListener('click', async () => {
    await window.api.runBackupNow();
    showToast('Copia de seguridad guardada');
  });
  $('#auto-backup-toggle').addEventListener('change', async (e) => {
    settings.autoBackupEnabled = e.target.checked;
    await window.api.saveSettings(settings);
  });
  $('#auto-backup-retention').addEventListener('change', async (e) => {
    settings.autoBackupRetentionDays = Number(e.target.value) || 14;
    await window.api.saveSettings(settings);
  });
  $('#btn-reset-appearance').addEventListener('click', () => {
    resetAppearance();
    showToast('Apariencia restablecida a los valores por defecto');
  });
  $('#btn-wipe-data').addEventListener('click', async () => {
    const count = movies.length;
    if (!count) { showToast('Tu lista ya está vacía', 'error'); return; }
    if (!confirm(`Esto eliminará TODAS tus películas y series guardadas (${count} títulos). Esta acción no se puede deshacer. ¿Continuar?`)) return;
    movies = [];
    await saveMovies();
    renderAll();
    showToast('Se han borrado todos los datos', 'error');
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

  $('#save-settings').addEventListener('click', async () => {
    settings.tmdbApiKey = $('#tmdb-key').value.trim();
    settings.language = $('#tmdb-language').value;
    settings.region = $('#tmdb-region').value;
    await window.api.saveSettings(settings);
    const status = $('#settings-status');
    status.textContent = 'Ajustes guardados.';
    status.classList.remove('error');
    setTimeout(() => { status.textContent = ''; }, 2500);
  });

  $('#btn-export').addEventListener('click', async () => {
    const status = $('#backup-status');
    const res = await window.api.exportData();
    if (res.canceled) return;
    status.classList.remove('error');
    status.textContent = `Copia guardada en ${res.filePath}`;
  });

  $('#btn-import').addEventListener('click', async () => {
    const status = $('#backup-status');
    const res = await window.api.importData();
    if (res.canceled) return;
    if (res.error) {
      status.classList.add('error');
      status.textContent = 'El archivo seleccionado no es una copia de seguridad válida.';
      return;
    }
    const payload = res.payload;
    const parts = [`${payload.movies.length} título${payload.movies.length === 1 ? '' : 's'}`];
    if (Array.isArray(payload.trash)) parts.push(`${payload.trash.length} en la papelera`);
    if (Array.isArray(payload.subscriptions)) parts.push(`${payload.subscriptions.length} suscripciones`);
    if (Array.isArray(payload.shareLists)) parts.push(`${payload.shareLists.length} listas de Recomendar`);
    if (payload.settings) parts.push('tus ajustes');
    if (payload.profileAppearance) parts.push('la apariencia del perfil (color/foto)');
    if (!confirm(`Se importará: ${parts.join(', ')}. Esto reemplazará lo anterior de cada uno por lo del archivo (lo que no incluya el archivo se queda como está). ¿Continuar?`)) return;

    const applyRes = await window.api.applyImportedBackup(payload);
    if (!applyRes || applyRes.error) {
      status.classList.add('error');
      status.textContent = 'No se pudo aplicar la copia de seguridad.';
      return;
    }

    movies = await window.api.loadMovies();
    trash = await window.api.loadTrash();
    subscriptions = await window.api.listSubscriptions();
    shareLists = await window.api.listShareLists();
    settings = await window.api.loadSettings();
    allProfiles = (await window.api.listProfiles()).profiles;

    $('#tmdb-language').value = settings.language || 'es-ES';
    $('#tmdb-region').value = settings.region || 'ES';
    $('#auto-backup-toggle').checked = settings.autoBackupEnabled !== false;
    $('#auto-backup-retention').value = settings.autoBackupRetentionDays || 14;

    renderAll();
    renderTrash();
    renderSubscriptions();
    fillSubPlannerPlatforms();
    updateSubPlannerResult();
    renderShareListsGrid();
    updateProfileBadge();

    status.classList.remove('error');
    status.textContent = `Copia importada correctamente (${applyRes.counts.movies} títulos).`;
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

  $('#btn-global-search').addEventListener('click', openGlobalSearch);
  $('#global-search-close').addEventListener('click', closeGlobalSearch);
  $('#global-search-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'global-search-overlay') closeGlobalSearch();
  });
  $('#global-search-input').addEventListener('input', (e) => {
    renderGlobalSearchResults(e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const overlay = $('#global-search-overlay');
      if (overlay.classList.contains('hidden')) openGlobalSearch();
      else closeGlobalSearch();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('#global-search-overlay').classList.contains('hidden')) closeGlobalSearch();
      else if (!$('#modal-overlay').classList.contains('hidden')) closeModal();
      else if (!$('#bulk-overlay').classList.contains('hidden')) closeBulkModal();
      else if (!$('#wrapped-overlay').classList.contains('hidden')) closeWrappedModal();
      else if (!$('#share-config-overlay').classList.contains('hidden')) closeShareConfigModal();
      else if (!$('#profile-overlay').classList.contains('hidden') && !$('#profile-close-btn').classList.contains('hidden')) {
        $('#profile-close-btn').click();
      }
    }
  });

  $('#profile-switcher-btn').addEventListener('click', () => {
    showProfilePicker({ forced: false });
  });

  $('#btn-wrapped').addEventListener('click', openWrappedModal);
  $('#wrapped-close').addEventListener('click', closeWrappedModal);
  $('#wrapped-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'wrapped-overlay') closeWrappedModal();
  });
  $('#wrapped-year').addEventListener('change', (e) => renderWrappedContent(e.target.value));

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

  $('#btn-refresh-recs').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin-once');
    await loadRecommendations();
    setTimeout(() => btn.classList.remove('spin-once'), 500);
  });

  $('#btn-refresh-upcoming').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spin-once');
    await loadUpcomingReleases(true);
    setTimeout(() => btn.classList.remove('spin-once'), 500);
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

  $('#btn-empty-trash').addEventListener('click', emptyTrash);

  $('#btn-check-updates').addEventListener('click', async () => {
    const statusEl = $('#update-status');
    statusEl.textContent = 'Buscando actualizaciones...';
    const res = await window.api.checkForUpdates();
    if (res.error === 'DEV_MODE') {
      statusEl.textContent = 'La búsqueda de actualizaciones solo funciona en la versión instalada.';
    } else if (res.error) {
      statusEl.textContent = 'No se pudo comprobar si hay actualizaciones (revisa tu conexión).';
    } else if (res.version) {
      pendingUpdateInfo = { version: res.version, releaseNotes: res.releaseNotes };
      refreshUpdateNotesButton();
      statusEl.textContent = `Hay una versión nueva (${res.version}); descargándola en segundo plano...`;
    } else {
      statusEl.textContent = 'Ya tienes la última versión.';
    }
  });

  $('#btn-view-update-notes').addEventListener('click', openUpdateNotesModal);
  $('#btn-restart-update').addEventListener('click', () => window.api.installUpdate());
  $('#update-notes-close').addEventListener('click', closeUpdateNotesModal);
  $('#update-notes-later').addEventListener('click', closeUpdateNotesModal);
  $('#update-notes-install').addEventListener('click', () => {
    if (updateReadyToInstall) window.api.installUpdate();
  });
  $('#update-notes-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'update-notes-overlay') closeUpdateNotesModal();
  });

  $('#btn-new-share-list').addEventListener('click', openShareConfigModal);
  $('#share-config-close').addEventListener('click', closeShareConfigModal);
  $('#share-config-cancel').addEventListener('click', closeShareConfigModal);
  $('#share-config-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'share-config-overlay') closeShareConfigModal();
  });
  $('#share-type-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const type = chip.dataset.type;
    if (shareTypeSelection.has(type)) {
      if (shareTypeSelection.size === 1) return;
      shareTypeSelection.delete(type);
      chip.classList.remove('selected');
    } else {
      shareTypeSelection.add(type);
      chip.classList.add('selected');
    }
  });
  $('#share-generate-preview').addEventListener('click', generateSharePreview);
  $('#share-shuffle-preview').addEventListener('click', generateSharePreview);
  $('#share-download-btn').addEventListener('click', downloadShareImage);
  $('#share-mode-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setShareMode(chip.dataset.mode);
  });
  $('#share-manual-search-input').addEventListener('input', (e) => {
    clearTimeout(shareSearchTimer);
    const query = e.target.value.trim();
    if (!query) {
      $('#share-manual-search-results').innerHTML = '';
      $('#share-manual-search-hint').textContent = '';
      return;
    }
    shareSearchTimer = setTimeout(() => runShareManualSearch(query), 400);
  });

  $('#subscriptions-grid').addEventListener('click', async (e) => {
    const activateBtn = e.target.closest('.subscription-activate-btn');
    const cancelBtn = e.target.closest('.subscription-cancel-btn');
    const renewBtn = e.target.closest('.subscription-renew-btn');
    const confirmBtn = e.target.closest('.subscription-confirm-btn');
    const editBtn = e.target.closest('.subscription-edit-btn');

    if (activateBtn) {
      const card = activateBtn.closest('.subscription-card');
      card.querySelector('.subscription-date-row').classList.remove('hidden');
      activateBtn.classList.add('hidden');
      return;
    }
    if (editBtn) {
      const card = editBtn.closest('.subscription-card');
      const dateRow = card.querySelector('.subscription-date-row');
      const enteringEdit = dateRow.classList.contains('hidden');
      dateRow.classList.toggle('hidden');
      card.querySelector('.subscription-price-input').disabled = !enteringEdit;
      card.querySelector('.subscription-cycle-input').disabled = !enteringEdit;
      editBtn.textContent = enteringEdit ? 'Cerrar' : 'Editar';
      return;
    }
    if (confirmBtn) {
      const platform = confirmBtn.dataset.platform;
      const card = confirmBtn.closest('.subscription-card');
      const dateVal = card.querySelector('.subscription-date-input').value;
      const cycleVal = Number(card.querySelector('.subscription-cycle-input').value);
      if (!dateVal) return;
      const ok = await activateSubscription(platform, dateVal, cycleVal);
      if (ok) {
        renderSubscriptions();
        renderSubscriptionHistory();
        updateSubPlannerResult();
        showToast(`${platform} activada`);
      }
      return;
    }
    if (cancelBtn) {
      const platform = cancelBtn.dataset.platform;
      if (!confirm(`¿Cancelar la renovación de ${platform}? Seguirás teniendo acceso hasta que termine el ciclo que ya has pagado.`)) return;
      const res = await window.api.cancelSubscription(platform);
      subscriptions = res.subscriptions;
      subscriptionHistory = res.history;
      renderSubscriptions();
      renderSubscriptionHistory();
      updateSubPlannerResult();
      showToast(`${platform}: no se renovará, pero conservas el acceso que ya pagaste`, 'error');
      return;
    }
    if (renewBtn) {
      const platform = renewBtn.dataset.platform;
      const res = await window.api.renewSubscription(platform);
      subscriptions = res.subscriptions;
      subscriptionHistory = res.history;
      renderSubscriptions();
      renderSubscriptionHistory();
      updateSubPlannerResult();
      showToast(`${platform} volverá a renovarse`);
    }
  });

  $('#subscriptions-grid').addEventListener('change', async (e) => {
    // The date field is only meant to auto-save while editing an already-active
    // subscription; for a not-yet-active one it's just part of the "Activar" form
    // and only takes effect when "Confirmar" is clicked.
    const dateInput = e.target.closest('.subscription-date-input');
    if (dateInput) {
      const card = dateInput.closest('.subscription-card');
      if (card.classList.contains('active') && dateInput.value) {
        const platform = card.dataset.platform;
        const res = await window.api.upsertSubscription(platform, { startDate: dateInput.value });
        if (res.error === 'OVERLAPS_EXISTING') {
          showToast(subscriptionOverlapMessage(platform, res.conflict), 'error', { duration: 7000 });
          dateInput.value = getSubscription(platform).startDate || dateInput.value;
          return;
        }
        subscriptions = res.subscriptions;
        subscriptionHistory = res.history;
        updateSubscriptionStatusDisplay(platform);
        renderSubscriptionHistory();
        updateSubPlannerResult();
      }
      return;
    }
    const priceInput = e.target.closest('.subscription-price-input');
    if (priceInput) {
      const platform = priceInput.dataset.platform;
      const parsed = Number(priceInput.value);
      const price = priceInput.value !== '' && Number.isFinite(parsed) ? parsed : null;
      if (price === null) priceInput.value = '';
      const res = await window.api.upsertSubscription(platform, { price });
      subscriptions = res.subscriptions;
      subscriptionHistory = res.history;
      renderSubscriptionHistory();
      updateSubPlannerResult();
      return;
    }
    const cycleInput = e.target.closest('.subscription-cycle-input');
    if (cycleInput) {
      const platform = cycleInput.dataset.platform;
      const cycleDays = Number(cycleInput.value);
      const res = await window.api.upsertSubscription(platform, { cycleDays });
      if (res.error === 'OVERLAPS_EXISTING') {
        showToast(subscriptionOverlapMessage(platform, res.conflict), 'error', { duration: 7000 });
        cycleInput.value = getSubscription(platform).cycleDays || 30;
        return;
      }
      subscriptions = res.subscriptions;
      subscriptionHistory = res.history;
      const cycleOpt = CYCLE_OPTIONS.find((o) => o.value === cycleDays);
      updateSubscriptionStatusDisplay(platform);
      renderSubscriptionHistory();
      updateSubPlannerResult();
      showToast(`${platform}: ciclo cambiado a ${cycleOpt ? cycleOpt.label.toLowerCase() : cycleDays + ' días'}`);
    }
  });

  $('#subscriptions-grid').addEventListener('keydown', (e) => {
    const priceInput = e.target.closest('.subscription-price-input');
    if (!priceInput) return;
    if (!isNumericKeydownAllowed(e, priceInput.value, true)) e.preventDefault();
  });

  $('#subscriptions-grid').addEventListener('input', (e) => {
    const priceInput = e.target.closest('.subscription-price-input');
    if (!priceInput) return;
    const sanitized = sanitizeNumericValue(priceInput.value, true);
    if (sanitized !== priceInput.value) priceInput.value = sanitized;
  });

  $('#sub-planner-platform').addEventListener('change', updateSubPlannerResult);
  $('#sub-planner-result').addEventListener('click', async (e) => {
    const btn = e.target.closest('#sub-planner-activate-btn');
    if (!btn) return;
    const platform = btn.dataset.platform;
    const today = todayLocalDateString();
    const ok = await activateSubscription(platform, today);
    if (ok) {
      renderSubscriptions();
      renderSubscriptionHistory();
      updateSubPlannerResult();
      showToast(`${platform} activada`);
    }
  });
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


// Bootstraps the app once every feature/lib script above has been loaded and
// parsed (this file is the last <script> tag in index.html).
init();
