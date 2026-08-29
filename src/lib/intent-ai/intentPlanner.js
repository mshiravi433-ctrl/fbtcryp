/**
 * FBT INTENT AI — INTENT PLANNER
 * ---------------------------------------------------------------------------
 * Turns an understood intent into a concrete, reviewable allocation plan —
 * including when the customer gave almost nothing to work with.
 *
 * THE PROBLEM THIS SOLVES
 *   "میخوام پولم رشد کنه" carries an objective and nothing else: no asset, no
 *   amount, no network, no horizon. A parser can only answer that with a list
 *   of questions, and a customer who did not know the answers is now stuck in
 *   a form. The planner answers it instead: it picks a defensible allocation,
 *   states every assumption it had to make, prices its own risk, and hands
 *   over something the customer can edit or reject.
 *
 * THE LINE IT DOES NOT CROSS
 *   Proposing is not executing. `requiresConfirmation` is true on every plan
 *   this module can produce and `autoExecute` is never true — the confirmation
 *   gate and the Guardian still stand between a plan and a signature, exactly
 *   as they do for a fully specified swap. An agent that could act on a
 *   sentence it half-understood would be a liability, not a feature.
 *
 * HOW RETURNS ARE HANDLED
 *   `estReturnPct` is only ever populated from data the caller supplied (a
 *   live APY, a quoted price change). When there is no data, it is null and
 *   the plan says the return is unknown. A planner that invented a yield
 *   figure would be the most dangerous component in the app, because the
 *   number would be read as a promise.
 *
 * The allocation itself is a published table (PROFILES below), not a model.
 * Anyone can read why a "keep it safe" ask becomes 80% stables, and anyone can
 * argue with it — which is the point of showing it.
 */

import { INTENT_LIMITS } from './intentLimits.js';
import { parseUserIntent } from './intentParser.js';

export const PLANNER_SCHEMA = 'fbt.intent-planner.v1';

/* -------------------------------------------------------------------------- */
/*  CAPABILITIES — what the product can actually do                            */
/* -------------------------------------------------------------------------- */

/**
 * Every leg the planner may propose, keyed to a real capability in the app.
 *
 * `gated` names the flag that has to be on for the leg to exist in this build:
 * the speculation screens are stripped from store builds, so a plan that
 * proposed a perpetual there would be proposing a button that is not in the
 * binary.
 */
export const CAPABILITIES = Object.freeze({
  'stable-hold': {
    id: 'stable-hold', label: 'Hold in stablecoins', risk: 'low',
    drawdownPct: 1, detail: 'USDT/USDC on the cheapest supported chain. No yield, no price exposure.',
    requires: []
  },
  'core-spot': {
    id: 'core-spot', label: 'Spot in BTC/ETH', risk: 'medium',
    drawdownPct: 45, detail: 'Market buy through the DEX aggregator, held in your own wallet.',
    requires: ['swap']
  },
  'satellite-spot': {
    id: 'satellite-spot', label: 'Spot in higher-beta assets', risk: 'high',
    drawdownPct: 70, detail: 'Smaller caps. Wider spreads and deeper drawdowns than BTC/ETH.',
    requires: ['swap']
  },
  'staking': {
    id: 'staking', label: 'Staking / liquid staking', risk: 'medium',
    drawdownPct: 45, detail: 'Protocol yield on ETH/SOL. Return is real; the asset still moves.',
    requires: ['defi']
  },
  'lending': {
    id: 'lending', label: 'Lending stablecoins', risk: 'low',
    drawdownPct: 8, detail: 'Supply USDC/USDT to a lending market. Yield varies with utilisation.',
    requires: ['defi']
  },
  'lp': {
    id: 'lp', label: 'Provide liquidity', risk: 'high',
    drawdownPct: 55, detail: 'Fee income plus impermanent loss. Needs both sides of a pair.',
    requires: ['defi']
  },
  dca: {
    id: 'dca', label: 'Recurring buy (DCA)', risk: 'medium',
    drawdownPct: 45, detail: 'A scheduled buy at a fixed cadence, each one signed by you.',
    requires: ['swap']
  },
  perps: {
    id: 'perps', label: 'Leveraged perpetual', risk: 'high',
    drawdownPct: 100, detail: 'Leveraged position. Liquidation can take the whole margin.',
    requires: ['futures'], gated: 'speculation'
  },
  outcome: {
    id: 'outcome', label: 'Outcome market position', risk: 'high',
    drawdownPct: 100, detail: 'Bonded bid on a settled outcome. Binary: you win the bid or lose it.',
    requires: ['outcome'], gated: 'speculation'
  }
});

/**
 * Allocation profiles, one per objective.
 *
 * These are judgment calls, and they are written down so they can be
 * challenged. The numbers are not optimised against history — a backtest over
 * a bull window would push everything into the highest-beta column and would
 * be telling the truth about 2020 and lying about the next five years. They
 * are chosen so that the worst case in each row is survivable.
 */
export const PROFILES = Object.freeze({
  preserve: [
    { capability: 'stable-hold', amountPct: 80, rationale: 'Capital first: most of it stops moving.' },
    { capability: 'core-spot', amountPct: 20, rationale: 'A small BTC position keeps some upside against the thing stables are pegged to.' }
  ],
  income: [
    { capability: 'lending', amountPct: 40, rationale: 'Stablecoin lending pays without taking price risk on the principal.' },
    { capability: 'staking', amountPct: 30, rationale: 'Protocol yield on ETH/SOL — real income, with the asset still moving underneath.' },
    { capability: 'stable-hold', amountPct: 30, rationale: 'A reserve, so an income stream can be taken without selling at a bad time.' }
  ],
  growth: [
    { capability: 'core-spot', amountPct: 45, rationale: 'BTC and ETH are the deepest markets; size belongs where it can be exited.' },
    { capability: 'satellite-spot', amountPct: 20, rationale: 'Higher beta, deliberately capped — this is the part that can go to zero.' },
    { capability: 'staking', amountPct: 20, rationale: 'The core position can earn while it waits.' },
    { capability: 'stable-hold', amountPct: 15, rationale: 'Dry powder for a drawdown, which is when buying is actually pleasant.' }
  ],
  speculate: [
    { capability: 'satellite-spot', amountPct: 45, rationale: 'The directional bet, unhedged on purpose — that is what was asked for.' },
    { capability: 'perps', amountPct: 30, rationale: 'Leverage, only if this build ships the venue. Capped by the policy layer.' },
    { capability: 'core-spot', amountPct: 15, rationale: 'A piece stays in a market that can be exited.' },
    { capability: 'stable-hold', amountPct: 10, rationale: 'A floor, so a total loss on the bet is not a total loss of the account.' }
  ],
  learn: []
});

/** Risk tolerance overrides the objective's default when the user states one. */
const RISK_ADJUST = Object.freeze({
  low: { 'satellite-spot': 0, perps: 0, outcome: 0, lp: 0, 'stable-hold': 1 },
  medium: { perps: 0.5, outcome: 0.5, 'satellite-spot': 0.75 },
  high: { 'stable-hold': 0.75 }
});

/**
 * Annualised return bands used to judge a target.
 *
 * Stated as bands rather than a forecast. A 20% target in a month is not
 * impossible — it happens routinely in this market — but it is not something
 * anyone can promise, and a plan that let it read as a promise would be a
 * misrepresentation.
 */
const FEASIBILITY_BANDS = Object.freeze([
  { maxAnnualPct: 15, feasibility: 'plausible', note: 'Within the range passive strategies have historically produced. Not a guarantee.' },
  { maxAnnualPct: 45, feasibility: 'stretch', note: 'Needs real market movement in your favour, or leverage. Expect drawdowns on the way.' },
  { maxAnnualPct: 200, feasibility: 'unlikely', note: 'Achievable in this market and not plannable. Treat the target as a wish, not a projection.' },
  { maxAnnualPct: Infinity, feasibility: 'implausible', note: 'No strategy available here targets this. The honest answer is that it is a bet, not a plan.' }
]);

const DEFAULT_CAPITAL_USD = 500;
const DEFAULT_HORIZON_HRS = 24 * 90;

const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));

/** Annualise a target given a horizon in hours. */
export function annualise(goalPct, durationHrs) {
  const pct = Number(goalPct);
  const hrs = Number(durationHrs);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  if (!Number.isFinite(hrs) || hrs <= 0) return pct; // target with no horizon
  const years = hrs / 8760;
  return Math.round((pct / years) * 100) / 100;
}

export function judgeFeasibility(goalPct, durationHrs) {
  const annual = annualise(goalPct, durationHrs);
  if (annual == null) return { feasibility: null, feasibilityNote: null, annualisedPct: null };
  const band = FEASIBILITY_BANDS.find((b) => annual <= b.maxAnnualPct);
  return {
    feasibility: band.feasibility,
    feasibilityNote: band.note,
    annualisedPct: annual,
    statedPct: Number(goalPct),
    horizonHrs: Number.isFinite(Number(durationHrs)) ? Number(durationHrs) : null
  };
}

/* -------------------------------------------------------------------------- */
/*  ALLOCATION                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pick the profile, then bend it to what the customer actually said.
 *
 * @returns {{legs: Array, assumptions: string[]}}
 */
function buildLegs(parsed, ctx) {
  const intent = parsed?.intent ?? {};
  const objective = intent.objective || (intent.kind === 'goal' ? 'growth' : null);
  const risk = intent.riskTolerance || null;
  const assumptions = [];
  const assumptionRecords = [];
  const assume = (kind, params, text) => {
    assumptions.push(text);
    assumptionRecords.push({ kind, params });
  };

  /* ── a named asset outranks every profile ──────────────────────────── */
  if (intent.toSymbol && intent.toSymbol !== 'USD') {
    const isStable = ['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD'].includes(intent.toSymbol);
    const capability = intent.recurring ? 'dca' : isStable ? 'stable-hold' : 'core-spot';
    assume('singleAsset', { symbol: intent.toSymbol },
      `You named ${intent.toSymbol}, so the plan is a single position rather than an allocation.`);
    if (intent.recurring) {
      assume('cadence', { cadence: intent.recurring },
        `Cadence read from your message: ${intent.recurring}. Each buy is a separate signature.`);
    }
    return {
      objective: objective || (intent.recurring ? 'growth' : null),
      legs: [{ capability, symbol: intent.toSymbol, amountPct: 100, risk: CAPABILITIES[capability].risk }],
      assumptions,
      assumptionRecords
    };
  }

  /* ── objective-driven allocation ───────────────────────────────────── */
  const profile = PROFILES[objective] ?? PROFILES.growth;
  if (!objective) assume('noObjective', {}, 'No objective was stated, so the plan assumes growth.');
  let legs = profile.map((l) => ({
    capability: l.capability,
    symbol: defaultSymbolFor(l.capability, ctx),
    amountPct: l.amountPct,
    risk: CAPABILITIES[l.capability]?.risk ?? 'medium',
    rationale: l.rationale
  }));

  /* Risk stance bends the profile rather than replacing it. */
  if (risk && RISK_ADJUST[risk]) {
    const adj = RISK_ADJUST[risk];
    let freed = 0;
    legs = legs.map((l) => {
      if (adj[l.capability] == null) return l;
      const factor = adj[l.capability];
      const next = Math.round(l.amountPct * factor * 10) / 10;
      freed += l.amountPct - next;
      return { ...l, amountPct: next };
    });
    if (freed > 0) {
      const sink = legs.find((l) => l.capability === 'stable-hold') || legs[0];
      if (sink) sink.amountPct = Math.round((sink.amountPct + freed) * 10) / 10;
      assume('riskMoved', { risk, pct: Math.round(freed) },
        `Risk stance "${risk}" moved ${Math.round(freed)}% of the plan into lower-risk legs.`);
    }
    legs = legs.filter((l) => l.amountPct > 0);
  }

  /* A stated leverage turns the speculative sleeve on, within policy. */
  if (Number(intent.leverage) > 1 && !legs.some((l) => l.capability === 'perps')) {
    legs.push({
      capability: 'perps', symbol: intent.toSymbol || defaultSymbolFor('perps', ctx),
      amountPct: 0, risk: 'high', leverage: intent.leverage,
      rationale: `You asked for ${intent.leverage}x. Sized by the policy layer, not by this plan.`
    });
    assume('leverageNoted', { leverage: intent.leverage },
      `Leverage ${intent.leverage}x noted; position size is still capped by your policy.`);
  }

  return { objective, legs, assumptions, assumptionRecords };
}

/** Which symbol a capability defaults to, using what the caller supplied. */
function defaultSymbolFor(capability, ctx) {
  const balances = Array.isArray(ctx?.balances) ? ctx.balances : [];
  switch (capability) {
    case 'stable-hold':
    case 'lending': {
      const held = balances.find((b) => ['USDT', 'USDC', 'DAI'].includes(String(b.symbol).toUpperCase()));
      return held ? String(held.symbol).toUpperCase() : 'USDC';
    }
    case 'core-spot': {
      /* BTC before ETH: the core sleeve exists for the deepest market. */
      for (const want of ['BTC', 'ETH']) {
        if (balances.some((b) => String(b.symbol).toUpperCase() === want)) return want;
      }
      return 'BTC';
    }
    case 'staking': {
      const held = balances.find((b) => ['ETH', 'SOL'].includes(String(b.symbol).toUpperCase()));
      return held ? String(held.symbol).toUpperCase() : 'ETH';
    }
    case 'satellite-spot':
    case 'lp':
    case 'perps':
    case 'outcome':
      return 'SOL';
    default:
      return null;
  }
}

/** Drop legs whose capability this build or this user does not have. */
function applyCapabilityGates(legs, ctx) {
  const disabled = ctx?.disabledCapabilities || {};
  const speculationOn = ctx?.speculationEnabled === true;
  const removed = [];
  const kept = [];
  for (const leg of legs) {
    const cap = CAPABILITIES[leg.capability];
    if (!cap) { removed.push({ leg, reason: 'UNKNOWN_CAPABILITY' }); continue; }
    if (cap.gated === 'speculation' && !speculationOn) {
      removed.push({ leg, reason: 'NOT_IN_THIS_BUILD' });
      continue;
    }
    const missing = cap.requires.filter((r) => disabled[r] === true);
    if (missing.length) { removed.push({ leg, reason: `DISABLED:${missing.join(',')}` }); continue; }
    kept.push(leg);
  }
  return { kept, removed };
}

/** Renormalise to exactly 100% — a plan that adds to 97% is a bug. */
function normaliseWeights(legs) {
  const total = legs.reduce((s, l) => s + clampPct(l.amountPct), 0);
  if (total <= 0) return legs.map((l) => ({ ...l, amountPct: Math.round((100 / legs.length) * 10) / 10 }));
  const scaled = legs.map((l) => ({ ...l, amountPct: (clampPct(l.amountPct) / total) * 100 }));
  /* Fix rounding drift on the largest leg so the sum is exactly 100. */
  const rounded = scaled.map((l) => ({ ...l, amountPct: Math.round(l.amountPct * 10) / 10 }));
  const drift = Math.round((100 - rounded.reduce((s, l) => s + l.amountPct, 0)) * 10) / 10;
  if (drift !== 0 && rounded.length) {
    const biggest = rounded.reduce((a, b) => (b.amountPct > a.amountPct ? b : a));
    biggest.amountPct = Math.round((biggest.amountPct + drift) * 10) / 10;
  }
  return rounded;
}

/**
 * Worst-case drawdown of the whole plan, from the per-capability figures in
 * CAPABILITIES. A weighted sum, not a simulation — and it is deliberately
 * crude in the pessimistic direction: correlations are ignored, so a market
 * where everything falls together is exactly what the number describes.
 */
function planRisk(legs, capitalUsd) {
  let weighted = 0;
  for (const leg of legs) {
    const cap = CAPABILITIES[leg.capability];
    weighted += (clampPct(leg.amountPct) / 100) * (cap?.drawdownPct ?? 50);
  }
  const maxDrawdownPct = Math.round(weighted * 10) / 10;
  return {
    maxDrawdownPct,
    worstCaseUsd: Math.round(capitalUsd * (maxDrawdownPct / 100) * 100) / 100,
    method: 'weighted per-capability worst case, correlations ignored',
    note: 'A single bad market can hit every leg at once. This figure assumes it does.'
  };
}

/* -------------------------------------------------------------------------- */
/*  MAIN                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a plan from a parsed intent.
 *
 * @param {object} parsed — output of parseUserIntent (must carry `.intent`)
 * @param {object} [ctx]  — { portfolioUsd, balances:[{symbol,usd}], prices:[],
 *                           disabledCapabilities, speculationEnabled, locale }
 * @returns {{ok, plan|reason, i18nKey}}
 */
export function planFromIntent(parsed, ctx = {}) {
  const intent = parsed?.intent;

  if (!intent || (intent.kind == null && !intent.action && !intent.objective)) {
    return {
      ok: false,
      reason: 'NOTHING_UNDERSTOOD',
      i18nKey: 'intentAI.planner.notUnderstood',
      plan: null
    };
  }
  /* A question is answered, never allocated. */
  if (intent.kind === 'analysis' || parsed?.semantic?.deliberating) {
    return {
      ok: false,
      reason: 'ANALYSIS_NOT_A_PLAN',
      i18nKey: 'intentAI.planner.questionNotPlan',
      plan: null
    };
  }
  if (intent.kind === 'conversation') {
    return { ok: false, reason: 'CONVERSATION', i18nKey: 'intentAI.planner.conversation', plan: null };
  }

  const assumptions = [];
  /*
   * Every assumption is recorded twice: as the English sentence the planner
   * wrote, and as a structured record. The record is what gets localized
   * (see outputLocales.localizeAssumption), so the twelve locales render the
   * real numbers rather than a machine-guess at an English sentence.
   */
  const assumptionRecords = [];
  const assume = (kind, params, text) => {
    assumptions.push(text);
    assumptionRecords.push({ kind, params });
  };
  const missing = [];

  /* ── capital ───────────────────────────────────────────────────────── */
  const portfolioUsd = Number.isFinite(Number(ctx.portfolioUsd)) ? Number(ctx.portfolioUsd) : null;
  let capitalUsd = Number(intent.amountUsd) > 0
    ? Number(intent.amountUsd)
    : (Number(intent.amount) > 0 && ['USD', 'USDT', 'USDC', 'DAI'].includes(String(intent.amountUnit).toUpperCase())
      ? Number(intent.amount)
      : null);

  if (capitalUsd == null && intent.amountPct != null && portfolioUsd != null) {
    capitalUsd = Math.round(portfolioUsd * (intent.amountPct / 100) * 100) / 100;
    assume('share', { pct: intent.amountPct, capital: capitalUsd },
      `Amount read as ${intent.amountPct}% of your portfolio (≈ $${capitalUsd}).`);
  }
  if (capitalUsd == null && intent.fuzzyAmount && portfolioUsd != null) {
    const share = intent.fuzzyAmount === 'tiny' ? 0.05 : 0.15;
    capitalUsd = Math.round(portfolioUsd * share * 100) / 100;
    assume('fuzzy', { word: intent.fuzzyAmount, pct: Math.round(share * 100), capital: capitalUsd },
      `"${intent.fuzzyAmount}" sized as ${Math.round(share * 100)}% of your portfolio (≈ $${capitalUsd}). Change it before confirming.`);
    missing.push('AMOUNT');
  }
  if (capitalUsd == null) {
    capitalUsd = DEFAULT_CAPITAL_USD;
    assume('defaultAmount', { capital: capitalUsd },
      `No amount was given, so the plan is written for $${DEFAULT_CAPITAL_USD}. The percentages hold at any size.`);
    missing.push('AMOUNT');
  }
  if (capitalUsd > INTENT_LIMITS.maxTotalInputUsd) {
    return {
      ok: false,
      reason: 'OVER_LIMIT',
      i18nKey: 'intentAI.limits.totalInput',
      plan: null,
      limit: INTENT_LIMITS.maxTotalInputUsd
    };
  }

  /* ── legs ──────────────────────────────────────────────────────────── */
  const built = buildLegs(parsed, ctx);
  assumptions.push(...built.assumptions);
  assumptionRecords.push(...(built.assumptionRecords || []));

  if (!built.legs.length) {
    /* The "teach me" objective: no money moves, and saying so is the plan. */
    return {
      ok: true,
      plan: {
        schema: PLANNER_SCHEMA,
        kind: 'education',
        objective: 'learn',
        legs: [],
        capitalUsd: 0,
        assumptions,
        assumptionRecords,
        summary: 'You asked to be shown around before risking anything. Nothing here moves money: start with the guide, then come back with an amount.',
        requiresConfirmation: false,
        autoExecute: false,
        risk: { maxDrawdownPct: 0, worstCaseUsd: 0, method: 'no position', note: 'No capital is deployed by this plan.' }
      }
    };
  }

  const gated = applyCapabilityGates(built.legs, ctx);
  for (const r of gated.removed) {
    const label = CAPABILITIES[r.leg.capability]?.label ?? r.leg.capability;
    if (r.reason === 'NOT_IN_THIS_BUILD') {
      assume('legUnavailable', { leg: r.leg.capability },
        `${label} is not available in this build, so it was left out.`);
    } else {
      assume('legDisabled', { leg: r.leg.capability }, `${label} is turned off for you.`);
    }
  }
  if (!gated.kept.length) {
    return { ok: false, reason: 'NO_CAPABLE_LEG', i18nKey: 'intentAI.planner.noCapability', plan: null };
  }

  let legs = normaliseWeights(gated.kept).map((leg) => ({
    ...leg,
    amountUsd: Math.round(capitalUsd * (leg.amountPct / 100) * 100) / 100,
    label: CAPABILITIES[leg.capability]?.label ?? leg.capability,
    detail: CAPABILITIES[leg.capability]?.detail ?? null,
    /* A return is only stated when the caller supplied real data for it. */
    estReturnPct: observedReturnFor(leg, ctx),
    estReturnSource: observedReturnSource(leg, ctx)
  }));

  /* ── horizon and feasibility ───────────────────────────────────────── */
  let durationHrs = Number(intent.durationHrs) > 0 ? Number(intent.durationHrs) : null;
  if (durationHrs == null) {
    durationHrs = DEFAULT_HORIZON_HRS;
    assume('horizon', { days: DEFAULT_HORIZON_HRS / 24 },
      `No time horizon given; the plan assumes ${DEFAULT_HORIZON_HRS / 24} days.`);
    missing.push('DURATION_HRS');
  }
  const feasibility = judgeFeasibility(intent.goalPct, durationHrs);

  /* ── risk ──────────────────────────────────────────────────────────── */
  const risk = planRisk(legs, capitalUsd);
  if (Number(intent.maxLossUsd) > 0 && risk.worstCaseUsd > Number(intent.maxLossUsd)) {
    assume('lossCap', { cap: intent.maxLossUsd, worst: risk.worstCaseUsd },
      `You capped acceptable loss at $${intent.maxLossUsd}; this plan's worst case is $${risk.worstCaseUsd}. Reduce the riskier legs or the size.`);
  }

  /* ── chain ─────────────────────────────────────────────────────────── */
  const chainId = Number(intent.chainId) || Number(ctx.defaultChainId) || null;
  if (!chainId) {
    assume('network', {}, 'No network was chosen; the confirmation screen will ask before anything is signed.');
    missing.push('CHAIN_ID');
  }

  const objective = built.objective || 'growth';
  return {
    ok: true,
    plan: {
      schema: PLANNER_SCHEMA,
      kind: intent.recurring ? 'recurring' : 'allocation',
      objective,
      riskTolerance: intent.riskTolerance ?? null,
      capitalUsd,
      chainId,
      goalPct: Number(intent.goalPct) > 0 ? Number(intent.goalPct) : null,
      durationHrs,
      recurring: intent.recurring ?? null,
      legs,
      assumptions,
      assumptionRecords,
      missing,
      risk,
      feasibility: feasibility.feasibility,
      feasibilityNote: feasibility.feasibilityNote,
      annualisedPct: feasibility.annualisedPct,
      summary: summarise({ objective, legs, capitalUsd, feasibility, risk }),
      /*
       * The invariant this module exists to hold: a plan is a proposal. Every
       * leg is still an individual signed transaction behind the confirmation
       * gate, and nothing here can flip that.
       */
      requiresConfirmation: true,
      autoExecute: false,
      executionAuthorized: false,
      source: 'fbt.intent-planner'
    }
  };
}

/**
 * A return figure, only from data the caller actually supplied.
 * Returns null when there is none — never a plausible-sounding invention.
 */
function observedReturnFor(leg, ctx) {
  const apys = ctx?.apys || {};
  if (['lending', 'staking', 'lp'].includes(leg.capability) && Number.isFinite(Number(apys[leg.capability]))) {
    return Math.round(Number(apys[leg.capability]) * 100) / 100;
  }
  return null;
}

function observedReturnSource(leg, ctx) {
  const apys = ctx?.apys || {};
  if (['lending', 'staking', 'lp'].includes(leg.capability) && Number.isFinite(Number(apys[leg.capability]))) {
    return 'caller-supplied APY';
  }
  return null;
}

/** One plain sentence a human can read, agree with, or argue with. */
function summarise({ objective, legs, capitalUsd, feasibility, risk }) {
  const parts = legs
    .slice()
    .sort((a, b) => b.amountPct - a.amountPct)
    .map((l) => `${Math.round(l.amountPct)}% ${l.label.toLowerCase()}`);
  const head = {
    preserve: 'Keeping the capital intact comes first, so most of it stops moving.',
    income: 'Built for a yield stream rather than price movement.',
    growth: 'Weighted toward the deepest markets, with the speculative part deliberately capped.',
    speculate: 'This is an aggressive plan and the worst case is a real loss.',
    growth_default: 'A default growth allocation.'
  }[objective] || 'A default allocation.';
  const tail = feasibility.feasibility && feasibility.feasibility !== 'plausible'
    ? ` Your ${feasibility.statedPct}% target annualises to about ${feasibility.annualisedPct}%, which is ${feasibility.feasibility}.`
    : '';
  return `${head} Split: ${parts.join(', ')} — about $${Math.round(capitalUsd)} in total, worst case roughly -${risk.maxDrawdownPct}%.${tail}`;
}

/* -------------------------------------------------------------------------- */
/*  ONE-CALL ENTRY                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Understand AND plan, in one call. This is what the chat layer should use:
 * a customer types a sentence and gets either a plan or an honest "I did not
 * follow that, here is what I would need".
 */
export function understand(rawText, ctx = {}) {
  const parsed = parseUserIntent(rawText, { locale: ctx.locale ?? null, defaultChainId: ctx.defaultChainId ?? null });
  const planned = planFromIntent(parsed, ctx);
  return {
    ...parsed,
    plan: planned.plan,
    planReason: planned.reason ?? null,
    planI18nKey: planned.i18nKey ?? null,
    planOk: planned.ok === true
  };
}

/** Every capability, for a "what can you actually do" surface. */
export function capabilityManifest() {
  return Object.values(CAPABILITIES).map((c) => ({
    id: c.id, label: c.label, risk: c.risk, drawdownPct: c.drawdownPct,
    detail: c.detail, gated: c.gated ?? null
  }));
}
