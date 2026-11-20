// Alarm kontrol döngüsü: fiyatları tek seferde alır, her alarmı değerlendirir, durumu kaydeder, bildirir.
// Hiçbir hata uygulamayı çökertmez: veri alınamayan alarm sessizce atlanır, hata log'a yazılır.
import { readPortfolioFile, readWatchlistFile } from '../user-config.js';
import { computePortfolioLoss, evaluateAlarm } from './evaluate.js';
import { resolveAsset } from './price-feed.js';
import { isBistSessionOpen } from './session.js';
import { ALARM_TYPES, DEFAULT_ALARMS_PATH, applyAlarmUpdates, readAlarmsFile } from './store.js';

const symbolOf = (entry) => (typeof entry === 'string' ? entry : entry.symbol).toUpperCase();
const isLoss = (alarm) => alarm.type === ALARM_TYPES.PORTFOLIO_LOSS;
const isBist = (alarm) => isLoss(alarm) || resolveAsset(alarm.symbol)?.kind === 'bist';

/**
 * Seans dışında, başlangıç durumu zaten kaydedilmiş BİST alarmına bakmaya gerek yok: fiyat değişmiyor.
 * Başlangıç durumu henüz yoksa (yeni alarm) seans dışında da bakılır ki "zaten eşiğin ötesinde mi" bilinsin.
 */
const needsCheck = (alarm, sessionOpen) => alarm.enabled && (!isBist(alarm) || sessionOpen || !alarm.state.initialized);

/**
 * @param feed     createPriceFeed() sonucu (getQuotes, getDailyCloses)
 * @param notify   async (notification, settings) => void; bildirim kanallarını çağırır
 */
export function createAlertRunner({
  feed,
  notify,
  file = DEFAULT_ALARMS_PATH,
  portfolioFile,
  watchlistFile,
  now = () => new Date(),
  log = () => {},
}) {
  let running = false;

  /** Bir kontrol turu. Asla fırlatmaz; özet döner. */
  async function runOnce() {
    if (running) return { skipped: 'busy' };
    running = true;
    try {
      const t = now();
      const data = await readAlarmsFile(file);
      const sessionOpen = isBistSessionOpen(t);
      const due = data.alarms.filter((a) => needsCheck(a, sessionOpen));
      if (due.length === 0) return { checked: 0, evaluated: 0, triggered: 0, sessionOpen };

      // Portföy zararı için pozisyonlar ve hangi sembollerin hisse olduğu (izleme listesinden)
      let positions = [];
      let stockSymbols = new Set();
      if (due.some(isLoss)) {
        const [portfolio, watchlist] = await Promise.all([readPortfolioFile(portfolioFile), readWatchlistFile(watchlistFile)]);
        stockSymbols = new Set(watchlist.stocks.map(symbolOf));
        positions = portfolio.positions.filter((p) => stockSymbols.has(String(p.symbol).toUpperCase()) && p.quantity > 0 && p.avgCost > 0);
      }

      const symbols = new Set(due.filter((a) => !isLoss(a)).map((a) => a.symbol));
      for (const p of positions) symbols.add(String(p.symbol).toUpperCase());
      const quotes = await feed.getQuotes([...symbols]);

      const closesCache = new Map();
      const closesFor = async (alarm) => {
        const key = `${alarm.symbol}:${alarm.params.days}`;
        if (!closesCache.has(key)) closesCache.set(key, await feed.getDailyCloses(alarm.symbol, alarm.params.days));
        return closesCache.get(key);
      };

      const loss = due.some(isLoss) ? computePortfolioLoss(positions, quotes, stockSymbols) : null;
      const updates = [];
      const notifications = [];
      let evaluated = 0;

      for (const alarm of due) {
        try {
          let snapshot;
          let canNotify = true;
          if (isLoss(alarm)) {
            snapshot = { loss };
            canNotify = sessionOpen && !(loss?.symbols ?? []).some((s) => quotes.get(s)?.marketOpen === false);
          } else {
            const quote = quotes.get(alarm.symbol) ?? null;
            snapshot = { quote };
            if (alarm.type === ALARM_TYPES.AVG_DEVIATION && quote) snapshot.closes = await closesFor(alarm);
            if (isBist(alarm)) canNotify = sessionOpen && quote?.marketOpen !== false;
          }
          const result = evaluateAlarm(alarm, snapshot, { now: t, settings: data.settings, canNotify });
          if (!result) {
            log(`Alarm atlandı (veri yok): ${alarm.name}`);
            continue;
          }
          evaluated += 1;
          updates.push({ id: alarm.id, rev: alarm.rev, patch: result.patch });
          if (result.notification) notifications.push({ ...result.notification, alarmId: alarm.id });
        } catch (err) {
          log(`Alarm değerlendirilemedi (${alarm.name}): ${err.message}`);
        }
      }

      // Önce durumu kaydet (aynı tetiklenme ertesi turda tekrarlanmasın), sonra bildir.
      if (updates.length > 0) await applyAlarmUpdates(updates, file);
      for (const n of notifications) {
        try {
          await notify(n, data.settings);
        } catch (err) {
          log(`Bildirim gönderilemedi (${n.title}): ${err.message}`);
        }
      }
      return { checked: due.length, evaluated, triggered: notifications.length, sessionOpen };
    } catch (err) {
      log(`Alarm kontrolü başarısız: ${err.message}`);
      return { error: err.message };
    } finally {
      running = false;
    }
  }

  return { runOnce };
}

/**
 * Döngü: ilk tur kısa bir gecikmeyle, sonra her `getIntervalMinutes()` dakikada bir.
 * Aralık her turdan önce yeniden okunur; ayarlar değişince `reschedule()` çağrılır.
 */
export function startAlertLoop({ runner, getIntervalMinutes, firstDelayMs = 20_000, log = () => {} }) {
  let timer = null;
  let stopped = false;

  const schedule = (delayMs) => {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(tick, delayMs);
    timer.unref?.();
  };

  async function tick() {
    await runner.runOnce();
    let minutes = 5;
    try {
      minutes = (await getIntervalMinutes()) || 5;
    } catch (err) {
      log(`Kontrol aralığı okunamadı, 5 dakika kullanılıyor: ${err.message}`);
    }
    schedule(minutes * 60_000);
  }

  schedule(firstDelayMs);
  return {
    runNow: () => runner.runOnce(),
    reschedule: (delayMs = 0) => schedule(delayMs),
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
