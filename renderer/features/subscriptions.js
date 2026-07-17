// Suscripciones tab: card grid, planner, history. Uses subscriptionDaysRemaining
// and getHistoryEntryStatus from lib/subscription-logic.js. Plain global-scope
// script — see updater.js for the load-order note.

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

