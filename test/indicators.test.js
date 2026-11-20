import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, logLinearTrend, crossovers } from '../src/indicators.js';
import { openDatabase, ASSET_TYPES } from '../src/db.js';
import { upsertAsset, saveDailyPrices, getPriceWindow } from '../src/repository.js';
import { analyzeAsset } from '../src/analysis.js';

const close = (actual, expected, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected} bekleniyordu`);

test('SMA', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('EMA: ilk değer SMA, sonra 2/(n+1) ağırlıkla', () => {
  const out = ema([1, 2, 3, 4, 5], 3); // k = 0.5
  assert.deepEqual(out, [null, null, 2, 3, 4]);
  assert.deepEqual(ema([null, null, 2, 4], 2), [null, null, null, 3]);
});

test('RSI: Wilder referans örneği (yuvarlamasız elle hesap)', () => {
  // StockCharts veri seti. Onların tablosu ara değerleri yuvarladığı için 70.53 / 66.32 verir;
  // yuvarlamasız hesap aşağıdaki gibidir.
  const prices = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
    46.28, 46.28, 46.0,
  ];
  const out = rsi(prices, 14);
  assert.equal(out[13], null);
  // İlk 14 değişim: kazançlar toplamı 3.34, kayıplar toplamı 1.40
  const g0 = 3.34 / 14;
  const l0 = 1.4 / 14;
  close(out[14], 100 - 100 / (1 + g0 / l0), 1e-9); // ≈ 70.46
  // Sonraki gün değişim -0.28 → Wilder yumuşatması
  const g1 = (g0 * 13) / 14;
  const l1 = (l0 * 13 + 0.28) / 14;
  close(out[15], 100 - 100 / (1 + g1 / l1), 1e-9); // ≈ 66.25
});

test('RSI: sürekli yükselen seri 100, sabit seri 50', () => {
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 3).at(-1), 100);
  assert.equal(rsi([5, 5, 5, 5, 5], 3).at(-1), 50);
});

test('MACD: sabit seride sıfır, ilk sinyal 34. günde', () => {
  const flat = new Array(40).fill(100);
  const { macd: line, signal, histogram } = macd(flat);
  assert.equal(line[24], null);
  assert.equal(line[25], 0);
  assert.equal(signal[32], null);
  assert.equal(signal[33], 0);
  assert.equal(histogram.at(-1), 0);
});

test('Log-doğrusal trend: %1 bileşik büyüme', () => {
  const values = Array.from({ length: 20 }, (_, i) => 100 * 1.01 ** i);
  const t = logLinearTrend(values);
  close(t.dailyPct, 1, 1e-9);
  close(t.r2, 1, 1e-9);
});

test('Kesişim tespiti', () => {
  assert.deepEqual(crossovers([1, 3, 1], [2, 2, 2]), [
    { index: 1, type: 'up' },
    { index: 2, type: 'down' },
  ]);
});

async function memoryDbWith(symbol, closes) {
  const db = openDatabase(':memory:');
  await upsertAsset(db, { symbol, name: 'Test', assetType: ASSET_TYPES.FUND, unit: 'pay' });
  const start = Date.parse('2026-01-01T00:00:00Z');
  const rows = closes.map((c, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    close: c,
  }));
  await saveDailyPrices(db, symbol, rows);
  return db;
}

test('getPriceWindow: 30 takvim günü + ısınma verisi', async () => {
  const db = await memoryDbWith('TST', Array.from({ length: 100 }, (_, i) => 10 + i));
  const { rows, windowStart } = await getPriceWindow(db, 'tst', { days: 30, warmupBars: 40 });
  assert.equal(windowStart, 40);
  assert.equal(rows.length, 70);
  assert.equal(rows.at(-1).close, 109);
  assert.equal(rows[windowStart].close, 80);
});

test('analyzeAsset: yükselen trendi yükseliş olarak sınıflandırır', async () => {
  const db = await memoryDbWith('UP', Array.from({ length: 120 }, (_, i) => 100 * 1.005 ** i + Math.sin(i)));
  const r = await analyzeAsset(db, 'UP');
  assert.equal(r.trend.direction, 'yükseliş');
  assert.equal(r.period.bars, 30);
  assert.ok(r.regression.slope > 0);
  assert.deepEqual(r.warnings, []);
});

test('analyzeAsset: yetersiz veride uyarı verir', async () => {
  const db = await memoryDbWith('KISA', Array.from({ length: 20 }, (_, i) => 50 + i));
  const r = await analyzeAsset(db, 'KISA');
  assert.equal(r.latest.signal, null);
  assert.match(r.warnings[0], /Yetersiz geçmiş veri/);
});
