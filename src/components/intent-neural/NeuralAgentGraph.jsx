/**
 * NEURAL AGENT GRAPH — desktop orchestrator visualization.
 * ---------------------------------------------------------------------------
 * A central orchestrator node wired to the REAL specialist agents (the same
 * automations + monitors the cards list). Rendered only on wide screens via
 * CSS; mobile keeps the vertical cards. No fabricated confidence or perf
 * numbers — status comes straight from each agent's own state.
 */
import { memo, useMemo } from 'react';

function shortName(name, max = 14) {
  const s = String(name || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const NeuralAgentGraph = memo(function NeuralAgentGraph({
  locale = 'fa',
  agents = [],
  activeCount = 0,
  totalCount = 0,
  onSelect
}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const nodes = useMemo(() => (Array.isArray(agents) ? agents.slice(0, 8) : []), [agents]);
  if (!nodes.length) return null;

  const W = 560;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 205;
  const ry = 105;

  const pts = nodes.map((_, i) => {
    const a = (Math.PI * 2 * i) / nodes.length - Math.PI / 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });

  return (
    <div className="fbt-graph" data-testid="neural-agent-graph" role="img"
      aria-label={fa ? `گراف هماهنگی: ${activeCount} فعال از ${totalCount}` : `Orchestration graph: ${activeCount} of ${totalCount} active`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="fbtGraphEdge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.55" />
            <stop offset="1" stopColor="#818cf8" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        {pts.map((p, i) => {
          const live = nodes[i].status === 'ACTIVE';
          return (
            <g key={`e-${nodes[i].id}`}>
              <line x1={cx} y1={cy} x2={p.x} y2={p.y}
                className="fbt-graph-edge" data-live={live ? 'true' : 'false'} />
              {live ? (
                <circle r="2.4" className="fbt-graph-pulse">
                  <animateMotion dur={`${2.4 + (i % 3) * 0.7}s`} repeatCount="indefinite" path={`M ${cx} ${cy} L ${p.x} ${p.y}`} />
                </circle>
              ) : null}
            </g>
          );
        })}
        {/* orchestrator */}
        <g className="fbt-graph-hub">
          <circle cx={cx} cy={cy} r="34" className="fbt-graph-hub-halo" />
          <circle cx={cx} cy={cy} r="22" className="fbt-graph-hub-core" />
          <path d={`M ${cx} ${cy - 9} c 0 5 -4 9 -9 9 5 0 9 4 9 9 0 -5 4 -9 9 -9 -5 0 -9 -4 -9 -9 Z`} className="fbt-graph-hub-spark" />
        </g>
        {pts.map((p, i) => {
          const n = nodes[i];
          const live = n.status === 'ACTIVE';
          return (
            <g key={`n-${n.id}`} className="fbt-graph-node" data-live={live ? 'true' : 'false'}
              onClick={() => onSelect?.(n)} style={onSelect ? { cursor: 'pointer' } : undefined}>
              <circle cx={p.x} cy={p.y} r="13" className="fbt-graph-node-ring" />
              <circle cx={p.x} cy={p.y} r="4.5" className="fbt-graph-node-dot" />
              <text x={p.x} y={p.y + 28} textAnchor="middle" className="fbt-graph-node-label">
                {shortName(n.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="fbt-graph-legend">
        <span className="fbt-graph-legend-live"><i />{fa ? `${activeCount} فعال` : `${activeCount} active`}</span>
        <span className="fbt-graph-legend-total">{fa ? `هماهنگ‌کننده مرکزی · ${totalCount} ایجنت` : `Central orchestrator · ${totalCount} agents`}</span>
      </div>
    </div>
  );
});

export default NeuralAgentGraph;
