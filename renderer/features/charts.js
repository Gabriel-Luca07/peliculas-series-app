// Dashboard ("Resumen") charts and the counting-up animation of its stat
// numbers. What each chart shows is computed in lib/stats-logic.js; this file
// only draws it. Plain global-scope script — see updater.js for the
// load-order note.

/* ---------- Charts ---------- */

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

function renderGenreChart(watched) {
  renderBarChart('#chart-genres', '#chart-genres-empty', topNWithOther(countGenres(watched), 6));
}

function renderPlatformChart(pending) {
  renderBarChart('#chart-platforms', '#chart-platforms-empty', topNWithOther(countPlatforms(pending), 6));
}

function renderRatingHistogram(rated) {
  const counts = ratingBuckets(rated);
  renderHistChart('#chart-ratings', '#chart-ratings-empty', counts, counts.map((_, i) => String(i + 1)));
}

function renderActivityChart(watched) {
  const months = monthlyActivity(watched, new Date());
  renderHistChart('#chart-activity', '#chart-activity-empty', months.map((m) => m.count), months.map((m) => MONTH_NAMES[m.month]));
}

function renderYearChart(watched) {
  const years = watchedPerYear(watched, new Date().getFullYear());
  renderHistChart('#chart-years', '#chart-years-empty', years.map((y) => y.count), years.map((y) => String(y.year)));
}

function renderEraChart(watched) {
  const decades = releaseDecades(watched, new Date().getFullYear());
  renderHistChart('#chart-eras', '#chart-eras-empty', decades.map((d) => d.count), decades.map((d) => `${d.decade}s`));
}
