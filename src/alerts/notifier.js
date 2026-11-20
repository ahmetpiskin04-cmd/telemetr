// Bildirim kanalları: Windows masaüstü bildirimi (her zaman) ve Telegram botu (isteğe bağlı).
// Telegram anahtarları kodda değil ortam değişkenlerinde durur: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID
// (main.js bunları ~/.evim/telemetr.env dosyasından yükler). Token hiçbir log satırına yazılmaz.
// Bir kanalın hatası diğerini engellemez; notifier asla fırlatmaz.

const TELEGRAM_TIMEOUT_MS = 8_000;

export function getTelegramConfig(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = String(env.TELEGRAM_CHAT_ID ?? '').trim();
  return token && chatId ? { token, chatId } : null;
}

/** Hata mesajından token'ı siler (fetch hataları bazen URL taşır). */
const scrub = (text, token) => (token ? String(text).split(token).join('***') : String(text));

/** Telegram'a düz metin gönderir. 5xx ve ağ hatasında bir kez daha dener; başarısızsa fırlatır. */
export async function sendTelegram({ token, chatId, text }, { fetchImpl = fetch, retryDelayMs = 1_500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok !== false) return true;
      lastError = new Error(`Telegram ${response.status}: ${body.description ?? 'bilinmeyen hata'}`);
      if (response.status < 500) break; // 4xx (yanlış token/chat id) tekrar denemekle düzelmez
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(scrub(lastError?.message ?? 'Telegram gönderilemedi', token));
}

/**
 * @param desktop  async ({ title, body }) => void; Electron'un Notification'ını çağırır (yoksa kanal atlanır)
 * @returns async (notification, settings) => { desktop, telegram }  // true/false/null(kanal kapalı)
 */
export function createNotifier({ desktop, env = process.env, fetchImpl = fetch, retryDelayMs, log = () => {} } = {}) {
  return async function notify(notification, settings = {}) {
    const { title, text, kind } = notification;
    const result = { desktop: null, telegram: null };

    if (desktop) {
      try {
        await desktop({ title, body: text });
        result.desktop = true;
      } catch (err) {
        result.desktop = false;
        log(`Masaüstü bildirimi gösterilemedi: ${err.message}`);
      }
    }

    const telegram = settings.telegramEnabled === false ? null : getTelegramConfig(env);
    if (telegram) {
      try {
        const prefix = kind === 'info' ? 'ℹ️' : '🔔';
        await sendTelegram({ ...telegram, text: `${prefix} ${title}\n${text}` }, { fetchImpl, retryDelayMs });
        result.telegram = true;
      } catch (err) {
        result.telegram = false;
        log(`Telegram bildirimi gönderilemedi: ${scrub(err.message, telegram.token)}`);
      }
    }
    return result;
  };
}
