// Suscripciones tab: card grid, planner, history. Uses subscriptionDaysRemaining
// and getHistoryEntryStatus from lib/subscription-logic.js and the planner
// maths from lib/subscription-planner.js. Plain global-scope script — see
// updater.js for the load-order note.

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
  onActiveSubscriptionsChanged();
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
          <input type="date" class="subscription-date-input" aria-label="Fecha de inicio de ${platformEsc}" value="${sub.startDate || today}">
        </div>` : `
        <div class="subscription-date-row hidden" data-platform="${platformEsc}">
          <input type="date" class="subscription-date-input" aria-label="Fecha de inicio de ${platformEsc}" value="${today}">
          <button type="button" class="btn primary subscription-confirm-btn" data-platform="${platformEsc}">Confirmar</button>
        </div>`;

    return `
      <div class="subscription-card${sub.active ? ' active' : ''}${cancelled ? ' cancelled' : ''}" data-platform="${platformEsc}">
        <div class="subscription-logo"${logo ? '' : ` style="background:${badgeColor}"`}>${logo ? `<img src="${logo}" alt="${platformEsc}">` : `<span class="subscription-logo-fallback">${escapeHtml(platform.charAt(0))}</span>`}</div>
        <div class="subscription-name">${platformEsc}</div>
        <label class="subscription-price-row">
          <span>€</span>
          <input type="text" inputmode="decimal" class="subscription-price-input" aria-label="Precio de ${platformEsc}" data-platform="${platformEsc}" value="${sub.price != null ? sub.price : ''}" placeholder="0.00"${sub.active ? ' disabled title="Pulsa Editar para cambiarlo"' : ''}>
          <select class="subscription-cycle-input" aria-label="Ciclo de facturación de ${platformEsc}" data-platform="${platformEsc}" title="${sub.active ? 'Pulsa Editar para cambiarlo' : 'Ciclo de facturación'}"${sub.active ? ' disabled' : ''}>
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
  onActiveSubscriptionsChanged();
}

/* ---------- Planner ---------- */

// planPlatform / rankPlans (lib/subscription-planner.js) do the maths.
function planFor(platform) {
  return planPlatform(platform, getPending().filter((m) => m.platform === platform), getWatched(), getSubscription(platform));
}

function fillSubPlannerPlatforms() {
  const select = $('#sub-planner-platform');
  if (!select) return;
  const platforms = subscriptionPlatforms();
  const previousValue = select.value;
  select.innerHTML = platforms.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (platforms.includes(previousValue)) select.value = previousValue;
}

function renderSubPlannerRanking() {
  const el = $('#sub-planner-ranking');
  if (!el) return;
  const rows = rankPlans(subscriptionPlatforms().map(planFor));

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

const PACE_SOURCE_TEXT = {
  platform: (platformEsc) => `según tu ritmo en ${platformEsc} desde que la activaste`,
  general: () => 'según tu ritmo real de estos meses',
  default: () => 'estimado, ya que aún no tienes suficiente historial',
};

function updateSubPlannerResult() {
  renderSubPlannerRanking();
  const select = $('#sub-planner-platform');
  const resultEl = $('#sub-planner-result');
  if (!select || !resultEl) return;
  const platform = select.value;
  const platformEsc = escapeHtml(platform);
  const sub = getSubscription(platform);
  const plan = planFor(platform);

  if (!plan) {
    resultEl.innerHTML = sub.active
      ? `<p class="chart-empty">Ya no tienes pendientes en ${platformEsc} — a este ritmo puedes cancelarla en cuanto quieras.</p>`
      : `<p class="chart-empty">No tienes pendientes en ${platformEsc} todavía.</p>`;
    return;
  }
  if (!plan.weeksNeeded) {
    resultEl.innerHTML = `<p class="chart-empty">Ninguno de tus pendientes en ${platformEsc} tiene duración registrada (añádelos buscando en TMDB para poder calcularlo).</p>`;
    return;
  }

  const { pendingCount, missingCount, totalMinutes, pace, weeksNeeded, daysNeeded } = plan;
  const missingHtml = missingCount
    ? `<p class="field-hint">${missingCount} ${pluralize(missingCount, 'título', 'títulos')} sin duración registrada no se ${pluralize(missingCount, 'ha', 'han')} podido incluir en el cálculo.</p>`
    : '';
  const baseInfo = `
    <p><strong>${pendingCount}</strong> ${pluralize(pendingCount, 'título', 'títulos')} ${pluralize(pendingCount, 'pendiente', 'pendientes')} en ${platformEsc}, unas <strong>${Math.round(totalMinutes / 60)}h</strong> en total.</p>
    <p>A ~${pace.hours.toFixed(1)}h/semana (${PACE_SOURCE_TEXT[pace.source](platformEsc)}), te llevaría unas <strong>${weeksNeeded} ${pluralize(weeksNeeded, 'semana', 'semanas')}</strong> verlo todo.</p>
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

  const costText = plan.estimatedCost != null ? ` (~${plan.estimatedCost.toFixed(2)}€)` : '';
  let commitmentText;
  if (plan.isMonthly) {
    commitmentText = `Eso son aproximadamente <strong>${plan.monthsNeeded} ${pluralize(plan.monthsNeeded, 'mes', 'meses')}</strong> de suscripción`;
  } else {
    const cycleOpt = CYCLE_OPTIONS.find((o) => o.value === plan.cycleDays);
    const cycleName = cycleOpt ? cycleOpt.name : `cada ${plan.cycleDays} días`;
    commitmentText = `Como es una suscripción de ciclo largo (${cycleName}) que no se activa y cancela suelta, esas ~${weeksNeeded} ${pluralize(weeksNeeded, 'semana', 'semanas')} equivaldrían a una parte proporcional de lo que ya pagas`;
  }
  const activateLabel = plan.isMonthly ? 'Contratar esta' : 'Registrar esta';

  resultEl.innerHTML = `
    ${baseInfo}
    <p>${commitmentText}${costText}.</p>
    ${missingHtml}
    <button type="button" class="btn primary" id="sub-planner-activate-btn" data-platform="${platformEsc}">${activateLabel}</button>
  `;
}


function bindSubscriptionEvents() {
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
