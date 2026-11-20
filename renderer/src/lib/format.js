// Türkçe sayı biçimleri: 8.325,40 · +%2,05 · ₺1.234.567
const formatters = new Map();
function nf(min, max, extra = {}) {
  const key = `${min}-${max}-${JSON.stringify(extra)}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra }));
  }
  return formatters.get(key);
}

export const DASH = '—';

/** Fiyat ölçeğine göre hane: 10 ve üstü 2, altı 4 (fon fiyatları için). */
export function fmtPrice(v) {
  if (v == null) return DASH;
  const d = Math.abs(v) >= 10 ? 2 : 4;
  return nf(d, d).format(v);
}

export function fmtNum(v, digits = 2) {
  return v == null ? DASH : nf(digits, digits).format(v);
}

export function fmtPct(v, { signed = true, digits = 2 } = {}) {
  if (v == null) return DASH;
  const sign = v > 0 ? (signed ? '+' : '') : v < 0 ? '−' : '';
  return `${sign}%${nf(digits, digits).format(Math.abs(v))}`;
}

export function fmtMoney(v, currency = 'TRY') {
  if (v == null) return DASH;
  return nf(0, 0, { style: 'currency', currency }).format(v);
}

export function fmtCompact(v) {
  return v == null ? DASH : nf(0, 1, { notation: 'compact' }).format(v);
}

/**
 * Kullanıcının yazdığı sayıyı okur: "1.234,56", "160,5" ve "160.5" hepsi geçerli.
 * Boşsa null; okunamıyorsa NaN.
 */
export function parseNumberInput(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '');
  if (s === '') return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

/** Sayıyı form alanında göstermek için Türkçe biçime çevirir (binlik ayırıcısız). */
export function numberToInput(v) {
  return v == null ? '' : String(v).replace('.', ',');
}

/** Yön rengi: pozitif yeşil, negatif kırmızı, sıfır/null nötr. */
export function tone(v) {
  if (v == null || v === 0) return 'text-fg-muted';
  return v > 0 ? 'text-up' : 'text-down';
}

export const TYPE_LABELS = {
  BIST_STOCK: 'BİST Hisse',
  PRECIOUS_METAL: 'Kıymetli Maden',
  FUND: 'Yatırım Fonu',
};
