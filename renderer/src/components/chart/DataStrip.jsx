import { fmtCompact, fmtNum, fmtPct, fmtPrice, tone } from '../../lib/format.js';

function Item({ label, value, className = 'text-fg', swatch }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {swatch && <span className={`h-0.5 w-3 rounded-full ${swatch}`} aria-hidden="true" />}
      {label && <span className="text-fg-dim">{label}</span>}
      <span className={`num ${className}`}>{value}</span>
    </span>
  );
}

const Divider = () => <span className="h-3.5 w-px bg-line" />;

/**
 * İmlecin üzerindeki günün OHLC, SMA ve MACD değerleri (imleç yoksa son gün).
 * Grafiğin üstünde sabit bir lejant; değerler imleçle yerinde güncellenir.
 */
export function DataStrip({ data, lookup, index, simple = false }) {
  if (!data || !data.candles.length) return <div className="h-9 shrink-0" />;
  const i = index == null ? data.candles.length - 1 : Math.min(Math.max(index, 0), data.candles.length - 1);
  const c = data.candles[i];
  const prev = data.candles[i - 1];
  const dayChange = prev ? (c.close / prev.close - 1) * 100 : null;
  const hist = lookup.histogram.get(c.time);
  const macdDigits = Math.abs(c.close) >= 10 ? 2 : 4; // MACD fiyat biriminde: fiyatla aynı hassasiyet
  const volume = data.hasVolume ? data.volume[i]?.value : null;

  return (
    <div className="mx-5 mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 pb-1 text-xs">
      <span className="sr-only">İmlecin üzerindeki günün değerleri</span>
      <span className="num whitespace-nowrap text-fg-muted">{c.time}</span>
      {data.hasOhlc && !simple && (
        <>
          <Item label="A" value={fmtPrice(c.open)} />
          <Item label="Y" value={fmtPrice(c.high)} />
          <Item label="D" value={fmtPrice(c.low)} />
        </>
      )}
      <Item label={simple ? 'Kapanış' : 'K'} value={fmtPrice(c.close)} className="font-semibold text-fg-strong" />
      <Item value={fmtPct(dayChange)} className={tone(dayChange)} />
      {volume != null && !simple && <Item label="Hacim" value={fmtCompact(volume)} />}
      <Divider />
      {!simple && <Item label={`SMA ${data.config.smaShort}`} value={fmtPrice(lookup.smaShort.get(c.time))} swatch="bg-series-1" />}
      <Item label={simple ? `${data.config.smaLong} günlük ortalama` : `SMA ${data.config.smaLong}`} value={fmtPrice(lookup.smaLong.get(c.time))} swatch="bg-series-2" />
      {!simple && <Divider />}
      {!simple && <Item label="MACD" value={fmtNum(lookup.macd.get(c.time), macdDigits)} swatch="bg-series-1" />}
      {!simple && <Item label="Sinyal" value={fmtNum(lookup.signal.get(c.time), macdDigits)} swatch="bg-series-2" />}
      {!simple && <Item label="Hist" value={fmtNum(hist, macdDigits)} className={tone(hist)} />}
    </div>
  );
}
