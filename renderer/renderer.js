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

/* ---------- Auto-actualización ---------- */

let pendingUpdateInfo = null; // { version, releaseNotes }
let updateReadyToInstall = false;

function refreshUpdateNotesButton() {
  const btn = $('#btn-view-update-notes');
  if (btn) btn.classList.toggle('hidden', !(pendingUpdateInfo && pendingUpdateInfo.releaseNotes));
}

function renderUpdateNotesBody(notes) {
  if (!notes) return '<p class="help">No hay notas de esta versión disponibles.</p>';
  return `<pre class="update-notes-text">${escapeHtml(notes)}</pre>`;
}

function openUpdateNotesModal() {
  if (!pendingUpdateInfo) return;
  $('#update-notes-version').textContent = pendingUpdateInfo.version || '';
  $('#update-notes-body').innerHTML = renderUpdateNotesBody(pendingUpdateInfo.releaseNotes);
  const installBtn = $('#update-notes-install');
  installBtn.disabled = !updateReadyToInstall;
  installBtn.textContent = updateReadyToInstall ? 'Reiniciar ahora' : 'Descargando...';
  showOverlay($('#update-notes-overlay'));
}

function closeUpdateNotesModal() {
  hideOverlay($('#update-notes-overlay'));
}

function initAutoUpdater() {
  window.api.onUpdaterStatus((status) => {
    const statusEl = $('#update-status');
    const restartBtn = $('#btn-restart-update');
    if (status.state === 'available') {
      pendingUpdateInfo = { version: status.version, releaseNotes: status.releaseNotes };
      updateReadyToInstall = false;
      refreshUpdateNotesButton();
      if (statusEl) statusEl.textContent = `Descargando la versión ${status.version}...`;
    } else if (status.state === 'downloaded') {
      pendingUpdateInfo = {
        version: status.version,
        releaseNotes: status.releaseNotes || (pendingUpdateInfo && pendingUpdateInfo.releaseNotes) || null,
      };
      updateReadyToInstall = true;
      refreshUpdateNotesButton();
      if (statusEl) statusEl.textContent = `Versión ${status.version} descargada y lista para instalar.`;
      if (restartBtn) restartBtn.classList.remove('hidden');
      showToast(`Nueva versión ${status.version} descargada`, 'success', {
        actionLabel: 'Ver novedades',
        onAction: () => openUpdateNotesModal(),
        duration: 15000,
      });
    } else if (status.state === 'error') {
      if (statusEl) statusEl.textContent = '';
    }
  });
}

/* ---------- Profiles ---------- */

function profileInitial(profile) {
  if (profile && profile.initial) return profile.initial.trim().toUpperCase();
  const name = profile && profile.name;
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function avatarInnerHtml(profile) {
  if (profile && profile.avatarUrl) {
    return `<img class="avatar-img" src="${profile.avatarUrl}" alt="">`;
  }
  return escapeHtml(profileInitial(profile));
}

async function resolveActiveProfile() {
  const data = await window.api.listProfiles();
  allProfiles = data.profiles || [];
  if (sessionStorage.getItem('skipProfilePicker') === '1') {
    sessionStorage.removeItem('skipProfilePicker');
    const last = allProfiles.find((p) => p.id === data.lastActiveProfileId);
    if (last) {
      activeProfileId = last.id;
      return;
    }
  }
  const chosen = await showProfilePicker({ forced: true });
  activeProfileId = chosen.id;
  await window.api.setActiveProfile(chosen.id);
}

function updateProfileBadge() {
  const profile = allProfiles.find((p) => p.id === activeProfileId);
  const nameEl = $('#profile-name');
  const avatarEl = $('#profile-avatar');
  if (!nameEl || !avatarEl || !profile) return;
  nameEl.textContent = profile.name;
  avatarEl.innerHTML = avatarInnerHtml(profile);
  avatarEl.style.background = profile.avatarUrl ? 'transparent' : profileColorValue(profile.color);
}

const PROFILE_COLORS = [
  'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8',
  '#14b8a6', '#84cc16', '#f97316', '#6366f1', '#10b981', '#ff6f59', '#d6409f', '#ca8a04',
  '#0ea5e9', '#a855f7', '#ec4899', '#eab308', '#059669', '#dc2626', '#64748b', '#0891b2',
];

function profileColorValue(color) {
  if (!color) return 'var(--series-1)';
  return color.startsWith('series-') ? `var(--${color})` : color;
}

function renderProfileGrid(mode) {
  const grid = $('#profile-grid');
  grid.innerHTML = allProfiles.map((p) => `
    <div class="profile-card" data-id="${p.id}">
      <div class="profile-card-avatar" style="background:${p.avatarUrl ? 'transparent' : escapeHtml(profileColorValue(p.color))}">${avatarInnerHtml(p)}</div>
      <div class="profile-card-name">${escapeHtml(p.name)}</div>
      ${mode === 'manage' ? `
        <div class="profile-card-actions">
          <button type="button" class="profile-card-rename" data-id="${p.id}" title="Renombrar">✎</button>
          <button type="button" class="profile-card-delete" data-id="${p.id}" title="Eliminar">✕</button>
        </div>
      ` : ''}
    </div>
  `).join('') + `
    <div class="profile-card profile-card-add" id="profile-add-card">
      <div class="profile-card-avatar profile-card-avatar-add">+</div>
      <div class="profile-card-name">Nuevo perfil</div>
    </div>
  `;
}

function showProfilePicker({ forced }) {
  return new Promise((resolve) => {
    const overlay = $('#profile-overlay');
    const closeBtn = $('#profile-close-btn');
    const manageBtn = $('#profile-manage-btn');
    const form = $('#profile-form');
    const deleteConfirm = $('#profile-delete-confirm');
    const deleteNameLabel = $('#profile-delete-name-label');
    const deleteConfirmInput = $('#profile-delete-confirm-input');
    const deleteConfirmBtn = $('#profile-delete-confirm-btn');
    const deleteCancelBtn = $('#profile-delete-cancel');
    const deletedSection = $('#profile-deleted-section');
    const deletedList = $('#profile-deleted-list');
    let mode = 'pick';
    let pendingDeleteProfile = null;
    let deletedProfiles = [];

    closeBtn.classList.toggle('hidden', forced);
    manageBtn.classList.toggle('hidden', allProfiles.length === 0);
    manageBtn.textContent = 'Gestionar perfiles';
    form.classList.add('hidden');
    deleteConfirm.classList.add('hidden');
    deletedSection.classList.add('hidden');

    function renderGrid() {
      renderProfileGrid(mode);
    }
    renderGrid();

    function renderDeletedList() {
      deletedSection.classList.toggle('hidden', mode !== 'manage' || deletedProfiles.length === 0);
      deletedList.innerHTML = deletedProfiles.map((p) => {
        const days = Math.floor((Date.now() - new Date(p.deletedAt).getTime()) / 86400000);
        const daysLeft = Math.max(30 - days, 0);
        return `
          <div class="profile-deleted-item" data-id="${p.id}">
            <div class="profile-deleted-avatar" style="background:${p.avatarUrl ? 'transparent' : escapeHtml(profileColorValue(p.color))}">${avatarInnerHtml(p)}</div>
            <div class="profile-deleted-info">
              <div class="profile-deleted-name">${escapeHtml(p.name)}</div>
              <div class="profile-deleted-meta">Eliminado hace ${days} día${days === 1 ? '' : 's'} · disponible ${daysLeft} día${daysLeft === 1 ? '' : 's'} más</div>
            </div>
            <div class="profile-deleted-actions">
              <button type="button" class="btn profile-restore-btn" data-id="${p.id}">Restaurar</button>
            </div>
          </div>
        `;
      }).join('');
      deletedList.querySelectorAll('.profile-restore-btn').forEach((btn) => {
        btn.addEventListener('click', () => restoreDeletedProfile(btn.dataset.id));
      });
    }

    async function loadDeletedProfiles() {
      deletedProfiles = await window.api.listDeletedProfiles();
      renderDeletedList();
    }

    async function restoreDeletedProfile(id) {
      const res = await window.api.restoreProfile(id);
      if (res.error) return;
      deletedProfiles = deletedProfiles.filter((p) => p.id !== id);
      allProfiles.push(res.profile);
      renderGrid();
      renderDeletedList();
      showToast(`${res.profile.name} restaurado`);
    }

    function cleanup() {
      overlay.removeEventListener('click', onGridClick);
      manageBtn.removeEventListener('click', onToggleManage);
      closeBtn.removeEventListener('click', onClose);
      $('#profile-form-cancel').removeEventListener('click', onFormCancel);
      $('#profile-form').removeEventListener('submit', onFormSubmit);
      deleteConfirmInput.removeEventListener('input', onDeleteConfirmInput);
      deleteConfirmBtn.removeEventListener('click', onDeleteConfirmClick);
      deleteCancelBtn.removeEventListener('click', closeDeleteConfirm);
      $('#profile-form-avatar-pick').removeEventListener('click', onAvatarPick);
      $('#profile-form-avatar-clear').removeEventListener('click', onAvatarClear);
      hideOverlay(overlay);
    }

    function onToggleManage() {
      mode = mode === 'manage' ? 'pick' : 'manage';
      manageBtn.textContent = mode === 'manage' ? 'Listo' : 'Gestionar perfiles';
      renderGrid();
      if (mode === 'manage') {
        loadDeletedProfiles();
      } else {
        deletedSection.classList.add('hidden');
      }
    }

    function openDeleteConfirm(profile) {
      form.classList.add('hidden');
      pendingDeleteProfile = profile;
      deleteNameLabel.textContent = profile.name;
      deleteConfirmInput.value = '';
      deleteConfirmBtn.disabled = true;
      deleteConfirm.classList.remove('hidden');
      deleteConfirmInput.focus();
    }

    function closeDeleteConfirm() {
      pendingDeleteProfile = null;
      deleteConfirm.classList.add('hidden');
    }

    function onDeleteConfirmInput() {
      deleteConfirmBtn.disabled = !pendingDeleteProfile
        || deleteConfirmInput.value.trim() !== pendingDeleteProfile.name;
    }

    async function onDeleteConfirmClick() {
      if (!pendingDeleteProfile) return;
      const profile = pendingDeleteProfile;
      const res = await window.api.deleteProfile(profile.id);
      if (res.error === 'LAST_PROFILE') {
        alert('No puedes eliminar el único perfil.');
        return;
      }
      allProfiles = allProfiles.filter((p) => p.id !== profile.id);
      closeDeleteConfirm();
      renderGrid();
      await loadDeletedProfiles();
      showToast(`${profile.name} eliminado. Puedes restaurarlo desde "Perfiles eliminados".`);
      if (res.wasActive) {
        cleanup();
        location.reload();
      }
    }

    function openCreateForm() {
      closeDeleteConfirm();
      form.classList.remove('hidden');
      form.dataset.editId = '';
      $('#profile-form-title').textContent = 'Nuevo perfil';
      $('#profile-form-name').value = '';
      $('#profile-form-initial').value = '';
      renderColorSwatches(PROFILE_COLORS[allProfiles.length % PROFILE_COLORS.length]);
      renderAvatarSection(null);
      $('#profile-form-name').focus();
    }

    function openEditForm(profile) {
      closeDeleteConfirm();
      form.classList.remove('hidden');
      form.dataset.editId = profile.id;
      $('#profile-form-title').textContent = 'Editar perfil';
      $('#profile-form-name').value = profile.name;
      $('#profile-form-initial').value = profile.initial || '';
      renderColorSwatches(profile.color || 'series-1');
      renderAvatarSection(profile);
      $('#profile-form-name').focus();
    }

    function renderAvatarSection(profile) {
      const section = $('#profile-form-avatar-section');
      const preview = $('#profile-form-avatar-preview');
      const clearBtn = $('#profile-form-avatar-clear');
      if (!profile) {
        section.classList.add('hidden');
        return;
      }
      section.classList.remove('hidden');
      preview.style.background = profile.avatarUrl ? 'transparent' : profileColorValue(profile.color);
      preview.innerHTML = avatarInnerHtml(profile);
      clearBtn.classList.toggle('hidden', !profile.avatarUrl);
    }

    function applyProfileUpdate(updatedProfile) {
      const idx = allProfiles.findIndex((p) => p.id === updatedProfile.id);
      if (idx !== -1) allProfiles[idx] = { ...allProfiles[idx], ...updatedProfile };
      renderAvatarSection(updatedProfile);
      renderGrid();
      if (updatedProfile.id === activeProfileId) updateProfileBadge();
    }

    async function onAvatarPick() {
      const id = form.dataset.editId;
      if (!id) return;
      const res = await window.api.pickProfileAvatar(id);
      if (res.canceled || res.error) return;
      applyProfileUpdate(res.profile);
    }

    async function onAvatarClear() {
      const id = form.dataset.editId;
      if (!id) return;
      const res = await window.api.clearProfileAvatar(id);
      if (res.error) return;
      applyProfileUpdate(res.profile);
    }

    function renderColorSwatches(selected) {
      const wrap = $('#profile-form-colors');
      wrap.innerHTML = PROFILE_COLORS.map((c) => `
        <button type="button" class="profile-color-swatch${c === selected ? ' selected' : ''}" data-color="${c}" style="background:${profileColorValue(c)}"></button>
      `).join('');
      wrap.dataset.selected = selected;
      Array.from(wrap.querySelectorAll('.profile-color-swatch')).forEach((btn) => {
        btn.addEventListener('click', () => {
          wrap.dataset.selected = btn.dataset.color;
          Array.from(wrap.querySelectorAll('.profile-color-swatch')).forEach((b) => b.classList.toggle('selected', b === btn));
        });
      });
    }

    async function onGridClick(e) {
      if (e.target.id === 'profile-overlay' && !forced) {
        cleanup();
        return;
      }
      const renameBtn = e.target.closest('.profile-card-rename');
      const deleteBtn = e.target.closest('.profile-card-delete');
      const addCard = e.target.closest('#profile-add-card');
      const card = e.target.closest('.profile-card:not(.profile-card-add)');

      if (renameBtn) {
        const profile = allProfiles.find((p) => p.id === renameBtn.dataset.id);
        if (profile) openEditForm(profile);
        return;
      }
      if (deleteBtn) {
        const profile = allProfiles.find((p) => p.id === deleteBtn.dataset.id);
        if (profile) openDeleteConfirm(profile);
        return;
      }
      if (addCard) {
        openCreateForm();
        return;
      }
      if (card && deleteConfirm.classList.contains('hidden')) {
        const profile = allProfiles.find((p) => p.id === card.dataset.id);
        if (!profile) return;
        form.classList.add('hidden');
        if (forced) {
          cleanup();
          resolve(profile);
          return;
        }
        if (profile.id === activeProfileId) {
          cleanup();
          return;
        }
        await window.api.setActiveProfile(profile.id);
        sessionStorage.setItem('skipProfilePicker', '1');
        cleanup();
        location.reload();
      }
    }

    function onFormCancel() {
      form.classList.add('hidden');
    }

    async function onFormSubmit(e) {
      e.preventDefault();
      const name = $('#profile-form-name').value.trim();
      if (!name) return;
      const color = $('#profile-form-colors').dataset.selected;
      const initial = $('#profile-form-initial').value.trim().slice(0, 2);
      const editId = form.dataset.editId;
      if (editId) {
        const res = await window.api.updateProfile(editId, { name, color, initial });
        if (res.profile) applyProfileUpdate(res.profile);
        form.classList.add('hidden');
        return;
      }
      const created = await window.api.createProfile(name, color, initial);
      allProfiles.push(created);
      form.classList.add('hidden');
      if (forced) {
        cleanup();
        resolve(created);
        return;
      }
      renderGrid();
    }

    function onClose() {
      cleanup();
    }

    overlay.addEventListener('click', onGridClick);
    manageBtn.addEventListener('click', onToggleManage);
    closeBtn.addEventListener('click', onClose);
    $('#profile-form-cancel').addEventListener('click', onFormCancel);
    $('#profile-form').addEventListener('submit', onFormSubmit);
    deleteConfirmInput.addEventListener('input', onDeleteConfirmInput);
    deleteConfirmBtn.addEventListener('click', onDeleteConfirmClick);
    deleteCancelBtn.addEventListener('click', closeDeleteConfirm);
    $('#profile-form-avatar-pick').addEventListener('click', onAvatarPick);
    $('#profile-form-avatar-clear').addEventListener('click', onAvatarClear);

    showOverlay(overlay);
  });
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#theme-icon-use').setAttribute('href', theme === 'light' ? '#icon-moon' : '#icon-sun');
  $('#theme-toggle-label').textContent = theme === 'light' ? 'Tema oscuro' : 'Tema claro';
}

function initTheme() {
  const saved = localStorage.getItem(pk('theme')) || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem(pk('theme'), next);
  applyTheme(next);
}

/* ---------- Appearance (accent, density, motion) ---------- */

function initAppearance() {
  const accent = localStorage.getItem(pk('accent')) || 'rojo';
  const density = localStorage.getItem(pk('density')) || 'comoda';
  const savedMotion = localStorage.getItem(pk('motion'));
  const motion = savedMotion || (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full');
  const chartColor = localStorage.getItem(pk('chart-color')) || 'azul';

  document.documentElement.setAttribute('data-accent', accent);
  document.documentElement.setAttribute('data-density', density);
  document.documentElement.setAttribute('data-motion', motion);
  document.documentElement.setAttribute('data-chart-color', chartColor);

  $$('.swatch[data-accent]').forEach((s) => s.classList.toggle('selected', s.dataset.accent === accent));
  $$('.swatch[data-chart-color]').forEach((s) => s.classList.toggle('selected', s.dataset.chartColor === chartColor));
  $$('.segment').forEach((s) => s.classList.toggle('active', s.dataset.density === density));
  $('#motion-toggle').checked = motion !== 'reduced';
}

function setAccent(accent) {
  localStorage.setItem(pk('accent'), accent);
  document.documentElement.setAttribute('data-accent', accent);
  $$('.swatch[data-accent]').forEach((s) => s.classList.toggle('selected', s.dataset.accent === accent));
}

function setChartColor(chartColor) {
  localStorage.setItem(pk('chart-color'), chartColor);
  document.documentElement.setAttribute('data-chart-color', chartColor);
  $$('.swatch[data-chart-color]').forEach((s) => s.classList.toggle('selected', s.dataset.chartColor === chartColor));
}

function setDensity(density) {
  localStorage.setItem(pk('density'), density);
  document.documentElement.setAttribute('data-density', density);
  $$('.segment').forEach((s) => s.classList.toggle('active', s.dataset.density === density));
}

function setMotion(enabled) {
  const value = enabled ? 'full' : 'reduced';
  localStorage.setItem(pk('motion'), value);
  document.documentElement.setAttribute('data-motion', value);
}

function resetAppearance() {
  localStorage.removeItem(pk('accent'));
  localStorage.removeItem(pk('density'));
  localStorage.removeItem(pk('motion'));
  localStorage.removeItem(pk('theme'));
  localStorage.removeItem(pk('chart-color'));
  initTheme();
  initAppearance();
}

/* ---------- Behavior preferences ---------- */

function initBehaviorPrefs() {
  const startView = localStorage.getItem(pk('pref-start-view')) || 'dashboard';
  const sortPendientes = localStorage.getItem(pk('pref-sort-pendientes')) || 'added-desc';
  const sortVistas = localStorage.getItem(pk('pref-sort-vistas')) || 'date-desc';
  const pageSize = Number(localStorage.getItem(pk('pref-page-size'))) || 48;
  const deleteMode = localStorage.getItem(pk('pref-delete-mode')) || 'undo';
  const recsEnabled = localStorage.getItem(pk('pref-recs-enabled')) !== 'false';
  const annivEnabled = localStorage.getItem(pk('pref-anniv-enabled')) !== 'false';

  $('#pref-start-view').value = startView;
  $('#pref-sort-pendientes').value = sortPendientes;
  $('#pref-sort-vistas').value = sortVistas;
  $('#pref-page-size').value = String(pageSize);
  $('#pref-delete-mode').value = deleteMode;
  $('#pref-recs-toggle').checked = recsEnabled;
  $('#pref-anniv-toggle').checked = annivEnabled;

  PAGE_SIZE = pageSize;
  pendientesPageSize = PAGE_SIZE;
  vistasPageSize = PAGE_SIZE;
  $('#sort-pendientes').value = sortPendientes;
  $('#sort-vistas').value = sortVistas;
}

/* ---------- Dashboard panel visibility ---------- */

const PANEL_KEYS = ['genres', 'platforms', 'ratings', 'activity', 'years', 'eras', 'recommendations', 'upcoming', 'pick'];

function initPanelVisibility() {
  PANEL_KEYS.forEach((key) => {
    const enabled = localStorage.getItem(pk(`panel-${key}`)) !== 'false';
    const el = $(`#panel-${key}`);
    if (el) el.classList.toggle('hidden', !enabled);
    const toggle = document.querySelector(`.panel-toggle[data-panel="${key}"]`);
    if (toggle) toggle.checked = enabled;
  });
}

function setPanelVisibility(key, enabled) {
  localStorage.setItem(pk(`panel-${key}`), String(enabled));
  const el = $(`#panel-${key}`);
  if (el) el.classList.toggle('hidden', !enabled);
}

/* ---------- Custom platforms ---------- */

function loadPlatforms() {
  try {
    const saved = JSON.parse(localStorage.getItem(pk('customPlatforms')) || 'null');
    if (Array.isArray(saved) && saved.length) PLATFORMS = saved;
  } catch (err) {
    PLATFORMS = [...DEFAULT_PLATFORMS];
  }
}

function savePlatforms() {
  localStorage.setItem(pk('customPlatforms'), JSON.stringify(PLATFORMS));
}

function renderPlatformsList() {
  const container = $('#platforms-list');
  container.innerHTML = PLATFORMS.map((p) => `
    <span class="platform-chip" data-platform="${escapeHtml(p)}">
      ${escapeHtml(p)}
      ${p === 'Otra' ? '' : '<button type="button" title="Quitar"><svg class="icon"><use href="#icon-x"></use></svg></button>'}
    </span>
  `).join('');
  container.querySelectorAll('.platform-chip button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const platform = btn.closest('.platform-chip').dataset.platform;
      PLATFORMS = PLATFORMS.filter((p) => p !== platform);
      savePlatforms();
      renderPlatformsList();
      fillPlatformSelects();
      showToast(`"${platform}" ya no aparecerá en las listas de plataformas`);
    });
  });
}

function addCustomPlatform(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (PLATFORMS.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
    showToast('Esa plataforma ya está en la lista', 'error');
    return;
  }
  const otraIdx = PLATFORMS.indexOf('Otra');
  if (otraIdx >= 0) PLATFORMS.splice(otraIdx, 0, trimmed);
  else PLATFORMS.push(trimmed);
  savePlatforms();
  renderPlatformsList();
  fillPlatformSelects();
  showToast(`"${trimmed}" añadida a tus plataformas`);
}

/* ---------- Sidebar nav indicator ---------- */

function updateNavIndicator() {
  const active = $('.nav-item.active');
  const indicator = $('#nav-indicator');
  if (!active || !indicator) return;
  indicator.style.transform = `translateY(${active.offsetTop}px)`;
  indicator.style.height = `${active.offsetHeight}px`;
}

/* ---------- Toasts ---------- */

function showToast(message, variant = 'success', options = {}) {
  const { actionLabel, onAction, duration = 3000 } = options;
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 320);
  };

  if (actionLabel) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action';
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', () => {
      clearTimeout(timeoutId);
      if (onAction) onAction();
      dismiss();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  const timeoutId = setTimeout(dismiss, duration);
}

/* ---------- Animated overlays ---------- */

function showOverlay(overlayEl) {
  overlayEl.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => overlayEl.classList.add('visible')));
}

function hideOverlay(overlayEl) {
  overlayEl.classList.remove('visible');
  const delay = document.documentElement.getAttribute('data-motion') === 'reduced' ? 0 : 200;
  setTimeout(() => overlayEl.classList.add('hidden'), delay);
}

/* ---------- Global search (Ctrl+K) ---------- */

function openGlobalSearch() {
  showOverlay($('#global-search-overlay'));
  $('#global-search-input').value = '';
  $('#global-search-results').innerHTML = '';
  $('#global-search-empty').classList.add('hidden');
  setTimeout(() => $('#global-search-input').focus(), 50);
}

function closeGlobalSearch() {
  hideOverlay($('#global-search-overlay'));
}

function renderGlobalSearchResults(query) {
  const resultsEl = $('#global-search-results');
  const emptyEl = $('#global-search-empty');
  const q = query.trim().toLowerCase();
  if (!q) {
    resultsEl.innerHTML = '';
    emptyEl.classList.add('hidden');
    return;
  }
  const matches = movies.filter((m) => m.title.toLowerCase().includes(q)).slice(0, 30);
  if (!matches.length) {
    resultsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  const statusLabel = { pendiente: 'Pendiente', viendo: 'Viendo', vista: 'Vista' };
  resultsEl.innerHTML = matches.map((m, i) => `
    <div class="gs-result" data-id="${m.id}" style="animation-delay:${i * 18}ms">
      ${m.poster ? `<img class="gs-poster" src="${m.poster}" alt="">` : `<div class="gs-poster">${escapeHtml(m.title)}</div>`}
      <div>
        <div class="gs-title">${escapeHtml(m.title)}</div>
        <div class="gs-meta">
          <span class="type-tag">${TYPE_LABELS[m.type] || TYPE_LABELS.pelicula}</span>
          <span class="badge">${statusLabel[m.status] || m.status}</span>
          ${m.rating ? `<span class="badge rating"><svg class="icon"><use href="#icon-star"></use></svg>${m.rating}/10</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
  resultsEl.querySelectorAll('.gs-result').forEach((el) => {
    el.addEventListener('click', () => {
      closeGlobalSearch();
      openModal(el.dataset.id);
    });
  });
}

function renderAll() {
  fillPlatformSelects();
  renderDashboard();
  renderPendientes();
  renderVistas();
}

/* ---------- Navigation ---------- */

async function switchView(view) {
  $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  updateNavIndicator();
  if (view === 'suscripciones') {
    // Re-fetch rather than just re-rendering the cached array: main.js's
    // subscriptions:list is where auto-renewal/expiry/history-backfill actually
    // happens, and it only runs when this list is loaded. Without re-fetching
    // here, a subscription's cycle could elapse while the app stays open and
    // this tab would show the same stale "renueva hoy" forever until a restart.
    subscriptions = await window.api.listSubscriptions();
    subscriptionHistory = await window.api.listSubscriptionHistory();
    renderSubscriptions();
    renderSubscriptionHistory();
    fillSubPlannerPlatforms();
    updateSubPlannerResult();
  }
}

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

/* ---------- Recommendations ---------- */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makePager() {
  return { shuffled: null, cursor: 0 };
}
const moviePager = makePager();
const tvPager = makePager();

function nextPoolPage(pool, pager, count) {
  if (!pool || !pool.length || count <= 0) return [];
  if (pool.length <= count) return shuffle(pool);
  if (!pager.shuffled || pager.cursor >= pager.shuffled.length) {
    pager.shuffled = shuffle(pool);
    pager.cursor = 0;
  }
  let page = pager.shuffled.slice(pager.cursor, pager.cursor + count);
  pager.cursor += count;
  if (page.length < count) {
    const remaining = pool.filter((r) => !page.some((p) => p.tmdbId === r.tmdbId));
    page = page.concat(shuffle(remaining).slice(0, count - page.length));
    pager.shuffled = null;
    pager.cursor = 0;
  }
  return page;
}

function nextRecommendationsPage() {
  const tvCount = recommendationsTvPool && recommendationsTvPool.length
    ? Math.min(RECS_TV_QUOTA, recommendationsTvPool.length) : 0;
  const movieCount = RECS_DISPLAY_COUNT - tvCount;
  const moviePage = nextPoolPage(recommendationsMoviePool, moviePager, movieCount);
  const tvPage = nextPoolPage(recommendationsTvPool, tvPager, tvCount);
  return shuffle([...moviePage, ...tvPage]);
}

async function loadRecommendations() {
  const rated = getWatched()
    .filter((m) => m.rating && m.tmdbId)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4);
  const signature = rated.map((m) => `${m.tmdbId}:${m.mediaType}:${m.rating}`).join(',');
  if (signature !== recommendationsSignature) {
    recommendationsMoviePool = null;
    recommendationsTvPool = null;
    recommendationsSignature = signature;
  }

  if (recommendationsMoviePool && recommendationsTvPool) {
    recommendationsCache = nextRecommendationsPage();
    renderRecommendationsSection();
    return;
  }

  const existingTmdbIds = new Set(movies.filter((m) => m.tmdbId).map((m) => m.tmdbId));
  const seenMovie = new Set();
  const seenTv = new Set();
  const moviePool = [];
  const tvPool = [];

  function addResult(r) {
    if (existingTmdbIds.has(r.tmdbId)) return;
    if (r.mediaType === 'tv') {
      if (seenTv.has(r.tmdbId)) return;
      seenTv.add(r.tmdbId);
      tvPool.push(r);
    } else {
      if (seenMovie.has(r.tmdbId)) return;
      seenMovie.add(r.tmdbId);
      moviePool.push(r);
    }
  }

  for (const m of rated) {
    const res = await window.api.getRecommendations(m.tmdbId, m.mediaType);
    if (res && res.results) res.results.forEach(addResult);
  }

  // Prefer discovery from a platform you currently have active (actually watchable right now)
  // over generic trending, when we can resolve at least one active platform to a TMDB provider.
  const activeProviderIds = subscriptions
    .filter((s) => s.active)
    .map((s) => resolveProviderId(s.platform))
    .filter(Boolean);

  let discovery = activeProviderIds.length
    ? await window.api.discoverByProviders(activeProviderIds, ['movie', 'tv'])
    : null;
  const hasDiscoveryResults = discovery && !discovery.error
    && ((discovery.movies && discovery.movies.length) || (discovery.tv && discovery.tv.length));
  if (!hasDiscoveryResults) {
    discovery = await window.api.getTrending();
  }
  if (discovery && !discovery.error) {
    (discovery.movies || []).forEach(addResult);
    (discovery.tv || []).forEach(addResult);
  }

  recommendationsMoviePool = moviePool;
  recommendationsTvPool = tvPool;
  recommendationsCache = nextRecommendationsPage();
  renderRecommendationsSection();
}

function renderRecommendationsSection() {
  const listEl = $('#recommendations-list');
  const emptyEl = $('#recommendations-empty');
  if (!listEl || !emptyEl) return;
  if (!recommendationsCache || !recommendationsCache.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.innerHTML = recommendationsCache.map((r, i) => `
    <div class="rec-item" data-idx="${i}" style="animation-delay:${i * 40}ms">
      ${r.poster ? `<img class="rec-poster" src="${r.poster}" alt="${escapeHtml(r.title)}">` : `<div class="rec-poster">${escapeHtml(r.title)}</div>`}
      <button class="rec-add" title="Añadir a mi lista"><svg class="icon"><use href="#icon-plus"></use></svg></button>
      <div class="rec-title">${escapeHtml(r.title)}</div>
      <div class="rec-year">${escapeHtml(r.year)}</div>
    </div>
  `).join('');
  listEl.querySelectorAll('.rec-add').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = recommendationsCache[Number(btn.closest('.rec-item').dataset.idx)];
      openModal(null);
      await applyTmdbResultToForm(item);
    });
  });
}

/* ---------- Share recommendation lists ---------- */

let shareTypeSelection = new Set(['pelicula', 'serie']);
let shareGenreSelection = new Set();
let sharePlatformSelection = new Set();
let shareMode = 'auto';
let shareSearchTimer = null;
const sharePagers = { rated: makePager(), pending: makePager(), discovery: makePager() };
let sharePreviewSignature = null;

function toShareItem(m, source) {
  if (m.mediaType) {
    return { tmdbId: m.tmdbId, title: m.title, year: m.year, poster: m.poster, type: m.mediaType === 'tv' ? 'serie' : 'pelicula', source };
  }
  return { tmdbId: m.tmdbId || null, title: m.title, year: m.year, poster: m.poster, type: m.type, source };
}

function buildShareList(options) {
  const wantMovie = options.types.has('pelicula');
  const wantTv = options.types.has('serie');
  const typeMatches = (m) => (m.type === 'pelicula' && wantMovie) || (m.type === 'serie' && wantTv);
  const genreMatches = (m) => !options.genres.size || (m.genres || []).some((g) => options.genres.has(g));
  const platformMatches = (m) => !options.platforms.size || options.platforms.has(m.platform);

  const libraryTmdbIds = new Set(movies.filter((m) => m.tmdbId).map((m) => m.tmdbId));

  const ratedPool = options.useRated
    ? getWatched().filter((m) => m.rating && m.tmdbId && typeMatches(m) && genreMatches(m) && platformMatches(m)).sort((a, b) => b.rating - a.rating)
    : [];

  let pendingPool = [];
  if (options.usePending) {
    const genreWeight = {};
    getWatched().filter((m) => m.rating).forEach((m) => {
      (m.genres || []).forEach((g) => { genreWeight[g] = (genreWeight[g] || 0) + m.rating; });
    });
    pendingPool = getPending()
      .filter((m) => m.tmdbId && typeMatches(m) && genreMatches(m) && platformMatches(m))
      .map((m) => ({ m, score: (m.genres || []).reduce((s, g) => s + (genreWeight[g] || 0), 0) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  let discoveryPool = [];
  if (options.useDiscovery) {
    discoveryPool = [
      ...(wantMovie ? recommendationsMoviePool || [] : []),
      ...(wantTv ? recommendationsTvPool || [] : []),
    ].filter((r) => !libraryTmdbIds.has(r.tmdbId));
  }

  const hasMajoritySource = options.useRated || options.usePending;
  const discoveryQuota = options.useDiscovery && discoveryPool.length
    ? (hasMajoritySource ? Math.max(1, Math.round(options.count * 0.2)) : options.count)
    : 0;
  const majorityQuota = options.count - discoveryQuota;
  let ratedQuota = 0;
  let pendingQuota = 0;
  if (options.useRated && options.usePending) {
    ratedQuota = Math.ceil(majorityQuota / 2);
    pendingQuota = majorityQuota - ratedQuota;
  } else if (options.useRated) {
    ratedQuota = majorityQuota;
  } else if (options.usePending) {
    pendingQuota = majorityQuota;
  }

  const usedIds = new Set();
  const picks = [];
  function take(pool, pager, quota, source) {
    if (!pool.length || quota <= 0) return;
    const page = nextPoolPage(pool, pager, Math.min(quota, pool.length));
    page.forEach((m) => {
      if (m.tmdbId && usedIds.has(m.tmdbId)) return;
      if (m.tmdbId) usedIds.add(m.tmdbId);
      picks.push(toShareItem(m, source));
    });
  }
  take(ratedPool, sharePagers.rated, ratedQuota, 'rated');
  take(pendingPool, sharePagers.pending, pendingQuota, 'pending');
  take(discoveryPool, sharePagers.discovery, discoveryQuota, 'discovery');

  let shortfall = options.count - picks.length;
  if (shortfall > 0) {
    const extras = [
      [ratedPool, sharePagers.rated, 'rated'],
      [pendingPool, sharePagers.pending, 'pending'],
      [discoveryPool, sharePagers.discovery, 'discovery'],
    ];
    for (const [pool, pager, source] of extras) {
      if (shortfall <= 0) break;
      if (!pool.length) continue;
      const extra = nextPoolPage(pool, pager, Math.min(shortfall, pool.length)).filter((m) => !usedIds.has(m.tmdbId));
      extra.forEach((m) => {
        if (shortfall <= 0) return;
        usedIds.add(m.tmdbId);
        picks.push(toShareItem(m, source));
        shortfall--;
      });
    }
  }

  return shuffle(picks).slice(0, options.count);
}

function openShareConfigModal() {
  shareTypeSelection = new Set(['pelicula', 'serie']);
  shareGenreSelection = new Set();
  sharePlatformSelection = new Set(subscriptions.filter((s) => s.active).map((s) => s.platform));
  sharePagers.rated = makePager();
  sharePagers.pending = makePager();
  sharePagers.discovery = makePager();
  sharePreviewSignature = null;
  shareConfigPreview = { title: '', items: [] };

  $('#share-title').value = '';
  $$('#share-type-chips .chip').forEach((c) => c.classList.add('selected'));
  renderShareGenreChips();
  renderSharePlatformChips();
  $('#share-count').value = '9';
  $('#share-src-rated').checked = true;
  $('#share-src-pending').checked = true;
  $('#share-src-discovery').checked = true;
  $('#share-manual-search-input').value = '';
  $('#share-manual-search-results').innerHTML = '';
  $('#share-manual-search-hint').textContent = '';
  setShareMode('auto');
  renderSharePreview();

  showOverlay($('#share-config-overlay'));
}

function closeShareConfigModal() {
  hideOverlay($('#share-config-overlay'));
}

function setShareMode(mode) {
  shareMode = mode;
  $$('#share-mode-chips .chip').forEach((c) => c.classList.toggle('selected', c.dataset.mode === mode));
  $('#share-auto-fields').classList.toggle('hidden', mode === 'manual');
  $('#share-shuffle-preview').classList.toggle('hidden', mode === 'manual');
}

function renderShareGenreChips() {
  const wrap = $('#share-genre-chips');
  const libraryGenres = [...new Set(movies.flatMap((m) => m.genres || []))];
  const allGenres = [...new Set([...GENRES_LIST, ...libraryGenres])];
  wrap.innerHTML = allGenres.map((g) => `<span class="chip" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</span>`).join('');
  wrap.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const g = chip.dataset.genre;
      if (shareGenreSelection.has(g)) {
        shareGenreSelection.delete(g);
        chip.classList.remove('selected');
      } else {
        shareGenreSelection.add(g);
        chip.classList.add('selected');
      }
    });
  });
}

function renderSharePlatformChips() {
  const wrap = $('#share-platform-chips');
  wrap.innerHTML = PLATFORMS.map((p) => `<span class="chip${sharePlatformSelection.has(p) ? ' selected' : ''}" data-platform="${escapeHtml(p)}">${escapeHtml(p)}</span>`).join('');
  wrap.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const p = chip.dataset.platform;
      if (sharePlatformSelection.has(p)) {
        sharePlatformSelection.delete(p);
        chip.classList.remove('selected');
      } else {
        sharePlatformSelection.add(p);
        chip.classList.add('selected');
      }
    });
  });
}

async function generateSharePreview() {
  const options = {
    types: new Set(shareTypeSelection),
    genres: new Set(shareGenreSelection),
    platforms: new Set(sharePlatformSelection),
    count: Number($('#share-count').value) || 9,
    useRated: $('#share-src-rated').checked,
    usePending: $('#share-src-pending').checked,
    useDiscovery: $('#share-src-discovery').checked,
  };

  const signature = JSON.stringify({
    types: [...options.types].sort(),
    genres: [...options.genres].sort(),
    platforms: [...options.platforms].sort(),
    count: options.count,
    useRated: options.useRated,
    usePending: options.usePending,
    useDiscovery: options.useDiscovery,
  });
  if (signature !== sharePreviewSignature) {
    sharePagers.rated = makePager();
    sharePagers.pending = makePager();
    sharePagers.discovery = makePager();
    sharePreviewSignature = signature;
  }

  const emptyEl = $('#share-preview-empty');
  const sectionEl = $('#share-preview-section');
  const downloadBtn = $('#share-download-btn');

  if (!options.useRated && !options.usePending && !options.useDiscovery) {
    sectionEl.classList.add('hidden');
    emptyEl.textContent = 'Selecciona al menos una fuente de recomendaciones.';
    emptyEl.classList.remove('hidden');
    downloadBtn.disabled = true;
    return;
  }

  if (options.useDiscovery && !recommendationsMoviePool && !recommendationsTvPool) {
    await loadRecommendations();
  }

  const items = buildShareList(options);
  if (!shareConfigPreview) shareConfigPreview = { title: '', items: [] };
  shareConfigPreview.items = items;
  shareConfigPreview.title = $('#share-title').value.trim() || 'Mis recomendaciones';

  if (!items.length) {
    sectionEl.classList.add('hidden');
    emptyEl.textContent = 'No hay suficientes títulos que cumplan estos filtros todavía.';
    emptyEl.classList.remove('hidden');
    downloadBtn.disabled = true;
    return;
  }

  renderSharePreview();
}

function renderSharePreview() {
  const items = shareConfigPreview ? shareConfigPreview.items : [];
  const grid = $('#share-preview-grid');
  const sectionEl = $('#share-preview-section');
  const emptyEl = $('#share-preview-empty');
  const downloadBtn = $('#share-download-btn');
  const countEl = $('#share-preview-count');

  downloadBtn.disabled = !items.length;

  if (!items.length) {
    sectionEl.classList.add('hidden');
    countEl.textContent = '';
    emptyEl.textContent = 'Todavía no hay títulos en la lista. Genera una vista previa automática o añade alguno a mano.';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  sectionEl.classList.remove('hidden');
  countEl.textContent = `(${items.length})`;

  const sourceLabels = { rated: 'Tu valoración', pending: 'Pendiente', discovery: 'Descubre', manual: 'Manual' };
  grid.innerHTML = items.map((it, i) => `
    <div class="share-preview-item" data-idx="${i}">
      ${it.poster ? `<img class="poster" src="${it.poster}" alt="${escapeHtml(it.title)}">` : `<div class="poster">${escapeHtml(it.title)}</div>`}
      <button type="button" class="share-preview-remove" data-idx="${i}" title="Quitar de la lista"><svg class="icon"><use href="#icon-x"></use></svg></button>
      <div class="share-preview-title">${escapeHtml(it.title)}</div>
      <div class="share-preview-source">${sourceLabels[it.source] || ''}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.share-preview-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeShareItem(Number(btn.dataset.idx)));
  });
}

function removeShareItem(idx) {
  if (!shareConfigPreview) return;
  shareConfigPreview.items.splice(idx, 1);
  renderSharePreview();
}

let shareSearchRequestId = 0;
async function runShareManualSearch(query) {
  const requestId = ++shareSearchRequestId;
  const res = await window.api.searchTmdb(query);
  if (requestId !== shareSearchRequestId) return;
  const resultsEl = $('#share-manual-search-results');
  const hintEl = $('#share-manual-search-hint');

  if (res.error === 'NO_API_KEY') {
    hintEl.textContent = 'Necesitas configurar tu API key de TMDB en Ajustes.';
    resultsEl.innerHTML = '';
    return;
  }
  if (res.error) {
    hintEl.textContent = 'No se pudo buscar ahora mismo (sin conexión o error de TMDB).';
    resultsEl.innerHTML = '';
    return;
  }

  hintEl.textContent = res.results.length ? '' : 'Sin resultados.';
  resultsEl.innerHTML = res.results.map((r, i) => `
    <div class="search-result" data-idx="${i}">
      <img src="${r.poster || ''}" alt="">
      <div>
        <div class="sr-title">${escapeHtml(r.title)} <span class="type-tag">${r.mediaType === 'tv' ? 'Serie' : 'Película'}</span></div>
        <div class="sr-year">${escapeHtml(r.year)}</div>
      </div>
    </div>
  `).join('');
  resultsEl.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('click', () => addManualShareItem(res.results[Number(el.dataset.idx)]));
  });
}

function addManualShareItem(r) {
  if (!shareConfigPreview) shareConfigPreview = { title: '', items: [] };
  if (shareConfigPreview.items.some((it) => it.tmdbId === r.tmdbId)) {
    showToast('Ese título ya está en la lista', 'error');
    return;
  }
  shareConfigPreview.items.push(toShareItem(r, 'manual'));
  $('#share-manual-search-input').value = '';
  $('#share-manual-search-results').innerHTML = '';
  $('#share-manual-search-hint').textContent = '';
  renderSharePreview();
}

function loadImageSafe(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrapCenteredLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const test = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = words[i];
      if (lines.length === maxLines) break;
    }
  }
  const fullyConsumed = lines.length < maxLines;
  if (fullyConsumed && current) lines.push(current);
  const truncated = !fullyConsumed || lines.length > maxLines;
  if (lines.length > maxLines) lines.length = maxLines;
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

async function generateShareImage(title, items, profileName) {
  const cols = items.length > 9 ? 4 : 3;
  const rows = Math.ceil(items.length / cols);
  const posterW = 220;
  const posterH = 330;
  const gap = 26;
  const pad = 44;
  const headerH = 118;
  const captionH = 70;
  const footerH = 54;
  const width = pad * 2 + cols * posterW + (cols - 1) * gap;
  const height = headerH + rows * (posterH + captionH) + (rows - 1) * gap + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const styles = getComputedStyle(document.documentElement);
  const cv = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const bg = cv('--bg', '#14161c');
  const bgElev = cv('--bg-elev', '#1b1e27');
  const bgElev2 = cv('--bg-elev-2', '#262a37');
  const accent = cv('--accent', '#e0553f');
  const textPrimary = cv('--text-primary', '#eceef2');
  const textMuted = cv('--text-muted', '#6d7386');

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, bgElev);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  ctx.font = '700 13px "Segoe UI", sans-serif';
  ctx.fillText('RECOMENDACIONES', pad, 38);

  ctx.fillStyle = textPrimary;
  ctx.font = '700 32px "Segoe UI", sans-serif';
  ctx.fillText(title, pad, 76);

  ctx.fillStyle = textMuted;
  ctx.font = '400 14px "Segoe UI", sans-serif';
  const subtitle = profileName
    ? `De ${profileName} · ${items.length} título${items.length === 1 ? '' : 's'}`
    : `${items.length} título${items.length === 1 ? '' : 's'}`;
  ctx.fillText(subtitle, pad, 100);

  const images = await Promise.all(items.map((it) => loadImageSafe(it.poster)));

  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (posterW + gap);
    const y = headerH + row * (posterH + captionH + gap);
    const img = images[i];

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, posterW, posterH, 14);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, x, y, posterW, posterH);
    } else {
      ctx.fillStyle = bgElev2;
      ctx.fillRect(x, y, posterW, posterH);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, posterW - 1, posterH - 1, 14);
    ctx.stroke();
    ctx.restore();

    const cx = x + posterW / 2;
    const captionTop = y + posterH + 22;
    ctx.textAlign = 'center';
    ctx.fillStyle = textPrimary;
    ctx.font = '600 15px "Segoe UI", sans-serif';
    const titleLines = wrapCenteredLines(ctx, it.title, posterW - 8, 2);
    titleLines.forEach((line, li) => ctx.fillText(line, cx, captionTop + li * 19));

    ctx.fillStyle = textMuted;
    ctx.font = '400 12px "Segoe UI", sans-serif';
    const metaParts = [];
    if (it.year) metaParts.push(it.year);
    metaParts.push(it.type === 'serie' ? 'Serie' : 'Película');
    ctx.fillText(metaParts.join(' · '), cx, captionTop + 2 * 19);
  });

  ctx.textAlign = 'right';
  ctx.fillStyle = textMuted;
  ctx.font = '400 12px "Segoe UI", sans-serif';
  ctx.fillText('Generado con Películas y Series', width - pad, height - 18);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

async function downloadShareImage() {
  if (!shareConfigPreview || !shareConfigPreview.items.length) return;
  const btn = $('#share-download-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando...';
  try {
    const title = $('#share-title').value.trim() || 'Mis recomendaciones';
    const profile = allProfiles.find((p) => p.id === activeProfileId);
    const dataUrl = await generateShareImage(title, shareConfigPreview.items, profile ? profile.name : '');
    const saved = await window.api.saveShareList({
      title,
      options: {
        mode: shareMode,
        types: [...shareTypeSelection],
        genres: [...shareGenreSelection],
        platforms: [...sharePlatformSelection],
        count: Number($('#share-count').value) || shareConfigPreview.items.length,
        useRated: $('#share-src-rated').checked,
        usePending: $('#share-src-pending').checked,
        useDiscovery: $('#share-src-discovery').checked,
      },
      items: shareConfigPreview.items,
      imageDataUrl: dataUrl,
    });
    shareLists.unshift(saved);
    renderShareListsGrid();
    closeShareConfigModal();
    showToast('Lista de recomendaciones generada');
  } catch (err) {
    showToast('No se pudo generar la imagen', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function formatShareListDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderShareListsGrid() {
  const grid = $('#share-lists-grid');
  const empty = $('#share-lists-empty');
  if (!grid || !empty) return;
  if (!shareLists.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = shareLists.map((l, i) => `
    <div class="share-list-card" data-id="${l.id}" style="animation-delay:${Math.min(i, 12) * 40}ms">
      <img class="share-list-thumb" src="${l.imageUrl}" alt="${escapeHtml(l.title)}">
      <div class="share-list-body">
        <div class="share-list-title">${escapeHtml(l.title)}</div>
        <div class="share-list-meta">${formatShareListDate(l.createdAt)} · ${l.items.length} título${l.items.length === 1 ? '' : 's'}</div>
        <div class="share-list-actions">
          <button type="button" class="btn share-open-btn" data-id="${l.id}">Abrir imagen</button>
          <button type="button" class="btn danger share-delete-btn" data-id="${l.id}">Eliminar</button>
        </div>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.share-open-btn').forEach((btn) => {
    btn.addEventListener('click', () => window.api.openShareListImage(btn.dataset.id));
  });
  grid.querySelectorAll('.share-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteShareListEntry(btn.dataset.id));
  });
}

async function deleteShareListEntry(id) {
  if (!confirm('¿Eliminar esta lista de recomendaciones? Se borrará también la imagen generada.')) return;
  const res = await window.api.deleteShareList(id);
  if (res && res.error) return;
  shareLists = shareLists.filter((l) => l.id !== id);
  renderShareListsGrid();
  showToast('Lista eliminada', 'error');
}

/* ---------- Subscriptions ---------- */

const CYCLE_OPTIONS = [
  { value: 30, label: 'Mensual', unit: '/mes', name: 'mensual' },
  { value: 90, label: 'Trimestral', unit: '/trimestre', name: 'trimestral' },
  { value: 365, label: 'Anual', unit: '/año', name: 'anual' },
];

function subscriptionPlatforms() {
  return PLATFORMS.filter((p) => !NON_SUBSCRIPTION_PLATFORMS.has(p));
}

function getSubscription(platform) {
  return subscriptions.find((s) => s.platform === platform)
    || { platform, price: null, active: false, startDate: null, cycleDays: 30, willRenew: true, historyId: null };
}

// subscriptionDaysRemaining is defined in lib/subscription-logic.js (loaded as
// a global <script> before this file).

function resolveProviderLogo(platform) {
  if (providerLogos[platform]) return providerLogos[platform];
  const tmdbName = Object.keys(PROVIDER_NAME_MAP).find((k) => PROVIDER_NAME_MAP[k] === platform);
  return tmdbName && providerLogos[tmdbName] ? providerLogos[tmdbName] : null;
}

function resolveProviderId(platform) {
  if (providerIds[platform]) return providerIds[platform];
  const tmdbName = Object.keys(PROVIDER_NAME_MAP).find((k) => PROVIDER_NAME_MAP[k] === platform);
  return tmdbName && providerIds[tmdbName] ? providerIds[tmdbName] : null;
}

async function loadProviderLogos() {
  const res = await window.api.getProviderLogos();
  if (res && res.logos) {
    providerLogos = res.logos;
    providerIds = res.providerIds || {};
    renderSubscriptions();
  }
}

function invalidateRecommendations() {
  recommendationsMoviePool = null;
  recommendationsTvPool = null;
}

function subscriptionOverlapMessage(platform, conflict) {
  const conflictEnd = addDaysToDateString(conflict.startDate, conflict.cycleDays || 30);
  return `Ya tienes un periodo de ${platform} registrado del ${formatShareListDate(conflict.startDate)} al ${formatShareListDate(conflictEnd)} que se solapa con esas fechas. Elimina ese registro del historial de gasto si quieres sustituirlo.`;
}

async function activateSubscription(platform, dateValue, cycleDays) {
  const resolvedCycle = cycleDays || getSubscription(platform).cycleDays || 30;
  const res = await window.api.activateSubscription(platform, dateValue, resolvedCycle);
  if (res.error === 'OVERLAPS_EXISTING') {
    showToast(subscriptionOverlapMessage(platform, res.conflict), 'error', { duration: 7000 });
    return false;
  }
  subscriptions = res.subscriptions;
  subscriptionHistory = res.history;
  invalidateRecommendations();
  return true;
}

function renderSubscriptions() {
  const grid = $('#subscriptions-grid');
  if (!grid) return;
  const today = todayLocalDateString();
  grid.innerHTML = subscriptionPlatforms().map((platform, i) => {
    const sub = getSubscription(platform);
    const logo = resolveProviderLogo(platform);
    const remaining = subscriptionDaysRemaining(sub) || 0;
    const badgeColor = SERIES_COLORS[i % SERIES_COLORS.length];
    const platformEsc = escapeHtml(platform);
    // A cancelled subscription keeps active=true until its paid cycle actually
    // ends: cancelling only stops the next renewal, it doesn't cut off access
    // you already paid for.
    const cancelled = sub.active && sub.willRenew === false;
    const editBtnHtml = `<button type="button" class="btn subscription-edit-btn" data-platform="${platformEsc}">Editar</button>`;

    let statusHtml;
    let actionHtml;
    if (sub.active && !cancelled) {
      statusHtml = `<div class="subscription-status active">Activa · ${remaining === 0 ? 'renueva hoy' : `${remaining} ${pluralize(remaining, 'día', 'días')} restantes`}</div>`;
      actionHtml = `
        <div class="subscription-actions-row">
          <button type="button" class="btn subscription-cancel-btn" data-platform="${platformEsc}">Cancelar</button>
          ${editBtnHtml}
        </div>`;
    } else if (cancelled) {
      statusHtml = `<div class="subscription-status cancelled">Cancelada · te quedan ${remaining} ${pluralize(remaining, 'día', 'días')} de acceso</div>`;
      actionHtml = `
        <div class="subscription-actions-row">
          <button type="button" class="btn subscription-renew-btn" data-platform="${platformEsc}">Reactivar renovación</button>
          ${editBtnHtml}
        </div>`;
    } else {
      statusHtml = `<div class="subscription-status">Sin activar</div>`;
      actionHtml = `<button type="button" class="btn primary subscription-activate-btn" data-platform="${platformEsc}">Activar</button>`;
    }

    // Once active, price and cycle (in the row above) are locked so a stray click
    // can't silently change what an ongoing billing period is worth. "Editar"
    // unlocks those same fields in place and reveals the start date below; every
    // field then saves itself the moment it changes (same as an unactivated
    // platform), so there's no separate "Guardar" step that could be skipped and
    // leave the screen looking saved when it isn't — clicking the same button
    // (now "Cerrar") just re-locks it, no second button needed.
    const editRowHtml = sub.active ? `
        <div class="subscription-date-row hidden" data-platform="${platformEsc}">
          <input type="date" class="subscription-date-input" value="${sub.startDate || today}">
        </div>` : `
        <div class="subscription-date-row hidden" data-platform="${platformEsc}">
          <input type="date" class="subscription-date-input" value="${today}">
          <button type="button" class="btn primary subscription-confirm-btn" data-platform="${platformEsc}">Confirmar</button>
        </div>`;

    return `
      <div class="subscription-card${sub.active ? ' active' : ''}${cancelled ? ' cancelled' : ''}" data-platform="${platformEsc}">
        <div class="subscription-logo"${logo ? '' : ` style="background:${badgeColor}"`}>${logo ? `<img src="${logo}" alt="${platformEsc}">` : `<span class="subscription-logo-fallback">${escapeHtml(platform.charAt(0))}</span>`}</div>
        <div class="subscription-name">${platformEsc}</div>
        <label class="subscription-price-row">
          <span>€</span>
          <input type="text" inputmode="decimal" class="subscription-price-input" data-platform="${platformEsc}" value="${sub.price != null ? sub.price : ''}" placeholder="0.00"${sub.active ? ' disabled title="Pulsa Editar para cambiarlo"' : ''}>
          <select class="subscription-cycle-input" data-platform="${platformEsc}" title="${sub.active ? 'Pulsa Editar para cambiarlo' : 'Ciclo de facturación'}"${sub.active ? ' disabled' : ''}>
            ${CYCLE_OPTIONS.map((o) => `<option value="${o.value}"${(sub.cycleDays || 30) === o.value ? ' selected' : ''}>${o.unit}</option>`).join('')}
          </select>
        </label>
        ${statusHtml}
        ${actionHtml}
        ${editRowHtml}
      </div>
    `;
  }).join('');
}

// Updates just the status line in place (e.g. after a live cycle/date edit) instead
// of a full renderSubscriptions(), which would wipe the open "Editar" panel.
function updateSubscriptionStatusDisplay(platform) {
  const card = $(`.subscription-card[data-platform="${platform}"]`);
  const statusEl = card && card.querySelector('.subscription-status');
  if (!statusEl) return;
  const sub = getSubscription(platform);
  const remaining = subscriptionDaysRemaining(sub) || 0;
  const cancelled = sub.active && sub.willRenew === false;
  if (sub.active && !cancelled) {
    statusEl.textContent = `Activa · ${remaining === 0 ? 'renueva hoy' : `${remaining} ${pluralize(remaining, 'día', 'días')} restantes`}`;
  } else if (cancelled) {
    statusEl.textContent = `Cancelada · te quedan ${remaining} ${pluralize(remaining, 'día', 'días')} de acceso`;
  }
}

// addDaysToDateString is defined in lib/date-utils.js (loaded as a global
// <script> before this file).

// Each history entry represents one full billing period you paid for, so its
// cost is simply the price you had saved — no proration by elapsed days, since
// real subscriptions charge the full period regardless of when you cancel it.
function subscriptionHistoryCost(entry) {
  return entry.price;
}

function subscriptionHistoryEntryStatus(entry) {
  return getHistoryEntryStatus(entry, subscriptions);
}

function renderSubHistoryBreakdown() {
  const totals = {};
  subscriptionHistory.forEach((h) => {
    if (!totals[h.platform]) totals[h.platform] = { count: 0, cost: 0 };
    totals[h.platform].count += 1;
    totals[h.platform].cost += subscriptionHistoryCost(h) || 0;
  });
  return Object.entries(totals)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([platform, t]) => `
      <div class="sub-history-breakdown-item">
        <span class="sub-history-breakdown-platform">${escapeHtml(platform)}</span>
        <span class="sub-history-breakdown-meta">${t.count} ${pluralize(t.count, 'vez', 'veces')} · ${t.cost.toFixed(2)}€</span>
      </div>
    `).join('');
}

function renderSubscriptionHistory() {
  const listEl = $('#sub-history-list');
  const summaryEl = $('#sub-history-summary');
  const emptyEl = $('#sub-history-empty');
  const breakdownEl = $('#sub-history-breakdown');
  if (!listEl || !summaryEl || !emptyEl) return;

  if (!subscriptionHistory.length) {
    listEl.innerHTML = '';
    summaryEl.innerHTML = '';
    if (breakdownEl) breakdownEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  const totalCost = subscriptionHistory.reduce((s, h) => s + (subscriptionHistoryCost(h) || 0), 0);
  summaryEl.innerHTML = `<p>Entre todas las veces que has activado una suscripción (sigan activas o ya canceladas), suman aproximadamente <strong>${totalCost.toFixed(2)}€</strong>.</p>`;

  if (breakdownEl) {
    breakdownEl.innerHTML = `<div class="sub-history-breakdown">${renderSubHistoryBreakdown()}</div>`;
  }

  listEl.innerHTML = subscriptionHistory.map((h) => {
    const cost = subscriptionHistoryCost(h);
    const status = subscriptionHistoryEntryStatus(h);
    let dateLabel;
    let badge = '';
    if (status.kind === 'active') {
      dateLabel = `Activa desde ${formatShareListDate(h.startDate)} · renueva el ${formatShareListDate(status.plannedEnd)} si no la cancelas`;
      badge = '<span class="sub-history-badge ongoing">en curso</span>';
    } else if (status.kind === 'cancelled-active') {
      dateLabel = `Cancelada el ${formatShareListDate(h.cancelledAt)} · tienes acceso hasta el ${formatShareListDate(status.plannedEnd)}`;
      badge = '<span class="sub-history-badge cancelled-active">cancelada, con acceso</span>';
    } else {
      dateLabel = `${formatShareListDate(h.startDate)} — ${formatShareListDate(status.plannedEnd)}`;
      badge = h.cancelledAt ? '<span class="sub-history-badge finished">no se renovó</span>' : '';
    }
    return `
      <div class="sub-history-item" data-id="${h.id}">
        <div class="sub-history-platform">${escapeHtml(h.platform)}${badge}</div>
        <div class="sub-history-dates">${dateLabel}</div>
        <div class="sub-history-cost">${cost != null ? `${cost.toFixed(2)}€` : 'sin precio'}</div>
        <button type="button" class="icon-btn sub-history-delete-btn" data-id="${h.id}" title="Eliminar del historial"><svg class="icon"><use href="#icon-trash"></use></svg></button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.sub-history-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteSubscriptionHistoryEntry(btn.dataset.id));
  });
}

async function deleteSubscriptionHistoryEntry(id) {
  if (!confirm('¿Eliminar este registro del historial de gasto? Si sigue en curso, la suscripción quedará sin activar.')) return;
  const res = await window.api.deleteSubscriptionHistory(id);
  subscriptions = res.subscriptions;
  subscriptionHistory = res.history;
  renderSubscriptions();
  renderSubscriptionHistory();
  updateSubPlannerResult();
}

const DAILY_PACE_CAP_MINUTES = 4 * 60;

function computePaceFromWatchedList(watchedList) {
  if (!watchedList.length) return null;

  const minutesByDay = {};
  watchedList.forEach((m) => {
    minutesByDay[m.dateWatched] = (minutesByDay[m.dateWatched] || 0) + m.runtime;
  });
  const days = Object.keys(minutesByDay).sort();

  // Cap each day's contribution: days you binge-logged a whole backlog at once
  // (same dateWatched for many titles) shouldn't inflate your real weekly pace.
  const cappedTotalMinutes = Object.values(minutesByDay)
    .reduce((s, minutes) => s + Math.min(minutes, DAILY_PACE_CAP_MINUTES), 0);

  const spanDays = Math.max((new Date(days[days.length - 1]) - new Date(days[0])) / 86400000, 7);
  const weeks = spanDays / 7;
  return (cappedTotalMinutes / 60) / weeks;
}

function computeWeeklyPaceHours() {
  return computePaceFromWatchedList(getWatched().filter((m) => m.dateWatched && m.runtime));
}

function computePlatformPaceHours(platform, sinceDate) {
  return computePaceFromWatchedList(getWatched().filter((m) => (
    m.dateWatched && m.runtime && m.platform === platform && (!sinceDate || m.dateWatched >= sinceDate)
  )));
}

function fillSubPlannerPlatforms() {
  const select = $('#sub-planner-platform');
  if (!select) return;
  const platforms = subscriptionPlatforms();
  const previousValue = select.value;
  select.innerHTML = platforms.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (platforms.includes(previousValue)) select.value = previousValue;
}

function computeSubPlannerRow(platform) {
  const sub = getSubscription(platform);
  const pendingHere = getPending().filter((m) => m.platform === platform);
  const withRuntime = pendingHere.filter((m) => m.runtime);
  const totalMinutes = withRuntime.reduce((s, m) => s + m.runtime, 0);
  if (!pendingHere.length || !totalMinutes) return null;

  const platformPace = sub.active ? computePlatformPaceHours(platform, sub.startDate) : null;
  const generalPace = computeWeeklyPaceHours();
  const effectivePace = (platformPace && platformPace > 0.1) ? platformPace
    : (generalPace && generalPace > 0.1) ? generalPace
    : 3;

  const weeksNeeded = Math.max(Math.ceil((totalMinutes / 60) / effectivePace), 1);
  const daysNeeded = weeksNeeded * 7;
  const cycleDays = sub.cycleDays || 30;
  let estimatedCost = null;
  if (sub.price != null) {
    estimatedCost = cycleDays <= 31
      ? Math.max(Math.ceil(daysNeeded / 30), 1) * sub.price
      : (sub.price / cycleDays) * daysNeeded;
  }
  return { platform, pendingCount: pendingHere.length, weeksNeeded, estimatedCost, active: sub.active };
}

function renderSubPlannerRanking() {
  const el = $('#sub-planner-ranking');
  if (!el) return;
  const rows = subscriptionPlatforms()
    .map((p) => computeSubPlannerRow(p))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.estimatedCost != null && b.estimatedCost != null) return a.estimatedCost - b.estimatedCost;
      if (a.estimatedCost != null) return -1;
      if (b.estimatedCost != null) return 1;
      return a.weeksNeeded - b.weeksNeeded;
    });

  if (!rows.length) {
    el.innerHTML = '<p class="chart-empty">Añade duración a tus pendientes en alguna plataforma para poder comparar.</p>';
    return;
  }

  el.innerHTML = rows.map((r) => `
    <div class="sub-rank-item${r.active ? ' active' : ''}" data-platform="${escapeHtml(r.platform)}">
      <div class="sub-rank-platform">${escapeHtml(r.platform)}${r.active ? ' <span class="sub-rank-badge">activa</span>' : ''}</div>
      <div class="sub-rank-detail">${r.pendingCount} ${pluralize(r.pendingCount, 'pendiente', 'pendientes')} · ~${r.weeksNeeded} ${pluralize(r.weeksNeeded, 'semana', 'semanas')}</div>
      <div class="sub-rank-cost">${r.estimatedCost != null ? `~${r.estimatedCost.toFixed(2)}€` : 'sin precio'}</div>
    </div>
  `).join('');

  el.querySelectorAll('.sub-rank-item').forEach((item) => {
    item.addEventListener('click', () => {
      const select = $('#sub-planner-platform');
      if (!select) return;
      select.value = item.dataset.platform;
      updateSubPlannerResult();
    });
  });
}

function updateSubPlannerResult() {
  renderSubPlannerRanking();
  const select = $('#sub-planner-platform');
  const resultEl = $('#sub-planner-result');
  if (!select || !resultEl) return;
  const platform = select.value;
  const platformEsc = escapeHtml(platform);
  const sub = getSubscription(platform);
  const pendingHere = getPending().filter((m) => m.platform === platform);

  if (!pendingHere.length) {
    resultEl.innerHTML = sub.active
      ? `<p class="chart-empty">Ya no tienes pendientes en ${platformEsc} — a este ritmo puedes cancelarla en cuanto quieras.</p>`
      : `<p class="chart-empty">No tienes pendientes en ${platformEsc} todavía.</p>`;
    return;
  }

  const withRuntime = pendingHere.filter((m) => m.runtime);
  const missingCount = pendingHere.length - withRuntime.length;
  const totalMinutes = withRuntime.reduce((s, m) => s + m.runtime, 0);

  if (!totalMinutes) {
    resultEl.innerHTML = `<p class="chart-empty">Ninguno de tus pendientes en ${platformEsc} tiene duración registrada (añádelos buscando en TMDB para poder calcularlo).</p>`;
    return;
  }

  const platformPace = sub.active ? computePlatformPaceHours(platform, sub.startDate) : null;
  let effectivePace;
  let paceSource;
  if (platformPace && platformPace > 0.1) {
    effectivePace = platformPace;
    paceSource = `según tu ritmo en ${platformEsc} desde que la activaste`;
  } else {
    const generalPace = computeWeeklyPaceHours();
    if (generalPace && generalPace > 0.1) {
      effectivePace = generalPace;
      paceSource = 'según tu ritmo real de estos meses';
    } else {
      effectivePace = 3;
      paceSource = 'estimado, ya que aún no tienes suficiente historial';
    }
  }

  const weeksNeeded = Math.max(Math.ceil((totalMinutes / 60) / effectivePace), 1);
  const daysNeeded = weeksNeeded * 7;
  const cycleDays = sub.cycleDays || 30;
  const isMonthly = cycleDays <= 31;
  const missingHtml = missingCount
    ? `<p class="field-hint">${missingCount} ${pluralize(missingCount, 'título', 'títulos')} sin duración registrada no se ${pluralize(missingCount, 'ha', 'han')} podido incluir en el cálculo.</p>`
    : '';
  const baseInfo = `
    <p><strong>${pendingHere.length}</strong> ${pluralize(pendingHere.length, 'título', 'títulos')} ${pluralize(pendingHere.length, 'pendiente', 'pendientes')} en ${platformEsc}, unas <strong>${Math.round(totalMinutes / 60)}h</strong> en total.</p>
    <p>A ~${effectivePace.toFixed(1)}h/semana (${paceSource}), te llevaría unas <strong>${weeksNeeded} ${pluralize(weeksNeeded, 'semana', 'semanas')}</strong> verlo todo.</p>
  `;

  if (sub.active) {
    const remaining = subscriptionDaysRemaining(sub) || 0;
    const shortfallDays = daysNeeded - remaining;
    const statusText = daysNeeded <= remaining
      ? `Con los <strong>${remaining} ${pluralize(remaining, 'día', 'días')}</strong> que te quedan de suscripción vas sobrado: a este ritmo acabarías en unos ${daysNeeded} ${pluralize(daysNeeded, 'día', 'días')}. No hace falta que la renueves solo por esto.`
      : `A este ritmo <strong>no te va a dar tiempo</strong> antes de que acabe tu ciclo actual (te quedan ${remaining} ${pluralize(remaining, 'día', 'días')}). Necesitarías unos ${shortfallDays} ${pluralize(shortfallDays, 'día', 'días')} más de suscripción para verlo todo.`;
    resultEl.innerHTML = `${baseInfo}<p>${statusText}</p>${missingHtml}`;
    return;
  }

  let commitmentText;
  let costText = '';
  if (isMonthly) {
    const monthsNeeded = Math.max(Math.ceil(daysNeeded / 30), 1);
    commitmentText = `Eso son aproximadamente <strong>${monthsNeeded} ${pluralize(monthsNeeded, 'mes', 'meses')}</strong> de suscripción`;
    if (sub.price != null) costText = ` (~${(monthsNeeded * sub.price).toFixed(2)}€)`;
  } else {
    const cycleOpt = CYCLE_OPTIONS.find((o) => o.value === cycleDays);
    const cycleName = cycleOpt ? cycleOpt.name : `cada ${cycleDays} días`;
    commitmentText = `Como es una suscripción de ciclo largo (${cycleName}) que no se activa y cancela suelta, esas ~${weeksNeeded} ${pluralize(weeksNeeded, 'semana', 'semanas')} equivaldrían a una parte proporcional de lo que ya pagas`;
    if (sub.price != null) costText = ` (~${((sub.price / cycleDays) * daysNeeded).toFixed(2)}€)`;
  }
  const activateLabel = isMonthly ? 'Contratar esta' : 'Registrar esta';

  resultEl.innerHTML = `
    ${baseInfo}
    <p>${commitmentText}${costText}.</p>
    ${missingHtml}
    <button type="button" class="btn primary" id="sub-planner-activate-btn" data-platform="${platformEsc}">${activateLabel}</button>
  `;
}

function animateStatNumbers() {
  const reduced = document.documentElement.getAttribute('data-motion') === 'reduced';
  $$('.stat-num').forEach((el) => {
    const target = Number(el.dataset.target) || 0;
    if (reduced || target === 0) { el.textContent = String(target); return; }
    const duration = 650;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = String(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function topNWithOther(counts, n = 6) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, n);
  const restSum = entries.slice(n).reduce((s, [, v]) => s + v, 0);
  if (restSum > 0) top.push(['Otros', restSum]);
  return top;
}

function renderBarChart(containerId, emptyId, entries) {
  const container = $(containerId);
  const empty = $(emptyId);
  if (!entries.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  const max = Math.max(...entries.map(([, v]) => v));
  const total = entries.reduce((s, [, v]) => s + v, 0);
  container.innerHTML = entries.map(([label, value], i) => {
    const color = label === 'Otros' ? OTHER_COLOR : SERIES_COLORS[i % SERIES_COLORS.length];
    const pct = Math.max((value / max) * 100, 3);
    const share = total ? Math.round((value / total) * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="bar-track"><div class="bar-fill" data-target="${pct}" style="background:${color}; color:${color}"></div></div>
        <div class="bar-value">${value}<span class="bar-pct">${share}%</span></div>
      </div>`;
  }).join('');
  requestAnimationFrame(() => {
    container.querySelectorAll('.bar-fill').forEach((el) => { el.style.width = `${el.dataset.target}%`; });
  });
}

function renderGenreChart(watched) {
  const counts = {};
  watched.forEach((m) => (m.genres || []).forEach((g) => { counts[g] = (counts[g] || 0) + 1; }));
  renderBarChart('#chart-genres', '#chart-genres-empty', topNWithOther(counts, 6));
}

function renderPlatformChart(pending) {
  const counts = {};
  pending.forEach((m) => { if (m.platform) counts[m.platform] = (counts[m.platform] || 0) + 1; });
  renderBarChart('#chart-platforms', '#chart-platforms-empty', topNWithOther(counts, 6));
}

function renderHistChart(containerId, emptyId, values, labels) {
  const container = $(containerId);
  const empty = $(emptyId);
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  const max = Math.max(...values, 1);
  const bars = values.map((v) => {
    const pct = v ? Math.max((v / max) * 100, 4) : 0;
    return `
      <div class="hist-col">
        <span class="hist-value">${v || ''}</span>
        <div class="hist-bar" data-target="${pct}"></div>
      </div>`;
  }).join('');
  const labelRow = labels.map((l) => `<span>${escapeHtml(l)}</span>`).join('');
  container.innerHTML = `<div class="hist-bars">${bars}</div><div class="hist-labels">${labelRow}</div>`;
  requestAnimationFrame(() => {
    container.querySelectorAll('.hist-bar').forEach((el) => { el.style.height = `${el.dataset.target}%`; });
  });
}

function renderRatingHistogram(rated) {
  const counts = new Array(10).fill(0);
  rated.forEach((m) => { const r = Math.round(m.rating); if (r >= 1 && r <= 10) counts[r - 1] += 1; });
  renderHistChart('#chart-ratings', '#chart-ratings-empty', counts, counts.map((_, i) => String(i + 1)));
}

function renderActivityChart(watched) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTH_NAMES[d.getMonth()] });
  }
  const values = months.map((mo) => watched.filter((m) => (m.dateWatched || '').startsWith(mo.key)).length);
  renderHistChart('#chart-activity', '#chart-activity-empty', values, months.map((m) => m.label));
}

function renderYearChart(watched) {
  const years = watched.map((m) => (m.dateWatched || '').slice(0, 4)).filter(Boolean).map(Number);
  const currentYear = new Date().getFullYear();
  const minYear = years.length ? Math.min(...years, currentYear - 4) : currentYear - 4;
  const startYear = Math.max(minYear, currentYear - 9);
  const range = [];
  for (let y = startYear; y <= currentYear; y += 1) range.push(y);
  const values = range.map((y) => watched.filter((m) => Number((m.dateWatched || '').slice(0, 4)) === y).length);
  renderHistChart('#chart-years', '#chart-years-empty', values, range.map(String));
}

function renderEraChart(watched) {
  const currentYear = new Date().getFullYear();
  const releaseYears = watched
    .map((m) => Number(m.year))
    .filter((y) => y && y > 1880 && y <= currentYear + 1);
  const decades = [...new Set(releaseYears.map((y) => Math.floor(y / 10) * 10))].sort((a, b) => a - b);
  const values = decades.map((d) => releaseYears.filter((y) => Math.floor(y / 10) * 10 === d).length);
  renderHistChart('#chart-eras', '#chart-eras-empty', values, decades.map((d) => `${d}s`));
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

/* ---------- Trash (Papelera) ---------- */

async function purgeOldTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
  const before = trash.length;
  trash = trash.filter((m) => new Date(m.deletedAt).getTime() > cutoff);
  if (trash.length !== before) await saveTrash();
}

async function saveTrash() {
  await window.api.saveTrash(trash);
}

function updateTrashBadge() {
  const badge = $('#trash-badge');
  if (trash.length) {
    badge.textContent = String(trash.length);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderTrash() {
  updateTrashBadge();
  const container = $('#list-papelera');
  const emptyEl = $('#empty-papelera');
  const sorted = [...trash].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  if (!sorted.length) {
    container.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  container.innerHTML = sorted.map((m, i) => {
    const days = Math.floor((Date.now() - new Date(m.deletedAt).getTime()) / 86400000);
    const daysLeft = Math.max(TRASH_RETENTION_DAYS - days, 0);
    return `
    <div class="card trash-card" data-id="${m.id}" style="animation-delay:${Math.min(i, 20) * 30}ms">
      ${posterOrPlaceholder(m)}
      <div class="info">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta-row"><span class="type-tag">${TYPE_LABELS[m.type] || TYPE_LABELS.pelicula}</span><span class="year">${escapeHtml(m.year || '')}</span></div>
        <div class="trash-meta">Eliminada hace ${days} día${days === 1 ? '' : 's'} · se borra para siempre en ${daysLeft} día${daysLeft === 1 ? '' : 's'}</div>
      </div>
      <div class="trash-actions">
        <button class="btn restore-btn" data-id="${m.id}"><svg class="icon"><use href="#icon-restore"></use></svg>Restaurar</button>
        <button class="btn danger delete-forever-btn" data-id="${m.id}"><svg class="icon"><use href="#icon-trash"></use></svg>Borrar</button>
      </div>
    </div>
  `;
  }).join('');

  container.querySelectorAll('.restore-btn').forEach((btn) => {
    btn.addEventListener('click', () => restoreFromTrash(btn.dataset.id));
  });
  container.querySelectorAll('.delete-forever-btn').forEach((btn) => {
    btn.addEventListener('click', () => permanentlyDelete(btn.dataset.id));
  });
}

async function restoreFromTrash(id) {
  const item = trash.find((m) => m.id === id);
  if (!item) return;
  const { deletedAt, ...movie } = item;
  trash = trash.filter((m) => m.id !== id);
  movies.push(movie);
  await saveMovies();
  await saveTrash();
  renderAll();
  renderTrash();
  showToast(`${movie.title} restaurada`);
}

async function permanentlyDelete(id) {
  const item = trash.find((m) => m.id === id);
  if (!item) return;
  if (!confirm(`¿Borrar "${item.title}" para siempre? Esta acción no se puede deshacer.`)) return;
  trash = trash.filter((m) => m.id !== id);
  await saveTrash();
  renderTrash();
  showToast(`${item.title} eliminada para siempre`, 'error');
}

async function emptyTrash() {
  if (!trash.length) return;
  if (!confirm(`¿Vaciar la papelera? Se borrarán para siempre ${trash.length} título${trash.length === 1 ? '' : 's'}.`)) return;
  trash = [];
  await saveTrash();
  renderTrash();
  showToast('Papelera vaciada', 'error');
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

init();
