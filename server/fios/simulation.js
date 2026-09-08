/**
 * FBT FINANCIAL INTELLIGENCE OS — Simulation Engine (§15) + What-If (§16).
 * ---------------------------------------------------------------------------
 * The five standard scenarios (BASE / BULL / BEAR / STRESS / EXTREME_STRESS)
 * are NOT re-implemented: `src/lib/central/scenario.js#runScenarios` already
 * applies the shock model to the real sections and is pinned by the Upgrade-10
 * probe. This module adds the four things that engine does not do:
 *
 *   1. execution-cost overlay — fees, gas multiplier and slippage per scenario
 *   2. goal probability, bracketed from the Monte-Carlo percentiles rather
 *      than reported to three decimals of fake precision
 *   3. persistence + a simulation id the decision trace can point at
 *   4. the natural-language what-if parser (§16) that turns "what if BTC drops
 *      30%" into a CUSTOM scenario and simulates it WITHOUT executing
 *
 * Every output is labelled `estimate: true` and `scenario: true`. Nothing here
 * touches a venue.
 */
import { randomUUID } from 'node:crypto';
import { runScenarios, monteCarlo, STANDARD_SCENARIOS } from '../../src/lib/central/scenario.js';
import { round } from '../../src/lib/central/schema.js';

export const SIMULATION_SCHEMA = 'fbt.fi.simulation.v1';

/** Execution costs are read from the world model, never assumed to be zero. */
function costOverlay({ scenario, gas = null, feeUsd = null, slippagePct = null, tradeUsd = null }) {
  const gasMultiplier = Number(scenario.gasMultiplier) || 1;
  const gasUsd = Number.isFinite(Number(gas)) ? round(Number(gas) * gasMultiplier, 2) : null;
  const liquidityDeltaPct = Number(scenario.liquidityDeltaPct) || 0;
  /* Thinner depth means worse realised slippage. A linear first-order
     approximation is honest as long as it is labelled as one. */
  const stressedSlippagePct = Number.isFinite(Number(slippagePct))
    ? round(Number(slippagePct) * (1 + Math.max(0, -liquidityDeltaPct) / 100), 3)
    : null;
  const tradeValueUsd = Number.isFinite(Number(tradeUsd)) ? Number(tradeUsd) : null;
  const slippageCostUsd = stressedSlippagePct !== null && tradeValueUsd !== null
    ? round((stressedSlippagePct / 100) * tradeValueUsd, 2) : null;
  const totalCostUsd = [gasUsd, Number.isFinite(Number(feeUsd)) ? Number(feeUsd) : null, slippageCostUsd]
    .filter((v) => v !== null).reduce((a, b) => a + b, 0);
  return {
    gasUsd, gasMultiplier,
    feeUsd: Number.isFinite(Number(feeUsd)) ? round(Number(feeUsd), 2) : null,
    slippagePct: stressedSlippagePct,
    slippageCostUsd,
    totalCostUsd: totalCostUsd ? round(totalCostUsd, 2) : null,
    note: scenario.liquidityNote || null
  };
}

/**
 * Bracketed goal probability from percentiles. Returns a range, not a point:
 * "between 25% and 50%" is what four percentiles can actually tell you.
 */
export function goalProbability({ percentiles = null, targetUsd = null, startUsd = null }) {
  const target = Number(targetUsd);
  if (!percentiles || !Number.isFinite(target) || target <= 0) {
    return { available: false, reason: 'NO_TARGET_OR_DISTRIBUTION' };
  }
  const brackets = [
    { q: 0.90, p: 0.10 }, { q: 0.75, p: 0.25 }, { q: 0.50, p: 0.50 }, { q: 0.25, p: 0.75 }, { q: 0.10, p: 0.90 }
  ];
  const hit = brackets.filter((b) => Number(percentiles[`p${Math.round(b.q * 100)}`]) >= target);
  if (!hit.length) {
    return { available: true, bracket: '<10%', probabilityPctMax: 10, targetUsd: target, startUsd, note: 'even the 90th percentile of the modelled distribution is below the target' };
  }
  const best = hit.reduce((a, b) => (a.p < b.p ? a : b));
  const lower = brackets.filter((b) => b.p < best.p).pop();
  return {
    available: true,
    bracket: lower ? `${Math.round(lower.p * 100)}–${Math.round(best.p * 100)}%` : `>${Math.round(best.p * 100)}%`,
    probabilityPctMin: lower ? Math.round(lower.p * 100) : Math.round(best.p * 100),
    probabilityPctMax: Math.round(best.p * 100),
    targetUsd: target,
    startUsd,
    note: 'bracketed from the Monte-Carlo deciles; the distribution is a model, not a forecast'
  };
}

export function createSimulationEngine({ collections, evidence = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  /**
   * @param {object} p
   * @param {object} p.sections      plain section data (portfolio/lending/futures…)
   * @param {object} p.financial     canonical financial state (or its `computed`)
   * @param {object} [p.costs]       { gasUsd, feeUsd, slippagePct, tradeUsd }
   * @param {object} [p.goal]        { targetUsd, months, expectedReturnPct, volatilityPct, monthlyContributionUsd }
   * @param {object[]} [p.custom]    extra scenarios (what-if)
   */
  async function simulate({ owner, sections = {}, financial = null, costs = {}, goal = null, custom = [], correlationId = null } = {}) {
    const at = now();
    const fs = financial?.computed || financial || null;
    const scenarioInput = {
      ...(sections || {}),
      financialState: fs && fs.status !== 'UNAVAILABLE' ? fs : undefined
    };
    const scenarios = runScenarios(scenarioInput, { custom, now: at });
    if (scenarios.status === 'UNAVAILABLE') {
      return {
        ok: false, code: 'SIMULATION_UNAVAILABLE', reason: scenarios.reason || 'NO_PORTFOLIO_STATE',
        detail: 'a simulation needs readable holdings; nothing was modelled and nothing was guessed',
        rejected: scenarios.rejected || []
      };
    }

    const rows = scenarios.scenarios.map((s) => (s.status === 'OK'
      ? { ...s, costs: costOverlay({ scenario: s, gas: costs.gasUsd, feeUsd: costs.feeUsd, slippagePct: costs.slippagePct, tradeUsd: costs.tradeUsd }), scenario: true, estimate: true }
      : { ...s, scenario: true, estimate: true }));

    /* Goal probability, when a goal and a volatility reading exist. */
    let projection = { available: false, reason: 'NO_GOAL_OR_NO_VOLATILITY' };
    let probability = { available: false, reason: 'NO_GOAL_OR_DISTRIBUTION' };
    const volatilityPct = Number(goal?.volatilityPct ?? fs?.volatilityPct);
    const startUsd = Number(goal?.startUsd ?? fs?.netWorthUsd ?? fs?.availableCapitalUsd);
    if (goal?.targetUsd && Number.isFinite(startUsd) && startUsd > 0 && Number.isFinite(volatilityPct)) {
      projection = monteCarlo({
        startUsd,
        months: Math.max(1, Math.round(Number(goal.months) || 12)),
        expectedReturnPct: Number.isFinite(Number(goal.expectedReturnPct)) ? Number(goal.expectedReturnPct) : Number(fs?.blendedYieldPct) || 0,
        volatilityPct,
        monthlyContributionUsd: Number(goal.monthlyContributionUsd) || 0
      });
      if (projection.status === 'OK') {
        probability = goalProbability({ percentiles: projection.percentiles, targetUsd: Number(goal.targetUsd), startUsd });
      } else {
        projection = { available: false, reason: projection.reason };
      }
    }

    const worst = rows.filter((r) => r.status === 'OK').reduce((a, b) => (!a || b.deltaUsd < a.deltaUsd ? b : a), null);
    const id = `sim_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const bundle = {
      schema: SIMULATION_SCHEMA,
      id,
      owner,
      at,
      status: 'OK',
      scenario: true,
      estimate: true,
      label: 'SCENARIO ANALYSIS — modelled outcomes, not predictions',
      scenarios: rows,
      worstCase: worst ? { id: worst.id, deltaUsd: worst.deltaUsd, deltaPct: worst.deltaPct, valueAfterUsd: worst.valueAfterUsd, costs: worst.costs || null } : null,
      goal: goal ? { targetUsd: Number(goal.targetUsd), months: Number(goal.months) || null, probability, projection: projection.status === 'OK' ? { percentiles: projection.percentiles, meanUsd: projection.meanUsd, probabilityOfLossPct: projection.probabilityOfLossPct, probabilityOfHalvingPct: projection.probabilityOfHalvingPct, assumptions: projection.assumptions } : projection } : null,
      rejected: scenarios.rejected || [],
      method: scenarios.method,
      executedNothing: true,
      durable: collections.durable()
    };
    await collections.put('simulations', owner, bundle);
    if (evidence && worst) {
      const rec = await evidence.record(owner, [{ type: 'simulation', source: 'simulation-engine', value: { id, worstCase: bundle.worstCase, scenarios: rows.filter((r) => r.status === 'OK').map((r) => ({ id: r.id, deltaUsd: r.deltaUsd })) }, at, ttlMs: 15 * 60_000 }], { correlationId });
      if (rec.evidence.length) {
        bundle.evidenceIds = rec.evidence.map((e) => e.id);
        await evidence.link(owner, { targetType: 'simulation', targetId: id, evidenceIds: bundle.evidenceIds, correlationId });
      }
    }
    if (observability) observability.emit({ type: 'simulation.completed', owner, correlationId, payload: { simulationId: id, scenarios: rows.length, worst: worst?.id || null } });
    return { ok: true, simulation: bundle };
  }

  async function get(owner, id) { return collections.get('simulations', owner, id); }

  return { schema: SIMULATION_SCHEMA, simulate, get, goalProbability, STANDARD_SCENARIOS };
}

/* ── §16 What-if: natural language → a scenario, never an execution ───────── */

const ASSET_WORDS = { btc: 'BTC', bitcoin: 'BTC', eth: 'ETH', ethereum: 'ETH', sol: 'SOL', solana: 'SOL' };

export const WHATIF_SCHEMA = 'fbt.fi.whatif.v1';

/**
 * Parse a what-if sentence. Deterministic, and deliberately narrow: anything it
 * does not understand returns `{ understood: false }` so the caller asks the
 * user instead of simulating something they did not ask for.
 */
export function parseWhatIf(text = '') {
  const s = String(text || '').toLowerCase();
  if (!/\b(what if|اگر|چه می‌شود|wh?at happens if)\b/.test(s) && !/\?\s*$/.test(s)) {
    return { understood: false, code: 'NOT_A_WHAT_IF' };
  }
  const pctMatch = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  const pct = pctMatch ? Number(pctMatch[1]) : null;
  const drops = /\b(drop|drops|fall|falls|down|crash|ریزش|بریزد|کم شود)\b/.test(s);
  const rises = /\b(rise|rises|pump|up|gain|increase|rally|بالا|رشد)\b/.test(s);
  const assetWord = Object.keys(ASSET_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(s));
  const asset = assetWord ? ASSET_WORDS[assetWord] : null;

  /* "what if I invest $500 every month" */
  const invest = s.match(/\$\s?(\d+(?:\.\d+)?)\s*(?:every|per|a)\s*(month|week|day)/);
  if (invest) {
    const per = invest[2] === 'week' ? 4.345 : invest[2] === 'day' ? 30.44 : 1;
    return { understood: true, kind: 'CONTRIBUTION', monthlyContributionUsd: round(Number(invest[1]) * per, 2), note: `${invest[1]} per ${invest[2]}` };
  }
  /* "what if I move 20% to ETH" */
  const move = s.match(/move\s+(\d{1,3}(?:\.\d+)?)\s*%\s*(?:to|into)\s*([a-z0-9]+)/);
  if (move) {
    const target = ASSET_WORDS[move[2]] || move[2].toUpperCase();
    return { understood: true, kind: 'REALLOCATION', movePct: Number(move[1]), targetAsset: target };
  }
  /* "what if gas doubles" */
  if (/\bgas\b/.test(s) && /\b(double|doubles|2x|twice|dوبرابر)\b/.test(s)) {
    return { understood: true, kind: 'GAS', gasMultiplier: 2 };
  }
  if (/\bvolatility\b/.test(s) && /\b(rise|rises|double|up|increase)\b/.test(s)) {
    return { understood: true, kind: 'VOLATILITY', volatilityMultiplier: /\b(double|2x|twice)\b/.test(s) ? 2 : 1.5 };
  }
  if (pct !== null && (drops || rises)) {
    const shockPct = drops ? -Math.abs(pct) : Math.abs(pct);
    return {
      understood: true, kind: 'PRICE_SHOCK', shockPct, asset,
      scenario: { id: `WHATIF_${asset || 'MARKET'}_${shockPct > 0 ? 'UP' : 'DOWN'}${Math.abs(shockPct)}`, label: `What if ${asset || 'the market'} ${drops ? 'drops' : 'rises'} ${Math.abs(pct)}%`, shockPct, shockByAsset: asset ? { [asset]: shockPct } : null }
    };
  }
  return { understood: false, code: 'UNRECOGNIZED_WHAT_IF', detail: 'supported: price shock, monthly contribution, reallocation, gas doubling, volatility rise' };
}

/**
 * Run a parsed what-if against the real state. It returns a simulation, never
 * an action, and it says so on the object.
 */
export async function runWhatIf(engine, { owner, text = null, parsed = null, sections = {}, financial = null, costs = {}, goal = null, correlationId = null } = {}) {
  const interpretation = parsed || parseWhatIf(text);
  if (!interpretation.understood) return { ok: false, schema: WHATIF_SCHEMA, ...interpretation };

  let custom = [];
  let goalOverride = goal;
  let costsOverride = costs;

  if (interpretation.kind === 'PRICE_SHOCK') custom = [interpretation.scenario];
  else if (interpretation.kind === 'GAS') custom = [{ id: 'WHATIF_GAS_2X', label: 'What if gas doubles', shockPct: 0, gasMultiplier: interpretation.gasMultiplier }];
  else if (interpretation.kind === 'CONTRIBUTION') {
    goalOverride = { ...(goal || {}), monthlyContributionUsd: interpretation.monthlyContributionUsd, months: goal?.months || 12, targetUsd: goal?.targetUsd || null };
  } else if (interpretation.kind === 'REALLOCATION') {
    /* Modelled as a portfolio-level shock-free scenario plus an explicit note:
       moving between assets changes concentration, which the shock model does
       not re-derive, so the honest answer is the concentration delta, not a
       new price path. */
    custom = [{ id: `WHATIF_MOVE_${interpretation.movePct}_TO_${interpretation.targetAsset}`, label: `Move ${interpretation.movePct}% to ${interpretation.targetAsset}`, shockPct: 0 }];
  } else if (interpretation.kind === 'VOLATILITY') {
    const vol = Number(financial?.computed?.volatilityPct ?? financial?.volatilityPct);
    goalOverride = { ...(goal || {}), volatilityPct: Number.isFinite(vol) ? round(vol * interpretation.volatilityMultiplier, 2) : null, months: goal?.months || 12 };
  }

  const out = await engine.simulate({ owner, sections, financial, costs: costsOverride, goal: goalOverride, custom, correlationId });
  if (!out.ok) return { ok: false, schema: WHATIF_SCHEMA, interpretation, ...out };
  return {
    ok: true,
    schema: WHATIF_SCHEMA,
    interpretation,
    simulation: out.simulation,
    reallocation: interpretation.kind === 'REALLOCATION'
      ? { movePct: interpretation.movePct, targetAsset: interpretation.targetAsset, note: 'concentration changes are not re-derived by the price-shock model; this scenario holds prices flat' }
      : null,
    executedNothing: true,
    scenario: true
  };
}
