const {
  app, BrowserWindow, ipcMain, dialog, shell, Notification, safeStorage, Tray, Menu, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { todayLocalDateString } = require('./lib/date-utils');
const { findOverlappingHistoryEntry, reconcileSubscriptionEntry } = require('./lib/subscription-logic');
const { isValidProfileColor, sanitizeProfileInitial } = require('./lib/profile-utils');
const { createTmdbApi } = require('./lib/tmdb-api');
const { mergeById } = require('./lib/sync-merge');

// This computer's own app folder. What belongs to this computer stays here:
// the TMDB key (encrypted for this Windows account), tray/login settings and
// where the profiles are kept (data-location.json).
const localDir = app.getPath('userData');
const globalSettingsFile = path.join(localDir, 'global-settings.json');
const dataLocationFile = path.join(localDir, 'data-location.json');

// The profiles (lists, subscriptions, backups...) live in localDir, or in a
// folder picked in Ajustes → "Carpeta de datos" (e.g. in OneDrive) so that
// several computers share them. See useDataDir() and lib/sync-merge.js.
let dataDir = localDir;
let profilesFile;
let deletedProfilesFile;
// The picked folder, when it couldn't be found at startup (OneDrive not
// synced yet, drive unplugged): the app then works with localDir.
let missingDataDir = null;

function useDataDir(dir) {
  dataDir = dir;
  profilesFile = path.join(dataDir, 'profiles.json');
  deletedProfilesFile = path.join(dataDir, 'deleted-profiles.json');
}

function readDataLocationSync() {
  try {
    const { dir } = JSON.parse(fsSync.readFileSync(dataLocationFile, 'utf-8'));
    return typeof dir === 'string' && dir ? dir : null;
  } catch {
    return null;
  }
}

{
  const picked = readDataLocationSync();
  if (picked && fsSync.existsSync(path.join(picked, 'profiles.json'))) useDataDir(picked);
  else {
    useDataDir(localDir);
    missingDataDir = picked;
  }
}

function profileDir(id) { return path.join(dataDir, 'profiles', id); }
function moviesFile(id) { return path.join(profileDir(id), 'movies.json'); }
function trashFile(id) { return path.join(profileDir(id), 'trash.json'); }
function profileSettingsFile(id) { return path.join(profileDir(id), 'settings.json'); }
function backupsDir(id) { return path.join(profileDir(id), 'backups'); }
function deletedProfileDir(id) { return path.join(dataDir, 'deleted-profiles', id); }
function shareListsFile(id) { return path.join(profileDir(id), 'share-lists.json'); }
function shareImagesDir(id) { return path.join(profileDir(id), 'share-images'); }
function subscriptionsFile(id) { return path.join(profileDir(id), 'subscriptions.json'); }
function subscriptionHistoryFile(id) { return path.join(profileDir(id), 'subscription-history.json'); }

const DELETED_PROFILE_RETENTION_DAYS = 30;

let currentProfileId = null;

// App-wide settings (not per profile): the TMDB key and how the app behaves
// in the background.
const DEFAULT_GLOBAL_SETTINGS = { tmdbApiKey: '', closeToTray: true, openAtLogin: false, trayHintShown: false };
const DEFAULT_PROFILE_SETTINGS = {
  language: 'es-ES', region: 'ES',
  autoBackupEnabled: true, autoBackupRetentionDays: 14,
};

const ALLOWED_AVATAR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpFile, file);
}

// The TMDB key is stored encrypted with the Windows account's credentials
// (safeStorage, i.e. DPAPI) whenever that's available, so the settings file
// alone (a copied folder, a backup) doesn't give the key away. A key saved in
// plain text by an older version is encrypted the first time it's read.
// Kept in memory once read: every TMDB request needs it.
let tmdbApiKeyCache = null;

async function readGlobalSettings() {
  return { ...DEFAULT_GLOBAL_SETTINGS, ...await readJson(globalSettingsFile, {}) };
}

// Merges `patch` into global-settings.json; keys set to undefined are removed.
async function updateGlobalSettings(patch) {
  const next = { ...await readJson(globalSettingsFile, {}), ...patch };
  Object.keys(next).forEach((k) => { if (next[k] === undefined) delete next[k]; });
  await writeJson(globalSettingsFile, next);
  return { ...DEFAULT_GLOBAL_SETTINGS, ...next };
}

async function writeTmdbApiKey(key) {
  const clean = key || '';
  if (clean && safeStorage.isEncryptionAvailable()) {
    await updateGlobalSettings({ tmdbApiKeyEnc: safeStorage.encryptString(clean).toString('base64'), tmdbApiKey: undefined });
  } else {
    await updateGlobalSettings({ tmdbApiKey: clean, tmdbApiKeyEnc: undefined });
  }
  tmdbApiKeyCache = clean;
}

async function readTmdbApiKey() {
  if (tmdbApiKeyCache !== null) return tmdbApiKeyCache;
  const global = await readJson(globalSettingsFile, DEFAULT_GLOBAL_SETTINGS);
  if (global.tmdbApiKeyEnc) {
    if (!safeStorage.isEncryptionAvailable()) return '';
    try {
      tmdbApiKeyCache = safeStorage.decryptString(Buffer.from(global.tmdbApiKeyEnc, 'base64'));
    } catch {
      // Encrypted by another Windows account: unreadable here.
      tmdbApiKeyCache = '';
    }
    return tmdbApiKeyCache;
  }
  const plain = global.tmdbApiKey || '';
  if (plain && safeStorage.isEncryptionAvailable()) await writeTmdbApiKey(plain);
  tmdbApiKeyCache = plain;
  return plain;
}

async function loadMergedSettings() {
  const profile = currentProfileId
    ? await readJson(profileSettingsFile(currentProfileId), DEFAULT_PROFILE_SETTINGS)
    : DEFAULT_PROFILE_SETTINGS;
  return { ...DEFAULT_PROFILE_SETTINGS, ...profile, tmdbApiKey: await readTmdbApiKey() };
}

async function buildFullBackupPayload(profileId) {
  const [movies, trash, settings, subscriptions, subscriptionHistory, shareListsRaw, profilesData] = await Promise.all([
    readJson(moviesFile(profileId), []),
    readJson(trashFile(profileId), []),
    readJson(profileSettingsFile(profileId), DEFAULT_PROFILE_SETTINGS),
    readJson(subscriptionsFile(profileId), []),
    readJson(subscriptionHistoryFile(profileId), []),
    readJson(shareListsFile(profileId), []),
    readJson(profilesFile, { profiles: [] }),
  ]);

  const shareLists = await Promise.all(shareListsRaw.map(async (entry) => {
    let imageData = null;
    try {
      const buf = await fs.readFile(path.join(shareImagesDir(profileId), entry.imageFile));
      imageData = buf.toString('base64');
    } catch {
      // image missing on disk, skip embedding it but keep the record
    }
    return { ...entry, imageData };
  }));

  const profileRecord = profilesData.profiles.find((p) => p.id === profileId);
  let avatar = null;
  if (profileRecord && profileRecord.avatarFile) {
    try {
      const buf = await fs.readFile(path.join(profileDir(profileId), profileRecord.avatarFile));
      avatar = { file: profileRecord.avatarFile, data: buf.toString('base64') };
    } catch {
      // avatar missing on disk, skip
    }
  }

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    movies,
    trash,
    settings,
    subscriptions,
    subscriptionHistory,
    shareLists,
    profileAppearance: {
      color: profileRecord ? profileRecord.color : null,
      initial: profileRecord ? profileRecord.initial : null,
      avatar,
    },
  };
}

async function applyFullBackupPayload(profileId, payload) {
  const counts = { movies: 0, trash: 0, subscriptions: 0, subscriptionHistory: 0, shareLists: 0 };

  if (Array.isArray(payload.movies)) {
    // A deliberate replacement: nothing to merge with what was there.
    await writeJson(moviesFile(profileId), payload.movies);
    syncBase.set(moviesFile(profileId), payload.movies);
    counts.movies = payload.movies.length;
  }
  if (Array.isArray(payload.trash)) {
    await writeJson(trashFile(profileId), payload.trash);
    syncBase.set(trashFile(profileId), payload.trash);
    counts.trash = payload.trash.length;
  }
  if (payload.settings) await writeJson(profileSettingsFile(profileId), payload.settings);
  if (Array.isArray(payload.subscriptions)) {
    const cleanSubscriptions = payload.subscriptions
      .filter((s) => s && typeof s.platform === 'string')
      .map((s) => ({
        platform: s.platform,
        price: typeof s.price === 'number' && Number.isFinite(s.price) ? s.price : null,
        active: !!s.active && typeof s.startDate === 'string' && !!s.startDate,
        startDate: typeof s.startDate === 'string' ? s.startDate : null,
        cycleDays: Number.isFinite(s.cycleDays) && s.cycleDays > 0 ? s.cycleDays : 30,
        willRenew: s.willRenew !== false,
        historyId: typeof s.historyId === 'string' ? s.historyId : null,
      }));
    await writeJson(subscriptionsFile(profileId), cleanSubscriptions);
    counts.subscriptions = cleanSubscriptions.length;
  }
  if (Array.isArray(payload.subscriptionHistory)) {
    const cleanHistory = payload.subscriptionHistory
      .filter((h) => h && typeof h.platform === 'string' && typeof h.startDate === 'string')
      .map((h) => ({
        id: typeof h.id === 'string' ? h.id : crypto.randomUUID(),
        platform: h.platform,
        price: typeof h.price === 'number' && Number.isFinite(h.price) ? h.price : null,
        cycleDays: Number.isFinite(h.cycleDays) && h.cycleDays > 0 ? h.cycleDays : 30,
        startDate: h.startDate,
        cancelledAt: typeof h.cancelledAt === 'string' ? h.cancelledAt : null,
      }));
    await writeJson(subscriptionHistoryFile(profileId), cleanHistory);
    counts.subscriptionHistory = cleanHistory.length;
  }

  if (Array.isArray(payload.shareLists)) {
    const dir = shareImagesDir(profileId);
    await fs.mkdir(dir, { recursive: true });
    const cleanEntries = await Promise.all(payload.shareLists.map(async (entry) => {
      const { imageData, imageFile, ...rest } = entry;
      if (!imageData) return { ...rest, imageFile: null };
      const safeFile = `list-${crypto.randomUUID()}.png`;
      await fs.writeFile(path.join(dir, safeFile), Buffer.from(imageData, 'base64'));
      return { ...rest, imageFile: safeFile };
    }));
    await writeJson(shareListsFile(profileId), cleanEntries);
    counts.shareLists = cleanEntries.length;
  }

  if (payload.profileAppearance) {
    const profilesData = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
    const profileRecord = profilesData.profiles.find((p) => p.id === profileId);
    if (profileRecord) {
      const { color, initial, avatar } = payload.profileAppearance;
      if (isValidProfileColor(color)) profileRecord.color = color;
      if (initial !== undefined) profileRecord.initial = sanitizeProfileInitial(initial);
      if (avatar && avatar.data) {
        const ext = path.extname(String(avatar.file || '')).toLowerCase();
        const safeExt = ALLOWED_AVATAR_EXTENSIONS.has(ext) ? ext : '.png';
        const safeFile = `avatar${safeExt}`;
        await fs.writeFile(path.join(profileDir(profileId), safeFile), Buffer.from(avatar.data, 'base64'));
        profileRecord.avatarFile = safeFile;
      }
      await writeJson(profilesFile, profilesData);
    }
  }

  return counts;
}

async function runAutoBackup() {
  if (!currentProfileId) return;
  const settings = await loadMergedSettings();
  if (!settings.autoBackupEnabled) return;
  const retentionDays = Number(settings.autoBackupRetentionDays) || 14;
  const today = todayLocalDateString();
  const dir = backupsDir(currentProfileId);
  const todayFile = path.join(dir, `backup-${today}.json`);
  try {
    await fs.access(todayFile);
  } catch {
    const payload = await buildFullBackupPayload(currentProfileId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(todayFile, JSON.stringify(payload, null, 2), 'utf-8');
  }
  try {
    const files = await fs.readdir(dir);
    const cutoff = Date.now() - retentionDays * 86400000;
    for (const f of files) {
      const match = f.match(/^backup-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      const fileDate = new Date(match[1]).getTime();
      if (fileDate < cutoff) {
        await fs.unlink(path.join(dir, f)).catch(() => {});
      }
    }
  } catch {
    // backups dir doesn't exist yet, nothing to purge
  }
}

async function purgeOldDeletedProfiles() {
  const deleted = await readJson(deletedProfilesFile, []);
  const cutoff = Date.now() - DELETED_PROFILE_RETENTION_DAYS * 86400000;
  const keep = [];
  for (const p of deleted) {
    if (new Date(p.deletedAt).getTime() > cutoff) {
      keep.push(p);
    } else {
      await fs.rm(deletedProfileDir(p.id), { recursive: true, force: true }).catch(() => {});
    }
  }
  if (keep.length !== deleted.length) await writeJson(deletedProfilesFile, keep);
}

async function migrateLegacyDataIfNeeded() {
  const existing = await readJson(profilesFile, null);
  if (existing) return;

  const legacyMoviesFile = path.join(dataDir, 'movies.json');
  const hasLegacy = await fs.access(legacyMoviesFile).then(() => true).catch(() => false);
  if (!hasLegacy) {
    await writeJson(profilesFile, { profiles: [], lastActiveProfileId: null });
    return;
  }

  const legacyTrashFile = path.join(dataDir, 'trash.json');
  const legacySettingsFile = path.join(dataDir, 'settings.json');
  const legacyBackupsDir = path.join(dataDir, 'backups');

  const id = crypto.randomUUID();
  await fs.mkdir(profileDir(id), { recursive: true });

  const legacyMovies = await readJson(legacyMoviesFile, []);
  const legacyTrash = await readJson(legacyTrashFile, []);
  const legacySettings = await readJson(legacySettingsFile, {});

  await writeJson(moviesFile(id), legacyMovies);
  await writeJson(trashFile(id), legacyTrash);

  const { tmdbApiKey, ...rest } = legacySettings;
  await writeJson(globalSettingsFile, { tmdbApiKey: tmdbApiKey || '' });
  await writeJson(profileSettingsFile(id), { ...DEFAULT_PROFILE_SETTINGS, ...rest });

  try {
    await fs.rename(legacyBackupsDir, backupsDir(id));
  } catch {
    // no legacy backups dir
  }

  await writeJson(profilesFile, {
    profiles: [{ id, name: 'Mi perfil', color: 'series-1', createdAt: new Date().toISOString() }],
    lastActiveProfileId: id,
  });

  await fs.rename(legacyMoviesFile, `${legacyMoviesFile}.bak`).catch(() => {});
  await fs.rename(legacyTrashFile, `${legacyTrashFile}.bak`).catch(() => {});
  await fs.rename(legacySettingsFile, `${legacySettingsFile}.bak`).catch(() => {});
}

// End-to-end tests (e2e/) set PELICULAS_E2E=1: notifications are printed
// to stdout (as "[notify] {json}") for the test to check, instead of popping
// up on the desktop. PELICULAS_TMDB_API_URL points TMDB at a local fake.
const E2E_MODE = process.env.PELICULAS_E2E === '1';

// In test mode the page gets window.e2e.closeWindow() (see preload.js): the
// same close as clicking the window's X, which window.close() from the page
// skips.
if (E2E_MODE) {
  ipcMain.handle('e2e:closeWindow', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
}

// Shows a system notification; `onClick` runs when it's clicked.
function showNotification({ title, body, onClick, target }) {
  if (E2E_MODE) {
    process.stdout.write(`[notify] ${JSON.stringify({ title, body, target: target || null })}\n`);
    return true;
  }
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body, icon: appIconPath('png') });
  if (onClick) notification.on('click', onClick);
  notification.show();
  return true;
}

let mainWindow = null;
let tray = null;
// Set when the app really has to exit (tray "Salir", installing an update,
// Windows shutting down): closing the window then quits instead of hiding it.
let isQuitting = false;
// Started by Windows at login (see applyOpenAtLogin): stay in the tray.
const startedHidden = process.argv.includes('--hidden');
let hiddenStartPending = startedHidden;

function appIconPath(ext) {
  return path.join(__dirname, 'build', `icon.${ext}`);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ show: true });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(appIconPath(process.platform === 'win32' ? 'ico' : 'png')));
  tray.setToolTip('Películas y Series');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Películas y Series', click: showMainWindow },
    {
      label: 'Buscar novedades ahora',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:checkNow');
      },
    },
    { type: 'separator' },
    { label: 'Salir', click: quitApp },
  ]));
  tray.on('click', showMainWindow);
}

// Mirrors global-settings.json's closeToTray: the window's close event has to
// decide synchronously whether to cancel the close.
let closeToTrayCache = DEFAULT_GLOBAL_SETTINGS.closeToTray;

// Closing the window keeps the app running in the tray (so the checks for
// new episodes, seasons and availability go on) unless that's turned off.
// The first time, a notification explains where it went.
async function hideToTray(win) {
  win.hide();
  const settings = await readGlobalSettings().catch(() => DEFAULT_GLOBAL_SETTINGS);
  if (!settings.trayHintShown) {
    showNotification({
      title: 'Películas y Series sigue abierta',
      body: 'Sigue buscando novedades desde la bandeja del sistema (junto al reloj). Para cerrarla del todo: clic derecho en su icono → Salir. Puedes cambiarlo en Ajustes.',
      onClick: showMainWindow,
    });
    await updateGlobalSettings({ trayHintShown: true });
  }
}

function createWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    show: false,
    icon: appIconPath('png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: E2E_MODE ? ['--e2e'] : [],
    },
  });
  mainWindow = win;
  // Nothing may open or navigate inside the app window: web links go to the
  // system browser and anything else is simply dropped.
  const openIfWebLink = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openIfWebLink(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    openIfWebLink(url);
  });
  win.once('ready-to-show', () => {
    if (!show) return;
    win.show();
    win.focus();
  });
  win.on('close', (event) => {
    if (isQuitting || !closeToTrayCache) return;
    event.preventDefault();
    hideToTray(win);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function sendUpdaterStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status);
  }
}

function normalizeReleaseNotes(notes) {
  if (!notes) return null;
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    const joined = notes
      .map((n) => (n && n.version ? `${n.version}\n${n.note || ''}` : (n && n.note) || ''))
      .filter(Boolean)
      .join('\n\n');
    return joined || null;
  }
  return null;
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => sendUpdaterStatus({
  state: 'available',
  version: info.version,
  releaseNotes: normalizeReleaseNotes(info.releaseNotes),
}));
autoUpdater.on('update-downloaded', (info) => sendUpdaterStatus({
  state: 'downloaded',
  version: info.version,
  releaseNotes: normalizeReleaseNotes(info.releaseNotes),
}));
autoUpdater.on('error', (err) => sendUpdaterStatus({ state: 'error', message: err.message }));

// Windows only shows toast notifications for an app with an AppUserModelID;
// it has to match the installer's appId (package.json build.appId).
if (process.platform === 'win32') app.setAppUserModelId('com.raul.peliculasyseries');

// Starting the app again (shortcut, Start menu) while it's in the tray just
// brings the existing window back.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
}

// Only the installed/portable app registers itself (a dev build would
// register electron.exe). The portable version must point at its own .exe,
// not at the temporary folder it unpacks itself into.
function applyOpenAtLogin(openAtLogin) {
  if (!app.isPackaged) return;
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin, path: exePath, args: ['--hidden'] });
}

app.on('before-quit', () => { isQuitting = true; });

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  await migrateLegacyDataIfNeeded();
  await purgeOldDeletedProfiles();
  closeToTrayCache = (await readGlobalSettings()).closeToTray;
  createTray();
  createWindow({ show: !startedHidden });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
    // The app can now stay in the tray for days.
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), UPDATE_CHECK_INTERVAL_MS);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:getBackgroundSettings', async () => {
  const settings = await readGlobalSettings();
  return { closeToTray: settings.closeToTray, openAtLogin: settings.openAtLogin, canOpenAtLogin: app.isPackaged };
});

ipcMain.handle('app:setBackgroundSettings', async (_event, patch) => {
  const clean = {};
  if (typeof patch.closeToTray === 'boolean') clean.closeToTray = patch.closeToTray;
  if (typeof patch.openAtLogin === 'boolean') clean.openAtLogin = patch.openAtLogin;
  const settings = await updateGlobalSettings(clean);
  closeToTrayCache = settings.closeToTray;
  if ('openAtLogin' in clean) applyOpenAtLogin(clean.openAtLogin);
  return { closeToTray: settings.closeToTray, openAtLogin: settings.openAtLogin, canOpenAtLogin: app.isPackaged };
});

// True only for the first page load of a start at Windows login, so the
// renderer skips "¿Quién ve ahora?" and uses the last profile in the
// background (later reloads, e.g. switching profile, ask as usual).
ipcMain.handle('app:consumeHiddenStart', () => {
  const value = hiddenStartPending;
  hiddenStartPending = false;
  return value;
});

function buildAvatarUrl(dir, avatarFile) {
  if (!avatarFile) return null;
  return `file://${path.join(dir, avatarFile).replace(/\\/g, '/')}?t=${Date.now()}`;
}

function withAvatarUrl(profile) {
  return { ...profile, avatarUrl: buildAvatarUrl(profileDir(profile.id), profile.avatarFile) };
}

ipcMain.handle('profiles:list', async () => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  return { ...data, profiles: data.profiles.map(withAvatarUrl) };
});

ipcMain.handle('profiles:create', async (_event, name, color, initial) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const id = crypto.randomUUID();
  const profile = {
    id,
    name: (name || '').trim() || 'Perfil',
    color: isValidProfileColor(color) ? color : 'series-1',
    initial: sanitizeProfileInitial(initial),
    avatarFile: null,
    createdAt: new Date().toISOString(),
  };
  data.profiles.push(profile);
  await writeJson(profilesFile, data);
  await fs.mkdir(profileDir(id), { recursive: true });
  return withAvatarUrl(profile);
});

ipcMain.handle('profiles:update', async (_event, id, updates) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const profile = data.profiles.find((p) => p.id === id);
  if (!profile) return { error: 'NOT_FOUND' };
  if (updates.name !== undefined) profile.name = (updates.name || '').trim() || profile.name;
  if (updates.color !== undefined && isValidProfileColor(updates.color)) profile.color = updates.color;
  if (updates.initial !== undefined) profile.initial = sanitizeProfileInitial(updates.initial);
  await writeJson(profilesFile, data);
  return { ok: true, profile: withAvatarUrl(profile) };
});

ipcMain.handle('profiles:pickAvatar', async (_event, id) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Elegir foto de perfil',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };

  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const profile = data.profiles.find((p) => p.id === id);
  if (!profile) return { canceled: false, error: 'NOT_FOUND' };

  if (profile.avatarFile) {
    await fs.unlink(path.join(profileDir(id), profile.avatarFile)).catch(() => {});
  }
  const ext = path.extname(filePaths[0]).toLowerCase() || '.png';
  const avatarFile = `avatar${ext}`;
  await fs.mkdir(profileDir(id), { recursive: true });
  await fs.copyFile(filePaths[0], path.join(profileDir(id), avatarFile));
  profile.avatarFile = avatarFile;
  await writeJson(profilesFile, data);

  return { canceled: false, ok: true, profile: withAvatarUrl(profile) };
});

ipcMain.handle('profiles:clearAvatar', async (_event, id) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const profile = data.profiles.find((p) => p.id === id);
  if (!profile) return { error: 'NOT_FOUND' };
  if (profile.avatarFile) {
    await fs.unlink(path.join(profileDir(id), profile.avatarFile)).catch(() => {});
    profile.avatarFile = null;
  }
  await writeJson(profilesFile, data);
  return { ok: true, profile: withAvatarUrl(profile) };
});

ipcMain.handle('profiles:delete', async (_event, id) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  if (data.profiles.length <= 1) return { error: 'LAST_PROFILE' };
  const idx = data.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return { error: 'NOT_FOUND' };
  const [profile] = data.profiles.splice(idx, 1);
  const wasActive = data.lastActiveProfileId === id;
  if (wasActive) data.lastActiveProfileId = null;
  await writeJson(profilesFile, data);

  await fs.mkdir(path.join(dataDir, 'deleted-profiles'), { recursive: true });
  await fs.rename(profileDir(id), deletedProfileDir(id)).catch(() => {});
  const deleted = await readJson(deletedProfilesFile, []);
  deleted.push({ ...profile, deletedAt: new Date().toISOString() });
  await writeJson(deletedProfilesFile, deleted);

  if (currentProfileId === id) currentProfileId = null;
  return { ok: true, wasActive };
});

ipcMain.handle('profiles:listDeleted', async () => {
  const deleted = await readJson(deletedProfilesFile, []);
  return deleted.map((p) => ({ ...p, avatarUrl: buildAvatarUrl(deletedProfileDir(p.id), p.avatarFile) }));
});

ipcMain.handle('profiles:restore', async (_event, id) => {
  const deleted = await readJson(deletedProfilesFile, []);
  const idx = deleted.findIndex((p) => p.id === id);
  if (idx === -1) return { error: 'NOT_FOUND' };
  const [profile] = deleted.splice(idx, 1);
  await writeJson(deletedProfilesFile, deleted);

  await fs.mkdir(path.join(dataDir, 'profiles'), { recursive: true });
  await fs.rename(deletedProfileDir(id), profileDir(id)).catch(() => fs.mkdir(profileDir(id), { recursive: true }));

  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const restored = {
    id: profile.id,
    name: profile.name,
    color: profile.color,
    initial: profile.initial || null,
    avatarFile: profile.avatarFile || null,
    createdAt: profile.createdAt || new Date().toISOString(),
  };
  data.profiles.push(restored);
  await writeJson(profilesFile, data);
  return { ok: true, profile: withAvatarUrl(restored) };
});

ipcMain.handle('profiles:purgeDeleted', async (_event, id) => {
  const deleted = await readJson(deletedProfilesFile, []);
  const idx = deleted.findIndex((p) => p.id === id);
  if (idx === -1) return { error: 'NOT_FOUND' };
  deleted.splice(idx, 1);
  await writeJson(deletedProfilesFile, deleted);
  await fs.rm(deletedProfileDir(id), { recursive: true, force: true });
  return { ok: true };
});

ipcMain.handle('profiles:setActive', async (_event, id) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  if (!data.profiles.some((p) => p.id === id)) return { error: 'NOT_FOUND' };
  currentProfileId = id;
  data.lastActiveProfileId = id;
  await writeJson(profilesFile, data);
  await runAutoBackup();
  return { ok: true };
});

/* ---------- Lists shared between computers ---------- */

// The titles and the trash may be changed on disk by another computer that
// shares the data folder. `syncBase` keeps, per file, the version this app
// last read or wrote; saving over a file that no longer matches it merges
// both sides (lib/sync-merge.js) instead of overwriting the other's changes.
const syncBase = new Map();
// Saves of one file run one after the other, so each sees the last's result.
const syncQueue = new Map();
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function readSyncedList(file) {
  const list = await readJson(file, []);
  syncBase.set(file, list);
  return list;
}

// Returns the merged list when another computer's changes were merged in
// (the renderer then shows that), null otherwise.
function saveSyncedList(file, list) {
  const run = async () => {
    let result = list;
    let merged = false;
    const base = syncBase.get(file);
    if (base) {
      // Unreadable (half-synced) file: just save over it.
      const onDisk = await readJson(file, null).catch(() => null);
      if (Array.isArray(onDisk) && !sameJson(onDisk, base)) {
        result = mergeById(base, list, onDisk);
        merged = !sameJson(result, list);
      }
    }
    await writeJson(file, result);
    syncBase.set(file, result);
    return merged ? result : null;
  };
  const next = (syncQueue.get(file) || Promise.resolve()).then(run, run);
  syncQueue.set(file, next.catch(() => {}));
  return next;
}

// What another computer saved since this app last read or wrote the file:
// the new list, or null when nothing changed.
async function readSyncedListIfChanged(file) {
  await syncQueue.get(file);
  const base = syncBase.get(file);
  const onDisk = await readJson(file, null).catch(() => null);
  if (!base || !Array.isArray(onDisk) || sameJson(onDisk, base)) return null;
  syncBase.set(file, onDisk);
  return onDisk;
}

ipcMain.handle('movies:load', async () => readSyncedList(moviesFile(currentProfileId)));

ipcMain.handle('movies:save', async (_event, movies) => saveSyncedList(moviesFile(currentProfileId), movies));

ipcMain.handle('trash:load', async () => readSyncedList(trashFile(currentProfileId)));

ipcMain.handle('trash:save', async (_event, trash) => saveSyncedList(trashFile(currentProfileId), trash));

ipcMain.handle('data:reloadIfChanged', async () => {
  if (!currentProfileId) return { movies: null, trash: null };
  return {
    movies: await readSyncedListIfChanged(moviesFile(currentProfileId)),
    trash: await readSyncedListIfChanged(trashFile(currentProfileId)),
  };
});

ipcMain.handle('settings:load', async () => {
  return loadMergedSettings();
});

ipcMain.handle('settings:save', async (_event, settings) => {
  const { tmdbApiKey, ...rest } = settings;
  if ((tmdbApiKey || '') !== await readTmdbApiKey()) await writeTmdbApiKey(tmdbApiKey);
  if (currentProfileId) await writeJson(profileSettingsFile(currentProfileId), rest);
  return true;
});

/* ---------- TMDB ---------- */

const tmdb = createTmdbApi(fetch, process.env.PELICULAS_TMDB_API_URL ? { baseUrl: process.env.PELICULAS_TMDB_API_URL } : {});

// Registers a tmdb:* IPC handler with the boilerplate every one of them
// shares: read the key/language/region from settings, bail out without a key,
// and turn a thrown fetch (offline, or the request timing out) into
// NETWORK_ERROR. `noKeyResult` is what to return when there's no key
// (defaults to the NO_API_KEY error).
function handleTmdb(channel, handler, { noKeyResult = { error: 'NO_API_KEY' } } = {}) {
  ipcMain.handle(channel, async (_event, ...args) => {
    const settings = await loadMergedSettings();
    const ctx = {
      apiKey: settings.tmdbApiKey,
      language: settings.language || 'es-ES',
      region: settings.region || 'ES',
    };
    if (!ctx.apiKey) return noKeyResult;
    try {
      return await handler(ctx, ...args);
    } catch (err) {
      return { error: 'NETWORK_ERROR', message: err.message };
    }
  });
}

handleTmdb('tmdb:search', tmdb.search);
handleTmdb('tmdb:details', tmdb.details);
handleTmdb('tmdb:collection', tmdb.collection);
handleTmdb('tmdb:providers', tmdb.providers);
handleTmdb('tmdb:openTrailer', async (ctx, tmdbId, mediaType) => {
  const res = await tmdb.trailerUrl(ctx, tmdbId, mediaType);
  if (!res.url) return res;
  await shell.openExternal(res.url);
  return { opened: true };
});
handleTmdb('tmdb:recommendations', tmdb.recommendations);
handleTmdb('tmdb:trending', tmdb.trending);
handleTmdb('tmdb:providerLogos', tmdb.providerLogos);
handleTmdb('tmdb:discoverByProviders', tmdb.discoverByProviders, { noKeyResult: { movies: [], tv: [] } });

ipcMain.handle('shareLists:list', async () => {
  const lists = await readJson(shareListsFile(currentProfileId), []);
  return lists.map((l) => ({ ...l, imageUrl: `file://${path.join(shareImagesDir(currentProfileId), l.imageFile).replace(/\\/g, '/')}` }));
});

ipcMain.handle('shareLists:save', async (_event, { title, options, items, imageDataUrl }) => {
  const id = crypto.randomUUID();
  const imageFile = `list-${id}.png`;
  const dir = shareImagesDir(currentProfileId);
  await fs.mkdir(dir, { recursive: true });
  const base64 = imageDataUrl.replace(/^data:image\/png;base64,/, '');
  await fs.writeFile(path.join(dir, imageFile), Buffer.from(base64, 'base64'));

  const lists = await readJson(shareListsFile(currentProfileId), []);
  const entry = { id, title, options, items, imageFile, createdAt: new Date().toISOString() };
  lists.unshift(entry);
  await writeJson(shareListsFile(currentProfileId), lists);
  return { ...entry, imageUrl: `file://${path.join(dir, imageFile).replace(/\\/g, '/')}` };
});

ipcMain.handle('shareLists:delete', async (_event, id) => {
  const lists = await readJson(shareListsFile(currentProfileId), []);
  const idx = lists.findIndex((l) => l.id === id);
  if (idx === -1) return { error: 'NOT_FOUND' };
  const [entry] = lists.splice(idx, 1);
  await writeJson(shareListsFile(currentProfileId), lists);
  await fs.unlink(path.join(shareImagesDir(currentProfileId), entry.imageFile)).catch(() => {});
  return { ok: true };
});

ipcMain.handle('shareLists:openImage', async (_event, id) => {
  const lists = await readJson(shareListsFile(currentProfileId), []);
  const entry = lists.find((l) => l.id === id);
  if (!entry) return { error: 'NOT_FOUND' };
  await shell.openPath(path.join(shareImagesDir(currentProfileId), entry.imageFile));
  return { ok: true };
});

function defaultSubscriptionEntry(platform) {
  return { platform, price: null, active: false, startDate: null, cycleDays: 30, willRenew: true, historyId: null };
}

ipcMain.handle('subscriptions:list', async () => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);
  let dirty = false;
  let historyDirty = false;
  for (const s of list) {
    if (reconcileSubscriptionEntry(s, history)) { dirty = true; historyDirty = true; }
  }
  if (historyDirty) await writeJson(subscriptionHistoryFile(currentProfileId), history);
  if (dirty) await writeJson(subscriptionsFile(currentProfileId), list);
  return list;
});

// Price, cycle and start date are all editable at any time (active or not), so the
// linked in-progress history entry is kept in sync with whichever of those fields
// changes: e.g. correcting a price you forgot to set at activation still counts
// towards "Historial de gasto", and switching monthly -> annual updates the
// "renews on" projection, instead of freezing those at whatever they were at
// activation time.
ipcMain.handle('subscriptions:upsert', async (_event, platform, updates) => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  let entry = list.find((s) => s.platform === platform);
  if (!entry) {
    entry = defaultSubscriptionEntry(platform);
    list.push(entry);
  }
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);

  const touchesDateOrCycle = Object.prototype.hasOwnProperty.call(updates, 'startDate')
    || Object.prototype.hasOwnProperty.call(updates, 'cycleDays');
  if (touchesDateOrCycle && entry.active) {
    const prospectiveStart = updates.startDate !== undefined ? updates.startDate : entry.startDate;
    const prospectiveCycle = updates.cycleDays !== undefined ? updates.cycleDays : (entry.cycleDays || 30);
    if (prospectiveStart) {
      const conflict = findOverlappingHistoryEntry(history, platform, prospectiveStart, prospectiveCycle, entry.historyId);
      if (conflict) return { error: 'OVERLAPS_EXISTING', conflict, subscriptions: list, history };
    }
  }

  Object.assign(entry, updates);
  if (entry.historyId) {
    const historyEntry = history.find((h) => h.id === entry.historyId);
    if (historyEntry) {
      if (Object.prototype.hasOwnProperty.call(updates, 'price')) historyEntry.price = entry.price;
      if (Object.prototype.hasOwnProperty.call(updates, 'cycleDays')) historyEntry.cycleDays = entry.cycleDays;
      if (Object.prototype.hasOwnProperty.call(updates, 'startDate')) historyEntry.startDate = entry.startDate;
    }
  }
  // If editing pushed the start date (or shortened the cycle) far enough into the
  // past that one or more cycles have now elapsed, catch up immediately rather
  // than waiting for the next reload.
  reconcileSubscriptionEntry(entry, history);

  await writeJson(subscriptionHistoryFile(currentProfileId), history);
  await writeJson(subscriptionsFile(currentProfileId), list);
  return { subscriptions: list, history };
});

// Activating starts a brand new billing period: it opens a fresh history entry
// (visible immediately, before any cancellation) rather than only recording history
// once you cancel.
ipcMain.handle('subscriptions:activate', async (_event, platform, startDate, cycleDays) => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  let entry = list.find((s) => s.platform === platform);
  if (!entry) {
    entry = defaultSubscriptionEntry(platform);
    list.push(entry);
  }
  const resolvedCycle = cycleDays || entry.cycleDays || 30;
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);

  const conflict = findOverlappingHistoryEntry(history, platform, startDate, resolvedCycle, entry.historyId);
  if (conflict) return { error: 'OVERLAPS_EXISTING', conflict, subscriptions: list, history };

  const historyEntry = {
    id: crypto.randomUUID(),
    platform,
    price: entry.price,
    cycleDays: resolvedCycle,
    startDate,
    cancelledAt: null,
  };
  history.unshift(historyEntry);

  entry.active = true;
  entry.startDate = startDate;
  entry.cycleDays = resolvedCycle;
  entry.willRenew = true;
  entry.historyId = historyEntry.id;

  // If the chosen start date is already more than one cycle in the past (e.g.
  // backdating the activation to when you actually subscribed in real life),
  // catch up immediately on the cycles that have already elapsed instead of
  // showing a stale "renueva hoy" with only the one history entry.
  reconcileSubscriptionEntry(entry, history);

  await writeJson(subscriptionHistoryFile(currentProfileId), history);
  await writeJson(subscriptionsFile(currentProfileId), list);

  return { subscriptions: list, history };
});

// "Cancelar" stops the next renewal but does not cut off access you already paid
// for: it just flags willRenew=false, the countdown keeps running until the
// billing cycle you're already in actually ends (subscriptions:list handles that
// automatic expiry). No cost proration happens anywhere in this flow.
ipcMain.handle('subscriptions:cancel', async (_event, platform) => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  const entry = list.find((s) => s.platform === platform);
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);
  if (entry && entry.active) {
    entry.willRenew = false;
    const historyEntry = entry.historyId ? history.find((h) => h.id === entry.historyId) : null;
    if (historyEntry && !historyEntry.cancelledAt) {
      historyEntry.cancelledAt = todayLocalDateString();
      await writeJson(subscriptionHistoryFile(currentProfileId), history);
    }
    await writeJson(subscriptionsFile(currentProfileId), list);
  }
  return { subscriptions: list, history };
});

ipcMain.handle('subscriptions:renew', async (_event, platform) => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  const entry = list.find((s) => s.platform === platform);
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);
  if (entry && entry.active) {
    entry.willRenew = true;
    const historyEntry = entry.historyId ? history.find((h) => h.id === entry.historyId) : null;
    if (historyEntry && historyEntry.cancelledAt) {
      historyEntry.cancelledAt = null;
      await writeJson(subscriptionHistoryFile(currentProfileId), history);
    }
    await writeJson(subscriptionsFile(currentProfileId), list);
  }
  return { subscriptions: list, history };
});

ipcMain.handle('subscriptions:historyList', async () => {
  return readJson(subscriptionHistoryFile(currentProfileId), []);
});

ipcMain.handle('subscriptions:historyDelete', async (_event, id) => {
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);
  const filtered = history.filter((h) => h.id !== id);
  await writeJson(subscriptionHistoryFile(currentProfileId), filtered);

  const list = await readJson(subscriptionsFile(currentProfileId), []);
  const linked = list.find((s) => s.historyId === id);
  if (linked) {
    linked.active = false;
    linked.startDate = null;
    linked.willRenew = true;
    linked.historyId = null;
    await writeJson(subscriptionsFile(currentProfileId), list);
  }
  return { subscriptions: list, history: filtered };
});

ipcMain.handle('data:export', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar copia de seguridad',
    defaultPath: `peliculas-backup-${todayLocalDateString()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const payload = await buildFullBackupPayload(currentProfileId);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { canceled: false, filePath };
});

ipcMain.handle('data:import', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importar copia de seguridad',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  try {
    const raw = await fs.readFile(filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    const payload = Array.isArray(parsed) ? { movies: parsed } : parsed;
    if (!Array.isArray(payload.movies)) return { canceled: false, error: 'INVALID_FILE' };
    return { canceled: false, payload };
  } catch (err) {
    return { canceled: false, error: 'INVALID_FILE' };
  }
});

ipcMain.handle('data:applyImport', async (_event, payload) => {
  try {
    const counts = await applyFullBackupPayload(currentProfileId, payload);
    return { ok: true, counts };
  } catch (err) {
    return { error: 'APPLY_FAILED', message: err.message };
  }
});

ipcMain.handle('data:saveCalendar', async (_event, icsText) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar al calendario',
    defaultPath: `estrenos-peliculas-y-series-${todayLocalDateString()}.ics`,
    filters: [{ name: 'Calendario (iCalendar)', extensions: ['ics'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await fs.writeFile(filePath, String(icsText), 'utf-8');
    return { canceled: false, filePath };
  } catch (err) {
    return { canceled: false, error: 'WRITE_FAILED' };
  }
});

ipcMain.handle('data:pickCsv', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importar historial de visionado',
    filters: [{ name: 'Historial (CSV o JSON de Trakt)', extensions: ['csv', 'txt', 'json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  try {
    const raw = await fs.readFile(filePaths[0], 'utf-8');
    const text = raw.replace(/^﻿/, '');
    return { canceled: false, text, fileName: path.basename(filePaths[0]) };
  } catch (err) {
    return { canceled: false, error: 'READ_FAILED' };
  }
});

ipcMain.handle('app:openDataFolder', async () => {
  await shell.openPath(currentProfileId ? profileDir(currentProfileId) : dataDir);
  return true;
});

/* ---------- Data folder (Ajustes → Carpeta de datos) ---------- */

// Everything a data folder holds (localDir also has Chromium's own files and
// this computer's settings, which aren't moved).
const DATA_ENTRIES = ['profiles.json', 'deleted-profiles.json', 'profiles', 'deleted-profiles'];
const DATA_SUBFOLDER = 'Peliculas y Series';

function dataLocationInfo() {
  return { dir: dataDir, shared: dataDir !== localDir, missing: missingDataDir };
}

const isInsideOrSame = (child, parent) => {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

// The folder picked is used as is when it already holds the app's data
// (picked on a second computer); otherwise the data goes in a "Peliculas y
// Series" folder inside it, which another computer may have filled already.
function inspectDataLocation(picked) {
  const base = path.resolve(String(picked || ''));
  const dir = fsSync.existsSync(path.join(base, 'profiles.json')) ? base : path.join(base, DATA_SUBFOLDER);
  if (isInsideOrSame(dir, localDir) || isInsideOrSame(localDir, dir)) return { error: 'APP_FOLDER' };
  if (path.relative(dataDir, dir) === '') return { error: 'SAME' };
  return { picked: base, dir, hasData: fsSync.existsSync(path.join(dir, 'profiles.json')) };
}

async function copyDataTo(target) {
  await fs.mkdir(target, { recursive: true });
  for (const entry of DATA_ENTRIES) {
    const from = path.join(dataDir, entry);
    if (fsSync.existsSync(from)) await fs.cp(from, path.join(target, entry), { recursive: true, force: true });
  }
}

// Before bringing the data back into localDir, keeps the copy that was there
// from before in a "datos-anteriores-..." folder instead of mixing them.
async function setAsideData(dir) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const aside = path.join(dir, `datos-anteriores-${stamp}`);
  for (const entry of DATA_ENTRIES) {
    const from = path.join(dir, entry);
    if (!fsSync.existsSync(from)) continue;
    await fs.mkdir(aside, { recursive: true });
    await fs.rename(from, path.join(aside, entry));
  }
}

// Switches without restarting; the renderer reloads the page afterwards.
async function switchDataDir(dir) {
  syncBase.clear();
  useDataDir(dir);
  missingDataDir = null;
  await migrateLegacyDataIfNeeded();
  const data = await readJson(profilesFile, { profiles: [] });
  if (!data.profiles.some((p) => p.id === currentProfileId)) currentProfileId = null;
}

ipcMain.handle('data:getLocation', () => dataLocationInfo());

ipcMain.handle('data:pickLocation', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Elige dónde guardar tus datos (por ejemplo, en OneDrive)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths.length) return null;
  return inspectDataLocation(filePaths[0]);
});

ipcMain.handle('data:inspectLocation', (_event, picked) => inspectDataLocation(picked));

// mode 'copy': this computer's data goes to a folder with none yet.
// mode 'use': the folder already has data (from another computer) and this
// one starts using it; its own data stays where it was.
ipcMain.handle('data:setLocation', async (_event, picked, mode) => {
  const info = inspectDataLocation(picked);
  if (info.error) return info;
  if (mode !== (info.hasData ? 'use' : 'copy')) return { error: 'MODE' };
  if (mode === 'copy') await copyDataTo(info.dir);
  await writeJson(dataLocationFile, { dir: info.dir });
  await switchDataDir(info.dir);
  return { ok: true, ...dataLocationInfo() };
});

// Back to keeping the data only on this computer, with what the shared
// folder has now (the shared folder itself is left as is).
ipcMain.handle('data:resetLocation', async () => {
  if (dataDir !== localDir) {
    await setAsideData(localDir);
    await copyDataTo(localDir);
  }
  await fs.rm(dataLocationFile, { force: true });
  await switchDataDir(localDir);
  return { ok: true, ...dataLocationInfo() };
});

ipcMain.handle('app:openBackupsFolder', async () => {
  const dir = backupsDir(currentProfileId);
  await fs.mkdir(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});

ipcMain.handle('app:runBackupNow', async () => {
  const dir = backupsDir(currentProfileId);
  await fs.mkdir(dir, { recursive: true });
  const payload = await buildFullBackupPayload(currentProfileId);
  const today = todayLocalDateString();
  const filePath = path.join(dir, `backup-${today}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { filePath };
});

ipcMain.handle('app:getVersion', () => app.getVersion());

// Notes of an installed version (release-notes/vX.Y.Z.md, packaged with the
// app), shown once after updating. Null when there are none.
ipcMain.handle('app:getReleaseNotes', async (_event, version) => {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) return null;
  return fs.readFile(path.join(__dirname, 'release-notes', `v${version}.md`), 'utf-8').catch(() => null);
});

// System notification; clicking it brings the window back and tells the
// renderer which view to open (and which title, when it's about just one).
ipcMain.handle('app:notify', (_event, title, body, view, movieId) => {
  const target = { view: view || null, movieId: movieId || null };
  return showNotification({
    title,
    body,
    target,
    onClick: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      showMainWindow();
      mainWindow.webContents.send('app:navigate', target);
    },
  });
});

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { error: 'DEV_MODE' };
  try {
    const result = await autoUpdater.checkForUpdates();
    const hasUpdate = !!(result && result.isUpdateAvailable);
    return {
      ok: true,
      version: hasUpdate ? result.updateInfo.version : null,
      releaseNotes: hasUpdate ? normalizeReleaseNotes(result.updateInfo.releaseNotes) : null,
    };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('updater:install', () => {
  // Otherwise closing the window would just hide it and the update would
  // never get installed.
  isQuitting = true;
  autoUpdater.quitAndInstall();
});
