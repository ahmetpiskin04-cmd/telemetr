import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmStatusText, computePortfolioLoss, evaluateAlarm, lossStage } from '../src/alerts/evaluate.js';
import { DEFAULT_SETTINGS, normalizeAlarm } from '../src/alerts/store.js';

const T0 = new Date('2026-11-20T08:00:00Z');
const hoursLater = (h) => new Date(T0.getTime() + h * 3_600_000);

const quote = (symbol, price, extra = {}) => ({
  symbol,
  name: symbol,
  price,
  previousClose: null,
  unit: 'TL',
  delayed: false,
  futures: false,
  marketOpen: true,
  ...extra,
});

const make = (input) => normalizeAlarm(input, DEFAULT_SETTINGS);
const ctx = (now = T0, extra = {}) => ({ now, settings: DEFAULT_SETTINGS, canNotify: true, ...extra });

/** Değerlendirir ve sonucu alarma uygular (depodaki applyAlarmUpdates'in yaptığı gibi). */
function step(alarm, snapshot, c = ctx()) {
  const result = evaluateAlarm(alarm, snapshot, c);
  if (!result) return { alarm, notification: null, skipped: true };
  const { patch } = result;
  const next = {
    ...alarm,
    state: { ...alarm.state, ...patch.state },
    lastTriggeredAt: patch.lastTriggeredAt ?? alarm.lastTriggeredAt,
    enabled: patch.enabled ?? alarm.enabled,
  };
  return { alarm: next, notification: result.notification, skipped: false };
}

const below385 = () => make({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385 });
const px = (price, extra) => ({ quote: quote('BIMAS', price, extra) });

// ---- eşik geçişi -------------------------------------------------------------------------------

test('fiyat eşiği: eşiğin üstünden aşağı geçişte tetiklenir, metin istenen biçimde', () => {
  let a = below385();
  ({ alarm: a } = step(a, px(390))); // ilk gözlem: eşiğin güvenli tarafında -> silahlı
  assert.equal(a.state.armed, true);
  const r = step(a, px(380.1));
  assert.equal(r.notification.kind, 'alert');
  assert.equal(r.notification.text, 'BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi.');
  assert.equal(r.alarm.lastTriggeredAt, T0.toISOString());
  assert.equal(r.alarm.state.armed, false);
});

test('fiyat eşiği: "üstüne çıkarsa" yönü', () => {
  let a = make({ type: 'price', symbol: 'ASELS', direction: 'above', threshold: 400 });
  ({ alarm: a } = step(a, { quote: quote('ASELS', 390) }));
  const r = step(a, { quote: quote('ASELS', 401.5) });
  assert.equal(r.notification.text, 'ASELS 401,50 TL: belirlediğin 400 TL alarmının üstüne çıktı.');
});

test('eşiğe tam eşitlik geçiş sayılmaz (altına düşerse = kesin küçük)', () => {
  let a = below385();
  ({ alarm: a } = step(a, px(390)));
  assert.equal(step(a, px(385)).notification, null);
});

test('eklendiği anda eşiğin ötesindeyse tetiklenmez, "beklemede" kaydedilir; yalnızca sonraki geçişte tetiklenir', () => {
  let a = below385();
  let r = step(a, px(370)); // kurulum anında zaten 385'in altında
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.initialized, true);
  assert.equal(r.alarm.state.armed, false);
  assert.equal(alarmStatusText(r.alarm), 'Beklemede: fiyat henüz eşiğin güvenli tarafına dönmedi');

  r = step(r.alarm, px(365)); // hâlâ ötesinde: sessiz
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.armed, false);

  r = step(r.alarm, px(392)); // güvenli tarafa döndü: silahlandı, bildirim yok
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.armed, true);
  assert.equal(alarmStatusText(r.alarm), 'Aktif');

  r = step(r.alarm, px(380)); // sonraki geçiş: tetiklenir
  assert.ok(r.notification);
});

test('tetiklendikten sonra eşiğin ötesinde kaldığı sürece tekrar bildirim gelmez', () => {
  let a = below385();
  ({ alarm: a } = step(a, px(390)));
  let r = step(a, px(380));
  assert.ok(r.notification);
  r = step(r.alarm, px(375), ctx(hoursLater(48))); // bekleme süresi bitse bile geçiş yok
  assert.equal(r.notification, null);
});

// ---- bekleme süresi ve tek seferlik --------------------------------------------------------------

test('bekleme süresi (varsayılan 24 saat): içindeki ikinci geçiş sessiz geçilir, sonrası tetiklenir', () => {
  let a = below385();
  ({ alarm: a } = step(a, px(390)));
  let r = step(a, px(380));
  assert.ok(r.notification);
  a = r.alarm;

  ({ alarm: a } = step(a, px(390), ctx(hoursLater(2)))); // yeniden silahlandı
  r = step(a, px(381), ctx(hoursLater(3))); // 3 saat sonra yine geçti: bekleme süresinde
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.armed, false, 'geçiş tüketildi');
  assert.equal(r.alarm.lastTriggeredAt, T0.toISOString(), 'son tetiklenme değişmedi');

  ({ alarm: a } = step(r.alarm, px(391), ctx(hoursLater(25))));
  r = step(a, px(380), ctx(hoursLater(26))); // 24 saati geçti
  assert.ok(r.notification);
  assert.equal(r.alarm.lastTriggeredAt, hoursLater(26).toISOString());
});

test('bekleme süresi 0: her geçiş bildirir', () => {
  let a = make({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385, cooldownHours: 0 });
  ({ alarm: a } = step(a, px(390)));
  let r = step(a, px(380));
  assert.ok(r.notification);
  ({ alarm: a } = step(r.alarm, px(390), ctx(hoursLater(0.1))));
  assert.ok(step(a, px(380), ctx(hoursLater(0.2))).notification);
});

test('tek seferlik alarm tetiklenince kapanır', () => {
  let a = make({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385, once: true });
  ({ alarm: a } = step(a, px(390)));
  const r = step(a, px(380));
  assert.ok(r.notification);
  assert.equal(r.alarm.enabled, false);
  assert.equal(alarmStatusText(r.alarm), 'Kapalı');
  assert.equal(evaluateAlarm(r.alarm, px(370), ctx()), null, 'kapalı alarm değerlendirilmez');
});

// ---- seans dışı ----------------------------------------------------------------------------------

test('seans dışı (canNotify=false): geçiş bildirilmez ama tüketilmez; seans açılınca bildirilir', () => {
  let a = below385();
  ({ alarm: a } = step(a, px(390)));
  let r = step(a, px(380), ctx(T0, { canNotify: false }));
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.armed, true, 'silahlı kaldı');
  assert.equal(r.alarm.lastTriggeredAt, null);
  r = step(r.alarm, px(380), ctx(hoursLater(1), { canNotify: true }));
  assert.ok(r.notification);
});

test('seans dışında da ilk gözlem (başlangıç durumu) kaydedilir', () => {
  const r = step(below385(), px(370), ctx(T0, { canNotify: false }));
  assert.equal(r.alarm.state.initialized, true);
  assert.equal(r.alarm.state.armed, false);
});

// ---- veri yok ------------------------------------------------------------------------------------

test('veri yoksa alarm sessizce atlanır: null döner, durum değişmez', () => {
  const a = below385();
  assert.equal(evaluateAlarm(a, { quote: null }, ctx()), null);
  assert.equal(evaluateAlarm(a, {}, ctx()), null);
  const daily = make({ type: 'daily_change', symbol: 'ASELS', direction: 'down', percent: 3 });
  assert.equal(evaluateAlarm(daily, { quote: quote('ASELS', 100, { previousClose: null }) }, ctx()), null, 'önceki kapanış yok');
  const avg = make({ type: 'avg_deviation', symbol: 'ASELS', percent: 5 });
  assert.equal(evaluateAlarm(avg, { quote: quote('ASELS', 100), closes: null }, ctx()), null, 'geçmiş yok');
  assert.equal(evaluateAlarm(avg, { quote: quote('ASELS', 100), closes: [1, 2, 3] }, ctx()), null, 'yetersiz geçmiş');
});

// ---- günlük değişim ------------------------------------------------------------------------------

test('günlük değişim: bugün %N\'den fazla düşerse', () => {
  let a = make({ type: 'daily_change', symbol: 'ASELS', direction: 'down', percent: 3 });
  ({ alarm: a } = step(a, { quote: quote('ASELS', 99, { previousClose: 100 }) })); // -%1: silahlı
  assert.equal(a.state.armed, true);
  const r = step(a, { quote: quote('ASELS', 96.5, { previousClose: 100 }) });
  assert.equal(r.notification.text, 'ASELS 96,50 TL: bugün %3,5 düştü; belirlediğin %3 sınırını aştı.');
});

test('günlük değişim: yükselme yönü ve tam eşik (>=) tetikler', () => {
  let a = make({ type: 'daily_change', symbol: 'ASELS', direction: 'up', percent: 5 });
  ({ alarm: a } = step(a, { quote: quote('ASELS', 101, { previousClose: 100 }) }));
  const r = step(a, { quote: quote('ASELS', 105, { previousClose: 100 }) });
  assert.match(r.notification.text, /bugün %5 yükseldi/);
});

// ---- 20 günlük ortalama --------------------------------------------------------------------------

test('ortalama kıyası: fiyat 20 günlük ortalamanın %N altına inerse (alım fırsatı)', () => {
  const closes = Array.from({ length: 20 }, () => 100); // ortalama 100
  let a = make({ type: 'avg_deviation', symbol: 'EREGL', percent: 5 });
  ({ alarm: a } = step(a, { quote: quote('EREGL', 98), closes })); // %2 altında: silahlı
  assert.equal(a.state.armed, true);
  let r = step(a, { quote: quote('EREGL', 95.01), closes });
  assert.equal(r.notification, null, '%5 altına tam inmedi');
  r = step(r.alarm, { quote: quote('EREGL', 94), closes });
  assert.equal(r.notification.text, 'EREGL 94,00 TL: 20 günlük ortalamanın (100,00 TL) %6 altına indi; belirlediğin eşik %5.');
});

test('ortalama kıyası yalnızca son N kapanışı kullanır', () => {
  const closes = [...Array.from({ length: 10 }, () => 1000), ...Array.from({ length: 20 }, () => 100)];
  let a = make({ type: 'avg_deviation', symbol: 'EREGL', percent: 5 });
  ({ alarm: a } = step(a, { quote: quote('EREGL', 99), closes }));
  assert.ok(step(a, { quote: quote('EREGL', 90), closes }).notification);
});

// ---- bildirim metni: ons vadeli, gecikmeli veri ---------------------------------------------------

test('ons altın bildirimi "(vadeli)" der; kur 4 ondalıkla yazılır', () => {
  let a = make({ type: 'price', symbol: 'ONS_ALTIN', direction: 'below', threshold: 3600 });
  const ons = (price) => ({ quote: quote('ONS_ALTIN', price, { name: 'Ons altın (vadeli)', unit: 'USD', futures: true }) });
  ({ alarm: a } = step(a, ons(3650)));
  assert.equal(step(a, ons(3590.7)).notification.text, 'Ons altın (vadeli) 3.590,70 USD: belirlediğin 3.600 USD alarmının altına indi.');

  let k = make({ type: 'price', symbol: 'USDTRY', direction: 'above', threshold: 50.5 });
  const fx = (price) => ({ quote: quote('USDTRY', price, { name: 'USD/TRY' }) });
  ({ alarm: k } = step(k, fx(50.4)));
  assert.equal(step(k, fx(50.5768)).notification.text, 'USD/TRY 50,5768 TL: belirlediğin 50,5 TL alarmının üstüne çıktı.');
});

test('gecikmeli BİST verisinde bildirime "gecikmeli veri" notu eklenir', () => {
  let a = below385();
  ({ alarm: a } = step(a, px(390, { delayed: true })));
  assert.equal(step(a, px(380.1, { delayed: true })).notification.text, 'BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi. (gecikmeli veri)');
});

// ---- portföy zarar sınırı ------------------------------------------------------------------------

const portfolio = [
  { symbol: 'BIMAS', quantity: 10, avgCost: 400 },
  { symbol: 'TUPRS', quantity: 5, avgCost: 380 },
  { symbol: 'EREGL', quantity: 100, avgCost: 40 },
  { symbol: 'GRAM_ALTIN', quantity: 5 }, // hisse değil
  { symbol: 'KTV', quantity: 1000 }, // hisse değil
];
const stocks = new Set(['BIMAS', 'TUPRS', 'EREGL', 'ENJSA', 'ASELS']);
const quotesOf = (prices) => new Map(Object.entries(prices).map(([s, p]) => [s, quote(s, p)]));

test('computePortfolioLoss: yalnızca maliyeti girilmiş hisseler; net kârda sıfır; fiyat eksikse null', () => {
  const loss = computePortfolioLoss(portfolio, quotesOf({ BIMAS: 300, TUPRS: 350, EREGL: 30 }), stocks);
  const expected = (300 - 400) * 10 + (350 - 380) * 5 + (30 - 40) * 100;
  assert.ok(Math.abs(loss.lossTry - -expected) < 1e-9);
  assert.deepEqual(loss.symbols, ['BIMAS', 'TUPRS', 'EREGL']);

  const gain = computePortfolioLoss(portfolio, quotesOf({ BIMAS: 500, TUPRS: 500, EREGL: 50 }), stocks);
  assert.equal(gain.lossTry, 0);

  assert.equal(computePortfolioLoss(portfolio, quotesOf({ BIMAS: 300, TUPRS: 350 }), stocks), null, 'EREGL fiyatı yok: eksik hesap yapılmaz');
  assert.equal(computePortfolioLoss([{ symbol: 'KTV', quantity: 5 }], new Map(), stocks), null);
});

test('lossStage: ayarlardaki sınır ve orana göre (kodda sabit değil)', () => {
  assert.equal(lossStage(1000, DEFAULT_SETTINGS), 'none');
  assert.equal(lossStage(1440, DEFAULT_SETTINGS), 'warn'); // tam %80
  assert.equal(lossStage(1799.99, DEFAULT_SETTINGS), 'warn');
  assert.equal(lossStage(1800, DEFAULT_SETTINGS), 'over');
  const custom = { ...DEFAULT_SETTINGS, lossLimitTry: 5000, lossWarnRatio: 0.5 };
  assert.equal(lossStage(2500, custom), 'warn');
  assert.equal(lossStage(1800, custom), 'none');
});

const lossAlarm = () => make({ type: 'portfolio_loss' });
const L = (lossTry) => ({ loss: { lossTry, netPnl: -lossTry, symbols: [] } });

test('zarar sınırı: iki aşama — %80\'de yaklaşma, aşınca ikinci uyarı; "sat" demez', () => {
  let a = lossAlarm();
  let r = step(a, L(500)); // temiz başlangıç: bildirim yok
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.stage, 'none');

  r = step(r.alarm, L(1512));
  assert.equal(r.notification.text, 'Hisse zararın 1.512 TL; belirlediğin 1.800 TL sınırının %84 seviyesinde. Durup gözden geçirme zamanı.');
  assert.equal(r.alarm.state.stage, 'warn');

  r = step(r.alarm, L(1600)); // aynı aşama: tekrar yok
  assert.equal(r.notification, null);

  r = step(r.alarm, L(1850), ctx(hoursLater(1))); // bekleme süresi içinde bile aşma bildirilir
  assert.equal(r.notification.text, 'Hisse zararın 1.850 TL; belirlediğin 1.800 TL sınırını aştı. Durup gözden geçirme zamanı.');
  assert.equal(r.alarm.state.stage, 'over');
  for (const text of [r.notification.text]) assert.doesNotMatch(text, /\bsat\b/i);
});

test('zarar sınırı: kurulum anında zarar zaten %80\'i geçmişse silahsız bırakılmaz, bir kez bilgi mesajı gider', () => {
  const r = step(lossAlarm(), L(1500));
  assert.equal(r.notification.kind, 'info');
  assert.equal(r.notification.text, 'Bilgi: şu an hisse zararın 1.500 TL, belirlediğin 1.800 TL sınırının %83 seviyesinde. Durup gözden geçirme zamanı.');
  assert.equal(r.alarm.lastTriggeredAt, null, 'bilgi mesajı tetiklenme sayılmaz');
  assert.equal(r.alarm.state.armed, true);
  assert.equal(alarmStatusText(r.alarm), 'Yaklaşma uyarısı verildi');

  assert.equal(step(r.alarm, L(1520)).notification, null, 'bilgi bir kez gider, tekrarlanmaz');
  const over = step(r.alarm, L(1801));
  assert.equal(over.notification.kind, 'alert', 'sonra normal çalışır: sınır aşılınca uyarır');
});

test('zarar sınırı: kurulum anında zarar sınırı zaten aşmışsa bilgi mesajı gider, sonra normal', () => {
  const r = step(lossAlarm(), L(2000));
  assert.equal(r.notification.kind, 'info');
  assert.match(r.notification.text, /2\.000 TL/);
  assert.equal(r.alarm.state.stage, 'over');
  assert.equal(step(r.alarm, L(2100)).notification, null);
});

test('zarar sınırı: seans dışında da kurulum bilgisi gider ama yükselme bildirimi seans açılınca gider', () => {
  const closed = ctx(T0, { canNotify: false });
  let r = step(lossAlarm(), L(1500), closed);
  assert.equal(r.notification.kind, 'info');
  r = step(r.alarm, L(1900), closed);
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.stage, 'warn', 'tüketilmedi');
  r = step(r.alarm, L(1900), ctx(hoursLater(1)));
  assert.equal(r.notification.kind, 'alert');
});

test('zarar sınırı: düşüp yeniden yükselince tekrar uyarır; sınır çevresinde gidip gelmede spam yok', () => {
  let a = lossAlarm();
  ({ alarm: a } = step(a, L(100)));
  let r = step(a, L(1900)); // none -> over
  assert.equal(r.notification.kind, 'alert');
  assert.equal(r.alarm.state.stage, 'over');

  r = step(r.alarm, L(1700), ctx(hoursLater(1))); // over -> warn: yalnızca kaydedilir
  assert.equal(r.notification, null);
  assert.equal(r.alarm.state.stage, 'warn');
  r = step(r.alarm, L(1850), ctx(hoursLater(2))); // warn -> over, ama aşma az önce bildirildi: bekleme süresi
  assert.equal(r.notification, null);

  r = step(r.alarm, L(100), ctx(hoursLater(30)));
  assert.equal(r.alarm.state.stage, 'none');
  r = step(r.alarm, L(1500), ctx(hoursLater(31))); // 24 saat geçti: yeniden uyarı
  assert.equal(r.notification.kind, 'alert');
});

test('zarar sınırı: zarar verisi yoksa atlanır; ayarlar değişince eşikler yeni değerlerle çalışır', () => {
  assert.equal(evaluateAlarm(lossAlarm(), { loss: null }, ctx()), null);
  const settings = { ...DEFAULT_SETTINGS, lossLimitTry: 5000, lossWarnRatio: 0.5 };
  let r = step(lossAlarm(), L(1900), ctx(T0, { settings }));
  assert.equal(r.notification, null, '1.900 TL, 5.000 TL sınırının %38\'i: temiz');
  r = step(r.alarm, L(2600), ctx(hoursLater(1), { settings }));
  assert.match(r.notification.text, /5\.000 TL sınırının %52 seviyesinde/);
});

test('tek seferlik zarar alarmı yalnızca sınır aşılınca kapanır (yaklaşma uyarısında açık kalır)', () => {
  let a = make({ type: 'portfolio_loss', once: true });
  ({ alarm: a } = step(a, L(100)));
  let r = step(a, L(1500));
  assert.equal(r.alarm.enabled, true);
  r = step(r.alarm, L(1900));
  assert.equal(r.alarm.enabled, false);
});
