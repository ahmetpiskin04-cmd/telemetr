// Veri kaynağı sağlığı: bir kaynak art arda N tur hiç cevap vermezse (varsayılan 6 tur, ~30 dk), alarmların
// çalışmayabileceğini bildiren bir uyarı gönderir. Uyarı kaynak başına 24 saatte en fazla bir kez gider
// (son uyarı zamanı dosyada tutulur: uygulama yeniden başlasa da aynı gün tekrar uyarmaz).
// "Tur", kaynağın o turda sorgulandığı kontrol turudur; sorgulanmayan tur sayılmaz, hiç cevap gelmeyen tur
// ise başarısız sayılır. Tek bir başarılı cevap sayacı sıfırlar.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { writeJsonAtomic } from '../user-config.js';

export const FAILED_ROUNDS_BEFORE_WARNING = 6;
export const WARNING_GAP_MS = 24 * 3_600_000;

/** Uyarı metninde kaynağın adı ve neleri etkilediği. */
export const SOURCE_LABELS = Object.freeze({
  harem: 'Gram altın (Harem)',
  yahoo: 'Yahoo fiyat verisi (hisseler, ons altın, USD/TRY)',
});

const label = (source) => SOURCE_LABELS[source] ?? source;

/**
 * @param file     son uyarı zamanlarının tutulduğu JSON (alarms.json'un yanında)
 * @param notify   async (notification, settings) => void   (bildirim kanalları)
 * @param getSettings async () => settings                  (Telegram açık/kapalı için)
 */
export function createSourceHealth({
  file,
  notify,
  getSettings = async () => ({}),
  now = () => new Date(),
  threshold = FAILED_ROUNDS_BEFORE_WARNING,
  minGapMs = WARNING_GAP_MS,
  log = () => {},
}) {
  const failures = new Map(); // kaynak -> art arda başarısız tur
  const warning = new Set(); // uyarısı gönderilmekte olan kaynaklar (aynı anda iki kez gönderme)

  async function readWarned() {
    try {
      if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')).lastWarnedAt ?? {};
    } catch (err) {
      log(`Kaynak sağlığı dosyası okunamadı (${err.message}); uyarı sınırı sıfırdan başlıyor`);
    }
    return {};
  }

  /** Bir kontrol turunda kaynak cevap verdi mi? Asla fırlatmaz. */
  async function record(source, ok) {
    try {
      if (ok) {
        failures.set(source, 0);
        return false;
      }
      const count = (failures.get(source) ?? 0) + 1;
      failures.set(source, count);
      if (count < threshold || warning.has(source)) return false;

      const warned = await readWarned();
      const last = warned[source] ? Date.parse(warned[source]) : null;
      if (last && now().getTime() - last < minGapMs) return false;

      warning.add(source);
      try {
        // Önce zamanı kaydet: bildirim sırasında çökülse bile aynı gün ikinci kez uyarılmaz
        await writeJsonAtomic(file, { lastWarnedAt: { ...warned, [source]: now().toISOString() } });
        log(`${label(source)} ${count} tur art arda cevap vermedi; uyarı gönderiliyor`);
        await notify(
          { kind: 'warning', title: 'Telemetr: veri sorunu', text: `${label(source)} verisi alınamıyor, alarm çalışmıyor olabilir.` },
          await getSettings(),
        );
      } finally {
        warning.delete(source);
      }
      return true;
    } catch (err) {
      log(`Kaynak sağlığı işlenemedi (${source}): ${err.message}`);
      return false;
    }
  }

  return {
    record,
    /** Fiyat kaynağının onSource geri çağrısı: hiç cevap gelmediyse başarısız tur. */
    onSource: ({ source, received }) => void record(source, received > 0),
    failureCount: (source) => failures.get(source) ?? 0,
  };
}
