import { useId, useMemo, useState } from 'react';
import { fmtCompact } from '../../lib/format.js';

const W = 320;
const H = 72;
const PAD = 6;

/**
 * Responsive sparkline with an optional pointer/keyboard read-out.
 *
 * The viewBox scales to the container, so there is no ResizeObserver and no
 * fixed-pixel overflow on small phones. Non-interactive instances (inside a
 * card button) render as plain decoration and never create a nested control.
 */
export default function MarketSparkline({
  points = [],
  up = true,
  height = 64,
  interactive = false,
  label,
  formatValue = fmtCompact,
  formatTime,
  className = '',
  testId
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [active, setActive] = useState(null);
  const series = useMemo(() => (Array.isArray(points) ? points : [])
    .map((point, index) => (typeof point === 'number' ? { x: index, y: point } : point))
    .filter((point) => point && Number.isFinite(Number(point.y)))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) })), [points]);

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    const ys = series.map((point) => point.y);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const range = max - min || Math.abs(max) || 1;
    const firstX = series[0].x;
    const spanX = series.at(-1).x - firstX;
    const timed = Number.isFinite(spanX) && spanX > 0 && series.every((point) => Number.isFinite(point.x));
    const coords = series.map((point, index) => [
      timed ? ((point.x - firstX) / spanX) * (W - PAD * 2) + PAD : (index / (series.length - 1)) * (W - PAD * 2) + PAD,
      H - PAD - ((point.y - min) / range) * (H - PAD * 2)
    ]);
    const line = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return { coords, line, area: `${line} L${W - PAD},${H} L${PAD},${H} Z` };
  }, [series]);

  if (!geometry) return null;

  const index = active == null ? series.length - 1 : Math.max(0, Math.min(series.length - 1, active));
  const point = series[index];
  const [cx, cy] = geometry.coords[index];
  const color = up ? 'var(--mx-up)' : 'var(--mx-down)';
  const readout = `${formatValue(point.y)}${formatTime && Number.isFinite(point.x) ? ` · ${formatTime(point.x)}` : ''}`;

  const locate = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (series.length - 1)));
  };

  const onKeyDown = (event) => {
    if (!interactive) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive((current) => {
        const base = current == null ? series.length - 1 : current;
        return Math.max(0, Math.min(series.length - 1, base + (event.key === 'ArrowRight' ? 1 : -1)));
      });
    } else if (event.key === 'Home') {
      event.preventDefault(); setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault(); setActive(series.length - 1);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  return (
    <div
      className={`mx-spark ${interactive ? 'is-interactive' : ''} ${className}`}
      style={{ height }}
      data-testid={testId}
      role={interactive ? 'group' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      aria-hidden={interactive ? undefined : true}
      onPointerMove={interactive ? locate : undefined}
      onPointerLeave={interactive ? () => setActive(null) : undefined}
      onKeyDown={onKeyDown}
      onBlur={interactive ? () => setActive(null) : undefined}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`mx-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill={`url(#mx-fill-${uid})`} />
        <path d={geometry.line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {interactive && active != null && (
          <line x1={cx} x2={cx} y1={PAD} y2={H - PAD} stroke="var(--mx-line-strong)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        <circle cx={cx} cy={cy} r="3" fill={color} />
      </svg>
      {interactive && (
        <output className="mx-spark-readout mono" aria-live="polite">
          {readout}
        </output>
      )}
    </div>
  );
}
