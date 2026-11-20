// Sahte fiyatla alarm denemesi. Gerçek alarmlarına ve portföyüne dokunmaz; geçici klasörde çalışır.
//
//   npm run alarm:test -- fiyat BIMAS 380 --esik 385
//   npm run alarm:test -- fiyat BIMAS 390 --esik 385 --yon ust
//   npm run alarm:test -- gunluk ASELS 96,5 --onceki-kapanis 100 --yuzde 3
//   npm run alarm:test -- ortalama EREGL 37 --ortalama 40 --yuzde 5
//   npm run alarm:test -- zarar 1500                       (sınır ve oran: --sinir 1800 --oran 80)
//   npm run alarm:test -- fiyat ONS_ALTIN 3590 --esik 3600 (metinde "(vadeli)" görünür)
//
// Seçenekler: --gecikmeli  (bildirime "gecikmeli veri" notu ekler)
//             --telegram   (bildirimi gerçek Telegram botuna da gönderir; anahtarlar ~/.evim/telemetr.env'den)
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotifier } from '../src/alerts/notifier.js';
import { runScenario } from '../src/alerts/simulate.js';

const TYPES = { fiyat: 'price', gunluk: 'daily_change', ortalama: 'avg_deviation', zarar: 'portfolio_loss' };
const num = (text) => (text === undefined ? undefined : Number(String(text).replace(',', '.')));

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--gecikmeli' || a === '--telegram') flags[a.slice(2)] = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[(i += 1)];
  else positional.push(a);
}

const [typeWord, ...rest] = positional;
const type = TYPES[typeWord];
if (!type) {
  console.error('Kullanım: npm run alarm:test -- <fiyat|gunluk|ortalama|zarar> ...\nÖrnek:    npm run alarm:test -- fiyat BIMAS 380 --esik 385\nAyrıntı: bu dosyanın başındaki yorum.');
  process.exit(1);
}

const opts = { type, delayed: Boolean(flags.gecikmeli) };
if (type === 'portfolio_loss') {
  opts.lossTry = num(rest[0]);
  if (flags.sinir) opts.lossLimitTry = num(flags.sinir);
  if (flags.oran) opts.lossWarnRatio = num(flags.oran) / 100;
} else {
  opts.symbol = rest[0];
  opts.price = num(rest[1]);
  opts.threshold = num(flags.esik);
  opts.percent = num(flags.yuzde);
  opts.previousClose = num(flags['onceki-kapanis']);
  opts.average = num(flags.ortalama);
  const dir = { alt: 'below', ust: 'above', dus: 'down', yuk: 'up' }[flags.yon];
  if (dir) opts.direction = dir;
}

let notify;
if (flags.telegram) {
  const envFile = path.join(os.homedir(), '.evim', 'telemetr.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const real = createNotifier({ log: (m) => console.error(`  ! ${m}`) }); // yalnızca Telegram (masaüstü kanalı yok)
  notify = async (n, settings) => {
    const result = await real(n, settings);
    console.log(`  Telegram: ${result.telegram === true ? 'gönderildi' : result.telegram === false ? 'GÖNDERİLEMEDİ' : 'kapalı (anahtar yok ya da ayarlardan kapalı)'}`);
  };
}

try {
  const { steps } = await runScenario(opts, notify);
  for (const step of steps) {
    console.log(`\n${step.label}  [fiyat ${step.price}]`);
    if (step.notifications.length === 0) console.log('  (bildirim yok)');
    for (const n of step.notifications) console.log(`  ${n.kind === 'info' ? 'BİLGİ' : 'BİLDİRİM'}: ${n.text}`);
  }
  const fired = steps[1].notifications.length > 0 && steps[0].notifications.length === 0 && steps[2].notifications.length === 0;
  console.log(`\nSonuç: ${fired ? 'beklendiği gibi (2. adımda tek bildirim)' : 'BEKLENMEDİK: adımları yukarıda kontrol et'}`);
  process.exit(fired ? 0 : 2);
} catch (err) {
  console.error(`Hata: ${err.message}`);
  process.exit(1);
}
