const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadMovies: () => ipcRenderer.invoke('movies:load'),
  saveMovies: (movies) => ipcRenderer.invoke('movies:save', movies),
  loadTrash: () => ipcRenderer.invoke('trash:load'),
  saveTrash: (trash) => ipcRenderer.invoke('trash:save', trash),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  searchTmdb: (query) => ipcRenderer.invoke('tmdb:search', query),
  getTmdbDetails: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:details', tmdbId, mediaType),
  getTmdbProviders: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:providers', tmdbId, mediaType),
  openTrailer: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:openTrailer', tmdbId, mediaType),
  getRecommendations: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:recommendations', tmdbId, mediaType),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  pickCsvFile: () => ipcRenderer.invoke('data:pickCsv'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  openBackupsFolder: () => ipcRenderer.invoke('app:openBackupsFolder'),
  runBackupNow: () => ipcRenderer.invoke('app:runBackupNow'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
});
