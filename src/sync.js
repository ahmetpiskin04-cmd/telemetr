// Veri güncelleme (sync): izleme listesindeki varlıkları gerçek kaynaklardan çekip SQLite'a yazar.
//   BİST hisseleri  -> Yahoo Finance (THYAO.IS)
//   Altın / gümüş   -> Yahoo ETF × USDTRY (geçmiş) + Harem Altın (fiziksel alış/satış)
//   TEFAS fonları   -> TEFAS fonFiyatBilgiGetir
// Bir varlıktaki hata diğerlerini durdurmaz; her çalışmanın özeti sync_runs'a yazılır.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ASSET_TYPES } from './db.js';
import {
  upsertAsset,
  saveDailyPrices,
  setQuote,
  purgeSampleData,
  getState,
  setState,
  getLatestDate,
  recordSyncRun,
} from './repository.js';
import { fetchDailyBars, bistSymbol, defaultYahooClient } from './sources/yahoo.js';
import { fetchFundHistory, TEFAS_PERIODS } from './sources/tefas.js';
import { fetchHaremQuotes } from './sources/harem.js';
import { METALS, HAREM_CODES, TROY_OUNCE_GRAMS, combineWithFx, calibrate, applyFactor } from './sources/metals.js';

const ROOT = path.resolve(import.meta.dirname, '..');
export const DEFAULT_WATCHLIST_PATH = process.env.FINANS_WATCHLIST ?? path.join(ROOT, 'data', 'watchlist.json');
export const EXAMPLE_WATCHLIST_PATH = path.join(ROOT, 'examples', 'watchlist.example.json');

const HISTORY_DAYS = 400; // ~1 yıl; RSI/MACD ısınması ve 6 aylık grafik için yeterli
const DAY_MS = 86_400_000;

/** { stocks: ["THYAO", {symbol, name}], funds: ["AFT"], metals: ["GRAM_ALTIN"] } */
export async function loadWatchlist(file = DEFAULT_WATCHLIST_PATH) {
  const source = existsSync(file) ? file : EXAMPLE_WATCHLIST_PATH;
  const w = JSON.parse(await readFile(source, 'utf8'));
  const norm = (list) =>
    (list ?? []).map((x) => (typeof x === 'string' ? { symbol: x } : x)).map((x) => ({ ...x, symbol: x.symbol.toUpperCase() }));
  const metals = norm(w.metals);
  for (const m of metals) {
    if (!METALS[m.symbol]) throw new Error(`Bilinmeyen maden: ${m.symbol} (desteklenen: ${Object.keys(METALS).join(', ')})`);
  }
  return { stocks: norm(w.stocks), funds: norm(w.funds), metals, file: source, isExample: source === EXAMPLE_WATCHLIST_PATH };
}

const isWeekday = (isoDate) => {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

const isoDaysAgo = (now, days) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Tek varlığı çalıştırır; hatayı sonuç nesnesine çevirir ki diğer varlıklar devam etsin. */
async function step(symbol, kind, log, fn) {
  try {
    const result = { symbol, kind, ok: true, ...(await fn()) };
    log(`✓ ${symbol.padEnd(11)} ${result.rows} gün, son ${result.latest}${result.note ? ` · ${result.note}` : ''}`);
    return result;
  } catch (err) {
    log(`✖ ${symbol.padEnd(11)} ${err.message}`);
    return { symbol, kind, ok: false, error: err.message };
  }
}

async function syncStock(db, stock, { yahoo, from }) {
  const { rows, name } = await fetchDailyBars(bistSymbol(stock.symbol), { from, client: yahoo });
  if (rows.length === 0) throw new Error('Yahoo veri döndürmedi (kod doğru mu?)');
  await upsertAsset(db, { symbol: stock.symbol, name: stock.name ?? name ?? stock.symbol, assetType: ASSET_TYPES.BIST_STOCK, unit: 'adet' });
  await saveDailyPrices(db, stock.symbol, rows, { source: 'yahoo' });
  return { rows: rows.length, latest: rows.at(-1).date };
}

async function syncFund(db, fund, { now, fetchImpl, rateLimitWaitMs }) {
  // İlk yüklemede 1 yıl; güncel veri varsa son 1 ay yeterli (TEFAS'ı az yormak için)
  const latest = await getLatestDate(db, fund.symbol);
  const fresh = latest && now.getTime() - Date.parse(latest) < 25 * DAY_MS;
  const periyod = fresh ? TEFAS_PERIODS.month1 : TEFAS_PERIODS.year1;
  const { rows, name } = await fetchFundHistory(fund.symbol, { periyod, fetchImpl, rateLimitWaitMs });
  await upsertAsset(db, { symbol: fund.symbol, name: fund.name ?? name ?? fund.symbol, assetType: ASSET_TYPES.FUND, unit: 'pay' });
  await saveDailyPrices(db, fund.symbol, rows, { source: 'tefas' });
  return { rows: rows.length, latest: rows.at(-1).date, note: fresh ? 'artımlı' : 'ilk yükleme' };
}

async function syncMetal(db, metal, { yahoo, from, now, fx, quotes }) {
  const def = METALS[metal.symbol];
  const etf = (await fetchDailyBars(def.etf, { from, client: yahoo })).rows;
  const raw = combineWithFx(etf, fx);
  if (raw.length === 0) throw new Error(`${def.etf} ile USDTRY ortak gün yok`);

  const stateKey = `calibration:${metal.symbol}`;
  const calibrations = await getState(db, stateKey, []);
  const haremReference = def.reference(quotes);
  const haremDate = def.referenceDate(quotes);
  // Kalibrasyon yalnızca aynı günün iki fiyatıyla: ETF'nin son mumu dünkü New York kapanışıysa
  // bugünkü Harem fiyatına oranlamak, o günkü fiyat hareketini katsayıya karıştırır.
  const sameDay = haremReference > 0 && raw.at(-1).date === haremDate;
  let futureGram;
  if (!sameDay && calibrations.length === 0) {
    const future = (await fetchDailyBars(def.future, { from: isoDaysAgo(now, 10), client: yahoo })).rows.at(-1);
    futureGram = future ? (future.close * fx.at(-1).close) / TROY_OUNCE_GRAMS : undefined;
  }
  const cal = calibrate({ raw, haremReference: sameDay ? haremReference : undefined, haremDate, futureGram, calibrations });
  await setState(db, stateKey, cal.calibrations);

  const rows = applyFactor(raw, cal.factor);
  await upsertAsset(db, { symbol: metal.symbol, name: metal.name ?? def.name, assetType: ASSET_TYPES.PRECIOUS_METAL, unit: 'gram' });
  await saveDailyPrices(db, metal.symbol, rows, { source: `yahoo:${def.etf}xUSDTRY` });

  // Bugünün fiyatı: hafta içi Harem'in canlı fiyatı bugünün satırına yazılır. Böylece New York
  // açılmadan (16:30) önce dünkü fiyatta kalınmaz; ETF'nin o günkü mumu gelince yine Harem ezer.
  // Hafta sonu yeni satır açılmaz (borsalar kapalı); kotasyon cuma satırına düşer.
  let live = null;
  if (haremReference > 0 && haremDate && isWeekday(haremDate)) {
    const prev = rows.filter((r) => r.date < haremDate).at(-1);
    const open = prev?.close ?? haremReference;
    live = { date: haremDate, open, high: Math.max(open, haremReference), low: Math.min(open, haremReference), close: haremReference };
    await saveDailyPrices(db, metal.symbol, [live], { source: 'harem' });
  }

  const physical = quotes.get(def.physicalCode);
  const quoteRow = physical ? await setQuote(db, metal.symbol, physical) : null;
  return {
    rows: rows.length + (live && live.date !== rows.at(-1).date ? 1 : 0),
    latest: live?.date ?? rows.at(-1).date,
    calibration: cal.method,
    quote: physical ? { bid: physical.bid, ask: physical.ask, at: `${physical.date} ${physical.time}`, row: quoteRow } : null,
    note: physical ? `makas ${(((physical.ask - physical.bid) / physical.mid) * 100).toFixed(2)}% · ${cal.method}` : `fiziksel kotasyon yok · ${cal.method}`,
  };
}

/**
 * Tüm izleme listesini günceller.
 * Bağımlılıklar dışarıdan verilebilir (testler sahte Yahoo/TEFAS/Harem kullanır).
 */
export async function runSync(
  db,
  {
    watchlist,
    yahoo = defaultYahooClient(),
    fetchImpl = fetch,
    haremQuotes = fetchHaremQuotes,
    fundSpacingMs = 1_200,
    rateLimitWaitMs = 45_000,
    now = new Date(),
    log = () => {},
  } = {},
) {
  const startedAt = new Date().toISOString();
  watchlist ??= await loadWatchlist();
  if (watchlist.isExample) log(`⚠ data/watchlist.json yok; örnek izleme listesi kullanılıyor (${watchlist.file})`);

  // Gerçek veriye geçişte sentetik satırlar karışmasın
  const purged = await purgeSampleData(db);
  if (purged.rows > 0) log(`Örnek (sentetik) veri silindi: ${purged.rows} satır, ${purged.assets} varlık`);

  const from = isoDaysAgo(now, HISTORY_DAYS);

  const stocks = await mapLimit(watchlist.stocks, 3, (s) => step(s.symbol, 'stock', log, () => syncStock(db, s, { yahoo, from })));

  let metals = [];
  if (watchlist.metals.length > 0) {
    let fx = [];
    let quotes = new Map();
    const warnings = [];
    try {
      fx = (await fetchDailyBars('USDTRY=X', { from, client: yahoo })).rows;
    } catch (err) {
      warnings.push(`USDTRY alınamadı: ${err.message}`);
    }
    try {
      quotes = await haremQuotes(HAREM_CODES);
    } catch (err) {
      warnings.push(`Harem: ${err.message}`);
      log(`⚠ Harem fiziksel kotasyon alınamadı (${err.message}); makas bu sefer güncellenmeyecek`);
    }
    metals = await mapLimit(watchlist.metals, 2, (m) =>
      step(m.symbol, 'metal', log, async () => {
        if (fx.length === 0) throw new Error(warnings[0] ?? 'USDTRY verisi yok');
        return syncMetal(db, m, { yahoo, from, now, fx, quotes });
      }),
    );
  }

  // TEFAS sıralı ve aralıklı: art arda istekler 429 bloğu yiyor
  const funds = [];
  for (const [i, f] of watchlist.funds.entries()) {
    if (i > 0) await sleep(fundSpacingMs);
    funds.push(await step(f.symbol, 'fund', log, () => syncFund(db, f, { now, fetchImpl, rateLimitWaitMs })));
  }

  const results = [...stocks, ...metals, ...funds];
  const finishedAt = new Date().toISOString();
  const ok = results.length > 0 && results.every((r) => r.ok);
  const summary = { purged, results, watchlist: watchlist.file };
  await recordSyncRun(db, { startedAt, finishedAt, ok, summary });
  return { startedAt, finishedAt, ok, ...summary };
}
