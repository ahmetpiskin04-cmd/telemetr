// AI raporunu okunabilir Markdown'a çevirir.

const STANCE_ICON = { pozitif: '▲', nötr: '■', negatif: '▼', belirsiz: '?' };

export function renderMarkdown({ report, verification, context, provider, model }) {
  const lines = [];
  const push = (...l) => lines.push(...l);
  const newsById = new Map(context.news.map((n) => [n.id, n]));

  push(`# Portföy Analizi — ${context.meta.asOf}`, '', `_${provider} / ${model} · ${context.meta.analysisWindowDays} günlük pencere_`, '');

  if (!verification.ok || verification.warnings.length) {
    push('## Doğrulama', '');
    if (verification.ok) push(`✔ ${verification.evidenceChecked} kanıt VERI ile uyuşuyor.`);
    for (const e of verification.errors) push(`- ✖ ${e}`);
    for (const w of verification.warnings) push(`- ⚠ ${w}`);
    push('');
  }

  push('## Özet', '', report.summary, '', '## Piyasa bağlamı', '', report.marketContext, '');

  push('## Varlıklar', '');
  for (const a of report.assets) {
    push(`### ${STANCE_ICON[a.stance] ?? ''} ${a.symbol} ${a.held ? '(portföyde)' : '(izleme)'} — ${a.stance}, güven: ${a.confidence}`, '');
    push(`**${a.headline}**`, '', a.analysis, '');
    if (a.conflicts) push(`- **Çelişkiler:** ${a.conflicts}`);
    push(`- **Strateji:** ${a.strategy}`, `- **İzlenecek seviyeler:** ${a.watchLevels}`);
    if (a.evidence.length) push(`- **Dayanak:** ${a.evidence.map((e) => `\`${e.fact}=${e.value}\``).join(' · ')}`);
    for (const id of a.newsIds) {
      const n = newsById.get(id);
      if (n) push(`- **Haber ${id}:** ${n.title}${n.source ? ` (${n.source})` : ''}`);
    }
    push('');
  }

  push('## Portföy', '', report.portfolio.concentrationRisk, '');
  for (const o of report.portfolio.observations) push(`- ${o}`);
  push('');

  if (report.actionItems.length) {
    push('## Aksiyonlar', '');
    for (const item of [...report.actionItems].sort((x, y) => x.priority - y.priority)) {
      push(`${item.priority}. **${item.symbol}** — ${item.action}  `, `   _${item.rationale}_`);
    }
    push('');
  }

  if (report.dataGaps.length) {
    push('## Veri eksikleri', '');
    for (const g of report.dataGaps) push(`- ${g}`);
    push('');
  }
  return lines.join('\n');
}
