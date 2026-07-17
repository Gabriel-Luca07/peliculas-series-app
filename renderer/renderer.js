// Entry point: shared state, small core utilities, and init(). bindEvents()
// here is now just a thin orchestrator that calls each feature file's own
// bindXEvents() (e.g. bindMovieEvents() in movies.js); the numeric-input
// enforcement loop stays inline since it spans movie-form and settings
// fields that don't belong to a single feature. Loaded LAST in index.html,
// after lib/*.js and every renderer/features/*.js file, since its trailing
// init() call needs every function those define to already exist. All of
// these files are plain classic <script>s (no bundler, no import/export)
// sharing one global scope, so cross-file references just work like any
// other function/variable call.
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

  bindGlobalUiEvents();
  bindAppearanceEvents();
  bindMovieEvents();
  bindProfileEvents();
  bindDashboardEvents();
  bindRecommendationsEvents();
  bindShareListEvents();
  bindSubscriptionEvents();
  bindTrashEvents();
  bindUpdaterEvents();
}



// Bootstraps the app once every feature/lib script above has been loaded and
// parsed (this file is the last <script> tag in index.html).
init();
