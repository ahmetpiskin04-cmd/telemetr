import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alarmToForm,
  assetLabel,
  describeAlarm,
  emptyForm,
  formToAlarmInput,
  lastValueText,
  percentToRatio,
  ratioToPercent,
  statusTone,
} from '../renderer/src/lib/alerts.js';
import { normalizeAlarm } from '../src/alerts/store.js';

const assets = [
  { symbol: 'BIMAS', name: 'BIMAS', unit: 'TL', kind: 'bist' },
  { symbol: 'ONS_ALTIN', name: 'Ons altın (vadeli)', unit: 'USD', kind: 'yahoo' },
  { symbol: 'USDTRY', name: 'USD/TRY', unit: 'TL', kind: 'yahoo' },
];

test('assetLabel: BİST kodu olduğu gibi, özel varlık adıyla (ons "vadeli")', () => {
  assert.equal(assetLabel('BIMAS', assets), 'BIMAS');
  assert.equal(assetLabel('ONS_ALTIN', assets), 'Ons altın (vadeli)');
  assert.equal(assetLabel('XYZ', assets), 'XYZ');
});

test('describeAlarm: dört tür okunaklı tek satır', () => {
  assert.equal(describeAlarm({ type: 'price', symbol: 'BIMAS', params: { direction: 'below', threshold: 385 } }, assets), 'BIMAS: fiyat 385 TL altına düşerse');
  assert.equal(describeAlarm({ type: 'price', symbol: 'ONS_ALTIN', params: { direction: 'above', threshold: 3600.5 } }, assets), 'Ons altın (vadeli): fiyat 3.600,5 USD üstüne çıkarsa');
  assert.equal(describeAlarm({ type: 'daily_change', symbol: 'BIMAS', params: { direction: 'down', percent: 3 } }, assets), 'BIMAS: bugün %3 düşerse');
  assert.equal(describeAlarm({ type: 'avg_deviation', symbol: 'BIMAS', params: { percent: 5, days: 20 } }, assets), 'BIMAS: fiyat 20 günlük ortalamanın %5 altına inerse');
  assert.equal(
    describeAlarm({ type: 'portfolio_loss', params: {} }, assets, { lossLimitTry: 1800, lossWarnRatio: 0.8 }),
    'Hisse zararı 1.800 TL sınırının %80 seviyesine ulaşınca ve sınırı aşınca',
  );
});

test('lastValueText: türe göre; başlangıç durumu yoksa boş', () => {
  const st = (lastValue) => ({ initialized: true, lastValue });
  assert.equal(lastValueText({ type: 'price', symbol: 'BIMAS', state: st(380.1) }, assets), 'Son fiyat 380,1 TL');
  assert.equal(lastValueText({ type: 'price', symbol: 'USDTRY', state: st(50.5768) }, assets), 'Son fiyat 50,5768 TL');
  assert.equal(lastValueText({ type: 'avg_deviation', symbol: 'BIMAS', state: st(2.34) }, assets), 'Ortalamanın %2,3 altında');
  assert.equal(lastValueText({ type: 'avg_deviation', symbol: 'BIMAS', state: st(-1) }, assets), 'Ortalamanın %1 üstünde');
  assert.equal(lastValueText({ type: 'portfolio_loss', state: st(1512) }, assets), 'Şu anki zarar 1.512 TL');
  assert.equal(lastValueText({ type: 'price', symbol: 'BIMAS', state: { initialized: false, lastValue: null } }, assets), null);
});

test('oran <-> yüzde dönüşümü', () => {
  assert.equal(ratioToPercent(0.8), 80);
  assert.equal(ratioToPercent(0.755), 75.5);
  assert.equal(percentToRatio('80'), 0.8);
  assert.equal(percentToRatio('72,5'), 0.725);
});

test('statusTone: beklemede ve uyarı sarı, aşıldı kırmızı, normal yeşil', () => {
  assert.equal(statusTone({ enabled: false }), 'neutral');
  assert.equal(statusTone({ enabled: true, status: 'Beklemede: fiyat henüz eşiğin güvenli tarafına dönmedi' }), 'warning');
  assert.equal(statusTone({ enabled: true, status: 'Aktif', type: 'price' }), 'up');
  assert.equal(statusTone({ enabled: true, status: 'Sınır aşıldı; uyarı verildi', type: 'portfolio_loss', state: { stage: 'over' } }), 'down');
});

test('form <-> alarm: gidiş dönüş sunucu doğrulamasından geçer', () => {
  const form = { ...emptyForm(assets), symbol: 'BIMAS', threshold: '385,5', cooldownHours: '' };
  const input = formToAlarmInput(form);
  assert.equal(input.cooldownHours, undefined, 'boş bekleme süresi ayarlardaki varsayılana düşer');
  const alarm = normalizeAlarm(input);
  assert.equal(alarm.params.threshold, 385.5);

  const back = alarmToForm(alarm);
  assert.equal(back.threshold, '385,5');
  assert.equal(back.cooldownHours, '24');
  assert.deepEqual(normalizeAlarm(formToAlarmInput(back, alarm.id)).params, alarm.params);

  const daily = normalizeAlarm(formToAlarmInput({ ...emptyForm(assets), type: 'daily_change', symbol: 'BIMAS', direction: 'down', percent: '3' }));
  assert.deepEqual(daily.params, { direction: 'down', percent: 3 });
  const avg = normalizeAlarm(formToAlarmInput({ ...emptyForm(assets), type: 'avg_deviation', symbol: 'BIMAS', percent: '5' }));
  assert.deepEqual(avg.params, { percent: 5, days: 20 });
  const loss = normalizeAlarm(formToAlarmInput({ ...emptyForm(assets), type: 'portfolio_loss' }));
  assert.equal(loss.symbol, null);
});
