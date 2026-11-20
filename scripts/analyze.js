// Kullanım: npm run analyze -- [SEMBOL] [--days 30] [--table] [--json]
import { parseArgs } from 'node:util';
import { openDatabase } from '../src/db.js';
import { analyzeAsset, analyzeAll } from '../src/analysis.js';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: 'string', default: '30' },
    table: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const fmt = (v, digits) => {
  if (v == null) return '—';
  return v.toFixed(digits ?? (Math.abs(v) < 10 ? 4 : 2));
};
const signed = (v, digits = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`);

function printReport(r) {
  const { asset } = r;
  console.log(`\n━━ ${asset.symbol} — ${asset.name} (${asset.assetType}, ${asset.currency}/${asset.unit})`);
  if (r.error) {
    console.log(`   ${r.error}`);
    return;
  }
  const { latest: l, stats: s, regression: reg, trend: t } = r;

  console.log(`   Dönem      : ${r.period.from} → ${r.period.to} (${r.period.bars} işlem günü)`);
  console.log(`   Kapanış    : ${fmt(l.close)}   değişim ${signed(s.changePct)}%   aralık ${fmt(s.low)}–${fmt(s.high)}   günlük oynaklık ${fmt(s.dailyVolatilityPct, 2)}%`);
  if (s.spread) {
    const history = s.spread.avgPct == null ? `geçmiş ${s.spread.samples} gün, ortalama için yetersiz` : `30g ort. ${fmt(s.spread.avgPct, 2)}%, ${fmt(s.spread.vsAvg, 2)}×`;
    console.log(`   Makas      : ${fmt(s.spread.latestPct, 2)}% (${history})   aralık ${fmt(s.spread.minPct, 2)}–${fmt(s.spread.maxPct, 2)}%`);
  }
  console.log(`   SMA        : kısa ${fmt(l.smaShort)}   uzun ${fmt(l.smaLong)}`);
  console.log(`   RSI        : ${fmt(l.rsi, 1)} (${l.rsiZone ?? '—'})`);
  console.log(`   MACD       : ${fmt(l.macd)}   sinyal ${fmt(l.signal)}   histogram ${signed(l.histogram, 4)}`);
  if (reg) {
    console.log(`   Regresyon  : ${signed(reg.dailyPct, 3)}%/gün, R²=${reg.r2.toFixed(2)} → dönem eğilimi ${signed(reg.periodPct)}%`);
  }
  console.log(`   TREND      : ${t.direction.toLocaleUpperCase('tr-TR')} (skor ${signed(t.score, 0)}/${t.maxScore})`);
  for (const sig of t.signals) {
    const mark = sig.value > 0 ? '▲' : sig.value < 0 ? '▼' : '•';
    console.log(`                ${mark} ${sig.name}: ${sig.note}`);
  }
  if (r.events.length > 0) {
    console.log('   Kesişimler :');
    for (const e of r.events) console.log(`                ${e.date} ${e.type === 'up' ? '↑' : '↓'} ${e.description}`);
  }
  for (const w of r.warnings) console.log(`   ⚠ ${w}`);

  if (args.table) {
    console.table(
      r.series.map((p) => ({
        tarih: p.date,
        kapanış: fmt(p.close),
        smaKısa: fmt(p.smaShort),
        smaUzun: fmt(p.smaLong),
        rsi: fmt(p.rsi, 1),
        macd: fmt(p.macd, 4),
        sinyal: fmt(p.signal, 4),
        hist: fmt(p.histogram, 4),
      })),
    );
  }
}

const db = openDatabase();
try {
  const options = { days: Number(args.days) };
  const results = positionals[0]
    ? [await analyzeAsset(db, positionals[0], options)]
    : await analyzeAll(db, options);

  if (args.json) console.log(JSON.stringify(results, null, 2));
  else results.forEach(printReport);
} finally {
  db.close();
}
