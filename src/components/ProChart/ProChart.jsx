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
 * that turns a candle array into a real terminal: candles (or line / area),
 * moving averages, Bollinger bands, a volume pane, an RSI pane, a MACD pane,
 * Fibonacci levels, user price levels, log scale, crosshair read-out,
 * screen-visible stats, double-tap zoom and a LIVE last candle that ticks
 * with the spot price between OHLC polls.
 *
 * ─── THE BUG THAT KILLED THE TERMINAL (2026-11-01, user report) ─────────────
 * «نمودار شمعی وقتی می‌زنی که افقی بشه و باز بشه، هیچکدام دکمه‌ها داخلش کار
 * نمیده… دوبار ضربه، زوم، و نوع نمودار و بازه قیمتی… تازه تصویر هم میگه
 * مرورگر پشتیبانی نمیکنه»
 *
 * Root cause, reproduced against the real library in
 * test/pro-chart-engine.test.jsx: the build called
 * `chart.subscribeVisibleLogicalRangeChange(...)`. That method does not exist
 * on the chart API — it lives on the TIME SCALE
 * (`chart.timeScale().subscribeVisibleLogicalRangeChange`). The TypeError
 * landed mid-build, the catch marked the engine "unsupported", and the
 * component silently swapped in the static SVG fallback. Every symptom the
 * user listed follows from that one line: an SVG picture has no zoom, no
 * pinch, no crosshair; the toolbar toggled React state against a chart API
 * that was never finished, so MA/RSI/MACD/log/grid appeared dead; zoom/fit
 * acted on a detached canvas; and "PNG" answered «در این مرورگر ساخت تصویر
 * ممکن نشد» because there was no engine to screenshot. The inline card looked
 * deceptively fine (the fallback draws candles too), which is why only the
 * full-screen terminal — the place with buttons — read as "everything is
 * broken".
 *
 * Two structural lessons are baked in below so this class of bug cannot hide
 * again: (1) a mount failure is LOGGED (console.warn with the real error),
 * never swallowed silently; (2) the host element stays mounted under the
 * fallback, so a later rebuild can retry the engine instead of being stuck
 * on the picture forever.
 *
 * ─── WHY THE SERIES SET IS REBUILT, NOT PATCHED ─────────────────────────────
 * Panes are structural in lightweight-charts: a pane that exists takes
 * vertical space whether or not anything is drawn in it, and there is no
 * supported way to remove one. So enabling volume / RSI / MACD (or switching
 * candles→line→area) rebuilds the chart; every other toggle (MA, EMA, bands,
 * Fibonacci, levels, log scale, grid) is applied to the live series with
 * `applyOptions`, which is instant and does not lose the zoom. Rebuilding
 * would normally lose the user's pan and zoom, so the visible logical range
 * is captured before every rebuild and re-applied afterwards — but ONLY for
 * a rebuild under the same data key. A new coin or timeframe fits its own
 * content instead of inheriting last view's bar indices.
 *
 * ─── LIVE DATA WITHOUT REBUILDS ─────────────────────────────────────────────
 * A fresh OHLC poll used to rebuild the whole chart (the data key contained
 * the last close), so the "live" chart flickered and re-fit once a minute.
 * Now the build is keyed only by structure (coin + timeframe + panes + chart
 * type + locale) and new candles are reconciled in place: `series.update()`
 * from the first changed bar, indicators re-set from the same math module,
 * view untouched. Between polls, a `livePrice` spot tick (the caller polls
 * /api/prices, 20s TTL) moves the forming candle's close — and its high/low
 * when the tick exceeds them — exactly like a real terminal. No number is
 * invented: the tick IS the feed's spot price, sanity-banded against the
 * last close so a wrong-id or wrong-currency answer cannot spike the chart.
 *
 * ─── WHY THE FALLBACK IS THE RECHARTS CANDLE ────────────────────────────────
 * `createChart` needs matchMedia and ResizeObserver, and it measures a real
 * canvas. A stripped WebView, an SSR pass or a test DOM can lack those, and a
 * throwing chart constructor must not take the coin page down with it. If the
 * engine cannot mount, the reader still gets candles from the SVG fallback
 * instead of an error — and the host stays mounted underneath so a rebuild
 * can bring the real engine back.
 */

const UP = '#26a69a';
const DOWN = '#ef5350';
const MA_COLORS = { 7: '#00e5ff', 25: '#ff9800', 99: '#ab47bc' };
const EMA_COLORS = { 21: '#4fc3f7', 55: '#ffd54f' };
const BB_COLOR = 'rgba(124, 77, 255, 0.85)';
const LINE_COLOR = '#00b8d9';

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

/** One bar in the shape the MAIN series type eats. */
function mainBar(chartType, candle) {
  return chartType === 'candles'
    ? candle
    : { time: candle.time, value: candle.close };
}

function mainData(chartType, candles) {
  return chartType === 'candles' ? candles : candles.map((c) => ({ time: c.time, value: c.close }));
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
    try { api.main.removePriceLine(line); } catch { /* gone with the series */ }
  }
  api.fibLines = [];
  if (overlays.fib) {
    for (const level of fib) {
      try {
        api.fibLines.push(api.main.createPriceLine({
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
    try { api.main.removePriceLine(line); } catch { /* noop */ }
  }
  api.userLines = [];
  for (const level of levels) {
    if (!Number.isFinite(level?.price)) continue;
    try {
      api.userLines.push(api.main.createPriceLine({
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

/** Recompute every derived series from a candle array and push it in place. */
function syncDerived(api, candles, volume) {
  const safe = (fn) => { try { fn(); } catch { /* disposed mid-sync */ } };
  for (const period of [7, 25, 99]) {
    if (api.ma?.[period]) safe(() => api.ma[period].setData(simpleMovingAverage(candles, period)));
  }
  for (const period of [21, 55]) {
    if (api.ema?.[period]) safe(() => api.ema[period].setData(exponentialMovingAverage(candles, period)));
  }
  if (api.bb?.upper) {
    const bands = bollingerBands(candles, 20, 2);
    safe(() => api.bb.upper.setData(bands.upper));
    safe(() => api.bb.middle.setData(bands.middle));
    safe(() => api.bb.lower.setData(bands.lower));
  }
  if (api.rsi) safe(() => api.rsi.setData(relativeStrengthIndex(candles, 14)));
  if (api.macd) {
    const components = macdSeries(candles, 12, 26, 9);
    safe(() => api.macd.hist.setData(components.histogram));
    safe(() => api.macd.line.setData(components.macd));
    safe(() => api.macd.signal.setData(components.signal));
  }
  if (api.volumeSeries && Array.isArray(volume)) {
    safe(() => api.volumeSeries.setData(volumeRows(volume, candles)));
  }
}

/**
 * Reconcile a fresh candle array into the LIVE chart — the live-poll path.
 *
 * `series.update()` can only touch the last bar or append newer ones, so the
 * normal poll (last close moved, maybe a new bar appended) is applied bar by
 * bar and the reader's zoom never moves. Anything stranger — a revised
 * historical bar, a shorter series, a different first timestamp — falls back
 * to a full setData with the visible range re-applied from the saved ref.
 */
function syncCandles(api, candles, volume, rangeRef) {
  if (!api || !Array.isArray(candles) || candles.length < 2) return;
  const prev = api.candles ?? [];
  api.liveBar = null; // the poll owns the last bar now; ticks re-accumulate

  let firstDiff = -1;
  const shared = Math.min(prev.length, candles.length);
  for (let i = 0; i < shared; i++) {
    const a = prev[i];
    const b = candles[i];
    if (a.time !== b.time || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff === -1 && candles.length > prev.length) firstDiff = prev.length;

  const fullReset =
    !prev.length ||
    candles.length < prev.length ||
    (firstDiff !== -1 && firstDiff <= prev.length - 2);

  try {
    if (fullReset) {
      api.main.setData(mainData(api.chartType, candles));
      const range = rangeRef?.current;
      if (range) {
        try { api.chart.timeScale().setVisibleLogicalRange(range); } catch { /* out of bounds on a shorter series */ }
      }
    } else if (firstDiff !== -1) {
      for (let i = firstDiff; i < candles.length; i++) {
        api.main.update(mainBar(api.chartType, candles[i]));
      }
    }
  } catch {
    /* An update the library rejects (e.g. a revised timestamp) must degrade
       to a full replace, never to a dead chart. */
    try { api.main.setData(mainData(api.chartType, candles)); } catch { /* noop */ }
  }

  api.candles = candles;
  api.byTime = new Map(candles.map((c) => [c.time, c]));
  if (firstDiff !== -1 || fullReset) syncDerived(api, candles, volume);
}

const ProChart = forwardRef(function ProChart(
  {
    candles,
    volume = [],
    chartType = 'candles',
    livePrice = null,
    doubleTapZoom = true,
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
  const candlesRef = useRef(candles);
  const volumeRef = useRef(volume);
  const buildKeyRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const light = useLightTheme();

  candlesRef.current = candles;
  volumeRef.current = volume;
  propsRef.current = { onCrosshair, onChartClick, onWindowStats, onReady, onUnavailable, showPriceLine, doubleTapZoom, lights: light };

  /* Double-click / double-tap: dive toward the tapped point, or back out to
     the whole range when already zoomed in. Also exposed imperatively. */
  function toggleZoomAt(clientX) {
    const api = apiRef.current;
    if (!api) return;
    try {
      const ts = api.chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      const total = api.candles?.length ?? 0;
      if (!range || !total) return;
      const visible = range.to - range.from;
      if (visible <= total * 0.45) {
        ts.fitContent();
        return;
      }
      let center = (range.from + range.to) / 2;
      if (Number.isFinite(clientX)) {
        const logical = ts.coordinateToLogical(clientX);
        if (Number.isFinite(logical)) center = logical;
      }
      const half = Math.max(5, visible * 0.21);
      ts.setVisibleLogicalRange({ from: center - half, to: center + half });
    } catch { /* noop */ }
  }

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
      /* Anchor on the RIGHT (latest) side two-thirds toward the end: on a
         price chart the reader is almost always zooming into "now", and a
         centre-anchored zoom walks away from the live candle. */
      const center = range.from + (range.to - range.from) * 0.68;
      const half = Math.max(4, ((range.to - range.from) / 2) * factor);
      ts.setVisibleLogicalRange({ from: center - half, to: center + half });
    },
    toggleZoom(x) {
      toggleZoomAt(x);
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
        return apiRef.current?.main.coordinateToPrice(y) ?? null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    let hostEl = null;
    let onTouchEnd = null;

    const unavailable = (err) => {
      if (dead) return;
      /* NEVER swallow a mount failure silently again: the November 2026
         terminal shipped dead for every user because this catch hid a
         TypeError. A console warning costs nothing and makes the next
         API misuse a one-minute diagnosis instead of a user report. */
      // eslint-disable-next-line no-console
      console.warn('[ProChart] chart engine unavailable, using SVG fallback:', err);
      try { chart?.remove(); } catch { /* noop */ }
      chart = null;
      apiRef.current = null;
      setFailed(true);
      propsRef.current?.onUnavailable?.();
    };

    (async () => {
      try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof ResizeObserver === 'undefined') {
          throw new Error('CHART_ENV_UNSUPPORTED');
        }
        const initial = candlesRef.current ?? [];
        if (!hostRef.current || initial.length < 2) return;

        const lib = await import('lightweight-charts');
        const current = candlesRef.current ?? [];
        if (dead || !hostRef.current || current.length < 2) return;

        const {
          createChart,
          CandlestickSeries,
          LineSeries,
          AreaSeries,
          HistogramSeries,
          CrosshairMode,
          LineStyle,
          PriceScaleMode,
          ColorType
        } = lib;

        const colors = palette(propsRef.current?.lights);
        const precision = pricePrecision(current[current.length - 1].close);
        const host = hostRef.current;
        hostEl = host;
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

        /* ---- main series: candles / line / area off the same closes ---- */
        const priceFormat = { type: 'price', precision, minMove: 1 / 10 ** precision };
        let main;
        if (chartType === 'line') {
          main = chart.addSeries(LineSeries, {
            color: LINE_COLOR,
            lineWidth: 2,
            priceFormat,
            priceLineVisible: propsRef.current?.showPriceLine !== false,
            priceLineStyle: LineStyle.Dotted,
            lastValueVisible: true,
            crosshairMarkerRadius: 3.5
          });
        } else if (chartType === 'area') {
          main = chart.addSeries(AreaSeries, {
            lineColor: LINE_COLOR,
            lineWidth: 2,
            topColor: 'rgba(0, 184, 217, 0.32)',
            bottomColor: 'rgba(0, 184, 217, 0.02)',
            priceFormat,
            priceLineVisible: propsRef.current?.showPriceLine !== false,
            priceLineStyle: LineStyle.Dotted,
            lastValueVisible: true,
            crosshairMarkerRadius: 3.5
          });
        } else {
          main = chart.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            borderVisible: false,
            priceFormat,
            priceLineVisible: propsRef.current?.showPriceLine !== false,
            priceLineStyle: LineStyle.Dotted,
            lastValueVisible: true
          });
        }
        main.setData(mainData(chartType, current));
        main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

        const zone = (values, color, w = 1, style = LineStyle.Solid) => {
          const series = chart.addSeries(LineSeries, {
            color,
            lineWidth: w,
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
          ma[period] = zone(simpleMovingAverage(current, period), MA_COLORS[period], 1);
        }
        const ema = {};
        for (const period of [21, 55]) {
          ema[period] = zone(exponentialMovingAverage(current, period), EMA_COLORS[period], 1, LineStyle.Dashed);
        }
        const bands = bollingerBands(current, 20, 2);
        const bb = {
          upper: zone(bands.upper, BB_COLOR, 1, LineStyle.Solid),
          middle: zone(bands.middle, 'rgba(124, 77, 255, 0.45)', 1, LineStyle.Dotted),
          lower: zone(bands.lower, BB_COLOR, 1, LineStyle.Solid)
        };

        /* ---- panes (structural: their existence is why we rebuild) ---- */
        const vol = volumeRef.current ?? [];
        let paneIndex = 1;
        let volumeSeries = null;
        if (vol.length) {
          volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false
          }, paneIndex);
          volumeSeries.setData(volumeRows(vol, current));
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
          rsi.setData(relativeStrengthIndex(current, 14));
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
          const components = macdSeries(current, 12, 26, 9);
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
          main,
          /* Back-compat alias: older helpers called the main series `candle`. */
          candle: main,
          chartType,
          ma,
          ema,
          bb,
          rsi,
          macd,
          volumeSeries,
          colors,
          candles: current,
          byTime: new Map(current.map((c) => [c.time, c])),
          liveBar: null,
          spacingMs: candleSpacingMs(current),
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
          /* Read OHLC from our own candle map, not from seriesData: in
             line/area mode the series only knows closes, and the legend
             must still show the bar's real open/high/low. */
          const bar = param?.time != null ? api.byTime.get(param.time) : null;
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
          try { price = main.coordinateToPrice(param.point.y); } catch { /* outside the scale */ }
          propsRef.current?.onChartClick?.({
            price,
            time: param.time ?? null,
            x: param.point.x,
            y: param.point.y
          });
        });

        /* Double-click (mouse) — zoom toward the point / back out. */
        try {
          chart.subscribeDblClick((param) => {
            if (dead || propsRef.current?.doubleTapZoom === false) return;
            toggleZoomAt(param?.point?.x);
          });
        } catch { /* older builds without dblclick: touch path below still works */ }

        /* Double-TAP (touch): lightweight-charts' dblclick is a mouse
           event, so phones need their own detector. Single-finger taps
           only, tight time/distance window, passive listener — it never
           fights pinch (two touches) or pan (a moving touch). */
        let lastTap = null;
        onTouchEnd = (event) => {
          if (dead || propsRef.current?.doubleTapZoom === false) return;
          const touch = event.changedTouches?.[0];
          if (!touch || (event.touches && event.touches.length > 0)) return;
          const now = Date.now();
          const rect = host.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          if (lastTap && now - lastTap.t < 330 && Math.hypot(x - lastTap.x, y - lastTap.y) < 48) {
            lastTap = null;
            toggleZoomAt(x);
          } else {
            lastTap = { t: now, x, y };
          }
        };
        host.addEventListener('touchend', onTouchEnd, { passive: true });

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

        /*
         * ⚠️ THE FIX: visible-range events live on the TIME SCALE, not on
         * the chart. Calling this on `chart` threw TypeError mid-build and
         * the (then silent) catch replaced the whole terminal with the
         * static fallback — every button dead. Pinned by
         * test/pro-chart-engine.test.jsx against the real library.
         */
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (dead) return;
          rangeRef.current = range;
          scheduleStats();
        });

        /* Restore the reader's view across a STRUCTURAL rebuild (pane or
           chart-type change: same data key). A new coin/timeframe (new key)
           fits its own content — last view's bar indices mean nothing there. */
        chart.timeScale().fitContent();
        if (buildKeyRef.current === dataKey && rangeRef.current) {
          try { chart.timeScale().setVisibleLogicalRange(rangeRef.current); } catch { /* noop */ }
        }
        buildKeyRef.current = dataKey;
        emitStats(api);

        ro = new ResizeObserver(() => {
          if (dead || !hostRef.current || !chart) return;
          const w = Math.max(160, hostRef.current.clientWidth || width);
          const h = Math.max(120, hostRef.current.clientHeight || height);
          try { chart.applyOptions({ width: w, height: h }); } catch { /* noop */ }
        });
        ro.observe(host);

        setFailed(false);
        propsRef.current?.onReady?.(api);
      } catch (err) {
        unavailable(err);
      }
    })();

    return () => {
      dead = true;
      try { ro?.disconnect(); } catch { /* noop */ }
      try { if (hostEl && onTouchEnd) hostEl.removeEventListener('touchend', onTouchEnd); } catch { /* noop */ }
      try { chart?.remove(); } catch { /* noop */ }
      apiRef.current = null;
    };
    // Rebuild only when the STRUCTURE changes (coin/timeframe via dataKey,
    // chart type, pane set, locale). Candle updates sync in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, chartType, rsiOn, macdOn, volume.length > 0, locale]);

  /* Live poll data: reconcile into the running chart — no rebuild, no
     flicker, zoom preserved. Runs after the build effect on first mount
     (api still null → the build reads candlesRef, which is already freshest). */
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    syncCandles(api, candles, volumeRef.current, rangeRef);
    emitStats(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  /* Spot-price tick: move the FORMING candle between OHLC polls. High/low
     only ever widen (a tick is a real traded price inside this bar), and the
     accumulated live bar is discarded the moment a real poll lands. */
  useEffect(() => {
    const api = apiRef.current;
    const price = Number(livePrice);
    if (!api || !Number.isFinite(price) || price <= 0) return;
    const last = api.candles?.[api.candles.length - 1];
    if (!last) return;
    /* Sanity band: a tick >30% away from the last close is a wrong-asset or
       wrong-currency answer, not a market move we should draw. */
    if (last.close > 0 && Math.abs(price / last.close - 1) > 0.3) return;
    const base = api.liveBar && api.liveBar.time === last.time ? api.liveBar : last;
    if (price === base.close && base === api.liveBar) return;
    const tick = {
      time: last.time,
      open: last.open,
      high: Math.max(base.high, price),
      low: Math.min(base.low, price),
      close: price
    };
    api.liveBar = tick;
    try {
      api.main.update(mainBar(api.chartType, tick));
    } catch { /* a poll landed mid-tick; the next tick re-bases */ }
  }, [livePrice]);

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

  /*
   * The host stays MOUNTED even while the fallback shows: if a transient
   * failure (a chunk that failed to load once) put us on the picture, the
   * next structural rebuild must still find a host to retry the engine in.
   * Previously the fallback REPLACED the host, so one failure was forever.
   */
  return (
    <>
      <div
        ref={hostRef}
        className="pc-canvas"
        data-testid="pro-chart-canvas"
        style={failed ? { visibility: 'hidden' } : undefined}
        aria-hidden={failed || undefined}
      />
      {failed ? (
        <div className="pc-canvas pc-canvas--fallback" data-testid="pro-chart-fallback">
          <CandleChart
            data={candles.map((c) => ({ t: c.time * 1000, o: c.open, h: c.high, l: c.low, c: c.close }))}
            height={fallbackHeight}
          />
        </div>
      ) : null}
    </>
  );
});

export default ProChart;
