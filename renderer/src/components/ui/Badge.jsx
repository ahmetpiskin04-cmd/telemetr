// Etiket tonları: up/down yön (delta), warning durum. Durum her zaman ikon + metinle gelir.
const TONES = {
  neutral: 'bg-surface-3 text-fg',
  up: 'bg-up/12 text-up',
  down: 'bg-down/12 text-down',
  warning: 'bg-warning/12 text-fg-strong [&>svg]:text-warning',
};

/** Küçük durum etiketi; isteğe bağlı ikon (lucide bileşeni) alır. */
export function Badge({ tone = 'neutral', icon: Icon, children, className = '', title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {Icon && <Icon size={13} strokeWidth={2.25} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Trend yönünden badge tonu */
export function trendTone(direction) {
  return direction === 'yükseliş' ? 'up' : direction === 'düşüş' ? 'down' : 'neutral';
}
