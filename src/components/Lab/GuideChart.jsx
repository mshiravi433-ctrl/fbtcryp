/**
 * GuideChart v3 — ONE chart, drawn on demand, annotated per tool.
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE THREE COMPLAINTS THIS FILE ANSWERS ───────────────────────────────
 * «چندتا نمودار داره» · «دکمه‌ها کار نمیده» · «باید داخل نمودار نشون بده»
 *
 *   1. ONE CANVAS. v2 carved a volume pane and an RSI/MACD pane out of the
 *      same viewBox, so switching on RSI produced what honestly looked like a
 *      second and third chart stacked under the first. v3 has exactly one
 *      frame: volume is translucent bars inside the price pane, RSI is a
 *      34-unit strip along the bottom of that same frame and only exists while
 *      the RSI tool is open. There is never more than one bordered chart on
 *      the screen.
 *
 *   2. SYNCHRONOUS. No dynamic import, no `ResizeObserver`, no engine to wait
 *      for. Every pixel here is React + arithmetic, so the tap and the change
 *      are in the same frame — on a phone, in a WebView, in a printed page, in
 *      jsdom. That is the property the old screen lacked and the report named.
 *
 *   3. THE ANNOTATION IS THE LESSON. `tool` selects a drawing program, and each
 *      program puts the tool's claim ON the candles: the crossing is ringed,
 *      the squeeze is bracketed, the stop and the target are shaded green and
 *      red, the future is a hatched band that says it is not a prediction. A
 *      chart that merely showed an indicator would be a screenshot; a chart
 *      that labels the moment is a teacher.
 *
 * ─── HONESTY IS GEOMETRY HERE ─────────────────────────────────────────────
 *   · The series is a seeded practice walk, and the page says so above it.
 *   · The "future" region is drawn as ESCALATING UNCERTAINTY (a cone built
 *     from ATR), never as a path, and it carries its own label saying so.
 *   · P&L zones are derived from ATR, not from a promise: the tool teaches
 *     where a stop and a target sit relative to volatility.
 *
 * ─── ARITHMETIC IS NOT REIMPLEMENTED ──────────────────────────────────────
 * MA/EMA/Bollinger/RSI/ATR/Fib come from `lib/proChartMath.js` — the same
 * functions the live terminal uses — so the guide cannot teach one RSI and the
 * token page show another.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsRtl } from './Shared';
import {
  averageTrueRange,
  bollingerBands,
  exponentialMovingAverage,
  fibLevels,
  relativeStrengthIndex,
  simpleMovingAverage
} from '../../lib/proChartMath';
import { resolveTheme, useSettingsStore } from '../../store/useSettingsStore';
import { RANGE_SPEC } from './chartGuideData';

/* ── geometry ─────────────────────────────────────────────────────────────── */
/* One viewBox unit is one CSS pixel at 360px wide, which is the width this app
   actually runs at. Text therefore renders at the size it is written. */
const VB_W = 360;
const VB_H = 300;
const PAD = { top: 34, right: 46, bottom: 18, left: 10 };
const RSI_H = 34;
const RSI_GAP = 12;

const PLOT_W = VB_W - PAD.left - PAD.right;

/* Theme. Mirrors `ProChart`'s palette so a reader who learns a colour here
   finds the same colour on the token page. */
const COLORS = {
  dark: {
    up: '#2ee6a8',
    down: '#ff5d7a',
    ma7: '#22d3ee',
    ma25: '#fbbf24',
    ema21: '#60a5fa',
    ema55: '#c084fc',
    bb: '#a78bfa',
    bbFill: 'rgba(167, 139, 250, 0.10)',
    rsi: '#f472b6',
    fib: 'rgba(251, 146, 60, 0.72)',
    volume: 'rgba(148, 163, 184, 0.42)',
    profit: '#2ee6a8',
    loss: '#ff5d7a',
    grid: 'rgba(148, 163, 184, 0.12)',
    axis: 'rgba(148, 163, 184, 0.42)',
    text: '#e8eefc',
    dim: '#93a3bd',
    future: '#c084fc',
    now: '#22d3ee',
    plate: 'rgba(7, 10, 20, 0.82)',
    crosshair: 'rgba(34, 211, 238, 0.55)'
  },
  light: {
    up: '#0b8f6b',
    down: '#d33b57',
    ma7: '#0a7d8f',
    ma25: '#b06a00',
    ema21: '#1f6fbf',
    ema55: '#7b3fbf',
    bb: '#6d3fd1',
    bbFill: 'rgba(109, 63, 209, 0.07)',
    rsi: '#c02e78',
    fib: 'rgba(170, 96, 8, 0.75)',
    volume: 'rgba(51, 65, 85, 0.30)',
    profit: '#0b8f6b',
    loss: '#d33b57',
    grid: 'rgba(24, 42, 74, 0.09)',
    axis: 'rgba(24, 42, 74, 0.40)',
    text: '#1b2436',
    dim: '#5a6b83',
    future: '#7b3fbf',
    now: '#0a7d8f',
    plate: 'rgba(255, 255, 255, 0.92)',
    crosshair: 'rgba(10, 125, 143, 0.55)'
  }
};

/* ── the practice walk ────────────────────────────────────────────────────── */
const EPOCH = Date.UTC(2024, 0, 1, 0, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Two years of hourly bars. The old walk was 60 days, which meant 1Y had to
 * aggregate the same sixty days into 24-hour buckets — so "1 year" and "90
 * days" drew almost the same history. Two years gives 1Y a real 52-week window
 * and gives the 1D view an honest 24 hourly candles.
 *
 * Mean-reverting (2% pull per bar), four incommensurate harmonics, seeded: the
 * series is identical on every device and every visit, so a step's prose can
 * quote a number the reader sees.
 */
export function makeWalk({ seed = 7, bars = 730 * 24, start = 100 } = {}) {
  let s = seed | 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
  const out = [];
  let price = start;
  for (let i = 0; i < bars; i++) {
    const wave =
      Math.sin(i / 4.3) * 0.42 +
      Math.sin(i / 10.9 + 1.1) * 0.34 +
      Math.sin(i / 27.3 + 0.4) * 0.46 +
      Math.sin(i / 63.1 + 2.2) * 0.5;
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

/* One series for the whole session: two tools must never disagree about the
   same practice market. */
const WALK = makeWalk();

/**
 * Collapse hourly bars into candles of `hours` each — standard OHLC aggregation
 * with summed volume.
 */
export function aggregate(candles, hours = 1) {
  if (!(hours > 1)) return candles;
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
      volume: slice.reduce((a, d) => a + (d.volume ?? 0), 0)
    });
  }
  return out;
}

/* ── one derived series, shared by the chart and the teacher ───────────────
 * The page needs the SAME numbers the chart is drawing: if the AI teacher
 * quotes an RSI that is not the RSI on the strip, the whole screen loses
 * credibility in one sentence. So both call these helpers instead of each
 * computing its own idea of the window. The aggregate is cached per range —
 * 1D buckets two years of hourly bars and recomputing that on every keystroke
 * in the teacher's input box would be wasteful for no benefit. */
const AGG_CACHE = new Map();

export function aggregatedRange(range) {
  const spec = RANGE_SPEC[range] ?? RANGE_SPEC['30D'];
  if (!AGG_CACHE.has(spec.hours)) AGG_CACHE.set(spec.hours, aggregate(WALK, spec.hours));
  return AGG_CACHE.get(spec.hours);
}

/** The visible window for a range + zoom, exactly as the chart draws it. */
export function windowFor(range, zoom = 0) {
  const spec = RANGE_SPEC[range] ?? RANGE_SPEC['30D'];
  const series = aggregatedRange(range);
  const total = Math.min(spec.bars, series.length);
  const zoomed = clamp(zoom, 0, Math.max(0, total - 12));
  const shown = total - zoomed;
  return { spec, series, total, zoomed, shown, window: series.slice(series.length - shown) };
}

const valueAt = (arr, time) => arr.find((p) => p.time === time)?.value;

/**
 * Everything the page (and the teacher) quotes about the current range.
 * Pure, memo-free and cheap enough to call on a tool change; the expensive
 * aggregation is cached above.
 */
export function guideSnapshot(range) {
  const { spec, series, window: win } = windowFor(range, 0);
  const last = win[win.length - 1];
  const first = win[0];
  const ma7 = valueAt(simpleMovingAverage(series, 7), last?.time);
  const ma25 = valueAt(simpleMovingAverage(series, 25), last?.time);
  const ema21 = valueAt(exponentialMovingAverage(series, 21), last?.time);
  const ema55 = valueAt(exponentialMovingAverage(series, 55), last?.time);
  const rsi = valueAt(relativeStrengthIndex(series, 14), last?.time);
  const bbS = bollingerBands(series, 20, 2);
  const atr = averageTrueRange(series, 14)?.value || 0;
  const high = Math.max(...win.map((d) => d.high));
  const low = Math.min(...win.map((d) => d.low));
  const fib = fibLevels(high, low);
  const volume = last?.volume ?? 0;
  const volumeMax = Math.max(...win.map((d) => d.volume ?? 0));
  const entry = last?.close ?? 0;
  const stop = Math.max(1, entry - atr * 1.6);
  const target = entry + atr * 2.6;

  return {
    spec,
    bars: win.length,
    price: last?.close ?? 0,
    open: last?.open ?? 0,
    close: last?.close ?? 0,
    high,
    low,
    change: first ? ((last.close - first.close) / first.close) * 100 : 0,
    ma7,
    ma25,
    gap: ma7 != null && ma25 != null ? ((ma7 - ma25) / ma25) * 100 : 0,
    ema21,
    ema55,
    rsi,
    atr,
    volume,
    volumeMax,
    fib: fib.find((l) => l.ratio === 0.618)?.price ?? low,
    bandLow: bbS.lower[bbS.lower.length - 1]?.value ?? low,
    bandHigh: bbS.upper[bbS.upper.length - 1]?.value ?? high,
    range: low > 0 ? ((high - low) / low) * 100 : 0,
    rangeId: range,
    entry,
    stop,
    target,
    rr: entry - stop > 0 ? (target - entry) / (entry - stop) : 0
  };
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const path = (pts) =>
  pts.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') : '';

/** Text width estimate for the pill labels — tabular digits, 8.4px. */
const textW = (s, size = 8.4) => String(s).length * size * 0.56 + 12;

/* ── a label pill, clamped inside the frame ───────────────────────────────── */
function Pill({ x, y, text, color, c, anchor = 'start', solid = false, size = 8.4 }) {
  const w = textW(text, size);
  const left = anchor === 'end' ? x - w : x;
  const px = clamp(left, PAD.left + 1, VB_W - PAD.right - w - 1);
  return (
    <g pointerEvents="none">
      <rect
        x={px}
        y={y - 8}
        width={w}
        height={14}
        rx={4}
        fill={solid ? color : c.plate}
        stroke={color}
        strokeWidth={solid ? 0 : 1}
        opacity={solid ? 0.95 : 0.92}
      />
      <text
        x={px + w / 2}
        y={y + 2.4}
        fill={solid ? '#04121a' : color}
        fontSize={size}
        fontWeight="800"
        textAnchor="middle"
        className="cgc-axis"
      >
        {text}
      </text>
    </g>
  );
}

export default function GuideChart({
  tool = 'candle',
  range = '30D',
  chartType = 'candles',
  grid = true,
  log = false,
  zoom = 0,
  height = 330,
  onHover,
  crosshair = true
}) {
  const { t } = useTranslation();
  const light = useSettingsStore((s) => resolveTheme(s.theme) === 'light');
  const c = light ? COLORS.light : COLORS.dark;
  const rtl = useIsRtl();
  const uid = useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [pinned, setPinned] = useState(null);

  /* ── the visible window ─────────────────────────────────────────────────── */
  const { series, window: win } = useMemo(() => windowFor(range, zoom), [range, zoom]);
  /* `window` is a browser global; shadowing it in this file worked, but a
     variable named like a platform object is a trap for the next reader. */
  const window = win;

  const count = window.length;
  const firstTime = window[0]?.time ?? 0;
  const lastTime = window[count - 1]?.time ?? 0;

  /* The future region. Only the "future" tool widens the canvas to make room
     for it; every other tool keeps the full width for data. A tutorial that
     always reserves a quarter of the plot for nothing would be teaching that
     the future takes up space on a chart — it does not. */
  const futureFrac = tool === 'future' ? 0.26 : 0;
  const dataW = PLOT_W * (1 - futureFrac);
  const slot = dataW / Math.max(1, count);
  const bodyW = clamp(slot * 0.62, 1.3, 10);
  const x = (i) => PAD.left + slot * i + slot / 2;

  const mainTop = PAD.top;
  const mainBottom = VB_H - PAD.bottom - (tool === 'rsi' ? RSI_H + RSI_GAP : 0);
  const rsiTop = mainBottom + RSI_GAP;
  const rsiBottom = rsiTop + RSI_H;
  const xNow = PAD.left + dataW;

  /* ── indicators on the full series, then clipped to the visible bars ────── */
  const clip = (arr) => arr.filter((p) => p.time >= firstTime && p.time <= lastTime);
  const idxOf = useMemo(() => new Map(window.map((d, i) => [d.time, i])), [window]);
  const at = (time) => idxOf.get(time);

  const ma7 = useMemo(() => clip(simpleMovingAverage(series, 7)), [series, firstTime, lastTime]);
  const ma25 = useMemo(() => clip(simpleMovingAverage(series, 25)), [series, firstTime, lastTime]);
  const ema21 = useMemo(() => clip(exponentialMovingAverage(series, 21)), [series, firstTime, lastTime]);
  const ema55 = useMemo(() => clip(exponentialMovingAverage(series, 55)), [series, firstTime, lastTime]);
  const bb = useMemo(() => {
    if (tool !== 'band') return null;
    const b = bollingerBands(series, 20, 2);
    return { upper: clip(b.upper), middle: clip(b.middle), lower: clip(b.lower) };
  }, [tool, series, firstTime, lastTime]);
  const rsi = useMemo(
    () => (tool === 'rsi' ? clip(relativeStrengthIndex(series, 14)) : []),
    [tool, series, firstTime, lastTime]
  );
  /* `averageTrueRange` returns `{ value, pct }` for the whole series — not a
     per-bar array. Reading it as an array is the mistake that would have made
     every stop/target in the P&L tool collapse to a single bar's range. */
  const atr = useMemo(() => {
    const a = averageTrueRange(series, 14);
    const v = a?.value;
    return Number.isFinite(v) && v > 0 ? v : (window[count - 1]?.high - window[count - 1]?.low) || 1;
  }, [series, window, count]);

  const last = window[count - 1];

  /* ── the P&L geometry (shared by the domain and the zones) ─────────────── */
  const pnl = useMemo(() => {
    if (tool !== 'pnl' || !last) return null;
    const entry = last.close;
    const stop = Math.max(1, entry - atr * 1.6);
    const target = entry + atr * 2.6;
    return {
      entry,
      stop,
      target,
      stopPct: ((stop - entry) / entry) * 100,
      targetPct: ((target - entry) / entry) * 100,
      rr: (target - entry) / (entry - stop)
    };
  }, [tool, last, atr]);

  /* ── the price domain ───────────────────────────────────────────────────── */
  const scale = useMemo(() => {
    const vals = [];
    for (const d of window) {
      vals.push(d.high, d.low);
    }
    if (bb) for (const p of [...bb.upper, ...bb.lower]) vals.push(p.value);
    if (pnl) vals.push(pnl.stop, pnl.target);
    if (tool === 'future') {
      /* The cone widens to sqrt(8)·1.15 ≈ 3.25 ATR at its far edge, so the
         domain has to contain THAT, not a round 2.6 — otherwise the cone runs
         into the clip and the future looks truncated for no stated reason. */
      const reach = atr * Math.sqrt(8) * 1.15;
      vals.push(last.close + reach, last.close - reach);
    }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo) * 0.1 || hi * 0.02;
    lo = Math.max(0.01, lo - pad);
    hi += pad;
    const useLog = log || tool === 'log';
    const ticks = useLog
      ? [lo, lo * Math.pow(hi / lo, 1 / 3), lo * Math.pow(hi / lo, 2 / 3), hi]
      : [lo, lo + (hi - lo) / 3, lo + ((hi - lo) * 2) / 3, hi];
    const y = useLog
      ? (v) => mainBottom - ((Math.log(Math.max(v, 0.01)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (mainBottom - mainTop)
      : (v) => mainBottom - ((v - lo) / (hi - lo)) * (mainBottom - mainTop);
    return { lo, hi, ticks, y, useLog };
  }, [window, bb, pnl, tool, log, atr, last, mainBottom, mainTop]);

  const priceFromY = (py) => {
    const frac = 1 - (py - mainTop) / (mainBottom - mainTop);
    if (scale.useLog) {
      return Math.exp(Math.log(scale.lo) + frac * (Math.log(scale.hi) - Math.log(scale.lo)));
    }
    return scale.lo + frac * (scale.hi - scale.lo);
  };

  /* ── annotations computed from the data, never typed by hand ───────────── */
  const marks = useMemo(() => {
    const out = {};

    /* The candle with the widest body — the clearest example of "body". */
    let bodyIdx = count - 1;
    let bodySize = -1;
    window.forEach((d, i) => {
      const s = Math.abs(d.close - d.open);
      if (s > bodySize) {
        bodySize = s;
        bodyIdx = i;
      }
    });
    out.body = bodyIdx;

    /* Crosses of MA7 over MA25, restricted to the visible window. */
    const byTime25 = new Map(ma25.map((p) => [p.time, p.value]));
    const crosses = [];
    let prevSign = null;
    for (const p of ma7) {
      const slow = byTime25.get(p.time);
      if (slow == null) continue;
      const sign = Math.sign(p.value - slow);
      if (sign && prevSign != null && sign !== prevSign) {
        const i = at(p.time);
        if (i != null) crosses.push({ i, up: sign > 0 });
      }
      if (sign) prevSign = sign;
    }
    out.crosses = crosses.slice(-2);

    /* Bollinger squeeze: the narrowest band over a 12-bar run. */
    if (bb && bb.upper.length > 12) {
      let best = { i: -1, w: Infinity };
      for (let i = 11; i < bb.upper.length; i++) {
        const u = bb.upper[i];
        const l = bb.lower[i];
        const iu = at(u.time);
        if (iu == null) continue;
        const w = (u.value - l.value) / Math.max(1, bb.middle[i]?.value ?? u.value);
        if (w < best.w) best = { i: iu, w };
      }
      out.squeeze = best.i >= 0 ? best.i : null;
    }

    /* The last touch of the upper / lower band. */
    if (bb) {
      const up = new Map(bb.upper.map((p) => [p.time, p.value]));
      const low = new Map(bb.lower.map((p) => [p.time, p.value]));
      let touchUp = null;
      let touchLow = null;
      window.forEach((d, i) => {
        const u = up.get(d.time);
        const l = low.get(d.time);
        if (u != null && d.high >= u) touchUp = i;
        if (l != null && d.low <= l) touchLow = i;
      });
      out.touchUp = touchUp;
      out.touchLow = touchLow;
    }

    /* Highest volume bar in the window. */
    let volIdx = 0;
    let volMax = -1;
    window.forEach((d, i) => {
      if ((d.volume ?? 0) > volMax) {
        volMax = d.volume ?? 0;
        volIdx = i;
      }
    });
    out.volume = volIdx;

    /* Last RSI excursion into overbought / oversold. */
    if (rsi.length) {
      let ob = null;
      let os = null;
      for (const p of rsi) {
        const i = at(p.time);
        if (i == null) continue;
        if (p.value >= 70) ob = i;
        if (p.value <= 30) os = i;
      }
      out.rsiOverbought = ob;
      out.rsiOversold = os;
      out.rsiLast = rsi[rsi.length - 1]?.value ?? null;
    }

    /* Fibonacci retracement of the visible high/low. */
    const hi = Math.max(...window.map((d) => d.high));
    const lo = Math.min(...window.map((d) => d.low));
    out.fib = fibLevels(hi, lo);
    out.hi = hi;
    out.lo = lo;

    return out;
  }, [window, ma7, ma25, bb, rsi, count]);

  /* ── pointer ────────────────────────────────────────────────────────────── */
  const nearest = (px) =>
    px <= PAD.left || px > PAD.left + dataW
      ? null
      : clamp(Math.round((px - PAD.left - slot / 2) / slot), 0, count - 1);

  const activeIdx = pinned != null ? pinned : nearest(cursor ?? -1);
  const activeBar = activeIdx == null ? null : window[activeIdx];

  const toLocal = (event) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      px: ((event.clientX - box.left) / box.width) * VB_W,
      py: ((event.clientY - box.top) / box.height) * VB_H
    };
  };

  const onMove = (event) => {
    if (!crosshair) return;
    const p = toLocal(event);
    if (!p) return;
    setCursor(p.px);
    const idx = nearest(p.px);
    emitHover(idx, p);
  };

  const emitHover = (idx, p) => {
    onHover?.(
      idx == null
        ? null
        : {
            ...(window[idx] ?? {}),
            price: priceFromY(p.py),
            index: idx,
            x: p.px,
            y: p.py
          }
    );
  };

  const onDown = (event) => {
    const p = toLocal(event);
    if (!p) return;
    const idx = nearest(p.px);
    setPinned(idx);
    setCursor(p.px);
    emitHover(idx, p);
  };

  const leave = () => {
    if (pinned != null) return;
    setCursor(null);
    onHover?.(null);
  };

  /* ── drawing helpers ────────────────────────────────────────────────────── */
  const line = (arr, color, width = 1.5, dash) => {
    const pts = arr.map((p) => ({ x: x(at(p.time)), y: scale.y(p.value) })).filter((p) => Number.isFinite(p.x));
    if (pts.length < 2) return null;
    return <path d={path(pts)} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" />;
  };

  const ring = (i, color, pad = 4) => {
    const d = window[i];
    if (!d) return null;
    const top = scale.y(d.high) - pad - 2;
    const bottom = scale.y(d.low) + pad + 2;
    return (
      <rect
        x={x(i) - Math.max(bodyW, 7) / 2 - pad}
        y={top}
        width={Math.max(bodyW, 7) + pad * 2}
        height={Math.max(10, bottom - top)}
        rx="4"
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeDasharray="3 2"
        className="cgc-ring"
      />
    );
  };

  const chip = (x0, y0, text, color, opts) => (
    <Pill key={`${text}-${x0}-${y0}`} x={x0} y={y0} text={text} color={color} c={c} {...opts} />
  );

  /* ── the tool's own drawing program ─────────────────────────────────────── */
  const annotation = () => {
    const g = [];
    const lastX = x(count - 1);

    if (tool === 'candle') {
      const i = marks.body;
      const d = window[i];
      if (!d) return null;
      const up = d.close >= d.open;
      const color = up ? c.up : c.down;
      const rightSide = x(i) < PAD.left + dataW * 0.6;
      const ax = rightSide ? x(i) + 14 : x(i) - 14;
      const anchor = rightSide ? 'start' : 'end';
      const bodyY = (scale.y(d.open) + scale.y(d.close)) / 2;
      g.push(<g key="ring">{ring(i, c.now, 5)}</g>);
      g.push(
        <g key="leads" stroke={c.now} strokeWidth="0.8" opacity="0.6">
          <line x1={x(i)} y1={scale.y(d.high)} x2={ax + (rightSide ? -4 : 4)} y2={scale.y(d.high) - 16} />
          <line x1={x(i)} y1={scale.y(d.low)} x2={ax + (rightSide ? -4 : 4)} y2={scale.y(d.low) + 16} />
          <line x1={x(i)} y1={bodyY} x2={ax + (rightSide ? -4 : 4)} y2={bodyY} />
        </g>
      );
      g.push(chip(ax, scale.y(d.high) - 16, t('lab2.cgx.chart.wickTop'), c.now, { anchor }));
      g.push(chip(ax, scale.y(d.low) + 18, t('lab2.cgx.chart.wickBottom'), c.now, { anchor }));
      g.push(chip(ax, bodyY, t('lab2.cgx.chart.body'), color, { anchor, solid: true }));
      return g;
    }

    if (tool === 'trend' || tool === 'ema') {
      const fast = tool === 'trend' ? ma7 : ema21;
      const slow = tool === 'trend' ? ma25 : ema55;
      const fastCol = tool === 'trend' ? c.ma7 : c.ema21;
      const slowCol = tool === 'trend' ? c.ma25 : c.ema55;
      /* Crosses only make sense for the two-MA lesson; for EMA the moment is
         "price crossed its fast average", which is the line the reader is
         being asked to watch. */
      if (tool === 'trend') {
        marks.crosses.forEach((cr, k) => {
          const label = cr.up ? t('lab2.cgx.chart.goldenCross') : t('lab2.cgx.chart.deathCross');
          const yy = cr.up ? scale.y(window[cr.i].low) + 20 : scale.y(window[cr.i].high) - 20;
          g.push(<circle key={`cxdot${k}`} cx={x(cr.i)} cy={scale.y(window[cr.i].close)} r="2.6" fill="none" stroke={cr.up ? c.profit : c.loss} strokeWidth="1.4" />);
          g.push(chip(x(cr.i), yy, label, cr.up ? c.profit : c.loss, { anchor: x(cr.i) > PAD.left + dataW * 0.6 ? 'end' : 'start' }));
        });
      } else {
        /* Last bar where price crossed the fast EMA. */
        let cross = null;
        let prev = null;
        window.forEach((d, i) => {
          const e = ema21.find((p) => p.time === d.time)?.value;
          if (e == null) return;
          const sign = Math.sign(d.close - e);
          if (prev != null && sign && sign !== prev) cross = { i, up: sign > 0 };
          if (sign) prev = sign;
        });
        if (cross) {
          g.push(<circle key="emacross" cx={x(cross.i)} cy={scale.y(window[cross.i].close)} r="2.8" fill="none" stroke={cross.up ? c.profit : c.loss} strokeWidth="1.4" />);
          g.push(chip(x(cross.i), scale.y(window[cross.i].high) - 18, t('lab2.cgx.chart.emaCross'), cross.up ? c.profit : c.loss, { anchor: cross.i > count * 0.6 ? 'end' : 'start' }));
        }
      }
      /* Legend on the chart: the two lines, with their last values. */
      g.push(
        <g key="legend">
          {[
            { label: tool === 'trend' ? `MA7 ${fmt(fast[fast.length - 1]?.value)}` : `EMA21 ${fmt(fast[fast.length - 1]?.value)}`, col: fastCol },
            { label: tool === 'trend' ? `MA25 ${fmt(slow[slow.length - 1]?.value)}` : `EMA55 ${fmt(slow[slow.length - 1]?.value)}`, col: slowCol }
          ].map((it, k) => (
            <g key={it.label} transform={`translate(${PAD.left + 2}, ${mainTop - 22 + k * 12})`}>
              <line x1="0" x2="8" y1="0" y2="0" stroke={it.col} strokeWidth="2.4" strokeLinecap="round" />
              <text x="12" y="2.8" fill={it.col} fontSize="8" fontWeight="800" className="cgc-axis">{it.label}</text>
            </g>
          ))}
        </g>
      );
      return g;
    }

    if (tool === 'band') {
      if (marks.squeeze != null) {
        const d = window[marks.squeeze];
        const u = bb.upper[bb.upper.length - 1];
        const l = bb.lower[bb.lower.length - 1];
        const top = scale.y(Math.max(d.high, u?.value ?? d.high));
        const bottom = scale.y(Math.min(d.low, l?.value ?? d.low));
        g.push(
          <g key="squeeze">
            <rect x={x(marks.squeeze) - 9} y={top - 3} width="18" height={Math.max(14, bottom - top + 6)} rx="4" fill="none" stroke={c.bb} strokeWidth="1" strokeDasharray="2 3" />
            {chip(x(marks.squeeze), Math.max(mainTop + 8, top - 12), t('lab2.cgx.chart.squeeze'), c.bb, { anchor: marks.squeeze > count * 0.6 ? 'end' : 'start' })}
          </g>
        );
      }
      if (marks.touchUp != null) {
        g.push(<circle key="tu" cx={x(marks.touchUp)} cy={scale.y(window[marks.touchUp].high)} r="2.4" fill={c.bb} />);
      }
      if (marks.touchLow != null) {
        g.push(<circle key="tl" cx={x(marks.touchLow)} cy={scale.y(window[marks.touchLow].low)} r="2.4" fill={c.bb} />);
      }
      return g;
    }

    if (tool === 'volume') {
      const i = marks.volume;
      g.push(<g key="volring">{ring(i, c.ma25, 3)}</g>);
      g.push(chip(x(i), scale.y(window[i].high) - 16, t('lab2.cgx.chart.volumeSpike'), c.ma25, { anchor: i > count * 0.6 ? 'end' : 'start' }));
      return g;
    }

    if (tool === 'rsi') {
      /* Mark the two excursions on the price pane, because that is where the
         reader is looking: the oscillator only matters at "price did this". */
      if (marks.rsiOverbought != null) {
        const i = marks.rsiOverbought;
        g.push(<circle key="ob" cx={x(i)} cy={scale.y(window[i].high)} r="2.6" fill="none" stroke={c.loss} strokeWidth="1.3" />);
        g.push(chip(x(i), scale.y(window[i].high) - 15, t('lab2.cgx.chart.overbought'), c.loss, { anchor: i > count * 0.6 ? 'end' : 'start' }));
      }
      if (marks.rsiOversold != null) {
        const i = marks.rsiOversold;
        g.push(<circle key="os" cx={x(i)} cy={scale.y(window[i].low)} r="2.6" fill="none" stroke={c.profit} strokeWidth="1.3" />);
        g.push(chip(x(i), scale.y(window[i].low) + 16, t('lab2.cgx.chart.oversold'), c.profit, { anchor: i > count * 0.6 ? 'end' : 'start' }));
      }
      return g;
    }

    if (tool === 'fib') {
      const bandTop = scale.y(marks.hi - (marks.hi - marks.lo) * 0.382);
      const bandBottom = scale.y(marks.hi - (marks.hi - marks.lo) * 0.618);
      /* The wash itself is drawn UNDER the candles (see `backdrop` above); only
         the label belongs on top. */
      g.push(chip(PAD.left + 6, (bandTop + bandBottom) / 2, t('lab2.cgx.chart.fibZone'), c.fib, { anchor: 'start' }));
      return g;
    }

    if (tool === 'pnl' && pnl) {
      const yEntry = scale.y(pnl.entry);
      const yTarget = scale.y(pnl.target);
      const yStop = scale.y(pnl.stop);
      g.push(
        <g key="zones" pointerEvents="none">
          <line x1={PAD.left} x2={PAD.left + dataW} y1={yEntry} y2={yEntry} stroke={c.now} strokeWidth="1" strokeDasharray="4 3" />
          <line x1={PAD.left} x2={PAD.left + dataW} y1={yStop} y2={yStop} stroke={c.loss} strokeWidth="0.9" strokeDasharray="2 3" />
          <line x1={PAD.left} x2={PAD.left + dataW} y1={yTarget} y2={yTarget} stroke={c.profit} strokeWidth="0.9" strokeDasharray="2 3" />
          {chip(PAD.left + 5, yEntry, `${t('lab2.cgx.chart.entry')} ${fmt(pnl.entry)}`, c.now, { anchor: 'start' })}
          {chip(PAD.left + 5, yTarget + 12, `${t('lab2.cgx.chart.target')} ${fmt(pnl.target)} · +${pnl.targetPct.toFixed(1)}%`, c.profit, { anchor: 'start', solid: true })}
          {chip(PAD.left + 5, yStop - 12, `${t('lab2.cgx.chart.stop')} ${fmt(pnl.stop)} · ${pnl.stopPct.toFixed(1)}%`, c.loss, { anchor: 'start', solid: true })}
        </g>
      );
      g.push(chip(VB_W - PAD.right - 4, mainTop + 8, `R:R ${pnl.rr.toFixed(1)}×`, c.now, { anchor: 'end' }));
      return g;
    }

    if (tool === 'log') {
      /* In a log scale, equal PERCENTAGE moves are equal pixel distances —
         that is the entire lesson, so it is drawn as two brackets rather than
         asserted in a paragraph. */
      const up = scale.y(last.close * 1.2);
      const down = scale.y(last.close / 1.2);
      const h = scale.y(last.close) - up;
      g.push(
        <g key="logbraces" stroke={c.axis} strokeWidth="0.9">
          <line x1={VB_W - PAD.right + 4} x2={VB_W - PAD.right + 4} y1={up} y2={scale.y(last.close)} />
          <line x1={VB_W - PAD.right + 1} x2={VB_W - PAD.right + 7} y1={up} y2={up} />
          <line x1={VB_W - PAD.right + 1} x2={VB_W - PAD.right + 7} y1={scale.y(last.close)} y2={scale.y(last.close)} />
          <line x1={VB_W - PAD.right + 4} x2={VB_W - PAD.right + 4} y1={scale.y(last.close)} y2={down} />
          <line x1={VB_W - PAD.right + 1} x2={VB_W - PAD.right + 7} y1={down} y2={down} />
          <text x={VB_W - PAD.right + 9} y={up + h / 2 + 3} fill={c.dim} fontSize="7.6" className="cgc-axis">+20%</text>
          <text x={VB_W - PAD.right + 9} y={down - h / 2 + 3} fill={c.dim} fontSize="7.6" className="cgc-axis">−20%</text>
        </g>
      );
      g.push(chip(PAD.left + 2, mainTop - 22, t('lab2.cgx.chart.logNote'), c.text, { anchor: 'start' }));
      return g;
    }

    if (tool === 'future' && last) {
      const steps = 8;
      const upper = [];
      const lower = [];
      /* Distance from the "now" line to the right edge of the plot. The
         obvious `xNow - (VB_W - PAD.right)` is NEGATIVE, which drew the cone
         backwards over the history it is supposed to be uncertain about. */
      const span = Math.max(8, VB_W - PAD.right - xNow - 2);
      for (let k = 0; k <= steps; k++) {
        const px = xNow + (span * k) / steps;
        const spread = atr * Math.sqrt(k) * 1.15;
        upper.push({ x: px, y: scale.y(last.close + spread) });
        lower.push({ x: px, y: scale.y(last.close - spread) });
      }
      g.push(
        <g key="cone" clipPath={`url(#pane-${uid})`}>
          <path
            d={`${path(upper)} ${[...lower].reverse().map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`}
            fill={`url(#future-${uid})`}
            stroke={c.future}
            strokeWidth="0.9"
            strokeDasharray="3 3"
            opacity="0.85"
          />
          <line x1={xNow} x2={VB_W - PAD.right} y1={scale.y(last.close)} y2={scale.y(last.close)} stroke={c.future} strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
        </g>
      );
      g.push(chip(xNow + 3, mainTop + 12, t('lab2.cgx.chart.future'), c.future, { anchor: 'start' }));
      g.push(chip(xNow + 3, mainTop + 28, t('lab2.cgx.chart.futureNote'), c.dim, { anchor: 'start' }));
      g.push(chip(PAD.left + 2, mainTop + 12, t('lab2.cgx.chart.past'), c.dim, { anchor: 'start' }));
      return g;
    }

    return null;
  };

  /* ── chrome ─────────────────────────────────────────────────────────────── */
  const axisTicks = scale.ticks;
  const activeColor = activeBar ? (activeBar.close >= activeBar.open ? c.up : c.down) : c.dim;

  return (
    <div className="cgc" data-testid="guide-chart" data-tool={tool} data-range={range}>
      <svg
        ref={svgRef}
        className="cgc-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ '--cgc-h': `${height}px` }}
        role="img"
        aria-label={t('lab2.cgx.chart.label')}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerLeave={leave}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        <defs>
          <linearGradient id={`bb-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.bbFill} />
            <stop offset="100%" stopColor={c.bbFill} stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.up} stopOpacity="0.32" />
            <stop offset="100%" stopColor={c.up} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`profit-${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={c.profit} stopOpacity="0.20" />
            <stop offset="100%" stopColor={c.profit} stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id={`loss-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.loss} stopOpacity="0.20" />
            <stop offset="100%" stopColor={c.loss} stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id={`future-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c.future} stopOpacity="0.22" />
            <stop offset="100%" stopColor={c.future} stopOpacity="0.04" />
          </linearGradient>
          <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={c.future} strokeWidth="0.7" opacity="0.16" />
          </pattern>
          <clipPath id={`pane-${uid}`}>
            <rect x={PAD.left} y={mainTop} width={dataW} height={mainBottom - mainTop} />
          </clipPath>
          <clipPath id={`rsi-${uid}`}>
            <rect x={PAD.left} y={rsiTop} width={dataW} height={RSI_H} />
          </clipPath>
        </defs>

        {/* ── grid + price axis ─────────────────────────────────────────── */}
        {grid &&
          axisTicks.map((v, i) => (
            <line key={`g${i}`} x1={PAD.left} x2={VB_W - PAD.right} y1={scale.y(v)} y2={scale.y(v)} stroke={c.grid} strokeWidth="1" />
          ))}
        {axisTicks.map((v, i) => (
          <text key={`t${i}`} x={VB_W - PAD.right + 5} y={scale.y(v) + 3} fill={c.dim} fontSize="9" className="cgc-axis">
            {fmt(v, v < 10 ? 2 : 1)}
          </text>
        ))}

        {/* ── the future region: reserved, hatched, and labelled ────────── */}
        {futureFrac > 0 && (
          <g pointerEvents="none">
            <rect x={xNow} y={mainTop} width={VB_W - PAD.right - xNow} height={mainBottom - mainTop} fill={`url(#hatch-${uid})`} />
            <line x1={xNow} x2={xNow} y1={mainTop - 4} y2={mainBottom + 4} stroke={c.now} strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
            <Pill x={xNow - 14} y={mainTop - 18} text={t('lab2.cgx.chart.now')} color={c.now} c={c} solid />
          </g>
        )}

        {/* ── volume, inside the price pane (not a second chart) ─────────── */}
        {tool === 'volume' && (
          <g className="cgc-volume" clipPath={`url(#pane-${uid})`} pointerEvents="none">
            {(() => {
              const max = Math.max(...window.map((d) => d.volume ?? 0), 1);
              const zone = (mainBottom - mainTop) * 0.24;
              return window.map((d, i) => {
                const h = ((d.volume ?? 0) / max) * zone;
                return (
                  <rect
                    key={d.time}
                    x={x(i) - bodyW / 2}
                    y={mainBottom - h}
                    width={Math.max(1, bodyW)}
                    height={h}
                    fill={d.close >= d.open ? c.up : c.down}
                    opacity="0.26"
                  />
                );
              });
            })()}
          </g>
        )}

        {/* ── zones that belong UNDER the price ──────────────────────────
            The P&L and Fibonacci washes are background, not annotation: drawn
            after the candles they tint the very bodies the reader is trying to
            read. They are split out here so the layer order matches the
            meaning — shade first, price on top, labels last. */}
        {tool === 'pnl' && pnl && (
          <g pointerEvents="none">
            <rect x={PAD.left} y={scale.y(pnl.target)} width={dataW} height={Math.max(1, scale.y(pnl.entry) - scale.y(pnl.target))} fill={`url(#profit-${uid})`} />
            <rect x={PAD.left} y={scale.y(pnl.entry)} width={dataW} height={Math.max(1, scale.y(pnl.stop) - scale.y(pnl.entry))} fill={`url(#loss-${uid})`} />
          </g>
        )}
        {tool === 'fib' && (
          <rect
            x={PAD.left}
            y={Math.min(scale.y(marks.hi - (marks.hi - marks.lo) * 0.382), scale.y(marks.hi - (marks.hi - marks.lo) * 0.618))}
            width={dataW}
            height={Math.abs(scale.y(marks.hi - (marks.hi - marks.lo) * 0.618) - scale.y(marks.hi - (marks.hi - marks.lo) * 0.382))}
            fill={c.fib}
            opacity="0.09"
            pointerEvents="none"
          />
        )}

        {/* ── Bollinger envelope ────────────────────────────────────────── */}
        {bb && bb.upper.length > 1 && (
          <g clipPath={`url(#pane-${uid})`} pointerEvents="none">
            <path
              d={`${path(bb.upper.map((p) => ({ x: x(at(p.time)), y: scale.y(p.value) })))}
                  ${[...bb.lower].reverse().map((p) => `L${x(at(p.time))},${scale.y(p.value)}`).join(' ')} Z`}
              fill={`url(#bb-${uid})`}
            />
            {[bb.upper, bb.middle, bb.lower].map((s, k) => (
              <path
                key={k}
                d={path(s.map((p) => ({ x: x(at(p.time)), y: scale.y(p.value) })))}
                fill="none"
                stroke={c.bb}
                strokeWidth={k === 1 ? 0.9 : 1.3}
                strokeDasharray={k === 1 ? '3 3' : undefined}
                opacity={k === 1 ? 0.55 : 0.95}
              />
            ))}
          </g>
        )}

        {/* ── the price itself ─────────────────────────────────────────── */}
        <g clipPath={`url(#pane-${uid})`} pointerEvents="none">
          {chartType === 'candles' &&
            window.map((d, i) => {
              const up = d.close >= d.open;
              const yO = scale.y(d.open);
              const yC = scale.y(d.close);
              const top = Math.min(yO, yC);
              const h = Math.max(1, Math.abs(yC - yO));
              return (
                <g key={d.time} className="cgc-candle">
                  <line x1={x(i)} x2={x(i)} y1={scale.y(d.high)} y2={scale.y(d.low)} stroke={up ? c.up : c.down} strokeWidth="1.1" />
                  <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={h} fill={up ? c.up : c.down} rx={bodyW > 3 ? 0.8 : 0} />
                </g>
              );
            })}

          {chartType === 'line' && (
            <path d={path(window.map((d, i) => ({ x: x(i), y: scale.y(d.close) })))} fill="none" stroke={c.up} strokeWidth="1.8" strokeLinejoin="round" />
          )}

          {chartType === 'area' && (
            <>
              <path
                d={`${path(window.map((d, i) => ({ x: x(i), y: scale.y(d.close) })))} L${x(count - 1)},${mainBottom} L${x(0)},${mainBottom} Z`}
                fill={`url(#area-${uid})`}
              />
              <path d={path(window.map((d, i) => ({ x: x(i), y: scale.y(d.close) })))} fill="none" stroke={c.up} strokeWidth="1.8" strokeLinejoin="round" />
            </>
          )}

          {tool === 'trend' && line(ma7, c.ma7, 1.5)}
          {tool === 'trend' && line(ma25, c.ma25, 1.5)}
          {tool === 'ema' && line(ema21, c.ema21, 1.5)}
          {tool === 'ema' && line(ema55, c.ema55, 1.4, '5 3')}

          {tool === 'fib' &&
            marks.fib.map((lvl) => (
              <g key={lvl.label}>
                <line x1={PAD.left} x2={PAD.left + dataW} y1={scale.y(lvl.price)} y2={scale.y(lvl.price)} stroke={c.fib} strokeWidth="0.9" strokeDasharray="4 4" />
                <text x={PAD.left + 3} y={scale.y(lvl.price) - 3} fill={c.fib} fontSize="8" className="cgc-axis">
                  {lvl.label}
                </text>
              </g>
            ))}
        </g>

        {/* ── RSI strip, inside the same frame ──────────────────────────── */}
        {tool === 'rsi' && (
          <g className="cgc-rsi" pointerEvents="none">
            <rect x={PAD.left} y={rsiTop} width={dataW} height={RSI_H} fill={c.rsi} opacity="0.05" rx="3" />
            <text x={VB_W - PAD.right + 5} y={rsiTop + 6} fill={c.dim} fontSize="7.6" className="cgc-axis">70</text>
            <text x={VB_W - PAD.right + 5} y={rsiBottom} fill={c.dim} fontSize="7.6" className="cgc-axis">30</text>
            <g clipPath={`url(#rsi-${uid})`}>
              <rect x={PAD.left} y={rsiTop} width={dataW} height={RSI_H * 0.3} fill={c.loss} opacity="0.12" />
              <rect x={PAD.left} y={rsiBottom - RSI_H * 0.3} width={dataW} height={RSI_H * 0.3} fill={c.profit} opacity="0.12" />
              <line x1={PAD.left} x2={PAD.left + dataW} y1={rsiTop + RSI_H * 0.3} y2={rsiTop + RSI_H * 0.3} stroke={c.loss} strokeWidth="0.7" strokeDasharray="3 3" opacity="0.5" />
              <line x1={PAD.left} x2={PAD.left + dataW} y1={rsiBottom - RSI_H * 0.3} y2={rsiBottom - RSI_H * 0.3} stroke={c.profit} strokeWidth="0.7" strokeDasharray="3 3" opacity="0.5" />
              <path
                d={path(rsi.filter((p) => at(p.time) != null).map((p) => ({
                  x: x(at(p.time)),
                  y: rsiBottom - (p.value / 100) * RSI_H
                })))}
                fill="none"
                stroke={c.rsi}
                strokeWidth="1.4"
              />
            </g>
            <text x={PAD.left + 2} y={rsiTop - 4} fill={c.dim} fontSize="8" fontWeight="800" className="cgc-axis">
              RSI 14 · {fmt(marks.rsiLast, 1)}
            </text>
          </g>
        )}

        {/* ── the annotation program for the open tool ──────────────────── */}
        <g className="cgc-notes" pointerEvents="none">{annotation()}</g>

        {/* ── crosshair + pinned bar ────────────────────────────────────── */}
        {activeBar && (
          <g className="cgc-cross" pointerEvents="none">
            <line x1={x(activeIdx)} x2={x(activeIdx)} y1={mainTop} y2={mainBottom} stroke={c.crosshair} strokeWidth="0.9" strokeDasharray="3 3" />
            {pinned != null && (
              <line x1={PAD.left} x2={PAD.left + dataW} y1={scale.y(activeBar.close)} y2={scale.y(activeBar.close)} stroke={c.crosshair} strokeWidth="0.7" strokeDasharray="2 4" opacity="0.7" />
            )}
            <circle cx={x(activeIdx)} cy={scale.y(activeBar.close)} r="2.4" fill={activeColor} />
          </g>
        )}

        {/* ── baseline ──────────────────────────────────────────────────── */}
        <line x1={PAD.left} x2={VB_W - PAD.right} y1={mainBottom} y2={mainBottom} stroke={c.axis} strokeWidth="0.6" opacity="0.4" />
      </svg>

      {/* The read-out is real text outside the SVG: selectable, direction-aware,
          and it does not re-render 90 shapes when a finger moves. */}
      {/* No `aria-live` here on purpose: this strip updates on every pointer
          move, and announcing each pixel of a drag would make a screen reader
          unusable. The chart's own label describes it; the numbers are for the
          eye. */}
      <div className="cgc-readout" dir={rtl ? 'rtl' : 'ltr'}>
        {activeBar ? (
          <>
            <span className="cgc-ro-item"><em>O</em>{fmt(activeBar.open)}</span>
            <span className="cgc-ro-item"><em>H</em>{fmt(activeBar.high)}</span>
            <span className="cgc-ro-item"><em>L</em>{fmt(activeBar.low)}</span>
            <span className="cgc-ro-item"><em>C</em>{fmt(activeBar.close)}</span>
            <span className={`cgc-ro-chg ${activeBar.close >= activeBar.open ? 'up' : 'down'}`}>
              {activeBar.close >= activeBar.open ? '+' : ''}
              {(((activeBar.close - activeBar.open) / activeBar.open) * 100).toFixed(2)}%
            </span>
            {pinned != null && <span className="cgc-ro-pin">{t('lab2.cgx.chart.pinned')}</span>}
          </>
        ) : (
          <span className="cgc-ro-hint">{t('lab2.cgx.chart.hint')}</span>
        )}
      </div>
    </div>
  );
}
