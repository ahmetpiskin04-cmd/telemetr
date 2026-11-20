// Borsa İstanbul seans saati: hafta içi 10:00-18:00 (İstanbul saati). Resmî tatiller burada bilinmez;
// zamanlayıcı ek olarak Yahoo'nun piyasa durumuna (marketState) bakar, tatil günü fiyat akmıyorsa bildirmez.
export const BIST_TIME_ZONE = 'Europe/Istanbul';
export const BIST_OPEN_MINUTE = 10 * 60;
export const BIST_CLOSE_MINUTE = 18 * 60;

/** İstanbul saatine göre { weekday: 'Mon'..'Sun', minutes: günün dakikası }. */
export function istanbulClock(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BIST_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Hafta içi 10:00 <= saat < 18:00 (İstanbul). */
export function isBistSessionOpen(date) {
  const { weekday, minutes } = istanbulClock(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= BIST_OPEN_MINUTE && minutes < BIST_CLOSE_MINUTE;
}
