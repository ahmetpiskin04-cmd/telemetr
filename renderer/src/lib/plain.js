// Teknik göstergeleri teknik analiz bilmeyen biri için sade Türkçeye çevirir.
// Eşikler AI promptundaki yorumlama kurallarıyla aynı (src/ai/prompt.js §3).
import { fmtNum, fmtPct } from './format.js';

/** Yön + güç: skor yönü verir, R² ne kadar "düz bir çizgi" gibi gittiğini (gücü). */
export function plainTrend(f) {
  if (f.trendDirection == null) return null;
  const strength = f.trendR2 == null ? '' : f.trendR2 >= 0.6 ? 'Güçlü ' : f.trendR2 >= 0.3 ? '' : 'Zayıf ';
  if (f.trendDirection === 'yatay' || (f.trendR2 != null && f.trendR2 < 0.15)) {
    return { label: 'Yatay', tone: 'neutral', detail: 'Belirgin bir yükseliş ya da düşüş yok; fiyat bir aralıkta gidip geliyor.' };
  }
  const up = f.trendDirection === 'yükseliş';
  return {
    label: `${strength}${up ? 'yükseliş' : 'düşüş'}`.replace(/^./, (c) => c.toLocaleUpperCase('tr-TR')),
    tone: up ? 'up' : 'down',
    detail: `Son 30 günde fiyat ${up ? 'genel olarak yükseldi' : 'genel olarak düştü'}${
      f.trendR2 >= 0.6 ? ' ve bu hareket istikrarlı' : f.trendR2 < 0.3 ? ', ama hareket dalgalı' : ''
    }.`,
  };
}

/** Fiyatın son 20 günün ortalamasına göre yeri. */
export function plainAverage(f) {
  if (f.priceVsSmaLongPct == null) return null;
  const d = f.priceVsSmaLongPct;
  const near = Math.abs(d) < 1;
  return {
    label: near ? 'Ortalamada' : d > 0 ? 'Ortalamanın üstünde' : 'Ortalamanın altında',
    tone: near ? 'neutral' : d > 0 ? 'up' : 'down',
    value: fmtPct(d),
    detail: near ? 'Fiyat son 20 günün ortalamasına çok yakın.' : `Fiyat son 20 günün ortalamasından ${fmtPct(Math.abs(d), { signed: false, digits: 1 })} ${d > 0 ? 'yukarıda' : 'aşağıda'}.`,
  };
}

// Günde %0,3'ten az oynayan varlıklarda (kira sertifikası / para piyasası fonları) fiyat her gün
// az az yükseldiği için RSI hep ~100 çıkar; bu "aşırı alım" değildir, uyarı verilmez.
export const isLowVolatility = (f) => f.volDailyPct != null && f.volDailyPct < 0.3;

/** RSI: kısa sürede aşırı hareket var mı? */
export function plainRsi(f) {
  if (f.rsi == null) return null;
  if (isLowVolatility(f)) {
    return { label: 'Sakin, istikrarlı', tone: 'neutral', value: `RSI ${fmtNum(f.rsi, 0)}`, detail: 'Fiyat her gün az az değişiyor; bu varlıkta RSI anlamlı bir uyarı vermez.' };
  }
  if (f.rsi >= 70) {
    return { label: 'Çok hızlı yükseldi', tone: 'warning', value: `RSI ${fmtNum(f.rsi, 0)}`, detail: 'Kısa sürede çok alındı; bir miktar geri çekilme görülebilir ama kesin değil.' };
  }
  if (f.rsi <= 30) {
    return { label: 'Çok hızlı düştü', tone: 'warning', value: `RSI ${fmtNum(f.rsi, 0)}`, detail: 'Kısa sürede çok satıldı; tepki yükselişi görülebilir ama kesin değil.' };
  }
  return { label: 'Normal', tone: 'neutral', value: `RSI ${fmtNum(f.rsi, 0)}`, detail: 'Ne aşırı alım ne aşırı satım var.' };
}

/** MACD histogramı: hareketin hızı artıyor mu azalıyor mu? */
export function plainMomentum(f, events = []) {
  if (f.macdHist == null) return null;
  const recent = [...events].reverse().find((e) => e.indicator === 'MACD' && e.barsAgo <= 5);
  const turn = recent ? ` ${recent.barsAgo === 0 ? 'Bugün' : `${recent.barsAgo} gün önce`} yön değiştirdi.` : '';
  return f.macdHist > 0
    ? { label: 'Güçleniyor', tone: 'up', detail: `Son günlerde alıcılar ağır basıyor.${turn}` }
    : { label: 'Zayıflıyor', tone: 'down', detail: `Son günlerde satıcılar ağır basıyor.${turn}` };
}

/** Günlük ortalama oynama. */
export function plainVolatility(f) {
  if (f.volDailyPct == null) return null;
  const v = f.volDailyPct;
  const label = v < 1 ? 'Sakin' : v < 2.5 ? 'Orta' : 'Hareketli';
  return { label, tone: 'neutral', value: `günde ±${fmtPct(v, { signed: false, digits: 1 })}`, detail: `Fiyat bir günde ortalama ${fmtPct(v, { signed: false, digits: 1 })} kadar oynuyor.` };
}

/** Fiziksel altın/gümüşte alış-satış farkı. */
export function plainSpread(f) {
  if (f.spreadPct == null) return null;
  const high = f.spreadVsAvg != null && f.spreadVsAvg >= 1.3;
  return {
    label: high ? 'Fark normalden yüksek' : `%${fmtNum(f.spreadPct, 2)}`,
    tone: high ? 'warning' : 'neutral',
    detail: `Kuyumcuda alıp hemen geri satsanız yaklaşık ${fmtPct(f.spreadPct, { signed: false })} kaybedersiniz.`,
  };
}
