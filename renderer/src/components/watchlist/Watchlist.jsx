import { Briefcase, Plus } from 'lucide-react';
import { groupAssets } from '../../lib/assets.js';
import { PanelHeader } from '../ui/EmptyState.jsx';
import { WatchlistRow } from './WatchlistRow.jsx';

export function Watchlist({ assets, selected, onSelect, onAdd }) {
  const groups = groupAssets(assets);
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Piyasalar"
        subtitle={`${assets.length} varlık · değişimler 30 günlük`}
        right={
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-strong transition-colors duration-150 hover:bg-surface-3"
          >
            <Plus size={14} aria-hidden="true" />
            Ekle
          </button>
        }
      />
      <nav aria-label="İzleme listesi" className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((g, i) => (
          <section key={g.id} className={i > 0 ? 'mt-3 border-t border-line pt-3' : ''}>
            <h3 className={`mb-1 flex items-center gap-1.5 px-2.5 text-xs font-medium ${g.highlight ? 'text-fg-strong' : 'text-fg-dim'}`}>
              {g.highlight && <Briefcase size={13} aria-hidden="true" />}
              {g.label}
              <span className="ml-auto font-normal text-fg-dim">{g.items.length}</span>
            </h3>
            <div className="space-y-0.5">
              {g.items.map((a) => (
                <WatchlistRow key={a.symbol} asset={a} selected={a.symbol === selected} onSelect={onSelect} />
              ))}
            </div>
          </section>
        ))}
      </nav>
    </div>
  );
}
