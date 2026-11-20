// Gram altın / gümüş (TRY) günlük serisi.
//
// Sorun: Harem fiziksel alış/satışı yalnızca anlık verir, geçmiş vermez. Yahoo'da spot ons
// (XAUUSD=X) kaldırılmış; vadeli kontratlar (GC=F) ise kontrat devrinde yapay sıçrama yapar.
//
// Çözüm:
//  1. Şekil: ETF (GLD/SLV, spotu izler, devir sıçraması yok) × USDTRY -> ham seri
//  2. Seviye: ham seri × katsayı. Katsayı = referans gram fiyat / son ham değer.
//     Referans Harem'den (altın: has gram, gümüş: XAGUSD × USDTRY / 31.1035).
//     Harem ile Yahoo kapanışı aynı anda olmadığı için tek ölçüm gürültülüdür: son
//     ölçümlerin medyanı kullanılır. Harem hiç ölçülmemişse vadeli ons fiyatından hesaplanır.
//  3. Makas: Harem'in fiziksel külçe/gram alış-satışı, kotasyon gününün satırına yazılır.

export const TROY_OUNCE_GRAMS = 31.1034768;
const MAX_CALIBRATIONS = 15;

export const METALS = {
  GRAM_ALTIN: {
    name: 'Gram Altın (24 ayar)',
    etf: 'GLD',
    future: 'GC=F',
    physicalCode: 'KULCEALTIN', // gram külçe: kuyumcudaki gerçek alış/satış
    reference: (q) => q.get('ALTIN')?.mid, // has altın gram
    referenceDate: (q) => q.get('ALTIN')?.date,
    referenceCodes: ['ALTIN'],
  },
  GRAM_GUMUS: {
    name: 'Gram Gümüş',
    etf: 'SLV',
    future: 'SI=F',
    physicalCode: 'GUMUSTRY',
    reference: (q) => (q.has('XAGUSD') && q.has('USDTRY') ? (q.get('XAGUSD').mid * q.get('USDTRY').mid) / TROY_OUNCE_GRAMS : undefined),
    referenceDate: (q) => q.get('XAGUSD')?.date,
    referenceCodes: ['XAGUSD', 'USDTRY'],
  },
};

export const HAREM_CODES = [...new Set(Object.values(METALS).flatMap((m) => [m.physicalCode, ...m.referenceCodes]))];

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** ETF mumları × aynı günün USDTRY kapanışı. Yalnızca iki seride de olan günler. */
export function combineWithFx(etfRows, fxRows) {
  const fx = new Map(fxRows.map((r) => [r.date, r.close]));
  return etfRows
    .filter((r) => fx.has(r.date))
    .map((r) => {
      const k = fx.get(r.date);
      const scale = (v) => (v == null ? null : v * k);
      return { date: r.date, open: scale(r.open), high: scale(r.high), low: scale(r.low), close: r.close * k };
    });
}

/**
 * Katsayıyı belirler. calibrations: önceki Harem ölçümleri [{ date, factor }] (sync_state'te
 * saklanır). Gün başına bir ölçüm tutulur (aynı gün tekrar senkronize edilirse sonuncusu
 * geçerli); son MAX_CALIBRATIONS günün medyanı kullanılır.
 * Dönüş: { factor, method, calibrations } — calibrations güncellenmiş liste.
 */
export function calibrate({ raw, haremReference, haremDate, futureGram, calibrations = [] }) {
  const lastRaw = raw.at(-1)?.close;
  if (!(lastRaw > 0)) throw new Error('Kalibrasyon için ham seri boş');
  let list = calibrations;
  if (haremReference > 0 && haremDate) {
    list = [...calibrations.filter((c) => c.date !== haremDate), { date: haremDate, factor: haremReference / lastRaw }]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_CALIBRATIONS);
  }
  if (list.length > 0) {
    return { factor: median(list.map((c) => c.factor)), method: `harem (${list.length} günlük ölçüm medyanı)`, calibrations: list };
  }
  if (futureGram > 0) return { factor: futureGram / lastRaw, method: 'vadeli ons (Harem ölçümü yok)', calibrations: list };
  throw new Error('Kalibrasyon referansı yok (ne Harem ne vadeli fiyat)');
}

export function applyFactor(rows, factor) {
  const f = (v) => (v == null ? null : v * factor);
  return rows.map((r) => ({ date: r.date, open: f(r.open), high: f(r.high), low: f(r.low), close: r.close * factor }));
}
