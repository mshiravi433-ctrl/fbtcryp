import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import CandleChart from '../CandleChart';
import {
  bollingerBands,
  candleSpacingMs,
  candlesInLogicalRange,
  exponentialMovingAverage,
  macdSeries,
  pricePrecision,
  relativeStrengthIndex,
  simpleMovingAverage,
  windowStats
} from '../../lib/proChartMath';

/**
 * PROCHART — the candlestick engine behind the token page.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 * A thin, deliberately boring wrapper around TradingView's lightweight-charts
 * that turns a candle array into a real terminal: candles, moving averages,
 * Bollinger bands, a volume pane, an RSI pane, a MACD pane, Fibonacci levels,
 * user price levels, log scale, crosshair read-out and screen-visible stats.
 *
 * The rendering library is the same one the previous inline chart used, so
 * nothing here is a new engine to keep alive. What changed is what is ON the
 * chart and how much of the screen it owns — and that is where the work is.
 *
 * ─── WHY THE SERIES SET IS REBUILT, NOT PATCHED ─────────────────────────────
 * Panes are structural in lightweight-charts: a pane that exists takes vertical
 * space whether or not anything is drawn in it, and there is no supported way
 * to remove one. So enabling volume / RSI / MACD rebuilds the chart; every
 * other toggle (MA, EMA, bands, Fibonacci, levels, log scale, grid) is applied
 * to the live series with `applyOptions`, which is instant and does not lose
 * the zoom.
 *
 * Rebuilding would normally lose the user's pan and zoom — the "why does it
 * keep resetting" feel. So the visible logical range is captured before every
 * rebuild and re-applied afterwards, and only `fitContent()` is used when
 * there is no range to restore (first paint, or a new timeframe).
 *
 * ─── WHY THE FALLBACK IS THE RECHARTS CANDLE ────────────────────────────────
 * `createChart` needs matchMedia and ResizeObserver, and it measures a real
 * canvas. A stripped WebView, an SSR pass or a test DOM can lack those, and a
 * throwing chart constructor must not take the coin page down with it. The
 * same rule the old inline chart used applies: if the engine cannot mount, the
 * reader still gets candles from the SVG fallback instead of an error.
 *
 * ─── WHAT IT WILL NOT DRAW ──────────────────────────────────────────────────
 * No invented data, ever. A pane only appears when the feed returned points
 * for it; a period without enough history emits no MA point rather than a
 * flat line; and the volume pane is titled by the number that is actually in
 * the feed (rolling 24h) rather than being relabelled as per-candle volume.
 */

const UP = '#26a69a';
const DOWN = '#ef5350';
const MA_COLORS = { 7: '#00e5ff', 25: '#ff9800', 99: '#ab47bc' };
const EMA_COLORS = { 21: '#4fc3f7', 55: '#ffd54f' };
const BB_COLOR = 'rgba(124, 77, 255, 0.85)';

/** Live light/dark flag, following the app's own `data-theme` attribute. */
function useLightTheme() {
  const [light, setLight] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
  );
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined;
    const read = () => setLight(document.documentElement.getAttribute('data-theme') === 'light');
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return light;
}

/**
 * Histogram rows for the volume pane: the 24h reading at each candle, coloured
 * by that candle's direction so the pane reads with the chart instead of
 * beside it. A reading with no matching candle stays neutral grey — the pane
 * says "I have a number for this moment, not a direction for it".
 */
function volumeRows(volume, candles) {
  const dirByTime = new Map((candles ?? []).map((c) => [c.time, c.close >= c.open]));
  return (volume ?? []).map((v) => {
    const up = dirByTime.get(v.time);
    return {
      time: v.time,
      value: v.value,
      color: up === true
        ? 'rgba(38, 166, 154, 0.55)'
        : up === false
          ? 'rgba(239, 83, 80, 0.55)'
          : 'rgba(139, 143, 163, 0.35)'
    };
  });
}

function palette(light) {
  return {
    text: light ? '#5b6478' : '#8b8fa3',
    grid: light ? 'rgba(20,30,60,0.07)' : 'rgba(255,255,255,0.055)',
    border: light ? 'rgba(20,30,60,0.12)' : 'rgba(255,255,255,0.12)',
    crosshair: light ? 'rgba(20,30,60,0.4)' : 'rgba(255,255,255,0.4)',
    labelBg: light ? '#eef1f8' : '#181c26',
    labelText: light ? '#1b2436' : '#dfe4f2'
  };
}

/**
 * Draw the non-structural layers on whatever series set currently exists.
 * Called right after a rebuild and again on every overlay toggle, so the two
 * paths can never disagree about which layers are on.
 */
function applyOverlays(api, opts) {
  if (!api) return;
  const { overlays = {}, settings = {}, levels = [], fib = [] } = opts;

  const setVisible = (series, on) => {
    try {
      series?.applyOptions({ visible: Boolean(on) });
    } catch {
      /* a disposed series is a no-op, not a crash */
    }
  };

  for (const [period, series] of Object.entries(api.ma)) {
    setVisible(series, Boolean(overlays.ma?.[period]));
  }
  for (const [period, series] of Object.entries(api.ema)) {
    setVisible(series, Boolean(overlays.ema?.[period]));
  }
  setVisible(api.bb?.upper, overlays.bb);
  setVisible(api.bb?.middle, overlays.bb);
  setVisible(api.bb?.lower, overlays.bb);

  /* Fibonacci: rebuilt on every change because the levels move with the
     window, and a price line cannot be re-pointed. */
  for (const line of api.fibLines) {
    try { api.candle.removePriceLine(line); } catch { /* gone with the series */ }
  }
  api.fibLines = [];
  if (overlays.fib) {
    for (const level of fib) {
      try {
        api.fibLines.push(api.candle.createPriceLine({
          price: level.price,
          color: 'rgba(255, 179, 0, 0.55)',
          lineWidth: 1,
          lineStyle: api.LineStyle.Dashed,
          axisLabelVisible: true,
          title: `fib ${level.label}`
        }));
      } catch { /* out of scale */ }
    }
  }

  /* User price levels: same lifecycle as Fibonacci, different colour and a
     solid line — these are the levels the reader placed, not a formula. */
  for (const line of api.userLines) {
    try { api.candle.removePriceLine(line); } catch { /* noop */ }
  }
  api.userLines = [];
  for (const level of levels) {
    if (!Number.isFinite(level?.price)) continue;
    try {
      api.userLines.push(api.candle.createPriceLine({
        price: level.price,
        color: 'rgba(0, 229, 255, 0.8)',
        lineWidth: 1,
        lineStyle: api.LineStyle.Solid,
        axisLabelVisible: true,
        title: ''
      }));
    } catch { /* noop */ }
  }

  try {
    api.chart.applyOptions({
      grid: {
        vertLines: { visible: settings.grid !== false, color: api.colors.grid },
        horzLines: { visible: settings.grid !== false, color: api.colors.grid }
      },
      rightPriceScale: { mode: settings.log ? api.PriceScaleMode.Logarithmic : api.PriceScaleMode.Normal }
    });
  } catch { /* noop */ }
}

const ProChart = forwardRef(function ProChart(
  {
    candles,
    volume = [],
    rsiOn = false,
    macdOn = false,
    overlays = {},
    settings = {},
    levels = [],
    fib = [],
    locale,
    showPriceLine = true,
    onCrosshair,
    onChartClick,
    onWindowStats,
    onReady,
    onUnavailable,
    fallbackHeight = 190,
    dataKey = ''
  },
  ref
) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const propsRef = useRef(null);
  const rangeRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const light = useLightTheme();

  propsRef.current = { onCrosshair, onChartClick, onWindowStats, onReady, onUnavailable, showPriceLine, lights: light };

  useImperativeHandle(ref, () => ({
    fit() {
      const api = apiRef.current;
      if (!api) return;
      api.chart.timeScale().fitContent();
      emitStats(api);
    },
    zoom(factor) {
      const api = apiRef.current;
      if (!api) return;
      const ts = api.chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const center = (range.from + range.to) / 2;
      const half = Math.max(4, ((range.to - range.from) / 2) * factor);
      ts.setVisibleLogicalRange({ from: center - half, to: center + half });
    },
    screenshot() {
      try {
        return apiRef.current?.chart.takeScreenshot() ?? null;
      } catch {
        return null;
      }
    },
    priceAtY(y) {
      try {
        return apiRef.current?.candle.coordinateToPrice(y) ?? null;
      } catch {
        return null;
      }
    },
    timeAtX(x) {
      try {
        const ts = apiRef.current?.chart.timeScale();
        const logical = ts?.coordinateToLogical(x);
        const c = apiRef.current?.candles?.[Math.round(logical)];
        return c?.time ?? null;
      } catch {
        return null;
      }
    },
    visibleCandles() {
      const api = apiRef.current;
      if (!api) return [];
      const range = api.chart.timeScale().getVisibleLogicalRange();
      return candlesInLogicalRange(api.candles, range);
    },
    scrollToEnd() {
      try { apiRef.current?.chart.timeScale().scrollToRealTime(); } catch { /* noop */ }
    }
  }), []);

  /* Not a hook — a plain helper used by the imperative handle and the range
     subscription. Defined before use for clarity; it reads the refs. */
  function emitStats(api) {
    if (!api) return;
    try {
      const range = api.chart.timeScale().getVisibleLogicalRange();
      const slice = candlesInLogicalRange(api.candles, range);
      propsRef.current?.onWindowStats?.(windowStats(slice));
    } catch { /* noop */ }
  }

  useEffect(() => {
    let dead = false;
    let chart = null;
    let ro = null;

    const unavailable = () => {
      if (dead) return;
      setFailed(true);
      propsRef.current?.onUnavailable?.();
    };

    (async () => {
      try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof ResizeObserver === 'undefined') {
          throw new Error('CHART_ENV_UNSUPPORTED');
        }
        if (!hostRef.current || candles.length < 2) return;

        const lib = await import('lightweight-charts');
        if (dead || !hostRef.current || candles.length < 2) return;

        const {
          createChart,
          CandlestickSeries,
          LineSeries,
          HistogramSeries,
          CrosshairMode,
          LineStyle,
          PriceScaleMode,
          ColorType
        } = lib;

        const colors = palette(propsRef.current?.lights);
        const precision = pricePrecision(candles[candles.length - 1].close);
        const spacing = candleSpacingMs(candles);
        const host = hostRef.current;
        const width = Math.max(160, host.clientWidth || 320);
        const height = Math.max(120, host.clientHeight || 280);

        chart = createChart(host, {
          width,
          height,
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: colors.text,
            fontFamily: "'Inter', 'Vazirmatn', system-ui, sans-serif",
            fontSize: 10.5,
            attributionLogo: false
          },
          grid: {
            vertLines: { color: colors.grid },
            horzLines: { color: colors.grid }
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg, width: 1 },
            horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg, width: 1 }
          },
          rightPriceScale: {
            borderVisible: false,
            scaleMargins: { top: 0.08, bottom: 0.08 },
            entireTextOnly: true
          },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 4,
            barSpacing: 7,
            minBarSpacing: 0.5,
            shiftVisibleRangeOnNewBar: true
          },
          localization: { locale: locale || 'en-US' },
          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: false
          },
          kineticScroll: { touch: true, mouse: false },
          autoSize: false
        });

        const candle = chart.addSeries(CandlestickSeries, {
          upColor: UP,
          downColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
          borderVisible: false,
          priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision },
          priceLineVisible: propsRef.current?.showPriceLine !== false,
          priceLineStyle: LineStyle.Dotted,
          lastValueVisible: true
        });
        candle.setData(candles);
        candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

        const zone = (values, color, width = 1, style = LineStyle.Solid) => {
          const series = chart.addSeries(LineSeries, {
            color,
            lineWidth: width,
            lineStyle: style,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
          });
          series.setData(values ?? []);
          return series;
        };

        const ma = {};
        for (const period of [7, 25, 99]) {
          ma[period] = zone(simpleMovingAverage(candles, period), MA_COLORS[period], 1);
        }
        const ema = {};
        for (const period of [21, 55]) {
          ema[period] = zone(exponentialMovingAverage(candles, period), EMA_COLORS[period], 1, LineStyle.Dashed);
        }
        const bands = bollingerBands(candles, 20, 2);
        const bb = {
          upper: zone(bands.upper, BB_COLOR, 1, LineStyle.Solid),
          middle: zone(bands.middle, 'rgba(124, 77, 255, 0.45)', 1, LineStyle.Dotted),
          lower: zone(bands.lower, BB_COLOR, 1, LineStyle.Solid)
        };

        /* ---- panes (structural: their existence is why we rebuild) ---- */
        let paneIndex = 1;
        let volumeSeries = null;
        if (volume.length) {
          volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false
          }, paneIndex);
          volumeSeries.setData(volumeRows(volume, candles));
          volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.25, bottom: 0 } });
          try { chart.panes()[paneIndex]?.setStretchFactor(0.28); } catch { /* noop */ }
          paneIndex += 1;
        }

        let rsi = null;
        if (rsiOn) {
          rsi = chart.addSeries(LineSeries, {
            color: '#7c4dff',
            lineWidth: 1.5,
            priceLineVisible: false,
            lastValueVisible: true
          }, paneIndex);
          rsi.setData(relativeStrengthIndex(candles, 14));
          rsi.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
          for (const level of [70, 30]) {
            try {
              rsi.createPriceLine({
                price: level,
                color: 'rgba(139, 143, 163, 0.5)',
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: String(level)
              });
            } catch { /* noop */ }
          }
          try { chart.panes()[paneIndex]?.setStretchFactor(0.24); } catch { /* noop */ }
          paneIndex += 1;
        }

        let macd = null;
        if (macdOn) {
          const components = macdSeries(candles, 12, 26, 9);
          const hist = chart.addSeries(HistogramSeries, {
            priceLineVisible: false,
            lastValueVisible: false
          }, paneIndex);
          hist.setData(components.histogram);
          const line = chart.addSeries(LineSeries, {
            color: '#00bcd4',
            lineWidth: 1.5,
            priceLineVisible: false,
            lastValueVisible: false
          }, paneIndex);
          line.setData(components.macd);
          const signal = chart.addSeries(LineSeries, {
            color: '#ff9800',
            lineWidth: 1.5,
            priceLineVisible: false,
            lastValueVisible: false
          }, paneIndex);
          signal.setData(components.signal);
          try { chart.panes()[paneIndex]?.setStretchFactor(0.26); } catch { /* noop */ }
          macd = { hist, line, signal };
          paneIndex += 1;
        }

        const api = {
          chart,
          candle,
          ma,
          ema,
          bb,
          rsi,
          macd,
          volumeSeries,
          colors,
          candles,
          LineStyle,
          PriceScaleMode,
          fibLines: [],
          userLines: []
        };
        apiRef.current = api;

        applyOverlays(api, { overlays, settings, levels, fib });

        /*
         * Crosshair read-out is throttled to one React update per frame.
         * The library emits on every pointer move — a fast drag on a phone
         * is 120 events a second, and re-rendering the legend (and the
         * whole card around it) at that rate is how a chart starts to feel
         * like it is fighting the finger.
         */
        let crossFrame = 0;
        const scheduleCrosshair = (payload) => {
          if (dead) return;
          if (crossFrame) return;
          const run = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn) => setTimeout(fn, 16);
          crossFrame = run(() => {
            crossFrame = 0;
            propsRef.current?.onCrosshair?.(payload);
          });
        };

        chart.subscribeCrosshairMove((param) => {
          if (dead) return;
          const bar = param?.seriesData?.get(candle);
          if (!param?.point || !bar) {
            scheduleCrosshair(null);
            return;
          }
          scheduleCrosshair({
            time: param.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: api.volumeSeries ? param.seriesData.get(api.volumeSeries)?.value ?? null : null,
            x: param.point.x,
            y: param.point.y
          });
        });

        chart.subscribeClick((param) => {
          if (dead || !param?.point) return;
          let price = null;
          try { price = candle.coordinateToPrice(param.point.y); } catch { /* outside the scale */ }
          propsRef.current?.onChartClick?.({
            price,
            time: param.time ?? null,
            x: param.point.x,
            y: param.point.y
          });
        });

        let statsFrame = 0;
        const scheduleStats = () => {
          if (dead || statsFrame) return;
          const run = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn) => setTimeout(fn, 16);
          statsFrame = run(() => {
            statsFrame = 0;
            emitStats(api);
          });
        };

        chart.subscribeVisibleLogicalRangeChange((range) => {
          if (dead) return;
          rangeRef.current = range;
          scheduleStats();
        });

        chart.timeScale().fitContent();
        if (rangeRef.current) {
          try { chart.timeScale().setVisibleLogicalRange(rangeRef.current); } catch { /* noop */ }
        }
        emitStats(api);

        ro = new ResizeObserver(() => {
          if (dead || !hostRef.current || !chart) return;
          const w = Math.max(160, hostRef.current.clientWidth || width);
          const h = Math.max(120, hostRef.current.clientHeight || height);
          try { chart.applyOptions({ width: w, height: h }); } catch { /* noop */ }
        });
        ro.observe(host);

        propsRef.current?.onReady?.(api);
      } catch {
        unavailable();
      }
    })();

    return () => {
      dead = true;
      try { ro?.disconnect(); } catch { /* noop */ }
      try { chart?.remove(); } catch { /* noop */ }
      apiRef.current = null;
    };
    // Rebuild only when the data or the structural pane set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, candles, rsiOn, macdOn, volume.length > 0, locale]);

  /* Overlay toggles ride on the live series: no rebuild, no lost zoom. */
  useEffect(() => {
    applyOverlays(apiRef.current, { overlays, settings, levels, fib });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, settings, levels, fib]);

  /* A volume poll that brings new readings updates the pane in place — the
     pane's EXISTENCE does not change, so nothing needs rebuilding. */
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.volumeSeries) return;
    try {
      api.volumeSeries.setData(volumeRows(volume, api.candles));
    } catch { /* noop */ }
  }, [volume]);

  /* Theme switch without a rebuild — colours are pure options. */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const colors = palette(light);
    api.colors = colors;
    try {
      api.chart.applyOptions({
        layout: { textColor: colors.text },
        grid: {
          vertLines: { color: colors.grid },
          horzLines: { color: colors.grid }
        },
        crosshair: {
          vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
          horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg }
        }
      });
    } catch { /* noop */ }
  }, [light]);

  if (failed) {
    /*
     * The SVG fallback keeps its own height because it cannot measure the
     * stage the way the engine's ResizeObserver does. A 190px chart inside a
     * full-screen terminal would be a stamp in the corner of an empty room,
     * so the caller passes the height it is actually filling.
     */
    return (
      <CandleChart
        data={candles.map((c) => ({ t: c.time * 1000, o: c.open, h: c.high, l: c.low, c: c.close }))}
        height={fallbackHeight}
      />
    );
  }

  return <div ref={hostRef} className="pc-canvas" data-testid="pro-chart-canvas" />;
});

export default ProChart;
