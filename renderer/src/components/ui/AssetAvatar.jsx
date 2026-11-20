// Varlık türü kimliği: kategorik seri renkleri sabit sırayla (hisse 1, maden 2, fon 3).
// Kimliği renkli zemin taşır; harfler mürekkep renginde kalır (metin veri rengi giymez).
export const TYPE_SERIES = {
  BIST_STOCK: { bg: 'bg-series-1', tint: 'bg-series-1/20' },
  PRECIOUS_METAL: { bg: 'bg-series-2', tint: 'bg-series-2/20' },
  FUND: { bg: 'bg-series-3', tint: 'bg-series-3/20' },
};

const SIZES = {
  sm: 'size-8 rounded-lg text-[11px]',
  lg: 'size-11 rounded-xl text-sm',
};

function initials(symbol) {
  // GRAM_ALTIN -> AL, GRAM_GUMUS -> GU, THYAO -> TH
  const core = symbol.includes('_') ? symbol.split('_').at(-1) : symbol;
  return core.slice(0, 2);
}

export function AssetAvatar({ symbol, type, size = 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-semibold tracking-wide text-fg-strong ${SIZES[size]} ${TYPE_SERIES[type]?.tint ?? 'bg-surface-3'}`}
    >
      {initials(symbol)}
    </span>
  );
}
