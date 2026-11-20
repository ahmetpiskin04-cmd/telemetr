// Alarm hizmeti: depo + fiyat kaynağı + bildirim + zamanlayıcıyı tek yerde bağlar.
// Electron'a bağımlı değildir (masaüstü bildirimi dışarıdan verilir), bu yüzden düz Node ile test edilir.
// Arayüz katmanı (electron/alerts-ipc.js) yalnızca bu nesnenin metotlarını çağırır.
import path from 'node:path';
import { alarmStatusText } from './evaluate.js';
import { createSourceHealth } from './health.js';
import { createLogger } from './logger.js';
import { createNotifier, getTelegramConfig } from './notifier.js';
import { createPriceFeed, resolveAsset } from './price-feed.js';
import { createAlertRunner, startAlertLoop } from './scheduler.js';
import { isBistSessionOpen } from './session.js';
import {
  DEFAULT_ALARMS_PATH,
  addAsset,
  deleteAlarm,
  readAlarmsFile,
  removeAsset,
  saveAlarm,
  setAlarmEnabled,
  updateSettings,
} from './store.js';

/**
 * @param desktop   async ({ title, body }) => void  (Electron Notification)
 * @param feed      test için sahte fiyat kaynağı; verilmezse gerçek (Yahoo + Harem) kurulur
 * @param onChange  bir kontrol turu ya da düzenleme sonrası çağrılır (arayüz kendini yeniler)
 */
export function createAlertService({
  db = null,
  desktop,
  file = DEFAULT_ALARMS_PATH,
  portfolioFile,
  watchlistFile,
  env = process.env,
  fetchImpl,
  feed,
  yahoo, // test için sahte Yahoo istemcisi
  haremQuotes, // test için sahte Harem
  haremRetryDelayMs,
  now = () => new Date(),
  logFile = path.join(path.dirname(file), 'alerts.log'),
  firstDelayMs = 20_000,
  onChange = () => {},
} = {}) {
  const log = createLogger(logFile, { echo: Boolean(env.FINANS_ALERT_DEBUG) });
  const notify = createNotifier({ desktop, env, fetchImpl, log });
  // Bir kaynak art arda 6 tur cevap vermezse (günde en fazla bir kez) bildirimle uyarır
  const health = createSourceHealth({
    file: path.join(path.dirname(file), 'source-health.json'),
    notify,
    getSettings: async () => (await readAlarmsFile(file)).settings,
    now,
    log,
  });
  const priceFeed =
    feed ??
    createPriceFeed({
      db,
      log,
      now,
      onSource: health.onSource,
      ...(yahoo && { yahoo }),
      ...(haremQuotes && { haremQuotes }),
      ...(haremRetryDelayMs !== undefined && { haremRetryDelayMs }),
    });
  const runner = createAlertRunner({ feed: priceFeed, notify, file, portfolioFile, watchlistFile, now, log });

  let loop = null;
  let lastRun = null;

  /** Bir tur çalıştırır, özeti saklar ve arayüze haber verir. */
  async function runNow() {
    const summary = await runner.runOnce();
    if (!summary.skipped) lastRun = { at: now().toISOString(), ...summary };
    onChange({ type: 'run', summary: lastRun });
    return lastRun;
  }

  /** Bir değişiklikten sonra çok geçmeden (yeni alarmın başlangıç durumu için) bir tur planlar. */
  const kick = () => loop?.reschedule(800);

  const wrapped = {
    runNow,

    start() {
      if (loop) return;
      const intervalMinutes = async () => (await readAlarmsFile(file)).settings.checkIntervalMinutes;
      // startAlertLoop doğrudan runner.runOnce çağırır; özet ve olay için sarmalıyoruz
      loop = startAlertLoop({ runner: { runOnce: runNow }, getIntervalMinutes: intervalMinutes, firstDelayMs, log });
    },

    stop() {
      loop?.stop();
      loop = null;
    },

    /** Arayüzün tek okuması: ayarlar, izlenen varlıklar, alarmlar (durum metniyle) ve kanal durumu. */
    async overview() {
      const data = await readAlarmsFile(file);
      return {
        settings: data.settings,
        assets: data.assets.map((symbol) => {
          const def = resolveAsset(symbol);
          return { symbol, name: def?.name ?? symbol, unit: def?.unit ?? 'TL', kind: def?.kind ?? 'bist' };
        }),
        alarms: data.alarms.map((a) => ({ ...a, status: alarmStatusText(a) })),
        channels: { desktop: Boolean(desktop), telegramConfigured: Boolean(getTelegramConfig(env)), telegramEnabled: data.settings.telegramEnabled },
        bistSessionOpen: isBistSessionOpen(now()),
        lastRun,
      };
    },

    async save(input) {
      const alarm = await saveAlarm(input, file);
      kick();
      onChange({ type: 'changed' });
      return alarm;
    },

    async remove(id) {
      await deleteAlarm(id, file);
      onChange({ type: 'changed' });
      return true;
    },

    async toggle(id, enabled) {
      const alarm = await setAlarmEnabled(id, enabled, file);
      if (alarm.enabled) kick();
      onChange({ type: 'changed' });
      return alarm;
    },

    async saveSettings(patch) {
      const settings = await updateSettings(patch, file);
      loop?.reschedule(500); // yeni aralık ve (sınır değiştiyse) baştan başlayan alarmlar hemen devreye girsin
      onChange({ type: 'changed' });
      return settings;
    },

    async addAsset(symbol) {
      const code = await addAsset(symbol, file);
      onChange({ type: 'changed' });
      return code;
    },

    async removeAsset(symbol) {
      await removeAsset(symbol, file);
      onChange({ type: 'changed' });
      return true;
    },

    /** Kanalları dener: gerçek bir alarm değil, "çalışıyor mu?" kontrolü. */
    async sendTest() {
      const settings = (await readAlarmsFile(file)).settings;
      return notify({ kind: 'info', title: 'Telemetr: deneme bildirimi', text: 'Bildirimler çalışıyor. Bu bir deneme mesajıdır.' }, settings);
    },
  };

  return wrapped;
}
