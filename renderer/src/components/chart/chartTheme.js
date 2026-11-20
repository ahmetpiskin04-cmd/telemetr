// Grafik canvas'a çizildiği için Tailwind sınıfları işlemez; renkler index.css'teki
// CSS değişkenlerinden okunur, böylece tek kaynak korunur.
import { ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';

const VARS = {
  surface1: '--color-surface-1',
  line: '--color-line',
  lineStrong: '--color-line-strong',
  grid: '--color-grid',
  fgMuted: '--color-fg-muted',
  fgDim: '--color-fg-dim',
  fgStrong: '--color-fg-strong', // ana fiyat çizgisi (fonlar): seri değil, grafiğin konusu
  up: '--color-candle-up',
  down: '--color-candle-down',
  series1: '--color-series-1', // hızlı seri: SMA 5, MACD hattı
  series2: '--color-series-2', // yavaş seri: SMA 20, sinyal hattı
  sans: '--font-sans',
};

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]));
}

/** '#rrggbb' + opaklık -> rgba() */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Odak fiyat mumlarında; yardımcı katmanlar bu oranlarla geri çekilir
export const EMPHASIS = {
  volume: 0.45, // nötr gri çubuklar, kendi alanında
  macdHistogram: 0.5,
  areaWash: 0.1, // alan dolgusu: seri renginin ~%10'u (doygun blok değil)
};

// Çizgi kalınlığı: tüm seriler 2px (dataviz mark spec)
export const LINE_WIDTH = 2;

/**
 * Değerin büyüklüğüne göre hassasiyet (fon fiyatları ~1.29, MACD ~0.004) ve Türkçe ondalık
 * ayırıcı: eksen ve imleç etiketleri arayüzün geri kalanı gibi 8.325,40 biçiminde görünür.
 */
export function priceFormatFor(sample) {
  const precision = Math.abs(sample ?? 0) >= 10 ? 2 : 4;
  const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return { type: 'custom', minMove: 10 ** -precision, formatter: (price) => nf.format(price) };
}

export function chartOptions(t) {
  // İmleç: düz kıl çizgisi (kesikli çizgi "eşik/projeksiyon" gibi okunur)
  const crosshairLine = { color: alpha('#898781', 0.6), width: 1, style: LineStyle.Solid, labelBackgroundColor: '#383835' };
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: t.surface1 },
      textColor: t.fgDim,
      fontFamily: t.sans,
      fontSize: 11,
      panes: { separatorColor: t.grid, separatorHoverColor: t.lineStrong, enableResize: true },
      attributionLogo: true, // lightweight-charts lisansı TradingView atfını gerektirir
    },
    // Izgara: yüzeyden bir ton farklı, düz kıl çizgisi; yalnızca yatay
    grid: { vertLines: { visible: false }, horzLines: { color: t.grid, style: LineStyle.Solid } },
    crosshair: { mode: CrosshairMode.Normal, vertLine: crosshairLine, horzLine: crosshairLine },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.06 } },
    timeScale: { borderVisible: true, borderColor: t.lineStrong, rightOffset: 4, barSpacing: 9, minBarSpacing: 2 },
    localization: { locale: 'tr-TR', dateFormat: 'dd MMM yy' },
  };
}
