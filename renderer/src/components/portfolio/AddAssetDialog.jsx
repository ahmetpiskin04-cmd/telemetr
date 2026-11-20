import { useState } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Button, Dialog, Field, inputClass } from '../ui/Dialog.jsx';
import { Segmented } from '../ui/EmptyState.jsx';
import { PositionFields, validatePosition } from './PositionFields.jsx';

const TYPES = [
  { id: 'BIST_STOCK', label: 'Hisse' },
  { id: 'FUND', label: 'Fon' },
  { id: 'PRECIOUS_METAL', label: 'Altın / Gümüş' },
];

const METAL_OPTIONS = [
  { id: 'GRAM_ALTIN', label: 'Gram altın' },
  { id: 'GRAM_GUMUS', label: 'Gram gümüş' },
];

const EMPTY = { type: 'BIST_STOCK', symbol: '', name: '', metal: 'GRAM_ALTIN', position: { held: true, quantity: '', avgCost: '' } };

/** İzleme listesine yeni varlık ekler; kod kaynağında (Yahoo/TEFAS) doğrulanır. */
export function AddAssetDialog({ open, onClose, onAdded }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const close = () => {
    setForm(EMPTY);
    setErrors({});
    onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    const isMetal = form.type === 'PRECIOUS_METAL';
    const symbol = isMetal ? form.metal : form.symbol.trim(); // büyük harf ve biçim sunucuda (ASCII kuralıyla)
    const pos = validatePosition(form.position);
    const next = { ...pos.errors };
    if (!isMetal && !symbol) next.symbol = form.type === 'FUND' ? 'TEFAS fon kodunu yazın (ör. AFT)' : 'Hisse kodunu yazın (ör. THYAO)';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const added = await api.addAsset({
        type: form.type,
        symbol,
        name: isMetal ? undefined : form.name,
        held: form.position.held,
        quantity: pos.quantity,
        avgCost: pos.avgCost,
      });
      onAdded(added.symbol);
      close();
    } catch (err) {
      setErrors({ symbol: err.message });
    } finally {
      setBusy(false);
    }
  };

  const isMetal = form.type === 'PRECIOUS_METAL';
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Varlık ekle"
      footer={
        <>
          <Button onClick={close}>Vazgeç</Button>
          <Button variant="primary" type="submit" form="add-asset-form" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {busy ? 'Kontrol ediliyor…' : 'Ekle'}
          </Button>
        </>
      }
    >
      <form id="add-asset-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Tür</span>
          <Segmented label="Varlık türü" options={TYPES} value={form.type} onChange={(type) => set({ type })} />
        </div>

        {isMetal ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Maden</span>
            <Segmented label="Maden" options={METAL_OPTIONS} value={form.metal} onChange={(metal) => set({ metal })} />
          </div>
        ) : (
          <>
            <Field
              label={form.type === 'FUND' ? 'TEFAS fon kodu' : 'Borsa İstanbul kodu'}
              hint={form.type === 'FUND' ? '3 harfli kod, ör. AFT, TTE' : 'ör. THYAO, ASELS, KCHOL'}
              error={errors.symbol}
            >
              <input
                autoFocus
                className={inputClass}
                placeholder={form.type === 'FUND' ? 'AFT' : 'THYAO'}
                value={form.symbol}
                onChange={(e) => set({ symbol: e.target.value })}
                maxLength={8}
              />
            </Field>
            <Field label="Görünen ad" hint="İsteğe bağlı; boş bırakırsanız kaynaktan alınır">
              <input className={inputClass} placeholder="ör. Türk Hava Yolları" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
            </Field>
          </>
        )}
        {isMetal && errors.symbol && <p className="text-xs text-down">{errors.symbol}</p>}

        <PositionFields value={form.position} onChange={(position) => set({ position })} unit={isMetal ? 'gram' : form.type === 'FUND' ? 'pay' : 'lot'} errors={errors} />
        <p className="text-xs text-fg-dim">Ekledikten sonra son bir yıllık fiyat geçmişi indirilir (birkaç saniye).</p>
      </form>
    </Dialog>
  );
}
