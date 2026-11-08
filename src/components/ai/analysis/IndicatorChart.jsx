/**
 * AI INTELLIGENCE — INDICATOR CHART (hand-drawn SVG, no charting dependency)
 * ---------------------------------------------------------------------------
 * Draws, from ONE `computeIndicators()` pack so the picture and the score can
 * never disagree:
 *
 *   · candles (or a line when the window is too dense for bodies)
 *   · Bollinger band envelope + SMA 20 / 50 / 200
 *   · volume bars
 *   · RSI-14 pane with the 30/70 rails
 *   · MACD pane (histogram + line)
 *
 * ─── WHY NOT RECHARTS ───────────────────────────────────────────────────────
 * Recharts is a ~90 KB lazy chunk and this screen needs three linked panes
 * sharing one x-axis plus overlays inside the price area. The SVG here is
 * ~250 lines, paints in one pass, and costs the route nothing beyond itself —
 * which matters on the mid-range Android WebView this app actually ships to
 * (lib/CandleChart.jsx made the same call for the same reason).
 *
 * ─── WHAT IT REFUSES TO DRAW ────────────────────────────────────────────────
 * Nothing. There is no synthetic candle, no interpolated gap and no flat line
 * where an indicator had no data: an empty series renders the "not enough
 * data" line instead of a chart that looks like a measurement.
 */
import { useMemo, useState } from 'react';
import { useElementWidth } from './ui.jsx';

const UP = 'var(--up)';
const DOWN = 'var(--down)';

function extents(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function linePath(values, x, y, count) {
  let d = '';
  let open = false;
  for (let i = 0; i < count; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    open = true;
  }
  return d;
}

function areaPath(upper, lower, x, y, count) {
  const pts = [];
  for (let i = 0; i < count; i += 1) {
    if (Number.isFinite(upper[i]) && Number.isFinite(lower[i])) pts.push([i, upper[i], lower[i]]);
  }
  if (pts.length < 2) return '';
  const top = pts.map(([i, u]) => `${x(i).toFixed(1)},${y(u).toFixed(1)}`).join('L');
  const bottom = [...pts].reverse().map(([i, , l]) => `${x(i).toFixed(1)},${y(l).toFixed(1)}`).join('L');
  return `M${top}L${bottom}Z`;
}

export default function IndicatorChart({ pack, locale = 'fa', maxBars = 120, height = 380 }) {
  const [ref, width] = useElementWidth(680);
  const [hover, setHover] = useState(null);

  const view = useMemo(() => {
    if (!pack || !pack.series?.candles?.length) return null;
    const candles = pack.series.candles;
    const n = Math.min(maxBars, candles.length);
    const start = candles.length - n;
    const window = candles.slice(start);
    const series = {
      sma20: pack.series.sma20.slice(start),
      sma50: pack.series.sma50.slice(start),
      sma200: pack.series.sma200.slice(start),
      bbUpper: pack.series.bollinger.upper.slice(start),
      bbLower: pack.series.bollinger.lower.slice(start),
      bbMiddle: pack.series.bollinger.middle.slice(start),
      rsi: pack.series.rsi14.slice(start),
      macd: pack.series.macd.line.slice(start),
      macdSignal: pack.series.macd.signal.slice(start),
      macdHist: pack.series.macd.hist.slice(start)
    };
    const priceExt = extents([
      ...window.map((c) => c.h),
      ...window.map((c) => c.l),
      ...series.bbUpper,
      ...series.bbLower,
      ...series.sma20,
      ...series.sma50
    ]);
    if (!priceExt) return null;
    return { window, series, priceExt, n, start };
  }, [pack, maxBars]);

  if (!view) {
    return (
      <div className="aix-chart aix-chart-empty" ref={ref}>
        {String(locale || '').startsWith('fa') ? 'کندل کافی برای رسم نمودار نیست' : 'Not enough candles to draw the chart'}
      </div>
    );
  }

  const { window, series, priceExt, n, start } = view;
  const PAD_L = 6;
  const PAD_R = 52;
  const priceH = Math.max(120, Math.round(height * 0.56));
  const volH = Math.round(height * 0.12);
  const rsiH = Math.round(height * 0.14);
  const macdH = Math.round(height * 0.15);
  const gap = 10;
  const totalH = priceH + volH + rsiH + macdH + gap * 3;
  const plotW = Math.max(120, width - PAD_L - PAD_R);

  const step = plotW / n;
  const x = (i) => PAD_L + step * (i + 0.5);

  const pricePad = (priceExt.max - priceExt.min) * 0.06 || priceExt.max * 0.01;
  const pMin = priceExt.min - pricePad;
  const pMax = priceExt.max + pricePad;
  const pY = (v) => priceH - ((v - pMin) / (pMax - pMin || 1)) * priceH;

  const volTop = priceH + gap;
  /* Volume is NOT in this payload (OHLC only), so the pane shows candle RANGE
     as the activity proxy and labels it as such — never "volume". */
  const rangeMax = Math.max(...window.map((c) => c.h - c.l), 1e-9);
  const volY = (v) => volTop + volH - (v / rangeMax) * (volH - 2);

  const rsiTop = volTop + volH + gap;
  const rsiY = (v) => rsiTop + rsiH - (v / 100) * rsiH;

  const macdTop = rsiTop + rsiH + gap;
  const macdExt = extents([...series.macd, ...series.macdSignal, ...series.macdHist]);
  const mMax = Math.max(Math.abs(macdExt?.min ?? 0), Math.abs(macdExt?.max ?? 0), 1e-9);
  const mY = (v) => macdTop + macdH / 2 - (v / mMax) * (macdH / 2 - 2);
  const mZero = macdTop + macdH / 2;

  const bodyW = Math.max(1.4, Math.min(7, step * 0.62));
  const last = window[window.length - 1];
  const fmtDate = (t) => new Date(t).toISOString().slice(5, 10);
  const priceTicks = [pMax, (pMax + pMin) / 2, pMin];

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((px - PAD_L) / step)));
    setHover({ idx, px: x(idx) });
  };

  const hovered = hover ? window[hover.idx] : null;

  return (
    <div className="aix-chart" ref={ref}>
      <svg
        width={width}
        height={totalH}
        viewBox={`0 0 ${width} ${totalH}`}
        role="img"
        aria-label={String(locale || '').startsWith('fa') ? 'نمودار شمعی با اندیکاتورها' : 'Candlestick chart with indicators'}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
      <defs>
        <linearGradient id="aix-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--rgb-2)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--rgb-1)" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* ── price grid ─────────────────────────────────────────── */}
      {priceTicks.map((t, i) => (
        <g key={`pt${i}`}>
          <line className="aix-grid" x1={PAD_L} y1={pY(t)} x2={PAD_L + plotW} y2={pY(t)} />
          <text className="aix-axis" x={width - PAD_R + 6} y={pY(t) + 3}>
            {t >= 1000 ? t.toFixed(0) : t >= 1 ? t.toFixed(2) : t.toPrecision(3)}
          </text>
        </g>
      ))}

      {/* ── bollinger envelope ─────────────────────────────────── */}
      <path d={areaPath(series.bbUpper, series.bbLower, x, pY, n)} fill="url(#aix-band)" />
      <path d={linePath(series.bbMiddle, x, pY, n)} className="aix-line aix-line-bb" fill="none" />
      <path d={linePath(series.sma20, x, pY, n)} className="aix-line aix-line-sma20" fill="none" />
      <path d={linePath(series.sma50, x, pY, n)} className="aix-line aix-line-sma50" fill="none" />
      <path d={linePath(series.sma200, x, pY, n)} className="aix-line aix-line-sma200" fill="none" />

      {/* ── candles ────────────────────────────────────────────── */}
      {window.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? UP : DOWN;
        const top = pY(Math.max(c.o, c.c));
        const bodyH = Math.max(1, Math.abs(pY(c.o) - pY(c.c)));
        return (
          <g key={c.t}>
            <line x1={x(i)} y1={pY(c.h)} x2={x(i)} y2={pY(c.l)} stroke={color} strokeWidth="1" opacity="0.75" />
            <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={color} opacity={up ? 0.9 : 0.85} rx="0.6" />
          </g>
        );
      })}

      {/* last price marker */}
      <line
        className="aix-last-line"
        x1={PAD_L}
        y1={pY(last.c)}
        x2={PAD_L + plotW}
        y2={pY(last.c)}
      />
      <rect className="aix-last-tag" x={width - PAD_R + 2} y={pY(last.c) - 8} width={PAD_R - 4} height={16} rx="4" />
      <text className="aix-last-text" x={width - PAD_R / 2 - 1} y={pY(last.c) + 3.5} textAnchor="middle">
        {last.c >= 1000 ? last.c.toFixed(0) : last.c >= 1 ? last.c.toFixed(2) : last.c.toPrecision(3)}
      </text>

      {/* ── activity pane (candle range, NOT volume) ───────────── */}
      <text className="aix-pane-label" x={PAD_L} y={volTop + 9}>
        {String(locale || '').startsWith('fa') ? 'دامنه کندل' : 'Candle range'}
      </text>
      {window.map((c, i) => {
        const v = c.h - c.l;
        return (
          <rect
            key={`v${c.t}`}
            x={x(i) - bodyW / 2}
            y={volY(v)}
            width={bodyW}
            height={Math.max(1, volTop + volH - volY(v))}
            fill={c.c >= c.o ? UP : DOWN}
            opacity="0.35"
            rx="0.5"
          />
        );
      })}

      {/* ── RSI pane ───────────────────────────────────────────── */}
      <text className="aix-pane-label" x={PAD_L} y={rsiTop + 9}>RSI 14</text>
      {[30, 70].map((lvl) => (
        <line key={`r${lvl}`} className="aix-grid aix-grid-dash" x1={PAD_L} y1={rsiY(lvl)} x2={PAD_L + plotW} y2={rsiY(lvl)} />
      ))}
      <path d={linePath(series.rsi, x, rsiY, n)} className="aix-line aix-line-rsi" fill="none" />
      <text className="aix-axis" x={width - PAD_R + 6} y={rsiY(70) + 3}>70</text>
      <text className="aix-axis" x={width - PAD_R + 6} y={rsiY(30) + 3}>30</text>

      {/* ── MACD pane ──────────────────────────────────────────── */}
      <text className="aix-pane-label" x={PAD_L} y={macdTop + 9}>MACD</text>
      <line className="aix-grid" x1={PAD_L} y1={mZero} x2={PAD_L + plotW} y2={mZero} />
      {series.macdHist.map((v, i) => {
        if (!Number.isFinite(v)) return null;
        const yTop = Math.min(mY(v), mZero);
        return (
          <rect
            key={`m${i}`}
            x={x(i) - bodyW / 2}
            y={yTop}
            width={bodyW}
            height={Math.max(0.8, Math.abs(mY(v) - mZero))}
            fill={v >= 0 ? UP : DOWN}
            opacity="0.45"
            rx="0.5"
          />
        );
      })}
      <path d={linePath(series.macd, x, mY, n)} className="aix-line aix-line-macd" fill="none" />
      <path d={linePath(series.macdSignal, x, mY, n)} className="aix-line aix-line-signal" fill="none" />

      {/* ── time axis ──────────────────────────────────────────── */}
      <text className="aix-axis" x={PAD_L} y={totalH - 1}>{fmtDate(window[0].t)}</text>
      <text className="aix-axis" x={PAD_L + plotW / 2} y={totalH - 1} textAnchor="middle">
        {fmtDate(window[Math.floor(n / 2)].t)}
      </text>
      <text className="aix-axis" x={PAD_L + plotW} y={totalH - 1} textAnchor="end">{fmtDate(last.t)}</text>

      {/* ── crosshair ──────────────────────────────────────────── */}
      {hover ? (
        <g>
          <line className="aix-cross" x1={hover.px} y1={0} x2={hover.px} y2={macdTop + macdH} />
        </g>
      ) : null}
      </svg>

      <div className="aix-chart-foot">
        <span className="aix-line-key aix-key-sma20">SMA20</span>
        <span className="aix-line-key aix-key-sma50">SMA50</span>
        <span className="aix-line-key aix-key-sma200">SMA200</span>
        <span className="aix-line-key aix-key-bb">Bollinger</span>
        <span className="aix-chart-meta">
          {window.length} {String(locale || '').startsWith('fa') ? 'کندل' : 'bars'}
          {' · '}
          {String(locale || '').startsWith('fa') ? 'شروع ایندکس' : 'offset'} {start}
        </span>
      </div>

      {hovered ? (
        <div className="aix-chart-readout" style={{ left: Math.min(Math.max(hover.px - 60, 4), Math.max(4, width - 130)) }}>
          <strong>{fmtDate(hovered.t)}</strong>
          <span>O {hovered.o.toPrecision(5)}</span>
          <span>H {hovered.h.toPrecision(5)}</span>
          <span>L {hovered.l.toPrecision(5)}</span>
          <span>C {hovered.c.toPrecision(5)}</span>
        </div>
      ) : null}
    </div>
  );
}
