// Alarm özelliğinin Electron tarafı: hizmeti (src/alerts/service.js) kurar, arayüz kanallarını açar,
// masaüstü bildirimini Electron Notification ile gösterir. Mantık hizmettedir; burası ince bir köprüdür.
import { BrowserWindow, Notification } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createAlertService } from '../src/alerts/service.js';
import { registerHandlers } from './ipc.js';

const BUILD = path.resolve(import.meta.dirname, '..', 'build');
const NOTIFY_ICON = [path.join(BUILD, 'notification.png'), path.join(BUILD, 'icon.png')].find((f) => existsSync(f));

const assertString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) throw new Error(`${label} geçersiz`);
  return value;
};

const broadcast = (channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
};

/**
 * @param db            registerIpc'in açtığı veritabanı (gram altın geçmişi için)
 * @param onNotifyClick bildirime tıklanınca (pencereyi öne getirmek için)
 */
export function registerAlertsIpc({ allowedOrigin, db, onNotifyClick = () => {} }) {
  const desktop = async ({ title, body }) => {
    if (!Notification.isSupported()) throw new Error('Bu sistemde masaüstü bildirimi desteklenmiyor');
    const notification = new Notification({ title, body, icon: NOTIFY_ICON });
    notification.on('click', onNotifyClick);
    notification.show();
  };

  const service = createAlertService({
    db,
    desktop,
    onChange: (event) => broadcast('alerts:event', event),
  });

  registerHandlers(
    {
      'alerts:overview': () => service.overview(),
      'alerts:save': (input) => service.save(input ?? {}),
      'alerts:delete': (id) => service.remove(assertString(id, 'Alarm kimliği')),
      'alerts:toggle': (id, enabled) => service.toggle(assertString(id, 'Alarm kimliği'), Boolean(enabled)),
      'alerts:settings': (patch) => service.saveSettings(patch ?? {}),
      'alerts:asset-add': (symbol) => service.addAsset(assertString(symbol, 'Varlık kodu')),
      'alerts:asset-remove': (symbol) => service.removeAsset(assertString(symbol, 'Varlık kodu')),
      'alerts:test': () => service.sendTest(),
      'alerts:run': () => service.runNow(),
    },
    allowedOrigin,
  );

  return service;
}
