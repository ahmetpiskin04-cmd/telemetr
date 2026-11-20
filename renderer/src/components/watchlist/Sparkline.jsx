/**
 * 30 günlük mini grafik (stat-tile "trend" sözleşmesi): çizgi geri planda soluk renkte,
 * yalnızca son nokta vurgulu. Yön bilgisini yanındaki değişim yüzdesi taşır; çizgiyi
 * kırmızı/yeşil boyamak aynı bilgiyi ikinci kez kodlayıp listeyi renk denizine çeviriyordu.
 */
export function Sparkline({ values, width = 60, height = 20 }) {
  if (!values || values.length < 2) return <div style={{ width, height }} />;
  const pad = 3; // son noktanın halkası kesilmesin
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = pts.at(-1);

  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={line} fill="none" className="stroke-fg-dim" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* 2px yüzey halkası + vurgulu son nokta */}
      <circle cx={lastX} cy={lastY} r="3.5" className="fill-series-1 stroke-surface-1" strokeWidth="2" />
    </svg>
  );
}
