// Kullanıcının düzenlediği iki dosya: data/portfolio.json ve data/watchlist.json.
// Uygulama içinden düzenleme bu modülden geçer; dosyalar elle de düzenlenebilir, biçim aynı.
// Yazma atomik: önce .tmp dosyasına, sonra yerine taşıma (yarıda kalan yazma dosyayı bozmasın).
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PORTFOLIO_PATH } from './ai/service.js';
import { DEFAULT_WATCHLIST_PATH, EXAMPLE_WATCHLIST_PATH } from './sync.js';
import { METALS } from './sources/metals.js';
import { fetchDailyBars, bistSymbol } from './sources/yahoo.js';
import { fetchFundHistory, TEFAS_PERIODS } from './sources/tefas.js';
import { ASSET_TYPES } from './db.js';

const LIST_BY_TYPE = {
  [ASSET_TYPES.BIST_STOCK]: 'stocks',
  [ASSET_TYPES.FUND]: 'funds',
  [ASSET_TYPES.PRECIOUS_METAL]: 'metals',
};

// BİST kodları 4-6 harf/rakam (THYAO, A1CAP), TEFAS fon kodları 3 karakter (AFT)
const CODE_RULES = {
  [ASSET_TYPES.BIST_STOCK]: { re: /^[A-Z0-9]{3,6}$/, hint: 'BİST kodu 3-6 harf/rakam olmalı (ör. THYAO)' },
  [ASSET_TYPES.FUND]: { re: /^[A-Z0-9]{3}$/, hint: 'TEFAS fon kodu 3 karakter olmalı (ör. AFT)' },
  [ASSET_TYPES.PRECIOUS_METAL]: { re: /^[A-Z_]+$/, hint: 'Desteklenen madenler: ' + Object.keys(METALS).join(', ') },
};

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

const symbolOf = (entry) => (typeof entry === 'string' ? entry : entry.symbol).toUpperCase();

export async function readPortfolioFile(file = DEFAULT_PORTFOLIO_PATH) {
  const p = await readJson(file, {});
  return { cash: p.cash ?? 0, positions: p.positions ?? [], aliases: p.aliases ?? {} };
}

/** data/watchlist.json yoksa örnek listeden başlar (ilk düzenlemede data/'ya kopyalanmış olur). */
export async function readWatchlistFile(file = DEFAULT_WATCHLIST_PATH) {
  const w = await readJson(file, null) ?? (await readJson(EXAMPLE_WATCHLIST_PATH, {}));
  return { stocks: w.stocks ?? [], funds: w.funds ?? [], metals: w.metals ?? [] };
}

export function normalizeCode(type, raw) {
  // Borsa kodları ASCII: Türkçe büyük harf kuralı (i -> İ) kullanılmaz; İ/ı da I'ya indirgenir
  const symbol = String(raw ?? '').trim().toUpperCase().replace(/[İı]/g, 'I').replace(/\.IS$/, '');
  const rule = CODE_RULES[type];
  if (!rule) throw new Error('Geçersiz varlık türü');
  if (!rule.re.test(symbol) || (type === ASSET_TYPES.PRECIOUS_METAL && !METALS[symbol])) throw new Error(rule.hint);
  return symbol;
}

/** Kodun kaynağında gerçekten var olduğunu doğrular; varsa kaynaktaki adı döner. */
export async function verifyAsset(type, symbol, { yahoo, fetchImpl } = {}) {
  if (type === ASSET_TYPES.PRECIOUS_METAL) return METALS[symbol].name;
  if (type === ASSET_TYPES.BIST_STOCK) {
    const from = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    try {
      const { rows, name } = await fetchDailyBars(bistSymbol(symbol), { from, ...(yahoo && { client: yahoo }) });
      if (rows.length === 0) throw new Error('veri yok');
      return name;
    } catch {
      throw new Error(`${symbol} Borsa İstanbul'da bulunamadı (Yahoo: ${bistSymbol(symbol)})`);
    }
  }
  try {
    const { name } = await fetchFundHistory(symbol, { periyod: TEFAS_PERIODS.month1, rateLimitWaitMs: 5_000, ...(fetchImpl && { fetchImpl }) });
    return name;
  } catch {
    throw new Error(`${symbol} kodlu fon TEFAS'ta bulunamadı`);
  }
}

/** İzleme listesine ekler (zaten varsa adını günceller). */
export async function addToWatchlist({ type, symbol, name }, file = DEFAULT_WATCHLIST_PATH) {
  const w = await readWatchlistFile(file);
  const key = LIST_BY_TYPE[type];
  const others = w[key].filter((e) => symbolOf(e) !== symbol);
  const entry = type === ASSET_TYPES.PRECIOUS_METAL ? symbol : name ? { symbol, name } : symbol;
  w[key] = [...others, entry];
  await writeJsonAtomic(file, w);
}

/**
 * Portföydeki pozisyonu ayarlar. held=false ise pozisyon kaldırılır.
 * quantity / avgCost boş bırakılabilir (yalnızca "sahibim" işareti).
 */
export async function setPosition({ symbol, held, quantity = null, avgCost = null }, file = DEFAULT_PORTFOLIO_PATH) {
  if (quantity != null && !(quantity > 0)) throw new Error('Adet sıfırdan büyük olmalı');
  if (avgCost != null && !(avgCost >= 0)) throw new Error('Maliyet negatif olamaz');
  const p = await readPortfolioFile(file);
  const positions = p.positions.filter((x) => x.symbol.toUpperCase() !== symbol);
  if (held) {
    const pos = { symbol };
    if (quantity != null) pos.quantity = quantity;
    if (avgCost != null) pos.avgCost = avgCost;
    positions.push(pos);
  }
  await writeJsonAtomic(file, { ...p, positions });
}

/** Varlığı izleme listesinden ve portföyden çıkarır. */
export async function removeEverywhere(symbol, { watchlistFile = DEFAULT_WATCHLIST_PATH, portfolioFile = DEFAULT_PORTFOLIO_PATH } = {}) {
  const w = await readWatchlistFile(watchlistFile);
  for (const key of ['stocks', 'funds', 'metals']) w[key] = w[key].filter((e) => symbolOf(e) !== symbol);
  await writeJsonAtomic(watchlistFile, w);
  const p = await readPortfolioFile(portfolioFile);
  if (p.positions.some((x) => x.symbol.toUpperCase() === symbol)) {
    await writeJsonAtomic(portfolioFile, { ...p, positions: p.positions.filter((x) => x.symbol.toUpperCase() !== symbol) });
  }
}
