// Papelera tab. Plain global-scope script — see updater.js for the load-order
// note.

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


function bindTrashEvents() {
  $('#btn-empty-trash').addEventListener('click', emptyTrash);
}
