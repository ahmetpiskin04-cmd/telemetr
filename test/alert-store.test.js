import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_ASSETS,
  DEFAULT_SETTINGS,
  addAsset,
  applyAlarmUpdates,
  deleteAlarm,
  normalizeAlarm,
  readAlarmsFile,
  removeAsset,
  saveAlarm,
  setAlarmEnabled,
  updateSettings,
} from '../src/alerts/store.js';

const tempFile = async () => path.join(await mkdtemp(path.join(tmpdir(), 'telemetr-alarm-')), 'alarms.json');
const priceAlarm = (extra = {}) => ({ type: 'price', symbol: 'bimas', direction: 'below', threshold: '385,5', ...extra });

test('dosya yoksa varsayılanlarla başlar (sınır 1.800 TL, oran %80, 8 varlık)', async () => {
  const data = await readAlarmsFile(await tempFile());
  assert.deepEqual(data.settings, DEFAULT_SETTINGS);
  assert.equal(data.settings.lossLimitTry, 1800);
  assert.equal(data.settings.lossWarnRatio, 0.8);
  assert.deepEqual(data.assets, [...DEFAULT_ASSETS]);
  assert.deepEqual(data.alarms, []);
});

test('saveAlarm: doğrular, normalleştirir, kalıcı yazar ve yeniden okunur', async () => {
  const file = await tempFile();
  const alarm = await saveAlarm(priceAlarm({ cooldownHours: 12, once: true }), file);
  assert.equal(alarm.symbol, 'BIMAS');
  assert.deepEqual(alarm.params, { direction: 'below', threshold: 385.5 }, 'virgüllü sayı kabul edilir');
  assert.equal(alarm.name, 'BIMAS < 385,5', 'ad verilmezse otomatik');
  assert.equal(alarm.enabled, true);
  assert.equal(alarm.cooldownHours, 12);
  assert.equal(alarm.once, true);
  assert.equal(alarm.lastTriggeredAt, null);
  assert.equal(alarm.state.initialized, false);

  const reread = await readAlarmsFile(file);
  assert.equal(reread.alarms.length, 1);
  assert.deepEqual(reread.alarms[0], alarm);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).alarms[0].id, alarm.id);
});

test('varsayılan bekleme süresi ayarlardan gelir (24 saat)', async () => {
  const file = await tempFile();
  assert.equal((await saveAlarm(priceAlarm(), file)).cooldownHours, 24);
  await updateSettings({ defaultCooldownHours: 6 }, file);
  assert.equal((await saveAlarm(priceAlarm({ symbol: 'ASELS' }), file)).cooldownHours, 6);
});

test('geçersiz girişler anlaşılır Türkçe hata verir', () => {
  assert.throws(() => normalizeAlarm({ type: 'price', symbol: 'BIMAS', direction: 'sideways', threshold: 5 }), /Yön/);
  assert.throws(() => normalizeAlarm(priceAlarm({ threshold: '-3' })), /Eşik/);
  assert.throws(() => normalizeAlarm(priceAlarm({ threshold: 'abc' })), /geçerli bir sayı/);
  assert.throws(() => normalizeAlarm(priceAlarm({ symbol: 'bu geçersiz' })), /Geçersiz varlık/);
  assert.throws(() => normalizeAlarm({ type: 'daily_change', symbol: 'BIMAS', direction: 'down', percent: 150 }), /Yüzde/);
  assert.throws(() => normalizeAlarm({ type: 'avg_deviation', symbol: 'BIMAS', percent: 100 }), /Yüzde/);
  assert.throws(() => normalizeAlarm({ type: 'bilinmeyen' }), /alarm türü/);
  assert.throws(() => normalizeAlarm(priceAlarm({ cooldownHours: -1 })), /Bekleme/);
});

test('dört alarm türü de kaydedilir; portföy alarmı varlık istemez', async () => {
  const file = await tempFile();
  const a = await saveAlarm({ type: 'daily_change', symbol: 'ASELS', direction: 'down', percent: 3 }, file);
  const b = await saveAlarm({ type: 'avg_deviation', symbol: 'EREGL', percent: 5 }, file);
  const c = await saveAlarm({ type: 'portfolio_loss' }, file);
  assert.deepEqual(a.params, { direction: 'down', percent: 3 });
  assert.deepEqual(b.params, { percent: 5, days: 20 }, '20 günlük ortalama varsayılan');
  assert.equal(c.symbol, null);
  assert.equal(c.name, 'Portföy zarar sınırı');
  assert.equal((await readAlarmsFile(file)).alarms.length, 3);
});

test('saveAlarm düzenleme: durum sıfırlanır, rev artar, son tetiklenme ve açık/kapalı korunur', async () => {
  const file = await tempFile();
  const alarm = await saveAlarm(priceAlarm(), file);
  await applyAlarmUpdates([{ id: alarm.id, rev: alarm.rev, patch: { state: { initialized: true, armed: true }, lastTriggeredAt: '2026-11-19T10:00:00.000Z' } }], file);
  await setAlarmEnabled(alarm.id, false, file);
  const edited = await saveAlarm({ id: alarm.id, ...priceAlarm({ threshold: 380 }) }, file);
  assert.equal(edited.params.threshold, 380);
  assert.equal(edited.rev, 2);
  assert.equal(edited.state.initialized, false, 'eşik değişti: ilk gözlem kuralı baştan');
  assert.equal(edited.lastTriggeredAt, '2026-11-19T10:00:00.000Z');
  assert.equal(edited.enabled, false, 'düzenleme kapalı alarmı kendiliğinden açmaz');
  await assert.rejects(saveAlarm({ id: 'yok', ...priceAlarm() }, file), /bulunamadı/);
});

test('alarmın varlığı izleme listesine kendiliğinden eklenir; bağlı alarmı olan varlık çıkarılamaz', async () => {
  const file = await tempFile();
  const alarm = await saveAlarm(priceAlarm({ symbol: 'THYAO' }), file);
  assert.ok((await readAlarmsFile(file)).assets.includes('THYAO'));
  await assert.rejects(removeAsset('THYAO', file), /1 alarm var/);
  await deleteAlarm(alarm.id, file);
  await removeAsset('THYAO', file);
  assert.ok(!(await readAlarmsFile(file)).assets.includes('THYAO'));
  await assert.rejects(addAsset('çok geçersiz', file), /Geçersiz varlık/);
  assert.equal(await addAsset('sise', file), 'SISE');
});

test('setAlarmEnabled: yeniden açılan alarm baştan başlar', async () => {
  const file = await tempFile();
  const alarm = await saveAlarm(priceAlarm(), file);
  await applyAlarmUpdates([{ id: alarm.id, rev: alarm.rev, patch: { state: { initialized: true, armed: false } } }], file);
  await setAlarmEnabled(alarm.id, false, file);
  const reopened = await setAlarmEnabled(alarm.id, true, file);
  assert.equal(reopened.enabled, true);
  assert.equal(reopened.state.initialized, false);
  assert.equal(reopened.state.armed, null);
});

test('updateSettings: doğrulama; zarar sınırı değişince portföy alarmı baştan başlar', async () => {
  const file = await tempFile();
  const loss = await saveAlarm({ type: 'portfolio_loss' }, file);
  await applyAlarmUpdates([{ id: loss.id, rev: loss.rev, patch: { state: { initialized: true, stage: 'warn' } } }], file);
  await assert.rejects(updateSettings({ lossLimitTry: 0 }, file), /Zarar sınırı/);
  await assert.rejects(updateSettings({ lossWarnRatio: 1.2 }, file), /Yaklaşma oranı/);
  await assert.rejects(updateSettings({ checkIntervalMinutes: 0 }, file), /Kontrol aralığı/);
  const settings = await updateSettings({ lossLimitTry: 2500, lossWarnRatio: 0.75 }, file);
  assert.equal(settings.lossLimitTry, 2500);
  assert.equal(settings.lossWarnRatio, 0.75);
  assert.equal(settings.checkIntervalMinutes, 5, 'verilmeyen alanlar korunur');
  assert.equal((await readAlarmsFile(file)).alarms[0].state.initialized, false);
});

test('applyAlarmUpdates: silinmiş ya da düzenlenmiş (rev değişmiş) alarmın eski sonucu atılır', async () => {
  const file = await tempFile();
  const alarm = await saveAlarm(priceAlarm(), file);
  await saveAlarm({ id: alarm.id, ...priceAlarm({ threshold: 370 }) }, file); // değerlendirme sürerken düzenlendi
  const applied = await applyAlarmUpdates(
    [
      { id: alarm.id, rev: alarm.rev, patch: { lastTriggeredAt: 'x', state: { armed: false } } },
      { id: 'silinmis', rev: 1, patch: { state: {} } },
    ],
    file,
  );
  assert.equal(applied, 0);
  assert.equal((await readAlarmsFile(file)).alarms[0].lastTriggeredAt, null);
});

test('eşzamanlı yazmalar birbirini ezmez', async () => {
  const file = await tempFile();
  await Promise.all(['ASELS', 'BIMAS', 'ENJSA', 'EREGL', 'TUPRS'].map((symbol) => saveAlarm(priceAlarm({ symbol }), file)));
  assert.equal((await readAlarmsFile(file)).alarms.length, 5);
});

test('bozuk dosyanın üzerine yazılmaz', async () => {
  const file = await tempFile();
  await writeFile(file, '{ bozuk json');
  await assert.rejects(saveAlarm(priceAlarm(), file), /bozuk JSON/);
  assert.equal(await readFile(file, 'utf8'), '{ bozuk json');
});
