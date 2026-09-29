const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (name, color, initial) => ipcRenderer.invoke('profiles:create', name, color, initial),
  updateProfile: (id, updates) => ipcRenderer.invoke('profiles:update', id, updates),
  pickProfileAvatar: (id) => ipcRenderer.invoke('profiles:pickAvatar', id),
  clearProfileAvatar: (id) => ipcRenderer.invoke('profiles:clearAvatar', id),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  listDeletedProfiles: () => ipcRenderer.invoke('profiles:listDeleted'),
  restoreProfile: (id) => ipcRenderer.invoke('profiles:restore', id),
  purgeDeletedProfile: (id) => ipcRenderer.invoke('profiles:purgeDeleted', id),
  setActiveProfile: (id) => ipcRenderer.invoke('profiles:setActive', id),
  loadMovies: () => ipcRenderer.invoke('movies:load'),
  saveMovies: (movies) => ipcRenderer.invoke('movies:save', movies),
  loadTrash: () => ipcRenderer.invoke('trash:load'),
  saveTrash: (trash) => ipcRenderer.invoke('trash:save', trash),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  searchTmdb: (query) => ipcRenderer.invoke('tmdb:search', query),
  getTmdbDetails: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:details', tmdbId, mediaType),
  getTmdbCollection: (collectionId) => ipcRenderer.invoke('tmdb:collection', collectionId),
  getTmdbProviders: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:providers', tmdbId, mediaType),
  openTrailer: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:openTrailer', tmdbId, mediaType),
  getRecommendations: (tmdbId, mediaType) => ipcRenderer.invoke('tmdb:recommendations', tmdbId, mediaType),
  getTrending: () => ipcRenderer.invoke('tmdb:trending'),
  getProviderLogos: () => ipcRenderer.invoke('tmdb:providerLogos'),
  discoverByProviders: (providerIds, mediaTypes) => ipcRenderer.invoke('tmdb:discoverByProviders', providerIds, mediaTypes),
  listSubscriptions: () => ipcRenderer.invoke('subscriptions:list'),
  upsertSubscription: (platform, updates) => ipcRenderer.invoke('subscriptions:upsert', platform, updates),
  activateSubscription: (platform, startDate, cycleDays) => ipcRenderer.invoke('subscriptions:activate', platform, startDate, cycleDays),
  cancelSubscription: (platform) => ipcRenderer.invoke('subscriptions:cancel', platform),
  renewSubscription: (platform) => ipcRenderer.invoke('subscriptions:renew', platform),
  listSubscriptionHistory: () => ipcRenderer.invoke('subscriptions:historyList'),
  deleteSubscriptionHistory: (id) => ipcRenderer.invoke('subscriptions:historyDelete', id),
  listShareLists: () => ipcRenderer.invoke('shareLists:list'),
  saveShareList: (payload) => ipcRenderer.invoke('shareLists:save', payload),
  deleteShareList: (id) => ipcRenderer.invoke('shareLists:delete', id),
  openShareListImage: (id) => ipcRenderer.invoke('shareLists:openImage', id),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  applyImportedBackup: (payload) => ipcRenderer.invoke('data:applyImport', payload),
  pickCsvFile: () => ipcRenderer.invoke('data:pickCsv'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  openBackupsFolder: () => ipcRenderer.invoke('app:openBackupsFolder'),
  runBackupNow: () => ipcRenderer.invoke('app:runBackupNow'),
  getDataLocation: () => ipcRenderer.invoke('data:getLocation'),
  pickDataLocation: () => ipcRenderer.invoke('data:pickLocation'),
  inspectDataLocation: (picked) => ipcRenderer.invoke('data:inspectLocation', picked),
  setDataLocation: (picked, mode) => ipcRenderer.invoke('data:setLocation', picked, mode),
  resetDataLocation: () => ipcRenderer.invoke('data:resetLocation'),
  reloadIfChanged: () => ipcRenderer.invoke('data:reloadIfChanged'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getReleaseNotes: (version) => ipcRenderer.invoke('app:getReleaseNotes', version),
  notify: (title, body, view, movieId) => ipcRenderer.invoke('app:notify', title, body, view, movieId),
  getBackgroundSettings: () => ipcRenderer.invoke('app:getBackgroundSettings'),
  setBackgroundSettings: (patch) => ipcRenderer.invoke('app:setBackgroundSettings', patch),
  consumeHiddenStart: () => ipcRenderer.invoke('app:consumeHiddenStart'),
  saveCalendar: (icsText) => ipcRenderer.invoke('data:saveCalendar', icsText),
  onCheckNow: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:checkNow', handler);
    return () => ipcRenderer.removeListener('app:checkNow', handler);
  },
  onNavigate: (callback) => {
    const handler = (_event, target) => callback(target);
    ipcRenderer.on('app:navigate', handler);
    return () => ipcRenderer.removeListener('app:navigate', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});

// Only in the end-to-end tests (main.js passes --e2e): lets them close the
// window the way its X button does.
if (process.argv.includes('--e2e')) {
  contextBridge.exposeInMainWorld('e2e', {
    closeWindow: () => ipcRenderer.invoke('e2e:closeWindow'),
  });
}
