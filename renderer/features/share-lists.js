// "Recomendar" tab: building/exporting the shareable image lists. Plain
// global-scope script — see updater.js for the load-order note.

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


function bindShareListEvents() {
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
}
