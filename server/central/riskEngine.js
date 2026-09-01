/**
 * FBT CENTRAL INTELLIGENCE OS — Central Risk Engine (§24).
 * ---------------------------------------------------------------------------
 * One risk brain shared by every module: portfolio, swap, bridge, lending,
 * borrow, futures, dYdX, LP, farm, goals. Pure computation over REAL state —
 * if the numbers are missing it says "unavailable"; it never invents a risk
 * figure. When the user wants to open a futures position, the CURRENT
 * portfolio is part of the math (§24).
 */

function holdingsFrom(state) {
  const rows = Array.isArray(state?.portfolio?.holdings) ? state.portfolio.holdings : [];
  return rows
    .map((h) => ({ symbol: String(h.symbol || '').toUpperCase(), valueUsd: Number(h.valueUsd), amount: Number(h.amount) || null }))
    .filter((h) => h.symbol && Number.isFinite(h.valueUsd) && h.valueUsd > 0);
}

const totalOf = (holdings) => holdings.reduce((s, h) => s + h.valueUsd, 0);

/**
 * Concentration: per-asset share + Herfindahl–Hirschman index.
 * HHI > 0.45 is treated as concentrated (one asset dominates the book).
 */
export function portfolioRisk(state, { concentrationThreshold = 0.4 } = {}) {
  const holdings = holdingsFrom(state);
  const total = state?.portfolio?.totalValueUsd ?? totalOf(holdings);
  if (!holdings.length || !Number.isFinite(total) || total <= 0) {
    return { dataStatus: 'unavailable', reason: 'NO_PORTFOLIO_DATA' };
  }
  const rows = holdings
    .map((h) => ({ symbol: h.symbol, valueUsd: h.valueUsd, sharePct: (h.valueUsd / total) * 100 }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
  const hhi = rows.reduce((s, r) => s + Math.pow(r.valueUsd / total, 2), 0);
  const top = rows[0];
  return {
    dataStatus: 'live',
    totalValueUsd: total,
    assetCount: rows.length,
    hhi: Number(hhi.toFixed(4)),
    concentrated: hhi > 0.45,
    topAsset: top ? { symbol: top.symbol, sharePct: Number(top.sharePct.toFixed(2)), valueUsd: top.valueUsd } : null,
    rows: rows.slice(0, 10).map((r) => ({ ...r, sharePct: Number(r.sharePct.toFixed(2)) })),
    concentrationThresholdPct: concentrationThreshold * 100
  };
}

/** "Do I have too much X?" — a direct share check against the real book. */
export function concentrationCheck(state, asset) {
  const risk = portfolioRisk(state);
  if (risk.dataStatus !== 'live') return risk;
  const sym = String(asset || '').toUpperCase();
  const row = risk.rows.find((r) => r.symbol === sym);
  return {
    ...risk,
    asset: sym,
    assetSharePct: row ? row.sharePct : 0,
    assetValueUsd: row ? row.valueUsd : 0,
    overThreshold: row ? row.sharePct > risk.concentrationThresholdPct : false,
    found: Boolean(row)
  };
}

/**
 * Lending/borrow risk: health factor and the distance to the liquidation
 * zone. Inputs come from the lending module's real position read.
 */
export function lendingRisk(position) {
  const collateral = Number(position?.collateralUsd);
  const borrowed = Number(position?.borrowedUsd);
  if (!Number.isFinite(collateral) || !Number.isFinite(borrowed) || collateral <= 0) {
    return { dataStatus: 'unavailable', reason: 'NO_LENDING_POSITION' };
  }
  const ltv = borrowed / collateral;
  const liquidationThreshold = Number(position?.liquidationThreshold || 0.825); // Aave-style default
  const healthFactor = borrowed > 0 ? (collateral * liquidationThreshold) / borrowed : Infinity;
  const distanceToLiquidationPct = borrowed > 0
    ? Math.max(0, ((collateral * liquidationThreshold) - borrowed) / borrowed) * 100
    : null;
  return {
    dataStatus: 'live',
    collateralUsd: collateral,
    borrowedUsd: borrowed,
    ltvPct: Number((ltv * 100).toFixed(2)),
    healthFactor: Number.isFinite(healthFactor) ? Number(healthFactor.toFixed(3)) : null,
    liquidationThreshold,
    distanceToLiquidationPct: distanceToLiquidationPct == null ? null : Number(distanceToLiquidationPct.toFixed(1)),
    riskBand: healthFactor === Infinity || healthFactor >= 2.5 ? 'LOW' : healthFactor >= 1.6 ? 'MEDIUM' : healthFactor >= 1.1 ? 'HIGH' : 'CRITICAL'
  };
}

/** Futures/derivatives risk measured AGAINST the current portfolio (§24). */
export function futuresRisk(state, { leverage = 1, marginUsd = 0 } = {}) {
  const total = Number(state?.portfolio?.totalValueUsd) || 0;
  const positions = Array.isArray(state?.positions) ? state.positions : [];
  const notional = positions.reduce((s, p) => s + Math.abs(Number(p.amount || 0) * Number(p.entry || 0)), 0);
  const exposureUsd = notional + Math.abs(Number(marginUsd) * Number(leverage || 1));
  if (total <= 0 && exposureUsd <= 0) return { dataStatus: 'unavailable', reason: 'NO_DATA' };
  const exposurePct = total > 0 ? (exposureUsd / total) * 100 : null;
  return {
    dataStatus: 'live',
    positionCount: positions.length,
    notionalUsd: Number(notional.toFixed(2)),
    exposureUsd: Number(exposureUsd.toFixed(2)),
    portfolioUsd: total,
    exposurePct: exposurePct == null ? null : Number(exposurePct.toFixed(1)),
    riskBand: exposurePct == null ? 'UNKNOWN' : exposurePct > 50 ? 'HIGH' : exposurePct > 20 ? 'MEDIUM' : 'LOW'
  };
}

/**
 * What-if shock: "if BTC drops 30%, what happens?" (§ scenario G). Re-prices
 * the real holdings under the shock and reports the drawdown. Debt is NOT
 * shrunk by the shock — that asymmetry is exactly why leverage liquidates.
 */
export function scenarioShock(state, { asset, dropPct = 30 }) {
  const holdings = holdingsFrom(state);
  const total = totalOf(holdings);
  if (!holdings.length || total <= 0) return { dataStatus: 'unavailable', reason: 'NO_PORTFOLIO_DATA' };
  const sym = String(asset || 'BTC').toUpperCase();
  const factor = Math.max(0, 1 - Math.abs(Number(dropPct)) / 100);
  let shocked = 0;
  let assetValue = 0;
  for (const h of holdings) {
    if (h.symbol === sym) { shocked += h.valueUsd * factor; assetValue = h.valueUsd; }
    else shocked += h.valueUsd;
  }
  const loss = total - shocked;
  const lending = lendingRisk(state?.lending?.position || {});
  let liquidationWarning = null;
  if (lending.dataStatus === 'live' && lending.borrowedUsd > 0) {
    const postHf = (shocked * lending.liquidationThreshold) / lending.borrowedUsd;
    liquidationWarning = {
      postShockHealthFactor: Number(postHf.toFixed(3)),
      liquidates: postHf < 1
    };
  }
  return {
    dataStatus: 'live',
    asset: sym,
    dropPct: Number(dropPct),
    beforeUsd: Number(total.toFixed(2)),
    afterUsd: Number(shocked.toFixed(2)),
    lossUsd: Number(loss.toFixed(2)),
    portfolioDropPct: Number(((loss / total) * 100).toFixed(2)),
    assetValueUsd: Number(assetValue.toFixed(2)),
    liquidationWarning
  };
}
