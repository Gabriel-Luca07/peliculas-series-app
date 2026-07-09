const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const dataDir = app.getPath('userData');
const moviesFile = path.join(dataDir, 'movies.json');
const settingsFile = path.join(dataDir, 'settings.json');
const trashFile = path.join(dataDir, 'trash.json');
const backupsDir = path.join(dataDir, 'backups');

const DEFAULT_SETTINGS = {
  tmdbApiKey: '', language: 'es-ES', region: 'ES',
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

async function loadSettingsWithDefaults() {
  const raw = await readJson(settingsFile, {});
  return { ...DEFAULT_SETTINGS, ...raw };
}

async function runAutoBackup() {
  const settings = await loadSettingsWithDefaults();
  if (!settings.autoBackupEnabled) return;
  const retentionDays = Number(settings.autoBackupRetentionDays) || 14;
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = path.join(backupsDir, `backup-${today}.json`);
  try {
    await fs.access(todayFile);
  } catch {
    const movies = await readJson(moviesFile, []);
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(todayFile, JSON.stringify({ movies }, null, 2), 'utf-8');
  }
  try {
    const files = await fs.readdir(backupsDir);
    const cutoff = Date.now() - retentionDays * 86400000;
    for (const f of files) {
      const match = f.match(/^backup-(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      const fileDate = new Date(match[1]).getTime();
      if (fileDate < cutoff) {
        await fs.unlink(path.join(backupsDir, f)).catch(() => {});
      }
    }
  } catch {
    // backups dir doesn't exist yet, nothing to purge
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  runAutoBackup();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('movies:load', async () => {
  return readJson(moviesFile, []);
});

ipcMain.handle('movies:save', async (_event, movies) => {
  await writeJson(moviesFile, movies);
  return true;
});

ipcMain.handle('trash:load', async () => {
  return readJson(trashFile, []);
});

ipcMain.handle('trash:save', async (_event, trash) => {
  await writeJson(trashFile, trash);
  return true;
});

ipcMain.handle('settings:load', async () => {
  return loadSettingsWithDefaults();
});

ipcMain.handle('settings:save', async (_event, settings) => {
  await writeJson(settingsFile, settings);
  return true;
});

ipcMain.handle('tmdb:search', async (_event, query) => {
  const settings = await readJson(settingsFile, { tmdbApiKey: '', language: 'es-ES', region: 'ES' });
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
  const settings = await readJson(settingsFile, { tmdbApiKey: '', language: 'es-ES', region: 'ES' });
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
  const settings = await readJson(settingsFile, { tmdbApiKey: '', language: 'es-ES', region: 'ES' });
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
  const settings = await readJson(settingsFile, { tmdbApiKey: '', language: 'es-ES', region: 'ES' });
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
  const settings = await readJson(settingsFile, { tmdbApiKey: '', language: 'es-ES', region: 'ES' });
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
    const results = (json.results || []).slice(0, 8).map((m) => ({
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

ipcMain.handle('data:export', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar copia de seguridad',
    defaultPath: `peliculas-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const movies = await readJson(moviesFile, []);
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
  await shell.openPath(dataDir);
  return true;
});

ipcMain.handle('app:openBackupsFolder', async () => {
  await fs.mkdir(backupsDir, { recursive: true });
  await shell.openPath(backupsDir);
  return true;
});

ipcMain.handle('app:runBackupNow', async () => {
  await fs.mkdir(backupsDir, { recursive: true });
  const movies = await readJson(moviesFile, []);
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(backupsDir, `backup-${today}.json`);
  await fs.writeFile(filePath, JSON.stringify({ movies }, null, 2), 'utf-8');
  return { filePath };
});

ipcMain.handle('app:getVersion', () => app.getVersion());
