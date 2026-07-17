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

