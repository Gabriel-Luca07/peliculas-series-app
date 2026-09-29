// Ajustes → "Carpeta de datos": keeping the profiles in a folder shared by
// several computers (e.g. in OneDrive), and picking up what the other
// computer changed. Merging on save is done in main.js (lib/sync-merge.js).
// Plain global-scope script — see updater.js for the load-order note.

/* ---------- Data folder ---------- */

function renderDataLocation(info) {
  $('#data-location-path').textContent = info.shared ? info.dir : 'En este ordenador (carpeta de la app)';
  $('#btn-data-location-reset').classList.toggle('hidden', !info.shared && !info.missing);
  const warning = $('#data-location-missing');
  warning.classList.toggle('hidden', !info.missing);
  if (info.missing) {
    warning.textContent = `No se encuentra la carpeta ${info.missing}, así que ahora se usan los datos guardados en este ordenador. `
      + 'Lo que cambies mientras tanto se queda solo aquí. Cuando vuelva a estar disponible (por ejemplo, al terminar de '
      + 'sincronizar OneDrive), reinicia la app.';
  }
}

async function initDataLocation() {
  const info = await window.api.getDataLocation();
  renderDataLocation(info);
  if (info.missing) showToast('No se encuentra la carpeta de datos compartida: usando los datos de este ordenador', 'error');
}

const DATA_LOCATION_ERRORS = {
  APP_FOLDER: 'Elige una carpeta fuera de la de la propia app.',
  SAME: 'Tus datos ya están en esa carpeta.',
};

// `info` is what main.js's inspectDataLocation() says about the folder.
async function applyDataLocation(info) {
  if (!info) return;
  if (info.error) {
    showToast(DATA_LOCATION_ERRORS[info.error] || 'No se puede usar esa carpeta', 'error');
    return;
  }
  const message = info.hasData
    ? `${info.dir} ya tiene datos de la app, seguramente de otro ordenador. A partir de ahora este ordenador usará esos datos `
      + '(sus perfiles, listas y suscripciones). Lo que tienes ahora aquí no se borra, pero deja de usarse. ¿Continuar?'
    : `Se copiarán tus datos (todos los perfiles, con sus listas, suscripciones y copias) a ${info.dir}, y la app los usará desde ahí. `
      + 'Para compartirlos, elige la misma carpeta en el otro ordenador. ¿Continuar?';
  if (!confirm(message)) return;
  const result = await window.api.setDataLocation(info.picked, info.hasData ? 'use' : 'copy');
  if (result.error) {
    showToast(DATA_LOCATION_ERRORS[result.error] || 'No se ha podido cambiar la carpeta', 'error');
    return;
  }
  location.reload();
}

async function resetDataLocation() {
  if (!confirm('Tus datos volverán a guardarse solo en este ordenador, tal como están ahora. La carpeta compartida no se toca. ¿Continuar?')) return;
  await window.api.resetDataLocation();
  location.reload();
}

// Coming back to the window: take in what another computer saved meanwhile.
async function reloadSharedChanges() {
  const changed = await window.api.reloadIfChanged();
  if (changed.movies) movies = changed.movies;
  if (changed.trash) trash = changed.trash;
  if (changed.movies || changed.trash) {
    renderAll();
    renderTrash();
  }
}

// After a save merged in another computer's changes (`merged`, what's now on
// disk). Anything changed here while that save was on its way is kept.
function adoptMergedList(kind, sent, merged) {
  if (!Array.isArray(merged)) return;
  if (kind === 'movies') {
    movies = mergeById(sent, movies, merged);
    renderAll();
  } else {
    trash = mergeById(sent, trash, merged);
    renderTrash();
  }
}

function bindDataLocationEvents() {
  $('#btn-data-location-pick').addEventListener('click', async () => applyDataLocation(await window.api.pickDataLocation()));
  $('#btn-data-location-reset').addEventListener('click', resetDataLocation);
  window.addEventListener('focus', reloadSharedChanges);
}
