import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, getTelegramConfig, sendTelegram } from '../src/alerts/notifier.js';

const TOKEN = '123456:ABC-gizli-token';
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '987654' };
const alert = { kind: 'alert', title: 'BIMAS < 385', text: 'BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi.' };

const okResponse = (body = { ok: true }) => ({ ok: true, status: 200, json: async () => body });
const errResponse = (status, description) => ({ ok: false, status, json: async () => ({ ok: false, description }) });

test('getTelegramConfig: ikisi de varsa döner, biri eksikse null', () => {
  assert.deepEqual(getTelegramConfig(ENV), { token: TOKEN, chatId: '987654' });
  assert.equal(getTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN }), null);
  assert.equal(getTelegramConfig({ TELEGRAM_CHAT_ID: '1' }), null);
  assert.equal(getTelegramConfig({}), null);
  assert.equal(getTelegramConfig({ TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_CHAT_ID: '1' }), null);
});

test('sendTelegram: doğru adres ve gövde ile istek atar', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return okResponse();
  };
  await sendTelegram({ token: TOKEN, chatId: '987654', text: 'merhaba' }, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { chat_id: '987654', text: 'merhaba', disable_web_page_preview: true });
});

test('sendTelegram: 5xx bir kez tekrar denenir, 4xx denenmez', async () => {
  let n = 0;
  await sendTelegram({ token: TOKEN, chatId: '1', text: 'x' }, { retryDelayMs: 0, fetchImpl: async () => (++n === 1 ? errResponse(502, 'bad gateway') : okResponse()) });
  assert.equal(n, 2);

  let m = 0;
  await assert.rejects(
    sendTelegram({ token: TOKEN, chatId: '1', text: 'x' }, { retryDelayMs: 0, fetchImpl: async () => (++m, errResponse(401, 'Unauthorized')) }),
    /Telegram 401: Unauthorized/,
  );
  assert.equal(m, 1, '401 tekrar denenmez');
});

test('sendTelegram: hata mesajı token içermez', async () => {
  const fetchImpl = async (url) => {
    throw new Error(`fetch failed: ${url}`);
  };
  await assert.rejects(sendTelegram({ token: TOKEN, chatId: '1', text: 'x' }, { fetchImpl, retryDelayMs: 0 }), (err) => {
    assert.ok(!err.message.includes(TOKEN));
    assert.match(err.message, /\*\*\*/);
    return true;
  });
});

test('notifier: masaüstü ve Telegram birlikte gider; mesaj gövdesi alarm metnidir', async () => {
  const shown = [];
  const sent = [];
  const notify = createNotifier({
    desktop: async (n) => void shown.push(n),
    env: ENV,
    fetchImpl: async (url, init) => (sent.push(JSON.parse(init.body)), okResponse()),
  });
  const result = await notify(alert, { telegramEnabled: true });
  assert.deepEqual(result, { desktop: true, telegram: true });
  assert.deepEqual(shown, [{ title: 'BIMAS < 385', body: alert.text }]);
  assert.equal(sent[0].text, `🔔 BIMAS < 385\n${alert.text}`);
  const info = await notify({ ...alert, kind: 'info' }, {});
  assert.deepEqual(info, { desktop: true, telegram: true });
  assert.ok(sent[1].text.startsWith('ℹ️'));
});

test('notifier: Telegram ayarlardan kapatılırsa ya da anahtar yoksa atlanır', async () => {
  let fetched = 0;
  const fetchImpl = async () => (++fetched, okResponse());
  const shown = [];
  const desktop = async (n) => void shown.push(n);

  assert.deepEqual(await createNotifier({ desktop, env: ENV, fetchImpl })(alert, { telegramEnabled: false }), { desktop: true, telegram: null });
  assert.deepEqual(await createNotifier({ desktop, env: {}, fetchImpl })(alert, { telegramEnabled: true }), { desktop: true, telegram: null });
  assert.equal(fetched, 0);
});

test('notifier: bir kanal çökerse diğeri yine gider; hata loglanır, token sızmaz, fırlatmaz', async () => {
  const logs = [];
  const shown = [];
  const notify = createNotifier({
    desktop: async (n) => void shown.push(n),
    env: ENV,
    retryDelayMs: 0,
    log: (m) => logs.push(m),
    fetchImpl: async (url) => {
      throw new Error(`ağ yok ${url}`);
    },
  });
  const result = await notify(alert, {});
  assert.deepEqual(result, { desktop: true, telegram: false });
  assert.equal(shown.length, 1);
  assert.ok(logs.some((m) => m.includes('Telegram')));
  assert.ok(logs.every((m) => !m.includes(TOKEN)), 'token log satırında görünmemeli');

  const brokenDesktop = createNotifier({
    desktop: async () => {
      throw new Error('bildirim izni yok');
    },
    env: ENV,
    fetchImpl: async () => okResponse(),
    log: (m) => logs.push(m),
  });
  assert.deepEqual(await brokenDesktop(alert, {}), { desktop: false, telegram: true });
});
