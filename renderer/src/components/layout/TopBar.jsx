import { Bell, ChartCandlestick, FlaskConical } from 'lucide-react';
import { fmtMoney, fmtPct, tone, TYPE_LABELS } from '../../lib/format.js';
import { Badge } from '../ui/Badge.jsx';
import { Segmented } from '../ui/EmptyState.jsx';
import { SyncStatus } from './SyncStatus.jsx';

import { TYPE_SERIES } from '../ui/AssetAvatar.jsx';

// Dağılım çubuğu yığılmış bir çubuk: segmentler kategorik seri renklerini sabit sırayla alır,
// aralarında 2px yüzey boşluğu; nakit "diğer" gibi nötr gri.
const TYPE_COLORS = Object.fromEntries(Object.entries(TYPE_SERIES).map(([k, v]) => [k, v.bg]));

function Kpi({ label, children, className = 'text-fg-strong' }) {
  return (
    <div className="flex flex-col justify-center">
      <span className="text-xs font-medium text-fg-dim">{label}</span>
      <span className={`text-base leading-tight font-semibold ${className}`}>{children}</span>
    </div>
  );
}

const Divider = () => <span className="h-8 w-px bg-line" aria-hidden="true" />;

/** Varlık türü ağırlıkları + nakit: yığılmış çubuk ve lejant. Adet girilmemişse gizli. */
function Allocation({ facts }) {
  const parts = Object.keys(TYPE_LABELS)
    .map((type) => ({ type, label: TYPE_LABELS[type], value: facts[`weight.${type}`] ?? 0, color: TYPE_COLORS[type] }))
    .filter((p) => p.value > 0);
  const cash = facts.cashWeightPct ?? 0;
  if (cash > 0) parts.push({ type: 'CASH', label: 'Nakit', value: cash, color: 'bg-line-strong' });
  if (parts.length === 0) return null;

  return (
    <div className="flex w-60 flex-col gap-1.5">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <div key={p.type} className={`${p.color} rounded-full`} style={{ width: `${p.value}%` }} />
        ))}
      </div>
      <div className="flex gap-3 text-[11px] text-fg-dim">
        {parts.map((p) => (
          <span key={p.type} className="flex items-center gap-1 whitespace-nowrap">
            <span className={`size-1.5 rounded-full ${p.color}`} />
            {p.label} <span className="num text-fg-muted">{fmtPct(p.value, { signed: false, digits: 0 })}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const MODES = [
  { id: 'simple', label: 'Basit' },
  { id: 'detailed', label: 'Detaylı' },
];

export function TopBar({ overview, sync, mode, onModeChange, onOpenAlerts }) {
  const facts = overview?.portfolio.facts ?? {};
  const hasSample = overview?.assets.some((a) => a.dataIsSample);
  const hasAmounts = facts.totalValue != null;

  return (
    <div className="flex h-full items-center gap-5 px-1">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-fg-strong text-surface-0">
          <ChartCandlestick size={20} strokeWidth={2.25} aria-hidden="true" />
        </div>
        <span className="text-base font-semibold tracking-tight text-fg-strong">Telemetr</span>
      </div>

      {overview && (
        <>
          <Divider />
          <div className="flex items-center gap-6">
            {hasAmounts && <Kpi label="Portföy değeri">{fmtMoney(facts.totalValue)}</Kpi>}
            {facts.totalPnlPct != null && (
              <Kpi label="Toplam K/Z" className={tone(facts.totalPnlPct)}>
                {fmtPct(facts.totalPnlPct)}
              </Kpi>
            )}
            <Kpi label="Pozisyon">{facts.positionCount ?? 0}</Kpi>
            {hasAmounts ? (
              <Allocation facts={facts} />
            ) : (
              facts.positionCount > 0 && (
                <span className="max-w-56 text-xs leading-snug text-fg-dim">Adet girilmediği için portföy değeri hesaplanmıyor</span>
              )
            )}
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {hasSample && (
          <Badge tone="warning" icon={FlaskConical}>
            Örnek veri
          </Badge>
        )}
        <Segmented label="Görünüm" options={MODES} value={mode} onChange={onModeChange} />
        <button
          type="button"
          onClick={onOpenAlerts}
          className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-strong transition-colors duration-150 hover:bg-surface-3"
        >
          <Bell size={15} aria-hidden="true" />
          Alarmlar
        </button>
        <SyncStatus sync={sync} />
      </div>
    </div>
  );
}
