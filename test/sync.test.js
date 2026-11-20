import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, ASSET_TYPES } from '../src/db.js';
import { upsertAsset, saveDailyPrices, getLastSyncRun, getRecentPrices } from '../src/repository.js';
import { analyzeAsset } from '../src/analysis.js';
import { fetchDailyBars, exchangeDate } from '../src/sources/yahoo.js';
import { fetchFundHistory, TEFAS_PRICE_URL } from '../src/sources/tefas.js';
import { parseHaremQuote, parsePriceFrame, parseHaremTimestamp } from '../src/sources/harem.js';
import { calibrate, combineWithFx, median, TROY_OUNCE_GRAMS } from '../src/sources/metals.js';
import { runSync } from '../src/sync.js';

// --- Sahte kaynaklar ----------------------------------------------------------

const weekdays = (endIso, n) => {
  const out = [];
  const d = new Date(`${endIso}T00:00:00Z`);
  while (out.length < n) {
    if (d.getUTCDay() % 6 !== 0) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
};

/** yahoo-finance2 chart() taklidi: her sembol için doğrusal artan seri. */
function fakeYahoo(series) {
  const calls = [];
  return {
    calls,
    async chart(symbol) {
      calls.push(symbol);
      const s = series[symbol];
      if (!s) throw new Error(`No data found, symbol may be delisted: ${symbol}`);
      return {
        meta: { exchangeTimezoneName: s.tz, longName: s.name },
        quotes: s.dates.map((date, i) => {
          const close = s.start + i * s.step;
          // İstanbul seansı 06:30 UTC'de, New York 13:30 UTC'de açılır
          const hour = s.tz === 'Europe/Istanbul' ? '06:30' : '13:30';
          return { date: new Date(`${date}T${hour}:00Z`), open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 + i };
        }),
      };
    },
  };
}

const DATES = weekdays('2026-10-16', 60);
const SERIES = {
  'THYAO.IS': { tz: 'Europe/Istanbul', name: 'Turk Hava Yollari', dates: DATES, start: 250, step: 0.5 },
  'USDTRY=X': { tz: 'Europe/London', dates: DATES, start: 49, step: 0 },
  GLD: { tz: 'America/New_York', dates: DATES, start: 380, step: 0 },
  SLV: { tz: 'America/New_York', dates: DATES, start: 58, step: 0 },
};

// Varsayılan kotasyon günü cuma (ETF'nin son mumuyla aynı gün)
const haremQuotes = (overrides = {}, date = '2026-10-16') => async () =>
  new Map(
    Object.entries({
      ALTIN: { bid: 6600, ask: 6620 },
      KULCEALTIN: { bid: 6570, ask: 6644 },
      XAGUSD: { bid: 56.9, ask: 57 },
      USDTRY: { bid: 49.4, ask: 49.5 },
      GUMUSTRY: { bid: 85, ask: 92 },
      ...overrides,
    }).map(([code, q]) => [code, { code, ...q, mid: (q.bid + q.ask) / 2, date, time: '13:39:44' }]),
  );

function fakeTefas({ rateLimitFirst = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (rateLimitFirst && calls.length === 1) return new Response('blocked', { status: 429 });
    const rows = DATES.slice(-30).map((tarih, i) => ({ fonKodu: 'AFT', fonUnvan: 'AK PORTFÖY TEST FONU', tarih, fiyat: 1 + i / 100 }));
    return Response.json({ errorCode: null, errorMessage: null, resultList: rows });
  };
  return { fetchImpl, calls };
}

// --- Birim testleri -------------------------------------------------------------

test('Yahoo: tarih borsanın kendi saat diliminde alınır', async () => {
  // USDTRY Londra saatinde 23:00 UTC = ertesi gün 00:00 BST
  assert.equal(exchangeDate(new Date('2026-09-24T23:00:00Z'), 'Europe/London'), '2026-09-25');
  assert.equal(exchangeDate(new Date('2026-10-16T06:30:00Z'), 'Europe/Istanbul'), '2026-10-16');
  const { rows, name } = await fetchDailyBars('THYAO.IS', { from: '2026-01-01', client: fakeYahoo(SERIES) });
  assert.equal(rows.at(-1).date, '2026-10-16');
  assert.equal(name, 'Turk Hava Yollari');
  assert.ok(rows.every((r, i) => i === 0 || r.date > rows[i - 1].date));
});

test('TEFAS: doğru gövde, 429 sonrası bir kez tekrar dener', async () => {
  const { fetchImpl, calls } = fakeTefas({ rateLimitFirst: true });
  const { rows, name } = await fetchFundHistory('aft', { periyod: 12, fetchImpl, rateLimitWaitMs: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, TEFAS_PRICE_URL);
  assert.deepEqual(calls[0].body, { fonKodu: 'AFT', dil: 'TR', periyod: 12 });
  assert.equal(rows.length, 30);
  assert.equal(name, 'AK PORTFÖY TEST FONU');
});

test('TEFAS: hata mesajı ve boş sonuç hata olarak döner', async () => {
  const err = async () => Response.json({ errorMessage: 'Sistem Hatası!!', resultList: [] });
  await assert.rejects(fetchFundHistory('X', { fetchImpl: err }), /Sistem Hatası/);
  const empty = async () => Response.json({ errorMessage: null, resultList: [] });
  await assert.rejects(fetchFundHistory('YOK', { fetchImpl: empty }), /veri yok/);
});

test('Harem: Socket.IO çerçevesi ve kotasyon ayrıştırma', () => {
  const frame = '42["price_changed",{"data":{"KULCEALTIN":{"code":"KULCEALTIN","alis":"6568.940","satis":6643.88,"tarih":"17-10-2026 13:39:44"}}}]';
  const data = parsePriceFrame(frame);
  const q = parseHaremQuote(data.KULCEALTIN);
  assert.deepEqual(
    { bid: q.bid, ask: q.ask, date: q.date, time: q.time },
    { bid: 6568.94, ask: 6643.88, date: '2026-10-17', time: '13:39:44' },
  );
  assert.equal(parsePriceFrame('40{"sid":"x"}'), null);
  assert.equal(parsePriceFrame('42["other",{}]'), null);
  assert.equal(parseHaremQuote({ alis: '0', satis: '1', tarih: '17-10-2026 13:39:44' }), null);
  assert.equal(parseHaremTimestamp('2026-10-17'), null);
});

test('Maden kalibrasyonu: gün başına bir ölçüm, medyan, vadeli yedeği', () => {
  const raw = combineWithFx(
    [{ date: '2026-10-16', open: 1, high: 1, low: 1, close: 100 }],
    [{ date: '2026-10-16', close: 50 }, { date: '2026-10-15', close: 49 }],
  );
  assert.equal(raw[0].close, 5000);

  const first = calibrate({ raw, haremReference: 6000, haremDate: '2026-10-16' });
  assert.equal(first.factor, 1.2);
  // Aynı gün tekrar ölçüm önceki ölçümün yerini alır
  const sameDay = calibrate({ raw, haremReference: 6100, haremDate: '2026-10-16', calibrations: first.calibrations });
  assert.equal(sameDay.calibrations.length, 1);
  assert.equal(sameDay.factor, 1.22);
  // Medyan aykırı ölçümü bastırır
  const list = [1.2, 1.21, 5].map((factor, i) => ({ date: `2026-10-0${i + 1}`, factor }));
  assert.equal(calibrate({ raw, calibrations: list }).factor, 1.21);
  assert.equal(median([3, 1, 2, 4]), 2.5);
  // Harem hiç yoksa vadeli ons'tan
  assert.equal(calibrate({ raw, futureGram: 5500 }).method, 'vadeli ons (Harem ölçümü yok)');
  assert.throws(() => calibrate({ raw }), /referansı yok/);
});

test('Yeniden yazım alış/satış geçmişini silmez', async () => {
  const db = openDatabase(':memory:');
  await upsertAsset(db, { symbol: 'GRAM_ALTIN', name: 'x', assetType: ASSET_TYPES.PRECIOUS_METAL });
  await saveDailyPrices(db, 'GRAM_ALTIN', [{ date: '2026-10-15', close: 100, bid: 99, ask: 101 }]);
  await saveDailyPrices(db, 'GRAM_ALTIN', [{ date: '2026-10-15', close: 102 }]);
  const { rows } = await getRecentPrices(db, 'GRAM_ALTIN', 5);
  assert.deepEqual([rows[0].close, rows[0].bid, rows[0].ask], [102, 99, 101]);
});

test('Makas ortalaması 5 gözlemden önce hesaplanmaz', async () => {
  const db = openDatabase(':memory:');
  await upsertAsset(db, { symbol: 'M', name: 'x', assetType: ASSET_TYPES.PRECIOUS_METAL });
  const rows = DATES.map((date, i) => ({ date, close: 100 + i, ...(i >= DATES.length - 2 && { bid: 99 + i, ask: 101 + i }) }));
  await saveDailyPrices(db, 'M', rows);
  const r = await analyzeAsset(db, 'M');
  assert.equal(r.stats.spread.samples, 2);
  assert.equal(r.stats.spread.vsAvg, null);
  assert.equal(r.stats.spread.avgPct, null);
  assert.ok(r.stats.spread.latestPct > 0);
});

// --- Uçtan uca ----------------------------------------------------------------------

test('runSync: örnek veriyi siler, üç kaynağı yazar, kalibre eder, makası işler', async () => {
  const db = openDatabase(':memory:');
  await upsertAsset(db, { symbol: 'ORNEK_FON', name: 'örnek', assetType: ASSET_TYPES.FUND });
  await saveDailyPrices(db, 'ORNEK_FON', [{ date: '2026-10-01', close: 1 }], { source: 'sample' });

  const yahoo = fakeYahoo(SERIES);
  const tefas = fakeTefas();
  const logs = [];
  const result = await runSync(db, {
    watchlist: {
      stocks: [{ symbol: 'THYAO', name: 'Türk Hava Yolları' }, { symbol: 'YOKBOYLE' }],
      metals: [{ symbol: 'GRAM_ALTIN' }, { symbol: 'GRAM_GUMUS' }],
      funds: [{ symbol: 'AFT' }],
      file: 'test',
      isExample: false,
    },
    yahoo,
    fetchImpl: tefas.fetchImpl,
    haremQuotes: haremQuotes(),
    fundSpacingMs: 0,
    now: new Date('2026-10-17T12:00:00Z'),
    log: (m) => logs.push(m),
  });

  assert.deepEqual(result.purged, { rows: 1, assets: 1 });
  const bySymbol = Object.fromEntries(result.results.map((r) => [r.symbol, r]));
  assert.equal(bySymbol.THYAO.ok, true);
  assert.equal(bySymbol.YOKBOYLE.ok, false, 'hatalı sembol diğerlerini durdurmamalı');
  assert.equal(bySymbol.AFT.ok, true);
  assert.equal(result.ok, false);

  // Altın: son kapanış Harem has altın ortasına kalibre (380 × 49 × k = 6610)
  const gold = await getRecentPrices(db, 'GRAM_ALTIN', 1);
  assert.ok(Math.abs(gold.rows[0].close - 6610) < 1e-6);
  // Aynı günün kotasyonu: bugünün satırı Harem fiyatı, alış/satış da aynı satırda
  assert.equal(gold.rows[0].date, '2026-10-16');
  assert.deepEqual([gold.rows[0].bid, gold.rows[0].ask], [6570, 6644]);
  assert.equal(bySymbol.GRAM_ALTIN.quote.row, '2026-10-16');

  // Gümüş: spot XAGUSD × USDTRY / ons gram
  const silver = await getRecentPrices(db, 'GRAM_GUMUS', 1);
  assert.ok(Math.abs(silver.rows[0].close - (56.95 * 49.45) / TROY_OUNCE_GRAMS) < 1e-6);

  // Fon adı TEFAS'tan, hisse adı izleme listesinden
  const names = Object.fromEntries(db.prepare('SELECT symbol, name FROM assets').all().map((a) => [a.symbol, a.name]));
  assert.equal(names.AFT, 'AK PORTFÖY TEST FONU');
  assert.equal(names.THYAO, 'Türk Hava Yolları');
  assert.equal(names.ORNEK_FON, undefined);

  const last = await getLastSyncRun(db);
  assert.equal(last.summary.results.length, 5);
  assert.ok(logs.some((l) => l.includes('✖ YOKBOYLE')));
});

const metalsOnly = { stocks: [], metals: [{ symbol: 'GRAM_ALTIN' }], funds: [], file: 'test', isExample: false };

test("runSync: hafta içi New York açılmadan önce bugünün fiyatı Harem'den gelir", async () => {
  const db = openDatabase(':memory:');
  const yahoo = fakeYahoo(SERIES);
  // Cuma: aynı gün kalibrasyonu (katsayı oluşur)
  await runSync(db, { watchlist: metalsOnly, yahoo, haremQuotes: haremQuotes(), now: new Date('2026-10-16T20:00:00Z') });
  // Pazartesi sabahı: ETF'nin son mumu hâlâ cuma; altın yükselmiş
  const result = await runSync(db, {
    watchlist: metalsOnly,
    yahoo,
    haremQuotes: haremQuotes({ ALTIN: { bid: 6700, ask: 6720 }, KULCEALTIN: { bid: 6670, ask: 6750 } }, '2026-10-19'),
    now: new Date('2026-10-19T08:00:00Z'),
  });
  assert.equal(result.ok, true);
  const { rows } = await getRecentPrices(db, 'GRAM_ALTIN', 2);
  assert.equal(rows[1].date, '2026-10-19');
  assert.equal(rows[1].close, 6710, 'bugünün kapanışı Harem has altın ortası');
  assert.equal(rows[1].source, 'harem');
  assert.deepEqual([rows[1].bid, rows[1].ask], [6670, 6750], 'alış/satış bugünün satırında');
  assert.ok(rows[1].bid <= rows[1].close && rows[1].close <= rows[1].ask);
  assert.ok(Math.abs(rows[0].close - 6610) < 1e-6, 'cuma satırı ve katsayı değişmedi');
  const cal = db.prepare("SELECT value FROM sync_state WHERE key = 'calibration:GRAM_ALTIN'").get();
  assert.equal(JSON.parse(cal.value).length, 1, 'farklı günlerin fiyatlarıyla kalibrasyon yapılmadı');
});

test('runSync: hafta sonu yeni satır açılmaz, kotasyon cuma satırına düşer', async () => {
  const db = openDatabase(':memory:');
  const yahoo = fakeYahoo(SERIES);
  await runSync(db, { watchlist: metalsOnly, yahoo, haremQuotes: haremQuotes(), now: new Date('2026-10-16T20:00:00Z') });
  await runSync(db, { watchlist: metalsOnly, yahoo, haremQuotes: haremQuotes({ KULCEALTIN: { bid: 6580, ask: 6650 } }, '2026-10-17'), now: new Date('2026-10-17T10:00:00Z') });
  const { rows } = await getRecentPrices(db, 'GRAM_ALTIN', 1);
  assert.equal(rows[0].date, '2026-10-16');
  assert.deepEqual([rows[0].bid, rows[0].ask], [6580, 6650]);
});

test('runSync: Harem erişilemezse vadeli ons ile kalibre eder, makas yazmaz', async () => {
  const db = openDatabase(':memory:');
  const yahoo = fakeYahoo({ ...SERIES, 'GC=F': { tz: 'America/New_York', dates: DATES, start: 4000, step: 0 } });
  const result = await runSync(db, {
    watchlist: { stocks: [], metals: [{ symbol: 'GRAM_ALTIN' }], funds: [], file: 'test', isExample: false },
    yahoo,
    haremQuotes: async () => {
      throw new Error('bağlantı yok');
    },
    now: new Date('2026-10-17T12:00:00Z'),
  });
  assert.equal(result.ok, true);
  assert.match(result.results[0].calibration, /vadeli/);
  const gold = await getRecentPrices(db, 'GRAM_ALTIN', 1);
  assert.ok(Math.abs(gold.rows[0].close - (4000 * 49) / TROY_OUNCE_GRAMS) < 1e-6);
  assert.equal(gold.rows[0].bid, null);
});
