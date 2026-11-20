// Sandbox'lı preload CommonJS olmak zorunda. Arayüze yalnızca bu dar API açılır.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('finans', {
  overview: () => ipcRenderer.invoke('dashboard:overview'),
  chart: (symbol, options) => ipcRenderer.invoke('chart:get', symbol, options),
  latestReport: () => ipcRenderer.invoke('report:latest'),
  generateReport: (options) => ipcRenderer.invoke('report:generate', options),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  runSync: () => ipcRenderer.invoke('sync:run'),
  addAsset: (asset) => ipcRenderer.invoke('assets:add', asset),
  savePosition: (position) => ipcRenderer.invoke('position:save', position),
  removeAsset: (symbol) => ipcRenderer.invoke('assets:remove', symbol),
  // Fiyat alarmları
  alertsOverview: () => ipcRenderer.invoke('alerts:overview'),
  alertsSave: (alarm) => ipcRenderer.invoke('alerts:save', alarm),
  alertsDelete: (id) => ipcRenderer.invoke('alerts:delete', id),
  alertsToggle: (id, enabled) => ipcRenderer.invoke('alerts:toggle', id, enabled),
  alertsSettings: (patch) => ipcRenderer.invoke('alerts:settings', patch),
  alertsAssetAdd: (symbol) => ipcRenderer.invoke('alerts:asset-add', symbol),
  alertsAssetRemove: (symbol) => ipcRenderer.invoke('alerts:asset-remove', symbol),
  alertsTest: () => ipcRenderer.invoke('alerts:test'),
  alertsRun: () => ipcRenderer.invoke('alerts:run'),
  /** Alarm olayları: changed | run. Abonelikten çıkış fonksiyonu döner. */
  onAlertsEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('alerts:event', listener);
    return () => ipcRenderer.removeListener('alerts:event', listener);
  },
  /** Senkronizasyon olayları: started | log | finished | failed. Abonelikten çıkış fonksiyonu döner. */
  onSyncEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sync:event', listener);
    return () => ipcRenderer.removeListener('sync:event', listener);
  },
});
