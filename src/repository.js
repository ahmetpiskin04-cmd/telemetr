import { ASSET_TYPES } from './db.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const PRICE_COLS = 'date, open, high, low, close, volume, bid, ask, source';

// node:sqlite senkron çalışır; bu katman asenkron bir API sunar ki ileride
// asenkron bir sürücüye (ör. sqlite3, uzak bir DB) geçmek çağıranları etkilemesin.

export async function upsertAsset(db, { symbol, name, assetType, currency = 'TRY', unit = 'adet' }) {
  if (!Object.values(ASSET_TYPES).includes(assetType)) {
    throw new Error(`Geçersiz varlık türü: ${assetType}`);
  }
  const row = db
    .prepare(
      `INSERT INTO assets (symbol, name, asset_type, currency, unit)
       VALUES (:symbol, :name, :assetType, :currency, :unit)
       ON CONFLICT(symbol) DO UPDATE SET
         name = excluded.name, asset_type = excluded.asset_type,
         currency = excluded.currency, unit = excluded.unit
       RETURNING id`,
    )
    .get({ symbol: symbol.toUpperCase(), name, assetType, currency, unit });
  return row.id;
}

export async function getAsset(db, symbol) {
  return (
    db
      .prepare(
        `SELECT id, symbol, name, asset_type AS assetType, currency, unit
         FROM assets WHERE symbol = ?`,
      )
      .get(symbol) ?? null
  );
}

export async function listAssets(db) {
  return db
    .prepare(
      `SELECT id, symbol, name, asset_type AS assetType, currency, unit
       FROM assets ORDER BY asset_type, symbol`,
    )
    .all();
}

/**
 * Günlük fiyatları tek transaction içinde kaydeder. Aynı tarih tekrar gelirse günceller.
 * rows: [{ date: 'YYYY-MM-DD', close, open?, high?, low?, volume?, bid?, ask? }]
 */
export async function saveDailyPrices(db, symbol, rows, { source = 'manual' } = {}) {
  const asset = await getAsset(db, symbol);
  if (!asset) throw new Error(`Varlık bulunamadı: ${symbol}`);

  for (const r of rows) {
    if (!DATE_RE.test(r.date)) throw new Error(`Geçersiz tarih (YYYY-MM-DD bekleniyor): ${r.date}`);
    if (!(r.close > 0)) throw new Error(`${r.date} için geçersiz kapanış: ${r.close}`);
    if (r.bid != null && r.ask != null && r.ask < r.bid) {
      throw new Error(`${r.date} için satış (${r.ask}) alıştan (${r.bid}) küçük olamaz`);
    }
  }

  const stmt = db.prepare(
    `INSERT INTO daily_prices (asset_id, date, open, high, low, close, volume, bid, ask, source)
     VALUES (:assetId, :date, :open, :high, :low, :close, :volume, :bid, :ask, :source)
     ON CONFLICT(asset_id, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, volume = excluded.volume,
       -- Senkronizasyon geçmişi her seferinde yeniden yazar; alış/satış yalnızca canlı
       -- kotasyondan gelir ve yeni satırda yoksa eskisi korunur (makas geçmişi kaybolmasın).
       bid = COALESCE(excluded.bid, daily_prices.bid),
       ask = COALESCE(excluded.ask, daily_prices.ask),
       source = excluded.source`,
  );

  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run({
        assetId: asset.id,
        date: r.date,
        open: r.open ?? null,
        high: r.high ?? null,
        low: r.low ?? null,
        close: r.close,
        volume: r.volume ?? null,
        bid: r.bid ?? null,
        ask: r.ask ?? null,
        source,
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

function shiftDate(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Son `days` takvim gününün fiyatlarını getirir. Pencere, varlığın veritabanındaki
 * son tarihine (veya verilen endDate'e) göre hesaplanır: (endDate - days, endDate].
 *
 * EMA tabanlı indikatörler (RSI, MACD) pencereden önceki veriye ihtiyaç duyduğu için
 * pencerenin öncesindeki `warmupBars` adet satır da döner.
 *
 * Dönüş: { asset, rows, windowStart } — rows[windowStart..] analiz penceresidir.
 */
export async function getPriceWindow(db, symbol, { days = 30, warmupBars = 0, endDate } = {}) {
  const asset = await getAsset(db, symbol);
  if (!asset) throw new Error(`Varlık bulunamadı: ${symbol}`);

  const end =
    endDate ??
    db.prepare('SELECT MAX(date) AS d FROM daily_prices WHERE asset_id = ?').get(asset.id).d;
  if (!end) return { asset, rows: [], windowStart: 0 };

  const start = shiftDate(end, -days); // hariç

  const windowRows = db
    .prepare(
      `SELECT ${PRICE_COLS} FROM daily_prices
       WHERE asset_id = ? AND date > ? AND date <= ? ORDER BY date`,
    )
    .all(asset.id, start, end);

  const warmupRows =
    warmupBars > 0
      ? db
          .prepare(
            `SELECT ${PRICE_COLS} FROM daily_prices
             WHERE asset_id = ? AND date <= ? ORDER BY date DESC LIMIT ?`,
          )
          .all(asset.id, start, warmupBars)
          .reverse()
      : [];

  return { asset, rows: [...warmupRows, ...windowRows], windowStart: warmupRows.length };
}

/**
 * Canlı alış/satış kotasyonunu, kotasyon tarihindeki veya ondan önceki son fiyat satırına
 * yazar (hafta sonu alınan kotasyon cuma satırına düşer). Yazılan satırın tarihini döner.
 */
export async function setQuote(db, symbol, { date, bid, ask }) {
  const asset = await getAsset(db, symbol);
  if (!asset) throw new Error(`Varlık bulunamadı: ${symbol}`);
  if (!(bid > 0) || !(ask >= bid)) throw new Error(`${symbol} için geçersiz kotasyon: ${bid}/${ask}`);
  const row = db
    .prepare('SELECT MAX(date) AS d FROM daily_prices WHERE asset_id = ? AND date <= ?')
    .get(asset.id, date);
  if (!row.d) return null;
  db.prepare('UPDATE daily_prices SET bid = ?, ask = ? WHERE asset_id = ? AND date = ?').run(bid, ask, asset.id, row.d);
  return row.d;
}

/** seed.js'in ürettiği sentetik satırları ve yalnızca onlardan oluşan varlıkları siler. */
export async function purgeSampleData(db) {
  db.exec('BEGIN');
  try {
    const rows = db.prepare("DELETE FROM daily_prices WHERE source = 'sample'").run().changes;
    const assets = db
      .prepare('DELETE FROM assets WHERE id NOT IN (SELECT DISTINCT asset_id FROM daily_prices)')
      .run().changes;
    db.exec('COMMIT');
    return { rows, assets };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Varlığı ve tüm fiyat geçmişini siler (fiyatlar ON DELETE CASCADE ile gider). */
export async function deleteAsset(db, symbol) {
  return db.prepare('DELETE FROM assets WHERE symbol = ?').run(symbol).changes > 0;
}

export async function getLatestDate(db, symbol) {
  const asset = await getAsset(db, symbol);
  if (!asset) return null;
  return db.prepare('SELECT MAX(date) AS d FROM daily_prices WHERE asset_id = ?').get(asset.id).d ?? null;
}

export async function hasRealData(db) {
  return Boolean(db.prepare("SELECT 1 FROM daily_prices WHERE source != 'sample' LIMIT 1").get());
}

export async function getState(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export async function setState(db, key, value) {
  db.prepare(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export async function recordSyncRun(db, { startedAt, finishedAt, ok, summary }) {
  db.prepare('INSERT INTO sync_runs (started_at, finished_at, ok, summary) VALUES (?, ?, ?, ?)').run(
    startedAt,
    finishedAt,
    ok ? 1 : 0,
    JSON.stringify(summary),
  );
}

export async function getLastSyncRun(db) {
  const row = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get();
  return row
    ? { startedAt: row.started_at, finishedAt: row.finished_at, ok: Boolean(row.ok), summary: JSON.parse(row.summary) }
    : null;
}

/** Son `limit` işlem gününün fiyatları, eskiden yeniye. */
export async function getRecentPrices(db, symbol, limit) {
  const asset = await getAsset(db, symbol);
  if (!asset) throw new Error(`Varlık bulunamadı: ${symbol}`);
  const rows = db
    .prepare(`SELECT ${PRICE_COLS} FROM daily_prices WHERE asset_id = ? ORDER BY date DESC LIMIT ?`)
    .all(asset.id, limit)
    .reverse();
  return { asset, rows };
}
