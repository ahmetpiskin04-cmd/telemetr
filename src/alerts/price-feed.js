// Alarmların tek fiyat kaynağı. Alarm kodu fiyatı yalnızca buradan alır; veri sağlayıcısını
// (Yahoo, Harem) değiştirmek istenirse yalnızca bu dosya değişir.
//
// Kural: bu modül ASLA fırlatmaz. Veri alınamayan sembol için sonuç `null` olur, hata `log`'a
// yazılır; çağıran alarmı sessizce atlar.
import { fetchHaremQuotes } from '../sources/harem.js';
import { bistSymbol, defaultYahooClient, exchangeDate, fetchDailyBars } from '../sources/yahoo.js';
import { getRecentPrices } from '../repository.js';

const DAY_MS = 86_400_000;
const HISTORY_CACHE_MS = 30 * 60_000;
// Harem yalnızca fiyat değişince mesaj atar; sessiz kaldığı anlarda tek denemede fiyat gelmeyebiliyor
const HAREM_ATTEMPTS = 3;
const HAREM_TIMEOUT_MS = 30_000;

/** BİST dışı izlenebilen varlıklar. BİST hisseleri kod biçiminden tanınır. */
export const SPECIAL_ASSETS = Object.freeze({
  GRAM_ALTIN: { kind: 'harem', name: 'Gram altın', unit: 'TL', haremCode: 'ALTIN', dbSymbol: 'GRAM_ALTIN' },
  ONS_ALTIN: { kind: 'yahoo', name: 'Ons altın (vadeli)', unit: 'USD', yahooSymbol: 'GC=F', futures: true }, // spot ons Yahoo'da yok
  USDTRY: { kind: 'yahoo', name: 'USD/TRY', unit: 'TL', yahooSymbol: 'USDTRY=X' },
});

const BIST_CODE_RE = /^[A-Z0-9]{3,6}$/;

/** Sembolü kaynak tanımına çevirir; tanınmıyorsa null. */
export function resolveAsset(symbol) {
  const code = String(symbol ?? '').toUpperCase();
  if (SPECIAL_ASSETS[code]) return { symbol: code, ...SPECIAL_ASSETS[code] };
  if (BIST_CODE_RE.test(code)) return { symbol: code, kind: 'bist', name: code, unit: 'TL', yahooSymbol: bistSymbol(code) };
  return null;
}

const isoDaysAgo = (now, days) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);

/**
 * Fiyat kaynağı oluşturur. Bağımlılıklar dışarıdan verilebilir (testler sahte nesne kullanır).
 *
 * Quote: { symbol, name, price, previousClose, unit, asOf: Date|null, marketOpen: boolean|null,
 *          delayed: boolean, futures: boolean, timeZone }
 *   marketOpen null = bilinmiyor (altın kotasyonu gibi sürekli akan kaynaklar).
 */
export function createPriceFeed({
  yahoo = defaultYahooClient(),
  haremQuotes = fetchHaremQuotes,
  db = null,
  now = () => new Date(),
  log = () => {},
  haremAttempts = HAREM_ATTEMPTS, // ilk deneme + 2 yeniden deneme
  haremTimeoutMs = HAREM_TIMEOUT_MS,
  haremRetryDelayMs = 1_000,
  onSource = () => {}, // ({ source, requested, received }): kaynak sağlığı takibi için
} = {}) {
  const historyCache = new Map(); // "SEMBOL:adet" -> { at, closes }

  /** Kaynak sağlığı bildirimi; takip kodu hata verse de fiyat akışı etkilenmez. */
  const report = (source, requested, received) => {
    try {
      onSource({ source, requested, received });
    } catch (err) {
      log(`Kaynak sağlığı kaydedilemedi: ${err.message}`);
    }
  };
  const countReceived = (entries, out) => entries.filter((e) => out.get(e.symbol)).length;

  async function yahooQuotes(entries, out) {
    try {
      const raw = await yahoo.quote(
        entries.map((e) => e.yahooSymbol),
        {},
        { validateResult: false },
      );
      const bySymbol = new Map((Array.isArray(raw) ? raw : [raw]).filter(Boolean).map((q) => [q.symbol, q]));
      for (const entry of entries) {
        const q = bySymbol.get(entry.yahooSymbol);
        const price = positive(q?.regularMarketPrice);
        if (!price) {
          log(`Fiyat alınamadı: ${entry.symbol} (Yahoo ${entry.yahooSymbol} veri döndürmedi)`);
          continue;
        }
        out.set(entry.symbol, {
          symbol: entry.symbol,
          name: entry.name,
          price,
          previousClose: positive(q.regularMarketPreviousClose),
          unit: entry.unit,
          asOf: q.regularMarketTime ? new Date(q.regularMarketTime) : null,
          marketOpen: q.marketState ? q.marketState === 'REGULAR' : null,
          delayed: Number(q.exchangeDataDelayedBy) > 0,
          futures: Boolean(entry.futures),
          timeZone: q.exchangeTimezoneName ?? null,
        });
      }
    } catch (err) {
      log(`Yahoo fiyat hatası (${entries.map((e) => e.symbol).join(', ')}): ${err.message}`);
    }
    report('yahoo', entries.length, countReceived(entries, out));
  }

  async function haremEntries(entries, out) {
    const codes = [...new Set(entries.map((e) => e.haremCode))];
    let quotes = null;
    let lastError;
    for (let attempt = 1; attempt <= haremAttempts; attempt += 1) {
      try {
        quotes = await haremQuotes(codes, { timeoutMs: haremTimeoutMs });
        break;
      } catch (err) {
        lastError = err;
        log(`Harem denemesi ${attempt}/${haremAttempts} başarısız: ${err.message}`);
        if (attempt < haremAttempts && haremRetryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, haremRetryDelayMs));
      }
    }
    if (!quotes) {
      log(`Harem fiyat hatası (${haremAttempts} denemeden sonra): ${lastError?.message}`);
      report('harem', entries.length, 0);
      return;
    }
    for (const entry of entries) {
      const q = quotes.get(entry.haremCode);
      const price = positive(q?.mid);
      if (!price) {
        log(`Fiyat alınamadı: ${entry.symbol} (Harem ${entry.haremCode} kotasyonu yok)`);
        continue;
      }
      let previousClose = null;
      try {
        if (db) {
          const { rows } = await getRecentPrices(db, entry.dbSymbol, 5);
          previousClose = positive(rows.filter((r) => r.date < q.date).at(-1)?.close);
        }
      } catch (err) {
        log(`Önceki kapanış okunamadı (${entry.symbol}): ${err.message}`);
      }
      out.set(entry.symbol, {
        symbol: entry.symbol,
        name: entry.name,
        price,
        previousClose,
        unit: entry.unit,
        asOf: new Date(`${q.date}T${q.time}+03:00`), // Harem saati İstanbul saatidir
        marketOpen: null,
        delayed: false,
        futures: false,
        timeZone: 'Europe/Istanbul',
      });
    }
    report('harem', entries.length, countReceived(entries, out));
  }

  /** Map<sembol, Quote|null>: istenen her sembol için bir giriş vardır. */
  async function getQuotes(symbols) {
    const out = new Map();
    const yahooList = [];
    const haremList = [];
    for (const symbol of new Set(symbols.map((s) => String(s).toUpperCase()))) {
      out.set(symbol, null);
      const entry = resolveAsset(symbol);
      if (!entry) log(`Bilinmeyen alarm varlığı: ${symbol}`);
      else if (entry.kind === 'harem') haremList.push(entry);
      else yahooList.push(entry);
    }
    await Promise.all([
      yahooList.length > 0 ? yahooQuotes(yahooList, out) : null,
      haremList.length > 0 ? haremEntries(haremList, out) : null,
    ]);
    return out;
  }

  /**
   * Bugünden önceki son `count` günlük kapanış (eskiden yeniye). Bugünün (henüz kesinleşmemiş)
   * mumu ortalamayı bozmasın diye dışarıda bırakılır. Yeterli veri yoksa veya hata olursa null.
   */
  async function getDailyCloses(symbol, count = 20) {
    const code = String(symbol).toUpperCase();
    const key = `${code}:${count}`;
    const hit = historyCache.get(key);
    if (hit && now().getTime() - hit.at < HISTORY_CACHE_MS) return hit.closes;

    const entry = resolveAsset(code);
    if (!entry) return null;
    try {
      let dated; // [{date, close}] eskiden yeniye
      let today;
      if (entry.kind === 'harem') {
        if (!db) return null;
        const { rows } = await getRecentPrices(db, entry.dbSymbol, count + 3);
        dated = rows;
        today = exchangeDate(now(), 'Europe/Istanbul');
      } else {
        const { rows, timeZone } = await fetchDailyBars(entry.yahooSymbol, { from: isoDaysAgo(now(), count * 2 + 14), client: yahoo });
        dated = rows;
        today = exchangeDate(now(), timeZone ?? 'UTC');
      }
      const closes = dated.filter((r) => r.date < today).map((r) => r.close).slice(-count);
      if (closes.length < count) {
        log(`${code}: ${count} günlük ortalama için yeterli veri yok (${closes.length} gün)`);
        return null;
      }
      historyCache.set(key, { at: now().getTime(), closes });
      return closes;
    } catch (err) {
      log(`Geçmiş fiyat alınamadı (${code}): ${err.message}`);
      return null;
    }
  }

  return { getQuotes, getDailyCloses };
}
