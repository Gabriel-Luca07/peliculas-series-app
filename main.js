const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

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

const DELETED_PROFILE_RETENTION_DAYS = 30;

let currentProfileId = null;

const DEFAULT_GLOBAL_SETTINGS = { tmdbApiKey: '' };
const DEFAULT_PROFILE_SETTINGS = {
  language: 'es-ES', region: 'ES',
  autoBackupEnabled: true, autoBackupRetentionDays: 14,
};

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
    const movies = await readJson(moviesFile(currentProfileId), []);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(todayFile, JSON.stringify({ movies }, null, 2), 'utf-8');
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
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await migrateLegacyDataIfNeeded();
  await purgeOldDeletedProfiles();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('profiles:list', async () => {
  return readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
});

ipcMain.handle('profiles:create', async (_event, name, color) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const id = crypto.randomUUID();
  const profile = {
    id,
    name: (name || '').trim() || 'Perfil',
    color: color || 'series-1',
    createdAt: new Date().toISOString(),
  };
  data.profiles.push(profile);
  await writeJson(profilesFile, data);
  await fs.mkdir(profileDir(id), { recursive: true });
  return profile;
});

ipcMain.handle('profiles:rename', async (_event, id, name) => {
  const data = await readJson(profilesFile, { profiles: [], lastActiveProfileId: null });
  const profile = data.profiles.find((p) => p.id === id);
  if (!profile) return { error: 'NOT_FOUND' };
  profile.name = (name || '').trim() || profile.name;
  await writeJson(profilesFile, data);
  return { ok: true };
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
  return readJson(deletedProfilesFile, []);
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
  const restored = { id: profile.id, name: profile.name, color: profile.color, createdAt: profile.createdAt || new Date().toISOString() };
  data.profiles.push(restored);
  await writeJson(profilesFile, data);
  return { ok: true, profile: restored };
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

ipcMain.handle('data:export', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar copia de seguridad',
    defaultPath: `peliculas-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const movies = await readJson(moviesFile(currentProfileId), []);
  await fs.writeFile(filePath, JSON.stringify({ movies }, null, 2), 'utf-8');
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
    const movies = Array.isArray(parsed) ? parsed : parsed.movies;
    if (!Array.isArray(movies)) return { canceled: false, error: 'INVALID_FILE' };
    return { canceled: false, movies };
  } catch (err) {
    return { canceled: false, error: 'INVALID_FILE' };
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
  const movies = await readJson(moviesFile(currentProfileId), []);
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(dir, `backup-${today}.json`);
  await fs.writeFile(filePath, JSON.stringify({ movies }, null, 2), 'utf-8');
  return { filePath };
});

ipcMain.handle('app:getVersion', () => app.getVersion());
