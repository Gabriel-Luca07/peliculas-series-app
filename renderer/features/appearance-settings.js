// Theme, accent/density/motion, behavior preferences and dashboard-panel
// visibility settings. Plain global-scope script — see updater.js for the
// load-order note.

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


function bindAppearanceEvents() {
  $('#btn-theme-toggle').addEventListener('click', toggleTheme);
  $$('.swatch[data-accent]').forEach((s) => s.addEventListener('click', () => setAccent(s.dataset.accent)));
  $$('.swatch[data-chart-color]').forEach((s) => s.addEventListener('click', () => setChartColor(s.dataset.chartColor)));
  $$('.segment').forEach((s) => s.addEventListener('click', () => setDensity(s.dataset.density)));
  $('#motion-toggle').addEventListener('change', (e) => setMotion(e.target.checked));

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
}
