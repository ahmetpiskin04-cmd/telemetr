// Alarmların kalıcı deposu: data/alarms.json (ayarlar + izlenen varlıklar + alarmlar + alarm durumları).
// Biçim portfolio.json gibi düz JSON; yazma atomik (önce .tmp, sonra taşıma). Dosya yoksa varsayılanla başlar.
// Tüm okuma-değiştirme-yazma işlemleri tek bir kuyruktan geçer: arayüzden gelen düzenleme ile
// arka plandaki değerlendirme aynı anda dosyayı ezemez.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeJsonAtomic } from '../user-config.js';
import { resolveAsset } from './price-feed.js';

export const DEFAULT_ALARMS_PATH = process.env.FINANS_ALARMS ?? path.resolve(import.meta.dirname, '..', '..', 'data', 'alarms.json');

export const ALARM_TYPES = Object.freeze({
  PRICE: 'price',
  DAILY_CHANGE: 'daily_change',
  AVG_DEVIATION: 'avg_deviation',
  PORTFOLIO_LOSS: 'portfolio_loss',
});

export const DEFAULT_ASSETS = Object.freeze(['ASELS', 'BIMAS', 'ENJSA', 'EREGL', 'TUPRS', 'GRAM_ALTIN', 'ONS_ALTIN', 'USDTRY']);

/** Kodda sabit değil: hepsi ayarlardan değişir. */
export const DEFAULT_SETTINGS = Object.freeze({
  lossLimitTry: 1800, // toplam hisse zararı sınırı (TL)
  lossWarnRatio: 0.8, // sınırın bu oranında ilk uyarı
  checkIntervalMinutes: 5, // altın/döviz kontrol aralığı (BİST seansında da aynı)
  defaultCooldownHours: 24, // aynı alarm tekrar tetiklenmeden önce bekleme
  telegramEnabled: true, // token/chat id ortam değişkenlerinde yoksa kendiliğinden atlanır
});

const freshState = () => ({ initialized: false, armed: null, stage: null, lastValue: null, lastCheckedAt: null });

const fail = (message) => {
  throw new Error(message);
};

const num = (value, label) => {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) fail(`${label} geçerli bir sayı değil`);
  return n;
};

const normSymbol = (raw) => String(raw ?? '').trim().toUpperCase().replace(/[İı]/g, 'I').replace(/\.IS$/, '');

// ---- doğrulama -------------------------------------------------------------------------------

export function normalizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const s = { ...base, ...input };
  const out = {
    lossLimitTry: num(s.lossLimitTry, 'Zarar sınırı'),
    lossWarnRatio: num(s.lossWarnRatio, 'Yaklaşma oranı'),
    checkIntervalMinutes: num(s.checkIntervalMinutes, 'Kontrol aralığı'),
    defaultCooldownHours: num(s.defaultCooldownHours, 'Bekleme süresi'),
    telegramEnabled: Boolean(s.telegramEnabled),
  };
  if (!(out.lossLimitTry > 0)) fail('Zarar sınırı sıfırdan büyük olmalı');
  if (!(out.lossWarnRatio > 0 && out.lossWarnRatio < 1)) fail('Yaklaşma oranı 0 ile 1 arasında olmalı (ör. 0,8)');
  if (!Number.isInteger(out.checkIntervalMinutes) || out.checkIntervalMinutes < 1 || out.checkIntervalMinutes > 1440) {
    fail('Kontrol aralığı 1-1440 dakika arası tam sayı olmalı');
  }
  if (!(out.defaultCooldownHours >= 0 && out.defaultCooldownHours <= 720)) fail('Bekleme süresi 0-720 saat arasında olmalı');
  return out;
}

function normalizeParams(type, p = {}) {
  switch (type) {
    case ALARM_TYPES.PRICE: {
      if (!['below', 'above'].includes(p.direction)) fail('Yön "below" (altına) ya da "above" (üstüne) olmalı');
      const threshold = num(p.threshold, 'Eşik');
      if (!(threshold > 0)) fail('Eşik sıfırdan büyük olmalı');
      return { direction: p.direction, threshold };
    }
    case ALARM_TYPES.DAILY_CHANGE: {
      if (!['down', 'up'].includes(p.direction)) fail('Yön "down" (düşerse) ya da "up" (yükselirse) olmalı');
      const percent = num(p.percent, 'Yüzde');
      if (!(percent > 0 && percent <= 100)) fail('Yüzde 0 ile 100 arasında olmalı');
      return { direction: p.direction, percent };
    }
    case ALARM_TYPES.AVG_DEVIATION: {
      const percent = num(p.percent, 'Yüzde');
      const days = p.days === undefined ? 20 : num(p.days, 'Gün sayısı');
      if (!(percent > 0 && percent < 100)) fail('Yüzde 0 ile 100 arasında olmalı');
      if (!Number.isInteger(days) || days < 2 || days > 250) fail('Gün sayısı 2-250 arası tam sayı olmalı');
      return { percent, days };
    }
    case ALARM_TYPES.PORTFOLIO_LOSS:
      return {}; // sınır ve oran ayarlardan gelir
    default:
      return fail(`Bilinmeyen alarm türü: ${type}`);
  }
}

const fmt = (n) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 4 }).format(n);

function defaultName(type, symbol, params) {
  switch (type) {
    case ALARM_TYPES.PRICE:
      return `${symbol} ${params.direction === 'below' ? '<' : '>'} ${fmt(params.threshold)}`;
    case ALARM_TYPES.DAILY_CHANGE:
      return `${symbol} günlük ${params.direction === 'down' ? '-' : '+'}%${fmt(params.percent)}`;
    case ALARM_TYPES.AVG_DEVIATION:
      return `${symbol} ${params.days}g ortalamanın %${fmt(params.percent)} altı`;
    default:
      return 'Portföy zarar sınırı';
  }
}

/** Arayüzden / dosyadan gelen alarmı doğrular ve tam biçime getirir. Hatada Türkçe mesajla fırlatır. */
export function normalizeAlarm(input = {}, settings = DEFAULT_SETTINGS) {
  const type = input.type;
  if (!Object.values(ALARM_TYPES).includes(type)) fail(`Bilinmeyen alarm türü: ${type}`);
  const params = normalizeParams(type, input.params ?? input);
  let symbol = null;
  if (type !== ALARM_TYPES.PORTFOLIO_LOSS) {
    symbol = normSymbol(input.symbol);
    if (!resolveAsset(symbol)) fail(`Geçersiz varlık kodu: ${input.symbol ?? ''}`.trim());
  }
  const cooldownHours = input.cooldownHours === undefined || input.cooldownHours === '' ? settings.defaultCooldownHours : num(input.cooldownHours, 'Bekleme süresi');
  if (!(cooldownHours >= 0 && cooldownHours <= 720)) fail('Bekleme süresi 0-720 saat arasında olmalı');
  const name = String(input.name ?? '').trim().slice(0, 60) || defaultName(type, symbol, params);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : randomUUID(),
    name,
    type,
    symbol,
    params,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    cooldownHours,
    once: Boolean(input.once),
    lastTriggeredAt: input.lastTriggeredAt ?? null,
    rev: Number.isInteger(input.rev) ? input.rev : 1,
    state: { ...freshState(), ...(input.state ?? {}) },
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

// ---- dosya işlemleri -------------------------------------------------------------------------

let queue = Promise.resolve();
/** İşlemleri sırayla çalıştırır; biri hata verse de kuyruk tıkanmaz. */
const serialized = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function readRaw(file) {
  if (!existsSync(file)) return {};
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    // Bozuk dosyanın üzerine yazıp kullanıcının alarmlarını silmeyiz
    throw new Error(`${file} okunamadı (bozuk JSON): ${err.message}`);
  }
}

function hydrate(raw) {
  const settings = normalizeSettings(raw.settings ?? {});
  const assets = [...new Set((raw.assets ?? DEFAULT_ASSETS).map(normSymbol))].filter((s) => resolveAsset(s));
  const alarms = (raw.alarms ?? []).map((a) => normalizeAlarm(a, settings));
  return { version: 1, settings, assets, alarms };
}

/** Normalleştirilmiş içerik; dosya yoksa varsayılanlar. */
export const readAlarmsFile = (file = DEFAULT_ALARMS_PATH) => serialized(async () => hydrate(await readRaw(file)));

/** Okur -> `mutate(data)` -> yazar; hepsi kuyrukta. `mutate` sonucu döner. */
function update(file, mutate) {
  return serialized(async () => {
    const data = hydrate(await readRaw(file));
    const result = await mutate(data);
    await writeJsonAtomic(file, data);
    return result;
  });
}

/** Yeni alarm ekler (id yok) ya da var olanı günceller (id var). Düzenleme durumu sıfırlar. */
export function saveAlarm(input, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    const index = input.id ? data.alarms.findIndex((a) => a.id === input.id) : -1;
    if (input.id && index < 0) fail('Alarm bulunamadı');
    const previous = index >= 0 ? data.alarms[index] : null;
    const alarm = normalizeAlarm({ ...input, enabled: input.enabled ?? previous?.enabled, lastTriggeredAt: previous?.lastTriggeredAt ?? null, createdAt: previous?.createdAt, rev: (previous?.rev ?? 0) + 1, state: undefined }, data.settings);
    if (alarm.symbol && !data.assets.includes(alarm.symbol)) data.assets.push(alarm.symbol);
    if (previous) data.alarms[index] = alarm;
    else data.alarms.push(alarm);
    return alarm;
  });
}

export function deleteAlarm(id, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    const before = data.alarms.length;
    data.alarms = data.alarms.filter((a) => a.id !== id);
    if (data.alarms.length === before) fail('Alarm bulunamadı');
    return true;
  });
}

/** Açma/kapama. Yeniden açılan alarm, "ilk gözlem" kuralıyla baştan başlar (eşiğin ötesindeyse hemen tetiklenmez). */
export function setAlarmEnabled(id, enabled, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    const alarm = data.alarms.find((a) => a.id === id) ?? fail('Alarm bulunamadı');
    alarm.enabled = Boolean(enabled);
    if (alarm.enabled) {
      alarm.state = freshState();
      alarm.rev += 1;
    }
    return alarm;
  });
}

/** Ayarları (kısmen) günceller. Zarar sınırı/oran değişince portföy alarmları baştan başlar. */
export function updateSettings(patch, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    const next = normalizeSettings(patch, data.settings);
    const lossChanged = next.lossLimitTry !== data.settings.lossLimitTry || next.lossWarnRatio !== data.settings.lossWarnRatio;
    data.settings = next;
    if (lossChanged) {
      for (const a of data.alarms.filter((x) => x.type === ALARM_TYPES.PORTFOLIO_LOSS)) {
        a.state = freshState();
        a.rev += 1;
      }
    }
    return next;
  });
}

export function addAsset(symbol, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    const code = normSymbol(symbol);
    if (!resolveAsset(code)) fail(`Geçersiz varlık kodu: ${symbol}`);
    if (!data.assets.includes(code)) data.assets.push(code);
    return code;
  });
}

export function removeAsset(symbol, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    const code = normSymbol(symbol);
    const bound = data.alarms.filter((a) => a.symbol === code);
    if (bound.length > 0) fail(`${code} için ${bound.length} alarm var; önce onları sil`);
    data.assets = data.assets.filter((s) => s !== code);
    return true;
  });
}

/**
 * Değerlendirme sonuçlarını yazar: updates = [{ id, rev, patch }]. Değerlendirme sürerken alarm
 * silindiyse ya da kullanıcı düzenlediyse (rev değiştiyse) o sonuç atılır; eski durum yeni alarmı ezmesin.
 */
export function applyAlarmUpdates(updates, file = DEFAULT_ALARMS_PATH) {
  return update(file, (data) => {
    let applied = 0;
    for (const { id, rev, patch } of updates) {
      const alarm = data.alarms.find((a) => a.id === id);
      if (!alarm || alarm.rev !== rev) continue;
      if (patch.state) alarm.state = { ...alarm.state, ...patch.state };
      if (patch.lastTriggeredAt !== undefined) alarm.lastTriggeredAt = patch.lastTriggeredAt;
      if (patch.enabled !== undefined) alarm.enabled = patch.enabled;
      applied += 1;
    }
    return applied;
  });
}
