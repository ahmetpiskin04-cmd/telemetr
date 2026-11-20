import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isBistSessionOpen } from '../src/alerts/session.js';
import { createAlertRunner, startAlertLoop } from '../src/alerts/scheduler.js';
import { applyAlarmUpdates, readAlarmsFile, saveAlarm } from '../src/alerts/store.js';

// 2026-11-20 Cuma. İstanbul = UTC+3.
const FRI_OPEN = new Date('2026-11-20T08:00:00Z'); // 11:00 İstanbul
const FRI_BEFORE = new Date('2026-11-20T06:59:00Z'); // 09:59
const FRI_AT_10 = new Date('2026-11-20T07:00:00Z'); // 10:00
const FRI_LAST = new Date('2026-11-20T14:59:00Z'); // 17:59
const FRI_AT_18 = new Date('2026-11-20T15:00:00Z'); // 18:00
const SAT_NOON = new Date('2026-11-21T09:00:00Z');
const SUN_NOON = new Date('2026-11-22T09:00:00Z');

test('BİST seansı: hafta içi 10:00 dahil, 18:00 hariç; hafta sonu kapalı', () => {
  assert.equal(isBistSessionOpen(FRI_BEFORE), false);
  assert.equal(isBistSessionOpen(FRI_AT_10), true);
  assert.equal(isBistSessionOpen(FRI_OPEN), true);
  assert.equal(isBistSessionOpen(FRI_LAST), true);
  assert.equal(isBistSessionOpen(FRI_AT_18), false);
  assert.equal(isBistSessionOpen(SAT_NOON), false);
  assert.equal(isBistSessionOpen(SUN_NOON), false);
  assert.equal(isBistSessionOpen(new Date('2026-11-23T07:00:00Z')), true, 'Pazartesi 10:00');
});

const quote = (symbol, price, extra = {}) => ({ symbol, name: symbol, price, previousClose: null, unit: 'TL', delayed: false, futures: false, marketOpen: true, ...extra });

/** Sahte fiyat kaynağı: çağrıları sayar. prices: { SEMBOL: Quote | null } */
function fakeFeed(prices, closes = {}) {
  const feed = {
    quoteCalls: [],
    async getQuotes(symbols) {
      feed.quoteCalls.push([...symbols]);
      return new Map(symbols.map((s) => [s, prices[s] ?? null]));
    },
    async getDailyCloses(symbol) {
      return closes[symbol] ?? null;
    },
  };
  return feed;
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-sched-'));
  const files = { file: path.join(dir, 'alarms.json'), portfolioFile: path.join(dir, 'portfolio.json'), watchlistFile: path.join(dir, 'watchlist.json') };
  const sent = [];
  const logs = [];
  const make = (feed, now, notify) =>
    createAlertRunner({ feed, ...files, now: () => now, log: (m) => logs.push(m), notify: notify ?? (async (n) => void sent.push(n)) });
  return { ...files, sent, logs, make };
}

/** Alarmı başlangıç durumu kaydedilmiş (silahlı) olarak ekler. */
async function addArmed(file, input) {
  const alarm = await saveAlarm(input, file);
  await applyAlarmUpdates([{ id: alarm.id, rev: alarm.rev, patch: { state: { initialized: true, armed: true } } }], file);
  return alarm;
}

const bimasBelow = { type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385 };

test('seans içinde geçiş bildirilir, durum kaydedilir, aynı geçiş ikinci turda tekrarlanmaz', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const runner = s.make(fakeFeed({ BIMAS: quote('BIMAS', 380.1) }), FRI_OPEN);

  const first = await runner.runOnce();
  assert.equal(first.triggered, 1);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].text, 'BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi.');

  const saved = (await readAlarmsFile(s.file)).alarms[0];
  assert.equal(saved.lastTriggeredAt, FRI_OPEN.toISOString());
  assert.equal(saved.state.armed, false);

  assert.equal((await runner.runOnce()).triggered, 0);
  assert.equal(s.sent.length, 1);
});

test('seans dışı: başlangıç durumu kayıtlı BİST alarmı için fiyat bile çekilmez', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const feed = fakeFeed({ BIMAS: quote('BIMAS', 300) });
  const result = await s.make(feed, SAT_NOON).runOnce();
  assert.equal(result.checked, 0);
  assert.equal(feed.quoteCalls.length, 0);
  assert.equal(s.sent.length, 0);
});

test('seans dışı: yeni BİST alarmı başlangıç durumunu kaydeder ama bildirim göndermez', async () => {
  const s = await setup();
  await saveAlarm(bimasBelow, s.file); // henüz başlangıç durumu yok
  const runner = s.make(fakeFeed({ BIMAS: quote('BIMAS', 370) }), SAT_NOON);
  await runner.runOnce();
  const saved = (await readAlarmsFile(s.file)).alarms[0];
  assert.equal(saved.state.initialized, true);
  assert.equal(saved.state.armed, false, 'zaten eşiğin altında: beklemede');
  assert.equal(s.sent.length, 0);
});

test('altın ve döviz alarmları hafta sonu da çalışır', async () => {
  const s = await setup();
  await addArmed(s.file, { type: 'price', symbol: 'USDTRY', direction: 'above', threshold: 50.5 });
  await addArmed(s.file, { type: 'price', symbol: 'ONS_ALTIN', direction: 'below', threshold: 3600 });
  const feed = fakeFeed({
    USDTRY: quote('USDTRY', 50.6, { name: 'USD/TRY' }),
    ONS_ALTIN: quote('ONS_ALTIN', 3590, { name: 'Ons altın (vadeli)', unit: 'USD', marketOpen: false }),
  });
  const result = await s.make(feed, SUN_NOON).runOnce();
  assert.equal(result.triggered, 2);
  assert.match(s.sent.map((n) => n.text).join('\n'), /Ons altın \(vadeli\)/);
});

test('seans içinde ama borsa açık değilse (resmî tatil) bildirmez ve geçişi tüketmez', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const runner = s.make(fakeFeed({ BIMAS: quote('BIMAS', 380, { marketOpen: false }) }), FRI_OPEN);
  assert.equal((await runner.runOnce()).triggered, 0);
  assert.equal((await readAlarmsFile(s.file)).alarms[0].state.armed, true);
});

test('veri alınamazsa alarm sessizce atlanır; uygulama çökmez, durum değişmez', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const result = await s.make(fakeFeed({ BIMAS: null }), FRI_OPEN).runOnce();
  assert.equal(result.triggered, 0);
  assert.equal(result.evaluated, 0);
  assert.ok(s.logs.some((m) => m.includes('veri yok')));
  assert.equal((await readAlarmsFile(s.file)).alarms[0].state.armed, true);
});

test('fiyat kaynağı fırlatsa bile runOnce fırlatmaz, hata loglanır', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const feed = {
    async getQuotes() {
      throw new Error('patladı');
    },
  };
  const result = await s.make(feed, FRI_OPEN).runOnce();
  assert.equal(result.error, 'patladı');
  assert.ok(s.logs.some((m) => m.includes('patladı')));
});

test('bildirim gönderimi başarısız olsa da durum kaydedilmiş olur (tetiklenme tekrarlanmaz)', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const runner = s.make(fakeFeed({ BIMAS: quote('BIMAS', 380) }), FRI_OPEN, async () => {
    throw new Error('Telegram kapalı');
  });
  assert.equal((await runner.runOnce()).triggered, 1);
  assert.ok(s.logs.some((m) => m.includes('Telegram kapalı')));
  assert.equal((await readAlarmsFile(s.file)).alarms[0].lastTriggeredAt, FRI_OPEN.toISOString());
});

test('eşzamanlı iki tur çakışmaz', async () => {
  const s = await setup();
  await addArmed(s.file, bimasBelow);
  const runner = s.make(fakeFeed({ BIMAS: quote('BIMAS', 380) }), FRI_OPEN);
  const [a, b] = await Promise.all([runner.runOnce(), runner.runOnce()]);
  assert.equal([a, b].filter((r) => r.skipped === 'busy').length, 1);
  assert.equal(s.sent.length, 1);
});

test('ortalama kıyası alarmı geçmiş kapanışları kullanır', async () => {
  const s = await setup();
  await addArmed(s.file, { type: 'avg_deviation', symbol: 'EREGL', percent: 5 });
  const closes = { EREGL: Array.from({ length: 20 }, () => 40) };
  const result = await s.make(fakeFeed({ EREGL: quote('EREGL', 37) }, closes), FRI_OPEN).runOnce();
  assert.equal(result.triggered, 1);
  assert.match(s.sent[0].text, /20 günlük ortalamanın \(40,00 TL\) %7,5 altına indi/);
});

async function writeLossFiles(s, prices) {
  await writeFile(s.watchlistFile, JSON.stringify({ stocks: ['BIMAS', 'EREGL'], funds: ['KTV'], metals: ['GRAM_ALTIN'] }));
  await writeFile(
    s.portfolioFile,
    JSON.stringify({
      cash: 0,
      positions: [
        { symbol: 'BIMAS', quantity: 10, avgCost: 400 },
        { symbol: 'EREGL', quantity: 100, avgCost: 40 },
        { symbol: 'GRAM_ALTIN', quantity: 5 },
        { symbol: 'KTV', quantity: 1000 },
      ],
    }),
  );
  return fakeFeed(Object.fromEntries(Object.entries(prices).map(([sym, p]) => [sym, quote(sym, p)])));
}

test('portföy zarar alarmı: kurulumda zarar %80\'i geçmişse bilgi mesajı, sonra aşınca uyarı', async () => {
  const s = await setup();
  await saveAlarm({ type: 'portfolio_loss' }, s.file);
  // zarar: (360-400)*10 + (36-40)*100 = -400 - 400 = -800 -> sınırın %44'ü
  let feed = await writeLossFiles(s, { BIMAS: 360, EREGL: 36 });
  await s.make(feed, FRI_OPEN).runOnce();
  assert.equal(s.sent.length, 0, 'sınırın %44\'ü: temiz başlangıç');
  assert.deepEqual(feed.quoteCalls[0].sort(), ['BIMAS', 'EREGL'], 'yalnızca hisseler sorgulanır');

  // zarar: (300-400)*10 + (36-40)*100 = -1400 -> %78: hâlâ temiz; sonra 1500 -> %83 uyarı
  feed = await writeLossFiles(s, { BIMAS: 290, EREGL: 36 }); // -1100 - 400 = -1500
  await s.make(feed, FRI_OPEN).runOnce();
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].text, /^Hisse zararın 1\.500 TL; belirlediğin 1\.800 TL sınırının %83 seviyesinde\./);

  feed = await writeLossFiles(s, { BIMAS: 260, EREGL: 34 }); // -1400 - 600 = -2000
  await s.make(feed, FRI_OPEN).runOnce();
  assert.equal(s.sent.length, 2);
  assert.match(s.sent[1].text, /sınırını aştı/);
});

test('portföy zarar alarmı: kurulum anında zarar zaten yüksekse bir kez bilgi gider', async () => {
  const s = await setup();
  await saveAlarm({ type: 'portfolio_loss' }, s.file);
  const feed = await writeLossFiles(s, { BIMAS: 290, EREGL: 36 }); // -1500
  const runner = s.make(feed, FRI_OPEN);
  await runner.runOnce();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].kind, 'info');
  await runner.runOnce();
  assert.equal(s.sent.length, 1, 'tekrarlanmaz');
});

test('portföy zarar alarmı: bir hissenin fiyatı yoksa alarm atlanır (eksik hesapla yanlış güven verilmez)', async () => {
  const s = await setup();
  await saveAlarm({ type: 'portfolio_loss' }, s.file);
  const feed = await writeLossFiles(s, { BIMAS: 290 }); // EREGL yok
  const result = await s.make(feed, FRI_OPEN).runOnce();
  assert.equal(result.evaluated, 0);
  assert.equal(s.sent.length, 0);
});

test('döngü: ilk tur gecikmeyle, sonra ayarlardaki aralıkla; durdurulunca kalkar', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let runs = 0;
    let interval = 5;
    const runner = { async runOnce() { runs += 1; return {}; } };
    const loop = startAlertLoop({ runner, getIntervalMinutes: async () => interval, firstDelayMs: 1_000 });
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    mock.timers.tick(999);
    await flush();
    assert.equal(runs, 0);
    mock.timers.tick(1);
    await flush();
    assert.equal(runs, 1);

    mock.timers.tick(5 * 60_000 - 1);
    await flush();
    assert.equal(runs, 1);
    interval = 2; // ayar değişti: bir sonraki turdan itibaren geçerli
    mock.timers.tick(1);
    await flush();
    assert.equal(runs, 2);
    mock.timers.tick(2 * 60_000);
    await flush();
    assert.equal(runs, 3);

    loop.stop();
    mock.timers.tick(60 * 60_000);
    await flush();
    assert.equal(runs, 3);
  } finally {
    mock.timers.reset();
  }
});
