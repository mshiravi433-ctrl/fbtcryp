/**
 * TREND CHART — a responsive line/area chart with no charting dependency.
 * ---------------------------------------------------------------------------
 * recharts is already in the bundle for the big coin screens, but it is a
 * 90KB lazy chunk and it does not belong on the market home screen or in a
 * trading card that has to paint on a mid-range phone. This is ~60 lines of
 * SVG that costs nothing.
 *
 * It is WIDTH-RESPONSIVE, which `Sparkline` is not: that component takes a
 * fixed pixel width, so anything using it has to guess — and a guess is either
 * too wide (it overflows a 320px phone) or too narrow (a dead letterbox on a
 * tablet). This measures its own container.
 *
 * `points` is `[{ x, y }]` where x is a timestamp and y a number. Points are
 * optional; a plain array of numbers is treated as evenly spaced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PAD_Y = 6;

export default function TrendChart({
  points = [],
  height = 78,
  up = true,
  loading = false,
  emptyLabel = '',
  formatValue = null,
  testId = 'trend-chart'
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (el) setWidth(Math.max(0, Math.round(el.clientWidth)));
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    measure();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const series = useMemo(() => {
    const rows = points
      .map((p, i) => (typeof p === 'number' ? { x: i, y: p } : p))
      .filter((p) => p && Number.isFinite(p.y));
    return rows.length >= 2 ? rows : [];
  }, [points]);

  const geometry = useMemo(() => {
    if (!series.length || width <= 0) return null;
    const ys = series.map((p) => p.y);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const range = max - min || Math.abs(max) || 1;
    const step = width / (series.length - 1);
    const coords = series.map((p, i) => [
      i * step,
      height - PAD_Y - ((p.y - min) / range) * (height - PAD_Y * 2)
    ]);
    const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return { line, area: `${line} L${width},${height} L0,${height} Z`, last: coords[coords.length - 1], min, max };
  }, [series, width, height]);

  const color = up ? 'var(--up, #00ff9d)' : 'var(--down, #ff3b6b)';
  const gid = useMemo(() => `trend-${Math.random().toString(36).slice(2, 9)}`, []);

  if (loading && !series.length) {
    return <div className="skel" style={{ width: '100%', height, borderRadius: 10 }} data-testid={testId} />;
  }

  if (!series.length) {
    return (
      <div
        className="trend-empty"
        style={{ height }}
        data-testid={`${testId}-empty`}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="trend-chart" ref={wrapRef} style={{ height }} data-testid={testId}>
      {geometry && width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geometry.area} fill={`url(#${gid})`} />
          <path
            d={geometry.line}
            fill="none"
            stroke={color}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 0 4px ${up ? 'rgba(0,255,157,.45)' : 'rgba(255,59,107,.45)'})` }}
          />
          <circle cx={geometry.last[0]} cy={geometry.last[1]} r="2.6" fill={color} />
        </svg>
      )}
      {formatValue && geometry && (
        <span className="trend-range mono" aria-hidden="true">
          <b>{formatValue(geometry.max)}</b>
          <i>{formatValue(geometry.min)}</i>
        </span>
      )}
    </div>
  );
}
