import { useMemo, useState } from 'react';
import { Briefcase, Pencil, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtPct, fmtPrice, TYPE_LABELS } from '../../lib/format.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Badge, trendTone } from '../ui/Badge.jsx';
import { AssetAvatar } from '../ui/AssetAvatar.jsx';
import { EmptyState, Segmented } from '../ui/EmptyState.jsx';
import { PriceChart } from './PriceChart.jsx';
import { PriceTable } from './PriceTable.jsx';
import { DataStrip } from './DataStrip.jsx';
import { MetricGrid } from '../metrics/MetricGrid.jsx';
import { SignalList } from '../metrics/SignalList.jsx';
import { SimpleSummary } from '../metrics/SimpleSummary.jsx';
import { plainTrend } from '../../lib/plain.js';

// İşlem günü cinsinden görünür aralıklar
const RANGES = [
  { id: '1A', bars: 22 },
  { id: '3A', bars: 66 },
  { id: '6A', bars: 130 },
  { id: 'Tümü', bars: null },
];

const TREND_ICON = { yükseliş: TrendingUp, düşüş: TrendingDown };

const VIEWS = [
  { id: 'chart', label: 'Grafik' },
  { id: 'table', label: 'Tablo' },
];

function ChartHeader({ asset, range, onRange, view, onView, simple, onEdit }) {
  const trend = plainTrend(asset.facts ?? {});
  const f = asset.facts ?? {};
  const changeTone = f.changePct > 0 ? 'up' : f.changePct < 0 ? 'down' : 'neutral';
  const ChangeIcon = f.changePct > 0 ? TrendingUp : f.changePct < 0 ? TrendingDown : Minus;
  const holding = [
    f['position.weightPct'] != null && fmtPct(f['position.weightPct'], { signed: false, digits: 1 }),
    f['position.pnlPct'] != null && `K/Z ${fmtPct(f['position.pnlPct'])}`,
  ].filter(Boolean);

  return (
    <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <AssetAvatar symbol={asset.symbol} type={asset.type} size="lg" />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-semibold text-fg-strong">{asset.symbol}</h1>
            <span className="truncate text-sm text-fg-muted" title={asset.name}>
              {asset.name}
            </span>
            <span className="shrink-0 text-xs text-fg-dim">· {TYPE_LABELS[asset.type]}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            {/* Tekil büyük sayı: orantılı rakam (tabular-nums yalnız sütunlarda) */}
            <span className="text-[28px] leading-none font-semibold tracking-tight text-fg-strong">{fmtPrice(f.close)}</span>
            <span className="text-xs text-fg-dim">
              {asset.currency}/{asset.unit}
            </span>
            <Badge tone={changeTone} icon={ChangeIcon} title="Son 30 günlük değişim">
              {fmtPct(f.changePct)} <span className="font-normal opacity-75">{simple ? 'son 30 gün' : '30G'}</span>
            </Badge>
            {simple && trend && (
              <Badge tone={trend.tone} icon={TREND_ICON[f.trendDirection] ?? Minus} title={trend.detail}>
                {trend.label}
              </Badge>
            )}
            {!simple && f.trendDirection && (
              <Badge tone={trendTone(f.trendDirection)} icon={TREND_ICON[f.trendDirection] ?? Minus} title="Trend skoru: 4 sinyalin toplamı">
                Trend {f.trendScore > 0 ? '+' : ''}
                {f.trendScore}/4
              </Badge>
            )}
            {asset.held && (
              <Badge tone="neutral" icon={Briefcase}>
                {['Portföyde', ...holding].join(' · ')}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          title="Portföy bilgisini düzenle veya listeden kaldır"
          className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-0/60 px-2.5 py-1 text-xs font-medium text-fg transition-colors duration-150 hover:bg-surface-2 hover:text-fg-strong"
        >
          <Pencil size={13} aria-hidden="true" />
          {asset.held ? 'Pozisyon' : 'Düzenle'}
        </button>
        {view === 'chart' && <Segmented label="Grafik aralığı" options={RANGES} value={range} onChange={onRange} />}
        {!simple && <Segmented label="Görünüm" options={VIEWS} value={view} onChange={onView} />}
      </div>
    </div>
  );
}

export function ChartPanel({ asset, refreshKey, mode = 'simple', onEdit }) {
  const simple = mode === 'simple';
  const chart = useAsync(() => api.chart(asset.symbol, { bars: 250 }), [asset.symbol, refreshKey]);
  const [range, setRange] = useState('3A');
  const [hoverIndex, setHoverIndex] = useState(null);
  const [selectedView, setView] = useState('chart');
  const view = simple ? 'chart' : selectedView; // basit görünümde tablo yok
  const visibleBars = RANGES.find((r) => r.id === range).bars;

  // Yeniden yüklemede kare korunur: yeni sembolün verisi gelene kadar önceki grafik
  // soluk olarak ekranda kalır (iskelet/boşluk yanıp sönmesi yok).
  const data = chart.data;
  const stale = data != null && data.symbol !== asset.symbol;
  const lookup = useMemo(() => buildLookup(data), [data]);

  return (
    // @container: alt kartların düzeni pencereye değil orta alanın kendi genişliğine göre değişir
    <section className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="card flex min-h-[480px] flex-1 flex-col overflow-hidden">
        <ChartHeader asset={asset} range={range} onRange={setRange} view={view} onView={setView} simple={simple} onEdit={onEdit} />
        {view === 'chart' && <DataStrip data={stale ? null : data} lookup={lookup} index={hoverIndex} simple={simple} />}
        <div className={`relative mx-2 mb-2 min-h-0 flex-1 transition-opacity duration-150 ${stale ? 'opacity-40' : ''}`} aria-busy={stale}>
          {data && view === 'chart' && <PriceChart data={data} visibleBars={visibleBars} onHoverIndex={setHoverIndex} advanced={!simple} />}
          {data && view === 'table' && <PriceTable data={data} lookup={lookup} />}
          {chart.status === 'error' && <EmptyState tone="error" title="Grafik yüklenemedi" detail={chart.error.message} />}
          {!data && chart.status === 'loading' && <EmptyState title="Grafik yükleniyor…" />}
        </div>
      </div>

      {simple ? (
        <div className="shrink-0">
          <SimpleSummary asset={asset} />
        </div>
      ) : (
        <div className="grid shrink-0 gap-3 @3xl:grid-cols-[minmax(0,1fr)_300px] @5xl:grid-cols-[minmax(0,1fr)_340px]">
          <MetricGrid asset={asset} />
          {/* Dar alanda gizlenir: trend özeti başlıktaki rozette, kesişimler grafikte ok olarak görünür */}
          <SignalList asset={asset} className="hidden @3xl:flex" />
        </div>
      )}
    </section>
  );
}

/** Zaman -> SMA/MACD değerleri; imleç hangi mumdaysa o günün değerlerini göstermek için. */
function buildLookup(data) {
  if (!data) return null;
  const byTime = (points) => new Map(points.map((p) => [p.time, p.value]));
  return {
    smaShort: byTime(data.smaShort),
    smaLong: byTime(data.smaLong),
    macd: byTime(data.macd.line),
    signal: byTime(data.macd.signal),
    histogram: byTime(data.macd.histogram),
  };
}
