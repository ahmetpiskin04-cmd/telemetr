// Kullanım:
//   npm run ai -- [--provider openai|gemini] [--model ID] [--portfolio dosya.json]
//                 [--news haberler.json] [--rss] [--days 30] [--share-amounts] [--dry-run]
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { prepareAdvisorRequest } from '../src/ai/advisor.js';
import { resolveProvider } from '../src/ai/providers.js';
import {
  loadAdvisorInputs,
  generateAndSaveReport,
  DEFAULT_PORTFOLIO_PATH,
  DEFAULT_REPORTS_DIR,
} from '../src/ai/service.js';

const { values: args } = parseArgs({
  options: {
    provider: { type: 'string', default: process.env.AI_PROVIDER ?? 'openai' },
    model: { type: 'string' },
    portfolio: { type: 'string', default: DEFAULT_PORTFOLIO_PATH },
    news: { type: 'string' },
    rss: { type: 'boolean', default: false },
    'news-hours': { type: 'string', default: '24' },
    days: { type: 'string', default: '30' },
    'share-amounts': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'out-dir': { type: 'string', default: DEFAULT_REPORTS_DIR },
  },
});

const db = openDatabase();
try {
  const { portfolio, news } = await loadAdvisorInputs({
    portfolioPath: args.portfolio,
    newsFile: args.news,
    rss: args.rss,
    newsHours: Number(args['news-hours']),
    warn: (m) => console.warn(`⚠ ${m}`),
  });
  const options = { portfolio, news, days: Number(args.days), shareAmounts: args['share-amounts'] };

  if (args['dry-run']) {
    const req = await prepareAdvisorRequest(db, options);
    await mkdir(args['out-dir'], { recursive: true });
    const file = path.join(args['out-dir'], `${req.context.meta.asOf}-prompt.json`);
    await writeFile(file, JSON.stringify({ system: req.system, user: req.user, schema: req.schema }, null, 2));
    console.log(req.user);
    console.log(`\n— Dry run: API çağrılmadı. Sistem promptu ${req.system.length} karakter, kullanıcı mesajı ${req.user.length} karakter.`);
    console.log(`— Modele gidecek içeriğin tamamı: ${file}`);
  } else {
    const { model } = resolveProvider(args.provider, { model: args.model });
    console.error(`${args.provider} / ${model} çağrılıyor (${news.length} haber başlığı)...`);
    const { result, markdown, files } = await generateAndSaveReport(db, {
      ...options,
      provider: args.provider,
      model: args.model,
      outDir: args['out-dir'],
    });
    console.log(markdown);
    console.error(`\nKaydedildi: ${files.markdown}  ·  token: ${result.usage.inputTokens ?? '?'} giriş, ${result.usage.outputTokens ?? '?'} çıkış`);
    if (!result.verification.ok) process.exitCode = 2; // doğrulama hatası: rapor uydurma veri içeriyor
  }
} finally {
  db.close();
}
