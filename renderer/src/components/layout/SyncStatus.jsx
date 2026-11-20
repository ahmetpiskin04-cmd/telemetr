import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from 'lucide-react';

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('tr-TR', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Üst bardaki veri güncelleme durumu + elle güncelleme butonu. */
export function SyncStatus({ sync }) {
  const failed = sync.last?.results.filter((r) => !r.ok) ?? [];
  let Icon = null;
  let iconClass = '';
  let text = 'Henüz güncellenmedi';
  let title = '';

  if (sync.running) {
    text = sync.progress ?? 'Veriler güncelleniyor…';
  } else if (sync.error) {
    Icon = CircleX;
    iconClass = 'text-critical';
    text = 'Güncelleme başarısız';
    title = sync.error;
  } else if (sync.last) {
    Icon = failed.length ? TriangleAlert : CircleCheck;
    iconClass = failed.length ? 'text-warning' : 'text-good';
    text = `Güncellendi ${formatTime(sync.last.finishedAt)}${failed.length ? ` · ${failed.length} hata` : ''}`;
    title = sync.last.results.map((r) => `${r.ok ? '✓' : '✖'} ${r.symbol}: ${r.ok ? `${r.rows} gün, son ${r.latest}` : r.error}`).join('\n');
  }

  return (
    <div className="flex items-center gap-3">
      <span className="flex max-w-72 items-center gap-1.5 text-xs text-fg-muted" title={title} aria-live="polite">
        {Icon && <Icon size={15} className={`shrink-0 ${iconClass}`} aria-hidden="true" />}
        <span className="num truncate">{text}</span>
      </span>
      <button
        type="button"
        onClick={sync.run}
        disabled={sync.running}
        className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-strong transition-colors duration-150 hover:bg-surface-3 disabled:opacity-50"
      >
        <RefreshCw size={15} className={sync.running ? 'animate-spin' : ''} aria-hidden="true" />
        {sync.running ? 'Güncelleniyor' : 'Verileri güncelle'}
      </button>
    </div>
  );
}
