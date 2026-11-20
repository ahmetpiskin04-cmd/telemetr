// preload.cjs'in açtığı window.finans köprüsü. { ok, data, error } zarfını açar.
async function call(method, ...args) {
  if (!window.finans) throw new Error('Electron köprüsü yok — uygulamayı "npm run dev" ile başlatın');
  const res = await window.finans[method](...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export const api = {
  overview: () => call('overview'),
  chart: (symbol, options) => call('chart', symbol, options),
  latestReport: () => call('latestReport'),
  generateReport: (options) => call('generateReport', options),
  syncStatus: () => call('syncStatus'),
  runSync: () => call('runSync'),
  addAsset: (asset) => call('addAsset', asset),
  savePosition: (position) => call('savePosition', position),
  removeAsset: (symbol) => call('removeAsset', symbol),
  alertsOverview: () => call('alertsOverview'),
  alertsSave: (alarm) => call('alertsSave', alarm),
  alertsDelete: (id) => call('alertsDelete', id),
  alertsToggle: (id, enabled) => call('alertsToggle', id, enabled),
  alertsSettings: (patch) => call('alertsSettings', patch),
  alertsAssetAdd: (symbol) => call('alertsAssetAdd', symbol),
  alertsAssetRemove: (symbol) => call('alertsAssetRemove', symbol),
  alertsTest: () => call('alertsTest'),
  alertsRun: () => call('alertsRun'),
  onAlertsEvent: (callback) => window.finans?.onAlertsEvent?.(callback) ?? (() => {}),
  // Eski preload ile (ana süreç yeniden başlatılmadan) çalışırken çökmesin
  onSyncEvent: (callback) => window.finans?.onSyncEvent?.(callback) ?? (() => {}),
};
