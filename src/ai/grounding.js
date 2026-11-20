// Model çıktısının VERI'ye dayanıp dayanmadığını kontrol eder.
// - errors: kesin ihlaller (bilinmeyen sembol/olgu, VERI ile uyuşmayan kanıt değeri)
// - warnings: incelenmesi gerekenler (VERI'de bulunmayan sayılar, eksik varlık, bilinmeyen haber)
import { collectFacts, PORTFOLIO_KEY } from './context.js';

// Metinde geçmesi doğal olan sabitler: indikatör periyotları ve promptta tanımlı eşikler
const CONSTANTS = [0, 1, 2, 3, 4, 5, 9, 12, 14, 20, 26, 30, 50, 60, 70, 100, 0.3, 0.6, 0.8, 1.3];

function parseNumberToken(token) {
  // "8.325,40" (Türkçe biçim) ve "8325.40" ikisini de kabul et
  const normalized = token.includes(',')
    ? token.replace(/\./g, '').replace(',', '.')
    : (token.match(/\./g) ?? []).length > 1
      ? token.replace(/\./g, '')
      : token;
  const decimals = normalized.includes('.') ? normalized.split('.')[1].length : 0;
  return { value: Number(normalized), decimals };
}

/** Serbest metindeki sayılar; tarihler, "SMA20"/"N3" gibi etiketler ve "12/26/9" hariç. */
export function extractNumbers(text) {
  const stripped = text
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d+\/\d+(?:\/\d+)?/g, ' ')
    .replace(/[A-Za-zÇĞİÖŞÜçğıöşü_]+\d+/g, ' ');
  return [...stripped.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => ({ token: m[0], ...parseNumberToken(m[0]) }));
}

/** Metindeki sayı, kendi hane sayısına yuvarlanmış hâliyle bilinen bir değere eşit mi? */
function matchesKnown(num, known) {
  const tolerance = 0.5 * 10 ** -num.decimals + 1e-9;
  return known.some((k) => Math.abs(Math.abs(k) - num.value) <= tolerance);
}

function collectKnownNumbers(context) {
  const nums = [...CONSTANTS];
  const walk = (v) => {
    if (typeof v === 'number') nums.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(context.portfolio.facts);
  for (const a of context.assets) walk([a.facts, a.closes, a.events?.map((e) => e.barsAgo), a.period?.bars]);
  for (const n of context.news) nums.push(...extractNumbers(n.title).map((x) => x.value));
  return nums;
}

function valuesEqual(expected, actual) {
  if (typeof expected === 'number') {
    const parsed = parseNumberToken(String(actual).replace(/[%\s]/g, '').replace(/^[+-]/, ''));
    if (!Number.isFinite(parsed.value)) return false;
    const tolerance = Math.max(0.5 * 10 ** -parsed.decimals, Math.abs(expected) * 1e-6);
    return Math.abs(Math.abs(expected) - parsed.value) <= tolerance + 1e-9;
  }
  return String(expected).toLocaleLowerCase('tr-TR') === String(actual).trim().toLocaleLowerCase('tr-TR');
}

export function verifyReport(report, context) {
  const errors = [];
  const warnings = [];
  const facts = collectFacts(context);
  const symbols = new Set(context.assets.map((a) => a.symbol));
  const newsIds = new Set(context.news.map((n) => n.id));
  const known = collectKnownNumbers(context);
  let evidenceChecked = 0;

  const checkText = (where, text) => {
    if (!text) return;
    const unknown = extractNumbers(text).filter((n) => !matchesKnown(n, known));
    if (unknown.length) {
      warnings.push(`${where}: VERI'de bulunmayan sayılar [${unknown.map((n) => n.token).join(', ')}] — eşik/koşul olabilir, kontrol edin`);
    }
  };

  for (const a of report.assets ?? []) {
    if (!symbols.has(a.symbol)) {
      errors.push(`Bilinmeyen sembol: ${a.symbol}`);
      continue;
    }
    for (const e of a.evidence ?? []) {
      evidenceChecked++;
      if (!facts.has(e.fact)) errors.push(`${a.symbol}: VERI'de olmayan olgu "${e.fact}"`);
      else if (facts.get(e.fact) == null) errors.push(`${a.symbol}: "${e.fact}" null iken kanıt gösterilmiş`);
      else if (!valuesEqual(facts.get(e.fact), e.value)) {
        errors.push(`${a.symbol}: "${e.fact}" değeri uyuşmuyor (VERI: ${facts.get(e.fact)}, model: ${e.value})`);
      }
    }
    for (const id of a.newsIds ?? []) {
      if (!newsIds.has(id)) warnings.push(`${a.symbol}: bilinmeyen haber kimliği ${id}`);
    }
    for (const field of ['headline', 'analysis', 'conflicts', 'strategy', 'watchLevels']) {
      checkText(`${a.symbol}.${field}`, a[field]);
    }
  }

  const reported = new Set((report.assets ?? []).map((a) => a.symbol));
  for (const s of context.portfolio.held) {
    if (!reported.has(s)) warnings.push(`Portföydeki ${s} raporda yorumlanmamış`);
  }
  for (const item of report.actionItems ?? []) {
    if (item.symbol !== PORTFOLIO_KEY && !symbols.has(item.symbol)) {
      errors.push(`Aksiyon maddesinde bilinmeyen sembol: ${item.symbol}`);
    }
    checkText(`aksiyon #${item.priority}`, `${item.action} ${item.rationale}`);
  }
  checkText('summary', report.summary);
  checkText('portfolio', [report.portfolio?.concentrationRisk, ...(report.portfolio?.observations ?? [])].join(' '));

  return { ok: errors.length === 0, errors, warnings, evidenceChecked };
}
