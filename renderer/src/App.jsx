import { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { orderedSymbols } from './lib/assets.js';
import { useAsync } from './hooks/useAsync.js';
import { useSync } from './hooks/useSync.js';
import { DashboardLayout } from './components/layout/DashboardLayout.jsx';
import { TopBar } from './components/layout/TopBar.jsx';
import { Watchlist } from './components/watchlist/Watchlist.jsx';
import { ChartPanel } from './components/chart/ChartPanel.jsx';
import { AiPanel } from './components/ai/AiPanel.jsx';
import { EmptyState } from './components/ui/EmptyState.jsx';
import { AddAssetDialog } from './components/portfolio/AddAssetDialog.jsx';
import { PositionDialog } from './components/portfolio/PositionDialog.jsx';
import { AlertsDialog } from './components/alerts/AlertsDialog.jsx';

/** Basit / Detaylı görünüm; seçim bu bilgisayarda hatırlanır (yalnızca kolaylık, veri değil). */
function useViewMode() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('telemetr:mode') ?? 'simple';
    } catch {
      return 'simple';
    }
  });
  const change = (next) => {
    setMode(next);
    try {
      localStorage.setItem('telemetr:mode', next);
    } catch {
      // depolama kapalıysa yalnızca bu oturumda geçerli
    }
  };
  return [mode, change];
}

/** ↑/↓ ile watchlist'te gezinme (bir form alanı odaktayken devre dışı). */
function useWatchlistKeys(symbols, current, select) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, select, textarea, button') || !symbols.length) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = symbols.indexOf(current);
      const next = e.key === 'ArrowDown' ? Math.min(i + 1, symbols.length - 1) : Math.max(i - 1, 0);
      select(symbols[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [symbols, current, select]);
}

export default function App() {
  const overview = useAsync(() => api.overview(), []);
  const report = useAsync(() => api.latestReport(), []);
  const [selected, setSelected] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useViewMode();
  const [dialog, setDialog] = useState(null); // 'add' | 'position' | 'alerts' | null

  const assets = overview.data?.assets ?? [];
  const symbols = orderedSymbols(assets);
  // Seçilen sembol henüz listede yoksa (yeni eklendi, geçmişi iniyor) varsayılanı göster;
  // güncelleme bitip listeye düşünce seçim kendiliğinden ona geçer.
  const available = selected != null && symbols.includes(selected) ? selected : null;
  const symbol = available ?? assets.find((a) => a.held)?.symbol ?? symbols[0] ?? null;
  const asset = assets.find((a) => a.symbol === symbol) ?? null;
  useWatchlistKeys(symbols, symbol, setSelected);

  // Veri güncellemesi (otomatik veya elle) bitince tüm paneller yeniden yüklenir
  const sync = useSync(() => {
    overview.reload();
    report.reload();
    setRefreshKey((k) => k + 1);
  });

  let main;
  if (overview.status === 'error' && !overview.data) {
    main = <EmptyState tone="error" title="Veri yüklenemedi" detail={overview.error.message} />;
  } else if (overview.data && assets.length === 0) {
    main = (
      <EmptyState
        title={sync.running ? 'Veriler ilk kez indiriliyor…' : 'Veritabanında varlık yok'}
        detail={sync.running ? sync.progress : 'Sağ üstten "Verileri güncelle" ya da terminalde: npm run sync'}
      />
    );
  } else if (asset) {
    main = <ChartPanel asset={asset} refreshKey={refreshKey} mode={mode} onEdit={() => setDialog('position')} />;
  } else {
    main = <EmptyState title="Yükleniyor…" />;
  }

  return (
    <>
    <DashboardLayout
      top={<TopBar overview={overview.data} sync={sync} mode={mode} onModeChange={setMode} onOpenAlerts={() => setDialog('alerts')} />}
      left={<Watchlist assets={assets} selected={symbol} onSelect={setSelected} onAdd={() => setDialog('add')} />}
      main={main}
      right={<AiPanel report={report} symbols={symbols} onSelectSymbol={setSelected} mode={mode} />}
    />
    {/* Yeni varlık: geçmişi güncelleme bitince listeye düşer, o zaman seçili olur */}
    <AddAssetDialog open={dialog === 'add'} onClose={() => setDialog(null)} onAdded={(s) => setSelected(s)} />
    <AlertsDialog open={dialog === 'alerts'} onClose={() => setDialog(null)} />
    <PositionDialog
      asset={asset}
      open={dialog === 'position'}
      onClose={() => setDialog(null)}
      onSaved={() => overview.reload()}
      onRemoved={() => {
        setSelected(null);
        overview.reload();
      }}
    />
    </>
  );
}
