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
  /** Senkronizasyon olayları: started | log | finished | failed. Abonelikten çıkış fonksiyonu döner. */
  onSyncEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sync:event', listener);
    return () => ipcRenderer.removeListener('sync:event', listener);
  },
});
