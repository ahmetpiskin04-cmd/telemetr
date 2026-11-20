// Grafik için seri verisi: mumlar, hacim, SMA çizgileri, MACD ve kesişim işaretleri.
// İndikatörler görünür aralığın öncesindeki ısınma verisiyle hesaplanır, sonra kesilir.
import { getRecentPrices } from './repository.js';
import { sma, macd, crossovers } from './indicators.js';
import { DEFAULT_OPTIONS } from './analysis.js';

export async function getChartData(db, symbol, { bars = 250, warmupBars = DEFAULT_OPTIONS.warmupBars } = {}) {
  const o = DEFAULT_OPTIONS;
  const { asset, rows } = await getRecentPrices(db, symbol, bars + warmupBars);
  const closes = rows.map((r) => r.close);
  const smaShort = sma(closes, o.smaShort);
  const smaLong = sma(closes, o.smaLong);
  const m = macd(closes, o.macd);

  const start = Math.max(0, rows.length - bars);
  const visible = rows.slice(start);
  const line = (values) =>
    visible.map((r, i) => ({ time: r.date, value: values[start + i] })).filter((p) => p.value != null);
  const markers = (events, kind) =>
    events.filter((e) => e.index >= start).map((e) => ({ time: rows[e.index].date, kind, direction: e.type }));

  // Fonlar günde tek fiyat açıklar: OHLC yoksa grafik mum yerine alan çizer.
  const hasOhlc = visible.length > 0 && visible.every((r) => r.open != null && r.high != null && r.low != null);
  const hasVolume = visible.some((r) => r.volume != null);

  return {
    symbol: asset.symbol,
    name: asset.name,
    assetType: asset.assetType,
    currency: asset.currency,
    unit: asset.unit,
    config: { smaShort: o.smaShort, smaLong: o.smaLong, macd: o.macd },
    hasOhlc,
    hasVolume,
    candles: visible.map((r) => ({ time: r.date, open: r.open, high: r.high, low: r.low, close: r.close })),
    volume: hasVolume
      ? visible.map((r) => ({ time: r.date, value: r.volume ?? 0, up: r.open == null || r.close >= r.open }))
      : [],
    smaShort: line(smaShort),
    smaLong: line(smaLong),
    macd: { line: line(m.macd), signal: line(m.signal), histogram: line(m.histogram) },
    markers: [...markers(crossovers(smaShort, smaLong), 'sma'), ...markers(crossovers(m.macd, m.signal), 'macd')],
  };
}
