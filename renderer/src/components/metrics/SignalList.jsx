import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { Badge, trendTone } from '../ui/Badge.jsx';

// Renk tek başına anlam taşımasın: her oyun yönü ikon + metinle de belli
const VOTE = {
  1: { Icon: TrendingUp, className: 'bg-up/12 text-up', label: 'Yükseliş oyu' },
  '-1': { Icon: TrendingDown, className: 'bg-down/12 text-down', label: 'Düşüş oyu' },
  0: { Icon: Minus, className: 'bg-surface-3 text-fg-dim', label: 'Nötr' },
};

/** Trend skorunu oluşturan 4 oy ve pencere içindeki kesişimler. */
export function SignalList({ asset, className = 'flex' }) {
  const f = asset.facts ?? {};
  const signals = asset.trendSignals ?? [];
  const events = [...(asset.events ?? [])].reverse();
  const warnings = asset.warnings?.filter((w) => !w.includes('örnek')) ?? [];

  return (
    <div className={`card min-h-0 flex-col overflow-y-auto p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium text-fg-muted">Trend sinyalleri</h3>
        {f.trendDirection && (
          <Badge tone={trendTone(f.trendDirection)}>
            {f.trendDirection} {f.trendScore > 0 ? '+' : ''}
            {f.trendScore}/4
          </Badge>
        )}
      </div>
      <ul className="space-y-2">
        {signals.map((s) => {
          const v = VOTE[s.vote];
          return (
            <li key={s.name} className="flex items-center gap-2.5 text-xs">
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-md ${v.className}`} title={v.label}>
                <v.Icon size={12} strokeWidth={2.5} aria-label={v.label} />
              </span>
              <span className="truncate text-fg" title={s.note}>
                {s.note}
              </span>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-4 mb-2 text-xs font-medium text-fg-muted">Kesişimler · son 30 gün</h3>
      {events.length === 0 && <p className="text-xs text-fg-dim">Bu dönemde kesişim yok</p>}
      <ul className="space-y-1.5">
        {events.map((e) => {
          const Icon = e.direction === 'up' ? ArrowUpRight : ArrowDownRight;
          return (
            <li key={`${e.date}-${e.indicator}`} className="flex items-center gap-2 text-xs">
              <Icon size={14} className={`shrink-0 ${e.direction === 'up' ? 'text-up' : 'text-down'}`} aria-label={e.direction === 'up' ? 'Yukarı' : 'Aşağı'} />
              <span className="truncate text-fg">{e.description}</span>
              <span className={`num ml-auto shrink-0 ${e.barsAgo <= 3 ? 'font-medium text-fg-strong' : 'text-fg-dim'}`}>
                {e.barsAgo === 0 ? 'bugün' : `${e.barsAgo} gün önce`}
              </span>
            </li>
          );
        })}
      </ul>

      {warnings.map((w) => (
        <p key={w} className="mt-3 flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-fg">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          {w}
        </p>
      ))}
    </div>
  );
}
