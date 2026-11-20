// CLI ve masaüstü uygulamasının ortak kullandığı rapor servisi: girdileri yükle, raporu
// üret ve kaydet, son raporu oku.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortfolio } from './context.js';
import { loadNewsFile, fetchRssHeadlines, mergeNews } from './news.js';
import { runAdvisor } from './advisor.js';
import { renderMarkdown } from './render.js';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DEFAULT_PORTFOLIO_PATH = process.env.FINANS_PORTFOLIO ?? path.join(PROJECT_ROOT, 'data', 'portfolio.json');
export const DEFAULT_REPORTS_DIR = process.env.FINANS_REPORTS_DIR ?? path.join(PROJECT_ROOT, 'data', 'reports');

/** Portföy dosyası ve haberler (dosya + isteğe bağlı RSS). Uyarılar `warn` ile bildirilir. */
export async function loadAdvisorInputs({
  portfolioPath = DEFAULT_PORTFOLIO_PATH,
  newsFile,
  rss = false,
  newsHours = 24,
  warn = () => {},
} = {}) {
  let portfolio;
  if (existsSync(portfolioPath)) portfolio = await loadPortfolio(portfolioPath);
  else warn(`Portföy dosyası yok (${portfolioPath}); tüm varlıklar izleme listesi sayılacak.`);

  const lists = [];
  if (newsFile) lists.push(await loadNewsFile(newsFile));
  if (rss) {
    const { items, errors } = await fetchRssHeadlines(undefined, { hours: newsHours });
    errors.forEach((e) => warn(`RSS alınamadı: ${e}`));
    lists.push(items);
  }
  return { portfolio, news: mergeNews(lists) };
}

/** Raporu üretir, <outDir>/<tarih>-<sağlayıcı>.{json,md} olarak kaydeder. */
export async function generateAndSaveReport(db, { outDir = DEFAULT_REPORTS_DIR, ...options }) {
  const result = await runAdvisor(db, options);
  const markdown = renderMarkdown(result);
  await mkdir(outDir, { recursive: true });
  const base = path.join(outDir, `${result.context.meta.asOf}-${result.provider}`);
  await writeFile(`${base}.json`, JSON.stringify(result, null, 2));
  await writeFile(`${base}.md`, markdown);
  return { result, markdown, files: { json: `${base}.json`, markdown: `${base}.md` } };
}

/** En son kaydedilen rapor (Markdown + doğrulama özeti) veya hiç yoksa null. */
export async function loadLatestReport(outDir = DEFAULT_REPORTS_DIR) {
  if (!existsSync(outDir)) return null;
  const names = (await readdir(outDir)).filter((n) => n.endsWith('.md'));
  if (names.length === 0) return null;

  const withTimes = await Promise.all(
    names.map(async (n) => ({ n, mtime: (await stat(path.join(outDir, n))).mtimeMs })),
  );
  const latest = withTimes.sort((a, b) => b.mtime - a.mtime)[0];
  const mdPath = path.join(outDir, latest.n);
  const jsonPath = mdPath.replace(/\.md$/, '.json');
  const meta = existsSync(jsonPath) ? JSON.parse(await readFile(jsonPath, 'utf8')) : {};

  return {
    markdown: await readFile(mdPath, 'utf8'),
    file: latest.n,
    createdAt: new Date(latest.mtime).toISOString(),
    asOf: meta.context?.meta.asOf ?? null,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
    usage: meta.usage ?? null,
    verification: meta.verification ?? null,
  };
}
