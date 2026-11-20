import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAlertService } from '../src/alerts/service.js';
import { createLogger } from '../src/alerts/logger.js';

const FRI_OPEN = new Date('2026-11-20T08:00:00Z'); // 11:00 İstanbul, seans açık

const quote = (symbol, price, extra = {}) => ({ symbol, name: symbol, price, previousClose: null, unit: 'TL', delayed: false, futures: false, marketOpen: true, ...extra });
const fakeFeed = (prices) => ({
  async getQuotes(symbols) {
    return new Map(symbols.map((s) => [s, prices.current[s] ?? null]));
  },
  async getDailyCloses() {
    return null;
  },
});

async function setup({ env = {}, prices = {} } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-svc-'));
  const shown = [];
  const events = [];
  const state = { current: prices };
  const requests = [];
  const service = createAlertService({
    file: path.join(dir, 'alarms.json'),
    portfolioFile: path.join(dir, 'portfolio.json'),
    watchlistFile: path.join(dir, 'watchlist.json'),
    desktop: async (n) => void shown.push(n),
    env,
    feed: fakeFeed(state),
    fetchImpl: async (url, init) => (requests.push({ url, body: JSON.parse(init.body) }), { ok: true, status: 200, json: async () => ({ ok: true }) }),
    now: () => FRI_OPEN,
    onChange: (e) => events.push(e),
  });
  return { service, shown, events, requests, state, dir };
}

test('overview: varsayılan ayarlar, 8 varlık (ons "vadeli"), kanal durumu', async () => {
  const { service } = await setup();
  const o = await service.overview();
  assert.equal(o.settings.lossLimitTry, 1800);
  assert.equal(o.settings.lossWarnRatio, 0.8);
  assert.equal(o.assets.length, 8);
  assert.equal(o.assets.find((a) => a.symbol === 'ONS_ALTIN').name, 'Ons altın (vadeli)');
  assert.equal(o.assets.find((a) => a.symbol === 'ONS_ALTIN').unit, 'USD');
  assert.deepEqual(o.channels, { desktop: true, telegramConfigured: false, telegramEnabled: true });
  assert.equal(o.bistSessionOpen, true);
  assert.deepEqual(o.alarms, []);
});

test('yeni alarm "ilk fiyat bekleniyor" ile başlar; ilk tur eşiğin ötesindeyse "Beklemede" yazar, bildirim yok', async () => {
  const { service, shown, state } = await setup();
  state.current = { BIMAS: quote('BIMAS', 370) };
  const alarm = await service.save({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385 });
  assert.equal((await service.overview()).alarms[0].status, 'İlk fiyat bekleniyor');

  await service.runNow();
  const after = (await service.overview()).alarms[0];
  assert.equal(after.status, 'Beklemede: fiyat henüz eşiğin güvenli tarafına dönmedi');
  assert.equal(after.state.armed, false);
  assert.equal(shown.length, 0, 'eşiğin ötesinde eklendi: hemen tetiklenmez');

  state.current = { BIMAS: quote('BIMAS', 390) };
  await service.runNow();
  assert.equal((await service.overview()).alarms[0].status, 'Aktif');

  state.current = { BIMAS: quote('BIMAS', 380.1) };
  await service.runNow();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].body, 'BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi.');
  const fired = (await service.overview()).alarms.find((a) => a.id === alarm.id);
  assert.ok(fired.lastTriggeredAt);
});

test('tetiklenince Telegram da gider (anahtarlar ortamdan); kapatılınca gitmez', async () => {
  const { service, requests, state } = await setup({ env: { TELEGRAM_BOT_TOKEN: 'tok:123', TELEGRAM_CHAT_ID: '42' } });
  assert.equal((await service.overview()).channels.telegramConfigured, true);
  state.current = { BIMAS: quote('BIMAS', 390) };
  await service.save({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385, cooldownHours: 0 });
  await service.runNow();
  state.current = { BIMAS: quote('BIMAS', 380) };
  await service.runNow();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.telegram.org/bottok:123/sendMessage');
  assert.equal(requests[0].body.chat_id, '42');

  await service.saveSettings({ telegramEnabled: false });
  state.current = { BIMAS: quote('BIMAS', 390) };
  await service.runNow();
  state.current = { BIMAS: quote('BIMAS', 379) };
  await service.runNow();
  assert.equal(requests.length, 1, 'Telegram kapalı: ikinci tetiklenme gönderilmedi');
});

test('toggle ve remove; kapalı alarm değerlendirilmez, yeniden açılınca başlangıç durumu baştan', async () => {
  const { service, shown, state } = await setup();
  state.current = { BIMAS: quote('BIMAS', 390) };
  const alarm = await service.save({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385 });
  await service.runNow();

  await service.toggle(alarm.id, false);
  assert.equal((await service.overview()).alarms[0].status, 'Kapalı');
  state.current = { BIMAS: quote('BIMAS', 370) };
  await service.runNow();
  assert.equal(shown.length, 0);

  await service.toggle(alarm.id, true); // 370: eşiğin ötesinde açıldı -> tetiklenmez, beklemede
  await service.runNow();
  assert.equal(shown.length, 0);
  assert.match((await service.overview()).alarms[0].status, /^Beklemede/);

  await service.remove(alarm.id);
  assert.equal((await service.overview()).alarms.length, 0);
});

test('ayarlar: zarar sınırı ve oranı değişir, geçersiz değer reddedilir', async () => {
  const { service } = await setup();
  const next = await service.saveSettings({ lossLimitTry: 2500, lossWarnRatio: 0.7, checkIntervalMinutes: 10 });
  assert.deepEqual([next.lossLimitTry, next.lossWarnRatio, next.checkIntervalMinutes], [2500, 0.7, 10]);
  assert.equal((await service.overview()).settings.lossLimitTry, 2500);
  await assert.rejects(service.saveSettings({ lossLimitTry: -5 }), /Zarar sınırı/);
});

test('varlık listesi: ekle, çıkar; alarmı olan varlık çıkarılamaz', async () => {
  const { service } = await setup();
  assert.equal(await service.addAsset('thyao'), 'THYAO');
  assert.equal((await service.overview()).assets.length, 9);
  await service.save({ type: 'price', symbol: 'THYAO', direction: 'above', threshold: 300 });
  await assert.rejects(service.removeAsset('THYAO'), /alarm var/);
  await service.removeAsset('GRAM_ALTIN');
  assert.ok(!(await service.overview()).assets.some((a) => a.symbol === 'GRAM_ALTIN'));
});

test('sendTest: kanallar denenir ve sonuç döner', async () => {
  const { service, shown, requests } = await setup({ env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' } });
  const result = await service.sendTest();
  assert.deepEqual(result, { desktop: true, telegram: true });
  assert.equal(shown.length, 1);
  assert.equal(requests.length, 1);
});

test('onChange: kayıt ve tur sonrası arayüze haber verilir', async () => {
  const { service, events } = await setup();
  await service.save({ type: 'portfolio_loss' });
  await service.runNow();
  assert.deepEqual(events.map((e) => e.type), ['changed', 'run']);
});

test('günlük: her kontrol turu tek satırla özetlenir; alarm yokken satır yazılmaz', async () => {
  const { service, dir, state } = await setup();
  await service.runNow();
  assert.equal(existsSync(path.join(dir, 'alerts.log')), false, 'sırada alarm yok: günlük boş');

  state.current = { BIMAS: quote('BIMAS', 390) };
  await service.save({ type: 'price', symbol: 'BIMAS', direction: 'below', threshold: 385 });
  await service.save({ type: 'price', symbol: 'GRAM_ALTIN', direction: 'above', threshold: 6300 }); // fiyat yok: atlanır
  await service.runNow();
  const text = await readFile(path.join(dir, 'alerts.log'), 'utf8');
  assert.match(text, /Kontrol turu: 2 alarm sırada, 1 değerlendirildi, 1 atlandı \(veri yok\), 0 tetiklendi/);
});

test('günlük dosyası: satır ekler, 512 KB üstünde devreder, yazılamazsa sessiz kalır', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'telemetr-log-'));
  const file = path.join(dir, 'alerts.log');
  const log = createLogger(file, { now: () => new Date('2026-11-20T08:00:00Z') });
  log('merhaba\nikinci satır');
  assert.equal(await readFile(file, 'utf8'), '2026-11-20T08:00:00.000Z merhaba ikinci satır\n');

  await writeFile(file, 'x'.repeat(600 * 1024));
  log('yeni');
  assert.ok(existsSync(`${file}.1`));
  assert.equal(await readFile(file, 'utf8'), '2026-11-20T08:00:00.000Z yeni\n');

  assert.doesNotThrow(() => createLogger(path.join(dir, 'yok', 'alt', 'a.log'))('sessiz'));
  assert.doesNotThrow(() => createLogger(null)('dosyasız'));
});
