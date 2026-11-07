/**
 * AI INTELLIGENCE — SHARED UI PRIMITIVES
 * ---------------------------------------------------------------------------
 * Small, dumb components used by every tab. They hold no data logic, so the
 * tabs stay readable and the numbers on screen always come from one of the
 * pure engines in lib/intelligence.
 *
 * ─── THE MODERN PASS (why this file was rewritten) ──────────────────────────
 * «در هوش بازار … دکمه‌ها و باکس‌ها و اطلاعات که نشان می‌دهد باید خیلی مدرن‌تر
 *  و خاص‌تر باشد»
 *
 * The old primitives were flat rectangles with a 1px border. They were honest
 * and quiet, and they read like a settings screen rather than an intelligence
 * desk. This pass keeps every number and every honesty rule EXACTLY as it was
 * and changes only how a reading is DRAWN:
 *
 *   · `StatTile` becomes a layered reading — an accent rail, a hairline
 *     highlight, a micro-trend, an optional gauge arc and an optional count-up
 *     on the value. The tone still drives the colour, so a bad number is still
 *     visibly bad.
 *   · `SectionCard` gains a header mark and a soft top light, so a column of
 *     cards has hierarchy instead of being one flat list.
 *   · `Meter` / `ScoreRing` get centre labels and a tone-matched glow.
 *   · `Spark` gains an area fill and an end dot.
 *
 * ─── WHAT DID NOT CHANGE, ON PURPOSE ────────────────────────────────────────
 *   · `null` renders as an em dash, never as 0 or an empty cell that reads
 *     like zero.
 *   · anything derived from a feed carries its provenance dot next to it.
 *   · no component here fetches, computes or defaults a financial value.
 *   · all colour comes from theme tokens, so the light theme still works.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export const PROVENANCE_TONE = {
  live: 'up',
  stale: 'warn',
  offline: 'down',
  unknown: 'muted'
};

export function ProvenanceDot({ provenance = 'unknown', label }) {
  return (
    <span className={`aix-prov aix-prov-${PROVENANCE_TONE[provenance] || 'muted'}`} title={label || provenance}>
      <i aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

/**
 * Count from 0 to `value` once on mount (and whenever the value moves).
 *
 * ─── WHY A HOOK AND NOT A KEYFRAME ──────────────────────────────────────────
 * The number is text, and CSS cannot tween text. requestAnimationFrame can,
 * and it stops the moment the component unmounts or the tab is hidden, so an
 * off-screen tile is not scheduling frames. `prefers-reduced-motion` skips
 * the animation entirely and prints the final value — an animated number is
 * decoration, and decoration must never be the thing standing between a
 * reader and their balance.
 */
export function useCountUp(target, { duration = 620, enabled = true } = {}) {
  const numeric = Number(target);
  const canAnimate = enabled && Number.isFinite(numeric)
    && typeof window !== 'undefined'
    && typeof window.requestAnimationFrame === 'function'
    && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const [shown, setShown] = useState(() => (canAnimate ? 0 : (Number.isFinite(numeric) ? numeric : null)));

  useEffect(() => {
    if (!canAnimate) {
      setShown(Number.isFinite(numeric) ? numeric : null);
      return undefined;
    }
    let raf = 0;
    let start = 0;
    const from = 0;
    const step = (ts) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      /* easeOutCubic — fast first, settling on the real value. */
      const eased = 1 - (1 - t) ** 3;
      setShown(from + (numeric - from) * eased);
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [numeric, duration, canAnimate]);

  return shown;
}

/**
 * A reading. `value` may be a string (already formatted, counted up by the
 * caller) or a node. `gauge` is 0..100 and draws the arc; it is only ever
 * passed when the number really is a share of a whole, because a ring on a
 * number that is not a percentage is a lie drawn in a circle.
 */
export function StatTile({
  label, value, sub, tone = 'neutral', hint, gauge, icon, trend, className = ''
}) {
  const pct = gauge == null || !Number.isFinite(Number(gauge))
    ? null
    : Math.max(0, Math.min(100, Number(gauge)));
  const arcLen = 2 * Math.PI * 15;
  return (
    <div className={`aix-tile aix-tone-${tone}${className ? ` ${className}` : ''}`} title={hint || undefined}>
      <span className="aix-tile-glow" aria-hidden="true" />
      <div className="aix-tile-top">
        {icon ? <span className="aix-tile-icon" aria-hidden="true">{icon}</span> : null}
        <span className="aix-tile-label">{label}</span>
      </div>
      <div className="aix-tile-figure">
        <strong className="aix-tile-value">{value}</strong>
        {pct != null ? (
          <svg className="aix-tile-gauge" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="aix-tile-gauge-track" cx="18" cy="18" r="15" />
            <circle
              className="aix-tile-gauge-arc"
              cx="18"
              cy="18"
              r="15"
              strokeDasharray={`${(pct / 100) * arcLen} ${arcLen}`}
              transform="rotate(-90 18 18)"
            />
          </svg>
        ) : null}
      </div>
      {sub ? <span className="aix-tile-sub">{sub}</span> : null}
      {trend ? <span className="aix-tile-trend">{trend}</span> : null}
    </div>
  );
}

/* `sectionProps` lets a caller attach an id, a test hook or an aria label to
   the frame without SectionCard having to know every attribute up front. */
export function SectionCard({ title, hint, actions, children, className = '', mark, ...sectionProps }) {
  return (
    <section className={`aix-card ${className}`.trim()} {...sectionProps}>
      <span className="aix-card-sheen" aria-hidden="true" />
      {(title || actions) && (
        <header className="aix-card-head">
          <div className="aix-card-heading">
            {mark ? <span className="aix-card-mark" aria-hidden="true">{mark}</span> : null}
            <div>
              <h2 className="aix-card-title">{title}</h2>
              {hint ? <p className="aix-card-hint">{hint}</p> : null}
            </div>
          </div>
          {actions ? <div className="aix-card-actions">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function Meter({ value, max = 100, tone = 'cyan', label, caption }) {
  const pct = value == null || !Number.isFinite(Number(value))
    ? null
    : Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <div className="aix-meter-wrap">
      <div className={`aix-meter aix-meter-${tone}`} aria-label={label || undefined} role="presentation">
        <div className={`aix-meter-fill aix-bar-${tone}`} style={{ width: pct == null ? '0%' : `${pct}%` }} />
        {pct == null ? <span className="aix-meter-na">—</span> : null}
      </div>
      {caption ? <span className="aix-meter-caption">{caption}</span> : null}
    </div>
  );
}

const BAND_TONE = {
  strong: 'mint',
  constructive: 'cyan',
  neutral: 'violet',
  cautious: 'amber',
  weak: 'rose'
};

export function ScoreRing({ value, band, size = 108, caption }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = BAND_TONE[band] || 'violet';
  return (
    <div className={`aix-ring aix-ring-${tone}`} style={{ width: size, height: size }}>
      <span className="aix-ring-halo" aria-hidden="true" />
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={caption || ''}>
        <circle className="aix-ring-track" cx={size / 2} cy={size / 2} r={r} />
        <circle
          className="aix-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="aix-ring-center">
        <strong>{value == null ? '—' : Math.round(value)}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

export function Chip({ active = false, onClick, children, title }) {
  return (
    <button type="button" className={`aix-chip${active ? ' is-active' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function Change({ value, digits = 2, suffix = '%', arrow = false }) {
  if (value == null || !Number.isFinite(Number(value))) return <span className="aix-na">—</span>;
  const v = Number(value);
  const tone = v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat';
  return (
    <span className={`aix-change aix-${tone}`}>
      {arrow ? <span className="aix-change-arrow" aria-hidden="true">{v > 0 ? '▲' : v < 0 ? '▼' : '·'}</span> : null}
      {v > 0 ? '+' : ''}{v.toFixed(digits)}{suffix}
    </span>
  );
}

export function EmptyState({ title, hint, action, icon }) {
  return (
    <div className="aix-empty">
      {icon ? <span className="aix-empty-icon" aria-hidden="true">{icon}</span> : null}
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {action || null}
    </div>
  );
}

/**
 * Sparkline. The AREA under the line is what makes a small chart readable at a
 * glance; the end dot marks "now" so the eye lands on the current value rather
 * than the last pixel. Both are geometry, not data — nothing here is invented.
 */
export function Spark({ values = [], width = 96, height = 28, up = true }) {
  const geo = useMemo(() => {
    const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
    if (nums.length < 2) return null;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const pts = nums.map((v, i) => [
      (i / (nums.length - 1)) * (width - 2) + 1,
      height - 1 - ((v - min) / span) * (height - 2)
    ]);
    return {
      line: pts.map(([x, y]) => `${x},${y}`).join(' '),
      area: `1,${height} ${pts.map(([x, y]) => `${x},${y}`).join(' ')} ${width - 1},${height}`,
      last: pts[pts.length - 1]
    };
  }, [values, width, height]);

  if (!geo) return <span className="aix-na">—</span>;
  const gid = `aix-spark-${up ? 'u' : 'd'}`;
  return (
    <svg
      className={`aix-spark ${up ? 'is-up' : 'is-down'}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={geo.area} fill={`url(#${gid})`} stroke="none" />
      <polyline points={geo.line} fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle className="aix-spark-dot" cx={geo.last[0]} cy={geo.last[1]} r="1.9" />
    </svg>
  );
}

/**
 * Responsive width for SVG charts without a charting dependency.
 * Returns `[ref, width]`; width starts at `initial` so the first paint is not
 * a zero-width frame.
 */
export function useElementWidth(initial = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect?.width || 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Tiny multi-line chart used by the comparison tab (normalised 7d series). */
export function MultiLine({ series = [], height = 150 }) {
  const [ref, width] = useElementWidth(560);
  const colors = ['var(--rgb-1)', 'var(--rgb-2)', 'var(--rgb-3)', 'var(--rgb-5)'];
  const rows = series.filter((s) => Array.isArray(s.values) && s.values.length > 1);
  const all = rows.flatMap((s) => s.values.map(Number)).filter(Number.isFinite);
  if (!rows.length || all.length < 2) return <EmptyState title="—" />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 8;
  return (
    <div ref={ref} className="aix-multiline">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="normalised performance">
        {rows.map((s, idx) => {
          const pts = s.values
            .map((v, i) => {
              const x = pad + (i / (s.values.length - 1)) * (width - pad * 2);
              const y = height - pad - ((Number(v) - min) / span) * (height - pad * 2);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
          return (
            <polyline
              key={s.symbol}
              points={pts}
              fill="none"
              stroke={colors[idx % colors.length]}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="aix-legend">
        {rows.map((s, idx) => (
          <span key={s.symbol} className="aix-legend-item">
            <i style={{ background: colors[idx % colors.length] }} aria-hidden="true" />
            {s.symbol}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A horizontal share bar with a label, a value and an optional rank badge.
 * Used for allocation, network split, breadth and holdings — the four places
 * the old screen drew three different bars that all meant "this is a share".
 */
export function ShareBar({
  label, value, weight, tone = 'violet', detail, badge, onClick
}) {
  const pct = weight == null || !Number.isFinite(Number(weight))
    ? null
    : Math.max(0, Math.min(100, Number(weight)));
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`aix-share${onClick ? ' is-action' : ''}`}
      onClick={onClick || undefined}
    >
      <span className="aix-share-head">
        {badge ? <span className="aix-share-badge">{badge}</span> : null}
        <span className="aix-share-name">{label}</span>
        <span className="aix-share-value">{value}</span>
      </span>
      <span className="aix-share-track">
        <i className={`aix-bar-${tone}`} style={{ width: pct == null ? '0%' : `${Math.max(1, pct)}%` }} />
      </span>
      <span className="aix-share-foot">
        <span>{pct == null ? '—' : `${pct.toFixed(1)}%`}</span>
        {detail ? <span className="aix-share-detail">{detail}</span> : null}
      </span>
    </Tag>
  );
}

/** Severity / status pill. One shape for every badge on the page. */
export function Pill({ tone = 'neutral', children, dot = false, title }) {
  return (
    <span className={`aix-pill aix-pill-${tone}`} title={title}>
      {dot ? <i aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
