import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Yerleşik <dialog> üzerine ince sarmalayıcı: showModal() odak hapsi, Esc ile kapanma ve
 * arka planı engelleme davranışını tarayıcıdan hazır alır.
 */
export function Dialog({ open, onClose, title, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault(); // Esc: kapanışı React durumu üzerinden yap
        onClose();
      }}
      className="m-auto w-[420px] max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-surface-1 p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      {open && (
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-base font-semibold text-fg-strong">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-md p-1 text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-fg">
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Görünür etiketli form alanı; hata alanın hemen altında. */
export function Field({ label, hint, error, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-fg">{label}</span>
      {children}
      {error ? <span className="text-xs text-down">{error}</span> : hint && <span className="text-xs text-fg-dim">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface-0 px-3 py-2 text-sm text-fg-strong placeholder:text-fg-dim focus:border-series-1 focus:outline-none';

export function Button({ variant = 'secondary', className = '', ...props }) {
  const styles = {
    primary: 'bg-fg-strong text-surface-0 hover:bg-white',
    secondary: 'border border-line-strong bg-surface-2 text-fg-strong hover:bg-surface-3',
    danger: 'border border-critical/40 bg-critical/10 text-fg-strong hover:bg-critical/20',
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}
