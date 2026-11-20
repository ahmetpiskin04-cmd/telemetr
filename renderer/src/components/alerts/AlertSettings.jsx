import { useState } from 'react';
import { CircleCheck, CircleX, LoaderCircle, Plus, Send, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { assetLabel, percentToRatio, ratioToPercent } from '../../lib/alerts.js';
import { Button, Field, inputClass } from '../ui/Dialog.jsx';
import { Switch } from './Switch.jsx';

/** Ayarlar sekmesi: zarar sınırı, kontrol aralığı, Telegram, izlenen varlık listesi. Hiçbiri kodda sabit değil. */
export function AlertSettings({ overview, onChanged }) {
  const { settings, assets, channels } = overview;
  const [form, setForm] = useState({
    lossLimitTry: String(settings.lossLimitTry),
    lossWarnPercent: String(ratioToPercent(settings.lossWarnRatio)),
    checkIntervalMinutes: String(settings.checkIntervalMinutes),
    defaultCooldownHours: String(settings.defaultCooldownHours),
  });
  const [message, setMessage] = useState(null); // { tone: 'ok' | 'error', text }
  const [busy, setBusy] = useState(null);
  const [newAsset, setNewAsset] = useState('');
  const [testResult, setTestResult] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const run = async (key, fn, okText) => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await fn();
      if (okText) setMessage({ tone: 'ok', text: okText });
      onChanged();
      return result;
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = (e) => {
    e.preventDefault();
    return run(
      'settings',
      () =>
        api.alertsSettings({
          lossLimitTry: form.lossLimitTry,
          lossWarnRatio: percentToRatio(form.lossWarnPercent),
          checkIntervalMinutes: form.checkIntervalMinutes,
          defaultCooldownHours: form.defaultCooldownHours,
        }),
      'Ayarlar kaydedildi',
    );
  };

  const sendTest = async () => {
    setTestResult(null);
    const result = await run('test', () => api.alertsTest());
    if (result) setTestResult(result);
  };

  const addAsset = async (e) => {
    e.preventDefault();
    if (!newAsset.trim()) return;
    const added = await run('asset', () => api.alertsAssetAdd(newAsset.trim()));
    if (added) setNewAsset('');
  };

  const channelLine = (ok, label) => (
    <span className="flex items-center gap-1.5">
      {ok ? <CircleCheck size={15} className="text-good" aria-hidden="true" /> : <CircleX size={15} className="text-fg-dim" aria-hidden="true" />}
      {label}
    </span>
  );

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={saveSettings} className="grid grid-cols-2 gap-4">
        <Field label="Hisse zarar sınırı (TL)" hint="Toplam hisse zararı bu tutara yaklaşınca ve aşınca uyarılırsın">
          <input className={inputClass} inputMode="decimal" value={form.lossLimitTry} onChange={(e) => set({ lossLimitTry: e.target.value })} />
        </Field>
        <Field label="İlk uyarı oranı (%)" hint="Sınırın bu yüzdesine gelince ilk uyarı (ör. 80)">
          <input className={inputClass} inputMode="decimal" value={form.lossWarnPercent} onChange={(e) => set({ lossWarnPercent: e.target.value })} />
        </Field>
        <Field label="Kontrol aralığı (dakika)" hint="Altın ve döviz için; borsa hisseleri yalnızca hafta içi 10:00-18:00 kontrol edilir">
          <input className={inputClass} inputMode="numeric" value={form.checkIntervalMinutes} onChange={(e) => set({ checkIntervalMinutes: e.target.value })} />
        </Field>
        <Field label="Varsayılan bekleme süresi (saat)" hint="Yeni alarmlarda aynı alarmın tekrar çalmadan önce beklemesi">
          <input className={inputClass} inputMode="decimal" value={form.defaultCooldownHours} onChange={(e) => set({ defaultCooldownHours: e.target.value })} />
        </Field>
        <div className="col-span-2 flex items-center justify-between gap-3">
          <p className={`text-sm ${message?.tone === 'error' ? 'text-down' : 'text-good'}`} role="status">
            {message?.text}
          </p>
          <Button variant="primary" type="submit" disabled={busy === 'settings'}>
            {busy === 'settings' && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            Ayarları kaydet
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-3 rounded-xl border border-line p-4" aria-label="Bildirim kanalları">
        <h3 className="text-sm font-semibold text-fg-strong">Bildirim kanalları</h3>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-fg">
          {channelLine(channels.desktop, 'Windows bildirimi')}
          {channelLine(channels.telegramConfigured && channels.telegramEnabled, channels.telegramConfigured ? 'Telegram' : 'Telegram (anahtar tanımlı değil)')}
        </div>
        <div className="flex items-center gap-3 text-sm text-fg">
          <Switch
            checked={settings.telegramEnabled}
            label="Telegram bildirimleri"
            disabled={busy === 'telegram'}
            onChange={(telegramEnabled) => run('telegram', () => api.alertsSettings({ telegramEnabled }))}
          />
          Telegram bildirimi gönder
        </div>
        {!channels.telegramConfigured && (
          <p className="text-xs text-fg-dim">
            Telegram için <span className="font-mono">TELEGRAM_BOT_TOKEN</span> ve <span className="font-mono">TELEGRAM_CHAT_ID</span> değerlerini
            kullanıcı klasöründeki <span className="font-mono">.evim\telemetr.env</span> dosyasına yaz, uygulamayı yeniden başlat.
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={sendTest} disabled={busy === 'test'}>
            {busy === 'test' ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
            Deneme bildirimi gönder
          </Button>
          {testResult && (
            <span className="text-sm text-fg-muted" role="status">
              Windows: {testResult.desktop === true ? 'gitti' : testResult.desktop === false ? 'hata' : 'kapalı'} · Telegram:{' '}
              {testResult.telegram === true ? 'gitti' : testResult.telegram === false ? 'hata (kayıt dosyasına bak)' : 'kapalı'}
            </span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-line p-4" aria-label="İzlenen varlıklar">
        <h3 className="text-sm font-semibold text-fg-strong">Alarm için izlenen varlıklar</h3>
        <ul className="flex flex-wrap gap-2">
          {assets.map((a) => (
            <li key={a.symbol} className="flex items-center gap-1 rounded-lg border border-line-strong bg-surface-2 py-1 pr-1 pl-2.5 text-sm text-fg-strong">
              {assetLabel(a.symbol, assets)}
              <button
                type="button"
                aria-label={`${a.symbol} varlığını çıkar`}
                onClick={() => run('asset', () => api.alertsAssetRemove(a.symbol))}
                className="rounded p-0.5 text-fg-dim transition-colors duration-150 hover:bg-surface-3 hover:text-fg"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addAsset} className="flex items-start gap-2">
          <input
            className={`${inputClass} max-w-48`}
            placeholder="THYAO, GRAM_ALTIN…"
            aria-label="Eklenecek varlık kodu"
            value={newAsset}
            onChange={(e) => setNewAsset(e.target.value)}
            maxLength={16}
          />
          <Button type="submit" disabled={busy === 'asset'}>
            <Plus size={16} aria-hidden="true" />
            Ekle
          </Button>
        </form>
        <p className="text-xs text-fg-dim">BİST kodu ya da GRAM_ALTIN, ONS_ALTIN (vadeli), USDTRY. Alarmı olan varlık çıkarılamaz.</p>
      </section>
    </div>
  );
}
