// Geliştirme için ÖRNEK veri üretir: sabit tohumlu rastgele yürüyüş (geometrik Brown hareketi).
// Fiyatlar gerçek piyasa verisi DEĞİLDİR ve `source = 'sample'` olarak işaretlenir.
// Gerçek veriyi saveDailyPrices(db, sembol, satırlar, { source: '...' }) ile kaydedin.
import { openDatabase, ASSET_TYPES } from '../src/db.js';
import { upsertAsset, saveDailyPrices, hasRealData } from '../src/repository.js';

const BARS = 180;

const ASSETS = [
  { symbol: 'THYAO', name: 'Türk Hava Yolları', assetType: ASSET_TYPES.BIST_STOCK, unit: 'adet', start: 300, drift: 0.0008, vol: 0.022 },
  { symbol: 'ASELS', name: 'Aselsan', assetType: ASSET_TYPES.BIST_STOCK, unit: 'adet', start: 150, drift: -0.0006, vol: 0.025 },
  { symbol: 'GARAN', name: 'Garanti BBVA', assetType: ASSET_TYPES.BIST_STOCK, unit: 'adet', start: 130, drift: 0.0001, vol: 0.02 },
  // spread: tipik alış-satış makası (oran); spreadShock: son günlerde makasın kaç kat açıldığı
  { symbol: 'GRAM_ALTIN', name: 'Gram Altın (24 ayar)', assetType: ASSET_TYPES.PRECIOUS_METAL, unit: 'gram', start: 5500, drift: 0.0012, vol: 0.009, spread: 0.015, spreadShock: 1.8 },
  { symbol: 'GRAM_GUMUS', name: 'Gram Gümüş', assetType: ASSET_TYPES.PRECIOUS_METAL, unit: 'gram', start: 70, drift: 0.0004, vol: 0.016, spread: 0.03, spreadShock: 1 },
  { symbol: 'ORNEK_FON', name: 'Örnek Hisse Senedi Fonu', assetType: ASSET_TYPES.FUND, unit: 'pay', start: 1.25, drift: 0.0005, vol: 0.008 },
];

// mulberry32: tekrarlanabilir sonuç için küçük, tohumlu PRNG
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

function lastWeekdays(count) {
  const dates = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (dates.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.reverse();
}

function generate(asset, dates, rand) {
  const round = (v) => Number(v.toFixed(asset.start < 10 ? 6 : 2));
  let price = asset.start;
  return dates.map((date, i) => {
    const open = price;
    price *= Math.exp(asset.drift - asset.vol ** 2 / 2 + asset.vol * gaussian(rand));
    const row = { date, close: round(price) };
    if (asset.assetType !== ASSET_TYPES.FUND) {
      const wiggle = asset.vol * 0.5 * rand();
      row.open = round(open);
      row.high = round(Math.max(open, price) * (1 + wiggle));
      row.low = round(Math.min(open, price) * (1 - wiggle));
    }
    if (asset.assetType === ASSET_TYPES.BIST_STOCK) row.volume = Math.round(5e6 + rand() * 2e7);
    if (asset.spread) {
      const shock = i >= dates.length - 5 ? asset.spreadShock : 1;
      const half = (asset.spread * shock * (0.85 + 0.3 * rand())) / 2;
      row.bid = round(price * (1 - half));
      row.ask = round(price * (1 + half));
    }
    return row;
  });
}

const db = openDatabase();
if ((await hasRealData(db)) && !process.argv.includes('--force')) {
  console.error('Veritabanında gerçek veri var; sentetik veriyle karıştırılmaması için seed durduruldu.');
  console.error('Ayrı bir veritabanı için: $env:FINANS_DB="data/ornek.db"; npm run seed   (ya da --force)');
  db.close();
  process.exit(1);
}
const dates = lastWeekdays(BARS);
const rand = mulberry32(42);

for (const asset of ASSETS) {
  await upsertAsset(db, asset);
  const count = await saveDailyPrices(db, asset.symbol, generate(asset, dates, rand), { source: 'sample' });
  console.log(`${asset.symbol.padEnd(11)} ${count} gün kaydedildi (${dates[0]} → ${dates.at(-1)})`);
}
db.close();
