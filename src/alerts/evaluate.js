// Alarm değerlendirme çekirdeği. Saf fonksiyonlar: ağ, dosya, saat yok; her şey parametreyle gelir.
//
// Temel fikir "silahlanma" (armed): alarm yalnızca eşiğin güvenli tarafından ötesine GEÇİŞTE tetiklenir.
//  - İlk gözlemde fiyat zaten eşiğin ötesindeyse alarm tetiklenmez, "beklemede" (armed=false) kaydedilir.
//  - Fiyat güvenli tarafa dönünce silahlanır (armed=true); sonraki geçişte tetiklenir.
//  - Tetiklenince silahsızlanır; fiyat eşiğin ötesinde kaldığı sürece tekrar bildirim gelmez.
//  - Bekleme süresi (cooldown) içindeki geçiş bildirim üretmez ve tüketilir (spam engeli).
//  - Seans dışı (canNotify=false) geçiş tüketilmez; seans açılınca ilk kontrolde bildirilir.
import { ALARM_TYPES } from './store.js';
import { messages } from './messages.js';

const HOUR_MS = 3_600_000;
const STAGE_RANK = { none: 0, warn: 1, over: 2 };

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

function inCooldown(alarm, now) {
  if (!alarm.lastTriggeredAt || !(alarm.cooldownHours > 0)) return false;
  return now.getTime() - Date.parse(alarm.lastTriggeredAt) < alarm.cooldownHours * HOUR_MS;
}

// ---- portföy zararı ----------------------------------------------------------------------------

/**
 * Hisse pozisyonlarının toplam gerçekleşmemiş zararı. Yalnızca adet ve maliyeti girilmiş hisseler sayılır
 * (altın, fon ve maliyeti olmayan pozisyonlar dışında). Net kâr varsa zarar 0'dır.
 * Fiyatı alınamayan bir hisse varsa sonuç eksik olurdu (zarar olduğundan az görünürdü); bu yüzden null döner.
 */
export function computePortfolioLoss(positions, quotes, stockSymbols) {
  const counted = [];
  let netPnl = 0;
  for (const p of positions ?? []) {
    const symbol = String(p.symbol).toUpperCase();
    if (!stockSymbols.has(symbol) || !(p.quantity > 0) || !(p.avgCost > 0)) continue;
    const price = quotes.get(symbol)?.price;
    if (!(price > 0)) return null;
    netPnl += (price - p.avgCost) * p.quantity;
    counted.push(symbol);
  }
  if (counted.length === 0) return null;
  return { lossTry: Math.max(0, -netPnl), netPnl, symbols: counted };
}

export function lossStage(lossTry, settings) {
  if (lossTry >= settings.lossLimitTry) return 'over';
  if (lossTry >= settings.lossLimitTry * settings.lossWarnRatio) return 'warn';
  return 'none';
}

function evaluatePortfolioLoss(alarm, snapshot, ctx) {
  const { now, settings } = ctx;
  const loss = snapshot.loss;
  if (!loss) return null;
  const stage = lossStage(loss.lossTry, settings);
  const state = alarm.state;
  const stamp = { lastValue: loss.lossTry, lastCheckedAt: now.toISOString() };

  // İlk gözlem: silahsız bırakılmaz. Zarar zaten uyarı seviyesindeyse bir kez bilgi verilir, sonra normal çalışır.
  if (!state.initialized) {
    const info = stage === 'none' ? null : { kind: 'info', title: alarm.name, text: messages.lossInfo(loss.lossTry, settings) };
    return { patch: { state: { initialized: true, armed: true, stage, ...stamp } }, notification: info };
  }

  const previous = state.stage ?? 'none';
  if (STAGE_RANK[stage] <= STAGE_RANK[previous]) {
    return { patch: { state: { stage, ...stamp } }, notification: null }; // aynı ya da düşük seviye: yalnızca kaydet
  }

  // Yükselen seviye. Uyarıdan aşmaya ilk geçiş bekleme süresine takılmaz (daha ciddi bir durum)
  if (!ctx.canNotify) return { patch: { state: stamp }, notification: null }; // seans açılınca bildirilir
  // Bekleme süresi: uyarı seviyesi her zaman, aşma seviyesi ise yalnızca daha önce aşma bildirildiyse (sınır çevresinde gidip gelmede spam olmasın)
  const suppressed = inCooldown(alarm, now) && (stage === 'warn' || state.notifiedStage === 'over');
  if (suppressed) return { patch: { state: { stage, ...stamp } }, notification: null };

  const patch = { state: { stage, notifiedStage: stage, ...stamp }, lastTriggeredAt: now.toISOString() };
  if (stage === 'over' && alarm.once) patch.enabled = false;
  return { patch, notification: { kind: 'alert', title: alarm.name, text: messages.lossStage(stage, loss.lossTry, settings) } };
}

// ---- fiyat tabanlı alarmlar --------------------------------------------------------------------

/** Koşulun sağlanıp sağlanmadığı ve bildirim metni. Veri yetersizse null. */
function priceCondition(alarm, snapshot) {
  const quote = snapshot.quote;
  if (!quote || !(quote.price > 0)) return null;
  switch (alarm.type) {
    case ALARM_TYPES.PRICE: {
      const { direction, threshold } = alarm.params;
      const met = direction === 'below' ? quote.price < threshold : quote.price > threshold;
      return { met, value: quote.price, text: () => messages.price(alarm, quote) };
    }
    case ALARM_TYPES.DAILY_CHANGE: {
      if (!(quote.previousClose > 0)) return null;
      const change = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
      const { direction, percent } = alarm.params;
      const met = direction === 'down' ? change <= -percent : change >= percent;
      return { met, value: change, text: () => messages.dailyChange(alarm, quote, change) };
    }
    case ALARM_TYPES.AVG_DEVIATION: {
      const closes = snapshot.closes;
      if (!closes || closes.length < alarm.params.days) return null;
      const average = mean(closes.slice(-alarm.params.days));
      const deviation = ((average - quote.price) / average) * 100; // pozitif = ortalamanın altında
      return { met: deviation >= alarm.params.percent, value: deviation, text: () => messages.avgDeviation(alarm, quote, average, deviation) };
    }
    default:
      return null;
  }
}

/**
 * Tek alarmı değerlendirir.
 *   snapshot: { quote, closes, loss }  (alarm türüne göre gerekeni)
 *   ctx: { now: Date, settings, canNotify: boolean }
 * Dönüş: null (veri yetersiz: alarm sessizce atlanır, durum değişmez) ya da
 *   { patch: { state, lastTriggeredAt?, enabled? }, notification: { kind, title, text } | null }
 */
export function evaluateAlarm(alarm, snapshot, ctx) {
  if (!alarm.enabled) return null;
  if (alarm.type === ALARM_TYPES.PORTFOLIO_LOSS) return evaluatePortfolioLoss(alarm, snapshot, ctx);

  const condition = priceCondition(alarm, snapshot);
  if (!condition) return null;
  const { now } = ctx;
  const stamp = { lastValue: condition.value, lastCheckedAt: now.toISOString() };
  const state = alarm.state;

  // İlk gözlem: eşiğin ötesindeyse silahsız (beklemede), değilse silahlı. Asla tetiklenmez.
  if (!state.initialized) {
    return { patch: { state: { initialized: true, armed: !condition.met, ...stamp } }, notification: null };
  }

  if (!condition.met) return { patch: { state: { armed: true, ...stamp } }, notification: null };
  if (state.armed !== true) return { patch: { state: stamp }, notification: null }; // hâlâ ötesinde: tekrar bildirim yok

  // Silahlıyken geçiş
  if (!ctx.canNotify) return { patch: { state: stamp }, notification: null }; // tüketme: seans açılınca bildir
  if (inCooldown(alarm, now)) return { patch: { state: { armed: false, ...stamp } }, notification: null }; // geçiş tüketildi

  const patch = { state: { armed: false, ...stamp }, lastTriggeredAt: now.toISOString() };
  if (alarm.once) patch.enabled = false;
  return { patch, notification: { kind: 'alert', title: alarm.name, text: condition.text() } };
}

// ---- arayüz için durum metni -------------------------------------------------------------------

/** Alarm listesinde gösterilen kısa durum. Silahsız alarm için istenen "Beklemede" açıklaması dahil. */
export function alarmStatusText(alarm) {
  if (!alarm.enabled) return 'Kapalı';
  if (!alarm.state.initialized) return 'İlk fiyat bekleniyor';
  if (alarm.type === ALARM_TYPES.PORTFOLIO_LOSS) {
    if (alarm.state.stage === 'over') return 'Sınır aşıldı; uyarı verildi';
    if (alarm.state.stage === 'warn') return 'Yaklaşma uyarısı verildi';
    return 'Aktif';
  }
  if (alarm.state.armed === false) return 'Beklemede: fiyat henüz eşiğin güvenli tarafına dönmedi';
  return 'Aktif';
}
