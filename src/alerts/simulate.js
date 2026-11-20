// Sahte fiyatla alarm denemesi: gerçek değerlendirme + zamanlayıcı + bildirim hattı çalışır, yalnızca fiyat kaynağı
// sahtedir ve alarm dosyası geçici klasörde durur (gerçek alarmlarına ve portföyüne dokunmaz).
// Senaryo her zaman şu üç adımdır:
//   1) güvenli tarafta başlangıç (alarm silahlanır, bildirim yok)
//   2) sahte fiyat eşiği geçer (bildirim gelmeli)
//   3) aynı fiyatta tekrar kontrol (spam engeli: tekrar bildirim gelmemeli)
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAlertRunner } from './scheduler.js';
import { resolveAsset } from './price-feed.js';
import { readAlarmsFile, saveAlarm, updateSettings } from './store.js';

// Cuma 11:00 İstanbul: BİST seansı açık; deneme hangi saatte çalıştırılırsa çalıştırılsın aynı sonucu verir
const SIM_START = new Date('2026-11-20T08:00:00Z');
const STOCK_FOR_LOSS = { symbol: 'BIMAS', quantity: 100, avgCost: 400 };

const quoteFor = (symbol, price, { previousClose = null, delayed = false } = {}) => {
  const def = resolveAsset(symbol);
  return { symbol, name: def.name, price, previousClose, unit: def.unit, asOf: null, marketOpen: true, delayed, futures: Boolean(def.futures), timeZone: null };
};

/**
 * @param opts { type: 'price'|'daily_change'|'avg_deviation'|'portfolio_loss', symbol, price, threshold, direction,
 *               percent, previousClose, average, lossTry, lossLimitTry, lossWarnRatio, delayed, cooldownHours }
 * @param notify  (notification, settings) => Promise  (varsayılan: hiçbir yere göndermez)
 * @returns { steps: [{ label, notifications: [{kind,title,text}], status }], alarm }
 */
export async function runScenario(opts, notify) {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-sim-'));
  const file = path.join(dir, 'alarms.json');
  const portfolioFile = path.join(dir, 'portfolio.json');
  const watchlistFile = path.join(dir, 'watchlist.json');
  const type = opts.type ?? 'price';
  if (!['price', 'daily_change', 'avg_deviation', 'portfolio_loss'].includes(type)) throw new Error(`Bilinmeyen alarm türü: ${type}`);
  const symbol = type === 'portfolio_loss' ? null : String(opts.symbol ?? '').toUpperCase();

  if (type !== 'portfolio_loss' && !resolveAsset(symbol)) throw new Error(`Geçersiz varlık kodu: ${opts.symbol}`);

  const settingsPatch = {};
  if (opts.lossLimitTry != null) settingsPatch.lossLimitTry = opts.lossLimitTry;
  if (opts.lossWarnRatio != null) settingsPatch.lossWarnRatio = opts.lossWarnRatio;
  if (Object.keys(settingsPatch).length > 0) await updateSettings(settingsPatch, file);

  let alarmInput;
  let safe; // güvenli taraftaki başlangıç durumu
  let trigger; // sahte fiyat
  const state = { prices: {}, closes: {} };

  if (type === 'price') {
    const threshold = Number(opts.threshold);
    if (!(threshold > 0)) throw new Error('Eşik gerekli (--esik)');
    const direction = opts.direction ?? 'below';
    alarmInput = { type, symbol, direction, threshold };
    safe = { price: direction === 'below' ? threshold * 1.02 : threshold * 0.98 };
    trigger = { price: Number(opts.price) };
  } else if (type === 'daily_change') {
    const previousClose = Number(opts.previousClose);
    if (!(previousClose > 0)) throw new Error('Önceki kapanış gerekli (--onceki-kapanis)');
    alarmInput = { type, symbol, direction: opts.direction ?? 'down', percent: Number(opts.percent) };
    safe = { price: previousClose, previousClose };
    trigger = { price: Number(opts.price), previousClose };
  } else if (type === 'avg_deviation') {
    const average = Number(opts.average);
    if (!(average > 0)) throw new Error('Ortalama gerekli (--ortalama)');
    alarmInput = { type, symbol, percent: Number(opts.percent) };
    state.closes[symbol] = Array.from({ length: 20 }, () => average);
    safe = { price: average };
    trigger = { price: Number(opts.price) };
  } else if (type === 'portfolio_loss') {
    const lossTry = Number(opts.lossTry);
    if (!(lossTry >= 0)) throw new Error('Zarar tutarı gerekli');
    alarmInput = { type };
    await writeFile(watchlistFile, JSON.stringify({ stocks: [STOCK_FOR_LOSS.symbol], funds: [], metals: [] }));
    await writeFile(portfolioFile, JSON.stringify({ cash: 0, positions: [STOCK_FOR_LOSS] }));
    // Tek hissede istenen zarar: (maliyet - fiyat) * adet = lossTry
    safe = { price: STOCK_FOR_LOSS.avgCost };
    trigger = { price: STOCK_FOR_LOSS.avgCost - lossTry / STOCK_FOR_LOSS.quantity };
  } else {
    throw new Error(`Bilinmeyen alarm türü: ${type}`);
  }
  if (opts.cooldownHours != null) alarmInput.cooldownHours = opts.cooldownHours;
  if (type !== 'portfolio_loss' && !(trigger.price > 0)) throw new Error('Sahte fiyat gerekli');

  const alarm = await saveAlarm(alarmInput, file);
  const priceSymbol = type === 'portfolio_loss' ? STOCK_FOR_LOSS.symbol : symbol;
  const setPrice = ({ price, previousClose }) => {
    state.prices[priceSymbol] = quoteFor(priceSymbol, price, { previousClose, delayed: opts.delayed });
  };

  const feed = {
    async getQuotes(symbols) {
      return new Map(symbols.map((s) => [s, state.prices[s] ?? null]));
    },
    async getDailyCloses(sym) {
      return state.closes[sym] ?? null;
    },
  };

  let tick = 0;
  const collected = [];
  const runner = createAlertRunner({
    feed,
    file,
    portfolioFile,
    watchlistFile,
    now: () => new Date(SIM_START.getTime() + tick * 60_000),
    log: () => {},
    notify: async (n, settings) => {
      collected.push(n);
      if (notify) await notify(n, settings);
    },
  });

  const steps = [];
  const run = async (label, values) => {
    tick += 1;
    collected.length = 0;
    setPrice(values);
    await runner.runOnce();
    const current = (await readAlarmsFile(file)).alarms.find((a) => a.id === alarm.id);
    steps.push({ label, price: values.price, notifications: [...collected], armed: current.state.armed, stage: current.state.stage });
  };

  await run('1) Başlangıç (güvenli tarafta)', safe);
  await run('2) Sahte fiyat eşiği geçti', trigger);
  await run('3) Aynı fiyatta tekrar kontrol', trigger);
  return { steps, alarm };
}
