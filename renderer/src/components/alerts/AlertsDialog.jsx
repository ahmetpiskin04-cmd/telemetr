import { useEffect, useState } from 'react';
import { BellRing, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { describeAlarm, formatWhen, lastValueText, statusTone } from '../../lib/alerts.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Badge } from '../ui/Badge.jsx';
import { Button, Dialog } from '../ui/Dialog.jsx';
import { EmptyState, Segmented } from '../ui/EmptyState.jsx';
import { AlarmForm } from './AlarmForm.jsx';
import { AlertSettings } from './AlertSettings.jsx';
import { Switch } from './Switch.jsx';

const TABS = [
  { id: 'alarms', label: 'Alarmlar' },
  { id: 'settings', label: 'Ayarlar' },
];

function AlarmRow({ alarm, assets, settings, onEdit, onChanged, onError }) {
  const [confirming, setConfirming] = useState(false);
  const last = lastValueText(alarm, assets);
  const fired = formatWhen(alarm.lastTriggeredAt);

  const act = async (fn) => {
    try {
      await fn();
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <li className={`flex items-start gap-3 rounded-xl border border-line bg-surface-0/50 p-3.5 ${alarm.enabled ? '' : 'opacity-70'}`}>
      <Switch checked={alarm.enabled} label={`${alarm.name} alarmı açık`} onChange={(enabled) => act(() => api.alertsToggle(alarm.id, enabled))} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-fg-strong">{alarm.name}</h3>
          <Badge tone={statusTone(alarm)} className="max-w-full !whitespace-normal">
            {alarm.status}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-fg-muted">{describeAlarm(alarm, assets, settings)}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg-dim">
          {last && <span className="num">{last}</span>}
          <span>{fired ? `Son tetiklenme ${fired}` : 'Henüz tetiklenmedi'}</span>
          <span>Bekleme {alarm.cooldownHours} saat</span>
          {alarm.once && <span>Tek seferlik</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={`${alarm.name} alarmını düzenle`} onClick={() => onEdit(alarm)} className="rounded-md p-1.5 text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-fg">
          <Pencil size={16} />
        </button>
        {confirming ? (
          <Button variant="danger" className="!px-2.5 !py-1 text-xs" onClick={() => act(() => api.alertsDelete(alarm.id))} onBlur={() => setConfirming(false)} autoFocus>
            Silinsin mi?
          </Button>
        ) : (
          <button type="button" aria-label={`${alarm.name} alarmını sil`} onClick={() => setConfirming(true)} className="rounded-md p-1.5 text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-down">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

/** Fiyat alarmları: liste, ekleme/düzenleme formu ve ayarlar. Alarm yalnızca bilgilendirir; emir vermez. */
export function AlertsDialog({ open, onClose }) {
  const overview = useAsync(() => api.alertsOverview(), []);
  const [tab, setTab] = useState('alarms');
  const [editing, setEditing] = useState(null); // null | 'new' | alarm
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const { reload } = overview;

  // Açıkken ana süreçten gelen olaylarla (kontrol turu, düzenleme) liste kendini yeniler
  useEffect(() => {
    if (!open) return undefined;
    reload();
    return api.onAlertsEvent(() => reload());
  }, [open, reload]);

  const close = () => {
    setEditing(null);
    setError(null);
    onClose();
  };

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      await api.alertsRun();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const data = overview.data;
  let body;
  if (!data) {
    body = overview.status === 'error' ? <EmptyState tone="error" title="Alarmlar yüklenemedi" detail={overview.error?.message} /> : <EmptyState title="Yükleniyor…" />;
  } else if (tab === 'settings') {
    body = <AlertSettings overview={data} onChanged={reload} />;
  } else if (editing) {
    body = (
      <AlarmForm
        alarm={editing === 'new' ? null : editing}
        assets={data.assets}
        settings={data.settings}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  } else {
    body = (
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg-dim">
            {data.bistSessionOpen ? 'Borsa seansı açık: hisse alarmları kontrol ediliyor.' : 'Borsa seansı kapalı (hafta içi 10:00-18:00); altın ve döviz alarmları çalışmaya devam eder.'}
            {data.lastRun?.at && <span> Son kontrol {formatWhen(data.lastRun.at)}.</span>}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button onClick={checkNow} disabled={checking}>
              <RefreshCw size={15} className={checking ? 'animate-spin' : ''} aria-hidden="true" />
              Şimdi kontrol et
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} aria-hidden="true" />
              Yeni alarm
            </Button>
          </div>
        </div>
        {data.alarms.length === 0 ? (
          <EmptyState title="Henüz alarm yok" detail='"Yeni alarm" ile fiyat, günlük değişim, ortalama kıyası ya da zarar sınırı alarmı ekleyebilirsin.' />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {data.alarms.map((alarm) => (
              <AlarmRow key={alarm.id} alarm={alarm} assets={data.assets} settings={data.settings} onEdit={setEditing} onChanged={reload} onError={setError} />
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <Dialog open={open} onClose={close} title="Fiyat alarmları" wide>
      <div className="flex items-center justify-between gap-3">
        <Segmented
          label="Bölüm"
          options={TABS}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setEditing(null);
            setError(null);
          }}
        />
        <span className="flex items-center gap-1.5 text-xs text-fg-dim">
          <BellRing size={14} aria-hidden="true" />
          Alarm yalnızca bilgilendirir; alım-satım yapmaz.
        </span>
      </div>
      {error && <p className="text-sm text-down" role="alert">{error}</p>}
      {body}
    </Dialog>
  );
}
