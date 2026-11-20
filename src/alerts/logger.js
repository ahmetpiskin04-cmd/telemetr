// Alarm günlüğü: data/alerts.log. Paketli uygulamada konsol görünmediği için "hatayı logla" dosyaya yazılır.
// Dosya 512 KB'ı geçince alerts.log.1'e devredilir (en fazla ~1 MB yer tutar). Günlük yazılamazsa sessizce yutulur:
// günlük tutmak asla alarm kontrolünü durdurmamalı. Gizli bilgi (token) bu modüle hiç gelmez, ama gelirse de
// çağıranlar önce temizlemiştir (bkz. notifier.js).
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';

const MAX_BYTES = 512 * 1024;

export function createLogger(file, { echo = false, now = () => new Date() } = {}) {
  return function log(message) {
    const line = `${now().toISOString()} ${String(message).replace(/\s*\n\s*/g, ' ')}\n`;
    if (echo) process.stderr.write(line);
    if (!file) return;
    try {
      if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
      appendFileSync(file, line);
    } catch {
      // günlük yazılamıyor: önemli değil
    }
  };
}
