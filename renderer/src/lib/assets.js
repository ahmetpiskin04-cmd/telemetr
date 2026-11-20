// Watchlist sıralaması tek yerde: hem liste hem klavye gezinmesi aynı sırayı kullanır.
// Sahip olunan varlıklar en üstte "Portföyüm" grubunda; geri kalanlar türüne göre.
import { TYPE_LABELS } from './format.js';

const TYPE_ORDER = ['BIST_STOCK', 'PRECIOUS_METAL', 'FUND'];
const bySymbol = (a, b) => a.symbol.localeCompare(b.symbol);

export function groupAssets(assets) {
  const held = assets.filter((a) => a.held).sort(bySymbol);
  const groups = [{ id: 'HELD', label: 'Portföyüm', highlight: true, items: held }];
  for (const type of TYPE_ORDER) {
    groups.push({ id: type, label: TYPE_LABELS[type], items: assets.filter((a) => !a.held && a.type === type).sort(bySymbol) });
  }
  return groups.filter((g) => g.items.length > 0);
}

export function orderedSymbols(assets) {
  return groupAssets(assets).flatMap((g) => g.items.map((a) => a.symbol));
}
