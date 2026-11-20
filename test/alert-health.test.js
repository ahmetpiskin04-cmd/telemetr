import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSourceHealth } from '../src/alerts/health.js';
import { createAlertService } from '../src/alerts/service.js';

const T0 = new Date('2026-11-20T10:00:00Z');
const hoursLater = (h) => new Date(T0.getTime() + h * 3_600_000);

async function setup(extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-health-'));
  const file = path.join(dir, 'source-health.json');
  const sent = [];
  const clock = { now: T0 };
  const health = createSourceHealth({
    file,
    notify: async (n, settings) => void sent.push({ n, settings }),
    getSettings: async () => ({ telegramEnabled: true }),
    now: () => clock.now,
    ...extra,
  });
  return { health, sent, clock, file, dir };
}

const fail = async (health, times, source = 'harem') => {
  for (let i = 0; i < times; i += 1) await health.record(source, false);
};

test('5 turda uyarı yok, 6. art arda başarısız turda tek uyarı', async () => {
  const { health, sent } = await setup();
  await fail(health, 5);
  assert.equal(sent.length, 0);
  assert.equal(health.failureCount('harem'), 5);
  await fail(health, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].n.kind, 'warning');
  assert.equal(sent[0].n.text, 'Gram altın (Harem) verisi alınamıyor, alarm çalışmıyor olabilir.');
  assert.deepEqual(sent[0].settings, { telegramEnabled: true }, 'Telegram ayarı bildirime iletilir');
});

test('uyarıdan sonra aynı gün tekrar uyarmaz; 24 saat sonra hâlâ cevap yoksa bir kez daha', async () => {
  const { health, sent, clock } = await setup();
  await fail(health, 6);
  await fail(health, 20);
  assert.equal(sent.length, 1, 'aynı gün içinde tekrar yok');
  clock.now = hoursLater(23.9);
  await fail(health, 3);
  assert.equal(sent.length, 1);
  clock.now = hoursLater(24.1);
  await fail(health, 1);
  assert.equal(sent.length, 2);
});

test('tek başarılı tur sayacı sıfırlar; sonra yine 6 tur gerekir', async () => {
  const { health, sent } = await setup();
  await fail(health, 5);
  await health.record('harem', true);
  assert.equal(health.failureCount('harem'), 0);
  await fail(health, 5);
  assert.equal(sent.length, 0);
  await fail(health, 1);
  assert.equal(sent.length, 1);
});

test('kaynaklar birbirinden bağımsız; Yahoo metni neleri etkilediğini söyler', async () => {
  const { health, sent } = await setup();
  await fail(health, 5, 'harem');
  await fail(health, 6, 'yahoo');
  assert.equal(sent.length, 1);
  assert.match(sent[0].n.text, /^Yahoo fiyat verisi \(hisseler, ons altın, USD\/TRY\) verisi alınamıyor/);
  await fail(health, 1, 'harem');
  assert.equal(sent.length, 2);
});

test('son uyarı zamanı dosyada: uygulama yeniden başlasa da aynı gün tekrar uyarmaz', async () => {
  const first = await setup();
  await fail(first.health, 6);
  assert.equal(first.sent.length, 1);
  assert.ok(JSON.parse(await readFile(first.file, 'utf8')).lastWarnedAt.harem);

  const sent = [];
  const restarted = createSourceHealth({ file: first.file, notify: async (n) => void sent.push(n), now: () => hoursLater(5) });
  await fail(restarted, 10);
  assert.equal(sent.length, 0, 'yeniden başlatma sınırı sıfırlamaz');
});

test('bildirim hatası fırlatmaz ve zaman yine de kaydedilir (tekrar tekrar denenmez)', async () => {
  const logs = [];
  const { health, file } = await setup({
    notify: async () => {
      throw new Error('Telegram kapalı');
    },
    log: (m) => logs.push(m),
  });
  await assert.doesNotReject(fail(health, 6));
  assert.ok(logs.some((m) => m.includes('Telegram kapalı')));
  assert.ok(JSON.parse(await readFile(file, 'utf8')).lastWarnedAt.harem);
});

test('onSource: hiç cevap gelmeyen tur başarısız, en az bir cevap başarılı sayılır', async () => {
  const { health } = await setup();
  health.onSource({ source: 'harem', requested: 1, received: 0 });
  health.onSource({ source: 'harem', requested: 1, received: 0 });
  assert.equal(health.failureCount('harem'), 2);
  health.onSource({ source: 'harem', requested: 2, received: 1 });
  assert.equal(health.failureCount('harem'), 0);
});

test('hizmet düzeyinde: Harem 6 tur sessiz kalınca Windows ve Telegram uyarısı bir kez gider, alarm kontrolü çökmez', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-health-svc-'));
  const shown = [];
  const requests = [];
  let haremCalls = 0;
  const service = createAlertService({
    file: path.join(dir, 'alarms.json'),
    portfolioFile: path.join(dir, 'p.json'),
    watchlistFile: path.join(dir, 'w.json'),
    desktop: async (n) => void shown.push(n),
    env: { TELEGRAM_BOT_TOKEN: 'tok:1', TELEGRAM_CHAT_ID: '7' },
    fetchImpl: async (url, init) => (requests.push(JSON.parse(init.body)), { ok: true, status: 200, json: async () => ({ ok: true }) }),
    haremQuotes: async () => {
      haremCalls += 1;
      throw new Error('Harem: süre içinde kotasyon gelmedi');
    },
    haremRetryDelayMs: 0,
    yahoo: {
      async quote() {
        return [];
      },
    },
    now: () => T0,
  });
  await service.save({ type: 'price', symbol: 'GRAM_ALTIN', direction: 'above', threshold: 6300 });

  for (let i = 0; i < 5; i += 1) await service.runNow();
  assert.equal(shown.length, 0, '5 tur: henüz uyarı yok');
  for (let i = 0; i < 3; i += 1) await service.runNow();
  await new Promise((resolve) => setTimeout(resolve, 50)); // uyarı arka planda gider

  assert.equal(haremCalls, 8 * 3, 'her turda 3 deneme');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].body, 'Gram altın (Harem) verisi alınamıyor, alarm çalışmıyor olabilir.');
  assert.equal(shown[0].title, 'Telemetr: veri sorunu');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].text.startsWith('⚠️'));
});
