import { useTranslation } from 'react-i18next';

/**
 * Tiny shared Smart Money visuals (upgrade 2026-10-25).
 * Kept dependency-light on purpose: the per-token card (CoinDetail) needs
 * these two widgets and must not drag the whole Intelligence workspace —
 * polling, graph, pipeline — into the coin page's chunk.
 */

/** Mini bar sparkline of signed net flow per window slice (server buckets).
 * Positive = net buying in that slice. Pure display of observed swaps. */
export function FlowSpark({ buckets, width = 72, height = 24 }) {
  if (!Array.isArray(buckets) || !buckets.length || buckets.every((v) => !v)) return null;
  const max = Math.max(...buckets.map((v) => Math.abs(v)), 1);
  const bw = width / buckets.length;
  const mid = height / 2;
  return (
    <svg className="smi-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1="0" y1={mid} x2={width} y2={mid} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      {buckets.map((v, i) => {
        const h = Math.max(1, (Math.abs(v) / max) * (mid - 1));
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={v >= 0 ? mid - h : mid}
            width={Math.max(1, bw - 1.5)}
            height={h}
            rx="1"
            fill={v >= 0 ? '#48dca8' : '#fd789a'}
            fillOpacity={v === 0 ? 0.25 : 0.9}
          />
        );
      })}
    </svg>
  );
}

/** Trend vs the previous equal window. Colour follows the CURRENT net sign
 * (strengthening distribution is heavier selling, not «good»); REVERSING is
 * its own amber state; NEW/STEADY/WEAKENING stay neutral. */
export function TrendChip({ row }) {
  const { t } = useTranslation();
  const m = row?.momentum;
  if (!m?.trend) return null;
  const arrows = { STRENGTHENING: row.netFlowUsd >= 0 ? '↗' : '↘', WEAKENING: '→', REVERSING: '⇄', STEADY: '→', NEW: '✦' };
  const tone = m.trend === 'REVERSING' ? 'flip'
    : m.trend === 'STRENGTHENING' ? (row.netFlowUsd >= 0 ? 'up' : 'down') : 'idle';
  return (
    <span className={`smi-trend ${tone}`}>
      {arrows[m.trend] || '→'} {t(`sm.engine.trend.${m.trend}`)}
      {m.changePct != null && m.trend !== 'REVERSING' ? ` ${m.changePct > 0 ? '+' : ''}${m.changePct}%` : ''}
    </span>
  );
}
