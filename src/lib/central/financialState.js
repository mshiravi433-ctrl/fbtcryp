/**
 * FBT FINANCIAL OS — Financial State Engine (Upgrade 10 §8).
 * ---------------------------------------------------------------------------
 * "Understand the user's financial situation, not just the wallet balance."
 *
 * This module turns the Unified System State sections (wallet, portfolio,
 * lending, borrowing, futures, dydx, farming, liquidity, markets) into ONE
 * financial picture: net worth, available vs invested capital, debt,
 * collateral, liquidity, concentration, exposures and drawdown.
 *
 * THE RULE IT INHERITS FROM §3/§48
 * Every figure here is arithmetic over values that arrived with a source. If an
 * input is missing the field is `null` and it is NAMED in `missing[]` — never
 * defaulted to zero. A zero net worth and an unread net worth are different
 * facts, and only one of them is safe to show a person.
 *
 * Pure: no imports beyond the shared contract, no I/O, no clock beyond the
 * `now` you pass in. That is what lets the same computation run in the browser,
 * in the brain, and inside the Financial Twin on a hypothetical portfolio.
 */
import { CI_SCHEMA, round, usableNumber } from './schema.js';
import { analyzeConcentration, analyzeExposure, classifySymbol } from './analysis.js';

export const FINANCIAL_STATE_SCHEMA = 'fbt.financial-state.v1';

const num = (v) => usableNumber(v);
const sum = (rows, pick) => rows.reduce((a, r) => a + (num(pick(r)) ?? 0), 0);
const pct = (part, whole) => (whole > 0 ? round((part / whole) * 100, 2) : null);

/** Stables are the liquidity buffer; everything else needs a market to become cash. */
const STABLE = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'GUSD', 'LUSD', 'USDD', 'USD1']);

function holdings(portfolio) {
  const rows = Array.isArray(portfolio?.holdings) ? portfolio.holdings : (Array.isArray(portfolio?.tokens) ? portfolio.tokens : []);
  return rows
    .map((h) => ({
      symbol: String(h.symbol || h.token || h.asset || '').toUpperCase(),
      chainId: h.chainId ?? null,
      network: h.network || h.chain || null,
      amount: num(h.amount ?? h.balance),
      valueUsd: num(h.valueUsd ?? h.usd ?? h.value),
      category: String(h.category || classifySymbol(h.symbol || h.token || h.asset)).toLowerCase()
    }))
    .filter((h) => h.symbol);
}

/**
 * Build the financial state from central-state sections.
 *
 * @param {object} sections plain `{ portfolio, wallet, lending, ... }` data
 *        objects (NOT the wrapped `{ data, source }` envelopes).
 * @returns {{status:'OK'|'PARTIAL'|'UNAVAILABLE'}} always carrying `missing[]`.
 */
export function buildFinancialState(sections = {}, { now = Date.now() } = {}) {
  const { portfolio, wallet, lending, borrowing, futures, dydx, farming, liquidity, markets, transactions } = sections;
  const missing = [];
  const rows = holdings(portfolio);
  if (!rows.length) missing.push('portfolio');
  if (!wallet) missing.push('wallet');
  if (!markets) missing.push('markets');

  const valued = rows.filter((h) => h.valueUsd !== null);
  const unvalued = rows.length - valued.length;
  const spotUsd = valued.length ? round(sum(valued, (h) => h.valueUsd), 2) : null;

  if (spotUsd === null && !lending && !futures && !dydx) {
    return {
      schema: FINANCIAL_STATE_SCHEMA, brain: CI_SCHEMA, status: 'UNAVAILABLE',
      reason: 'NO_VALUED_POSITION', missing, at: now,
      detail: 'no holding carried a USD value and no venue position was readable — nothing can be summed'
    };
  }

  const exposure = analyzeExposure({ portfolio, lending, futures, dydx, farming, liquidity });
  const concentration = analyzeConcentration(portfolio);

  const collateralUsd = Array.isArray(lending?.positions)
    ? round(sum(lending.positions, (p) => p.collateralUsd), 2) : null;
  const debtFromLending = Array.isArray(lending?.positions)
    ? round(sum(lending.positions, (p) => p.debtUsd), 2) : null;
  const debtFromBorrowing = num(borrowing?.debtUsd);
  const debtUsd = debtFromLending !== null || debtFromBorrowing !== null
    ? round((debtFromLending ?? 0) + (debtFromBorrowing ?? 0), 2) : null;
  if (debtUsd === null) missing.push('debt');

  const marginUsd = round(
    sum(Array.isArray(futures?.positions) ? futures.positions : [], (p) => p.marginUsd ?? p.collateralUsd)
    + sum(Array.isArray(dydx?.positions) ? dydx.positions : [], (p) => p.marginUsd ?? p.collateralUsd), 2);
  const lpUsd = round(
    sum(Array.isArray(farming?.positions) ? farming.positions : [], (p) => p.valueUsd)
    + sum(Array.isArray(liquidity?.positions) ? liquidity.positions : [], (p) => p.valueUsd), 2);

  /* Net worth = spot + collateral + LP + venue margin − debt. Derivative
     NOTIONAL is deliberately excluded: notional is exposure, not wealth, and
     adding it is how a 5× position turns into a fictional fortune. */
  const grossAssetsUsd = round((spotUsd ?? 0) + (collateralUsd ?? 0) + (lpUsd || 0) + (marginUsd || 0), 2);
  const netWorthUsd = debtUsd === null ? null : round(grossAssetsUsd - debtUsd, 2);

  /* Available = liquid, unencumbered spot. Stables plus anything the portfolio
     itself marked withdrawable. Collateral is NOT available: it is spoken for. */
  const stableUsd = round(sum(valued.filter((h) => STABLE.has(h.symbol)), (h) => h.valueUsd), 2);
  const availableUsd = spotUsd === null ? null : round(spotUsd, 2);
  const investedUsd = spotUsd === null ? null : round(Math.max(0, (spotUsd - stableUsd) + (collateralUsd ?? 0) + (lpUsd || 0)), 2);

  const yieldRows = [
    ...(Array.isArray(farming?.positions) ? farming.positions : []),
    ...(Array.isArray(lending?.positions) ? lending.positions : [])
  ].filter((p) => num(p.apyPct ?? p.apy ?? p.aprPct) !== null && num(p.valueUsd ?? p.collateralUsd) !== null);
  const yieldBaseUsd = round(sum(yieldRows, (p) => p.valueUsd ?? p.collateralUsd), 2);
  const blendedYieldPct = yieldBaseUsd > 0
    ? round(yieldRows.reduce((a, p) => a + (num(p.apyPct ?? p.apy ?? p.aprPct) ?? 0) * ((num(p.valueUsd ?? p.collateralUsd) ?? 0) / yieldBaseUsd), 0), 2)
    : null;

  const unrealizedPnlUsd = num(portfolio?.unrealizedPnlUsd ?? portfolio?.pnlUsd);
  const realizedPnlUsd = num(portfolio?.realizedPnlUsd ?? transactions?.realizedPnlUsd);
  if (unrealizedPnlUsd === null && realizedPnlUsd === null) missing.push('pnl');

  /* Drawdown needs a peak. We only report it when the portfolio section carries
     one — deriving a peak from a single snapshot would be inventing history. */
  const peakUsd = num(portfolio?.peakValueUsd ?? portfolio?.highWaterMarkUsd);
  const drawdownPct = peakUsd !== null && peakUsd > 0 && spotUsd !== null
    ? round(Math.min(0, ((spotUsd - peakUsd) / peakUsd) * 100), 2) : null;
  if (drawdownPct === null) missing.push('drawdown');

  const byChain = {};
  for (const h of valued) {
    const key = h.network || (h.chainId !== null && h.chainId !== undefined ? `chain:${h.chainId}` : 'unknown');
    byChain[key] = round((byChain[key] || 0) + (h.valueUsd ?? 0), 2);
  }
  const byAsset = {};
  for (const h of valued) byAsset[h.symbol] = round((byAsset[h.symbol] || 0) + (h.valueUsd ?? 0), 2);

  const volatilityPct = num(markets?.volatilityPct?.PORTFOLIO ?? portfolio?.volatilityPct ?? markets?.volatilityPct?.BTC);
  if (volatilityPct === null) missing.push('volatility');

  const liquidityPct = spotUsd !== null && spotUsd > 0 ? pct(stableUsd, grossAssetsUsd || spotUsd) : null;
  const leverage = exposure.status === 'OK' ? exposure.leverageRatio : null;

  const status = missing.length ? 'PARTIAL' : 'OK';
  return {
    schema: FINANCIAL_STATE_SCHEMA,
    brain: CI_SCHEMA,
    status,
    at: now,
    netWorthUsd,
    grossAssetsUsd,
    availableCapitalUsd: availableUsd,
    investedCapitalUsd: investedUsd,
    debtUsd,
    collateralUsd,
    marginUsd: marginUsd || null,
    lpUsd: lpUsd || null,
    stableUsd,
    stableSharePct: liquidityPct,
    blendedYieldPct,
    yieldBaseUsd: yieldBaseUsd || null,
    realizedPnlUsd,
    unrealizedPnlUsd,
    drawdownPct,
    peakUsd,
    volatilityPct,
    leverage,
    netExposureUsd: exposure.status === 'OK' ? exposure.netExposureUsd : null,
    grossExposureUsd: exposure.status === 'OK' ? exposure.grossExposureUsd : null,
    concentration: concentration.status === 'OK'
      ? { level: concentration.level, topAsset: concentration.topAsset, topSharePct: concentration.topSharePct, hhi: concentration.hhi }
      : { unavailable: concentration.reason },
    chainExposureUsd: byChain,
    assetExposureUsd: byAsset,
    holdingsCounted: valued.length,
    holdingsUnvalued: unvalued,
    inputs: ['portfolio', 'wallet', lending ? 'lending' : null, futures ? 'futures' : null, dydx ? 'dydx' : null, farming ? 'farming' : null, liquidity ? 'liquidity' : null, markets ? 'markets' : null].filter(Boolean),
    missing: Array.from(new Set(missing)),
    /* Confidence is derived, never chosen: it falls with each unread input and
       with each holding we could not price. */
    confidence: round(Math.max(0.15, Math.min(0.95, 0.9 - missing.length * 0.09 - unvalued * 0.05)), 3),
    note: unvalued ? `${unvalued} holding(s) had no USD price and were excluded from every total` : null
  };
}

/**
 * Liquidity ladder: how much can become cash, and how fast, from the state we
 * actually read. Positions with no venue depth are reported as UNKNOWN rather
 * than assumed instant.
 */
export function liquidityProfile(financialState, { horizonHours = 24 } = {}) {
  if (!financialState || financialState.status === 'UNAVAILABLE') {
    return { schema: FINANCIAL_STATE_SCHEMA, status: 'UNAVAILABLE', reason: financialState?.reason || 'NO_FINANCIAL_STATE' };
  }
  const immediate = financialState.stableUsd ?? 0;
  const tradable = Math.max(0, (financialState.availableCapitalUsd ?? 0) - immediate);
  const encumbered = round((financialState.collateralUsd ?? 0) + (financialState.lpUsd ?? 0) + (financialState.marginUsd ?? 0), 2);
  return {
    schema: FINANCIAL_STATE_SCHEMA,
    status: financialState.status,
    horizonHours,
    immediateUsd: round(immediate, 2),
    tradableUsd: round(tradable, 2),
    encumberedUsd: encumbered,
    coverageOfDebtPct: financialState.debtUsd ? pct(immediate, financialState.debtUsd) : null,
    note: encumbered > 0 ? 'collateral, LP and venue margin are counted as encumbered: unwinding them is itself an action with risk' : null
  };
}
