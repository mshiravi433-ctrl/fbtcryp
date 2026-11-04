/**
 * GuideChart — THE TEACHING CHART
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── WHY THIS EXISTS INSTEAD OF REUSING `ProChart` ─────────────────────────
 * The first version of this screen mounted `ProChart`, the real terminal
 * engine. It was the right instinct — teach with the thing the user meets —
 * and it failed on the actual device for three reasons that are all visible to
 * a reader as "the buttons don't work":
 *
 *   1. THE ENGINE IS ASYNC AND CAN BE ABSENT. `ProChart` imports
 *      `lightweight-charts` lazily and requires `matchMedia` + `ResizeObserver`.
 *      Until that promise settles there is no chart at all, and on the
 *      embedded WebView, in a saved image, or behind a blocked chunk there
 *      never is one. Its fallback is a recharts canvas that takes no props, so
 *      every toolbar chip in the guide became a button wired to nothing.
 *
 *   2. MOST OF WHAT THE GUIDE TEACHES IS A *CONTROL*, and the engine's chips
 *      are internal state: pressing MA7 in the guide toggled a flag the guide
 *      could not show, because the real toolbar was not on the page.
 *
 *   3. IT COULD NOT TEACH. A tutorial needs to LIGHT THINGS UP — circle the
 *      toolbar, point at the price of one bar, show the gap between two moving
 *      averages. The engine renders an opaque canvas; there is nothing to
 *      annotate.
 *
 * So the guide draws its own chart, in SVG, with the arithmetic that
 * `lib/proChartMath.js` already ships and the same theme colours the terminal
 * uses. Everything below is synchronous, controllable and annotatable, and
 * every button on the screen changes something you can see.
 *
 * ─── WHAT IS *NOT* REIMPLEMENTED ───────────────────────────────────────────
 * No indicator is computed here. `simpleMovingAverage`,
 * `exponentialMovingAverage`, `bollingerBands`, `relativeStrengthIndex`,
 * `macdSeries` and `fibLevels` come from `proChartMath` — the same functions
 * the live terminal uses — so the guide cannot quietly teach a different RSI
 * from the one on the token page.
 *
 * ─── THE PRICE SERIES IS PRACTICE DATA ─────────────────────────────────────
 * A seeded walk, fixed epoch, deterministic. The banner above the chart says
 * so in the reader's own language before the first pixel is drawn.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsRtl } from './Shared';
import {
  bollingerBands,
  exponentialMovingAverage,
  fibLevels,
  macdSeries,
  relativeStrengthIndex,
  simpleMovingAverage
} from '../../lib/proChartMath';
import { resolveTheme, useSettingsStore } from '../../store/useSettingsStore';

/* ── geometry ─────────────────────────────────────────────────────────────── */
/* One coordinate system for every pane, so an annotation placed in "price
   space" lands on the same pixel the candles do. `VB` is the viewBox, not a
   pixel size: the SVG scales to its container and the text scales with it,
   which is what keeps the labels legible on a 360px phone without a second
   layout pass. */
/* ONE VIEWBOX UNIT = ONE CSS PIXEL.
 *
 * The first version used a 720×360 box stretched to the container. It looked
 * right on a monitor and was illegible on the device this app actually runs
 * on: a 330px-wide phone scaled the whole drawing by 0.46, so a "9.5px" axis
 * label was painted at 4.4px and an 8px pane caption at 3.7px. Proportions
 * survived; the text did not. Drawing in a 360-unit-wide box and letting it
 * scale with height means the labels are the size they say they are. */
const VB_W = 360;
const VB_H = 260;
const PAD = { top: 10, right: 58, bottom: 16, left: 6 };
/* Width of the filled pill that names the current price. It sits at the far
   right of the gutter; the MA/EMA tags stop short of it. */
const PRICE_PILL_W = 34;

/* Pane edges are DERIVED, not hard-coded.
 *
 * The first version fixed the price pane at 16–232 and then carved the volume
 * (246–292) and sub-pane (306–340) panes out of the same 360-unit box whatever
 * the reader switched on. With no volume and no RSI — the default — half the
 * canvas was empty, and with both there was 34 units of vertical space for an
 * RSI line, which rendered as a smear. `layout()` gives the price pane
 * everything that is left after the panes that are actually on screen, so the
 * chart is dense when it is simple and honest when it is crowded. */
const VOL_H = 34;
const SUB_H = 44;
const PANE_GAP = 8;

function layout(panes = {}) {
  const volOn = Boolean(panes.volume);
  const subOn = Boolean(panes.rsi || panes.macd);
  const below = (volOn ? VOL_H + PANE_GAP : 0) + (subOn ? SUB_H + PANE_GAP : 0);
  const mainBottom = VB_H - PAD.bottom - below;
  const vol = volOn ? { top: mainBottom + PANE_GAP, bottom: mainBottom + PANE_GAP + VOL_H } : null;
  const subTop = (vol ? vol.bottom : mainBottom) + PANE_GAP;
  const sub = subOn ? { top: subTop, bottom: subTop + SUB_H } : null;
  return { mainTop: PAD.top, mainBottom, vol, sub };
}

/* ── theme ────────────────────────────────────────────────────────────────── */
/* Mirrors `THEME_COLORS` in ProChart: the same two hues for up/down, the same
   MA/EMA/BB palette. A guide whose colours disagree with the terminal teaches
   a reader to look for the wrong line. */
const COLORS = {
  dark: {
    up: '#26a69a',
    down: '#ef5350',
    upFill: 'rgba(38, 166, 154, 0.9)',
    downFill: 'rgba(239, 83, 80, 0.9)',
    ma: { 7: '#00e5ff', 25: '#ff9800', 99: '#ab47bc' },
    ema: { 21: '#4fc3f7', 55: '#ffd54f' },
    bb: 'rgba(124, 77, 255, 0.85)',
    bbFill: 'rgba(124, 77, 255, 0.10)',
    rsi: '#7c4dff',
    macdLine: '#00bcd4',
    macdSignal: '#ff9800',
    fib: 'rgba(255, 179, 0, 0.62)',
    grid: 'rgba(255, 255, 255, 0.055)',
    axis: 'rgba(255, 255, 255, 0.30)',
    text: 'rgba(226, 232, 240, 0.82)',
    textDim: 'rgba(148, 163, 184, 0.75)',
    crosshair: 'rgba(0, 229, 255, 0.55)',
    marker: '#00e5ff',
    measure: '#00e5ff',
    legendBg: '#05060d'
  },
  light: {
    up: '#0f8f7f',
    down: '#d23a4e',
    /* Solid, not alpha. Light-theme bodies at 0.92 over a #f8fbfe stage came
       out as a pale mint and pink that read as "disabled" — the exact opposite
       of what a candle body is telling the reader. */
    upFill: '#0f8f7f',
    downFill: '#d23a4e',
    ma: { 7: '#007b8f', 25: '#b8650a', 99: '#7b3fbf' },
    ema: { 21: '#1a6fb5', 55: '#9a6c00' },
    bb: 'rgba(94, 53, 177, 0.75)',
    bbFill: 'rgba(94, 53, 177, 0.055)',
    rsi: '#6a3ae0',
    macdLine: '#00707e',
    macdSignal: '#b8650a',
    fib: 'rgba(157, 110, 0, 0.7)',
    grid: 'rgba(24, 42, 74, 0.07)',
    axis: 'rgba(24, 42, 74, 0.32)',
    text: '#334155',
    textDim: '#64748b',
    crosshair: 'rgba(0, 115, 145, 0.55)',
    marker: '#0075a8',
    measure: '#0075a8',
    legendBg: '#f8fbfe'
  }
};

/* ── the practice walk ────────────────────────────────────────────────────── */
const EPOCH = Date.UTC(2024, 0, 1, 0, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* The practice asset oscillates around 100 and ALWAYS HAS.
 *
 * The first version compounded a positive drift onto itself for 180 bars and
 * the price crawled 100 → 342, which is a five-week trending market with no
 * pullbacks. Every candle body collapsed to sub-pixel height against a 242-unit
 * y-range and the chart rendered as a flat speckled line: a reader cannot learn
 * what a body is from a screenshot where no body exists. So the walk is
 * mean-reverting — the drift is a pull back toward `start` — and the three
 * harmonics are scaled so a bar is worth roughly 1% of price. That gives swings
 * big enough to see and small enough that the axis labels stay meaningful. */
export function makeWalk({ seed = 7, bars = 1440, start = 100 } = {}) {
  let s = seed | 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
  const out = [];
  let price = start;
  for (let i = 0; i < bars; i++) {
    /* FOUR incommensurate cycles — 4h, 11h, 27h and 63h — plus noise.
       Three harmonics that happened to be near-multiples of each other
       (4.2 / 11.7 / 29.5 ≈ 1 : 2.8 : 7) beat into a nearly perfect sine wave,
       and the first render of this chart looked like a signal generator, not a
       market. Irrational ratios and a long, low-amplitude fourth term break the
       beat pattern into something with genuine irregularity, which is what makes
       "the average lags the price" visible instead of decorative. */
    const wave =
      Math.sin(i / 4.3) * 0.42 +
      Math.sin(i / 10.9 + 1.1) * 0.34 +
      Math.sin(i / 27.3 + 0.4) * 0.46 +
      Math.sin(i / 63.1 + 2.2) * 0.5;
    /* Pull toward `start`, gently — 2% of the distance per bar. This is what
       stops the compounding: without it the harmonic drift integrates into a
       trend, which is exactly the bug described above. */
    const revert = (start - price) * 0.02;
    const noise = (rnd() - 0.5) * 0.55;
    const open = price;
    const close = Math.max(2, open + wave + revert + noise);
    const high = Math.max(open, close) + Math.abs(rnd() - 0.42) * 0.5;
    const low = Math.min(open, close) - Math.abs(rnd() - 0.58) * 0.5;
    out.push({
      time: Math.floor((EPOCH + i * HOUR) / 1000),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +Math.max(1, low).toFixed(2),
      close: +close.toFixed(2),
      volume: Math.round(900 + rnd() * 5200)
    });
    price = close;
  }
  return out;
}

/** One series for the whole session — two chapters must never disagree. */
const WALK = makeWalk();
const CANDLES = WALK.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
const VOLUME = Object.fromEntries(WALK.map((c) => [c.time, c.volume]));

/**
 * How many bars a window shows, and how long each one lasts.
 *
 * THE SECOND VERSION'S BIGGEST SUBTRACTION. The first version mapped 7D, 30D,
 * 90D and 1Y onto the same 180 hourly bars, so four of the five range chips
 * drew the identical picture — and the guide's own copy promises the opposite:
 * "each button sets how much time the chart covers; how long one candle lasts
 * follows from that". A control that changes nothing is the defect this round
 * exists to fix, so the walk is 60 days of hourly bars and each range AGGREGATES
 * it into candles of the matching duration. 1D is 60 hourly bars; 1Y is 60
 * weekly candles off the same sixty days of history.
 */
const RANGE_BARS = { '1D': 60, '7D': 60, '30D': 60, '90D': 60, '1Y': 60 };
const RANGE_HOURS = { '1D': 1, '7D': 4, '30D': 12, '90D': 24, '1Y': 24 };

/**
 * Collapse the hourly walk into candles of `hours` each.
 *
 * Open is the first open in the bucket, close the last close, high/low the
 * extremes, volume the sum — the standard OHLC aggregation, done here so the
 * guide shows one continuous history at every zoom rather than five unrelated
 * random walks.
 */
export function aggregate(candles, hours = 1) {
  if (hours <= 1) return candles;
  const out = [];
  for (let i = 0; i < candles.length; i += hours) {
    const slice = candles.slice(i, i + hours);
    if (!slice.length) break;
    out.push({
      time: slice[0].time,
      open: slice[0].open,
      close: slice[slice.length - 1].close,
      high: Math.max(...slice.map((d) => d.high)),
      low: Math.min(...slice.map((d) => d.low)),
      volume: slice.reduce((a, d) => a + (VOLUME[d.time] ?? 0), 0)
    });
  }
  return out;
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const path = (pts) =>
  pts.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') : '';

export default function GuideChart({
  range = '7D',
  chartType = 'candles',
  overlays = {},
  panes = {},
  settings = {},
  showPriceLine = true,
  showFib = false,
  zoomStart = 0,
  height = 320,
  highlight = null,
  onHover,
  crosshair = true
}) {
  const { t } = useTranslation();
  /* `data-theme` is written by the settings store, and the resolved value is
     what the rest of the app paints with. `resolveTheme` handles 'auto'. */
  const light = useSettingsStore((s) => resolveTheme(s.theme) === 'light');
  const rtl = useIsRtl();
  const c = light ? COLORS.light : COLORS.dark;
  const uid = useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const geo = layout(panes);
  const MAIN_TOP = geo.mainTop;
  const MAIN_BOTTOM = geo.mainBottom;
  const VOL_TOP = geo.vol?.top ?? 0;
  const VOL_BOTTOM = geo.vol?.bottom ?? 0;
  const SUB_TOP = geo.sub?.top ?? 0;
  const SUB_BOTTOM = geo.sub?.bottom ?? 0;

  /* ── visible window ───────────────────────────────────────────────────── */
  /* Re-bucketed, not re-sliced: the range chips change how long one candle
     lasts (see `RANGE_HOURS`), so switching from 1D to 1Y genuinely redraws the
     history at a coarser resolution instead of relabelling the same 180 bars. */
  const series = useMemo(() => aggregate(CANDLES, RANGE_HOURS[range] ?? 1), [range]);
  const total = Math.min(RANGE_BARS[range] ?? 60, series.length);
  const zoomed = Math.max(0, Math.min(zoomStart, total - 8));
  const window = useMemo(() => {
    const visible = series.slice(series.length - total + zoomed);
    return visible.length ? visible : series.slice(-2);
  }, [series, total, zoomed]);

  const candleCount = window.length;
  const slot = (VB_W - PAD.left - PAD.right) / Math.max(1, candleCount);
  const bodyW = Math.max(1.4, Math.min(9, slot * 0.62));

  /* ── price scale ──────────────────────────────────────────────────────── */
  const scale = useMemo(() => {
    let lo = Math.min(...window.map((d) => d.low));
    let hi = Math.max(...window.map((d) => d.high));
    const pad = (hi - lo) * 0.08 || hi * 0.01;
    lo -= pad;
    hi += pad;
    if (settings.log && lo > 0) {
      const lg = (v) => Math.log(v);
      const a = lg(lo);
      const b = lg(hi);
      return {
        y: (v) => MAIN_BOTTOM - ((lg(Math.max(v, 0.01)) - a) / (b - a)) * (MAIN_BOTTOM - MAIN_TOP),
        ticks: [lo, lo + (hi - lo) / 3, lo + ((hi - lo) * 2) / 3, hi]
      };
    }
    return {
      y: (v) => MAIN_BOTTOM - ((v - lo) / (hi - lo)) * (MAIN_BOTTOM - MAIN_TOP),
      ticks: [lo, lo + (hi - lo) / 3, lo + ((hi - lo) * 2) / 3, hi]
    };
  }, [window, settings.log]);

  const x = (i) => PAD.left + slot * i + slot / 2;

  /* ── series (computed by the SAME functions the terminal uses) ─────────── */
  /* Indicators need history BEFORE the visible window, or a 24-bar 1D view
     would have no MA99 at all. So they are computed on the full series and then
     sliced to the window by timestamp — which is also what the real chart does
     when you switch ranges. */
  const byTime = useMemo(() => new Map(series.map((d) => [d.time, d])), [series]);
  const firstTime = window[0]?.time ?? 0;
  const lastTime = window[window.length - 1]?.time ?? 0;
  const clip = (series) => series.filter((p) => p.time >= firstTime && p.time <= lastTime);

  const maSeries = useMemo(() => {
    const out = {};
    for (const p of [7, 25, 99]) {
      if (overlays.ma?.[p]) out[p] = clip(simpleMovingAverage(series, p));
    }
    return out;
  }, [overlays.ma, series, firstTime, lastTime]);

  const emaSeries = useMemo(() => {
    const out = {};
    for (const p of [21, 55]) {
      if (overlays.ema?.[p]) out[p] = clip(exponentialMovingAverage(series, p));
    }
    return out;
  }, [overlays.ema, series, firstTime, lastTime]);

  const bb = useMemo(() => {
    if (!overlays.bb) return null;
    const b = bollingerBands(series, 20, 2);
    return {
      upper: clip(b.upper),
      middle: clip(b.middle),
      lower: clip(b.lower)
    };
  }, [overlays.bb, series, firstTime, lastTime]);

  const volumeSeries = useMemo(
    () => (panes.volume ? window.map((d, i) => ({ x: x(i), v: d.volume ?? VOLUME[d.time] ?? 0, up: d.close >= d.open })) : []),
    [panes.volume, window, slot]
  );

  const subPane = useMemo(() => {
    if (panes.rsi) {
      const rsiVals = clip(relativeStrengthIndex(series, 14));
      if (!rsiVals.length) return null;
      const val = (v) => SUB_BOTTOM - (v / 100) * (SUB_BOTTOM - SUB_TOP);
      return {
        kind: 'rsi',
        series: rsiVals.map((p) => ({ x: x(window.findIndex((d) => d.time === p.time)), y: val(p.value) })),
        bands: [70, 30].map((v) => ({ y: val(v), label: v }))
      };
    }
    if (panes.macd) {
      const m = macdSeries(series, 12, 26, 9);
      if (!m.macd.length) return null;
      const macdClip = clip(m.macd);
      const signalClip = clip(m.signal);
      const all = [...macdClip, ...signalClip].map((p) => p.value);
      const hi = Math.max(...all.map(Math.abs)) || 1;
      const mid = (SUB_TOP + SUB_BOTTOM) / 2;
      const span = (SUB_BOTTOM - SUB_TOP) / 2 - 2;
      const val = (v) => mid - (v / hi) * span;
      const idx = (tm) => window.findIndex((d) => d.time === tm);
      return {
        kind: 'macd',
        zero: mid,
        series: macdClip.map((p) => ({ x: x(idx(p.time)), y: val(p.value) })),
        signal: signalClip.map((p) => ({ x: x(idx(p.time)), y: val(p.value) }))
      };
    }
    return null;
  }, [panes.rsi, panes.macd, series, window, slot, firstTime, lastTime]);

  const fib = useMemo(() => {
    if (!showFib) return [];
    const high = Math.max(...window.map((d) => d.high));
    const low = Math.min(...window.map((d) => d.low));
    return fibLevels(high, low);
  }, [showFib, window]);

  /* ── crosshair ────────────────────────────────────────────────────────── */
  const nearest = cursor == null ? null : Math.max(0, Math.min(candleCount - 1, Math.round((cursor - PAD.left - slot / 2) / slot)));
  const bar = nearest == null ? null : window[nearest];
  const chartH = VB_H;
  const aspect = `0 0 ${VB_W} ${VB_H}`;

  const priceFromY = (yRaw) => {
    /* Invert the scale analytically: the same mapping used to draw, so a
       measure tool reads the price under the finger, not an approximation. */
    const lo = scale.ticks[0];
    const hi = scale.ticks[3];
    const frac = 1 - (yRaw - MAIN_TOP) / (MAIN_BOTTOM - MAIN_TOP);
    if (settings.log && lo > 0) {
      return Math.exp(Math.log(lo) + frac * (Math.log(hi) - Math.log(lo)));
    }
    return lo + frac * (hi - lo);
  };

  const onMove = (event) => {
    if (!crosshair || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * VB_W;
    const py = ((event.clientY - box.top) / box.height) * VB_H;
    setCursor(px);
    const idx = Math.max(0, Math.min(candleCount - 1, Math.round((px - PAD.left - slot / 2) / slot)));
    onHover?.({
      ...(window[idx] ?? {}),
      volume: window[idx]?.volume ?? VOLUME[window[idx]?.time] ?? null,
      price: priceFromY(py),
      index: idx,
      x: px,
      y: py
    });
  };

  const leave = () => {
    setCursor(null);
    onHover?.(null);
  };

  const last = window[candleCount - 1];
  const hl = highlight ?? {};
  /* The annotation is anchored by TIMESTAMP, not by index. A chapter names one
     moment in the walk ("this candle", "this crossing"); the index that moment
     has depends on the window the reader chose, and on 1D it is not even on
     screen. Resolving here means a chapter can point at a bar and the pointer
     survives every range and zoom change — or disappears honestly when the bar
     is scrolled out, rather than silently pointing at an unrelated candle. */
  /* Snap, don't match. The walk is hourly but 7D and coarser windows draw
     candles aggregated into 4h–24h buckets, so the annotated bar's own
     timestamp usually is not a bar boundary any more. Taking the bucket that
     CONTAINS the moment keeps the ring on the right candle at every
     resolution — and the `bucketMs` guard means a focus that is genuinely
     scrolled out of the window disappears instead of silently jumping to a
     distant candle. */
  /* `HOUR` is already milliseconds; multiplying by 1000 again made every bucket
     span more than a year, so the first bar's bucket "contained" the focus
     point and the ring snapped to the left edge of the plot at every range. */
  const bucketMs = (RANGE_HOURS[range] ?? 1) * HOUR;
  const focusIdx = useMemo(() => {
    if (hl.focusTime == null) return null;
    const t = hl.focusTime * 1000;
    let best = null;
    for (let i = 0; i < window.length; i++) {
      const t0 = window[i].time * 1000;
      const t1 = t0 + bucketMs;
      if (t >= t0 && t < t1) { best = i; break; }
    }
    return best;
  }, [hl.focusTime, window, bucketMs]);

  return (
    <div className="cgc" data-testid="guide-chart">
      <svg
        ref={svgRef}
        className="cgc-svg"
        viewBox={aspect}
        /* NOT `none`. Stretching the box distorted every glyph horizontally by
           the ratio of the container to the viewBox, so text that was legible
           was still the wrong shape; `xMidYMid meet` keeps the drawing square
           and lets CSS size it. */
        preserveAspectRatio="xMidYMid meet"
        style={{ '--cgc-h': `${height}px` }}
        role="img"
        aria-label={t('lab2.chartGuide.demo.chartLabel')}
        onPointerMove={onMove}
        onPointerLeave={leave}
        onPointerDown={onMove}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        <defs>
          <linearGradient id={`bb-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.bbFill} />
            <stop offset="100%" stopColor={c.bbFill} stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.up} stopOpacity="0.28" />
            <stop offset="100%" stopColor={c.up} stopOpacity="0" />
          </linearGradient>
          {/* EVERYTHING drawn in price space is clipped to the price pane.
              Without this an indicator that wanders outside the visible
              high/low — a fast average after a spike, a Bollinger band in a
              squeeze, a fib level above the window — is painted straight over
              the volume and RSI panes below it. `scale.y` is an unbounded
              linear map and has no idea a pane boundary exists. */}
          <clipPath id={`pane-${uid}`}>
            <rect x={PAD.left} y={MAIN_TOP} width={VB_W - PAD.left - PAD.right} height={MAIN_BOTTOM - MAIN_TOP} />
          </clipPath>
          <clipPath id={`vol-${uid}`}>
            <rect x={PAD.left} y={VOL_TOP} width={VB_W - PAD.left - PAD.right} height={Math.max(0, VOL_BOTTOM - VOL_TOP)} />
          </clipPath>
          <clipPath id={`sub-${uid}`}>
            <rect x={PAD.left} y={SUB_TOP} width={VB_W - PAD.left - PAD.right} height={Math.max(0, SUB_BOTTOM - SUB_TOP)} />
          </clipPath>
        </defs>

        {/* ── grid + price axis ─────────────────────────────────────────── */}
        {settings.grid !== false &&
          scale.ticks.map((v, i) => (
            <line
              key={`g${i}`}
              x1={PAD.left}
              x2={VB_W - PAD.right}
              y1={scale.y(v)}
              y2={scale.y(v)}
              stroke={c.grid}
              strokeWidth="1"
            />
          ))}
        {scale.ticks.map((v, i) => (
          <text
            key={`t${i}`}
            x={VB_W - PAD.right + 6}
            y={scale.y(v) + 3.5}
            fill={c.textDim}
            fontSize="10"
            className="cgc-axis"
          >
            {fmt(v, v < 10 ? 2 : 1)}
          </text>
        ))}

        {/* ── price pane: everything below shares one clip ──────────────── */}
        <g clipPath={`url(#pane-${uid})`}>
        {/* ── Bollinger band (drawn UNDER the candles) ──────────────────── */}
        {bb && bb.upper.length > 1 && (
          <g className="cgc-bb">
            <path
              d={`${path(bb.upper.map((p) => ({ x: x(window.findIndex((d) => d.time === p.time)), y: scale.y(p.value) })))}
                  L${x(Math.max(0, window.findIndex((d) => d.time === bb.lower[bb.lower.length - 1].time)))},${scale.y(bb.lower[bb.lower.length - 1].value)}
                  ${[...bb.lower].reverse().map((p) => `L${x(window.findIndex((d) => d.time === p.time))},${scale.y(p.value)}`).join(' ')} Z`}
              fill={`url(#bb-${uid})`}
              stroke="none"
            />
            {[bb.upper, bb.middle, bb.lower].map((series, k) => (
              <path
                key={k}
                d={path(series.map((p) => ({ x: x(window.findIndex((d) => d.time === p.time)), y: scale.y(p.value) })))}
                fill="none"
                stroke={c.bb}
                strokeWidth={k === 1 ? 1 : 1.2}
                strokeDasharray={k === 1 ? '3 3' : undefined}
                opacity={k === 1 ? 0.6 : 1}
              />
            ))}
          </g>
        )}

        {/* ── the price itself ──────────────────────────────────────────── */}
        {chartType === 'candles' && (
          <g className="cgc-candles">
            {window.map((d, i) => {
              const up = d.close >= d.open;
              const yO = scale.y(d.open);
              const yC = scale.y(d.close);
              const top = Math.min(yO, yC);
              const h = Math.max(1, Math.abs(yC - yO));
              /* NOTHING IS DIMMED. An earlier pass faded every other candle to
                 26–42% so the annotated one would stand out. On the light
                 theme that turned the whole plot into pale confetti that read
                 as "broken", and even on dark it made the chart look disabled
                 the moment a chapter opened. The spotlight below does the
                 same job by ADDING attention to one bar instead of removing it
                 from the other fifty-nine. */
              return (
                <g key={d.time}>
                  <line x1={x(i)} x2={x(i)} y1={scale.y(d.high)} y2={scale.y(d.low)} stroke={up ? c.up : c.down} strokeWidth="1.1" />
                  <rect
                    x={x(i) - bodyW / 2}
                    y={top}
                    width={bodyW}
                    height={h}
                    fill={up ? c.upFill : c.downFill}
                    rx={bodyW > 3 ? 0.8 : 0}
                  />
                </g>
              );
            })}
          </g>
        )}

        {chartType === 'line' && (
          <path
            className="cgc-line"
            d={path(window.map((d, i) => ({ x: x(i), y: scale.y(d.close) })))}
            fill="none"
            stroke={c.up}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        )}

        {chartType === 'area' && (
          <>
            <path
              d={`${path(window.map((d, i) => ({ x: x(i), y: scale.y(d.close) })))} L${x(candleCount - 1)},${MAIN_BOTTOM} L${x(0)},${MAIN_BOTTOM} Z`}
              fill={`url(#area-${uid})`}
              stroke="none"
            />
            <path
              d={path(window.map((d, i) => ({ x: x(i), y: scale.y(d.close) })))}
              fill="none"
              stroke={c.up}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* ── moving averages ───────────────────────────────────────────── */}
        {Object.entries(maSeries).map(([p, series]) => (
          <path
            key={`ma${p}`}
            className={`cgc-ma cgc-ma-${p}`}
            d={path(series.map((q) => ({ x: x(window.findIndex((d) => d.time === q.time)), y: scale.y(q.value) })))}
            fill="none"
            stroke={c.ma[p]}
            strokeWidth="1.35"
            strokeLinejoin="round"
            opacity="0.95"
          />
        ))}
        {Object.entries(emaSeries).map(([p, series]) => (
          <path
            key={`ema${p}`}
            className={`cgc-ema cgc-ema-${p}`}
            d={path(series.map((q) => ({ x: x(window.findIndex((d) => d.time === q.time)), y: scale.y(q.value) })))}
            fill="none"
            stroke={c.ema[p]}
            strokeWidth="1.35"
            strokeDasharray="5 3"
            strokeLinejoin="round"
            opacity="0.95"
          />
        ))}

        {/* ── Fibonacci levels ──────────────────────────────────────────── */}
        {fib.map((lvl) => (
          <g key={lvl.label}>
            <line
              x1={PAD.left}
              x2={VB_W - PAD.right}
              y1={scale.y(lvl.price)}
              y2={scale.y(lvl.price)}
              stroke={c.fib}
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text x={PAD.left + 3} y={scale.y(lvl.price) - 3} fill={c.fib} fontSize="8.5" className="cgc-axis">
              {lvl.label} · {fmt(lvl.price)}
            </text>
          </g>
        ))}

        <line x1={PAD.left} x2={VB_W - PAD.right} y1={MAIN_BOTTOM} y2={MAIN_BOTTOM} stroke={c.axis} strokeWidth="0.6" opacity="0.35" />
        </g>

        {/* ── price line (the level tool) ───────────────────────────────── */}
        {showPriceLine && last && (
          <g className="cgc-priceline">
            {/* The dashed level spans the plot; the pill that names it sits at
                the FAR right of the gutter, and the moving-average tags start a
                little to its left. Putting all three on the same vertical
                strip made them collide exactly when an average is near the
                price — the most instructive moment on the chart. */}
            <line
              x1={PAD.left}
              x2={VB_W - PAD.right}
              y1={scale.y(last.close)}
              y2={scale.y(last.close)}
              stroke={c.marker}
              strokeWidth="1"
              strokeDasharray="2 4"
              opacity="0.85"
            />
            <rect
              x={VB_W - PRICE_PILL_W - 1}
              y={scale.y(last.close) - 7}
              width={PRICE_PILL_W}
              height="14"
              rx="3"
              fill={c.marker}
              opacity="0.9"
            />
            <text
              x={VB_W - PRICE_PILL_W / 2 - 1}
              y={scale.y(last.close) + 3.4}
              fill={light ? '#ffffff' : '#04121a'}
              fontSize="8"
              fontWeight="800"
              textAnchor="middle"
              className="cgc-axis"
            >
              {fmt(last.close)}
            </text>
          </g>
        )}

        {/* ── the legend for whatever is switched on ──────────────────────
            The right gutter cannot hold these: it is 58 units wide and
            "MA25 99.03" needs more, so the labels either overflowed the plot or
            sat on top of the price pill — and both happened at once whenever an
            average came near the price, which is the exact moment a reader is
            looking hardest.

            A legend row in the top-left of the price pane is what every real
            chart does and what the terminal does, and it costs one row of
            vertical space instead of a column of horizontal space this design
            does not have. It is drawn last so it sits above the candles, on a
            translucent plate so the price behind it never makes it unreadable. */}
        {(() => {
          const items = [
            ...Object.entries(maSeries).map(([p, ss]) => ({ k: `ma${p}`, v: ss[ss.length - 1]?.value, col: c.ma[p], t: `MA${p}` })),
            ...Object.entries(emaSeries).map(([p, ss]) => ({ k: `ema${p}`, v: ss[ss.length - 1]?.value, col: c.ema[p], t: `EMA${p}` })),
            ...(bb ? [{ k: 'bb', v: null, col: c.bb, t: 'BB' }] : []),
            ...(showFib ? [{ k: 'fib', v: null, col: c.fib, t: 'Fib' }] : [])
          ].filter((q) => q.t);
          if (!items.length) return null;
          let cx = PAD.left + 4;
          const y = MAIN_TOP + 11;
          return (
            <g className="cgc-legend">
              <rect x={PAD.left + 1} y={y - 8} width={VB_W - PAD.left - PAD.right - 2} height="13" fill={c.legendBg} opacity="0.72" rx="2" />
              {items.map((q) => {
                const label = q.v == null ? q.t : `${q.t} ${fmt(q.v)}`;
                /* 4.6 units per glyph at 7.6px is the honest average for the
                   tabular digits and caps in these labels; 4.1 overlapped by
                   about a character and a half, which is what put "99.03" and
                   "BB" on top of each other. */
                const w = label.length * 4.9 + 14;
                const el = (
                  <g key={q.k}>
                    <line x1={cx} x2={cx + 7} y1={y} y2={y} stroke={q.col} strokeWidth="2.2" strokeLinecap="round" />
                    <text x={cx + 10} y={y + 2.8} fill={q.col} fontSize="7.6" fontWeight="700" className="cgc-axis">
                      {label}
                    </text>
                  </g>
                );
                cx += w;
                return el;
              })}
            </g>
          );
        })()}

        {/* ── volume pane ───────────────────────────────────────────────── */}
        {panes.volume && volumeSeries.length > 0 && (
          <g className="cgc-volume">
            <line x1={PAD.left} x2={VB_W - PAD.right} y1={VOL_BOTTOM} y2={VOL_BOTTOM} stroke={c.axis} strokeWidth="0.6" opacity="0.35" />
            <g clipPath={`url(#vol-${uid})`}>
              {/* The max is hoisted out of the map: it was recomputed for every
                  one of the 60 bars on every render, which is a scan of the
                  whole pane per rectangle. */}
              {(() => {
                const max = Math.max(...volumeSeries.map((q) => q.v)) || 1;
                return volumeSeries.map((v, i) => {
                  const h = (v.v / max) * (VOL_BOTTOM - VOL_TOP - 4);
                  return (
                    <rect
                      key={i}
                      x={v.x - bodyW / 2}
                      y={VOL_BOTTOM - h}
                      width={bodyW}
                      height={Math.max(0.6, h)}
                      fill={v.up ? c.up : c.down}
                      opacity="0.6"
                    />
                  );
                });
              })()}
            </g>
            <text x={PAD.left + 2} y={VOL_TOP - 4} fill={c.textDim} fontSize="8.5" fontWeight="700" className="cgc-axis">
              {t('lab2.chartGuide.paneLabels.volume', { defaultValue: 'Volume' })}
            </text>
          </g>
        )}

        {/* ── RSI / MACD sub-pane ───────────────────────────────────────── */}
        {subPane && (
          <g className={`cgc-sub cgc-sub-${subPane.kind}`}>
            <line x1={PAD.left} x2={VB_W - PAD.right} y1={SUB_BOTTOM} y2={SUB_BOTTOM} stroke={c.axis} strokeWidth="0.6" opacity="0.35" />
            <g clipPath={`url(#sub-${uid})`}>
            {subPane.kind === 'rsi' && (
              <>
                {subPane.bands.map((b) => (
                  <g key={b.label}>
                    <line
                      x1={PAD.left}
                      x2={VB_W - PAD.right}
                      y1={b.y}
                      y2={b.y}
                      stroke={c.rsi}
                      strokeWidth="0.8"
                      strokeDasharray="3 3"
                      opacity="0.45"
                    />
                    <text x={VB_W - PAD.right + 6} y={b.y + 3} fill={c.textDim} fontSize="8.5" className="cgc-axis">
                      {b.label}
                    </text>
                  </g>
                ))}
                <path d={path(subPane.series)} fill="none" stroke={c.rsi} strokeWidth="1.4" />
                <text x={PAD.left + 2} y={SUB_TOP - 4} fill={c.textDim} fontSize="8.5" fontWeight="700" className="cgc-axis">
                  {t('lab2.chartGuide.paneLabels.rsi', { defaultValue: 'RSI' })} 14
                </text>
              </>
            )}
            {subPane.kind === 'macd' && (
              <>
                <line x1={PAD.left} x2={VB_W - PAD.right} y1={subPane.zero} y2={subPane.zero} stroke={c.grid} />
                <path d={path(subPane.series)} fill="none" stroke={c.macdLine} strokeWidth="1.3" />
                <path d={path(subPane.signal)} fill="none" stroke={c.macdSignal} strokeWidth="1.1" strokeDasharray="3 2" />
                <text x={PAD.left + 2} y={SUB_TOP - 4} fill={c.textDim} fontSize="8.5" fontWeight="700" className="cgc-axis">
                  {t('lab2.chartGuide.paneLabels.macd', { defaultValue: 'MACD' })} 12·26·9
                </text>
              </>
            )}
            </g>
          </g>
        )}

        {/* ── the spotlight, drawn UNDER the annotation ring ──────────────
            A soft vertical band behind the annotated bar: it marks the moment
            without touching the other candles' opacity, so the chart stays
            readable while one candle is unmistakably singled out. */}
        {focusIdx != null && (
          <g className="cgc-spot" pointerEvents="none">
            <rect
              x={x(focusIdx) - Math.max(slot * 0.9, 6)}
              y={MAIN_TOP}
              width={Math.max(slot * 1.8, 12)}
              height={MAIN_BOTTOM - MAIN_TOP}
              fill={c.marker}
              opacity="0.07"
              rx="2"
            />
          </g>
        )}

        {/* ── the annotation layer ──────────────────────────────────────── */}
        {focusIdx != null && (
          <g className="cgc-focus">
            {(() => {
              const d = window[focusIdx];
              return (
                <>
                  <rect
                    x={x(focusIdx) - Math.max(bodyW, 8) / 2 - 4}
                    y={scale.y(d.high) - 6}
                    width={Math.max(bodyW, 8) + 8}
                    height={Math.max(12, scale.y(d.low) - scale.y(d.high) + 12)}
                    rx="4"
                    fill="none"
                    stroke={c.marker}
                    strokeWidth="1.2"
                    strokeDasharray="3 2"
                  />
                </>
              );
            })()}
          </g>
        )}

        {/* ── crosshair ─────────────────────────────────────────────────── */}
        {bar && crosshair && (
          <g className="cgc-cross" pointerEvents="none">
            <line x1={x(nearest)} x2={x(nearest)} y1={MAIN_TOP} y2={VB_H - PAD.bottom} stroke={c.crosshair} strokeWidth="0.9" strokeDasharray="3 3" />
            <line x1={PAD.left} x2={VB_W - PAD.right} y1={cursor ? undefined : 0} y2={cursor ? undefined : 0} stroke="none" />
          </g>
        )}
      </svg>

      {/* The read-out lives OUTSIDE the SVG: it is selectable text, it follows
          the document direction, and it does not cost a re-render of 180
          shapes when the finger moves. */}
      <div className="cgc-readout" dir={rtl ? 'rtl' : 'ltr'}>
        {bar ? (
          <>
            <span className="cgc-ro-item"><em>O</em>{fmt(bar.open)}</span>
            <span className="cgc-ro-item"><em>H</em>{fmt(bar.high)}</span>
            <span className="cgc-ro-item"><em>L</em>{fmt(bar.low)}</span>
            <span className="cgc-ro-item"><em>C</em>{fmt(bar.close)}</span>
            <span className={`cgc-ro-chg ${bar.close >= bar.open ? 'up' : 'down'}`}>
              {bar.close >= bar.open ? '+' : ''}
              {(((bar.close - bar.open) / bar.open) * 100).toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="cgc-ro-hint">{t('lab2.chartGuide.demo.legendHint')}</span>
        )}
      </div>
    </div>
  );
}
