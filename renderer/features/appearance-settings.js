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

