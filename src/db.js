import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_DB_PATH = path.resolve(import.meta.dirname, '..', 'data', 'finans.db');

export const ASSET_TYPES = Object.freeze({
  BIST_STOCK: 'BIST_STOCK', // BİST hissesi (adet)
  PRECIOUS_METAL: 'PRECIOUS_METAL', // Fiziksel altın / gümüş (gram)
  FUND: 'FUND', // TEFAS yatırım fonu (pay)
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY,
  symbol      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  asset_type  TEXT NOT NULL CHECK (asset_type IN ('BIST_STOCK', 'PRECIOUS_METAL', 'FUND')),
  currency    TEXT NOT NULL DEFAULT 'TRY',
  unit        TEXT NOT NULL DEFAULT 'adet',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fonlar günde tek fiyat açıkladığı için open/high/low/volume opsiyoneldir; close zorunludur.
-- (asset_id, date) birincil anahtarı aynı zamanda tarih aralığı sorgularının indeksidir.
CREATE TABLE IF NOT EXISTS daily_prices (
  asset_id  INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date      TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  open      REAL CHECK (open  IS NULL OR open  > 0),
  high      REAL CHECK (high  IS NULL OR high  > 0),
  low       REAL CHECK (low   IS NULL OR low   > 0),
  close     REAL NOT NULL CHECK (close > 0),
  volume    REAL CHECK (volume IS NULL OR volume >= 0),
  source    TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (asset_id, date)
) WITHOUT ROWID;

-- Her veri güncelleme çalışmasının özeti (arayüzdeki "son güncelleme" bilgisi buradan gelir)
CREATE TABLE IF NOT EXISTS sync_runs (
  id           INTEGER PRIMARY KEY,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  ok           INTEGER NOT NULL DEFAULT 0,
  summary      TEXT
);

-- Küçük anahtar-değer deposu (ör. kıymetli maden kalibrasyon katsayıları)
CREATE TABLE IF NOT EXISTS sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

// Sonradan eklenen sütunlar. Hem yeni hem eski veritabanları bu yoldan geçer.
// bid/ask: fiziksel altın-gümüşte alış/satış fiyatı; makas (spread) bunlardan hesaplanır.
const ADDED_COLUMNS = [
  ['daily_prices', 'bid', 'REAL CHECK (bid IS NULL OR bid > 0)'],
  ['daily_prices', 'ask', 'REAL CHECK (ask IS NULL OR ask > 0)'],
];

function migrate(db) {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const exists = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Veritabanını açar ve şemayı (yoksa) oluşturur.
 * Yol önceliği: parametre > FINANS_DB ortam değişkeni > data/finans.db
 */
export function openDatabase(dbPath = process.env.FINANS_DB ?? DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
