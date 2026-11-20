import { parseNumberInput } from '../../lib/format.js';
import { Field, inputClass } from '../ui/Dialog.jsx';

/** "Portföyümde var" + adet + ortalama maliyet. Adet ve maliyet isteğe bağlı. */
export function PositionFields({ value, onChange, unit, errors = {} }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-0/40 p-3.5">
      <label className="flex items-center gap-2.5 text-sm font-medium text-fg-strong">
        <input type="checkbox" checked={value.held} onChange={(e) => set({ held: e.target.checked })} className="size-4" />
        Bu varlık portföyümde
      </label>
      {value.held && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Adet${unit ? ` (${unit})` : ''}`} error={errors.quantity} hint="İsteğe bağlı">
            <input inputMode="decimal" className={inputClass} placeholder="ör. 100" value={value.quantity} onChange={(e) => set({ quantity: e.target.value })} />
          </Field>
          <Field label="Ortalama maliyet (₺)" error={errors.avgCost} hint="İsteğe bağlı">
            <input inputMode="decimal" className={inputClass} placeholder="ör. 245,50" value={value.avgCost} onChange={(e) => set({ avgCost: e.target.value })} />
          </Field>
        </div>
      )}
      {value.held && !errors.quantity && !errors.avgCost && (
        <p className="text-xs leading-snug text-fg-dim">Adet ve maliyet girerseniz portföy değeri, ağırlık ve kâr/zarar hesaplanır. Bu bilgiler yalnızca bu bilgisayarda kalır.</p>
      )}
    </div>
  );
}

/** Form değerlerini doğrular; { errors, quantity, avgCost } döner. */
export function validatePosition(value) {
  const errors = {};
  const quantity = value.held ? parseNumberInput(value.quantity) : null;
  const avgCost = value.held ? parseNumberInput(value.avgCost) : null;
  if (Number.isNaN(quantity) || (quantity != null && quantity <= 0)) errors.quantity = 'Sıfırdan büyük bir sayı girin';
  if (Number.isNaN(avgCost) || (avgCost != null && avgCost < 0)) errors.avgCost = 'Geçerli bir tutar girin';
  return { errors, quantity, avgCost };
}
