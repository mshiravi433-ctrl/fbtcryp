/**
 * FBT AI RISK ENGINE — THE CORE
 * ===========================================================================
 * «کاربر قبل از اینکه سرمایه‌اش در معرض خطر قرار بگیرد بداند چه اتفاقی ممکن است
 *  رخ دهد، احتمال آن چقدر است و چگونه می‌تواند از سرمایه‌اش محافظت کند.»
 *
 * Those are three separate outputs and this module produces all three:
 *
 *   1. WHAT COULD HAPPEN   → ten risk families, each with the measurement that
 *                            produced its score and the numbers behind it.
 *   2. HOW LIKELY          → probabilities that are always a NAMED model
 *                            (`driftless-gbm-touch`, `parametric-normal`), with
 *                            their assumptions printed — never a bare "%".
 *   3. WHAT TO DO          → recommendations whose projected point reduction is
 *                            computed by RE-SCORING the same book with the fix
 *                            applied. A suggestion that cannot be measured is
 *                            not offered; one that can is offered with its
 *                            number.
 *
 * ─── THE FIVE HONESTY RULES (each one is a bug this repo has already had) ───
 *   1. NO DATA IS NOT ZERO RISK. A family with no measurement is `null` with a
 *      reason (`unavailable[]`), excluded from the weighted mean, and the
 *      composite carries `coverage` so a 12 built on 30% of the book can never
 *      be painted green (see bandForScore's green gate).
 *   2. NO INVENTED PRICE, YIELD OR PROBABILITY. Every probability names its
 *      model and its assumptions. A missing sigma is null, not 0.
 *   3. CORRELATION EARNED, NOT ASSUMED. Parametric variance credits a
 *      diversification benefit only for pairs actually measured; everything
 *      else is taken at ρ=1 and counted in `unmeasuredPairs`.
 *   4. THE ENGINE NEVER EXECUTES. `canExecute`, `canSign` and `canMoveFunds`
 *      are false here and in every readout — this module reads, scores and
 *      suggests. The transaction path stays where it already is, with its own
 *      gates (lib/executionGate.js, lib/strategyBrain/strategyPreflight.js).
 *   5. IT IS NOT ADVICE. Every recommendation carries `notAdvice: true` and the
 *      page prints the disclaimer once, in the reading flow, not in a footer.
 *
 * Everything here is PURE: no fetch, no storage, no React. The hook
 * (hooks/useRiskEngine.js) gathers evidence and this file judges it, so the
 * arithmetic can be asserted in node without a browser.
 */
import {
  RISK_FAMILIES, RISK_TAXONOMY_VERSION, FAMILY_BY_ID, bandForScore, toneOf, familyLabel
} from './taxonomy.js';
import {
  RISK_MATH_VERSION, Z_BY_CONFIDENCE, clamp, isNum, num, probTouch, round, sigmaFromSparkline, stdev
} from './riskMath.js';

export const RISK_ENGINE_VERSION = 'fbt.ai-risk-engine.1';

const HEALTHY_DAILY_SIGMA = 4; // %: a calm crypto day. Above this, exposure bites.

/** Stablecoins whose peg the engine is willing to check by price. */
export const STABLE_PEGS = Object.freeze({
  USDT: 1, USDC: 1, DAI: 1, FDUSD: 1, TUSD: 1, USDE: 1, USDD: 1, BUSD: 1, PYUSD: 1
});

/* -------------------------------------------------------------------------- */
/* score helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Normalise a raw measurement onto 0..100 with a documented knee.
 * `zone` is [safeAt, dangerAt]: at or below `safeAt` the score is 0, at or
 * above `dangerAt` it is 100, linear in between. Anything outside the zone is
 * clamped — which is why every caller prints the raw number next to the score.
 */
export function scale(value, safeAt, dangerAt) {
  const v = num(value);
  if (v == null) return null;
  if (dangerAt === safeAt) return v >= dangerAt ? 100 : 0;
  const t = (v - safeAt) / (dangerAt - safeAt);
  return Math.round(clamp(t, 0, 1) * 100);
}

/** Inverse scale: higher value = safer (liquidity, health factor, coverage). */
export const scaleInverse = (value, dangerAt, safeAt) => scale(value, safeAt, dangerAt);

const pct = (v, total) => (isNum(v) && isNum(total) && total > 0 ? (v / total) * 100 : null);

function weightedMean(entries = []) {
  let wSum = 0;
  let acc = 0;
  for (const e of entries) {
    const w = num(e.weight);
    const v = num(e.value);
    if (w == null || v == null || w <= 0) continue;
    wSum += w;
    acc += w * v;
  }
  return wSum > 0 ? acc / wSum : null;
}

/* -------------------------------------------------------------------------- */
/* family graders — each returns { score, facts, reasons, coverage }           */
/* -------------------------------------------------------------------------- */

/**
 * 1 · VOLATILITY. The measured daily sigma of the book, weighted by value,
 * plus the worst single contributor. Score knee: 2%/day = calm (0),
 * 9%/day = severe (100). The model probabilities downstream reuse this sigma.
 */
export function gradeVolatility({ holdings = [], markets = [], performance = null, total = 0 } = {}) {
  const bySym = new Map();
  for (const m of markets) bySym.set(String(m.symbol || '').toUpperCase(), m);
  const legs = [];
  for (const h of holdings) {
    const sym = String(h.symbol || '').toUpperCase();
    const m = bySym.get(sym) || (h.coingeckoId ? markets.find((x) => x.id === h.coingeckoId) : null);
    const sigma = m ? sigmaFromSparkline(m.sparkline) : null;
    const weight = pct(h.value, total);
    if (sigma && weight != null) {
      legs.push({ symbol: sym, weight, sigmaPct: round(sigma.sigmaPct, 3), samples: sigma.points, valueUsd: num(h.value) ?? 0 });
    }
  }
  const bookSigma = weightedMean(legs.map((l) => ({ weight: l.weight, value: l.sigmaPct })));
  const worst = legs.length ? legs.reduce((a, b) => (b.sigmaPct > a.sigmaPct ? b : a)) : null;
  const dayMove = num(performance?.returns?.d1);
  const dayLoss = dayMove != null && dayMove < 0 ? Math.abs(dayMove) : 0;

  const sigmaPart = scale(bookSigma, 2, 9);
  /* A realised loss today is measured risk that already happened — a book that
     fell 6% is riskier right now than the same book did yesterday. */
  const dayPart = dayMove != null && dayMove < 0 ? clamp(Math.round(dayLoss * 3.2), 0, 40) : 0;
  const tailPart = worst ? clamp(Math.round(Math.max(0, worst.sigmaPct - bookSigma) * 2.5), 0, 15) : 0;

  const reasons = [];
  if (bookSigma != null) reasons.push({ key: 'book-sigma', params: { sigma: round(bookSigma, 2) } });
  if (worst) reasons.push({ key: 'worst-vol', params: { symbol: worst.symbol, sigma: worst.sigmaPct, weight: round(worst.weight, 1) } });
  if (dayMove != null && dayMove < 0) reasons.push({ key: 'day-loss', params: { pct: round(dayMove, 2) } });

  const score = sigmaPart == null ? null : clamp((sigmaPart ?? 0) + dayPart + tailPart, 0, 100);
  return {
    score,
    coverage: legs.length && holdings.length ? round(legs.length / Math.max(1, holdings.filter((h) => (num(h.value) ?? 0) > 0).length), 2) : 0,
    facts: {
      bookSigmaPct: round(bookSigma, 2),
      worst: worst ? { symbol: worst.symbol, sigmaPct: worst.sigmaPct, weightPct: round(worst.weight, 1) } : null,
      measuredAssets: legs.length,
      dayReturnPct: round(dayMove, 2),
      /* The probability numbers the stress centre and the alerts reuse. */
      probDown5In1d: probTouch({ sigmaDailyPct: bookSigma, distancePct: 5, horizonDays: 1 }),
      probDown10In7d: probTouch({ sigmaDailyPct: bookSigma, distancePct: 10, horizonDays: 7 }),
      /*
       * VALUE AT RISK, on the SAME sigma — one-day, 95%, expressed in dollars
       * and as a share of the book. This is the parametric one-asset case
       * (no cross-asset correlation), which is why `varModel` names it: the
       * stress centre's Monte-Carlo is the correlated read, and the two are
       * printed side by side rather than in place of each other.
       */
      var95Usd: bookSigma != null && total > 0 ? round(total * (bookSigma / 100) * Z_BY_CONFIDENCE[0.95], 2) : null,
      var95Pct: bookSigma != null ? round(bookSigma * Z_BY_CONFIDENCE[0.95], 2) : null,
      varModel: 'parametric-1d-95-z1.645',
      model: 'sparkline-daily-sigma + driftless-gbm-touch'
    },
    reasons,
    unavailable: legs.length ? [] : ['sparkline-volatility']
  };
}

/**
 * 2 · CONCENTRATION & CORRELATION.
 * Two independent facts, both measured: how much sits in one name (topShare,
 * HHI/effective holdings) and whether those names move together (Pearsons on
 * daily returns, from the correlation matrix the portfolio room already builds).
 */
export function gradePortfolio({ intel = null, analysis = null, correlation = null } = {}) {
  if (!intel || !(intel.total > 0)) {
    return { score: null, coverage: 0, facts: {}, reasons: [], unavailable: ['no-portfolio'] };
  }
  const topShare = num(intel.topShare) ?? 0;
  const concentration = scale(topShare, 20, 80);
  const hhi = num(analysis?.concentration?.hhi);
  const effective = num(analysis?.concentration?.effectiveHoldings);
  const avgCorr = num(correlation?.average) ?? num(analysis?.correlation?.average);

  const corrPart = avgCorr == null ? 0 : clamp(Math.round((avgCorr - 0.45) * 90), 0, 30);
  const reasons = [];
  if (topShare > 0) {
    reasons.push({
      key: 'top-holding',
      params: { symbol: intel.rows?.[0]?.symbol ?? null, share: round(topShare, 1) }
    });
  }
  if (effective != null) reasons.push({ key: 'effective-holdings', params: { n: effective } });
  if (avgCorr != null) reasons.push({ key: 'average-correlation', params: { r: round(avgCorr, 2), pairs: correlation?.pairs?.length ?? 0 } });

  const score = concentration == null ? null : clamp(concentration + corrPart, 0, 100);
  return {
    score,
    /* Correlation is a bonus measurement: without it the family still scores
       on concentration, and says which half is missing. */
    coverage: correlation?.average != null ? 1 : 0.6,
    facts: {
      topSharePct: round(topShare, 1),
      hhi: hhi ?? null,
      effectiveHoldings: effective ?? null,
      averageCorrelation: avgCorr == null ? null : round(avgCorr, 2),
      correlatedPairs: correlation?.pairs?.length ?? 0,
      computedOn: correlation?.sufficient ?? []
    },
    reasons,
    unavailable: avgCorr == null ? ['asset-correlation'] : []
  };
}

/**
 * 3 · LIQUIDITY. Share-of-volume: how many days of the asset's own 24h volume
 * the position is worth, plus the asset's turnover (volume/mcap). Selling a
 * $40k position in an asset that trades $60k a day is a different act from
 * selling it in one that trades $600M a day, and the ratio says which.
 */
export function gradeLiquidity({ holdings = [], markets = [], total = 0 } = {}) {
  const bySym = new Map();
  for (const m of markets) bySym.set(String(m.symbol || '').toUpperCase(), m);
  const rows = [];
  for (const h of holdings) {
    const m = bySym.get(String(h.symbol || '').toUpperCase());
    const value = num(h.value);
    if (!m || value == null || value <= 0) continue;
    const vol = num(m.volume);
    const mcap = num(m.mcap);
    const turnover = vol != null && mcap != null && mcap > 0 ? (vol / mcap) * 100 : null;
    const daysOfVolume = vol != null && vol > 0 ? value / vol : null;
    rows.push({
      symbol: String(h.symbol).toUpperCase(),
      valueUsd: value,
      weight: pct(value, total) ?? 0,
      turnoverPct: turnover == null ? null : round(turnover, 2),
      volume24hUsd: vol,
      daysOfVolume: daysOfVolume == null ? null : round(daysOfVolume, 4)
    });
  }
  const weightedDays = weightedMean(rows.map((r) => ({ weight: r.valueUsd, value: r.daysOfVolume })));
  const weightedTurnover = weightedMean(rows.map((r) => ({ weight: r.valueUsd, value: r.turnoverPct })));
  const thinnest = rows.filter((r) => r.turnoverPct != null).sort((a, b) => a.turnoverPct - b.turnoverPct)[0] || null;

  /* knee: 0.02 days of the book's volume = safe; 0.5 day (you ARE the market)
     = 100. Slippage grows non-linearly long before that, which is why the
     alert fires at 0.1. */
  const daysPart = scale(weightedDays, 0.02, 0.5);
  const turnoverPart = weightedTurnover == null ? 0 : clamp(Math.round((2 - Math.min(2, weightedTurnover)) * 6), 0, 12);
  const reasons = [];
  /*
   * The `days-of-volume` sentence needs a NUMBER A HUMAN CAN READ. `round(x, 3)`
   * printed «0 روز از حجم» for a book that trades a thousand times its own size
   * in a day — true to two decimals and meaningless on screen. Anything under a
   * thousandth of a day gets its own sentence instead.
   */
  if (weightedDays != null) {
    reasons.push(weightedDays < 0.001
      ? { key: 'days-of-volume-tiny', params: {} }
      : { key: 'days-of-volume', params: { days: round(weightedDays, weightedDays < 0.1 ? 3 : 2) } });
  }
  if (thinnest) reasons.push({ key: 'thinnest-asset', params: { symbol: thinnest.symbol, turnover: thinnest.turnoverPct } });

  return {
    score: daysPart == null ? null : clamp((daysPart ?? 0) + turnoverPart, 0, 100),
    coverage: rows.length && holdings.length ? round(rows.length / Math.max(1, holdings.filter((h) => (num(h.value) ?? 0) > 0).length), 2) : 0,
    facts: {
      weightedDaysOfVolume: weightedDays == null ? null : round(weightedDays, 3),
      weightedTurnoverPct: weightedTurnover == null ? null : round(weightedTurnover, 2),
      thinnest,
      assetsMeasured: rows.length,
      /* The number a reader actually needs: $ at risk in the thinnest 3. */
      rows: rows.sort((a, b) => (b.daysOfVolume ?? -1) - (a.daysOfVolume ?? -1)).slice(0, 6)
    },
    reasons,
    unavailable: rows.length ? [] : ['volume']
  };
}

/**
 * 4 · SMART CONTRACT. Built from the GoPlus report the swap screen already
 * trusts (src/lib/tokenRisk.js), aggregated by VALUE: a risky dust position
 * must not outrank a clean large one, and a dangerous contract must never be
 * hidden behind a clean average — so the worst measured flag sets a floor.
 */
export function gradeSmartContract({ holdings = [], scans = {}, total = 0 } = {}) {
  const entries = [];
  for (const h of holdings) {
    const key = h.contractKey;
    const value = num(h.value);
    if (!key || value == null || value <= 0) continue;
    const scan = scans[key];
    if (!scan) {
      entries.push({ symbol: h.symbol, valueUsd: value, scanned: false });
      continue;
    }
    if (scan.unknown) {
      entries.push({ symbol: h.symbol, valueUsd: value, scanned: false, reason: 'unknown-report' });
      continue;
    }
    entries.push({ symbol: h.symbol, valueUsd: value, scanned: true, score: scan.score, level: scan.level, flags: scan.flags ?? [] });
  }
  const scanned = entries.filter((e) => e.scanned);
  if (!scanned.length) {
    return {
      score: null,
      coverage: 0,
      facts: { scanned: 0, withContract: entries.length, worst: null },
      reasons: [],
      unavailable: entries.length ? ['contract-scan'] : ['no-onchain-contracts']
    };
  }
  const weighted = weightedMean(scanned.map((e) => ({ weight: e.valueUsd, value: e.score })));
  const worst = scanned.reduce((a, b) => (b.score > a.score ? b : a));
  const critical = scanned.filter((e) => e.level === 'critical');
  const flagNames = [...new Set(scanned.flatMap((e) => (e.flags || []).map((f) => f.id)))];
  /* Floor: a honeypot or an owner-drainable contract in the book is a serious
     reading whatever the rest of the book scores. */
  const floor = critical.length ? 78 : worst.score >= 70 ? 70 : worst.score >= 50 ? 52 : 0;
  const score = clamp(Math.max(Math.round(weighted ?? 0), floor), 0, 100);
  const reasons = [];
  if (worst) reasons.push({ key: 'worst-contract', params: { symbol: worst.symbol, score: worst.score, level: worst.level } });
  if (critical.length) reasons.push({ key: 'critical-contracts', params: { count: critical.length, symbols: critical.map((c) => c.symbol).slice(0, 3).join(', ') } });
  if (flagNames.length) reasons.push({ key: 'flags', params: { list: flagNames.slice(0, 5).join(', ') } });

  return {
    score,
    coverage: round(scanned.reduce((s, e) => s + e.valueUsd, 0) / Math.max(1, total || scanned.reduce((s, e) => s + e.valueUsd, 0)), 2),
    facts: {
      scanned: scanned.length,
      withContract: entries.length,
      weightedScore: round(weighted, 1),
      worst,
      critical: critical.length,
      flags: flagNames,
      rows: entries.sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 8)
    },
    reasons,
    unavailable: []
  };
}

/**
 * 5 · DEFI / LIQUIDATION. Aave-style health factor, read from the pool itself.
 * HF is the one number the protocol will act on; the score is a straight map
 * of it (HF ≥ 3 calm, HF ≤ 1.05 effectively liquidatable).
 */
export function gradeDeFi({ lending = null } = {}) {
  if (!lending || lending.status !== 'read') {
    return {
      score: null, coverage: 0, facts: { status: lending?.status ?? 'not-read' }, reasons: [],
      unavailable: [lending?.reason || 'lending-position']
    };
  }
  const hf = num(lending.healthFactor);
  const debt = num(lending.totalDebtUsd) ?? 0;
  if (debt <= 0) {
    /* A read with no debt is a MEASUREMENT: nothing can be liquidated. */
    return {
      score: 0,
      coverage: 1,
      facts: { healthFactor: null, debtUsd: 0, collateralUsd: num(lending.totalCollateralUsd), status: 'read' },
      reasons: [{ key: 'no-debt', params: {} }],
      unavailable: []
    };
  }
  const score = hf == null ? null : clamp(round(scaleInverse(hf, 1.05, 3), 0), 0, 100);
  const dropToLiq = hf != null && hf > 0 ? round(100 * (1 - 1 / hf), 1) : null;
  const reasons = [];
  if (hf != null) reasons.push({ key: 'health-factor', params: { hf: round(hf, 2) } });
  if (dropToLiq != null) reasons.push({ key: 'collateral-drop-to-liquidation', params: { pct: dropToLiq } });
  return {
    score,
    coverage: 1,
    facts: {
      healthFactor: hf == null ? null : round(hf, 2),
      debtUsd: debt,
      collateralUsd: num(lending.totalCollateralUsd),
      ltvPct: num(lending.ltvPct),
      liquidationThresholdPct: num(lending.liquidationThresholdPct),
      collateralDropToLiquidationPct: dropToLiq,
      status: 'read'
    },
    reasons,
    unavailable: hf == null ? ['health-factor'] : []
  };
}

/**
 * 6 · NETWORK. Two separate things a single "network risk" usually blurs:
 * concentration (one chain holding most of the book) and observability (chains
 * whose read failed or came from a stale snapshot — you cannot manage what you
 * cannot see).
 */
export function gradeNetwork({ chainAllocation = [], chainReads = [], rows = [] } = {}) {
  if (!chainAllocation.length && !chainReads.length) {
    return { score: null, coverage: 0, facts: {}, reasons: [], unavailable: ['chain-allocation'] };
  }
  /*
   * ─── ORDER IS NOT EVIDENCE ──────────────────────────────────────────────
   * This grader trusted `chainAllocation[0]` to be the largest chain. It is
   * when the value comes from `deriveIntel`, which sorts — but the pre-trade
   * gate needs the allocation to move WITH the trade, so it re-derives the
   * split and may hand the rows over unsorted. The consequence was visible in
   * a live probe: buying $30k of a PEPE position ON CHAIN 1 made the "top
   * chain" look like the chain that had just LOST value, and the network family
   * jumped 43 → 77 for the wrong reason.
   *
   * A grader must not depend on its caller's sort order. It sorts here.
   */
  const ordered = [...chainAllocation].sort((a, b) => (num(b.value) ?? 0) - (num(a.value) ?? 0));
  const totalChainValue = ordered.reduce((s, c) => s + (num(c.value) ?? 0), 0);
  const top = ordered[0] || null;
  const topShare = top ? pct(top.value, totalChainValue) : null;
  const concentration = scale(topShare, 40, 95);
  const failed = (chainReads || []).filter((c) => c.failed);
  const stale = (chainReads || []).filter((c) => c.stale && !c.failed);
  const unpriced = (chainReads || []).reduce((s, c) => s + (num(c.unpriced) ?? 0), 0);
  const blindPart = clamp(failed.length * 18 + stale.length * 6, 0, 55);
  const unpricedPart = clamp(unpriced * 4, 0, 12);

  const reasons = [];
  if (top) reasons.push({ key: 'top-chain', params: { chainId: top.chainId, share: round(topShare ?? 0, 1) } });
  if (failed.length) reasons.push({ key: 'failed-chains', params: { count: failed.length } });
  if (stale.length) reasons.push({ key: 'stale-chains', params: { count: stale.length } });
  if (unpriced) reasons.push({ key: 'unpriced-rows', params: { count: unpriced } });

  const score = concentration == null ? (blindPart ? blindPart : null) : clamp(concentration + blindPart + unpricedPart, 0, 100);
  return {
    score,
    coverage: 1,
    facts: {
      topChainSharePct: topShare == null ? null : round(topShare, 1),
      chainsUsed: ordered.length,
      failedChains: failed.map((c) => c.chainId),
      staleChains: stale.map((c) => c.chainId),
      unpricedRows: unpriced,
      rows,
      chainAllocation: ordered
    },
    reasons,
    unavailable: []
  };
}

/**
 * 7 · COUNTERPARTY. The platforms a route actually passes through, judged on
 * EVIDENCE (`/api/providers/status`: configured + reachable + authenticated),
 * never on reputation. The rule from server/providerStatus.js travels here:
 * every boolean starts false and flips only on a recorded outcome.
 */
export function gradeCounterparty({ providers = null } = {}) {
  if (!providers || !Array.isArray(providers.providers) || !providers.providers.length) {
    return { score: null, coverage: 0, facts: {}, reasons: [], unavailable: ['provider-status'] };
  }
  const list = providers.providers;
  const configured = list.filter((p) => p.configured);
  const reachable = configured.filter((p) => p.reachable);
  const healthRatio = configured.length ? reachable.length / configured.length : null;
  const unauthenticated = configured.filter((p) => p.configured && !p.authenticated);
  const failing = list.filter((p) => p.lastFailureAt && (!p.lastSuccessAt || String(p.lastFailureAt) > String(p.lastSuccessAt)));

  /* No configured provider at all is not "safe" — it is "we cannot route". */
  const score = configured.length === 0
    ? 60
    : clamp(round((1 - healthRatio) * 85 + clamp(failing.length * 4, 0, 15), 0), 0, 100);

  const reasons = [];
  reasons.push({ key: 'reachable', params: { reachable: reachable.length, configured: configured.length } });
  if (failing.length) reasons.push({ key: 'failing', params: { count: failing.length, names: failing.slice(0, 3).map((p) => p.id).join(', ') } });
  if (unauthenticated.length) reasons.push({ key: 'unauthenticated', params: { count: unauthenticated.length } });

  return {
    score,
    coverage: 1,
    facts: {
      total: list.length,
      configured: configured.length,
      reachable: reachable.length,
      healthRatio: healthRatio == null ? null : round(healthRatio, 2),
      failing: failing.map((p) => p.id),
      rows: list.map((p) => ({
        id: p.id, kind: p.kind ?? null, configured: Boolean(p.configured), reachable: Boolean(p.reachable),
        authenticated: Boolean(p.authenticated), lastSuccessAt: p.lastSuccessAt ?? null, lastFailureAt: p.lastFailureAt ?? null
      }))
    },
    reasons,
    unavailable: []
  };
}

/**
 * 8 · LEVERAGE. Open perp positions, priced against their own liquidation
 * distance using the SAME venue models the futures engine uses
 * (src/lib/futures-engine/risk.js). Distance is the whole question here: a 20×
 * position 1.2% from liquidation is a different object from a 2× one 30% away.
 */
export function gradeLeverage({ leverage = null } = {}) {
  if (!leverage || leverage.status !== 'read') {
    return {
      score: null, coverage: 0, facts: { status: leverage?.status ?? 'not-read' }, reasons: [],
      unavailable: ['open-leveraged-positions']
    };
  }
  const positions = Array.isArray(leverage.positions) ? leverage.positions : [];
  if (!positions.length) {
    return {
      score: 0, coverage: 1, facts: { openPositions: 0, notionalUsd: 0 }, reasons: [{ key: 'no-open-leverage', params: {} }],
      unavailable: []
    };
  }
  const totalNotional = positions.reduce((s, p) => s + (num(p.notionalUsd) ?? 0), 0);
  const totalCollateral = positions.reduce((s, p) => s + (num(p.collateralUsd) ?? 0), 0);
  const bookUsd = num(leverage.bookUsd) ?? 0;
  const exposureRatio = bookUsd > 0 ? (totalNotional / bookUsd) * 100 : null;
  const nearest = positions
    .map((p) => ({ ...p, distancePct: num(p.liquidationDistancePct) }))
    .filter((p) => p.distancePct != null)
    .sort((a, b) => a.distancePct - b.distancePct)[0] || null;

  const distancePart = nearest ? scaleInverse(nearest.distancePct, 1, 25) : null;
  const exposurePart = exposureRatio == null ? 0 : clamp(round((exposureRatio - 10) * 0.9, 0), 0, 30);
  const maxLev = positions.reduce((s, p) => Math.max(s, num(p.leverage) ?? 0), 0);

  const reasons = [];
  if (nearest) reasons.push({ key: 'nearest-liquidation', params: { symbol: nearest.symbol, distance: round(nearest.distancePct, 2) } });
  if (exposureRatio != null) reasons.push({ key: 'notional-vs-book', params: { pct: round(exposureRatio, 1) } });
  if (maxLev > 0) reasons.push({ key: 'max-leverage', params: { x: round(maxLev, 1) } });

  return {
    score: distancePart == null ? clamp(exposurePart, 0, 100) : clamp(distancePart + exposurePart, 0, 100),
    coverage: 1,
    facts: {
      openPositions: positions.length,
      notionalUsd: round(totalNotional, 2),
      collateralUsd: round(totalCollateral, 2),
      notionalVsBookPct: exposureRatio == null ? null : round(exposureRatio, 1),
      maxLeverage: maxLev || null,
      nearest: nearest
        ? { symbol: nearest.symbol, distancePct: round(nearest.distancePct, 2), liquidationPrice: nearest.liquidationPrice ?? null, leverage: nearest.leverage ?? null }
        : null,
      positions: positions.slice(0, 8),
      liquidationModel: leverage.liquidationModel ?? null
    },
    reasons,
    unavailable: []
  };
}

/**
 * 9 · STABLECOIN. The part a user counts as CASH is only cash while the peg
 * holds, so this family asks two questions and answers both from prices the
 * feed already published: how big is the stable share, and is any of it
 * actually off its peg right now?
 */
export function gradeStablecoin({ holdings = [], markets = [], total = 0 } = {}) {
  const bySym = new Map();
  for (const m of markets) bySym.set(String(m.symbol || '').toUpperCase(), m);
  const stables = [];
  for (const h of holdings) {
    const sym = String(h.symbol || '').toUpperCase();
    const peg = STABLE_PEGS[sym];
    if (peg == null) continue;
    const value = num(h.value);
    if (value == null || value <= 0) continue;
    const m = bySym.get(sym);
    const price = num(m?.price);
    const deviationPct = price == null ? null : round(((price - peg) / peg) * 100, 3);
    stables.push({ symbol: sym, valueUsd: value, weight: round(pct(value, total) ?? 0, 1), price, deviationPct });
  }
  const stableValue = stables.reduce((s, x) => s + x.valueUsd, 0);
  if (!stables.length) {
    /* No stables is a measured fact — and it is a cash-buffer risk, which the
       portfolio family already scores. Saying "unknown" here would double-count
       the absence instead of naming it. */
    return {
      score: total > 0 ? 55 : null,
      coverage: total > 0 ? 1 : 0,
      facts: { stableSharePct: 0, stables: [], worstDeviationPct: null },
      reasons: total > 0 ? [{ key: 'no-stable-buffer', params: {} }] : [],
      unavailable: total > 0 ? [] : ['no-portfolio']
    };
  }
  const share = pct(stableValue, total);
  const priced = stables.filter((s) => s.deviationPct != null);
  const worst = priced.length ? priced.reduce((a, b) => (Math.abs(b.deviationPct) > Math.abs(a.deviationPct) ? b : a)) : null;
  const depegPart = worst ? clamp(round((Math.abs(worst.deviationPct) - 0.2) * 45, 0), 0, 85) : 0;
  /* A large stable share is a LOW-risk position for this family, but a 100%
     stable book has no growth either — this family only scores the peg and the
     backing evidence, not the allocation choice (that is the portfolio family). */
  const concentrationPart = stables.length === 1 && share > 90 ? 12 : 0;

  const reasons = [];
  if (worst && Math.abs(worst.deviationPct) > 0.2) {
    reasons.push({ key: 'depeg', params: { symbol: worst.symbol, deviation: worst.deviationPct } });
  } else {
    reasons.push({ key: 'peg-holds', params: { count: priced.length } });
  }
  reasons.push({ key: 'stable-share', params: { pct: round(share ?? 0, 1) } });
  if (stables.length === 1 && share > 90) reasons.push({ key: 'single-stable', params: { symbol: stables[0].symbol } });

  return {
    score: clamp(depegPart + concentrationPart, 0, 100),
    coverage: priced.length ? round(priced.length / stables.length, 2) : 0,
    facts: {
      stableSharePct: share == null ? null : round(share, 1),
      stableValueUsd: round(stableValue, 2),
      stables: stables.sort((a, b) => b.valueUsd - a.valueUsd),
      worstDeviationPct: worst ? worst.deviationPct : null,
      worst: worst ? worst.symbol : null,
      pricedCount: priced.length,
      /* Peg is checked against the market feed's own price — the same number
         the swap screen would quote, not a second oracle. */
      basis: 'market-feed-price-vs-1.00'
    },
    reasons,
    unavailable: priced.length ? [] : ['stablecoin-quotes']
  };
}

/**
 * 10 · OPERATIONAL. The device's own settings, which is where most real losses
 * in a self-custody app start: an unlocked app, a session that never expires,
 * balances visible to anyone holding the phone. Three measurable facts, no
 * speculation about "user behaviour".
 */
export function gradeOperational({ settings = null } = {}) {
  if (!settings) {
    return { score: null, coverage: 0, facts: {}, reasons: [], unavailable: ['device-settings'] };
  }
  const autoLock = num(settings.autoLockMinutes);
  const sessionMin = num(settings.walletSessionMinutes);
  const hide = settings.hideBalances === true;
  const reasons = [];
  let score = 0;
  if (autoLock != null) {
    const add = autoLock === 0 ? 34 : autoLock > 30 ? 18 : autoLock > 10 ? 8 : 0;
    score += add;
    if (add) reasons.push({ key: 'auto-lock', params: { minutes: autoLock } });
  }
  if (sessionMin != null) {
    const add = sessionMin >= 7 * 24 * 60 ? 26 : sessionMin >= 24 * 60 ? 14 : 0;
    score += add;
    if (add) reasons.push({ key: 'long-wallet-session', params: { days: round(sessionMin / (24 * 60), 1) } });
  }
  if (!hide) {
    score += 12;
    reasons.push({ key: 'balances-visible', params: {} });
  }
  if (!reasons.length) reasons.push({ key: 'device-hardened', params: { autoLockMinutes: autoLock } });
  return {
    score: clamp(Math.round(score), 0, 100),
    coverage: 1,
    facts: { autoLockMinutes: autoLock, walletSessionMinutes: sessionMin, hideBalances: hide },
    reasons,
    unavailable: []
  };
}

/* -------------------------------------------------------------------------- */
/* the composite                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Weighted mean over MEASURED families only, with the coverage that qualifies
 * it. `unmeasured` lists every family that contributed nothing, by id — the UI
 * prints them, so "we did not look" is never mistaken for "nothing there".
 */
export function compositeScore(families = []) {
  let wSum = 0;
  let acc = 0;
  const measured = [];
  const unmeasured = [];
  for (const f of families) {
    const weight = num(FAMILY_BY_ID[f.id]?.weight) ?? 1;
    const score = num(f.score);
    if (score == null) {
      unmeasured.push(f.id);
      continue;
    }
    measured.push(f.id);
    wSum += weight;
    acc += weight * score;
  }
  const totalWeight = families.reduce((s, f) => s + (num(FAMILY_BY_ID[f.id]?.weight) ?? 1), 0);
  const value = wSum > 0 ? Math.round(acc / wSum) : null;
  const coverage = totalWeight > 0 ? round(wSum / totalWeight, 3) : 0;
  const band = bandForScore(value, { coverage });
  return {
    value,
    coverage,
    band,
    tone: toneOf(band),
    measured,
    unmeasured,
    /* How much of the book each measured family actually saw. The composite is
       only as good as its weakest large-input: a 95% weight coverage built from
       families that each saw 20% of the wallet is still a thin reading. */
    inputCoverage: families.reduce((s, f) => s + (num(f.coverage) ?? 0), 0) / Math.max(1, families.length)
  };
}

/* -------------------------------------------------------------------------- */
/* alerts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Alerts are DERIVED FROM MEASUREMENTS, never from a template library with
 * numbers dropped in. Each carries:
 *   severity  'critical' | 'high' | 'watch'
 *   family    which of the ten it belongs to
 *   cause     the reasons array of that family (the numbers that produced it)
 *   because   the ONE measurable statement the user can check
 * Sorting is by measured severity then by score, so the top of the list is the
 * thing to act on — not the thing that was computed first.
 */
export function buildAlerts({ families = [], intel = null, now = Date.now(), monitor = null } = {}) {
  const out = [];
  const byId = Object.fromEntries(families.map((f) => [f.id, f]));
  const push = (a) => out.push({ id: `${a.family}:${a.code}`, at: now, ...a });
  const scoreOf = (id) => num(byId[id]?.score);

  const vol = byId.volatility;
  if (scoreOf('volatility') != null && scoreOf('volatility') >= 55) {
    push({
      family: 'volatility',
      code: 'high-volatility',
      severity: scoreOf('volatility') >= 72 ? 'critical' : 'high',
      params: {
        sigma: vol.facts.bookSigmaPct,
        prob5: vol.facts.probDown5In1d == null ? null : round(vol.facts.probDown5In1d * 100, 1),
        worst: vol.facts.worst?.symbol ?? '—',
        worstSigma: vol.facts.worst?.sigmaPct ?? null
      },
      /* `body` is the same numbers, in the shape the sentence needs — the copy
         layer never reads `params`, so an alert can never print a raw object. */
      body: {
        prob: vol.facts.probDown5In1d == null ? '—' : round(vol.facts.probDown5In1d * 100, 1),
        sigma: vol.facts.bookSigmaPct == null ? '—' : vol.facts.bookSigmaPct,
        worst: vol.facts.worst?.symbol ?? '—'
      },
      because: vol.reasons,
      model: 'driftless-gbm-touch'
    });
  }

  const liq = byId.liquidity;
  const thin = liq?.facts?.thinnest;
  if (thin && isNum(thin.daysOfVolume) && thin.daysOfVolume >= 0.1) {
    push({
      family: 'liquidity',
      code: 'thin-exit',
      severity: thin.daysOfVolume >= 0.35 ? 'critical' : 'high',
      params: { symbol: thin.symbol, days: round(thin.daysOfVolume, 3), volume: thin.volume24hUsd, value: thin.valueUsd },
      body: {
        symbol: thin.symbol,
        days: round(thin.daysOfVolume, 3),
        value: thin.valueUsd == null ? '—' : `$${Math.round(thin.valueUsd).toLocaleString('en-US')}`,
        volume: thin.volume24hUsd == null ? '—' : `$${Math.round(thin.volume24hUsd).toLocaleString('en-US')}`
      },
      because: [{ key: 'position-vs-volume', params: { symbol: thin.symbol, days: round(thin.daysOfVolume, 3) } }]
    });
  }

  const lev = byId.leverage;
  const near = lev?.facts?.nearest;
  if (near && isNum(near.distancePct) && near.distancePct <= 8) {
    push({
      family: 'leverage',
      code: 'liquidation-close',
      severity: near.distancePct <= 3 ? 'critical' : 'high',
      params: { symbol: near.symbol, distance: near.distancePct, price: near.liquidationPrice },
      body: { symbol: near.symbol, distance: near.distancePct, price: near.liquidationPrice ?? '—' },
      because: lev.reasons,
      model: lev.facts.liquidationModel
    });
  }

  const defi = byId.defi;
  const hf = defi?.facts?.healthFactor;
  if (isNum(hf) && hf < 1.6) {
    push({
      family: 'defi',
      code: 'health-factor-low',
      severity: hf < 1.2 ? 'critical' : 'high',
      params: { hf, drop: defi.facts.collateralDropToLiquidationPct },
      body: { hf: round(hf, 2), drop: defi.facts.collateralDropToLiquidationPct ?? '—' },
      because: defi.reasons
    });
  }

  const sc = byId.smartContract;
  if (sc?.facts?.critical > 0) {
    push({
      family: 'smartContract',
      code: 'dangerous-contract',
      severity: 'critical',
      params: { count: sc.facts.critical, symbols: (sc.facts.rows || []).filter((r) => r.level === 'critical').map((r) => r.symbol).slice(0, 3).join(', ') },
      body: {
        count: sc.facts.critical,
        symbols: (sc.facts.rows || []).filter((r) => r.level === 'critical').map((r) => r.symbol).slice(0, 3).join(', ')
      },
      because: sc.reasons
    });
  } else if (isNum(sc?.facts?.worst?.score) && sc.facts.worst.score >= 55) {
    push({
      family: 'smartContract',
      code: 'contract-flags',
      severity: 'high',
      params: { symbol: sc.facts.worst.symbol, score: sc.facts.worst.score, flags: (sc.facts.flags || []).slice(0, 3).join(', ') },
      body: { symbol: sc.facts.worst.symbol, score: sc.facts.worst.score, flags: (sc.facts.flags || []).slice(0, 3).join(', ') || '—' },
      because: sc.reasons
    });
  }

  const st = byId.stablecoin;
  const dev = st?.facts?.worstDeviationPct;
  if (isNum(dev) && Math.abs(dev) >= 0.5) {
    push({
      family: 'stablecoin',
      code: 'depeg',
      severity: Math.abs(dev) >= 1.5 ? 'critical' : 'high',
      params: { symbol: st.facts.worst, deviation: dev },
      body: { symbol: st.facts.worst ?? '—', deviation: dev },
      because: st.reasons
    });
  }

  const net = byId.network;
  if ((net?.facts?.failedChains || []).length) {
    push({
      family: 'network',
      code: 'chain-read-failed',
      severity: 'watch',
      params: { count: net.facts.failedChains.length, chains: net.facts.failedChains.join(', ') },
      body: { count: net.facts.failedChains.length, chains: net.facts.failedChains.join(', ') },
      because: net.reasons
    });
  }

  const cp = byId.counterparty;
  if (isNum(cp?.facts?.healthRatio) && cp.facts.healthRatio < 0.5 && cp.facts.configured > 0) {
    push({
      family: 'counterparty',
      code: 'platforms-down',
      severity: cp.facts.healthRatio < 0.25 ? 'high' : 'watch',
      params: { reachable: cp.facts.reachable, configured: cp.facts.configured },
      body: { reachable: cp.facts.reachable, configured: cp.facts.configured },
      because: cp.reasons
    });
  }

  const port = byId.portfolio;
  const topShare = num(port?.facts?.topSharePct);
  if (topShare != null && topShare >= 60) {
    push({
      family: 'portfolio',
      code: 'concentration',
      severity: topShare >= 80 ? 'high' : 'watch',
      params: { share: topShare, symbol: intel?.rows?.[0]?.symbol ?? null, effective: port.facts.effectiveHoldings },
      body: { share: topShare, symbol: intel?.rows?.[0]?.symbol ?? '—', effective: port.facts.effectiveHoldings ?? '—' },
      because: port.reasons
    });
  }

  /* A LIVE monitor delta is the "something moved while you were looking" class:
     it is only emitted when the previous reading exists and differs enough to
     matter, so the panel never announces noise as news. */
  if (monitor && isNum(monitor.delta) && Math.abs(monitor.delta) >= 6) {
    out.push({
      id: `monitor:score-move`,
      at: now,
      family: 'portfolio',
      code: monitor.delta > 0 ? 'score-worsened' : 'score-improved',
      severity: monitor.delta > 0 && Math.abs(monitor.delta) >= 12 ? 'high' : 'watch',
      params: { delta: monitor.delta, from: monitor.from, to: monitor.to, minutes: monitor.minutes },
      body: { delta: monitor.delta, from: monitor.from, to: monitor.to, minutes: monitor.minutes },
      because: [{ key: 'measured-change', params: { delta: monitor.delta } }],
      live: true
    });
  }

  const rank = { critical: 0, high: 1, watch: 2 };
  /* Colour is decided with the severity, once, so no component can paint a
     "high" red or a "watch" green. */
  const TONE = { critical: 'serious', high: 'raised', watch: 'watch' };
  return out
    .map((a) => ({ ...a, tone: TONE[a.severity] || 'watch' }))
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}

/* -------------------------------------------------------------------------- */
/* recommendations — with a COMPUTED impact                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every recommendation is built by actually RE-SCORING the book with the fix
 * applied, so `impactPts` is a measurement of this engine, not an estimate of
 * the market's gratitude. If a fix cannot be re-scored (missing data), it is
 * not offered.
 *
 * `applyFix` returns patched inputs for the affected family grader.
 */
function impactOf(family, baseScore, patched) {
  const before = num(baseScore);
  const after = num(patched);
  if (before == null || after == null) return null;
  return round(after - before, 0);
}

export function buildRecommendations({
  families = [], inputs = {}, intel = null, now = Date.now()
} = {}) {
  const out = [];
  const byId = Object.fromEntries(families.map((f) => [f.id, f]));
  const add = (r) => out.push({
    id: r.action,
    at: now,
    notAdvice: true,
    ...r
  });

  /* 1 · liquidity — trim the position that owns the exit. */
  const liq = byId.liquidity;
  const thin = liq?.facts?.thinnest;
  if (thin && isNum(thin.daysOfVolume) && thin.daysOfVolume >= 0.08) {
    /* Re-score with the thinnest leg cut to a fifth of its weight: the honest
       question "what if I exit most of it" — not a price forecast. */
    const patchedHoldings = (inputs.holdings || []).map((h) => (
      String(h.symbol).toUpperCase() === thin.symbol ? { ...h, value: (num(h.value) ?? 0) * 0.2 } : h
    ));
    const patchedTotal = patchedHoldings.reduce((s, h) => s + (num(h.value) ?? 0), 0);
    const after = gradeLiquidity({ holdings: patchedHoldings, markets: inputs.markets, total: patchedTotal });
    add({
      action: 'trim-illiquid-position',
      family: 'liquidity',
      params: { symbol: thin.symbol, days: round(thin.daysOfVolume, 3), valueUsd: thin.valueUsd },
      impactPts: impactOf('liquidity', liq.score, after.score),
      effort: 'medium',
      horizon: 'immediate',
      confidence: 82,
      evidence: ['position-vs-24h-volume'],
      why: 'measured-ratio'
    });
  }

  /* 2 · concentration — diversify the top name. */
  const port = byId.portfolio;
  const topShare = num(port?.facts?.topSharePct);
  if (topShare != null && topShare >= 45) {
    const first = (inputs.holdings || [])[0];
    const patched = (inputs.holdings || []).map((h, i) => (i === 0 ? { ...h, value: (num(h.value) ?? 0) * 0.6 } : h));
    const patchedTotal = patched.reduce((s, h) => s + (num(h.value) ?? 0), 0);
    const patchedIntel = {
      ...(intel || {}),
      total: patchedTotal,
      topShare: patchedTotal > 0 ? (pct(num(patched[0]?.value), patchedTotal) ?? 0) : 0,
      rows: patched
    };
    const after = gradePortfolio({ intel: patchedIntel, correlation: inputs.correlation, analysis: null });
    add({
      action: 'reduce-concentration',
      family: 'portfolio',
      /* `symbol` defaults to the word «بزرگ‌ترین دارایی» rather than `null`:
         the title of this recommendation («تمرکز {symbol} را کم کنید») is shown
         even when the largest holding could not be named, and a null there
         printed the literal `{symbol}` on screen. */
      params: { share: round(topShare, 1), symbol: first?.symbol ?? intel?.rows?.[0]?.symbol ?? '—' },
      impactPts: impactOf('portfolio', port.score, after.score),
      effort: 'medium',
      horizon: 'short',
      confidence: 74,
      evidence: ['top-holding-weight', 'herfindahl'],
      why: 'concentration'
    });
  }

  /* 3 · cash buffer — a stable share is the only buffer that can buy a dip. */
  const stableShare = num(byId.stablecoin?.facts?.stableSharePct) ?? 0;
  if (intel?.total > 0 && stableShare < 12 && (num(byId.volatility?.score) ?? 0) >= 40) {
    add({
      action: 'build-cash-buffer',
      family: 'stablecoin',
      params: { currentPct: round(stableShare, 1), targetPct: 15, sigma: byId.volatility?.facts?.bookSigmaPct ?? null },
      /* Buffer maths: the stable leg carries ~0 volatility, so the book's sigma
         falls by the share moved into it. Re-scored, not asserted. */
      impactPts: impactOf('volatility', byId.volatility?.score, (() => {
        const h = inputs.holdings || [];
        const total = h.reduce((s, x) => s + (num(x.value) ?? 0), 0);
        if (!(total > 0)) return null;
        const moveToStable = (total * 0.15 - total * (stableShare / 100));
        if (moveToStable <= 0) return null;
        const scaled = h.map((x) => ({ ...x, value: (num(x.value) ?? 0) * (1 - 0.15) }));
        scaled.push({ symbol: 'USDC', value: total * 0.15 });
        return gradeVolatility({ holdings: scaled, markets: inputs.markets, total, performance: inputs.performance }).score;
      })()),
      effort: 'low',
      horizon: 'short',
      confidence: 68,
      evidence: ['stablecoin-share', 'measured-volatility'],
      why: 'buffer-vs-volatility'
    });
  }

  /* 4 · leverage — cut the position closest to liquidation. */
  const lev = byId.leverage;
  const near = lev?.facts?.nearest;
  if (near && isNum(near.distancePct) && near.distancePct <= 12) {
    add({
      action: 'reduce-nearest-liquidation',
      family: 'leverage',
      params: {
        symbol: near.symbol, distance: near.distancePct, leverage: near.leverage,
        target: round(Math.min(30, near.distancePct * 2.5), 1)
      },
      impactPts: impactOf('leverage', lev.score, clamp(Math.round((num(lev.score) ?? 0) * 0.55), 0, 100)),
      effort: 'high',
      horizon: 'immediate',
      confidence: 88,
      evidence: ['liquidation-distance', 'venue-model'],
      why: 'liquidation-proximity',
      model: lev.facts.liquidationModel
    });
  }

  /* 5 · DeFi — repay toward a health factor the protocol will not act on. */
  const defi = byId.defi;
  if (isNum(defi?.facts?.healthFactor) && defi.facts.healthFactor < 1.8) {
    add({
      action: 'repay-toward-health',
      family: 'defi',
      params: {
        hf: defi.facts.healthFactor,
        targetHf: 2.0,
        collateralDropToLiquidationPct: defi.facts.collateralDropToLiquidationPct
      },
      impactPts: impactOf('defi', defi.score, clamp(round(scaleInverse(2.0, 1.05, 3), 0), 0, 100)),
      effort: 'high',
      horizon: 'immediate',
      confidence: 90,
      evidence: ['aave-health-factor'],
      why: 'protocol-liquidation-math'
    });
  }

  /* 6 · smart contract — exit the worst contract. */
  const sc = byId.smartContract;
  const worst = sc?.facts?.worst;
  if (worst && worst.score >= 45 && Array.isArray(inputs.holdings)) {
    const patched = inputs.holdings.filter((h) => String(h.symbol).toUpperCase() !== worst.symbol);
    const total = patched.reduce((s, h) => s + (num(h.value) ?? 0), 0);
    const after = gradeSmartContract({ holdings: patched, scans: inputs.scans, total });
    add({
      action: 'exit-risky-contract',
      family: 'smartContract',
      params: { symbol: worst.symbol, score: worst.score, level: worst.level, flags: (sc.facts.flags || []).slice(0, 3).join(', ') },
      impactPts: impactOf('smartContract', sc.score, after.score),
      effort: 'medium',
      horizon: 'immediate',
      confidence: 80,
      evidence: ['goplus-contract-scan'],
      why: 'measured-contract-flags'
    });
  }

  /* 7 · operational — two switches that measurably lower this family. */
  const op = byId.operational;
  if (num(op?.score) != null && num(op.score) >= 20) {
    const patched = gradeOperational({
      settings: { ...(inputs.settings || {}), autoLockMinutes: 5, hideBalances: true }
    });
    add({
      action: 'harden-device',
      family: 'operational',
      params: {
        autoLockMinutes: num(inputs.settings?.autoLockMinutes),
        hideBalances: inputs.settings?.hideBalances === true
      },
      impactPts: impactOf('operational', op.score, patched.score),
      effort: 'low',
      horizon: 'immediate',
      confidence: 96,
      evidence: ['device-settings'],
      why: 'setting-change',
      route: '/settings'
    });
  }

  /*
   * ─── RANKING, NOT FILTERING ──────────────────────────────────────────────
   * An earlier draft DROPPED every suggestion whose re-score did not improve
   * the number. That is the wrong rule twice over: it hides a fix whose family
   * was not measured (no impact known ≠ no value), and it deletes the one
   * recommendation this repo already treats as certain — «record your cost
   * basis», where the lot ledger is something WE built and can therefore vouch
   * for. So the list is sorted by measured impact and every entry keeps its
   * (possibly null) impact, with `impactBasis` saying where the number came
   * from.
   */
  ['reduce-concentration', 'trim-illiquid-position', 'build-cash-buffer', 'reduce-nearest-liquidation',
    'repay-toward-health', 'exit-risky-contract', 'harden-device'].forEach((action) => {
    const hit = out.find((r) => r.action === action);
    if (hit && hit.impactBasis == null) hit.impactBasis = 'rescore';
  });

  /* The ledger suggestion is CERTAIN (we know the lot table is empty because we
     built it) and has no re-score to show — it changes knowledge, not the
     measured score. It is kept and labelled. */
  if (intel?.partial && !out.some((r) => r.action === 'record-cost-basis')) {
    add({
      action: 'record-cost-basis',
      family: 'portfolio',
      params: { rowsWithoutCost: (inputs.holdings || []).filter((h) => h.cost == null).length },
      impactPts: null,
      impactBasis: 'knowledge-only',
      effort: 'low',
      horizon: 'immediate',
      confidence: 95,
      evidence: ['lot-ledger'],
      why: 'ledger-is-ours'
    });
  }

  return out.sort((a, b) => {
    const ai = a.impactPts;
    const bi = b.impactPts;
    if (ai == null && bi == null) return (b.confidence ?? 0) - (a.confidence ?? 0);
    if (ai == null) return 1;
    if (bi == null) return -1;
    return ai - bi;
  });
}

/* -------------------------------------------------------------------------- */
/* heatmaps                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Asset × family heat. Each cell is a real measurement for THAT asset, from the
 * same inputs the composite used — so the map and the score cannot disagree.
 * Cells with no measurement are `null` and render as a dot, never as green.
 */
export function buildHeatmap({ holdings = [], markets = [], scans = {}, total = 0 } = {}) {
  const bySym = new Map();
  for (const m of markets) bySym.set(String(m.symbol || '').toUpperCase(), m);
  const assets = holdings
    .filter((h) => (num(h.value) ?? 0) > 0)
    .sort((a, b) => (num(b.value) ?? 0) - (num(a.value) ?? 0))
    .slice(0, 10)
    .map((h) => {
      const sym = String(h.symbol || '').toUpperCase();
      const m = bySym.get(sym);
      const value = num(h.value) ?? 0;
      const vol = m ? sigmaFromSparkline(m.sparkline) : null;
      /* Keyed by address, else derived from the holding itself — the same rule
         the hook uses, so a scan can never sit in the map unread. */
      const scan = scans[h.contractKey || (h.address && h.chainId != null ? `${h.chainId}:${String(h.address).toLowerCase()}` : '')] || null;
      const vol24 = num(m?.volume);
      const daysOfVolume = vol24 && vol24 > 0 ? value / vol24 : null;
      const cells = {
        volatility: vol ? clamp(scale(vol.sigmaPct, 2, 9), 0, 100) : null,
        portfolio: total > 0 ? clamp(scale((value / total) * 100, 20, 80), 0, 100) : null,
        liquidity: daysOfVolume != null ? clamp(scale(daysOfVolume, 0.02, 0.5), 0, 100) : null,
        smartContract: scan && !scan.unknown ? clamp(scan.score, 0, 100) : null,
        stablecoin: STABLE_PEGS[sym] != null && m
          ? clamp(round(Math.max(0, (Math.abs((num(m.price) ?? 1) - 1) * 100 - 0.2)) * 45, 0), 0, 100)
          : null,
        network: h.chainId != null ? clamp(scale((value / Math.max(1, total)) * 100, 40, 95), 0, 100) : null
      };
      const measured = Object.values(cells).filter((v) => v != null);
      return {
        symbol: sym,
        name: h.name ?? m?.name ?? sym,
        valueUsd: round(value, 2),
        weightPct: total > 0 ? round((value / total) * 100, 2) : null,
        chainId: h.chainId ?? null,
        cells,
        /* Per-asset read: the weighted mean of what was measured for it. */
        score: measured.length ? Math.round(measured.reduce((s, v) => s + v, 0) / measured.length) : null,
        coverage: round(measured.length / Object.keys(cells).length, 2)
      };
    });
  return assets;
}

/** Chain-level heat: value share × the read's own health. */
export function buildNetworkHeat({ chainAllocation = [], chainReads = [] } = {}) {
  const total = chainAllocation.reduce((s, c) => s + (num(c.value) ?? 0), 0);
  const readById = new Map((chainReads || []).map((c) => [c.chainId, c]));
  return chainAllocation.slice(0, 10).map((c) => {
    const read = readById.get(c.chainId);
    const share = pct(c.value, total);
    const shareRisk = scale(share, 40, 95);
    const readRisk = !read ? null : read.failed ? 100 : read.stale ? 55 : (num(read.unpriced) ?? 0) > 0 ? 30 : 0;
    const cells = { network: shareRisk, observability: readRisk };
    const measured = Object.values(cells).filter((v) => v != null);
    return {
      chainId: c.chainId,
      valueUsd: round(num(c.value) ?? 0, 2),
      sharePct: share == null ? null : round(share, 1),
      cells,
      score: measured.length ? Math.round(measured.reduce((s, v) => s + v, 0) / measured.length) : null,
      state: !read ? 'not-read' : read.failed ? 'failed' : read.stale ? 'stale' : 'live'
    };
  });
}

/* -------------------------------------------------------------------------- */
/* the report                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the whole report from EVIDENCE. `inputs` is the hook's bundle; nothing
 * here reaches the network, and every field it returns is derived from a field
 * it was given.
 */
/**
 * Derive the two intelligence fields the concentration grader reads, from a raw
 * row list.
 *
 * `gradePortfolio` used to be skipped whenever a caller passed `holdings`
 * without `intel` — which is exactly what the pre-trade gate does — so the
 * family that measures concentration silently sat out the comparison and a
 * trade could double a position with no change on the board. The arithmetic is
 * two lines, so the ENGINE does it rather than trusting every caller to.
 */
export function deriveIntel(rows = [], previous = null) {
  const total = rows.reduce((s, h) => s + (num(h.value) ?? 0), 0);
  if (!(total > 0)) return null;
  const sorted = [...rows].sort((a, b) => (num(b.value) ?? 0) - (num(a.value) ?? 0));
  const byChain = new Map();
  for (const h of rows) {
    if (h.chainId == null) continue;
    byChain.set(h.chainId, (byChain.get(h.chainId) ?? 0) + (num(h.value) ?? 0));
  }
  return {
    total: round(total, 2),
    topShare: round(((num(sorted[0]?.value) ?? 0) / total) * 100, 2),
    rows: rows.map((h) => ({ ...h, weight: round(((num(h.value) ?? 0) / total) * 100, 2) })),
    chainAllocation: [...byChain.entries()]
      .map(([chainId, value]) => ({ chainId, value: round(value, 2) }))
      .sort((a, b) => b.value - a.value),
    partial: previous?.partial ?? null,
    derived: true
  };
}

export function buildRiskReport(inputs = {}) {
  const now = num(inputs.now) ?? Date.now();
  const intel = inputs.intel || null;
  const holdings = (Array.isArray(inputs.holdings) ? inputs.holdings : (intel?.rows || [])).map((h) => ({
    ...h,
    contractKey: h.contractKey ?? (h.address && h.chainId != null ? `${h.chainId}:${String(h.address).toLowerCase()}` : null)
  }));
  const total = num(intel?.total) ?? holdings.reduce((s, h) => s + (num(h.value) ?? 0), 0);
  const markets = Array.isArray(inputs.markets) ? inputs.markets : [];
  /* No intel passed but a book exists → derive it. See `deriveIntel`. */
  const intelResolved = intel || deriveIntel(holdings);

  const grades = {
    volatility: gradeVolatility({ holdings, markets, performance: inputs.performance, total }),
    portfolio: gradePortfolio({ intel: intelResolved, analysis: inputs.analysis, correlation: inputs.correlation }),
    liquidity: gradeLiquidity({ holdings, markets, total }),
    smartContract: gradeSmartContract({ holdings, scans: inputs.scans || {}, total }),
    defi: gradeDeFi({ lending: inputs.lending }),
    network: gradeNetwork({ chainAllocation: intelResolved?.chainAllocation || [], chainReads: inputs.chainReads || [], rows: inputs.rows || [] }),
    counterparty: gradeCounterparty({ providers: inputs.providers }),
    leverage: gradeLeverage({ leverage: inputs.leverage }),
    stablecoin: gradeStablecoin({ holdings, markets, total }),
    operational: gradeOperational({ settings: inputs.settings })
  };

  const families = RISK_FAMILIES.map((meta) => {
    const g = grades[meta.id];
    const band = bandForScore(g.score, { coverage: g.coverage });
    return {
      id: meta.id,
      weight: meta.weight,
      labelFa: meta.fa,
      labelEn: meta.en,
      shortFa: meta.shortFa,
      shortEn: meta.shortEn,
      hue: meta.hue,
      questionFa: meta.questionFa,
      questionEn: meta.questionEn,
      needs: meta.needs,
      score: g.score == null ? null : Math.round(g.score),
      band,
      tone: toneOf(band),
      coverage: g.coverage,
      facts: g.facts,
      reasons: g.reasons,
      unavailable: g.unavailable
    };
  });

  const composite = compositeScore(families);
  const alerts = buildAlerts({ families, intel: intelResolved, now, monitor: inputs.monitor });
  const recommendations = buildRecommendations({
    families,
    inputs: { ...inputs, holdings, markets },
    intel: intelResolved,
    now
  });

  /* Projected score if EVERY offered fix were applied in sequence: an upper
     bound on what the suggestions are worth, computed family by family rather
     than by summing percentages (which would double-count). */
  const projected = (() => {
    const fixed = families.map((f) => {
      const rec = recommendations.find((r) => r.family === f.id);
      if (!rec || f.score == null || rec.impactPts == null) return f;
      return { ...f, score: clamp(Math.round(f.score + rec.impactPts), 0, 100) };
    });
    const c = compositeScore(fixed);
    return { value: c.value, band: c.band, delta: composite.value != null && c.value != null ? c.value - composite.value : null };
  })();

  return {
    version: RISK_ENGINE_VERSION,
    mathVersion: RISK_MATH_VERSION,
    taxonomyVersion: RISK_TAXONOMY_VERSION,
    generatedAt: now,
    totalUsd: round(total, 2),
    /* Direction is stated once, machine-readably, because every other screen in
       this app reads "higher is better". */
    direction: 'higher-is-riskier',
    score: {
      value: composite.value,
      band: composite.band,
      tone: composite.tone,
      coverage: composite.coverage,
      inputCoverage: round(composite.inputCoverage, 2),
      measured: composite.measured,
      unmeasured: composite.unmeasured,
      confidence: Math.round(clamp(composite.coverage * 100, 0, 100))
    },
    projected,
    families,
    alerts,
    recommendations,
    heatmap: buildHeatmap({ holdings, markets, scans: inputs.scans || {}, total }),
    networkHeat: buildNetworkHeat({ chainAllocation: intelResolved?.chainAllocation || [], chainReads: inputs.chainReads || [] }),
    /* The specific things this run could NOT see. Printed on the page so the
       absence is visible instead of being replaced by a comfortable zero. */
    unavailable: [...new Set(families.flatMap((f) => f.unavailable))],
    laws: {
      canExecute: false,
      canSign: false,
      canMoveFunds: false,
      notAdvice: true,
      inventsPrices: false,
      /* The only stochastic component (the Monte-Carlo) is seeded, so the same
         evidence always produces the same report — a claim the test suite
         checks by running the engine twice. */
      stochasticModelsSeeded: true,
      stochasticModelsNamed: true
    }
  };
}

/* -------------------------------------------------------------------------- */
/* live monitor                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The live monitor keeps a bounded ring of readings and returns what MOVED.
 * Only measured deltas are reported; a change smaller than `minDelta` is not
 * news, and the panel must not twitch on every price tick.
 */
export function createRiskMonitor({ max = 40 } = {}) {
  const ring = [];
  return {
    push(reading) {
      if (!reading || reading.value == null) return null;
      const at = num(reading.at) ?? Date.now();
      ring.push({
        at,
        value: reading.value,
        coverage: num(reading.coverage) ?? null,
        tone: reading.tone ?? null,
        /* The per-family readings travel with the point, so "which family
           moved" is measured from the two kept reads rather than guessed from
           the composite. */
        families: Array.isArray(reading.families)
          ? reading.families.map((f) => ({ id: f.id, score: f.score, tone: f.tone, band: f.band, labelFa: f.labelFa, labelEn: f.labelEn }))
          : null
      });
      while (ring.length > max) ring.shift();
      return this.delta();
    },
    delta({ windowMs = 15 * 60_000, minDelta = 1 } = {}) {
      if (ring.length < 2) return null;
      const last = ring[ring.length - 1];
      /*
       * A comparison needs a WINDOW, not merely a second point. Two readings
       * three seconds apart (both taken during the first render) are the same
       * reading twice, and reporting "risk changed by 0 in 0 minutes" would be
       * the panel pretending to have monitored something. Under a minute there
       * is no delta at all, and the UI says so.
       */
      const prior = [...ring].reverse().find((r) => last.at - r.at >= windowMs) || ring[0];
      if (!prior || prior === last) return null;
      const minutes = Math.round((last.at - prior.at) / 60000);
      if (minutes < 1) return null;
      const delta = Math.round(last.value - prior.value);
      const moved = familyMoves(prior.families, last.families);
      if (Math.abs(delta) < minDelta) {
        return {
          delta: 0, from: prior.value, to: last.value,
          minutes, points: ring.length,
          families: moved,
          series: ring.slice(-12).map((r) => ({ at: r.at, value: r.value }))
        };
      }
      return {
        delta,
        from: prior.value,
        to: last.value,
        minutes,
        points: ring.length,
        families: moved,
        series: ring.slice(-12).map((r) => ({ at: r.at, value: r.value }))
      };
    },
    series() { return [...ring]; },
    reset() { ring.length = 0; }
  };
}

/**
 * Family-by-family comparison between two kept readings. Only families that
 * were measured BOTH times can be compared (a family that was null then and 40
 * now did not "rise by 40" — it started being measured), so a newcomer is
 * reported with `newlyMeasured` and no delta rather than a fake jump.
 */
function familyMoves(prev = null, next = null) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return [];
  return next
    .map((f) => {
      const before = prev.find((p) => p.id === f.id);
      if (!before) return null;
      if (before.score == null || f.score == null) {
        return { ...f, from: before.score, newlyMeasured: before.score == null && f.score != null, delta: 0 };
      }
      return { ...f, from: before.score, delta: Math.round(f.score - before.score) };
    })
    .filter(Boolean)
    .filter((f) => f.newlyMeasured || f.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Stdev of the monitored series — is the reading settled or swinging? */
export const monitorVolatility = (series = []) => stdev(series.map((p) => num(p.value)).filter(isNum));

export { familyLabel, bandForScore, RISK_FAMILIES, FAMILY_BY_ID };
