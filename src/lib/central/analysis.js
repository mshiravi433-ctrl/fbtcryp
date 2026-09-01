/**
 * FBT CENTRAL INTELLIGENCE OS — Cross-module analysis (§14, §25, §27, §30).
 * ---------------------------------------------------------------------------
 * This is where "Portfolio → Risk → Market → Signals → News → Lending → Swap"
 * stops being a diagram and becomes arithmetic. Each function takes SECTIONS
 * (the real state) and returns one of three things:
 *
 *   { status: 'OK', ... }                  computed from data, with `inputs` naming them
 *   { status: 'PARTIAL', ... }             computed on some inputs, with what is missing
 *   { status: 'UNAVAILABLE', reason }      could not be computed — and NO placeholder number
 *
 * WHY THE UNAVAILABLE PATH IS THE IMPORTANT ONE
 * Concentration, correlation and goal probability are the three places an LLM
 * will happily produce a plausible figure with no arithmetic behind it. So each
 * of these functions has a hard floor on the number of observations it needs,
 * and a `confidence` that is *derived from the inputs*, not chosen. `correlation`
 * needs at least 20 aligned returns; below that it says UNAVAILABLE. A
 * recommendation engine that reads these can only repeat that honesty, because
 * `buildRecommendation` (§26) refuses to emit a recommendation whose data list
 * is empty.
 */
import { CI_SCHEMA, round, usableNumber } from './schema.js';

export const ANALYSIS_SCHEMA = 'fbt.central-analysis.v1';

const unavailable = (reason, extra = {}) => ({ schema: ANALYSIS_SCHEMA, brain: CI_SCHEMA, status: 'UNAVAILABLE', reason, confidence: 0, ...extra });
const ok = (data, inputs, confidence, extra = {}) => ({ schema: ANALYSIS_SCHEMA, brain: CI_SCHEMA, status: 'OK', ...data, inputs, confidence: round(confidence, 3), at: Date.now(), ...extra });

const num = (v) => { const n = usableNumber(v); return n === null ? null : n; };
const sum = (list, pick) => list.reduce((a, x) => a + (num(pick?.(x) ?? x) ?? 0), 0);

function holdingsOf(portfolio) {
  const rows = Array.isArray(portfolio?.holdings) ? portfolio.holdings : (Array.isArray(portfolio?.tokens) ? portfolio.tokens : null);
  if (!rows || !rows.length) return null;
  return rows
    .map((h) => ({
      symbol: String(h.symbol || h.token || h.asset || '?').toUpperCase(),
      chainId: h.chainId ?? null,
      amount: num(h.amount ?? h.balance ?? 0) ?? 0,
      valueUsd: num(h.valueUsd ?? h.usd ?? h.value) ?? null,
      category: String(h.category || h.class || classifySymbol(h.symbol || h.token || h.asset)).toLowerCase()
    }))
    .filter((h) => h.symbol);
}

/** Stables and non-crypto proxies are not "risk assets" for concentration. */
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'TUSD', 'PYUSD', 'GUSD', 'LUSD', 'USDD', 'CBUSD', 'XUSD', 'USD1']);
const PROXY = new Set(['WBTC', 'RENBTC', 'BTCB', 'CBBTC', 'TBTC', 'STETH', 'WSTETH', 'CBETH', 'RETH', 'WEETH', 'FRXETH', 'JITOSOL', 'BNSOL', 'MSOL']);
const COMMODITY = new Set(['XAU', 'PAXG', 'GOLD', 'XAUE', 'CADL', 'COPPER']);

export function classifySymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (STABLES.has(s)) return 'stable';
  if (COMMODITY.has(s)) return 'commodity';
  if (PROXY.has(s)) return 'wrapped-crypto';
  return 'crypto';
}

/* ── §14 / scenario B: concentration ─────────────────────────────────── */
/**
 * Herfindahl–Hirschman index over USD-weighted holdings, plus the top-asset and
 * top-3 share. Thresholds are product policy, stated here rather than implied:
 * 30% of a portfolio in one non-stable asset is where "your bag" starts to be
 * the story of the portfolio.
 *
 * A single-holding portfolio is reported as `confidence: 0.4` rather than 0.99:
 * the arithmetic is exact, the *meaning* is thin, and pretending otherwise is
 * how "your portfolio is extremely risky" gets said about someone with one row.
 */
export function analyzeConcentration(portfolio, { stableIsSafe = true } = {}) {
  const holdings = holdingsOf(portfolio);
  if (!holdings) return unavailable('NO_HOLDINGS', { needed: 'portfolio.holdings with valueUsd per asset' });
  const valued = holdings.filter((h) => h.valueUsd !== null && h.valueUsd > 0);
  if (!valued.length) return unavailable('NO_USD_VALUATIONS', { needed: 'live price per holding' });
  const total = sum(valued, (h) => h.valueUsd);
  if (!(total > 0)) return unavailable('ZERO_VALUATION');
  const risky = stableIsSafe ? valued.filter((h) => h.category !== 'stable') : valued;
  const riskyTotal = sum(risky, (h) => h.valueUsd);
  const rows = valued
    .map((h) => ({
      symbol: h.symbol,
      category: h.category,
      valueUsd: round(h.valueUsd, 2),
      sharePct: round((h.valueUsd / total) * 100, 2),
      shareOfRiskPct: riskyTotal > 0 ? round((h.valueUsd / riskyTotal) * 100, 2) : null,
      countsTowardRisk: h.category !== 'stable' || !stableIsSafe
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
  const hhi = risky.reduce((acc, h) => acc + (riskyTotal > 0 ? (h.valueUsd / riskyTotal) ** 2 : 0), 0);
  const top = rows.find((r) => r.countsTowardRisk) || rows[0];
  const top3 = rows.filter((r) => r.countsTowardRisk).slice(0, 3);
  const level = top.shareOfRiskPct >= 60 || hhi > 0.6 ? 'HIGH'
    : top.shareOfRiskPct >= 45 || hhi > 0.45 ? 'ELEVATED'
      : top.shareOfRiskPct >= 30 || hhi > 0.3 ? 'WATCH' : 'LOW';
  const confidence = Math.min(0.95, 0.45 + Math.min(0.4, valued.length * 0.06));
  return ok({
    level,
    topAsset: top.symbol,
    topSharePct: top.shareOfRiskPct ?? top.sharePct,
    topShareOfPortfolioPct: top.sharePct,
    top3SharePct: round(sum(top3, (r) => r.valueUsd) / total * 100, 2),
    hhi: round(hhi, 4),
    effectivePositions: hhi > 0 ? round(1 / hhi, 2) : null,
    totalValueUsd: round(total, 2),
    stableSharePct: round(sum(valued.filter((h) => h.category === 'stable'), (h) => h.valueUsd) / total * 100, 2),
    rows: rows.slice(0, 12),
    thresholds: { watch: 30, elevated: 45, high: 60 }
  }, ['portfolio.holdings', 'live prices'], confidence, { note: 'shares of RISK capital exclude stablecoins; shares of portfolio include them' });
}

/* ── §14: exposure across the whole system, not just the wallet ───────── */
/**
 * Gross vs net exposure. This is the number a futures or lending module must see
 * before recommending anything: a user who is 40% stables but 2× leveraged on a
 * perp is not "conservative", and only a combined view reveals it.
 */
export function analyzeExposure({ portfolio, lending, futures, dydx, farming, liquidity }) {
  const holdings = holdingsOf(portfolio) || [];
  const equity = sum(holdings, (h) => h.valueUsd);
  const parts = [];
  const missing = [];
  if (lending?.positions?.length) {
    for (const p of lending.positions) {
      parts.push({ source: 'lending', kind: 'collateral', valueUsd: num(p.collateralUsd) ?? 0, asset: p.asset || null, network: p.network || null });
      parts.push({ source: 'lending', kind: 'debt', valueUsd: -(num(p.debtUsd) ?? 0), asset: p.borrowAsset || null, network: p.network || null });
    }
  } else missing.push('lending');
  for (const [key, block] of [['futures', futures], ['dydx', dydx]]) {
    const positions = Array.isArray(block?.positions) ? block.positions : [];
    if (!positions.length) { if (!block) missing.push(key); continue; }
    for (const p of positions) {
      const notional = num(p.notionalUsd ?? p.sizeUsd ?? p.valueUsd) ?? 0;
      parts.push({ source: key, kind: 'notional', valueUsd: Math.abs(notional), asset: p.symbol || p.market || null, side: p.side || null, leverage: num(p.leverage) ?? null });
      parts.push({ source: key, kind: 'margin', valueUsd: num(p.marginUsd ?? p.collateralUsd) ?? 0, asset: null });
    }
  }
  if (farming?.positions?.length) for (const p of farming.positions) parts.push({ source: 'farming', kind: 'lp', valueUsd: num(p.valueUsd) ?? 0, asset: p.pool || null });
  if (liquidity?.positions?.length) for (const p of liquidity.positions) parts.push({ source: 'liquidity', kind: 'lp', valueUsd: num(p.valueUsd) ?? 0, asset: p.pool || null });

  /* An empty portfolio and an unread one are different facts, and reporting the
     second as the first would tell a user they carry no exposure when the truth is
     that a reader failed. So: nothing readable, nothing asserted. */
  if (!holdings.length && !parts.length) {
    return unavailable('NO_PORTFOLIO_READ', { needed: 'at least one valued holding or one venue position', missingSources: missing });
  }
  const gross = sum(parts, (p) => Math.abs(p.valueUsd)) + Math.abs(equity);
  const debt = -sum(parts.filter((p) => p.kind === 'debt'), (p) => p.valueUsd);
  /* Net = spot equity + directional derivatives (long +, short −) − debt. LP is
     excluded from "net" because half of an LP is not exposure to the pair, it is
     exposure to the pair's RATIO; folding it in would overstate the number. */
  const directional = sum(parts.filter((p) => p.kind === 'notional'), (p) => (p.side === 'short' ? -Math.abs(p.valueUsd) : Math.abs(p.valueUsd)));
  const net = equity + directional - debt;
  const leverageRatio = equity > 0 ? gross / equity : null;
  return ok({
    equityUsd: round(equity, 2),
    grossExposureUsd: round(gross, 2),
    netExposureUsd: round(net, 2),
    debtUsd: round(debt, 2),
    leverageRatio: leverageRatio === null ? null : round(leverageRatio, 3),
    bySource: parts.reduce((acc, p) => {
      const k = `${p.source}:${p.kind}`;
      acc[k] = round((acc[k] || 0) + p.valueUsd, 2);
      return acc;
    }, {}),
    rows: parts.slice(0, 20),
    missingSources: missing
  }, ['portfolio', 'lending', 'futures', 'dydx', 'farming', 'liquidity'].filter((k) => !missing.includes(k)), Math.min(0.9, 0.5 + (parts.length ? 0.3 : 0)), {
    note: missing.length ? `exposure excludes ${missing.join(', ')} because that section could not be read` : 'all exposure sources read'
  });
}

/* ── correlations: computed, never assumed ───────────────────────────── */
/**
 * Pearson correlation on aligned return series. `MIN_SAMPLES = 20` is the
 * honest floor — a 6-point correlation is a coin flip dressed as math. When the
 * market section carries no history, the answer is UNAVAILABLE with the number
 * of points that WOULD be needed, so a developer knows what to wire.
 */
export const MIN_CORRELATION_SAMPLES = 20;
export function correlate(priceSeriesA, priceSeriesB) {
  const a = toReturns(priceSeriesA);
  const b = toReturns(priceSeriesB);
  if (!a || !b) return unavailable('NO_PRICE_HISTORY', { neededSamples: MIN_CORRELATION_SAMPLES });
  const n = Math.min(a.length, b.length);
  if (n < MIN_CORRELATION_SAMPLES) return unavailable(`TOO_FEW_POINTS (${n} < ${MIN_CORRELATION_SAMPLES})`, { samples: n });
  const ra = a.slice(-n);
  const rb = b.slice(-n);
  const ma = sum(ra) / n;
  const mb = sum(rb) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = ra[i] - ma;
    const db = rb[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  if (!(denom > 0)) return unavailable('ZERO_VARIANCE');
  const r = cov / denom;
  return ok({
    coefficient: round(Math.max(-1, Math.min(1, r)), 4),
    samples: n,
    strength: Math.abs(r) > 0.8 ? 'strong' : Math.abs(r) > 0.55 ? 'moderate' : Math.abs(r) > 0.3 ? 'weak' : 'negligible',
    direction: r >= 0 ? 'positive' : 'negative'
  }, ['price history × 2'], Math.min(0.9, 0.35 + n / 200));
}

function toReturns(series) {
  const rows = Array.isArray(series) ? series.map((p) => num(typeof p === 'object' ? (p.price ?? p.close ?? p.value) : p)) : null;
  if (!rows || rows.length < 3) return null;
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (prev === null || cur === null || prev === 0) return null;
    out.push((cur - prev) / prev);
  }
  return out;
}

/** Realized volatility (%) of a price series, from the same history as correlations. */
export function realizedVolatilityPct(series) {
  const r = toReturns(series);
  if (!r || r.length < MIN_CORRELATION_SAMPLES) return unavailable('NO_PRICE_HISTORY', { neededSamples: MIN_CORRELATION_SAMPLES });
  const mean = sum(r) / r.length;
  const variance = r.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (r.length - 1);
  const sd = Math.sqrt(variance);
  return ok({ volatilityPct: round(sd * 100, 3), annualizedPct: round(sd * Math.sqrt(365) * 100, 2), samples: r.length }, ['price history'], Math.min(0.85, 0.4 + r.length / 400));
}

/* ── §24: lending safety, computed from the protocol's own numbers ─────── */
/**
 * Health factor distance is expressed as the price move that would reach the
 * liquidation threshold, because "HF 1.82" is a number users pattern-match and
 * "a 38% drop in your collateral liquidates you" is a decision they can make.
 */
export function assessLendingSafety({ position, oracle, priceSeries, collateralPriceSeries }) {
  const collateralUsd = num(position?.collateralUsd);
  const debtUsd = num(position?.debtUsd);
  const hf = num(position?.healthFactor);
  const ltv = num(position?.liquidationThreshold ?? position?.ltv);
  const borrowApr = num(position?.borrowAprPct ?? position?.borrowApr);
  if (collateralUsd === null || debtUsd === null) return unavailable('POSITION_NOT_READ', { needed: 'protocol account data for this wallet' });
  if (!(debtUsd > 0)) return ok({ hasDebt: false, collateralUsd: round(collateralUsd, 2), debtUsd: 0, healthFactor: hf, level: 'NONE', distanceToLiquidationPct: null, summary: 'no outstanding debt on this position' }, ['lending account data'], 0.9);
  const netExposure = collateralUsd - debtUsd;
  /* Price move needed for HF → 1: debt / (collateral * (1 - move)) = hf, so
     move = 1 - 1/hf when HF scales linearly with collateral value. */
  const distance = hf && hf > 1 ? round((1 - 1 / hf) * 100, 2) : (hf !== null ? 0 : null);
  const level = hf === null ? 'UNKNOWN' : hf < 1.05 ? 'CRITICAL' : hf < 1.35 ? 'HIGH' : hf < 1.8 ? 'MODERATE' : 'LOW';
  const oracleOk = !oracle || oracle.status === 'OK' || oracle.fresh === true;
  return ok({
    hasDebt: true,
    collateralUsd: round(collateralUsd, 2),
    debtUsd: round(debtUsd, 2),
    netExposureUsd: round(netExposure, 2),
    healthFactor: hf,
    liquidationThresholdPct: ltv === null ? null : round(ltv <= 1 ? ltv * 100 : ltv, 2),
    borrowAprPct: borrowApr === null ? null : round(borrowApr <= 1 ? borrowApr * 100 : borrowApr, 3),
    distanceToLiquidationPct: distance,
    level,
    oracleFresh: oracleOk,
    recommendationGuardrail: distance !== null && distance < 15 ? 'no new debt' : distance !== null && distance < 30 ? 'only small additions' : 'headroom exists'
  }, ['lending account data', 'protocol oracle', 'live collateral price'], oracleOk ? 0.9 : 0.55, {
    note: oracleOk ? null : 'the oracle could not be verified as fresh, so the liquidation distance is quoted with reduced confidence'
  });
}

/** How much more may be borrowed while keeping HF above the policy floor. */
export function computeBorrowCapacity({ position, floorHealthFactor = 1.35, price = null, reserve = null }) {
  const collateralUsd = num(position?.collateralUsd);
  const debtUsd = num(position?.debtUsd) ?? 0;
  const ltv = num(position?.ltv ?? position?.liquidationThreshold);
  if (collateralUsd === null) return unavailable('COLLATERAL_NOT_READ', { needed: 'protocol account data' });
  const ltvPct = ltv === null ? null : (ltv <= 1 ? ltv : ltv / 100);
  const capacity = ltvPct === null ? null : Math.max(0, collateralUsd * ltvPct - debtUsd);
  /* The binding constraint is the health-factor floor, not raw LTV. Collateral C
     and debt D give HF ≈ C·ltvAdj/D, so holding HF ≥ floor while borrowing x more
     means x ≤ (C·ltvAdj − floor·D) / floor. Using the floor as the divisor is what
     leaves the buffer instead of consuming it — borrowing to the LTV ceiling puts
     an account one small move from liquidation, which is exactly what the user
     is asking us not to do. */
  const floor = Math.max(1.01, floorHealthFactor || 1.01);
  const conservative = ltvPct === null ? null : Math.max(0, (collateralUsd * ltvPct - floor * debtUsd) / floor);
  return ok({
    collateralUsd: round(collateralUsd, 2),
    debtUsd: round(debtUsd, 2),
    ltvPct: ltvPct === null ? null : round(ltvPct * 100, 2),
    capacityUsdByLtv: capacity === null ? null : round(capacity, 2),
    capacityUsdRespectingFloor: conservative === null ? null : round(conservative, 2),
    floorHealthFactor,
    reserveAprPct: num(reserve?.borrowAprPct) === null ? null : round(num(reserve?.borrowAprPct), 3),
    priceUsed: num(price),
    bindingConstraint: capacity === null ? null : (conservative <= capacity ? 'health-factor floor' : 'LTV ceiling')
  }, ['protocol account data', 'reserve configuration'], ltvPct === null ? 0.35 : 0.85, {
    note: ltvPct === null ? 'reserve LTV could not be read, so only the raw collateral figure is reported' : 'capacity respects the health-factor floor, not just LTV'
  });
}

/* ── scenario G: what-if ─────────────────────────────────────────────── */
/**
 * A shock applied to the REAL holdings, propagating to debt, LP and leveraged
 * positions. The leveraged-position liquidation maths is explicit because it is
 * the number that decides whether the user should do anything tonight.
 */
export function simulateShock({ portfolio, lending, futures, dydx, liquidity }, shockPct = -30, { shockByAsset = null } = {}) {
  const holdings = holdingsOf(portfolio);
  if (!holdings) return unavailable('NO_HOLDINGS');
  const shock = num(shockPct);
  if (shock === null) return unavailable('NO_SHOCK_MAGNITUDE');
  const before = sum(holdings, (h) => h.valueUsd);
  const after = sum(holdings, (h) => {
    const pct = num(shockByAsset?.[h.symbol]) ?? shock;
    return (h.valueUsd ?? 0) * (1 + pct / 100);
  });
  const liquidated = [];
  const atRisk = [];
  /* HF is proportional to collateral VALUE (HF ≈ collateral·LTVadjust / debt), so
     a −30% shock multiplies it by 0.70. Dividing by (1+shock) — the mistake this
     comment exists to prevent — makes liquidation look FARTHER as the market falls,
     which is the single worst possible sign error in a risk engine. */
  const hfAfter = (hf) => (hf && hf > 0 ? round(hf * Math.max(0, 1 + shock / 100), 3) : null);
  const positions = [...(Array.isArray(lending?.positions) ? lending.positions.map((p) => ({ ...p, source: 'lending' })) : []),
  ...(Array.isArray(futures?.positions) ? futures.positions.map((p) => ({ ...p, source: 'futures' })) : []),
  ...(Array.isArray(dydx?.positions) ? dydx.positions.map((p) => ({ ...p, source: 'dydx' })) : [])];
  for (const p of positions) {
    const hf = num(p.healthFactor);
    const after1 = hfAfter(hf);
    const entry = { source: p.source, asset: p.asset || p.symbol || p.market || null, healthFactorBefore: hf, healthFactorAfter: after1, collateralUsd: num(p.collateralUsd), debtUsd: num(p.debtUsd) };
    if (after1 !== null && after1 <= 1) liquidated.push(entry);
    else if (after1 !== null && after1 < 1.25) atRisk.push(entry);
  }
  const lp = [...(Array.isArray(liquidity?.positions) ? liquidity.positions : []), ...(Array.isArray(lending?.lp) ? lending.lp : [])];
  return ok({
    shockPct: round(shock, 2),
    valueBeforeUsd: round(before, 2),
    valueAfterUsd: round(after, 2),
    deltaUsd: round(after - before, 2),
    deltaPct: before > 0 ? round(((after - before) / before) * 100, 2) : null,
    liquidation: { count: liquidated.length, positions: liquidated.slice(0, 8) },
    nearLiquidation: { count: atRisk.length, positions: atRisk.slice(0, 8) },
    lpExposureUsd: round(sum(lp, (p) => p.valueUsd), 2),
    /* Impermanent-loss direction under a large single-asset move, flagged as a
       modelled estimate rather than a quote — the pair price is not known here. */
    lpNote: lp.length ? 'LP value also moves with pool composition; the figure above is the position value only, not a full IL model' : null
  }, ['portfolio.holdings', 'lending/futures/dydx positions'], holdings.length > 2 ? 0.8 : 0.6, { method: 'linear price shock on live holdings + health-factor rescale' });
}

/* ── scenario H: goal feasibility ────────────────────────────────────── */
/**
 * Lognormal projection: probability of reaching the target given current value,
 * contributions, an expected-return band and realized volatility.
 *
 * `assumptions` is mandatory in the output. A probability without its inputs is
 * a fortune teller; with them it is arithmetic the user can disagree with, which
 * is the difference the spec's §26 demands.
 */
export function goalFeasibility({ currentUsd, targetUsd, years, monthlyContributionUsd = 0, expectedReturnPct = 12, volatilityPct = 60, now = Date.now() }) {
  const cur = num(currentUsd);
  const target = num(targetUsd);
  const y = num(years);
  if (cur === null || target === null || !(y > 0)) return unavailable('GOAL_INPUTS_INCOMPLETE', { needed: 'current portfolio value, target amount, horizon in years' });
  if (!(target > 0)) return unavailable('TARGET_NOT_POSITIVE');
  const contribution = num(monthlyContributionUsd) ?? 0;
  const mu = (num(expectedReturnPct) ?? 12) / 100;
  const sigma = Math.max(0.01, (num(volatilityPct) ?? 60) / 100);
  const months = Math.max(1, Math.round(y * 12));
  const requiredMultiple = target / Math.max(1e-9, cur + contribution * months);
  const requiredCagr = requiredMultiple > 0 ? (requiredMultiple ** (1 / y)) - 1 : null;
  /* Median terminal value under a lognormal GBM with monthly contributions. */
  const drift = mu - 0.5 * sigma * sigma;
  let median = cur * Math.exp(drift * y);
  for (let m = 1; m <= months; m += 1) median += (contribution) * Math.exp(drift * (y - m / 12));
  const sd = Math.sqrt(y) * sigma;
  const logTarget = Math.log(target);
  const logMedian = Math.log(Math.max(1e-9, median));
  /* P(FV ≥ target) with a normal approximation on log-space. erf-based so no
     statistics dependency is dragged into the browser bundle. */
  const z = (logTarget - logMedian) / Math.max(1e-9, sd);
  const probability = clamp01(0.5 * (1 - erf(z / Math.SQRT2)));
  const requiredContribution = solveMonthly({ target, years: y, cur, mu, sigma });
  const level = probability >= 0.75 ? 'PLAUSIBLE' : probability >= 0.5 ? 'TIGHT' : probability >= 0.3 ? 'AMBITIOUS' : 'UNREALISTIC';
  return ok({
    targetUsd: round(target, 2),
    currentUsd: round(cur, 2),
    years: y,
    months,
    contributionUsdMonthly: round(contribution, 2),
    projectedMedianUsd: round(median, 2),
    requiredCagrPct: requiredCagr === null ? null : round(requiredCagr * 100, 2),
    probability,
    probabilityPct: round(probability * 100, 1),
    level,
    requiredContributionUsdMonthly: requiredContribution === null ? null : round(requiredContribution, 0),
    sensitivity: [0.5, 1, 1.5].map((k) => ({ volatilityMultiplier: k, probabilityPct: round(clamp01(0.5 * (1 - erf((logTarget - logMedian) / (Math.sqrt(y) * sigma * k) / Math.SQRT2))) * 100, 1) }))
  }, ['portfolio value', 'market volatility', 'contribution plan'], Math.max(0.25, 0.8 - sigma * 0.4), {
    assumptions: { expectedReturnPct: round(mu * 100, 2), volatilityPct: round(sigma * 100, 2), model: 'lognormal GBM, continuous monthly contributions', distributionNote: 'a model, not a promise — crypto tails are heavier than lognormal' }
  });
}

function solveMonthly({ target, years, cur, mu, sigma }) {
  /* Bisection on the required monthly contribution for a 60% success rate. */
  const drift = mu - 0.5 * sigma * sigma;
  const sd = Math.sqrt(years) * sigma;
  const medianAt = (c) => {
    let m = cur * Math.exp(drift * years);
    const months = Math.max(1, Math.round(years * 12));
    for (let i = 1; i <= months; i += 1) m += c * Math.exp(drift * (years - i / 12));
    return m;
  };
  /* For a 60% chance of clearing the target the MEDIAN must sit above it by
     exp(z·sd), z = 0.2533 (the normal quantile at 0.60). Solving the other way
     round asks the user for too little and manufactures false confidence. */
  const needed = target * Math.exp(0.2533 * sd);
  if (medianAt(0) >= needed) return 0;
  let lo = 0;
  let hi = Math.max(50, needed / years);
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (medianAt(mid) < needed) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Abramowitz–Stegun 7.1.26 error function, |ε| < 1.5e-7 — no dependency needed. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/* ── §14/§30: the combined intelligence view for one asset ───────────── */
/**
 * Signal + news + events + volatility + funding = "asset intelligence", as one
 * object with one verdict. Every component that could not be read is listed in
 * `missing`, so the answer never looks more complete than the inputs are.
 */
export function assetIntelligence({ asset, markets, signals, news, risk, derivatives = null }) {
  const symbol = String(asset || '').toUpperCase();
  if (!symbol) return unavailable('NO_ASSET_RESOLVED', { hint: 'an asset was neither mentioned, selected on the page, nor present in the conversation' });
  /* The market row is either a bare number or a normalised object, depending on
     which source filled the section, and a price that exists must never be read
     as "no price" — that is how a live market answers «داده‌ای نیست». */
  const row = markets?.prices?.[symbol] ?? markets?.bySymbol?.[symbol] ?? markets?.[symbol] ?? null;
  const price = num(row) ?? num(row?.priceUsd) ?? num(row?.price) ?? num(row?.usd) ?? num(row?.current_price) ?? null;
  const change24h = num(markets?.changes24hPct?.[symbol]) ?? num(markets?.changes?.[symbol]) ?? num(row?.change24hPct) ?? num(row?.price_change_percentage_24h) ?? null;
  const vol = markets?.volatilityPct?.[symbol] ?? markets?.volatility?.[symbol] ?? null;
  const funding = num(markets?.fundingAprPct?.[symbol] ?? markets?.funding?.[symbol] ?? derivatives?.fundingAprPct?.[symbol] ?? null);
  const signal = signals?.byAsset?.[symbol] || signals?.[symbol] || null;
  const relatedNews = (Array.isArray(news?.items) ? news.items : []).filter((n) => String(n?.symbols || n?.tags || n?.title || '').toUpperCase().includes(symbol)).slice(0, 6);
  const missing = [];
  if (price === null) missing.push('price');
  if (change24h === null) missing.push('24h change');
  if (vol === null) missing.push('volatility');
  if (funding === null) missing.push('funding');
  if (!signal) missing.push('signal');
  if (!relatedNews.length) missing.push('news');
  const score = (change24h !== null ? Math.max(-1, Math.min(1, change24h / 8)) : 0)
    + (signal?.direction === 'bullish' ? 0.35 : signal?.direction === 'bearish' ? -0.35 : 0)
    + (funding !== null ? Math.max(-0.25, Math.min(0.25, funding / 100)) : 0)
    + (relatedNews.length ? Math.max(-0.2, Math.min(0.2, (relatedNews.filter((n) => n?.sentiment === 'positive').length - relatedNews.filter((n) => n?.sentiment === 'negative').length) * 0.1)) : 0);
  const stance = score > 0.45 ? 'constructive' : score < -0.45 ? 'defensive' : 'neutral';
  const base = missing.length ? 'PARTIAL' : 'OK';
  /* Funding is a derivatives-feed number and is absent for a pure spot read; that
     must not read as a broken answer, so the veto list is what makes a result
     UNAVAILABLE rather than partial: without a price there is nothing to say. */
  const material = missing.filter((m) => m === 'price');
  return {
    schema: ANALYSIS_SCHEMA, brain: CI_SCHEMA, status: material.length ? 'UNAVAILABLE' : base,
    asset: symbol,
    price, change24hPct: change24h, volatilityPct: num(vol), fundingAprPct: funding,
    signal: signal ? { direction: signal.direction || null, strength: num(signal.strength) ?? null, asOf: signal.at || null, source: signal.source || 'signals-engine' } : null,
    news: relatedNews.map((n) => ({ title: String(n.title || '').slice(0, 160), url: n.url || null, at: n.at || n.publishedAt || null, sentiment: n.sentiment || null })),
    stance, score: round(score, 3),
    riskLevel: risk?.byAsset?.[symbol]?.level || risk?.level || null,
    missing,
    inputs: ['market data', 'signals engine', 'news engine', 'risk engine'],
    confidence: round(Math.max(0.15, 0.9 - missing.length * 0.13), 3)
  };
}

/* ── §14: opportunities that survive contact with risk ────────────────── */
/**
 * Ranked opportunities from real yield/signal data, filtered by the RISK ENGINE
 * rather than by enthusiasm: an option whose APR is high enough to matter but
 * whose protocol risk is unknown is listed as `needs-attention`, not as a plan.
 */
export function scanOpportunities({ yields, portfolio, risk, capabilities = {} }, limit = 6) {
  const pools = Array.isArray(yields?.pools) ? yields.pools : null;
  if (!pools || !pools.length) return unavailable('NO_YIELD_DATA', { reason: 'the yields source returned nothing usable' });
  const stableShare = num(portfolio?.stableSharePct ?? portfolio?.stableShare) ?? null;
  const rows = pools.map((p) => {
    const apr = num(p.apy ?? p.apr ?? p.apyBase) ?? null;
    const riskLevel = String(p.risk ?? p.riskLevel ?? 'unknown').toLowerCase();
    const depth = num(p.tvlUsd ?? p.totalUsd ?? p.tvl);
    const eligible = apr !== null && apr > 0 && riskLevel !== 'extreme' && (depth === null || depth > 1_000_000);
    return {
      id: `${p.project || 'pool'}:${p.symbol || p.chain || 'asset'}`,
      project: p.project || null, chain: p.chain || null, symbol: p.symbol || null,
      aprPct: apr === null ? null : round(apr, 2),
      riskLevel, depthUsd: depth,
      verdict: !eligible ? 'needs-attention' : riskLevel === 'low' && apr >= 3 ? 'candidate' : 'review',
      reason: !eligible ? (apr === null ? 'no usable APR from this source' : riskLevel === 'extreme' ? 'protocol risk flagged extreme' : 'pool depth below the floor we will recommend') : `APR ${apr === null ? '?' : round(apr, 2)}% on ${p.chain || 'chain'} with ${riskLevel} protocol risk`,
      fillsStableGap: stableShare !== null && stableShare < 10 ? null : (STABLES.has(String(p.symbol || '').toUpperCase()) ? true : null)
    };
  }).filter((r) => r.aprPct !== null)
    .sort((a, b) => (b.aprPct || 0) - (a.aprPct || 0));
  const kept = rows.slice(0, limit);
  return ok({ count: rows.length, rows: kept, considered: rows.length, excluded: rows.length - kept.length }, ['yields engine', 'portfolio composition', 'risk engine'], Math.min(0.85, 0.4 + kept.length * 0.06), {
    note: capabilities.lending === 'DEGRADED' ? 'lending is degraded: APRs are indicative and were not re-verified against the protocol' : null
  });
}

export { STABLES as STABLE_SYMBOLS, PROXY as WRAPPED_SYMBOLS };
