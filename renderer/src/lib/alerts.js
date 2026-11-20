// Alarm arayüzünün saf yardımcıları (React yok; node --test ile sınanır).

export const TYPE_OPTIONS = [
  { id: 'price', label: 'Fiyat eşiği' },
  { id: 'daily_change', label: 'Günlük değişim' },
  { id: 'avg_deviation', label: 'Ortalama kıyası' },
  { id: 'portfolio_loss', label: 'Zarar sınırı' },
];

export const TYPE_HINTS = {
  price: 'Fiyat belirlediğin eşiği geçince haber verir.',
  daily_change: 'Fiyat bir önceki kapanışa göre belirlediğin yüzdeden fazla oynayınca haber verir.',
  avg_deviation: 'Fiyat son günlerin ortalamasının belirlediğin yüzde kadar altına inince haber verir (alım fırsatı kolaylaştırıcı).',
  portfolio_loss: 'Hisselerdeki toplam zarar sınıra yaklaşınca ve aşınca haber verir. "Sat" demez, yalnızca durup gözden geçirmeni söyler. Sınır ve oran Ayarlar sekmesinde.',
};

export const DIRECTION_OPTIONS = {
  price: [
    { id: 'below', label: 'Altına düşerse' },
    { id: 'above', label: 'Üstüne çıkarsa' },
  ],
  daily_change: [
    { id: 'down', label: 'Düşerse' },
    { id: 'up', label: 'Yükselirse' },
  ],
};

const nf = (value, max = 2) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: max }).format(value);

export const formatNumber = nf;

/** Varlığın görünen adı: BİST kodu olduğu gibi, özel varlıklar adıyla (ons altın "(vadeli)" ile). */
export function assetLabel(symbol, assets = []) {
  const found = assets.find((a) => a.symbol === symbol);
  return found && found.kind !== 'bist' ? found.name : symbol;
}

const unitOf = (symbol, assets) => assets.find((a) => a.symbol === symbol)?.unit ?? 'TL';

/** "BIMAS 385 TL'nin altına düşerse" gibi okunaklı tek satır kural açıklaması. */
export function describeAlarm(alarm, assets = [], settings = null) {
  const label = assetLabel(alarm.symbol, assets);
  const p = alarm.params ?? {};
  switch (alarm.type) {
    case 'price':
      return `${label}: fiyat ${nf(p.threshold, 4)} ${unitOf(alarm.symbol, assets)} ${p.direction === 'below' ? 'altına düşerse' : 'üstüne çıkarsa'}`;
    case 'daily_change':
      return `${label}: bugün %${nf(p.percent)} ${p.direction === 'down' ? 'düşerse' : 'yükselirse'}`;
    case 'avg_deviation':
      return `${label}: fiyat ${p.days ?? 20} günlük ortalamanın %${nf(p.percent)} altına inerse`;
    case 'portfolio_loss':
      return settings
        ? `Hisse zararı ${nf(settings.lossLimitTry, 0)} TL sınırının %${nf(settings.lossWarnRatio * 100, 1)} seviyesine ulaşınca ve sınırı aşınca`
        : 'Hisse zararı sınıra yaklaşınca ve aşınca';
    default:
      return alarm.name;
  }
}

/** Son kontrolde ölçülen değer (alarm listesinde kısa bilgi). */
export function lastValueText(alarm, assets = []) {
  const v = alarm.state?.lastValue;
  if (v == null || !alarm.state?.initialized) return null;
  switch (alarm.type) {
    case 'price':
      return `Son fiyat ${nf(v, alarm.symbol === 'USDTRY' ? 4 : 2)} ${unitOf(alarm.symbol, assets)}`;
    case 'daily_change':
      return `Bugün %${nf(v, 2)}`;
    case 'avg_deviation':
      return v >= 0 ? `Ortalamanın %${nf(v, 1)} altında` : `Ortalamanın %${nf(-v, 1)} üstünde`;
    case 'portfolio_loss':
      return `Şu anki zarar ${nf(v, 0)} TL`;
    default:
      return null;
  }
}

export function formatWhen(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Ayarlardaki oran (0,8) <-> formdaki yüzde (80) */
export const ratioToPercent = (ratio) => Math.round(ratio * 1000) / 10;
export const percentToRatio = (percent) => Number(String(percent).replace(',', '.')) / 100;

/** Alarm durumu -> rozet tonu */
export function statusTone(alarm) {
  if (!alarm.enabled) return 'neutral';
  if (alarm.status?.startsWith('Beklemede') || alarm.status === 'İlk fiyat bekleniyor') return 'warning';
  if (alarm.type === 'portfolio_loss' && alarm.state?.stage === 'over') return 'down';
  if (alarm.type === 'portfolio_loss' && alarm.state?.stage === 'warn') return 'warning';
  return 'up';
}

/** Form durumundan sunucuya gidecek alarm girdisi. Doğrulama sunucuda; burada yalnızca alanları eşler. */
export function formToAlarmInput(form, id) {
  const input = { type: form.type, name: form.name, once: form.once, cooldownHours: form.cooldownHours === '' ? undefined : form.cooldownHours };
  if (id) input.id = id;
  if (form.type !== 'portfolio_loss') input.symbol = form.symbol;
  if (form.type === 'price') Object.assign(input, { direction: form.direction, threshold: form.threshold });
  if (form.type === 'daily_change') Object.assign(input, { direction: form.direction, percent: form.percent });
  if (form.type === 'avg_deviation') Object.assign(input, { percent: form.percent });
  return input;
}

/** Var olan alarmdan form durumu (düzenleme). */
export function alarmToForm(alarm) {
  const p = alarm.params ?? {};
  return {
    type: alarm.type,
    symbol: alarm.symbol ?? '',
    name: alarm.name ?? '',
    direction: p.direction ?? (alarm.type === 'daily_change' ? 'down' : 'below'),
    threshold: p.threshold != null ? String(p.threshold).replace('.', ',') : '',
    percent: p.percent != null ? String(p.percent).replace('.', ',') : '',
    cooldownHours: String(alarm.cooldownHours ?? ''),
    once: Boolean(alarm.once),
  };
}

export const emptyForm = (assets) => ({
  type: 'price',
  symbol: assets[0]?.symbol ?? '',
  name: '',
  direction: 'below',
  threshold: '',
  percent: '',
  cooldownHours: '',
  once: false,
});
