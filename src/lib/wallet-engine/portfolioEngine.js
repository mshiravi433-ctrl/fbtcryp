/**
 * FBT WALLET ENGINE — SMART PORTFOLIO ENGINE
 * ---------------------------------------------------------------------------
 * Turns a set of priced positions into the numbers a portfolio page needs:
 * allocation, concentration, realized/unrealized P&L, and performance.
 *
 * It builds on `costBasisEngine.computePnl` for the P&L and only adds the
 * distribution math (allocation shares, concentration risk, diversification).
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · `concentration` is computed from priced positions only, and reported as
 *   null when nothing is priced — a portfolio of unknowns is "unknown", not
 *   "diversified".
 * · `performancePct` needs BOTH a cost basis and a current value; otherwise
 *   it is null. The engine never divides by a missing basis to invent a %.
 */

import { computePnl } from './costBasisEngine.js';

export const PORTFOLIO_SCHEMA = 'fbt.portfolio.v1';

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Compute a portfolio snapshot from a set of positions and a price map.
 * `positions` may come straight from `computePnl().positions` or be raw
 * `{ asset, amount, priceUsd, costBasis }` rows.
 */
export function portfolioSnapshot(positions = [], { priceMap = null } = {}) {
  const rows = (Array.isArray(positions) ? positions : []).map((p) => {
    const price = num(p.priceUsd ?? priceMap?.[p.asset]);
    const amount = num(p.amount) ?? 0;
    const value = amount > 0 && price != null ? amount * price : null;
    return {
      asset: String(p.asset || p.symbol || '?').toUpperCase(),
      amount,
      priceUsd: price,
      valueUsd: value,
      costBasis: num(p.costBasis) ?? null
    };
  });

  const priced = rows.filter((r) => r.valueUsd != null);
  const totalUsd = priced.reduce((s, r) => s + r.valueUsd, 0);
  const costBasisTotal = rows.every((r) => r.costBasis != null)
    ? rows.reduce((s, r) => s + r.costBasis, 0)
    : null;

  const allocation = priced.map((r) => ({
    asset: r.asset,
    valueUsd: r.valueUsd,
    weightPct: totalUsd > 0 ? (r.valueUsd / totalUsd) * 100 : 0
  })).sort((a, b) => b.weightPct - a.weightPct);

  /* Concentration = share of the single largest priced position. */
  const concentrationPct = allocation.length ? allocation[0].weightPct : null;

  const realized = num(positions.realizedTotal) ?? 0;
  const unrealized = rows.every((r) => r.valueUsd != null && r.costBasis != null)
    ? rows.reduce((s, r) => s + (r.valueUsd - r.costBasis), 0)
    : null;

  const performancePct = costBasisTotal != null && costBasisTotal > 0
    ? ((totalUsd - costBasisTotal) / costBasisTotal) * 100
    : null;

  return {
    schema: PORTFOLIO_SCHEMA,
    totalUsd,
    pricedCount: priced.length,
    totalCount: rows.length,
    partial: priced.length > 0 && priced.length < rows.length,
    allocation,
    concentrationPct,
    costBasisTotal,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    performancePct
  };
}

/** Concentration risk band from the largest single position's weight. */
export function concentrationRisk(concentrationPct) {
  const c = num(concentrationPct);
  if (c == null) return { level: 'unknown', weightPct: null };
  if (c >= 60) return { level: 'high', weightPct: c };
  if (c >= 35) return { level: 'medium', weightPct: c };
  return { level: 'low', weightPct: c };
}

/** Convenience: positions + price map → full portfolio + risk in one call. */
export function analyzePortfolio(lots = [], priceMap = {}) {
  const pnl = computePnl(lots, priceMap);
  const snapshot = portfolioSnapshot(pnl.positions, {});
  return { ...snapshot, realizedPnl: pnl.realizedTotal, unrealizedPnl: pnl.unrealizedTotal, concentration: concentrationRisk(snapshot.concentrationPct) };
}
