import { Activity, ArrowLeftRight, Compass, Gauge, Ruler, TriangleAlert, Waves } from 'lucide-react';
import { plainAverage, plainMomentum, plainRsi, plainSpread, plainTrend, plainVolatility } from '../../lib/plain.js';

const TONE_TEXT = {
  up: 'text-up',
  down: 'text-down',
  neutral: 'text-fg-strong',
  warning: 'text-fg-strong',
};

/** Soru + sade cevap + tek cümlelik açıklama. Teknik değer küçük ve geri planda. */
function Card({ icon: Icon, question, item }) {
  if (!item) return null;
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Icon size={14} className="text-fg-dim" aria-hidden="true" />
        {question}
      </span>
      <span className="flex items-center gap-2">
        {item.tone === 'warning' && <TriangleAlert size={16} className="shrink-0 text-warning" aria-label="Dikkat" />}
        <span className={`truncate text-lg leading-tight font-semibold ${TONE_TEXT[item.tone]}`}>{item.label}</span>
        {item.value && <span className="num shrink-0 text-xs text-fg-dim">{item.value}</span>}
      </span>
      <span className="text-xs leading-snug text-fg-muted">{item.detail}</span>
    </div>
  );
}

/** Basit görünüm: göstergeler yerine sorulara verilmiş sade cevaplar. */
export function SimpleSummary({ asset }) {
  const f = asset.facts ?? {};
  const spread = plainSpread(f);
  return (
    <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-3">
      <Card icon={Compass} question="Genel yön (30 gün)" item={plainTrend(f)} />
      <Card icon={Ruler} question="Fiyat ortalamaya göre" item={plainAverage(f)} />
      <Card icon={Gauge} question="Kısa sürede aşırı hareket var mı?" item={plainRsi(f)} />
      <Card icon={Activity} question="Son günlerin gidişatı" item={plainMomentum(f, asset.events)} />
      <Card icon={Waves} question="Ne kadar oynak?" item={plainVolatility(f)} />
      {spread && <Card icon={ArrowLeftRight} question="Alış-satış farkı" item={spread} />}
    </div>
  );
}
