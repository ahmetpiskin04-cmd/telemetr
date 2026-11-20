import { useEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';
import { alpha, chartOptions, EMPHASIS, LINE_WIDTH, priceFormatFor, readTheme } from './chartTheme.js';

/**
 * lightweight-charts sarmalayıcısı. Her alan tek bir y eksenine sahiptir (çift eksen yok):
 *  Fiyat : mum (OHLC yoksa nötr alan) + SMA 5 (seri 1) + SMA 20 (seri 2) + SMA kesişim okları
 *  Hacim : nötr gri çubuklar (yalnızca hacim verisi olan varlıklarda)
 *  MACD  : histogram (yön renkleri, %50) + MACD hattı (seri 1) + sinyal (seri 2)
 * Alanlar aynı zaman eksenini paylaşır; ayırıcılar sürüklenerek boyutlandırılabilir.
 *
 * advanced=false (basit görünüm): MACD alanı ve kesişim işaretleri gizlenir.
 * Mumlar: yükselen içi boş, düşen dolu — yön rengin yanında şekille de okunur.
 * onHoverIndex(i | null): imlecin üzerindeki mumun data.candles içindeki indeksi.
 */
export function PriceChart({ data, visibleBars, onHoverIndex, advanced = true }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const hoverRef = useRef(onHoverIndex);
  hoverRef.current = onHoverIndex;

  // Grafik bir kez oluşturulur; veri değişince yalnızca seriler yenilenir.
  useEffect(() => {
    const chart = createChart(containerRef.current, chartOptions(readTheme()));
    chartRef.current = chart;
    const onMove = (param) => {
      hoverRef.current?.(param.point == null || param.logical == null ? null : Math.round(param.logical));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const t = readTheme();
    const series = [];
    const plugins = [];
    const add = (definition, options, pane = 0) => {
      const s = chart.addSeries(definition, { priceLineVisible: false, lastValueVisible: false, ...options }, pane);
      series.push(s);
      return s;
    };

    // Basit görünüm: tek fiyat çizgisi + silik 20 günlük ortalama; mum, 5 günlük ortalama ve hacim yok.
    const useCandles = advanced && data.hasOhlc;
    let nextPane = 1;
    const volumePane = advanced && data.hasVolume ? nextPane++ : null;
    const macdPane = advanced ? nextPane : null;
    const lastClose = data.candles.at(-1)?.close;
    const priceFormat = priceFormatFor(lastClose);
    const lastPriceLine = { lastValueVisible: true, priceLineVisible: true, priceLineStyle: LineStyle.Solid, priceLineWidth: 1 };

    // --- Fiyat
    const main = useCandles
      ? add(CandlestickSeries, {
          upColor: 'rgba(0, 0, 0, 0)', // içi boş: renk dışı ikinci kodlama
          downColor: t.down,
          borderVisible: true,
          borderUpColor: t.up,
          borderDownColor: t.down,
          wickUpColor: t.up,
          wickDownColor: t.down,
          ...lastPriceLine,
          priceLineColor: alpha('#898781', 0.6),
          priceFormat,
        })
      : add(AreaSeries, {
          // Fiyatın kendisi nötr mürekkep: seri 1 (mavi) SMA 5'e ait, aynı rengi iki şey taşımasın
          lineColor: t.fgStrong,
          lineWidth: LINE_WIDTH,
          topColor: alpha(t.fgStrong, EMPHASIS.areaWash),
          bottomColor: alpha(t.fgStrong, 0),
          ...lastPriceLine,
          priceLineColor: alpha('#898781', 0.6),
          priceFormat,
        });
    main.setData(useCandles ? data.candles : data.candles.map((c) => ({ time: c.time, value: c.close })));

    const lineOptions = { lineWidth: LINE_WIDTH, crosshairMarkerVisible: false };
    if (advanced) {
      add(LineSeries, { ...lineOptions, color: t.series1, priceFormat }).setData(data.smaShort);
      add(LineSeries, { ...lineOptions, color: t.series2, priceFormat }).setData(data.smaLong);
    } else {
      // Tek referans çizgisi: fiyatın önüne geçmesin diye ince ve silik
      add(LineSeries, { lineWidth: 1.5, crosshairMarkerVisible: false, color: alpha(t.series2, 0.7), priceFormat }).setData(data.smaLong);
    }

    // --- Hacim: kendi alanı, kendi ekseni; tek nötr renk (yönü mumlar zaten gösteriyor)
    if (volumePane != null) {
      add(HistogramSeries, { color: alpha('#898781', EMPHASIS.volume), priceFormat: { type: 'volume' } }, volumePane).setData(
        data.volume.map((v) => ({ time: v.time, value: v.value })),
      );
    }

    // --- MACD (yalnızca detaylı görünümde)
    let macdLine = null;
    if (macdPane != null) {
      const macdFormat = priceFormatFor(lastClose); // MACD fiyat biriminde: fiyatla aynı hassasiyet
      add(HistogramSeries, { priceFormat: macdFormat }, macdPane).setData(
        data.macd.histogram.map((p) => ({ ...p, color: alpha(p.value >= 0 ? t.up : t.down, EMPHASIS.macdHistogram) })),
      );
      macdLine = add(LineSeries, { ...lineOptions, color: t.series1, priceFormat: macdFormat }, macdPane);
      macdLine.setData(data.macd.line);
      add(LineSeries, { ...lineOptions, color: t.series2, priceFormat: macdFormat }, macdPane).setData(data.macd.signal);
    }

    // --- Kesişim işaretleri (yön: renk + ok/yer) — yalnızca detaylı görünümde
    if (advanced) {
      plugins.push(
        createSeriesMarkers(
          main,
          data.markers
            .filter((m) => m.kind === 'sma')
            .map((m) => ({
              time: m.time,
              position: m.direction === 'up' ? 'belowBar' : 'aboveBar',
              shape: m.direction === 'up' ? 'arrowUp' : 'arrowDown',
              color: m.direction === 'up' ? t.up : t.down,
              size: 1,
            })),
        ),
        createSeriesMarkers(
          macdLine,
          data.markers
            .filter((m) => m.kind === 'macd')
            .map((m) => ({ time: m.time, position: 'inBar', shape: 'circle', color: m.direction === 'up' ? t.up : t.down, size: 0.8 })),
        ),
      );
    }

    // Alan başlıkları: her alanın ne gösterdiği yazılı (renk eşleştirmeye bırakılmaz)
    const panes = chart.panes();
    const title = (pane, text) =>
      pane && plugins.push(createTextWatermark(pane, { horzAlign: 'left', vertAlign: 'top', lines: [{ text, color: t.fgDim, fontSize: 11 }] }));
    if (volumePane != null) title(panes[volumePane], 'Hacim');
    if (macdPane != null) title(panes[macdPane], `MACD ${data.config.macd.fast}/${data.config.macd.slow}/${data.config.macd.signal}`);

    panes[0]?.setStretchFactor(5);
    if (volumePane != null) panes[volumePane]?.setStretchFactor(1);
    if (macdPane != null) panes[macdPane]?.setStretchFactor(1.6);

    return () => {
      if (chartRef.current !== chart) return; // grafik zaten yok edildi
      plugins.forEach((p) => p.detach());
      series.forEach((s) => chart.removeSeries(s)); // boş kalan alanlar kendiliğinden kalkar
    };
  }, [data, advanced]);

  // Görünür aralık (1A / 3A / 6A / Tümü)
  useEffect(() => {
    const timeScale = chartRef.current?.timeScale();
    if (!timeScale) return;
    const n = data.candles.length;
    if (!visibleBars || visibleBars >= n) timeScale.fitContent();
    else timeScale.setVisibleLogicalRange({ from: n - visibleBars, to: n + 2 });
  }, [data, visibleBars]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
