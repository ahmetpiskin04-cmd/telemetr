import { useEffect, useState } from 'react';
import { ChevronDown, CircleX, LoaderCircle, Newspaper, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtCompact } from '../../lib/format.js';
import { PanelHeader, Segmented } from '../ui/EmptyState.jsx';
import { MarkdownReport } from './MarkdownReport.jsx';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
];

const PanelIcon = () => (
  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-strong">
    <Sparkles size={16} aria-hidden="true" />
  </span>
);

function ReportControls({ onGenerate, busy, lastProvider, simple }) {
  const [provider, setProvider] = useState(lastProvider ?? 'openai');
  // Son raporun sağlayıcısını hatırla (rapor asenkron yüklenir)
  useEffect(() => {
    if (lastProvider) setProvider(lastProvider);
  }, [lastProvider]);
  const [rss, setRss] = useState(true);
  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-line p-4">
      {!simple && (
      <div className="flex items-center justify-between gap-2">
        <Segmented label="AI sağlayıcısı" options={PROVIDERS} value={provider} onChange={setProvider} />
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={rss} onChange={(e) => setRss(e.target.checked)} className="size-3.5" />
          <Newspaper size={13} aria-hidden="true" />
          Günün haberleri
        </label>
      </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onGenerate(simple ? { rss: true } : { provider, rss })}
        className="flex items-center justify-center gap-2 rounded-lg bg-fg-strong px-4 py-2 text-sm font-semibold text-surface-0 transition-colors duration-150 hover:bg-white disabled:opacity-60"
      >
        {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
        {busy ? 'Analiz ediliyor…' : 'Rapor üret'}
      </button>
    </div>
  );
}

/** grounding.js sonucunu özetler: kaç kanıt doğrulandı, hata/uyarı var mı. */
function VerificationBar({ verification, simple }) {
  const [open, setOpen] = useState(false);
  if (!verification) return null;
  const { ok, errors, warnings, evidenceChecked } = verification;
  const issues = [...errors.map((m) => ({ m, error: true })), ...warnings.map((m) => ({ m, error: false }))];
  const Icon = ok ? ShieldCheck : CircleX;

  return (
    <div className={`mx-4 mt-3 rounded-lg border text-xs ${ok ? 'border-good/25 bg-good/8' : 'border-critical/30 bg-critical/10'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!issues.length}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
      >
        <Icon size={15} className={`shrink-0 ${ok ? 'text-good' : 'text-critical'}`} aria-hidden="true" />
        <span className="text-fg">
          {ok
            ? simple
              ? 'Rapordaki sayılar verilerinizle kontrol edildi'
              : `${evidenceChecked} kanıt veriyle doğrulandı`
            : simple
              ? 'Raporda verilerinizle uyuşmayan sayılar var, dikkatli okuyun'
              : `${errors.length} tutarsızlık: bazı değerler veriyle uyuşmuyor`}
        </span>
        {warnings.length > 0 && (
          <span className="flex items-center gap-1 text-fg" title={`${warnings.length} uyarı`}>
            <TriangleAlert size={13} className="text-warning" aria-hidden="true" />
            {warnings.length}
          </span>
        )}
        {issues.length > 0 && (
          <ChevronDown size={15} className={`ml-auto text-fg-dim transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        )}
      </button>
      {open && (
        <ul className="space-y-1.5 border-t border-line/60 px-3 py-2">
          {issues.map(({ m, error }) => (
            <li key={m} className={`flex gap-1.5 leading-snug select-text ${error ? 'text-fg' : 'text-fg-muted'}`}>
              {error ? <CircleX size={13} className="mt-0.5 shrink-0 text-critical" aria-hidden="true" /> : <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />}
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function reportMetaText(report) {
  const usage = report.usage?.inputTokens ? ` · ${fmtCompact(report.usage.inputTokens)}→${fmtCompact(report.usage.outputTokens)} token` : '';
  return `${report.asOf ?? report.createdAt.slice(0, 10)} · ${report.model ?? report.provider ?? '?'}${usage}`;
}

export function AiPanel({ report, symbols, onSelectSymbol, mode = 'simple' }) {
  const simple = mode === 'simple';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const generate = async (options) => {
    setBusy(true);
    setError(null);
    try {
      await api.generateReport(options);
      report.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const data = report.data;
  return (
    <div className="flex h-full flex-col">
      <PanelHeader icon={<PanelIcon />} title="AI Analist" subtitle={data ? `Son rapor · ${reportMetaText(data)}` : 'Portföyünüze özel teknik yorum'} />
      <ReportControls onGenerate={generate} busy={busy} lastProvider={data?.provider} simple={simple} />
      {error && (
        <p role="alert" className="mx-4 mt-3 flex gap-2 rounded-lg bg-critical/10 px-3 py-2 text-xs break-words text-fg select-text">
          <CircleX size={14} className="mt-0.5 shrink-0 text-critical" aria-hidden="true" />
          {error}
        </p>
      )}

      {data ? (
        <>
          <VerificationBar verification={data.verification} simple={simple} />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6 select-text">
            <MarkdownReport markdown={data.markdown} symbols={symbols} onSelectSymbol={onSelectSymbol} simple={simple} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-fg-dim">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-fg-strong">{report.status === 'loading' ? 'Rapor yükleniyor…' : 'Henüz rapor yok'}</p>
          {report.status !== 'loading' && (
            <p className="text-xs leading-relaxed text-fg-muted">
              <span className="font-medium text-fg-strong">Rapor üret</span>'e basın. API anahtarı proje klasöründeki{' '}
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px] text-fg">.env</code> dosyasından okunur.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
