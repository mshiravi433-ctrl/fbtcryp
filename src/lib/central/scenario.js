/**
 * FBT FINANCIAL OS — Scenario Engine, Monte Carlo, Optimizer, Twin
 * (Upgrade 10 §13, §14, §15, §47, §48).
 * ---------------------------------------------------------------------------
 * Four related things that all answer "what happens if", built on the same
 * arithmetic so a scenario, a projection and a twin can never disagree:
 *
 *   runScenarios()      Bull / Base / Bear / Stress / Extreme + custom shocks
 *   monteCarlo()        a distribution (P10..P90), not a single number
 *   optimizePortfolio() Conservative / Balanced / Growth allocations
 *   twinProject()       the Financial Twin: apply a change WITHOUT touching a wallet
 *
 * WHY THE OUTPUT IS ALWAYS A RANGE
 * §15 and §54 together forbid presenting a forecast as a fact. Every projection
 * here returns percentiles and an `estimate: true` flag, and the Monte Carlo
 * carries its own seed so the same inputs give the same answer twice — a
 * forecast that changes when you re-open the page is not a forecast.
 */
import { CI_SCHEMA, round, usableNumber } from './schema.js';
import { simulateShock } from './analysis.js';

export const SCENARIO_SCHEMA = 'fbt.central-scenario.v1';
export const TWIN_SCHEMA = 'fbt.financial-twin.v1';

const num = (v) => usableNumber(v);

/** The five standard scenarios, as price shocks on risk assets. */
export const STANDARD_SCENARIOS = Object.freeze({
  BULL: { id: 'BULL', label: 'Bull', shockPct: 40, gasMultiplier: 1.2, liquidityDeltaPct: 10, stableDepeg: false },
  BASE: { id: 'BASE', label: 'Base', shockPct: 0, gasMultiplier: 1, liquidityDeltaPct: 0, stableDepeg: false },
  BEAR: { id: 'BEAR', label: 'Bear', shockPct: -25, gasMultiplier: 1.5, liquidityDeltaPct: -20, stableDepeg: false },
  STRESS: { id: 'STRESS', label: 'Stress', shockPct: -45, gasMultiplier: 3, liquidityDeltaPct: -40, stableDepeg: false },
  EXTREME_STRESS: { id: 'EXTREME_STRESS', label: 'Extreme stress', shockPct: -65, gasMultiplier: 5, liquidityDeltaPct: -60, stableDepeg: true }
});

/**
 * Apply each scenario to the REAL sections through the existing shock model.
 * Custom scenarios (per-asset shocks, depeg, gas multiplier) are accepted and
 * validated; an out-of-range shock is rejected rather than clamped silently.
 */
export function runScenarios(sections = {}, { custom = [], now = Date.now() } = {}) {
  const list = [...Object.values(STANDARD_SCENARIOS)];
  const rejected = [];
  for (const c of Array.isArray(custom) ? custom : []) {
    const shock = num(c?.shockPct);
    if (shock === null || shock < -95 || shock > 300) { rejected.push({ id: c?.id || 'custom', code: 'SHOCK_OUT_OF_RANGE', allowed: '-95..300' }); continue; }
    list.push({
      id: String(c.id || 'CUSTOM').slice(0, 32).toUpperCase(),
      label: String(c.label || c.id || 'Custom').slice(0, 40),
      shockPct: shock,
      shockByAsset: c.shockByAsset && typeof c.shockByAsset === 'object' ? c.shockByAsset : null,
      gasMultiplier: num(c.gasMultiplier) ?? 1,
      liquidityDeltaPct: num(c.liquidityDeltaPct) ?? 0,
      stableDepeg: c.stableDepeg === true,
      custom: true
    });
  }

  const results = [];
  for (const s of list) {
    const shocked = simulateShock(sections, s.shockPct, { shockByAsset: s.shockByAsset || null });
    if (shocked.status !== 'OK') { results.push({ ...s, status: 'UNAVAILABLE', reason: shocked.reason }); continue; }
    /* A stablecoin depeg is a SEPARATE haircut applied to the stable leg: the
       price shock model above does not move stables, which is correct in every
       scenario except this one. */
    const stableUsd = num(sections?.financialState?.stableUsd) ?? 0;
    const depegLossUsd = s.stableDepeg ? round(stableUsd * 0.05, 2) : 0;
    results.push({
      ...s,
      status: 'OK',
      valueBeforeUsd: shocked.valueBeforeUsd,
      valueAfterUsd: round(shocked.valueAfterUsd - depegLossUsd, 2),
      deltaUsd: round(shocked.deltaUsd - depegLossUsd, 2),
      deltaPct: shocked.deltaPct,
      depegLossUsd: depegLossUsd || null,
      liquidation: shocked.liquidation,
      nearLiquidation: shocked.nearLiquidation,
      gasNote: s.gasMultiplier > 1 ? `gas assumed ${s.gasMultiplier}× — exit costs rise exactly when you would want to exit` : null,
      liquidityNote: s.liquidityDeltaPct < 0 ? `venue depth assumed ${Math.abs(s.liquidityDeltaPct)}% thinner; realised slippage on an exit would exceed today's quote` : null
    });
  }
  const usable = results.filter((r) => r.status === 'OK');
  return {
    schema: SCENARIO_SCHEMA, brain: CI_SCHEMA,
    status: usable.length ? 'OK' : 'UNAVAILABLE',
    reason: usable.length ? null : (results[0]?.reason || 'NO_PORTFOLIO_STATE'),
    at: now,
    scenarios: results,
    rejected,
    worst: usable.length ? usable.reduce((a, b) => (a.deltaUsd <= b.deltaUsd ? a : b)).id : null,
    estimate: true,
    method: 'linear price shock on live holdings, health factors rescaled proportionally, depeg and gas applied as separate haircuts'
  };
}

/* ── §15 Monte Carlo ───────────────────────────────────────────────────── */

/** Deterministic PRNG — same seed, same distribution, every time. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Box–Muller, using the seeded uniform stream. */
function gaussian(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Probabilistic projection of a portfolio value over a horizon.
 *
 * Returns percentiles, never a point estimate. `paths` is bounded because this
 * runs inside a request; 4000 paths is enough for stable deciles and cheap
 * enough not to become a latency bug.
 */
export function monteCarlo({
  startUsd, months = 12, expectedReturnPct = 12, volatilityPct = 60,
  monthlyContributionUsd = 0, paths = 4000, seed = 20260905, fatTails = true
} = {}) {
  const start = num(startUsd);
  const m = Math.max(1, Math.round(num(months) ?? 12));
  if (start === null || start <= 0) {
    return { schema: SCENARIO_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_STARTING_VALUE', needed: 'a readable portfolio value' };
  }
  const vol = Math.max(0.01, (num(volatilityPct) ?? 60) / 100);
  const mu = (num(expectedReturnPct) ?? 12) / 100;
  const contribution = num(monthlyContributionUsd) ?? 0;
  const n = Math.max(200, Math.min(20_000, Math.round(num(paths) ?? 4000)));
  const rand = mulberry32(Number(seed) || 1);
  const dt = 1 / 12;
  const drift = (mu - 0.5 * vol * vol) * dt;
  const sd = vol * Math.sqrt(dt);
  const finals = new Float64Array(n);
  let ruin = 0;
  for (let p = 0; p < n; p += 1) {
    let value = start;
    let minValue = start;
    for (let step = 0; step < m; step += 1) {
      let z = gaussian(rand);
      /* Crypto returns are not lognormal in the tails. A Student-t-ish kick on
         5% of steps is a crude but HONEST correction: without it the model
         systematically understates the left tail, which is the only part of the
         distribution a risk decision depends on. */
      if (fatTails && rand() < 0.05) z *= 2.5;
      value = value * Math.exp(drift + sd * z) + contribution;
      if (value < minValue) minValue = value;
      if (value <= 0) { value = 0; break; }
    }
    if (minValue <= start * 0.5) ruin += 1;
    finals[p] = value;
  }
  const sorted = Array.from(finals).sort((a, b) => a - b);
  const at = (q) => round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))], 2);
  const mean = round(sorted.reduce((a, b) => a + b, 0) / sorted.length, 2);
  return {
    schema: SCENARIO_SCHEMA, brain: CI_SCHEMA, status: 'OK',
    startUsd: round(start, 2), months: m, paths: n, seed: Number(seed) || 1,
    percentiles: { p10: at(0.10), p25: at(0.25), p50: at(0.50), p75: at(0.75), p90: at(0.90) },
    meanUsd: mean,
    probabilityOfLossPct: round((sorted.filter((v) => v < start).length / sorted.length) * 100, 1),
    probabilityOfHalvingPct: round((ruin / n) * 100, 1),
    assumptions: {
      expectedReturnPct: round(mu * 100, 2), volatilityPct: round(vol * 100, 2),
      monthlyContributionUsd: round(contribution, 2),
      model: fatTails ? 'GBM with a 5% fat-tail shock multiplier' : 'geometric Brownian motion'
    },
    estimate: true,
    disclaimer: 'a distribution of modelled outcomes, not a prediction; real crypto drawdowns have exceeded every percentile shown here'
  };
}

/* ── §13 Portfolio Optimizer ───────────────────────────────────────────── */

export const ALLOCATION_PRESETS = Object.freeze({
  CONSERVATIVE: { id: 'CONSERVATIVE', label: 'Conservative', stable: 0.65, majors: 0.30, alt: 0.05, expectedReturnPct: 6, volatilityPct: 18 },
  BALANCED: { id: 'BALANCED', label: 'Balanced', stable: 0.40, majors: 0.45, alt: 0.15, expectedReturnPct: 14, volatilityPct: 38 },
  GROWTH: { id: 'GROWTH', label: 'Growth', stable: 0.15, majors: 0.55, alt: 0.30, expectedReturnPct: 24, volatilityPct: 62 }
});

/**
 * Produce candidate allocations with modelled return, volatility, drawdown and
 * diversification, plus the DELTA from where the user actually is today. The
 * delta is the part that turns an allocation into an action list.
 */
export function optimizePortfolio({ financialState = null, presets = null, now = Date.now() } = {}) {
  const fs = financialState;
  const capital = num(fs?.netWorthUsd ?? fs?.availableCapitalUsd);
  if (capital === null || capital <= 0) {
    return { schema: SCENARIO_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_CAPITAL_READ', needed: 'a readable portfolio value' };
  }
  const currentStablePct = num(fs?.stableSharePct) ?? null;
  const rows = Object.values(presets || ALLOCATION_PRESETS).map((p) => {
    const vol = p.volatilityPct;
    /* A 1-year 95% drawdown estimate under a lognormal assumption: 1.65σ. It is
       labelled an estimate everywhere it is printed. */
    const maxDrawdownEstPct = round(-Math.min(95, 1.65 * vol), 1);
    const weights = { stable: p.stable, majors: p.majors, alt: p.alt };
    const hhi = round(Object.values(weights).reduce((a, w) => a + w * w, 0), 4);
    return {
      id: p.id, label: p.label,
      allocation: {
        stableUsd: round(capital * p.stable, 2),
        majorsUsd: round(capital * p.majors, 2),
        altUsd: round(capital * p.alt, 2),
        weights
      },
      expectedReturnPct: p.expectedReturnPct,
      expectedVolatilityPct: vol,
      maxDrawdownEstimatePct: maxDrawdownEstPct,
      liquidity: p.stable >= 0.5 ? 'HIGH' : p.stable >= 0.25 ? 'NORMAL' : 'LOW',
      diversificationHhi: hhi,
      deltaFromCurrent: currentStablePct === null ? null : {
        stablePctChange: round(p.stable * 100 - currentStablePct, 2),
        moveUsd: round(Math.abs(p.stable * 100 - currentStablePct) / 100 * capital, 2)
      },
      estimate: true
    };
  });
  return {
    schema: SCENARIO_SCHEMA, brain: CI_SCHEMA, status: 'OK', at: now,
    capitalUsd: round(capital, 2),
    portfolios: rows,
    currentStableSharePct: currentStablePct,
    method: 'preset risk buckets scaled to the read portfolio value; volatility and drawdown are modelled, not backtested on this user\'s holdings',
    estimate: true
  };
}

/* ── §47/§48 Financial Twin ────────────────────────────────────────────── */

/**
 * Apply a hypothetical change to a COPY of the financial state and re-run the
 * scenarios and the projection on it. Nothing here can reach a wallet: the twin
 * takes plain numbers and returns plain numbers.
 */
export function twinProject({
  financialState = null, change = {}, horizonsMonths = [3, 6, 12], expectedReturnPct = 12, volatilityPct = 60, seed = 20260905
} = {}) {
  const fs = financialState;
  const base = num(fs?.netWorthUsd ?? fs?.availableCapitalUsd);
  if (base === null) return { schema: TWIN_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_FINANCIAL_STATE' };

  const movePct = num(change.movePctOfPortfolio);
  const addUsd = num(change.addCapitalUsd) ?? 0;
  const removeUsd = num(change.removeCapitalUsd) ?? 0;
  const targetReturnPct = num(change.expectedReturnPct) ?? num(expectedReturnPct);
  const targetVolPct = num(change.volatilityPct) ?? num(volatilityPct);

  const movedUsd = movePct === null ? 0 : round(base * (movePct / 100), 2);
  const afterUsd = round(base + addUsd - removeUsd, 2);
  if (afterUsd < 0) return { schema: TWIN_SCHEMA, status: 'UNAVAILABLE', reason: 'CHANGE_EXCEEDS_CAPITAL', detail: `removing ${removeUsd} from ${base} leaves a negative balance` };

  const projections = horizonsMonths.map((m) => ({
    months: m,
    before: monteCarlo({ startUsd: base, months: m, expectedReturnPct, volatilityPct, seed }),
    after: monteCarlo({ startUsd: afterUsd, months: m, expectedReturnPct: targetReturnPct, volatilityPct: targetVolPct, seed })
  })).map((row) => ({
    months: row.months,
    beforeP50: row.before.percentiles?.p50 ?? null,
    afterP50: row.after.percentiles?.p50 ?? null,
    beforeP10: row.before.percentiles?.p10 ?? null,
    afterP10: row.after.percentiles?.p10 ?? null,
    deltaP50: row.before.percentiles && row.after.percentiles ? round(row.after.percentiles.p50 - row.before.percentiles.p50, 2) : null
  }));

  return {
    schema: TWIN_SCHEMA, brain: CI_SCHEMA, status: 'OK',
    baseUsd: round(base, 2),
    afterUsd,
    movedUsd: movedUsd || null,
    change: { movePctOfPortfolio: movePct, addCapitalUsd: addUsd || null, removeCapitalUsd: removeUsd || null, expectedReturnPct: targetReturnPct, volatilityPct: targetVolPct },
    projections,
    touchedWallet: false,
    estimate: true,
    note: 'this ran entirely on a copy of your financial state; no balance, allowance or position was changed'
  };
}
