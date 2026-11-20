// Harem Altın canlı fiyat yayını (Kapalıçarşı fiziksel alış/satış).
// Site fiyatları Socket.IO v4 üzerinden `price_changed` olayıyla yayınlıyor. Protokol basit
// olduğu için ek bağımlılık yerine Node'un yerleşik WebSocket'i kullanılır:
//   sunucu "0{...}" (açıldı) -> biz "40" (bağlan) -> sunucu "42[olay, veri]" ; "2" ping -> "3" pong
// Yalnızca anlık kotasyon verir, geçmiş vermez: makas geçmişi her senkronizasyonla birikir.

export const HAREM_SOCKET_URL = 'wss://hrmsocketonly.haremaltin.com/socket.io/?EIO=4&transport=websocket';

/** "17-10-2026 13:39:44" (İstanbul saati) -> { date: "2026-10-17", time: "13:39:44" } */
export function parseHaremTimestamp(text) {
  const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})$/.exec(String(text ?? '').trim());
  return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] } : null;
}

/** Tek bir kotasyon kaydını normalize eder; alış/satış metin veya sayı gelebilir. */
export function parseHaremQuote(raw) {
  const bid = Number(raw?.alis);
  const ask = Number(raw?.satis);
  const ts = parseHaremTimestamp(raw?.tarih);
  if (!(bid > 0) || !(ask > 0) || !ts) return null;
  return { code: raw.code, bid, ask, mid: (bid + ask) / 2, date: ts.date, time: ts.time };
}

/** Socket.IO çerçevesinden price_changed verisini çıkarır; başka çerçevelerde null. */
export function parsePriceFrame(frame) {
  if (!frame.startsWith('42')) return null;
  try {
    const [event, payload] = JSON.parse(frame.slice(2));
    return event === 'price_changed' ? (payload?.data ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * İstenen kodların kotasyonlarını toplar. Hepsi gelince veya süre dolunca kapanır;
 * hiç kotasyon gelmezse hata fırlatır. Dönüş: Map<kod, kotasyon>
 */
export function fetchHaremQuotes(codes, { timeoutMs = 12_000, WebSocketImpl = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    const wanted = new Set(codes);
    const quotes = new Map();
    const ws = new WebSocketImpl(HAREM_SOCKET_URL);
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // zaten kapalı
      }
      if (quotes.size > 0) resolve(quotes);
      else reject(err ?? new Error('Harem: süre içinde kotasyon gelmedi'));
    };
    const timer = setTimeout(() => finish(), timeoutMs);

    ws.onmessage = ({ data }) => {
      const frame = String(data);
      if (frame.startsWith('0')) ws.send('40');
      else if (frame === '2') ws.send('3');
      else {
        const prices = parsePriceFrame(frame);
        if (!prices) return;
        for (const raw of Object.values(prices)) {
          if (!wanted.has(raw?.code)) continue;
          const q = parseHaremQuote(raw);
          if (q) quotes.set(q.code, q);
        }
        if ([...wanted].every((c) => quotes.has(c))) finish();
      }
    };
    ws.onerror = (e) => finish(new Error(`Harem bağlantı hatası: ${e?.message ?? 'bilinmiyor'}`));
    ws.onclose = () => finish();
  });
}
