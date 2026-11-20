export function EmptyState({ title, detail, tone = 'neutral' }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className={`text-sm font-medium ${tone === 'error' ? 'text-down' : 'text-fg-strong'}`}>{title}</p>
      {detail && <p className="max-w-md text-sm break-words text-fg-muted select-text">{detail}</p>}
    </div>
  );
}

/** Kart başlığı: başlık (+ ikon, alt başlık) solda, opsiyonel içerik sağda */
export function PanelHeader({ title, subtitle, right, icon }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg-strong">{title}</h2>
          {subtitle && <p className="truncate text-xs text-fg-dim">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Segmentli seçim (aralık, sağlayıcı) */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-line bg-surface-0/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
            value === o.id ? 'bg-surface-3 text-fg-strong' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {o.label ?? o.id}
        </button>
      ))}
    </div>
  );
}
