import { fmtCompact, fmtNum, fmtPct, fmtPrice, tone } from '../../lib/format.js';

/**
 * Grafiğin tablo karşılığı: aynı veriler, renge ve fareye ihtiyaç duymadan okunur
 * (ekran okuyucu ve renk körlüğü için eşdeğer görünüm). Yeniden eskiye sıralı.
 */
export function PriceTable({ data, lookup, rows = 130 }) {
  const n = data.candles.length;
  const start = Math.max(0, n - rows);
  const items = [];
  for (let i = n - 1; i >= start; i--) items.push(i);
  const macdDigits = Math.abs(data.candles.at(-1)?.close ?? 0) >= 10 ? 2 : 4;

  const cols = [
    { label: 'Tarih', align: 'left' },
    ...(data.hasOhlc ? [{ label: 'Açılış' }, { label: 'Yüksek' }, { label: 'Düşük' }] : []),
    { label: 'Kapanış' },
    { label: 'Değişim' },
    ...(data.hasVolume ? [{ label: 'Hacim' }] : []),
    { label: `SMA ${data.config.smaShort}` },
    { label: `SMA ${data.config.smaLong}` },
    { label: 'MACD' },
    { label: 'Sinyal' },
  ];

  return (
    <div className="absolute inset-0 overflow-auto select-text">
      <table className="num w-full text-xs">
        <caption className="sr-only">
          {data.symbol} günlük fiyat ve gösterge tablosu, son {items.length} işlem günü
        </caption>
        <thead className="sticky top-0 bg-surface-1">
          <tr>
            {cols.map((c) => (
              <th key={c.label} scope="col" className={`border-b border-line-strong px-3 py-2 font-medium whitespace-nowrap text-fg-dim ${c.align === 'left' ? 'text-left' : 'text-right'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const c = data.candles[i];
            const prev = data.candles[i - 1];
            const change = prev ? (c.close / prev.close - 1) * 100 : null;
            return (
              <tr key={c.time} className="border-b border-line/60 hover:bg-surface-2/60">
                <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap text-fg-muted">
                  {c.time}
                </th>
                {data.hasOhlc && (
                  <>
                    <td className="px-3 py-1.5 text-right text-fg">{fmtPrice(c.open)}</td>
                    <td className="px-3 py-1.5 text-right text-fg">{fmtPrice(c.high)}</td>
                    <td className="px-3 py-1.5 text-right text-fg">{fmtPrice(c.low)}</td>
                  </>
                )}
                <td className="px-3 py-1.5 text-right font-medium text-fg-strong">{fmtPrice(c.close)}</td>
                <td className={`px-3 py-1.5 text-right ${tone(change)}`}>{fmtPct(change)}</td>
                {data.hasVolume && <td className="px-3 py-1.5 text-right text-fg">{fmtCompact(data.volume[i]?.value)}</td>}
                <td className="px-3 py-1.5 text-right text-fg">{fmtPrice(lookup.smaShort.get(c.time))}</td>
                <td className="px-3 py-1.5 text-right text-fg">{fmtPrice(lookup.smaLong.get(c.time))}</td>
                <td className="px-3 py-1.5 text-right text-fg">{fmtNum(lookup.macd.get(c.time), macdDigits)}</td>
                <td className="px-3 py-1.5 text-right text-fg">{fmtNum(lookup.signal.get(c.time), macdDigits)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
