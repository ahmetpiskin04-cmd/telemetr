/** Açık/kapalı anahtarı: durum rengin yanında konumla da anlatılır (kayar topuz). */
export function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50 ${checked ? 'bg-series-1' : 'bg-surface-3'}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-fg-strong transition-transform duration-150 ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}
