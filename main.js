const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { todayLocalDateString } = require('./lib/date-utils');
const { findOverlappingHistoryEntry, reconcileSubscriptionEntry } = require('./lib/subscription-logic');
const { isValidProfileColor, sanitizeProfileInitial } = require('./lib/profile-utils');

const dataDir = app.getPath('userData');
const profilesFile = path.join(dataDir, 'profiles.json');
const globalSettingsFile = path.join(dataDir, 'global-settings.json');
const deletedProfilesFile = path.join(dataDir, 'deleted-profiles.json');

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

const DEFAULT_GLOBAL_SETTINGS = { tmdbApiKey: '' };
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

async function loadMergedSettings() {
  const global = await readJson(globalSettingsFile, DEFAULT_GLOBAL_SETTINGS);
  const profile = currentProfileId
    ? await readJson(profileSettingsFile(currentProfileId), DEFAULT_PROFILE_SETTINGS)
    : DEFAULT_PROFILE_SETTINGS;
  return { ...DEFAULT_PROFILE_SETTINGS, ...profile, ...DEFAULT_GLOBAL_SETTINGS, ...global };
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
    await writeJson(moviesFile(profileId), payload.movies);
    counts.movies = payload.movies.length;
  }
  if (Array.isArray(payload.trash)) {
    await writeJson(trashFile(profileId), payload.trash);
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

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
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

app.whenReady().then(async () => {
  await migrateLegacyDataIfNeeded();
  await purgeOldDeletedProfiles();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

ipcMain.handle('movies:load', async () => {
  return readJson(moviesFile(currentProfileId), []);
});

ipcMain.handle('movies:save', async (_event, movies) => {
  await writeJson(moviesFile(currentProfileId), movies);
  return true;
});

ipcMain.handle('trash:load', async () => {
  return readJson(trashFile(currentProfileId), []);
});

ipcMain.handle('trash:save', async (_event, trash) => {
  await writeJson(trashFile(currentProfileId), trash);
  return true;
});

ipcMain.handle('settings:load', async () => {
  return loadMergedSettings();
});

ipcMain.handle('settings:save', async (_event, settings) => {
  const { tmdbApiKey, ...rest } = settings;
  await writeJson(globalSettingsFile, { tmdbApiKey: tmdbApiKey || '' });
  if (currentProfileId) await writeJson(profileSettingsFile(currentProfileId), rest);
  return true;
});

/* ---------- TMDB ---------- */

const TMDB_API = 'https://api.themoviedb.org/3';

function tmdbImage(size, imagePath) {
  return imagePath ? `https://image.tmdb.org/t/p/${size}${imagePath}` : '';
}

function tmdbGet(apiKey, pathAndQuery) {
  return fetch(`${TMDB_API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${apiKey}` } });
}

// Parsed JSON of a TMDB request, or `fallback` when it doesn't come back OK.
async function tmdbJsonOr(apiKey, pathAndQuery, fallback) {
  const res = await tmdbGet(apiKey, pathAndQuery);
  return res.ok ? res.json() : fallback;
}

// Registers a tmdb:* IPC handler with the boilerplate every one of them
// shares: read the key/language/region from settings, bail out without a key,
// and turn a thrown fetch into NETWORK_ERROR. `noKeyResult` is what to return
// when there's no key (defaults to the NO_API_KEY error).
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

function mapTmdbResult(kind) {
  return (m) => {
    const date = kind === 'tv' ? m.first_air_date : m.release_date;
    return {
      tmdbId: m.id,
      mediaType: kind,
      title: kind === 'tv' ? m.name : m.title,
      year: date ? date.slice(0, 4) : '',
      poster: tmdbImage('w200', m.poster_path),
    };
  };
}

// Genre id -> name maps, per language. They practically never change, so
// they're fetched once per session instead of on every search.
const genreMapsCache = new Map();

async function getGenreMaps(apiKey, language) {
  if (genreMapsCache.has(language)) return genreMapsCache.get(language);
  const [movieRes, tvRes] = await Promise.all([
    tmdbGet(apiKey, `/genre/movie/list?language=${language}`),
    tmdbGet(apiKey, `/genre/tv/list?language=${language}`),
  ]);
  const movieGenres = movieRes.ok ? await movieRes.json() : { genres: [] };
  const tvGenres = tvRes.ok ? await tvRes.json() : { genres: [] };
  const maps = {
    movie: new Map(movieGenres.genres.map((g) => [g.id, g.name])),
    tv: new Map(tvGenres.genres.map((g) => [g.id, g.name])),
  };
  // Only keep complete results, so a failed request is retried next search.
  if (movieRes.ok && tvRes.ok) genreMapsCache.set(language, maps);
  return maps;
}

handleTmdb('tmdb:search', async ({ apiKey, language }, query) => {
  const res = await tmdbGet(apiKey, `/search/multi?query=${encodeURIComponent(query)}&language=${language}&include_adult=false`);
  if (!res.ok) {
    if (res.status === 401) return { error: 'INVALID_API_KEY' };
    return { error: 'REQUEST_FAILED', status: res.status };
  }
  const json = await res.json();
  const genreMaps = await getGenreMaps(apiKey, language);

  const results = (json.results || [])
    .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
    .slice(0, 12)
    .map((m) => {
      const kind = m.media_type === 'tv' ? 'tv' : 'movie';
      return {
        ...mapTmdbResult(kind)(m),
        genres: (m.genre_ids || []).map((id) => genreMaps[kind].get(id)).filter(Boolean),
        overview: m.overview || '',
      };
    });
  return { results };
});

handleTmdb('tmdb:details', async ({ apiKey, language }, tmdbId, mediaType) => {
  const kind = mediaType === 'tv' ? 'tv' : 'movie';
  const res = await tmdbGet(apiKey, `/${kind}/${tmdbId}?language=${language}`);
  if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
  const json = await res.json();
  if (kind === 'tv') {
    const next = json.next_episode_to_air;
    const last = json.last_episode_to_air;
    const episodes = json.number_of_episodes || null;
    // Many series have no average runtime in TMDB; fall back to the runtime
    // of the latest (or next) episode so the total isn't left empty.
    const episodeRuntime = (Array.isArray(json.episode_run_time) && json.episode_run_time[0])
      || (last && last.runtime)
      || (next && next.runtime)
      || null;
    return {
      seasons: json.number_of_seasons || null,
      episodes,
      runtime: episodes && episodeRuntime ? episodes * episodeRuntime : null,
      status: json.status || null,
      poster: tmdbImage('w200', json.poster_path) || null,
      seasonsList: (json.seasons || []).map((season) => ({
        seasonNumber: season.season_number,
        airDate: season.air_date || null,
        episodeCount: season.episode_count || null,
      })),
      nextEpisode: next ? {
        airDate: next.air_date || null,
        seasonNumber: next.season_number || null,
        episodeNumber: next.episode_number || null,
        name: next.name || null,
      } : null,
    };
  }
  return {
    runtime: json.runtime || null,
    releaseDate: json.release_date || null,
    collectionId: json.belongs_to_collection ? json.belongs_to_collection.id : null,
  };
});

handleTmdb('tmdb:collection', async ({ apiKey, language }, collectionId) => {
  const res = await tmdbGet(apiKey, `/collection/${collectionId}?language=${language}`);
  if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
  const json = await res.json();
  return {
    name: json.name || '',
    parts: (json.parts || []).map((p) => ({
      tmdbId: p.id,
      title: p.title,
      releaseDate: p.release_date || null,
      poster: tmdbImage('w200', p.poster_path),
    })),
  };
});

handleTmdb('tmdb:providers', async ({ apiKey, region }, tmdbId, mediaType) => {
  const kind = mediaType === 'tv' ? 'tv' : 'movie';
  const res = await tmdbGet(apiKey, `/${kind}/${tmdbId}/watch/providers`);
  if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
  const json = await res.json();
  const es = (json.results && json.results[region]) || null;
  if (!es) return { providers: [] };
  const names = new Set();
  ['flatrate', 'free', 'ads'].forEach((key) => {
    (es[key] || []).forEach((p) => names.add(p.provider_name));
  });
  const rentBuy = new Set();
  ['rent', 'buy'].forEach((key) => {
    (es[key] || []).forEach((p) => rentBuy.add(p.provider_name));
  });
  return {
    providers: [...names],
    rentBuy: [...rentBuy],
    link: es.link || null,
  };
});

handleTmdb('tmdb:openTrailer', async ({ apiKey, language }, tmdbId, mediaType) => {
  const kind = mediaType === 'tv' ? 'tv' : 'movie';
  const res = await tmdbGet(apiKey, `/${kind}/${tmdbId}/videos?language=${language}`);
  if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
  const json = await res.json();
  let videos = (json.results || []).filter((v) => v.site === 'YouTube');
  if (!videos.length) {
    const jsonEn = await tmdbJsonOr(apiKey, `/${kind}/${tmdbId}/videos`, { results: [] });
    videos = (jsonEn.results || []).filter((v) => v.site === 'YouTube');
  }
  if (!videos.length) return { error: 'NOT_FOUND' };
  const best = videos.find((v) => v.type === 'Trailer' && v.official)
    || videos.find((v) => v.type === 'Trailer')
    || videos[0];
  await shell.openExternal(`https://www.youtube.com/watch?v=${best.key}`);
  return { opened: true };
});

handleTmdb('tmdb:recommendations', async ({ apiKey, language }, tmdbId, mediaType) => {
  const kind = mediaType === 'tv' ? 'tv' : 'movie';
  const res = await tmdbGet(apiKey, `/${kind}/${tmdbId}/recommendations?language=${language}`);
  if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
  const json = await res.json();
  return { results: (json.results || []).slice(0, 20).map(mapTmdbResult(kind)) };
});

handleTmdb('tmdb:trending', async ({ apiKey, language }) => {
  const [movieJson, tvJson] = await Promise.all([
    tmdbJsonOr(apiKey, `/trending/movie/week?language=${language}`, { results: [] }),
    tmdbJsonOr(apiKey, `/trending/tv/week?language=${language}`, { results: [] }),
  ]);
  return {
    movies: (movieJson.results || []).slice(0, 20).map(mapTmdbResult('movie')),
    tv: (tvJson.results || []).slice(0, 20).map(mapTmdbResult('tv')),
  };
});

handleTmdb('tmdb:providerLogos', async ({ apiKey, language, region }) => {
  const [movieJson, tvJson] = await Promise.all([
    tmdbJsonOr(apiKey, `/watch/providers/movie?language=${language}&watch_region=${region}`, { results: [] }),
    tmdbJsonOr(apiKey, `/watch/providers/tv?language=${language}&watch_region=${region}`, { results: [] }),
  ]);
  const logos = {};
  const providerIds = {};
  [...(movieJson.results || []), ...(tvJson.results || [])].forEach((p) => {
    if (p.provider_name && p.logo_path && !logos[p.provider_name]) {
      logos[p.provider_name] = tmdbImage('original', p.logo_path);
    }
    if (p.provider_name && p.provider_id && !providerIds[p.provider_name]) {
      providerIds[p.provider_name] = p.provider_id;
    }
  });
  return { logos, providerIds };
});

handleTmdb('tmdb:discoverByProviders', async ({ apiKey, language, region }, providerIds, mediaTypes) => {
  if (!Array.isArray(providerIds) || !providerIds.length) return { movies: [], tv: [] };
  const idsParam = providerIds.join('|');
  const wantMovie = !mediaTypes || mediaTypes.includes('movie');
  const wantTv = !mediaTypes || mediaTypes.includes('tv');
  const query = `language=${language}&watch_region=${region}&with_watch_providers=${idsParam}&sort_by=popularity.desc`;
  const [movieJson, tvJson] = await Promise.all([
    wantMovie ? tmdbJsonOr(apiKey, `/discover/movie?${query}`, { results: [] }) : { results: [] },
    wantTv ? tmdbJsonOr(apiKey, `/discover/tv?${query}`, { results: [] }) : { results: [] },
  ]);
  return {
    movies: (movieJson.results || []).slice(0, 20).map(mapTmdbResult('movie')),
    tv: (tvJson.results || []).slice(0, 20).map(mapTmdbResult('tv')),
  };
}, { noKeyResult: { movies: [], tv: [] } });

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

ipcMain.handle('data:pickCsv', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importar historial de visionado',
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
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

// System notification; clicking it brings the window back and tells the
// renderer which view to open.
ipcMain.handle('app:notify', (_event, title, body, view) => {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png') });
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (view) mainWindow.webContents.send('app:navigate', view);
  });
  notification.show();
  return true;
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
  autoUpdater.quitAndInstall();
});
