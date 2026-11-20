// Paketlenmiş (exe) sürümde veri dosyaları kullanıcı veri klasörüne (%APPDATA%\telemetr\data) yazılır;
// kurulum klasörü salt okunur olabilir. Geliştirmede (npm run dev/start) data/ proje içinde kalır.
// src/* modülleri yolları import anında okuduğu için bu dosya main.js'te ipc.js'ten ÖNCE import edilmelidir.
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

if (app.isPackaged) {
  const dataDir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  process.env.FINANS_DB ??= path.join(dataDir, 'finans.db');
  process.env.FINANS_WATCHLIST ??= path.join(dataDir, 'watchlist.json');
  process.env.FINANS_PORTFOLIO ??= path.join(dataDir, 'portfolio.json');
  process.env.FINANS_REPORTS_DIR ??= path.join(dataDir, 'reports');
}
