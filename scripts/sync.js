// Kullanım:
//   npm run sync                 -> bir kez güncelle
//   npm run sync -- --watch 60   -> 60 dakikada bir güncelle (Ctrl+C ile dur)
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDatabase } from '../src/db.js';
import { runSync } from '../src/sync.js';

const { values: args } = parseArgs({
  options: {
    watch: { type: 'string' },
  },
});

const db = openDatabase();
const log = (m) => console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ${m}`);

try {
  do {
    log('Veri güncelleme başladı');
    const result = await runSync(db, { log });
    const failed = result.results.filter((r) => !r.ok);
    log(`Bitti: ${result.results.length - failed.length}/${result.results.length} varlık güncellendi${failed.length ? `, hata: ${failed.map((r) => r.symbol).join(', ')}` : ''}`);
    if (!args.watch) {
      process.exitCode = result.ok ? 0 : 1;
      break;
    }
    const minutes = Math.max(5, Number(args.watch) || 60);
    log(`Sonraki güncelleme ${minutes} dk sonra`);
    await sleep(minutes * 60_000);
  } while (true);
} finally {
  db.close();
}
