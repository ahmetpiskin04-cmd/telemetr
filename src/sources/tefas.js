// TEFAS fon fiyatları. TEFAS Nisan 2026'da yeni siteye geçti; eski /api/DB/BindHistoryInfo
// kapatıldı. Yeni uç nokta JSON alır ve yalnızca sabit dönem kodlarını kabul eder.
// Ardışık isteklere ~45 sn süren HTTP 429 bloğuyla yanıt verir: istekler sıralı ve aralıklı.
import { setTimeout as sleep } from 'node:timers/promises';

export const TEFAS_PRICE_URL = 'https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir';

// "periyod" alanının kabul ettiği değerler (ay cinsinden; 60 = 5 yıl üst sınır)
export const TEFAS_PERIODS = { month1: 1, month3: 3, month6: 6, year1: 12, year3: 36, year5: 60 };

export class TefasError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TefasError';
    this.status = status;
  }
}

/** [{ date, close }] eskiden yeniye + fonun tam adı. */
export async function fetchFundHistory(
  code,
  { periyod = TEFAS_PERIODS.year1, fetchImpl = fetch, rateLimitWaitMs = 45_000, timeoutMs = 30_000 } = {},
) {
  const body = JSON.stringify({ fonKodu: code.toUpperCase(), dil: 'TR', periyod });
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(TEFAS_PRICE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Telemetr/0.1',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429 && attempt === 0) {
      await sleep(rateLimitWaitMs); // TEFAS Retry-After göndermiyor
      continue;
    }
    if (!res.ok) throw new TefasError(`TEFAS HTTP ${res.status} (${code})`, res.status);

    const json = await res.json();
    if (json.errorMessage) throw new TefasError(`TEFAS: ${json.errorMessage} (${code})`);
    const list = json.resultList ?? [];
    if (list.length === 0) throw new TefasError(`TEFAS'ta veri yok: ${code}`);

    const rows = list
      .filter((r) => r.tarih && r.fiyat > 0)
      .map((r) => ({ date: String(r.tarih).slice(0, 10), close: Number(r.fiyat) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { rows, name: list[0].fonUnvan ?? null };
  }
}
