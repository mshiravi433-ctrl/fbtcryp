/**
 * DEPTH — the ladder beside the tape.
 * ---------------------------------------------------------------------------
 * A cumulative depth chart drawn from the venue's own book, in SVG, with no
 * charting library: two mirrored staircases (bids left of the mid, asks right)
 * plus the spread and the imbalance. It is deliberately small and still,
 * because the numbers under it are what a trader reads; a moving picture of a
 * book that updates every 5 seconds would be decoration that lies about its
 * own freshness.
 *
 * WHAT IT DOES NOT DO
 *   · it does not smooth or interpolate. A cumulative book IS a step function;
 *     a spline through the levels would invent liquidity between prices.
 *   · it does not draw a book it was not given. An empty ladder says so.
 *   · it scales on CUMULATIVE USD, so a level twice as deep is twice as wide —
 *     the visual is the data, not a decoration of it.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { depthLevels } from './desk.js';

const W = 520;
const H = 140;
const PAD = 4;

/** One side as a closed staircase from the mid outward. */
function sidePath(rows, { maxUsd, maxOffset, side }) {
  if (!rows.length || !(maxUsd > 0) || !(maxOffset > 0)) return '';
  const mid = W / 2;
  const half = W / 2 - PAD;
  const pts = [[mid, H - PAD]];
  for (const r of rows) {
    const x = mid + (side === 'bid' ? -1 : 1) * Math.min(1, Math.abs(r.offsetFromTouchPct || 0) / maxOffset) * half;
    const y = H - PAD - Math.min(1, r.cumulativeUsd / maxUsd) * (H - PAD * 2);
    pts.push([x, y]);
  }
  /* Close the shape along the floor so the fill reads as depth under a curve. */
  pts.push([pts[pts.length - 1][0], H - PAD]);
  return `M ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')} Z`;
}

export default function DepthChart({ book, rows = 14, testId = 'perp-depth-chart' }) {
  const { t } = useTranslation();
  const depth = useMemo(() => depthLevels({ bids: book?.bidDepth, asks: book?.askDepth, rows }), [book, rows]);

  const { bidPath, askPath, reachPct } = useMemo(() => {
    const maxUsd = Math.max(depth.bidUsd, depth.askUsd, 0);
    const maxOffset = Math.max(
      ...depth.bids.map((r) => Math.abs(r.offsetFromTouchPct || 0)),
      ...depth.asks.map((r) => Math.abs(r.offsetFromTouchPct || 0)),
      0
    );
    return {
      bidPath: sidePath(depth.bids, { maxUsd, maxOffset, side: 'bid' }),
      askPath: sidePath(depth.asks, { maxUsd, maxOffset, side: 'ask' }),
      reachPct: maxOffset
    };
  }, [depth]);

  const empty = depth.empty;
  const spreadBps = Number(book?.spreadBps);
  const imbalance = depth.imbalancePct;

  return (
    <div className="pt-depth" data-testid={testId} dir="ltr">
      <div className="pt-panel-head">
        <span className="pt-panel-title">{t('perpTerminal.depth.title', { defaultValue: 'Order book depth' })}</span>
        {Number.isFinite(spreadBps) && (
          <span className="pt-muted pt-mono">
            {t('perpTerminal.depth.spread', { defaultValue: 'spread' })} {spreadBps.toFixed(1)} bps
          </span>
        )}
      </div>

      {empty ? (
        <p className="pt-empty" data-testid="perp-depth-empty">
          {t('perpTerminal.depth.empty', { defaultValue: 'The venue did not return a book for this market.' })}
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="pt-depth-svg" role="img"
            aria-label={t('perpTerminal.depth.alt', { defaultValue: 'Cumulative order book depth, bids on the left and asks on the right' })}>
            <line x1={W / 2} x2={W / 2} y1={PAD} y2={H - PAD} className="pt-depth-mid" />
            {bidPath && <path d={bidPath} className="pt-depth-bid" />}
            {askPath && <path d={askPath} className="pt-depth-ask" />}
          </svg>

          {/* The numbers under the picture: the sides in USD, and the share of
              the visible book that is bids. Read as text, not as colour. */}
          <div className="pt-depth-foot pt-mono">
            <span className="pt-up" data-testid="perp-depth-bid-usd">
              {t('perpTerminal.depth.bids', { defaultValue: 'bids' })} {fmtUsd(depth.bidUsd)}
            </span>
            <span className="pt-muted">
              {reachPct > 0
                ? t('perpTerminal.depth.reach', { defaultValue: 'to ±{{pct}}%', pct: reachPct.toFixed(2) })
                : t('perpTerminal.depth.reachFlat', { defaultValue: 'single level' })}
            </span>
            <span className="pt-down" data-testid="perp-depth-ask-usd">
              {t('perpTerminal.depth.asks', { defaultValue: 'asks' })} {fmtUsd(depth.askUsd)}
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
        </>
      )}
    </div>
  );
}

/* Compact money formatting for the ladder footer. Values above 1e6 shorten to
   a suffix so the label does not push the ask figure off a phone screen. */
function fmtUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
