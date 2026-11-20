import { Activity, ArrowLeftRight, Gauge, MoveVertical, Ruler, TrendingDown, TrendingUp, TriangleAlert, Waves } from 'lucide-react';
import { fmtNum, fmtPct, fmtPrice, tone } from '../../lib/format.js';

/**
 * Stat tile: soluk etiket, belirgin değer (orantılı rakam), altta tali bilgi.
 * warning: durum uyarısı — sarı ikon + yazılı etiket; renk tek başına anlam taşımaz.
 */
function Tile({ icon: Icon, label, value, valueClass = 'text-fg-strong', sub, children, warning }) {
  return (
    <div className="card flex min-w-0 flex-col gap-1.5 p-4">
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Icon size={14} className="text-fg-dim" aria-hidden="true" />
        <span className="truncate" title={label}>
          {label}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className={`truncate text-xl leading-tight font-semibold ${valueClass}`}>{value}</span>
        {warning && (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-warning/12 px-1.5 py-0.5 text-[11px] font-medium text-fg-strong">
            <TriangleAlert size={12} className="text-warning" aria-hidden="true" />
            {warning}
          </span>
        )}
      </span>
      {children}
      {sub && (
        <span className="num truncate text-xs text-fg-dim" title={sub}>
          {sub}
        </span>
      )}
    </div>
  );
}

const Knob = ({ left }) => (
  <div
    className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-surface-1 bg-fg-strong"
    style={{ left: `calc(${Math.min(Math.max(left, 0), 100)}% - 6px)` }}
  />
);

/** 0-100 RSI göstergesi; 30-70 nötr bant. */
function RsiGauge({ value }) {
  if (value == null) return <div className="h-1.5" />;
  return (
    <div className="relative my-0.5 h-1.5 rounded-full bg-surface-3" role="img" aria-label={`RSI ${fmtNum(value, 1)}, 30 ile 70 arası nötr`}>
      <div className="absolute inset-y-0 left-[30%] w-[40%] bg-line-strong" />
      <Knob left={value} />
    </div>
  );
}

/** Dönem düşük-yüksek aralığında son fiyatın yeri. */
function RangeBar({ low, high, value }) {
  if (low == null || high == null || high === low) return <div className="h-1.5" />;
  return (
    <div className="relative my-0.5 h-1.5 rounded-full bg-surface-3" role="img" aria-label="30 günlük aralıkta son fiyatın konumu">
      <Knob left={((value - low) / (high - low)) * 100} />
    </div>
  );
}

const RSI_WARNING = { 'aşırı alım': 'Aşırı alım', 'aşırı satım': 'Aşırı satım' };

export function MetricGrid({ asset }) {
  const f = asset.facts ?? {};
  const hasSpread = f.spreadPct != null;
  const spreadHigh = f.spreadVsAvg != null && f.spreadVsAvg >= 1.3;
  const macdDigits = Math.abs(f.close ?? 0) >= 10 ? 2 : 4; // MACD fiyat biriminde: fiyatla aynı hassasiyet

  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile icon={Gauge} label="RSI (14)" value={fmtNum(f.rsi, 1)} warning={RSI_WARNING[f.rsiZone]} sub={RSI_WARNING[f.rsiZone] ? 'nötr bant 30–70 dışında' : 'nötr bant 30–70'}>
        <RsiGauge value={f.rsi} />
      </Tile>

      <Tile
        icon={Activity}
        label="MACD histogram"
        value={fmtNum(f.macdHist, macdDigits)}
        valueClass={tone(f.macdHist)}
        sub={`MACD ${fmtNum(f.macd, macdDigits)} · sinyal ${fmtNum(f.macdSignal, macdDigits)}`}
      />

      <Tile
        icon={f.trendSlopePctPerDay < 0 ? TrendingDown : TrendingUp}
        label="Regresyon (günlük)"
        value={fmtPct(f.trendSlopePctPerDay, { digits: 3 })}
        valueClass={f.trendR2 < 0.3 ? 'text-fg-muted' : tone(f.trendSlopePctPerDay)}
        sub={`R² ${fmtNum(f.trendR2)}${f.trendR2 < 0.3 ? ' (zayıf)' : ''} · dönem ${fmtPct(f.trendPeriodPct)}`}
      />

      <Tile icon={MoveVertical} label="30 günlük aralık" value={fmtPct(f.changePct)} valueClass={tone(f.changePct)} sub={`${fmtPrice(f.low)} – ${fmtPrice(f.high)}`}>
        <RangeBar low={f.low} high={f.high} value={f.close} />
      </Tile>

      <Tile
        icon={Ruler}
        label="SMA 20 uzaklığı"
        value={fmtPct(f.priceVsSmaLongPct)}
        valueClass={tone(f.priceVsSmaLongPct)}
        sub={`SMA 5 ${fmtPrice(f.smaShort)} · SMA 20 ${fmtPrice(f.smaLong)}`}
      />

      {hasSpread ? (
        <Tile
          icon={ArrowLeftRight}
          label="Alış-satış makası"
          value={fmtPct(f.spreadPct, { signed: false })}
          warning={spreadHigh ? 'Yüksek' : undefined}
          sub={
            f.spreadAvgPct == null
              ? `geçmiş ${f.spreadSamples ?? 0} gün · ortalama için ≥5 gün`
              : `30 gün ort. ${fmtPct(f.spreadAvgPct, { signed: false })} · ${fmtNum(f.spreadVsAvg)}×`
          }
        />
      ) : (
        <Tile icon={Waves} label="Günlük oynaklık" value={fmtPct(f.volDailyPct, { signed: false })} sub="log getirilerin std. sapması" />
      )}
    </div>
  );
}
