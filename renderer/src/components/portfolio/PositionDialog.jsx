import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { numberToInput } from '../../lib/format.js';
import { Button, Dialog } from '../ui/Dialog.jsx';
import { PositionFields, validatePosition } from './PositionFields.jsx';

const UNIT = { BIST_STOCK: 'lot', FUND: 'pay', PRECIOUS_METAL: 'gram' };

function initialPosition(asset) {
  const f = asset?.facts ?? {};
  return {
    held: Boolean(asset?.held),
    quantity: numberToInput(f['position.quantity']),
    avgCost: numberToInput(f['position.avgCost']),
  };
}

/** Seçili varlığın portföy bilgisi (sahiplik, adet, maliyet) ve listeden kaldırma. */
export function PositionDialog({ asset, open, onClose, onSaved, onRemoved }) {
  const [position, setPosition] = useState(() => initialPosition(asset));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Her açılışta güncel değerlerle başla
  useEffect(() => {
    if (open) {
      setPosition(initialPosition(asset));
      setErrors({});
      setConfirmRemove(false);
    }
  }, [open, asset]);

  if (!asset) return null;

  const save = async () => {
    const v = validatePosition(position);
    setErrors(v.errors);
    if (Object.keys(v.errors).length) return;
    setBusy(true);
    try {
      await api.savePosition({ symbol: asset.symbol, held: position.held, quantity: v.quantity, avgCost: v.avgCost });
      onSaved();
      onClose();
    } catch (err) {
      setErrors({ quantity: err.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeAsset(asset.symbol);
      onRemoved(asset.symbol);
      onClose();
    } catch (err) {
      setErrors({ quantity: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${asset.symbol} · portföy bilgisi`}
      footer={
        <>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            Kaydet
          </Button>
        </>
      }
    >
      <p className="-mt-1 text-sm text-fg-muted">{asset.name}</p>
      <PositionFields value={position} onChange={setPosition} unit={UNIT[asset.type]} errors={errors} />

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        {!confirmRemove ? (
          <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={busy} className="self-start">
            <Trash2 size={15} aria-hidden="true" />
            Listeden kaldır
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-critical/10 p-3 text-sm">
            <p className="text-fg">
              {asset.symbol} izleme listesinden ve portföyden çıkarılacak, fiyat geçmişi silinecek. Sonradan tekrar ekleyebilirsiniz.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" onClick={remove} disabled={busy}>
                Evet, kaldır
              </Button>
              <Button onClick={() => setConfirmRemove(false)}>Vazgeç</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
