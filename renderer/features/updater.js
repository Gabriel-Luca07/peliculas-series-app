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
