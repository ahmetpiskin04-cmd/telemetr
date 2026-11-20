import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_TYPES, openDatabase } from '../src/db.js';
import { saveDailyPrices, upsertAsset } from '../src/repository.js';
import { createPriceFeed, resolveAsset } from '../src/alerts/price-feed.js';

const NOW = new Date('2026-11-20T09:00:00Z'); // İstanbul 12:00, Cuma

/** Sahte Yahoo: quote() ve chart() çağrılarını kaydeder. */
function fakeYahoo({ quotes = {}, bars = {}, failQuote = false } = {}) {
  const calls = { quote: [], chart: [] };
  return {
    calls,
    async quote(symbols) {
      calls.quote.push(symbols);
      if (failQuote) throw new Error('ağ yok');
      return symbols.filter((s) => quotes[s]).map((s) => ({ symbol: s, ...quotes[s] }));
    },
    async chart(symbol) {
      calls.chart.push(symbol);
      if (!bars[symbol]) throw new Error('No data found');
      return { meta: { exchangeTimezoneName: bars[symbol].tz ?? 'Europe/Istanbul' }, quotes: bars[symbol].rows };
    },
  };
}

const dayRows = (n, { endDate = '2026-11-20', price = (i) => 100 + i } = {}) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${endDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return { date: d, open: 1, high: 1, low: 1, close: price(i), volume: 1 };
  });

test('resolveAsset: BİST kodu, özel varlıklar ve geçersiz kodlar', () => {
  assert.equal(resolveAsset('bimas').yahooSymbol, 'BIMAS.IS');
  assert.equal(resolveAsset('ONS_ALTIN').yahooSymbol, 'GC=F');
  assert.equal(resolveAsset('ONS_ALTIN').futures, true);
  assert.equal(resolveAsset('USDTRY').yahooSymbol, 'USDTRY=X');
  assert.equal(resolveAsset('GRAM_ALTIN').kind, 'harem');
  assert.equal(resolveAsset('bu geçersiz'), null);
});

test('getQuotes: Yahoo alanlarını Quote nesnesine çevirir, gecikme ve seans bilgisini taşır', async () => {
  const yahoo = fakeYahoo({
    quotes: {
      'BIMAS.IS': { regularMarketPrice: 380.1, regularMarketPreviousClose: 384, marketState: 'REGULAR', exchangeDataDelayedBy: 15, regularMarketTime: new Date('2026-11-20T08:55:00Z'), exchangeTimezoneName: 'Europe/Istanbul' },
      'GC=F': { regularMarketPrice: 3590.7, regularMarketPreviousClose: 3685.5, marketState: 'CLOSED', exchangeDataDelayedBy: 0 },
    },
  });
  const feed = createPriceFeed({ yahoo, now: () => NOW });
  const quotes = await feed.getQuotes(['BIMAS', 'ONS_ALTIN']);

  const bimas = quotes.get('BIMAS');
  assert.equal(bimas.price, 380.1);
  assert.equal(bimas.previousClose, 384);
  assert.equal(bimas.delayed, true);
  assert.equal(bimas.marketOpen, true);
  assert.equal(bimas.unit, 'TL');

  const ons = quotes.get('ONS_ALTIN');
  assert.equal(ons.futures, true);
  assert.equal(ons.unit, 'USD');
  assert.equal(ons.marketOpen, false);
  assert.equal(ons.delayed, false);
  assert.equal(yahoo.calls.quote.length, 1, 'tüm Yahoo sembolleri tek istekte');
});

test('getQuotes: veri yoksa null döner ve loglar; hiçbir zaman fırlatmaz', async () => {
  const logs = [];
  const feed = createPriceFeed({ yahoo: fakeYahoo({ quotes: {} }), log: (m) => logs.push(m), now: () => NOW });
  const quotes = await feed.getQuotes(['BIMAS', 'xx yy']);
  assert.equal(quotes.get('BIMAS'), null);
  assert.equal(quotes.get('XX YY'), null);
  assert.ok(logs.some((m) => m.includes('BIMAS')));

  const broken = createPriceFeed({ yahoo: fakeYahoo({ failQuote: true }), log: (m) => logs.push(m), now: () => NOW });
  assert.equal((await broken.getQuotes(['ASELS'])).get('ASELS'), null);
  assert.ok(logs.some((m) => m.includes('ağ yok')));
});

test('getQuotes: geçersiz (sıfır/negatif) fiyat veri yok sayılır', async () => {
  const yahoo = fakeYahoo({ quotes: { 'EREGL.IS': { regularMarketPrice: 0 } } });
  const quotes = await createPriceFeed({ yahoo, now: () => NOW }).getQuotes(['EREGL']);
  assert.equal(quotes.get('EREGL'), null);
});

test('getQuotes: gram altın Harem ortasından gelir, önceki kapanış veritabanından', async () => {
  const db = openDatabase(':memory:');
  await upsertAsset(db, { symbol: 'GRAM_ALTIN', name: 'Gram Altın', assetType: ASSET_TYPES.PRECIOUS_METAL, unit: 'gram' });
  await saveDailyPrices(db, 'GRAM_ALTIN', [
    { date: '2026-11-18', close: 5900 },
    { date: '2026-11-19', close: 5950 },
    { date: '2026-11-20', close: 5990 }, // bugünün satırı önceki kapanış sayılmamalı
  ]);
  const haremQuotes = async (codes) => {
    assert.deepEqual(codes, ['ALTIN']);
    return new Map([['ALTIN', { code: 'ALTIN', bid: 6000, ask: 6010, mid: 6005, date: '2026-11-20', time: '12:00:00' }]]);
  };
  const quotes = await createPriceFeed({ yahoo: fakeYahoo(), haremQuotes, db, now: () => NOW }).getQuotes(['GRAM_ALTIN']);
  const gold = quotes.get('GRAM_ALTIN');
  assert.equal(gold.price, 6005);
  assert.equal(gold.previousClose, 5950);
  assert.equal(gold.marketOpen, null);
  assert.equal(gold.asOf.toISOString(), '2026-11-20T09:00:00.000Z');
});

test('getQuotes: Harem çökerse yalnızca altın null olur, Yahoo varlıkları etkilenmez', async () => {
  const yahoo = fakeYahoo({ quotes: { 'USDTRY=X': { regularMarketPrice: 50.5, regularMarketPreviousClose: 50.4, marketState: 'REGULAR' } } });
  const haremQuotes = async () => {
    throw new Error('soket kapandı');
  };
  const quotes = await createPriceFeed({ yahoo, haremQuotes, now: () => NOW }).getQuotes(['GRAM_ALTIN', 'USDTRY']);
  assert.equal(quotes.get('GRAM_ALTIN'), null);
  assert.equal(quotes.get('USDTRY').price, 50.5);
});

test('getDailyCloses: bugünün mumunu dışarıda bırakır ve sonucu önbellekler', async () => {
  const yahoo = fakeYahoo({ bars: { 'BIMAS.IS': { rows: dayRows(30) } } }); // son mum bugün (2026-11-20)
  const feed = createPriceFeed({ yahoo, now: () => NOW });
  const closes = await feed.getDailyCloses('BIMAS', 20);
  assert.equal(closes.length, 20);
  assert.equal(closes.at(-1), 128, 'bugünün kapanışı (129) olmamalı; sonuncu dünkü');
  await feed.getDailyCloses('BIMAS', 20);
  assert.equal(yahoo.calls.chart.length, 1, 'ikinci çağrı önbellekten');
});

test('getDailyCloses: yetersiz veya hatalı veride null', async () => {
  const logs = [];
  const short = createPriceFeed({ yahoo: fakeYahoo({ bars: { 'ASELS.IS': { rows: dayRows(8) } } }), log: (m) => logs.push(m), now: () => NOW });
  assert.equal(await short.getDailyCloses('ASELS', 20), null);
  assert.ok(logs.some((m) => m.includes('yeterli veri yok')));
  const none = createPriceFeed({ yahoo: fakeYahoo(), log: () => {}, now: () => NOW });
  assert.equal(await none.getDailyCloses('TUPRS', 20), null);
});

test('getDailyCloses: gram altın geçmişi veritabanından gelir', async () => {
  const db = openDatabase(':memory:');
  await upsertAsset(db, { symbol: 'GRAM_ALTIN', name: 'Gram Altın', assetType: ASSET_TYPES.PRECIOUS_METAL, unit: 'gram' });
  const rows = Array.from({ length: 25 }, (_, i) => {
    const d = new Date('2026-11-20T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - (24 - i));
    return { date: d.toISOString().slice(0, 10), close: 5000 + i };
  });
  await saveDailyPrices(db, 'GRAM_ALTIN', rows);
  const closes = await createPriceFeed({ yahoo: fakeYahoo(), db, now: () => NOW }).getDailyCloses('GRAM_ALTIN', 20);
  assert.equal(closes.length, 20);
  assert.equal(closes.at(-1), 5023, 'bugünün satırı (5024) hariç');
});
