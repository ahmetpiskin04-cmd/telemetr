// Haber başlıkları: JSON dosyasından veya RSS'ten. Başlıklar dış kaynaklı, güvenilmeyen
// metindir; modele gitmeden önce temizlenir ve uzunlukları sınırlanır.
import { readFile } from 'node:fs/promises';

const MAX_TITLE_LENGTH = 300;

const googleNews = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=tr&gl=TR&ceid=TR:tr`;

export const DEFAULT_RSS_FEEDS = [
  googleNews('"Borsa İstanbul" OR "BIST 100"'),
  googleNews('"gram altın" OR "ons altın" OR "gram gümüş"'),
  googleNews('TEFAS fon getiri'),
];

// Kelime eşleşmesi için yerleşik takma adlar (portföy dosyasındaki `aliases` ile genişletilebilir)
export const DEFAULT_ALIASES = {
  GRAM_ALTIN: ['altın'],
  GRAM_GUMUS: ['gümüş'],
};

export function sanitizeHeadline(text) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ') // kontrol karakterleri ve VERİ bloğunu kapatabilecek <>
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

function decodeXml(s) {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function toIsoOrNull(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeItem(item) {
  const raw = typeof item === 'string' ? { title: item } : item;
  if (!raw?.title) return null;
  return {
    title: sanitizeHeadline(raw.title),
    source: raw.source ? sanitizeHeadline(raw.source) : null,
    publishedAt: raw.publishedAt ? toIsoOrNull(raw.publishedAt) : null,
  };
}

/** RSS 2.0 <item> bloklarından başlık, kaynak ve tarih çıkarır. */
export function parseRss(xml) {
  const items = [];
  for (const [, body] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => {
      const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
      return m ? decodeXml(m[1]).trim() : null;
    };
    let title = tag('title');
    const source = tag('source');
    if (!title) continue;
    // Google News başlığın sonuna " - Kaynak" ekler
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    items.push(normalizeItem({ title, source, publishedAt: tag('pubDate') }));
  }
  return items;
}

/** JSON dosyası: ["başlık", ...] veya [{ title, source?, publishedAt? }] veya { headlines: [...] } */
export async function loadNewsFile(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.headlines;
  if (!Array.isArray(list)) throw new Error(`${path}: haber listesi bulunamadı`);
  return list.map(normalizeItem).filter(Boolean);
}

/** RSS akışlarını paralel çeker; son `hours` saatin başlıklarını döner. Hatalı akış diğerlerini durdurmaz. */
export async function fetchRssHeadlines(
  feeds = DEFAULT_RSS_FEEDS,
  { hours = 24, now = new Date(), fetchImpl = fetch, timeoutMs = 15_000 } = {},
) {
  const results = await Promise.allSettled(
    feeds.map(async (url) => {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return parseRss(await res.text());
    }),
  );
  const cutoff = now.getTime() - hours * 3_600_000;
  const items = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((n) => n.publishedAt == null || Date.parse(n.publishedAt) >= cutoff);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return { items, errors };
}

/**
 * Listeleri verilen sırayla birleştirir (önce kullanıcının dosyası, sonra RSS), aynı başlığı
 * tekrar edenleri ayıklar ve en fazla `limit` döner. Böylece elle seçilen haberler kesilmez.
 */
export function mergeNews(lists, { limit = 40 } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of lists.flat()) {
    const key = item.title.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, limit);
}

/** Başlıkta sembol, varlık adı veya takma ad geçiyorsa o sembolle eşleştirir (ipucu, kesin değil). */
export function matchSymbols(title, assets, aliases = {}) {
  const lower = title.toLocaleLowerCase('tr-TR');
  return assets
    .filter((a) => {
      const keywords = [
        a.symbol,
        a.name.replace(/\(.*?\)/g, '').trim(),
        ...(DEFAULT_ALIASES[a.symbol] ?? []),
        ...(aliases[a.symbol] ?? []),
      ];
      return keywords.some((k) => k && lower.includes(k.toLocaleLowerCase('tr-TR')));
    })
    .map((a) => a.symbol);
}
