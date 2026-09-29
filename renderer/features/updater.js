// Auto-update UI. Plain global-scope script (no imports/exports) — loaded via
// <script> in index.html after renderer.js's shared state/utilities, sharing
// the same global scope with every other renderer/features/*.js file.

/* ---------- Auto-actualización ---------- */

let pendingUpdateInfo = null; // { version, releaseNotes }
let updateReadyToInstall = false;

function refreshUpdateNotesButton() {
  const btn = $('#btn-view-update-notes');
  if (btn) btn.classList.toggle('hidden', !(pendingUpdateInfo && pendingUpdateInfo.releaseNotes));
}

// GitHub hands electron-updater the notes as HTML; turn that back into the
// Markdown-ish text markdownToHtml (lib/markdown-lite.js) renders safely.
// DOMParser only parses: nothing in it runs or loads.
function htmlNotesToMarkdown(html) {
  const marked = String(html)
    .replace(/<h[1-6][^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|h[1-6]|ul|ol)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(strong|b)>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**');
  return new DOMParser().parseFromString(marked, 'text/html').body.textContent;
}

function renderUpdateNotesBody(notes) {
  if (!notes) return '<p class="help">No hay notas de esta versión disponibles.</p>';
  const markdown = /<[a-z][^>]*>/i.test(notes) ? htmlNotesToMarkdown(notes) : notes;
  return `<div class="update-notes-text">${markdownToHtml(markdown)}</div>`;
}

// mode 'update': a new version is downloading/downloaded (offers to restart).
// mode 'installed': what changed in the version already running.
function showNotesModal({ version, notes, mode }) {
  $('#update-notes-heading').firstChild.textContent = mode === 'installed' ? 'Qué hay de nuevo en la versión ' : 'Novedades de la versión ';
  $('#update-notes-version').textContent = version || '';
  $('#update-notes-body').innerHTML = renderUpdateNotesBody(notes);
  const installBtn = $('#update-notes-install');
  installBtn.classList.toggle('hidden', mode === 'installed');
  installBtn.disabled = !updateReadyToInstall;
  installBtn.textContent = updateReadyToInstall ? 'Reiniciar ahora' : 'Descargando...';
  $('#update-notes-later').textContent = mode === 'installed' ? 'Cerrar' : 'Más tarde';
  showOverlay($('#update-notes-overlay'));
}

function openUpdateNotesModal() {
  if (!pendingUpdateInfo) return;
  showNotesModal({ version: pendingUpdateInfo.version, notes: pendingUpdateInfo.releaseNotes, mode: 'update' });
}

async function openInstalledNotes() {
  const version = await window.api.getAppVersion();
  showNotesModal({ version, notes: await window.api.getReleaseNotes(version), mode: 'installed' });
}

// The first time a new version opens, show what changed in it (once per
// computer, not per profile). A brand-new install with nothing in it yet
// just records the version.
async function showWhatsNewIfUpdated() {
  const version = await window.api.getAppVersion();
  let lastSeen = null;
  try { lastSeen = localStorage.getItem('app-last-seen-version'); } catch { /* storage unavailable */ }
  if (lastSeen === version) return;
  try { localStorage.setItem('app-last-seen-version', version); } catch { /* storage unavailable */ }
  const freshInstall = lastSeen === null && !movies.length && allProfiles.length <= 1;
  if (freshInstall) return;
  const notes = await window.api.getReleaseNotes(version);
  if (notes) showNotesModal({ version, notes, mode: 'installed' });
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


function bindUpdaterEvents() {
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
  $('#btn-whats-new').addEventListener('click', openInstalledNotes);
  $('#btn-restart-update').addEventListener('click', () => window.api.installUpdate());
  $('#update-notes-close').addEventListener('click', closeUpdateNotesModal);
  $('#update-notes-later').addEventListener('click', closeUpdateNotesModal);
  $('#update-notes-install').addEventListener('click', () => {
    if (updateReadyToInstall) window.api.installUpdate();
  });
  $('#update-notes-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'update-notes-overlay') closeUpdateNotesModal();
  });
}
