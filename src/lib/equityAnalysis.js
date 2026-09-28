/**
 * WHAT THE PAST SAYS ABOUT ONE TOKENIZED EQUITY.
 * ---------------------------------------------------------------------------
 * Requested directly: «هیچ گزینه‌ای برای اینکه ببینیم در گذشته چه شده نیست» —
 * there was no way to see what had already happened to a stock before buying
 * it. This module is the measurement half of that answer, and it is a separate
 * file from the React that renders it for the same reason lib/history.js is:
 * pure arithmetic over an array of numbers can be tested exhaustively and
 * cannot slow a screen down.
 *
 * ─── THE RULE THAT SHAPES EVERY FUNCTION HERE ───────────────────────────────
 * NOTHING IN THIS FILE PREDICTS ANYTHING.
 *
 * Every value returned is a count, a distance or a percentage measured from
 * prices that already printed. "The worst fall in this window was 12%" is a
 * fact. "It will not fall that far again" is a forecast, and a forecast
 * dressed as analysis is how someone loses money believing they were told
 * something reliable — which is also the fastest way to attract regulatory
 * attention in the market this app serves.
 *
 * So there is no target price, no "expected return", no score, and no
 * recommendation anywhere in this file. Where a sample is too small to carry a
 * percentage, the value is withheld rather than rounded into confidence.
 */

import {
  baseRate,
  historyFacts,
  maxDrawdown,
  rangePosition
} from './history.js';
import { liquidityVerdict, MAX_POOL_SHARE } from './solanaAssets.js';

/** The window the panel measures. Matches the gold panel, on purpose. */
export const EQUITY_HISTORY_DAYS = 90;

/** Strip anything that is not a usable positive price. */
function clean(series) {
  return (series ?? []).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Largest single-step move in the window, up and down, as percentages.
 *
 * Returns null rather than 0 when the series is too short to have a step —
 * "this stock has never moved" would be a claim, not a measurement.
 */
export function dailyExtremes(series) {
  const v = clean(series);
  if (v.length < 3) return null;

  let best = -Infinity;
  let worst = Infinity;
  for (let i = 1; i < v.length; i += 1) {
    const prev = v[i - 1];
    if (!(prev > 0)) continue;
    const move = ((v[i] - prev) / prev) * 100;
    if (move > best) best = move;
    if (move < worst) worst = move;
  }
  if (!Number.isFinite(best) || !Number.isFinite(worst)) return null;
  return { best, worst };
}

/**
 * Mean absolute daily move — this series' own idea of "a normal day".
 *
 * MEDIAN is deliberately not used here and mean is: the question is "how much
 * does this usually move", and a single split or halt day should be allowed to
 * show up as an outlier in `dailyExtremes` instead of being quietly averaged
 * away. Both numbers are shown, so the reader can see the spread.
 */
export function averageDailyMove(series) {
  const v = clean(series);
  if (v.length < 3) return null;

  let sum = 0;
  let n = 0;
  for (let i = 1; i < v.length; i += 1) {
    const prev = v[i - 1];
    if (!(prev > 0)) continue;
    sum += Math.abs(((v[i] - prev) / prev) * 100);
    n += 1;
  }
  if (!n) return null;
  return sum / n;
}

/**
 * Percentage change across the whole window.
 *
 * First point to last point, never last-to-current-price: the current price is
 * already on the row, and measuring from it would make the number depend on
 * when the reader opened the panel.
 */
export function windowChange(series) {
  const v = clean(series);
  if (v.length < 2) return null;
  const first = v[0];
  const last = v[v.length - 1];
  if (!(first > 0)) return null;
  return ((last - first) / first) * 100;
}

/**
 * The full fact list for one equity's history.
 *
 * `historyFacts()` already answers the questions that matter — the nearest
 * level and how it behaved, where the price sits in the range, the worst fall,
 * and the historical base rate. This wrapper adds the four numbers specific to
 * a 90-day equity window and keeps the same `{ id, kind, values }` shape, so
 * the renderer stays a dumb formatter and the whole thing stays translatable.
 *
 * @param {number[]} series   chronological prices
 * @param {object}   [ctx]
 * @param {number}   [ctx.days=90]
 * @returns {Array<{id:string,kind:'neutral'|'caution'|'notable',values:object}>}
 */
export function equitySeriesFacts(series, { days = EQUITY_HISTORY_DAYS } = {}) {
  const facts = historyFacts(series, { days });
  const v = clean(series);

  if (v.length >= 20) {
    const change = windowChange(v);
    if (change != null) {
      facts.push({
        id: 'windowChange',
        /* Notable only when it is a large move, and colour never means
           "buy" — the same restraint as the price on the row. */
        kind: Math.abs(change) >= 20 ? 'notable' : 'neutral',
        values: { pct: Math.round(change * 10) / 10, days }
      });
    }

    const move = averageDailyMove(v);
    if (move != null) {
      facts.push({
        id: 'avgDailyMove',
        kind: move >= 4 ? 'caution' : 'neutral',
        values: { pct: Math.round(move * 100) / 100, days }
      });
    }

    const ext = dailyExtremes(v);
    if (ext) {
      facts.push({
        id: 'extremes',
        kind: 'neutral',
        values: {
          best: Math.round(ext.best * 10) / 10,
          worst: Math.round(ext.worst * 10) / 10,
          days
        }
      });
    }
  }

  return facts;
}

/**
 * The market-depth half of the analysis.
 *
 * A price tells you nothing about whether you can get out. This is the same
 * gate the row's buy button uses, expressed as the numbers a reader needs: how
 * big the book is, what share of it the chosen amount is, and the largest size
 * that would pass. `liquidityVerdict()` is the single source of truth — the
 * panel and the button can never disagree.
 */
export function equityDepth(asset, amountUsd) {
  const pool = Number(asset?.liquidity) || 0;
  const size = Number(amountUsd) || 0;
  const verdict = liquidityVerdict(pool, size);

  return {
    pool,
    size,
    share: pool > 0 && size > 0 ? size / pool : null,
    maxUsd: verdict.ok ? null : verdict.maxUsd ?? null,
    ok: verdict.ok,
    reason: verdict.reason ?? null,
    /* The gate as a plain number, for the copy that explains it. */
    maxPoolShare: MAX_POOL_SHARE
  };
}

/**
 * Everything the panel's stat grid shows, as raw numbers.
 *
 * Deliberately numbers and not strings: a module that formats its own output
 * cannot be translated, and this app ships in twelve languages with two of
 * them right-to-left. The component formats; this measures.
 */
export function equityStats(asset, amountUsd = 1000, series = []) {
  const v = clean(series);
  const price = Number(asset?.usdPrice);
  const depth = equityDepth(asset, amountUsd);

  const range = rangePosition(v);
  const drawdown = maxDrawdown(v);
  const rate = baseRate(v, 7);
  const units =
    Number.isFinite(price) && price > 0 && Number(amountUsd) > 0
      ? Number(amountUsd) / price
      : null;

  return {
    price: Number.isFinite(price) && price > 0 ? price : null,
    change24h: Number.isFinite(Number(asset?.change24h)) ? Number(asset.change24h) : null,
    windowChange: v.length >= 2 ? windowChange(v) : null,
    low: range ? range.low : null,
    high: range ? range.high : null,
    rangePct: range ? range.pct : null,
    drawdown,
    baseRate: rate && rate.samples >= 30 ? rate : null,
    depth,
    holders: Number.isFinite(Number(asset?.holders)) && Number(asset.holders) > 0
      ? Number(asset.holders)
      : null,
    units,
    hasHistory: v.length >= 20
  };
}
