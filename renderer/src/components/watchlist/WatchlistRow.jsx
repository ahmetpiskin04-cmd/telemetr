import { TriangleAlert } from 'lucide-react';
import { fmtNum, fmtPct, fmtPrice, tone } from '../../lib/format.js';
import { AssetAvatar } from '../ui/AssetAvatar.jsx';
import { Sparkline } from './Sparkline.jsx';
import { isLowVolatility } from '../../lib/plain.js';

const QUANTITY_UNIT = { BIST_STOCK: 'lot', PRECIOUS_METAL: 'gr', FUND: 'pay' };
const quantityFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const fmtQuantity = (v) => quantityFormat.format(v); // 5 · 2,5 · 10,25 · 1.250

/** Kompakt liste satırı: rozet | sembol + ad | 30 günlük mini grafik | fiyat + değişim. */
export function WatchlistRow({ asset, selected, onSelect }) {
  const f = asset.facts ?? {};
  const extremeRsi = (f.rsiZone === 'aşırı alım' || f.rsiZone === 'aşırı satım') && !isLowVolatility(f);
  const quantity = asset.held ? f['position.quantity'] : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(asset.symbol)}
      aria-current={selected ? 'true' : undefined}
      className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
        selected
          ? 'bg-surface-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-fg-strong'
          : 'hover:bg-surface-2/60'
      }`}
    >
      <AssetAvatar symbol={asset.symbol} type={asset.type} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg-strong" title={asset.symbol}>
          {asset.symbol}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Portföydeki miktar: adın önünde küçük ve belirgin */}
          {quantity != null && (
            <span className="num shrink-0 text-xs font-medium text-fg">
              {fmtQuantity(quantity)} {QUANTITY_UNIT[asset.type]}
              <span className="ml-1.5 text-fg-dim" aria-hidden="true">
                ·
              </span>
            </span>
          )}
          {/* Seçili zeminde fg-dim 4.0:1 kalıyor; AA için bir ton açık */}
          <span className={`truncate text-xs ${selected ? 'text-fg-muted' : 'text-fg-dim'}`} title={asset.name}>
            {asset.name}
          </span>
          {extremeRsi && (
            <span className="num flex shrink-0 items-center gap-0.5 rounded bg-warning/12 px-1 text-[10px] font-medium text-fg-strong" title={`RSI ${fmtNum(f.rsi, 1)} — ${f.rsiZone}`}>
              <TriangleAlert size={10} className="text-warning" aria-hidden="true" />
              RSI {fmtNum(f.rsi, 0)}
            </span>
          )}
        </div>
      </div>

      {/* Dar kolonda sembole yer kalsın diye mini grafik yalnızca geniş ekranda */}
      <div className="hidden 2xl:block">
        <Sparkline values={asset.closes} width={44} height={24} />
      </div>

      <div className="w-[72px] shrink-0 text-right">
        <div className="num text-sm font-medium text-fg-strong">{asset.error ? '—' : fmtPrice(f.close)}</div>
        <div className={`num text-xs font-medium ${tone(f.changePct)}`}>{fmtPct(f.changePct)}</div>
      </div>
    </button>
  );
}
