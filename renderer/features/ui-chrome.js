// Cross-cutting UI chrome: sidebar nav indicator, toasts, animated
// show/hide-overlay helpers, global search (Ctrl+K), view switching, and
// renderAll() (calls out to the render functions defined in the other
// feature files). Plain global-scope script — see updater.js for the
// load-order note.

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

