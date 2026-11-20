import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario } from '../src/alerts/simulate.js';

const texts = (step) => step.notifications.map((n) => n.text);

test('sahte fiyat senaryosu: başlangıçta sessiz, geçişte tek bildirim, aynı fiyatta tekrar yok', async () => {
  const { steps } = await runScenario({ type: 'price', symbol: 'BIMAS', price: 380.1, threshold: 385 });
  assert.deepEqual(steps.map((s) => s.notifications.length), [0, 1, 0]);
  assert.equal(texts(steps[1])[0], 'BIMAS 380,10 TL: belirlediğin 385 TL alarmının altına indi.');
});

test('senaryo: üstüne çıkma yönü ve gecikmeli veri notu', async () => {
  const { steps } = await runScenario({ type: 'price', symbol: 'ASELS', price: 401, threshold: 400, direction: 'above', delayed: true });
  assert.equal(texts(steps[1])[0], 'ASELS 401,00 TL: belirlediğin 400 TL alarmının üstüne çıktı (gecikmeli veri).');
});

test('senaryo: ons altın metninde "(vadeli)" görünür', async () => {
  const { steps } = await runScenario({ type: 'price', symbol: 'ons_altin', price: 3590, threshold: 3600 });
  assert.match(texts(steps[1])[0], /^Ons altın \(vadeli\) 3\.590,00 USD/);
});

test('senaryo: günlük değişim, ortalama kıyası ve portföy zararı', async () => {
  const daily = await runScenario({ type: 'daily_change', symbol: 'ASELS', price: 96.5, previousClose: 100, percent: 3 });
  assert.deepEqual(daily.steps.map((s) => s.notifications.length), [0, 1, 0]);
  const avg = await runScenario({ type: 'avg_deviation', symbol: 'EREGL', price: 37, average: 40, percent: 5 });
  assert.deepEqual(avg.steps.map((s) => s.notifications.length), [0, 1, 0]);
  const loss = await runScenario({ type: 'portfolio_loss', lossTry: 1500 });
  assert.deepEqual(loss.steps.map((s) => s.notifications.length), [0, 1, 0]);
  assert.match(texts(loss.steps[1])[0], /sınırının %83 seviyesinde/);
});

test('senaryo: sınır ve oran özelleştirilebilir', async () => {
  const { steps } = await runScenario({ type: 'portfolio_loss', lossTry: 2600, lossLimitTry: 5000, lossWarnRatio: 0.5 });
  assert.match(texts(steps[1])[0], /5\.000 TL sınırının %52 seviyesinde/);
});

test('senaryo: eşiğin ötesinde başlayan alarm yok; gerçek bildirim işleyicisi çağrılır', async () => {
  const seen = [];
  await runScenario({ type: 'price', symbol: 'BIMAS', price: 380, threshold: 385 }, async (n) => void seen.push(n.text));
  assert.equal(seen.length, 1);
});

test('senaryo: eksik ya da geçersiz girdide anlaşılır hata', async () => {
  await assert.rejects(runScenario({ type: 'price', symbol: 'BIMAS', price: 380 }), /Eşik gerekli/);
  await assert.rejects(runScenario({ type: 'price', symbol: 'bu geçersiz', price: 380, threshold: 385 }), /Geçersiz varlık/);
  await assert.rejects(runScenario({ type: 'daily_change', symbol: 'ASELS', price: 90, percent: 3 }), /Önceki kapanış/);
  await assert.rejects(runScenario({ type: 'avg_deviation', symbol: 'EREGL', price: 90, percent: 5 }), /Ortalama gerekli/);
  await assert.rejects(runScenario({ type: 'bilinmeyen' }), /Bilinmeyen alarm türü/);
});
