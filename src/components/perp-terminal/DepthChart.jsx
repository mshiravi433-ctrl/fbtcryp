/**
 * DEPTH — Redesigned cumulative order book depth stage.
 * ---------------------------------------------------------------------------
 * Preserves exact venue staircase geometry and USD imbalance numbers while
 * framing the depth ladder inside a recessed glass telemetry box.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { depthLevels } from './desk.js';

const W = 520;
const H = 136;
const PAD = 6;

/** One side as a closed staircase from the mid outward + stroke path. */
function sidePaths(rows, { maxUsd, maxOffset, side }) {
  if (!rows.length || !(maxUsd > 0) || !(maxOffset > 0)) return { area: '', line: '' };
  const mid = W / 2;
  const half = W / 2 - PAD;
  const pts = [[mid, H - PAD]];
  for (const r of rows) {
    const x = mid + (side === 'bid' ? -1 : 1) * Math.min(1, Math.abs(r.offsetFromTouchPct || 0) / maxOffset) * half;
    const y = H - PAD - Math.min(1, r.cumulativeUsd / maxUsd) * (H - PAD * 2);
    pts.push([x, y]);
  }
  const line = `M ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')}`;
  const closed = [...pts, [pts[pts.length - 1][0], H - PAD]];
  const area = `M ${closed.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')} Z`;
  return { area, line };
}

function fmtUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function DepthChart({ book, rows = 14, testId = 'perp-depth-chart' }) {
  const { t } = useTranslation();
  const depth = useMemo(() => depthLevels({ bids: book?.bidDepth, asks: book?.askDepth, rows }), [book, rows]);

  const { bid, ask, reachPct } = useMemo(() => {
    const maxUsd = Math.max(depth.bidUsd, depth.askUsd, 0);
    const maxOffset = Math.max(
      ...depth.bids.map((r) => Math.abs(r.offsetFromTouchPct || 0)),
      ...depth.asks.map((r) => Math.abs(r.offsetFromTouchPct || 0)),
      0
    );
    return {
      bid: sidePaths(depth.bids, { maxUsd, maxOffset, side: 'bid' }),
      ask: sidePaths(depth.asks, { maxUsd, maxOffset, side: 'ask' }),
      reachPct: maxOffset
    };
  }, [depth]);

  const empty = depth.empty;
  const spreadBps = Number(book?.spreadBps);
  const imbalance = depth.imbalancePct;

  return (
    <div className="pt-depth" data-testid={testId}>
      <div className="pt-panel-head">
        <div className="pt-panel-title-wrap">
          <span className="pt-panel-dot is-cyan" aria-hidden="true" />
          <span className="pt-panel-title">{t('perpTerminal.depth.title', { defaultValue: 'Order book depth' })}</span>
        </div>
        {Number.isFinite(spreadBps) && (
          <span className="pt-pill-stat pt-mono">
            {t('perpTerminal.depth.spread', { defaultValue: 'spread' })} {spreadBps.toFixed(1)} bps
          </span>
        )}
      </div>

      {empty ? (
        <div className="pt-empty-box">
          <span className="pt-empty-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 15l4-4 4 3 5-6" />
            </svg>
          </span>
          <p className="pt-empty" data-testid="perp-depth-empty">
            {t('perpTerminal.depth.empty', { defaultValue: 'The venue did not return a book for this market.' })}
          </p>
        </div>
      ) : (
        <div className="pt-depth-stage">
          <div className="pt-depth-canvas" dir="ltr">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="pt-depth-svg"
              role="img"
              aria-label={t('perpTerminal.depth.alt', { defaultValue: 'Cumulative order book depth, bids on the left and asks on the right' })}
            >
              <defs>
                <linearGradient id="ptBidGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pt-up, #2ee59d)" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="var(--pt-up, #2ee59d)" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id="ptAskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pt-down, #ff5d7a)" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="var(--pt-down, #ff5d7a)" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <line x1={PAD} x2={W - PAD} y1={H * 0.35} y2={H * 0.35} className="pt-depth-grid" />
              <line x1={PAD} x2={W - PAD} y1={H * 0.7} y2={H * 0.7} className="pt-depth-grid" />
              <line x1={W / 2} x2={W / 2} y1={PAD} y2={H - PAD} className="pt-depth-mid" />
              {bid.area && <path d={bid.area} fill="url(#ptBidGrad)" />}
              {bid.line && <path d={bid.line} className="pt-depth-bid-line" />}
              {ask.area && <path d={ask.area} fill="url(#ptAskGrad)" />}
              {ask.line && <path d={ask.line} className="pt-depth-ask-line" />}
            </svg>
          </div>

          <div className="pt-depth-foot pt-mono" dir="ltr">
            <span className="pt-depth-pod is-up" data-testid="perp-depth-bid-usd">
              {t('perpTerminal.depth.bids', { defaultValue: 'bids' })} <strong>{fmtUsd(depth.bidUsd)}</strong>
            </span>
            <span className="pt-depth-pod is-mid">
              {reachPct > 0
                ? t('perpTerminal.depth.reach', { defaultValue: 'to ±{{pct}}%', pct: reachPct.toFixed(2) })
                : t('perpTerminal.depth.reachFlat', { defaultValue: 'single level' })}
            </span>
            <span className="pt-depth-pod is-down" data-testid="perp-depth-ask-usd">
              {t('perpTerminal.depth.asks', { defaultValue: 'asks' })} <strong>{fmtUsd(depth.askUsd)}</strong>
            </span>
          </div>

          {imbalance != null && (
            <div className="pt-imbalance" title={t('perpTerminal.depth.imbalanceHint', { defaultValue: 'Share of the visible book that is bids' })}>
              <div className="pt-imbalance-bar">
                <span className="pt-imbalance-bid" style={{ width: `${imbalance.toFixed(1)}%` }} />
              </div>
              <span className="pt-mono pt-muted" data-testid="perp-depth-imbalance">
                {imbalance.toFixed(0)}% {t('perpTerminal.depth.bidSide', { defaultValue: 'bid' })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
