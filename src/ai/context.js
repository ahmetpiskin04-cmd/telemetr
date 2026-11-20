// Analiz sonuçlarını, portföyü ve haberleri modele gidecek tek bir "VERİ" nesnesine dönüştürür.
// Model aritmetik yapmasın diye tüm türev değerler (ağırlık, kâr/zarar, SMA uzaklığı,
// makas oranı, kesişimden bu yana geçen gün) burada hesaplanır ve yuvarlanır.
import { readFile } from 'node:fs/promises';
import { matchSymbols } from './news.js';
import { DEFAULT_OPTIONS } from '../analysis.js';

export const PORTFOLIO_KEY = 'PORTFOY';

/** Fiyat ölçeğine göre yuvarlama: >=10 için 2 hane, küçük değerlerde anlamlı haneyi korur. */
export function roundSmart(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v === 0) return 0;
  const abs = Math.abs(v);
  const digits = abs >= 10 ? 2 : Math.min(8, Math.max(4, 3 - Math.floor(Math.log10(abs))));
  return Number(v.toFixed(digits));
}

const pct = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(2)));

/**
 * { positions: [{ symbol, quantity?, avgCost? }], cash?, aliases? }
 * quantity verilmezse pozisyon yalnızca "sahip olunan" olarak işaretlenir (ağırlık/değer hesaplanmaz).
 */
export async function loadPortfolio(path) {
  const p = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(p.positions)) throw new Error(`${path}: "positions" dizisi bekleniyor`);
  for (const pos of p.positions) {
    if (!pos.symbol || (pos.quantity != null && !(pos.quantity > 0))) {
      throw new Error(`${path}: geçersiz pozisyon ${JSON.stringify(pos)}`);
    }
  }
  return { positions: p.positions, cash: p.cash ?? 0, aliases: p.aliases ?? {} };
}

export function isoDateIstanbul(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date);
}

function assetFacts(a) {
  const { latest: l, stats: s, regression: reg, trend } = a;
  return {
    close: roundSmart(l.close),
    changePct: pct(s.changePct),
    high: roundSmart(s.high),
    low: roundSmart(s.low),
    volDailyPct: pct(s.dailyVolatilityPct),
    smaShort: roundSmart(l.smaShort),
    smaLong: roundSmart(l.smaLong),
    priceVsSmaLongPct: l.smaLong == null ? null : pct((l.close / l.smaLong - 1) * 100),
    rsi: pct(l.rsi),
    rsiZone: l.rsiZone,
    macd: roundSmart(l.macd),
    macdSignal: roundSmart(l.signal),
    macdHist: roundSmart(l.histogram),
    trendSlopePctPerDay: reg ? Number(reg.dailyPct.toFixed(3)) : null,
    trendR2: reg ? Number(reg.r2.toFixed(2)) : null,
    trendPeriodPct: reg ? pct(reg.periodPct) : null,
    trendScore: trend.score,
    trendDirection: trend.direction,
    spreadPct: pct(s.spread?.latestPct),
    spreadAvgPct: pct(s.spread?.avgPct),
    spreadMaxPct: pct(s.spread?.maxPct),
    spreadVsAvg: pct(s.spread?.vsAvg),
    spreadSamples: s.spread?.samples ?? null,
  };
}

export function buildAdvisorContext({
  analyses,
  portfolio = { positions: [], cash: 0, aliases: {} },
  news = [],
  asOf = new Date(),
  shareAmounts = false,
  analysisDays = DEFAULT_OPTIONS.days,
}) {
  const ok = analyses.filter((a) => !a.error);
  const bySymbol = new Map(ok.map((a) => [a.asset.symbol.toUpperCase(), a]));

  const positions = portfolio.positions.map((p) => {
    const symbol = p.symbol.toUpperCase();
    const price = bySymbol.get(symbol)?.latest.close ?? null;
    const marketValue = price != null && p.quantity > 0 ? price * p.quantity : null;
    return { ...p, symbol, price, marketValue };
  });
  const cash = portfolio.cash ?? 0;
  const priced = positions.filter((p) => p.marketValue != null);
  const total = priced.reduce((sum, p) => sum + p.marketValue, 0) + cash;
  const weightOf = (value) => (value == null || !(total > 0) ? null : (value / total) * 100);

  const assets = analyses.map((a) => {
    const symbol = a.asset.symbol.toUpperCase();
    const base = {
      symbol,
      name: a.asset.name,
      type: a.asset.assetType,
      currency: a.asset.currency,
      unit: a.asset.unit,
      held: positions.some((p) => p.symbol === symbol),
    };
    if (a.error) return { ...base, error: a.error };

    const facts = assetFacts(a);
    const pos = positions.find((p) => p.symbol === symbol);
    if (pos) {
      facts['position.weightPct'] = pct(weightOf(pos.marketValue));
      facts['position.pnlPct'] = pos.avgCost > 0 && pos.price != null ? pct((pos.price / pos.avgCost - 1) * 100) : null;
      if (shareAmounts) {
        facts['position.quantity'] = pos.quantity ?? null;
        facts['position.avgCost'] = roundSmart(pos.avgCost ?? null);
        facts['position.marketValue'] = pct(pos.marketValue);
      }
    }

    const lastIndex = a.series.length - 1;
    return {
      ...base,
      period: a.period,
      facts,
      trendSignals: a.trend.signals.map((s) => ({ name: s.name, vote: s.value, note: s.note })),
      events: a.events.slice(-6).map((e) => ({
        date: e.date,
        barsAgo: lastIndex - a.series.findIndex((p) => p.date === e.date),
        indicator: e.indicator,
        direction: e.type,
        description: e.description,
      })),
      closes: a.series.map((p) => roundSmart(p.close)),
      dataIsSample: a.warnings.some((w) => w.includes('örnek')),
      warnings: a.warnings,
    };
  });

  const typeWeights = {};
  for (const p of priced) {
    const type = bySymbol.get(p.symbol).asset.assetType;
    typeWeights[type] = (typeWeights[type] ?? 0) + p.marketValue;
  }
  const costed = priced.filter((p) => p.avgCost > 0 && p.quantity > 0);
  const cost = costed.reduce((sum, p) => sum + p.avgCost * p.quantity, 0);
  const costedValue = costed.reduce((sum, p) => sum + p.marketValue, 0);

  const portfolioFacts = {
    positionCount: positions.length,
    totalPnlPct: cost > 0 ? pct((costedValue / cost - 1) * 100) : null,
    cashWeightPct: pct(weightOf(cash)),
    largestPositionWeightPct: priced.length ? pct(weightOf(Math.max(...priced.map((p) => p.marketValue)))) : null,
    ...Object.fromEntries(Object.entries(typeWeights).map(([t, v]) => [`weight.${t}`, pct(weightOf(v))])),
  };
  if (shareAmounts) portfolioFacts.totalValue = total > 0 ? pct(total) : null;

  const analysisAssets = ok.map((a) => a.asset);
  return {
    meta: {
      asOf: isoDateIstanbul(asOf),
      analysisWindowDays: analysisDays,
      indicatorConfig: {
        smaShort: DEFAULT_OPTIONS.smaShort,
        smaLong: DEFAULT_OPTIONS.smaLong,
        rsi: DEFAULT_OPTIONS.rsiPeriod,
        macd: `${DEFAULT_OPTIONS.macd.fast}/${DEFAULT_OPTIONS.macd.slow}/${DEFAULT_OPTIONS.macd.signal}`,
      },
      amountsShared: shareAmounts,
      closesOrder: 'eskiden yeniye, işlem günü bazında',
    },
    portfolio: {
      facts: portfolioFacts,
      held: positions.map((p) => p.symbol),
      missingData: positions.filter((p) => p.price == null).map((p) => p.symbol),
    },
    assets,
    news: news.map((n, i) => ({
      id: `N${i + 1}`,
      ...n,
      matchedSymbols: matchSymbols(n.title, analysisAssets, portfolio.aliases),
    })),
  };
}

/** Modelin kanıt olarak gösterebileceği tüm olgular: "SEMBOL.anahtar" -> değer */
export function collectFacts(context) {
  const facts = new Map();
  for (const [k, v] of Object.entries(context.portfolio.facts)) facts.set(`${PORTFOLIO_KEY}.${k}`, v);
  for (const a of context.assets) {
    for (const [k, v] of Object.entries(a.facts ?? {})) facts.set(`${a.symbol}.${k}`, v);
  }
  return facts;
}
