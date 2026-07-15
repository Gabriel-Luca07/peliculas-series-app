const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

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

function isValidProfileColor(color) {
  return typeof color === 'string' && (/^series-[1-8]$/.test(color) || /^#[0-9a-fA-F]{6}$/.test(color));
}

function sanitizeProfileInitial(initial) {
  return (initial || '').trim().slice(0, 2) || null;
}

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
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
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
      }));
    await writeJson(subscriptionsFile(profileId), cleanSubscriptions);
    counts.subscriptions = cleanSubscriptions.length;
  }
  if (Array.isArray(payload.subscriptionHistory)) {
    const cleanHistory = payload.subscriptionHistory
      .filter((h) => h && typeof h.platform === 'string' && typeof h.startDate === 'string' && typeof h.endDate === 'string')
      .map((h) => ({
        id: typeof h.id === 'string' ? h.id : crypto.randomUUID(),
        platform: h.platform,
        price: typeof h.price === 'number' && Number.isFinite(h.price) ? h.price : null,
        cycleDays: Number.isFinite(h.cycleDays) && h.cycleDays > 0 ? h.cycleDays : 30,
        startDate: h.startDate,
        endDate: h.endDate,
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
  const today = new Date().toISOString().slice(0, 10);
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

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => sendUpdaterStatus({ state: 'available', version: info.version }));
autoUpdater.on('update-downloaded', (info) => sendUpdaterStatus({ state: 'downloaded', version: info.version }));
autoUpdater.on('error', (err) => sendUpdaterStatus({ state: 'error', message: err.message }));

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
    color: color || 'series-1',
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
  if (updates.color !== undefined) profile.color = updates.color || profile.color;
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

ipcMain.handle('tmdb:search', async (_event, query) => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  if (!apiKey) {
    return { error: 'NO_API_KEY' };
  }
  const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&language=${language}&include_adult=false`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      if (res.status === 401) return { error: 'INVALID_API_KEY' };
      return { error: 'REQUEST_FAILED', status: res.status };
    }
    const json = await res.json();
    const [movieGenresRes, tvGenresRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/genre/movie/list?language=${language}`, { headers: { Authorization: `Bearer ${apiKey}` } }),
      fetch(`https://api.themoviedb.org/3/genre/tv/list?language=${language}`, { headers: { Authorization: `Bearer ${apiKey}` } }),
    ]);
    const movieGenres = movieGenresRes.ok ? await movieGenresRes.json() : { genres: [] };
    const tvGenres = tvGenresRes.ok ? await tvGenresRes.json() : { genres: [] };
    const movieGenreMap = new Map(movieGenres.genres.map((g) => [g.id, g.name]));
    const tvGenreMap = new Map(tvGenres.genres.map((g) => [g.id, g.name]));

    const results = (json.results || [])
      .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
      .slice(0, 12)
      .map((m) => {
        const isTv = m.media_type === 'tv';
        const genreMap = isTv ? tvGenreMap : movieGenreMap;
        return {
          tmdbId: m.id,
          mediaType: isTv ? 'tv' : 'movie',
          title: isTv ? m.name : m.title,
          year: (isTv ? m.first_air_date : m.release_date) ? (isTv ? m.first_air_date : m.release_date).slice(0, 4) : '',
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : '',
          genres: (m.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean),
          overview: m.overview || '',
        };
      });
    return { results };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

ipcMain.handle('tmdb:details', async (_event, tmdbId, mediaType) => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}?language=${language}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    if (kind === 'tv') {
      const next = json.next_episode_to_air;
      const episodes = json.number_of_episodes || null;
      const episodeRuntime = Array.isArray(json.episode_run_time) && json.episode_run_time.length
        ? json.episode_run_time[0]
        : null;
      return {
        seasons: json.number_of_seasons || null,
        episodes,
        runtime: episodes && episodeRuntime ? episodes * episodeRuntime : null,
        status: json.status || null,
        poster: json.poster_path ? `https://image.tmdb.org/t/p/w200${json.poster_path}` : null,
        nextEpisode: next ? {
          airDate: next.air_date || null,
          seasonNumber: next.season_number || null,
          episodeNumber: next.episode_number || null,
          name: next.name || null,
        } : null,
      };
    }
    return { runtime: json.runtime || null };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

ipcMain.handle('tmdb:providers', async (_event, tmdbId, mediaType) => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const region = settings.region || 'ES';
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/watch/providers`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

ipcMain.handle('tmdb:openTrailer', async (_event, tmdbId, mediaType) => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/videos?language=${language}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    let videos = (json.results || []).filter((v) => v.site === 'YouTube');
    if (!videos.length) {
      const resEn = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/videos`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (resEn.ok) {
        const jsonEn = await resEn.json();
        videos = (jsonEn.results || []).filter((v) => v.site === 'YouTube');
      }
    }
    if (!videos.length) return { error: 'NOT_FOUND' };
    const best = videos.find((v) => v.type === 'Trailer' && v.official)
      || videos.find((v) => v.type === 'Trailer')
      || videos[0];
    await shell.openExternal(`https://www.youtube.com/watch?v=${best.key}`);
    return { opened: true };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

ipcMain.handle('tmdb:recommendations', async (_event, tmdbId, mediaType) => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/recommendations?language=${language}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { error: 'REQUEST_FAILED', status: res.status };
    const json = await res.json();
    const results = (json.results || []).slice(0, 20).map((m) => ({
      tmdbId: m.id,
      mediaType: kind,
      title: kind === 'tv' ? m.name : m.title,
      year: (kind === 'tv' ? m.first_air_date : m.release_date) ? (kind === 'tv' ? m.first_air_date : m.release_date).slice(0, 4) : '',
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : '',
    }));
    return { results };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

function mapTmdbResult(kind) {
  return (m) => ({
    tmdbId: m.id,
    mediaType: kind,
    title: kind === 'tv' ? m.name : m.title,
    year: (kind === 'tv' ? m.first_air_date : m.release_date) ? (kind === 'tv' ? m.first_air_date : m.release_date).slice(0, 4) : '',
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : '',
  });
}

ipcMain.handle('tmdb:trending', async () => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/trending/movie/week?language=${language}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      fetch(`https://api.themoviedb.org/3/trending/tv/week?language=${language}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    ]);
    const movieJson = movieRes.ok ? await movieRes.json() : { results: [] };
    const tvJson = tvRes.ok ? await tvRes.json() : { results: [] };
    return {
      movies: (movieJson.results || []).slice(0, 20).map(mapTmdbResult('movie')),
      tv: (tvJson.results || []).slice(0, 20).map(mapTmdbResult('tv')),
    };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

ipcMain.handle('tmdb:providerLogos', async () => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  const region = settings.region || 'ES';
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/watch/providers/movie?language=${language}&watch_region=${region}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      fetch(`https://api.themoviedb.org/3/watch/providers/tv?language=${language}&watch_region=${region}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    ]);
    const movieJson = movieRes.ok ? await movieRes.json() : { results: [] };
    const tvJson = tvRes.ok ? await tvRes.json() : { results: [] };
    const logos = {};
    const providerIds = {};
    [...(movieJson.results || []), ...(tvJson.results || [])].forEach((p) => {
      if (p.provider_name && p.logo_path && !logos[p.provider_name]) {
        logos[p.provider_name] = `https://image.tmdb.org/t/p/original${p.logo_path}`;
      }
      if (p.provider_name && p.provider_id && !providerIds[p.provider_name]) {
        providerIds[p.provider_name] = p.provider_id;
      }
    });
    return { logos, providerIds };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

ipcMain.handle('tmdb:discoverByProviders', async (_event, providerIds, mediaTypes) => {
  const settings = await loadMergedSettings();
  const apiKey = settings.tmdbApiKey;
  const language = settings.language || 'es-ES';
  const region = settings.region || 'ES';
  if (!apiKey || !Array.isArray(providerIds) || !providerIds.length) return { movies: [], tv: [] };
  try {
    const idsParam = providerIds.join('|');
    const wantMovie = !mediaTypes || mediaTypes.includes('movie');
    const wantTv = !mediaTypes || mediaTypes.includes('tv');
    const [movieRes, tvRes] = await Promise.all([
      wantMovie
        ? fetch(`https://api.themoviedb.org/3/discover/movie?language=${language}&watch_region=${region}&with_watch_providers=${idsParam}&sort_by=popularity.desc`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        : null,
      wantTv
        ? fetch(`https://api.themoviedb.org/3/discover/tv?language=${language}&watch_region=${region}&with_watch_providers=${idsParam}&sort_by=popularity.desc`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        : null,
    ]);
    const movieJson = movieRes && movieRes.ok ? await movieRes.json() : { results: [] };
    const tvJson = tvRes && tvRes.ok ? await tvRes.json() : { results: [] };
    return {
      movies: (movieJson.results || []).slice(0, 20).map(mapTmdbResult('movie')),
      tv: (tvJson.results || []).slice(0, 20).map(mapTmdbResult('tv')),
    };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
});

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

ipcMain.handle('subscriptions:list', async () => {
  return readJson(subscriptionsFile(currentProfileId), []);
});

ipcMain.handle('subscriptions:upsert', async (_event, platform, updates) => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  let entry = list.find((s) => s.platform === platform);
  if (!entry) {
    entry = { platform, price: null, active: false, startDate: null, cycleDays: 30 };
    list.push(entry);
  }
  Object.assign(entry, updates);
  await writeJson(subscriptionsFile(currentProfileId), list);
  return list;
});

ipcMain.handle('subscriptions:cancel', async (_event, platform) => {
  const list = await readJson(subscriptionsFile(currentProfileId), []);
  const entry = list.find((s) => s.platform === platform);
  if (entry && entry.active && entry.startDate) {
    const history = await readJson(subscriptionHistoryFile(currentProfileId), []);
    history.unshift({
      id: crypto.randomUUID(),
      platform: entry.platform,
      price: entry.price,
      cycleDays: entry.cycleDays || 30,
      startDate: entry.startDate,
      endDate: new Date().toISOString().slice(0, 10),
    });
    await writeJson(subscriptionHistoryFile(currentProfileId), history);
  }
  if (entry) {
    entry.active = false;
    entry.startDate = null;
  }
  await writeJson(subscriptionsFile(currentProfileId), list);
  return list;
});

ipcMain.handle('subscriptions:historyList', async () => {
  return readJson(subscriptionHistoryFile(currentProfileId), []);
});

ipcMain.handle('subscriptions:historyDelete', async (_event, id) => {
  const history = await readJson(subscriptionHistoryFile(currentProfileId), []);
  const filtered = history.filter((h) => h.id !== id);
  await writeJson(subscriptionHistoryFile(currentProfileId), filtered);
  return filtered;
});

ipcMain.handle('data:export', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar copia de seguridad',
    defaultPath: `peliculas-backup-${new Date().toISOString().slice(0, 10)}.json`,
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
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(dir, `backup-${today}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { filePath };
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { error: 'DEV_MODE' };
  try {
    const result = await autoUpdater.checkForUpdates();
    const hasUpdate = !!(result && result.isUpdateAvailable);
    return { ok: true, version: hasUpdate ? result.updateInfo.version : null };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});
