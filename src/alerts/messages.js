// Bildirim metinleri: kısa, Türkçe, tek satır. Alarm "sat/al" demez, yalnızca durumu bildirir.

const nf = (value, min, max) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max }).format(value);

/** Fiyat: iki ondalık (kur için dört): "380,10 TL", "3.590,70 USD", "50,5768 TL" */
export function formatPrice(value, quote) {
  const digits = quote.symbol === 'USDTRY' ? 4 : 2;
  return `${nf(value, digits, digits)} ${quote.unit}`;
}

/** Eşik: gereksiz sıfır yok: "385 TL", "385,5 TL" */
export function formatThreshold(value, quote) {
  return `${nf(value, 0, 4)} ${quote.unit}`;
}

export const formatPercent = (value) => nf(Math.abs(value), 0, 2);
export const formatTry = (value) => `${nf(value, 0, 0)} TL`;

/** Başlık: "BIMAS 380,10 TL" · "Ons altın (vadeli) 3.590,70 USD". Gecikmeli veri notu cümlenin sonuna eklenir. */
const head = (quote) => `${quote.name} ${formatPrice(quote.price, quote)}`;
const delayNote = (quote) => (quote?.delayed ? ' (gecikmeli veri)' : '');

export const messages = {
  price(alarm, quote) {
    const { direction, threshold } = alarm.params;
    const verb = direction === 'below' ? 'altına indi' : 'üstüne çıktı';
    return `${head(quote)}: belirlediğin ${formatThreshold(threshold, quote)} alarmının ${verb}.${delayNote(quote)}`;
  },

  dailyChange(alarm, quote, changePercent) {
    const verb = changePercent < 0 ? 'düştü' : 'yükseldi';
    return `${head(quote)}: bugün %${formatPercent(changePercent)} ${verb}; belirlediğin %${formatPercent(alarm.params.percent)} sınırını aştı.${delayNote(quote)}`;
  },

  avgDeviation(alarm, quote, average, deviationPercent) {
    const { days, percent } = alarm.params;
    return `${head(quote)}: ${days} günlük ortalamanın (${formatPrice(average, quote)}) %${formatPercent(deviationPercent)} altına indi; belirlediğin eşik %${formatPercent(percent)}.${delayNote(quote)}`;
  },

  /** Zarar sınırına yaklaşma (stage: warn) ve aşma (stage: over). "Sat" demez. */
  lossStage(stage, lossTry, settings) {
    const ratioPercent = Math.round((lossTry / settings.lossLimitTry) * 100);
    if (stage === 'over') {
      return `Hisse zararın ${formatTry(lossTry)}; belirlediğin ${formatTry(settings.lossLimitTry)} sınırını aştı. Durup gözden geçirme zamanı.`;
    }
    return `Hisse zararın ${formatTry(lossTry)}; belirlediğin ${formatTry(settings.lossLimitTry)} sınırının %${ratioPercent} seviyesinde. Durup gözden geçirme zamanı.`;
  },

  /** Alarm kurulurken zarar zaten uyarı seviyesindeyse bir kez gönderilen bilgi mesajı. */
  lossInfo(lossTry, settings) {
    const ratioPercent = Math.round((lossTry / settings.lossLimitTry) * 100);
    return `Bilgi: şu an hisse zararın ${formatTry(lossTry)}, belirlediğin ${formatTry(settings.lossLimitTry)} sınırının %${ratioPercent} seviyesinde. Durup gözden geçirme zamanı.`;
  },
};
