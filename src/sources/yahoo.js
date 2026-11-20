// Yahoo Finance günlük mumları (yahoo-finance2 `chart` modülü).
// OHLC değerleri bölünmelere (bedelsiz) göre düzeltilmiş gelir; bu yüzden her senkronizasyon
// geçmişin tamamını yeniden yazar, yeni bir bölünme sonrası eski satırlar da güncellenir.
import YahooFinance from 'yahoo-finance2';

let defaultClient;
export function defaultYahooClient() {
  defaultClient ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  return defaultClient;
}

/** BİST kodu -> Yahoo sembolü: THYAO -> THYAO.IS */
export const bistSymbol = (code) => `${code.toUpperCase()}.IS`;

/** UTC zaman damgasını borsanın kendi saat diliminde YYYY-AA-GG'ye çevirir. */
export function exchangeDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/**
 * Günlük mumlar, eskiden yeniye: [{ date, open, high, low, close, volume }].
 * Kapanışı olmayan (işlem görmemiş) günler atlanır. Seans açıkken son mum anlıktır;
 * sonraki senkronizasyon onu kesin kapanışla değiştirir.
 */
export async function fetchDailyBars(symbol, { from, client = defaultYahooClient() } = {}) {
  const result = await client.chart(symbol, { period1: from, interval: '1d' });
  const timeZone = result.meta.exchangeTimezoneName ?? 'UTC';
  const byDate = new Map();
  for (const q of result.quotes) {
    if (!(q.close > 0)) continue;
    const date = exchangeDate(new Date(q.date), timeZone);
    byDate.set(date, {
      date,
      open: q.open > 0 ? q.open : null,
      high: q.high > 0 ? q.high : null,
      low: q.low > 0 ? q.low : null,
      close: q.close,
      volume: q.volume ?? null,
    });
  }
  return {
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    name: result.meta.longName ?? result.meta.shortName ?? null,
    currency: result.meta.currency ?? null,
  };
}
