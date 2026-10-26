import { useId, useMemo } from 'react';

/**
 * Tiny inline SVG chart with a draw-in animation and gradient fill.
 * Deliberately dependency-free — recharts is reserved for the big charts.
 */
/**
 * `glow` — the soft drop-shadow around the stroke.
 *
 * It is beautiful on a hero card and expensive in a list: a drop-shadow makes
 * the browser rasterise each SVG through a blur filter, and the market list can
 * hold sixty of them. Callers that draw many small sparks at once pass
 * `glow={false}`; the animated draw-in stays, because it runs once.
 */
/**
 * `animate` — the draw-in animation of the stroke.
 *
 * It is lovely on a hero card and it is SIXTY simultaneous CSS animations in a
 * market list, restarted every time the sort changes or the page polls. Callers
 * that draw many small charts at once pass `animate={false}`: the line is drawn
 * complete, on the first frame, with no dash offset and no keyframe running.
 */
export default function Sparkline({
  data = [],
  width = 74,
  height = 30,
  up = true,
  strokeWidth = 1.6,
  fill = true,
  glow = true,
  animate = true
}) {
  const gid = useId().replace(/:/g, '');

  const { d, area } = useMemo(() => {
    const pts = data.filter((n) => Number.isFinite(n));
    if (pts.length < 2) return { d: '', area: '' };
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const step = width / (pts.length - 1);
    const coords = pts.map((v, i) => [i * step, height - ((v - min) / range) * (height - 3) - 1.5]);
    const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return { d: line, area: `${line} L${width},${height} L0,${height} Z` };
  }, [data, width, height]);

  if (!d) return <div className="skel" style={{ width, height }} />;

  const color = up ? 'var(--up)' : 'var(--down)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: glow ? 'visible' : 'hidden' }}>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#g${gid})`} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: glow
            ? `drop-shadow(0 0 4px ${up ? 'rgba(0,255,157,.55)' : 'rgba(255,59,107,.55)'})`
            : undefined,
          ...(animate
            ? { strokeDasharray: 400, strokeDashoffset: 0, animation: 'spark-draw 1.1s ease-out' }
            : null)
        }}
      />
    </svg>
  );
}
