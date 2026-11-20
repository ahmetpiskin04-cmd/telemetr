import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASSET_TYPES } from '../src/db.js';
import {
  normalizeCode,
  verifyAsset,
  addToWatchlist,
  setPosition,
  removeEverywhere,
  readWatchlistFile,
  readPortfolioFile,
} from '../src/user-config.js';

const tempFiles = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-'));
  return { watchlist: path.join(dir, 'watchlist.json'), portfolio: path.join(dir, 'portfolio.json') };
};
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));

test('normalizeCode: biçim ve tür kuralları', () => {
  assert.equal(normalizeCode(ASSET_TYPES.BIST_STOCK, ' thyao '), 'THYAO');
  assert.equal(normalizeCode(ASSET_TYPES.BIST_STOCK, 'eregl.is'), 'EREGL');
  assert.equal(normalizeCode(ASSET_TYPES.FUND, 'aft'), 'AFT');
  assert.equal(normalizeCode(ASSET_TYPES.BIST_STOCK, 'sise'), 'SISE', 'Türkçe i -> İ dönüşümü yapılmamalı');
  assert.equal(normalizeCode(ASSET_TYPES.BIST_STOCK, 'SİSE'), 'SISE');
  assert.equal(normalizeCode(ASSET_TYPES.PRECIOUS_METAL, 'GRAM_ALTIN'), 'GRAM_ALTIN');
  assert.throws(() => normalizeCode(ASSET_TYPES.FUND, 'AFTX'), /3 karakter/);
  assert.throws(() => normalizeCode(ASSET_TYPES.BIST_STOCK, 'TH YAO'), /BİST kodu/);
  assert.throws(() => normalizeCode(ASSET_TYPES.PRECIOUS_METAL, 'PLATIN'), /Desteklenen/);
});

test('verifyAsset: kaynakta olmayan kod anlaşılır hata verir', async () => {
  const yahoo = {
    async chart(symbol) {
      if (symbol !== 'THYAO.IS') throw new Error('No data found, symbol may be delisted');
      return { meta: { exchangeTimezoneName: 'Europe/Istanbul', longName: 'Turk Hava Yollari' }, quotes: [{ date: new Date(), close: 270, open: 268, high: 272, low: 266, volume: 1 }] };
    },
  };
  assert.equal(await verifyAsset(ASSET_TYPES.BIST_STOCK, 'THYAO', { yahoo }), 'Turk Hava Yollari');
  await assert.rejects(verifyAsset(ASSET_TYPES.BIST_STOCK, 'YOKYOK', { yahoo }), /Borsa İstanbul'da bulunamadı/);
  const fetchImpl = async () => Response.json({ errorMessage: null, resultList: [] });
  await assert.rejects(verifyAsset(ASSET_TYPES.FUND, 'ZZZ', { fetchImpl }), /TEFAS'ta bulunamadı/);
  assert.equal(await verifyAsset(ASSET_TYPES.PRECIOUS_METAL, 'GRAM_GUMUS'), 'Gram Gümüş');
});

test('addToWatchlist: dosya yoksa örnek listeden başlar, tekrar eklemede çift kayıt oluşmaz', async () => {
  const f = await tempFiles();
  await addToWatchlist({ type: ASSET_TYPES.BIST_STOCK, symbol: 'KCHOL', name: 'Koç Holding' }, f.watchlist);
  await addToWatchlist({ type: ASSET_TYPES.BIST_STOCK, symbol: 'KCHOL', name: 'Koç' }, f.watchlist);
  await addToWatchlist({ type: ASSET_TYPES.FUND, symbol: 'YAY' }, f.watchlist);
  const w = await readJson(f.watchlist);
  const kchol = w.stocks.filter((s) => (s.symbol ?? s) === 'KCHOL');
  assert.deepEqual(kchol, [{ symbol: 'KCHOL', name: 'Koç' }]);
  assert.ok(w.stocks.some((s) => s.symbol === 'THYAO'), 'örnek listedeki hisseler korunmalı');
  assert.ok(w.funds.includes('YAY'));
  assert.ok(!existsSync(`${f.watchlist}.tmp`), 'geçici dosya kalmamalı');
});

test('setPosition: sahiplik, adet/maliyet ve doğrulama; diğer alanlar korunur', async () => {
  const f = await tempFiles();
  await writeFile(f.portfolio, JSON.stringify({ cash: 500, positions: [{ symbol: 'ASELS' }], aliases: { ASELS: ['Aselsan'] } }));
  await setPosition({ symbol: 'ASELS', held: true, quantity: 10, avgCost: 300.5 }, f.portfolio);
  await setPosition({ symbol: 'EREGL', held: true }, f.portfolio);
  let p = await readPortfolioFile(f.portfolio);
  assert.deepEqual(p.positions, [{ symbol: 'ASELS', quantity: 10, avgCost: 300.5 }, { symbol: 'EREGL' }]);
  assert.equal(p.cash, 500);
  assert.deepEqual(p.aliases, { ASELS: ['Aselsan'] });

  await setPosition({ symbol: 'ASELS', held: false }, f.portfolio);
  p = await readPortfolioFile(f.portfolio);
  assert.deepEqual(p.positions.map((x) => x.symbol), ['EREGL']);

  await assert.rejects(setPosition({ symbol: 'X', held: true, quantity: 0 }, f.portfolio), /sıfırdan büyük/);
  await assert.rejects(setPosition({ symbol: 'X', held: true, avgCost: -1 }, f.portfolio), /negatif/);
});

test('removeEverywhere: listeden ve portföyden çıkarır', async () => {
  const f = await tempFiles();
  await writeFile(f.watchlist, JSON.stringify({ stocks: [{ symbol: 'TUPRS', name: 'Tüpraş' }, 'BIMAS'], funds: ['AFT'], metals: ['GRAM_ALTIN'] }));
  await writeFile(f.portfolio, JSON.stringify({ positions: [{ symbol: 'TUPRS', quantity: 5 }, { symbol: 'BIMAS' }] }));
  await removeEverywhere('TUPRS', { watchlistFile: f.watchlist, portfolioFile: f.portfolio });
  const w = await readWatchlistFile(f.watchlist);
  const p = await readPortfolioFile(f.portfolio);
  assert.deepEqual(w.stocks, ['BIMAS']);
  assert.deepEqual(p.positions, [{ symbol: 'BIMAS' }]);
});
