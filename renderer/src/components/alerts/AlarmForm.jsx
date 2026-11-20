import { useState } from 'react';
import { LoaderCircle, Save } from 'lucide-react';
import { api } from '../../lib/api.js';
import { DIRECTION_OPTIONS, TYPE_HINTS, TYPE_OPTIONS, alarmToForm, assetLabel, emptyForm, formToAlarmInput, formatNumber } from '../../lib/alerts.js';
import { Button, Field, inputClass } from '../ui/Dialog.jsx';
import { Segmented } from '../ui/EmptyState.jsx';

/** Yeni alarm ya da var olanı düzenleme formu. Doğrulama sunucuda; hata mesajı olduğu gibi gösterilir. */
export function AlarmForm({ alarm, assets, settings, onCancel, onSaved }) {
  const [form, setForm] = useState(() => (alarm ? alarmToForm(alarm) : emptyForm(assets)));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const isLoss = form.type === 'portfolio_loss';
  const unit = assets.find((a) => a.symbol === form.symbol)?.unit ?? 'TL';

  const changeType = (type) => {
    const direction = type === 'daily_change' ? 'down' : 'below';
    set({ type, direction });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.alertsSave(formToAlarmInput(form, alarm?.id));
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Alarm türü</span>
        <Segmented label="Alarm türü" options={TYPE_OPTIONS} value={form.type} onChange={changeType} />
        <span className="text-xs text-fg-dim">{TYPE_HINTS[form.type]}</span>
      </div>

      {!isLoss && (
        <Field label="Varlık">
          <select className={inputClass} value={form.symbol} onChange={(e) => set({ symbol: e.target.value })}>
            {assets.map((a) => (
              <option key={a.symbol} value={a.symbol}>
                {assetLabel(a.symbol, assets)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {DIRECTION_OPTIONS[form.type] && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Koşul</span>
          <Segmented label="Koşul" options={DIRECTION_OPTIONS[form.type]} value={form.direction} onChange={(direction) => set({ direction })} />
        </div>
      )}

      {form.type === 'price' && (
        <Field label={`Eşik (${unit})`} hint="Virgül ya da nokta kullanabilirsin, ör. 385,5">
          <input className={inputClass} inputMode="decimal" value={form.threshold} onChange={(e) => set({ threshold: e.target.value })} placeholder="385" />
        </Field>
      )}

      {(form.type === 'daily_change' || form.type === 'avg_deviation') && (
        <Field
          label="Yüzde (%)"
          hint={form.type === 'daily_change' ? 'Bir önceki kapanışa göre değişim, ör. 3' : 'Son 20 günlük kapanış ortalamasına göre fark, ör. 5'}
        >
          <input className={inputClass} inputMode="decimal" value={form.percent} onChange={(e) => set({ percent: e.target.value })} placeholder="3" />
        </Field>
      )}

      {isLoss && settings && (
        <p className="rounded-lg border border-line bg-surface-0/60 px-3 py-2 text-sm text-fg-muted">
          Şu anki sınır <span className="num font-medium text-fg-strong">{formatNumber(settings.lossLimitTry, 0)} TL</span>, ilk uyarı{' '}
          <span className="num font-medium text-fg-strong">%{formatNumber(settings.lossWarnRatio * 100, 1)}</span> seviyesinde. Değiştirmek için Ayarlar sekmesine bak.
        </p>
      )}

      <Field label="Alarm adı" hint="İsteğe bağlı; boş bırakırsan kuraldan otomatik üretilir">
        <input className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} placeholder="ör. BIMAS alım bölgesi" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Bekleme süresi (saat)" hint={`Aynı alarm bu süre dolmadan tekrar çalmaz. Boş = ${settings?.defaultCooldownHours ?? 24} saat`}>
          <input className={inputClass} inputMode="decimal" value={form.cooldownHours} onChange={(e) => set({ cooldownHours: e.target.value })} placeholder={String(settings?.defaultCooldownHours ?? 24)} />
        </Field>
        <label className="flex items-start gap-2.5 pt-7 text-sm text-fg">
          <input type="checkbox" className="mt-0.5 size-4 accent-series-1" checked={form.once} onChange={(e) => set({ once: e.target.checked })} />
          <span>
            Tek seferlik
            <span className="block text-xs text-fg-dim">Bir kez çalınca alarm kapanır</span>
          </span>
        </label>
      </div>

      {!alarm && !isLoss && (
        <p className="text-xs text-fg-dim">Fiyat zaten eşiğin ötesindeyse alarm hemen çalmaz; fiyat güvenli tarafa dönüp tekrar geçince çalar.</p>
      )}
      {error && <p className="text-sm text-down">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Vazgeç</Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          {alarm ? 'Kaydet' : 'Alarmı ekle'}
        </Button>
      </div>
    </form>
  );
}
