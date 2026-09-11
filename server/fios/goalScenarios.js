/**
 * FBT FINANCIAL INTELLIGENCE OS — Goal Scenarios (Phase 212, upgrade 6).
 * ---------------------------------------------------------------------------
 * «10,000 دلار دارم؛ سه سناریو Conservative/Balanced/Aggressive با expected
 * return و probability و max drawdown بده — و بگو اگر BTC ۳۰٪ سقوط کند
 * سرمایه‌ام چقدر می‌شود.» ALL of it must be COMPUTED, not hallucinated:
 *
 *   expected return   from the LIVE blended yield the financial state read and
 *                     the allocation presets' modelled bands — never a promise
 *   probability       the Monte-Carlo percentile distribution against the
 *                     target (bracketed, like simulation.js does)
 *   max drawdown      the p10 path trough versus start (the modelled worst
 *                     decile, labelled estimate)
 *
 * and the four named what-ifs run through the REAL scenario engine
 * (runScenarios custom shocks on the owner's live holdings):
 *   BTC −30% · ETH ×2 · rates up (macro shock) · 4 months no trades.
 *
 * Every row carries estimate:true. Nothing here touches a venue.
 */

import { runScenarios, monteCarlo, ALLOCATION_PRESETS } from '../../src/lib/central/scenario.js';
import { goalProbability } from './simulation.js';
import { requireFlag } from './flags.js';

export const GOAL_SCENARIOS_SCHEMA = 'fbt.fi.goal-scenarios.v1';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/** The three risk profiles the owner named, mapped onto the preset ladder. */
export const GOAL_PROFILES = Object.freeze([
  { id: 'CONSERVATIVE', label: 'Conservative', preset: 'CONSERVATIVE', maxDrawdownPct: 10 },
  { id: 'BALANCED', label: 'Balanced', preset: 'BALANCED', maxDrawdownPct: 25 },
  { id: 'AGGRESSIVE', label: 'Aggressive', preset: 'GROWTH', maxDrawdownPct: 45 }
]);

/**
 * Build the three profiles for one goal. Pure over its inputs.
 *
 * @param {object} p
 * @param {number} p.startUsd        the capital actually available
 * @param {object} [p.goal]          { targetUsd, months, monthlyContributionUsd }
 * @param {object} [p.financial]     canonical financial state (live blended yield, volatility)
 * @param {number} [p.liveYieldPct]  the best LIVE yield read this pass (optional override)
 */
export function buildGoalScenarios({ startUsd = null, goal = null, financial = null, liveYieldPct = null, now = Date.now() } = {}) {
  const start = num(startUsd) ?? num(financial?.computed?.netWorthUsd);
  if (start === null || start <= 0) {
    return { ok: false, code: 'NO_STARTING_CAPITAL', detail: 'a scenario needs real capital; nothing was modelled and nothing was guessed' };
  }
  const months = Math.max(1, Math.round(num(goal?.months) ?? 12));
  const targetUsd = num(goal?.targetUsd);
  const contribution = num(goal?.monthlyContributionUsd) ?? 0;
  const liveYield = num(liveYieldPct) ?? num(financial?.computed?.blendedYieldPct);

  const rows = GOAL_PROFILES.map((profile) => {
    const preset = ALLOCATION_PRESETS[profile.preset];
    /* Expected return: the preset's modelled band, floored/anchored by the
       LIVE blended yield when one was readable — a plan that ignores what the
       money actually earns is a story. */
    const expectedReturnPct = liveYield !== null
      ? round(Math.max(liveYield * 0.6, Math.min(liveYield * 1.8 + 4, preset.expectedReturnPct)), 2)
      : preset.expectedReturnPct;
    const mc = monteCarlo({
      startUsd: start,
      months,
      expectedReturnPct,
      volatilityPct: preset.volatilityPct,
      monthlyContributionUsd: contribution,
      paths: 4000,
      seed: 20260905 + preset.volatilityPct
    });
    const probability = targetUsd !== null && mc.status === 'OK'
      ? goalProbability({ percentiles: mc.percentiles, targetUsd, startUsd: start })
      : { available: false, reason: 'NO_TARGET_OR_DISTRIBUTION' };
    /* Max drawdown: the worst modelled decile's trough relative to start. */
    const maxDrawdownPct = mc.status === 'OK'
      ? round(Math.min(0, ((mc.percentiles.p10 - start) / start) * 100), 2)
      : null;
    return {
      profile: profile.id,
      label: profile.label,
      allocation: { stablePct: Math.round(preset.stable * 100), majorsPct: Math.round(preset.majors * 100), altPct: Math.round(preset.alt * 100) },
      expectedReturnPct,
      expectedValueUsd: mc.status === 'OK' ? mc.meanUsd : null,
      probability,
      maxDrawdownPct,
      probabilityOfLossPct: mc.status === 'OK' ? mc.probabilityOfLossPct : null,
      probabilityOfHalvingPct: mc.status === 'OK' ? mc.probabilityOfHalvingPct : null,
      percentiles: mc.status === 'OK' ? mc.percentiles : null,
      respectsUserDrawdownCeiling: goal?.maxDrawdownPct != null
        ? (maxDrawdownPct !== null ? Math.abs(maxDrawdownPct) <= num(goal.maxDrawdownPct) : null)
        : null,
      estimate: true,
      note: 'expected return anchored to the live blended yield where readable; probability bracketed from Monte-Carlo deciles; drawdown is the p10 trough'
    };
  });

  return {
    ok: true,
    schema: GOAL_SCENARIOS_SCHEMA,
    at: now,
    startUsd: round(start, 2),
    months,
    targetUsd,
    monthlyContributionUsd: contribution,
    liveYieldPct: liveYield,
    scenarios: rows,
    recommended: goal?.maxDrawdownPct != null
      ? (rows.find((r) => r.respectsUserDrawdownCeiling === true) || rows[0]).profile
      : 'BALANCED',
    ceilingRespected: goal?.maxDrawdownPct != null ? rows.some((r) => r.respectsUserDrawdownCeiling === true) : null,
    recommendationNote: goal?.maxDrawdownPct != null
      ? (rows.some((r) => r.respectsUserDrawdownCeiling === true)
        ? `the ${rows.find((r) => r.respectsUserDrawdownCeiling === true).profile} profile respects the ${goal.maxDrawdownPct}% drawdown ceiling`
        : `NO profile keeps the modelled p10 drawdown inside the ${goal.maxDrawdownPct}% ceiling — the least-drawdown profile is recommended and the target may be unreachable at this risk level`)
      : 'no drawdown ceiling was given; BALANCED is the default posture',
    estimate: true,
    disclaimer: 'modelled distributions, not promises; no scenario guarantees any return'
  };
}

/** The four named what-ifs over the owner's REAL holdings. */
export function buildWhatIfs({ sections = {}, financial = null, now = Date.now() } = {}) {
  const fs = financial?.computed || financial || null;
  const input = { ...(sections || {}), financialState: fs && fs.status !== 'UNAVAILABLE' ? fs : undefined };
  const custom = [
    { id: 'BTC_MINUS_30', label: 'BTC 30% crash', shockPct: -30, shockByAsset: { BTC: -30, ETH: -34, SOL: -40 }, gasMultiplier: 1.6, liquidityDeltaPct: -35 },
    { id: 'ETH_TIMES_2', label: 'ETH doubles', shockPct: 15, shockByAsset: { ETH: 100, BTC: 20, SOL: 60 } },
    { id: 'RATES_UP', label: 'Rates spike (macro risk-off)', shockPct: -12, shockByAsset: { BTC: -14, ETH: -16, SOL: -22 }, gasMultiplier: 1.3, liquidityDeltaPct: -15 },
    { id: 'NO_TRADES_4M', label: '4 months no trades', shockPct: 0 }
  ];
  const scenarios = runScenarios(input, { custom, now });
  return {
    ok: scenarios.status === 'OK',
    code: scenarios.status === 'OK' ? null : 'SCENARIOS_UNAVAILABLE',
    reason: scenarios.reason || null,
    schema: GOAL_SCENARIOS_SCHEMA,
    at: now,
    whatIfs: (scenarios.scenarios || []).filter((s) => s.custom === true),
    estimate: true,
    note: 'each what-if is the real scenario engine on the live holdings — linear shocks, rescaled health factors, gas/liquidity overlays'
  };
}

/** The engine wrapper. */
export function createGoalScenariosEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now(), multiClassFor = null } = {}) {
  async function scenariosFor(owner, { goal = null, financial = null, liveYieldPct = null, correlationId = null } = {}) {
    const gate = requireFlag('GOAL_SCENARIOS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const out = buildGoalScenarios({ startUsd: num(financial?.computed?.netWorthUsd) ?? num(goal?.startUsd), goal, financial, liveYieldPct, now: now() });
    /* Phase 215 — the multi-class allocation (traditional sleeves alongside
       the crypto presets). Best-effort: a failure there must not take the
       crypto scenarios down; the field is simply absent then. */
    if (out.ok && typeof multiClassFor === 'function') {
      try {
        const mc = await multiClassFor(owner, { financial, goal });
        if (mc?.ok) out.multiClass = mc.result;
      } catch (err) {
        log(`goal-scenarios:multiclass-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (out.ok && collections) {
      try {
        await collections.put('goal_scenarios', owner, { ...out, id: 'latest' }, { idKey: 'id' });
      } catch (err) {
        log(`goal-scenarios:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability && out.ok) observability.emit({ type: 'goal-scenarios.built', owner, correlationId, payload: { months: out.months, targetUsd: out.targetUsd, recommended: out.recommended } });
    return out;
  }

  async function whatIfsFor(owner, { sections = {}, financial = null, correlationId = null } = {}) {
    const out = buildWhatIfs({ sections, financial, now: now() });
    if (observability && out.ok) observability.emit({ type: 'goal-scenarios.whatif', owner, correlationId, payload: { count: out.whatIfs.length } });
    return out;
  }

  return { schema: GOAL_SCENARIOS_SCHEMA, scenariosFor, whatIfsFor, build: buildGoalScenarios, buildWhatIfs, PROFILES: GOAL_PROFILES };
}
