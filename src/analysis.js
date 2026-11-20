import { getPriceWindow, listAssets } from './repository.js';
import {
  sma,
  rsi,
  macd,
  logLinearTrend,
  logReturnVolatility,
  crossovers,
} from './indicators.js';

export const DEFAULT_OPTIONS = Object.freeze({
  days: 30, // analiz penceresi (takvim günü)
  warmupBars: 100, // RSI/MACD'nin oturması için pencereden önce çekilecek gün sayısı
  smaShort: 5,
  smaLong: 20,
  rsiPeriod: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  minR2: 0.3, // regresyon trendinin "anlamlı" sayılması için alt sınır
});

/** Alış-satış makası, orta fiyata göre yüzde: (ask - bid) / ((ask + bid) / 2) * 100 */
function spreadPct(row) {
  return row.bid > 0 && row.ask > 0 ? ((row.ask - row.bid) / ((row.ask + row.bid) / 2)) * 100 : null;
}

// Makas yalnızca canlı kotasyondan gelir ve gün gün birikir. Bu sayıdan az gözlemle
// "ortalamaya göre" karşılaştırma anlamsız (tek gözlem her zaman 1.00× çıkar).
export const MIN_SPREAD_SAMPLES = 5;

function spreadStats(spreads) {
  const valid = spreads.filter((v) => v != null);
  if (valid.length === 0) return null;
  // Son kotasyon son işlem gününe yazılır; o gün kotasyon alınmadıysa en son gözlem kullanılır
  const latestPct = valid.at(-1);
  const enough = valid.length >= MIN_SPREAD_SAMPLES;
  const avgPct = enough ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  return {
    latestPct,
    latestIsToday: spreads.at(-1) != null,
    samples: valid.length,
    avgPct,
    minPct: Math.min(...valid),
    maxPct: Math.max(...valid),
    vsAvg: enough ? latestPct / avgPct : null, // 1.0 = ortalama, >1 = makas açılmış
  };
}

function rsiZone(value) {
  if (value == null) return null;
  if (value >= 70) return 'aşırı alım';
  if (value <= 30) return 'aşırı satım';
  return 'nötr';
}

/**
 * Her sinyal +1 (yükseliş), -1 (düşüş) veya 0 (kararsız / hesaplanamadı) verir.
 * Toplam skor >= 2 ise yükseliş, <= -2 ise düşüş, arası yatay kabul edilir.
 * RSI yön değil aşırılık ölçtüğü için skora katılmaz, ayrıca raporlanır.
 */
function classifyTrend({ latest, regression, minR2 }) {
  const signals = [];
  const add = (name, value, note) => signals.push({ name, value, note });

  if (regression == null) add('regresyon', 0, 'yetersiz veri');
  else if (regression.r2 < minR2) add('regresyon', 0, `zayıf uyum (R²=${regression.r2.toFixed(2)})`);
  else add('regresyon', Math.sign(regression.slope), `eğim ${regression.dailyPct.toFixed(3)}%/gün, R²=${regression.r2.toFixed(2)}`);

  if (latest.smaLong == null) add('fiyat/SMA uzun', 0, 'hesaplanamadı');
  else add('fiyat/SMA uzun', latest.close > latest.smaLong ? 1 : -1, latest.close > latest.smaLong ? 'fiyat uzun SMA üzerinde' : 'fiyat uzun SMA altında');

  if (latest.smaShort == null || latest.smaLong == null) add('SMA kısa/uzun', 0, 'hesaplanamadı');
  else add('SMA kısa/uzun', latest.smaShort > latest.smaLong ? 1 : -1, latest.smaShort > latest.smaLong ? 'kısa SMA uzun SMA üzerinde' : 'kısa SMA uzun SMA altında');

  if (latest.histogram == null) add('MACD histogram', 0, 'hesaplanamadı');
  else add('MACD histogram', latest.histogram > 0 ? 1 : -1, latest.histogram > 0 ? 'MACD sinyal üzerinde (pozitif momentum)' : 'MACD sinyal altında (negatif momentum)');

  const score = signals.reduce((s, x) => s + x.value, 0);
  const direction = score >= 2 ? 'yükseliş' : score <= -2 ? 'düşüş' : 'yatay';
  return { direction, score, maxScore: signals.length, signals };
}

/**
 * Bir varlığın son `days` günlük fiyatlarını çeker, indikatörleri hesaplar ve trendi yorumlar.
 */
export async function analyzeAsset(db, symbol, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options, macd: { ...DEFAULT_OPTIONS.macd, ...options.macd } };
  const { asset, rows, windowStart } = await getPriceWindow(db, symbol, {
    days: opts.days,
    warmupBars: opts.warmupBars,
    endDate: opts.endDate,
  });

  const windowRows = rows.slice(windowStart);
  if (windowRows.length === 0) {
    return { asset, error: 'Seçilen dönemde fiyat verisi yok' };
  }

  // İndikatörler ısınma verisi dahil tüm seri üzerinde hesaplanır, sonra pencereye kesilir.
  const closes = rows.map((r) => r.close);
  const smaShort = sma(closes, opts.smaShort);
  const smaLong = sma(closes, opts.smaLong);
  const rsiValues = rsi(closes, opts.rsiPeriod);
  const m = macd(closes, opts.macd);

  const series = windowRows.map((r, i) => {
    const k = windowStart + i;
    return {
      date: r.date,
      close: r.close,
      smaShort: smaShort[k],
      smaLong: smaLong[k],
      rsi: rsiValues[k],
      macd: m.macd[k],
      signal: m.signal[k],
      histogram: m.histogram[k],
      spreadPct: spreadPct(r),
    };
  });

  const windowCloses = windowRows.map((r) => r.close);
  const regression = logLinearTrend(windowCloses);
  const latest = series.at(-1);

  const dateAt = (index) => rows[index].date;
  const inWindow = (e) => e.index >= windowStart;
  const events = [
    ...crossovers(smaShort, smaLong).filter(inWindow).map((e) => ({
      date: dateAt(e.index),
      indicator: 'SMA',
      type: e.type,
      description: e.type === 'up' ? `SMA${opts.smaShort}, SMA${opts.smaLong}'yi yukarı kesti` : `SMA${opts.smaShort}, SMA${opts.smaLong}'yi aşağı kesti`,
    })),
    ...crossovers(m.macd, m.signal).filter(inWindow).map((e) => ({
      date: dateAt(e.index),
      indicator: 'MACD',
      type: e.type,
      description: e.type === 'up' ? 'MACD sinyal hattını yukarı kesti' : 'MACD sinyal hattını aşağı kesti',
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const warnings = [];
  const missing = ['smaLong', 'rsi', 'signal'].filter((key) => latest[key] == null);
  if (missing.length > 0) {
    warnings.push(`Yetersiz geçmiş veri (${rows.length} gün): ${missing.join(', ')} hesaplanamadı. ` + `MACD sinyali için en az ${opts.macd.slow + opts.macd.signal - 1} gün gerekir.`);
  } else if (rows.length < opts.macd.slow * 3) {
    warnings.push(`Sadece ${rows.length} günlük veri var; EMA tabanlı RSI/MACD değerleri henüz tam yakınsamamış olabilir.`);
  }
  if (windowRows.some((r) => r.source === 'sample')) {
    warnings.push('Bu dönem örnek (sentetik) veri içeriyor — gerçek piyasa fiyatı değildir.');
  }

  return {
    asset,
    period: { from: windowRows[0].date, to: latest.date, bars: windowRows.length },
    latest: { ...latest, rsiZone: rsiZone(latest.rsi) },
    stats: {
      changePct: (latest.close / windowCloses[0] - 1) * 100,
      high: Math.max(...windowCloses),
      low: Math.min(...windowCloses),
      dailyVolatilityPct: logReturnVolatility(windowCloses),
      spread: spreadStats(series.map((p) => p.spreadPct)),
    },
    regression,
    trend: classifyTrend({ latest, regression, minR2: opts.minR2 }),
    events,
    series,
    warnings,
  };
}

/** Veritabanındaki tüm varlıkları paralel olarak analiz eder. */
export async function analyzeAll(db, options = {}) {
  const assets = await listAssets(db);
  return Promise.all(assets.map((a) => analyzeAsset(db, a.symbol, options)));
}
