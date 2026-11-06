/**
 * AI INTELLIGENCE — SHARED UI PRIMITIVES
 * ---------------------------------------------------------------------------
 * Small, dumb components used by every tab. They hold no data logic, so the
 * tabs stay readable and the numbers on screen always come from one of the
 * pure engines in lib/intelligence.
 *
 * Two rules are coded in here rather than repeated in each screen:
 *   · `null` renders as an em dash, never as 0 or an empty cell that reads
 *     like zero.
 *   · anything derived from a feed carries its provenance dot next to it.
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

export function StatTile({ label, value, sub, tone = 'neutral', hint }) {
  return (
    <div className={`aix-tile aix-tone-${tone}`} title={hint || undefined}>
      <span className="aix-tile-label">{label}</span>
      <strong className="aix-tile-value">{value}</strong>
      {sub ? <span className="aix-tile-sub">{sub}</span> : null}
    </div>
  );
}

export function SectionCard({ title, hint, actions, children, className = '' }) {
  return (
    <section className={`aix-card ${className}`.trim()}>
      {(title || actions) && (
        <header className="aix-card-head">
          <div>
            <h2 className="aix-card-title">{title}</h2>
            {hint ? <p className="aix-card-hint">{hint}</p> : null}
          </div>
          {actions ? <div className="aix-card-actions">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function Meter({ value, max = 100, tone = 'cyan', label }) {
  const pct = value == null || !Number.isFinite(Number(value))
    ? null
    : Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <div className="aix-meter" aria-label={label || undefined}>
      <div className={`aix-meter-fill aix-bar-${tone}`} style={{ width: pct == null ? '0%' : `${pct}%` }} />
      {pct == null ? <span className="aix-meter-na">—</span> : null}
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

export function Change({ value, digits = 2, suffix = '%' }) {
  if (value == null || !Number.isFinite(Number(value))) return <span className="aix-na">—</span>;
  const v = Number(value);
  const tone = v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat';
  return (
    <span className={`aix-change aix-${tone}`}>
      {v > 0 ? '+' : ''}{v.toFixed(digits)}{suffix}
    </span>
  );
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="aix-empty">
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {action || null}
    </div>
  );
}

export function Spark({ values = [], width = 96, height = 28, up = true }) {
  const points = useMemo(() => {
    const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
    if (nums.length < 2) return null;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    return nums
      .map((v, i) => `${(i / (nums.length - 1)) * (width - 2) + 1},${height - 1 - ((v - min) / span) * (height - 2)}`)
      .join(' ');
  }, [values, width, height]);
  if (!points) return <span className="aix-na">—</span>;
  return (
    <svg className={`aix-spark ${up ? 'is-up' : 'is-down'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
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
