/**
 * FBT FINANCIAL OS — Agent Council, Guardians, Opportunity ranking
 * (Upgrade 10 §16–§18, §30, §31, §33, §34).
 * ---------------------------------------------------------------------------
 * Seven specialist agents look at the SAME evidence and each returns a verdict
 * with a confidence. The council then does the one thing a single model cannot:
 * it keeps the disagreement visible.
 *
 * WHY DISAGREEMENT IS THE PRODUCT (§34)
 * A council that silently averages "market says buy" and "security says
 * honeypot" produces a lukewarm buy. So the aggregation rules are lexical, not
 * numeric: REJECT beats REVISE beats APPROVE, and any dissent CAPS the
 * confidence of the majority. The user is told "there is a bullish signal, but
 * risk and security concerns lowered confidence" — the exact sentence §34 asks
 * for — because that is what the arithmetic produced.
 *
 * Every agent in here is deterministic and reads real evidence rows. None of
 * them calls an LLM, none of them signs anything, and none of them can change
 * the policy verdict — the Guardians ADD constraints, they never remove one.
 */
import { CI_SCHEMA, round, usableNumber, SAFE_STOP_CODES } from './schema.js';

export const COUNCIL_SCHEMA = 'fbt.financial-council.v1';
export const GUARDIAN_SCHEMA = 'fbt.financial-guardian.v1';
export const OPPORTUNITY_SCHEMA = 'fbt.opportunity-engine.v1';

const num = (v) => usableNumber(v);
const VERDICTS = ['APPROVE', 'REVISE', 'REJECT', 'ABSTAIN'];
const RANK = { ABSTAIN: 0, APPROVE: 1, REVISE: 2, REJECT: 3 };

const agent = (id, verdict, confidence, reason, evidence = []) => ({
  id, verdict: VERDICTS.includes(verdict) ? verdict : 'ABSTAIN',
  confidence: verdict === 'ABSTAIN' ? 0 : round(Math.max(0, Math.min(1, confidence)), 3),
  reason, evidence
});

/**
 * The seven council agents of §33. Each ABSTAINS when its input is unreadable —
 * an abstention is honest, a default APPROVE is not.
 */
export function runCouncil({
  decision = null, financialState = null, risk = null, security = { signals: [] },
  market = null, smartMoney = null, news = null, goal = null, freshness = null, now = Date.now()
} = {}) {
  const votes = [];

  /* Research: is there enough evidence to say anything at all? */
  const evidenceRows = Array.isArray(decision?.evidence) ? decision.evidence : [];
  votes.push(evidenceRows.length
    ? agent('research', evidenceRows.length >= 2 ? 'APPROVE' : 'REVISE', Math.min(0.85, 0.3 + evidenceRows.length * 0.18),
      `${evidenceRows.length} evidence row(s) support the expected benefit`, evidenceRows.slice(0, 3))
    : agent('research', 'REJECT', 0.8, 'the candidate carries no evidence, so there is nothing to research against'));

  /* Market: direction and volatility, only from a read market section. */
  const trend = market?.trend ? String(market.trend).toUpperCase() : null;
  const vol = num(market?.volatilityPct ?? financialState?.volatilityPct);
  votes.push(trend === null && vol === null
    ? agent('market', 'ABSTAIN', 0, 'no market state was readable, so no market opinion is offered')
    : agent('market',
      trend === 'BEARISH' && (decision?.type === 'YIELD' || decision?.type === 'REBALANCE') ? 'REVISE' : trend === 'BEARISH' ? 'REVISE' : 'APPROVE',
      trend ? 0.6 : 0.4,
      `market trend ${trend || 'unread'}${vol === null ? '' : `, volatility ${vol}%`}`,
      [{ source: 'market-data', detail: `trend=${trend || 'unread'} vol=${vol ?? 'unread'}` }]));

  /* Risk: the central risk engine's own verdict, not a second opinion. */
  const level = risk?.level ? String(risk.level).toUpperCase() : null;
  votes.push(level === null
    ? agent('risk', 'ABSTAIN', 0, 'the risk engine produced no verdict for this turn')
    : agent('risk',
      level === 'CRITICAL' ? 'REJECT' : level === 'HIGH' ? 'REVISE' : 'APPROVE',
      num(risk.confidence) ?? 0.6,
      `central risk engine says ${level}${(risk.factors || []).length ? ` from ${risk.factors.length} factor(s)` : ''}`,
      (risk.factors || []).slice(0, 3).map((f) => ({ source: 'risk-engine', detail: typeof f === 'string' ? f : (f.detail || f.code || 'factor') }))));

  /* Portfolio: does this fit the state and the goal? */
  const capital = num(financialState?.availableCapitalUsd);
  const need = num(decision?.capitalRequiredUsd);
  votes.push(capital === null
    ? agent('portfolio', 'ABSTAIN', 0, 'available capital was not readable')
    : need !== null && need > capital
      ? agent('portfolio', 'REJECT', 0.9, `the candidate needs ${need} USD but only ${capital} USD is available`, [{ source: 'financial-state', detail: `available ${capital} USD` }])
      : agent('portfolio', need !== null && need > capital * 0.5 ? 'REVISE' : 'APPROVE', 0.7,
        need === null ? 'no capital requirement declared' : `${need} USD of ${capital} USD available (${round((need / Math.max(1e-9, capital)) * 100, 1)}%)`,
        [{ source: 'financial-state', detail: `available ${capital} USD, net worth ${financialState?.netWorthUsd ?? 'unread'}` }]));

  /* Security: any SAFE_STOP code is an absolute reject. */
  const codes = (security?.signals || []).map((s) => String(s?.code || s || '')).filter(Boolean);
  const stoppers = codes.filter((c) => SAFE_STOP_CODES.includes(c));
  votes.push(stoppers.length
    ? agent('security', 'REJECT', 1, `security stop: ${stoppers.join(', ')}`, stoppers.map((c) => ({ source: 'security-brain', detail: c })))
    : agent('security', codes.length ? 'REVISE' : 'APPROVE', codes.length ? 0.6 : 0.7,
      codes.length ? `non-blocking security signals present: ${codes.slice(0, 3).join(', ')}` : 'no security signal was raised by any read'));

  /* Smart money: flow direction, only from real flow data. */
  const netFlowUsd = num(smartMoney?.netFlowUsd);
  const exchangeInflowUsd = num(smartMoney?.exchangeInflowUsd);
  votes.push(netFlowUsd === null && exchangeInflowUsd === null
    ? agent('smart-money', 'ABSTAIN', 0, 'no smart-money flow data was readable for the assets in scope')
    : agent('smart-money',
      netFlowUsd !== null && netFlowUsd < 0 ? 'REVISE' : 'APPROVE',
      0.5,
      `net smart-money flow ${netFlowUsd ?? 'unread'} USD${exchangeInflowUsd === null ? '' : `, exchange inflow ${exchangeInflowUsd} USD`}`,
      [{ source: 'smart-money-brain', detail: `netFlow=${netFlowUsd ?? 'unread'} inflow=${exchangeInflowUsd ?? 'unread'}` }]));

  /* Strategy: does it match the goal's horizon and direction? */
  const goalHorizon = num(goal?.horizonMonths);
  const candHorizon = num(decision?.horizonMonths);
  votes.push(goal === null
    ? agent('strategy', 'ABSTAIN', 0, 'no goal is set, so horizon fit cannot be judged')
    : goalHorizon !== null && candHorizon !== null && candHorizon > goalHorizon * 1.5
      ? agent('strategy', 'REVISE', 0.7, `the candidate's ${candHorizon}-month horizon overshoots the goal's ${goalHorizon} months`)
      : agent('strategy', 'APPROVE', 0.65, `horizon fits the goal (${goalHorizon ?? 'open'} months)`,
        [{ source: 'goal-os', detail: `${goal.name || goal.goalId}: ${goal.type}` }]));

  /* ── aggregation: lexical, not averaged ─────────────────────────────── */
  const voting = votes.filter((v) => v.verdict !== 'ABSTAIN');
  if (!voting.length) {
    return {
      schema: COUNCIL_SCHEMA, brain: CI_SCHEMA, status: 'UNAVAILABLE',
      reason: 'ALL_AGENTS_ABSTAINED', votes, at: now,
      detail: 'no agent had readable input; a council with nothing to read has no opinion'
    };
  }
  const decisionVerdict = voting.reduce((worst, v) => (RANK[v.verdict] > RANK[worst] ? v.verdict : worst), 'APPROVE');
  const approvals = voting.filter((v) => v.verdict === 'APPROVE');
  const dissent = voting.filter((v) => v.verdict !== 'APPROVE');

  /* Base confidence is the mean of the AGREEING agents, then capped by dissent.
     A single REJECT caps at 0.2; each REVISE removes a fifth of the remainder.
     The cap is what makes "bullish but risky" read as low confidence. */
  const base = approvals.length ? approvals.reduce((a, v) => a + v.confidence, 0) / approvals.length : 0.2;
  const rejects = dissent.filter((v) => v.verdict === 'REJECT').length;
  const revises = dissent.filter((v) => v.verdict === 'REVISE').length;
  const cap = rejects ? 0.2 : Math.max(0.15, 1 - revises * 0.2);
  const confidence = round(Math.min(base, cap), 3);

  const disagreements = dissent.map((v) => ({ agent: v.id, verdict: v.verdict, reason: v.reason }));
  const narrative = dissent.length && approvals.length
    ? `${approvals.map((a) => a.id).join(', ')} support this; ${dissent.map((d) => `${d.id} says ${d.verdict.toLowerCase()} (${d.reason})`).join('; ')} — the disagreement is why confidence is ${Math.round(confidence * 100)}% and not higher.`
    : dissent.length
      ? `no agent supported this: ${dissent.map((d) => `${d.id} ${d.verdict.toLowerCase()}`).join(', ')}.`
      : `all ${approvals.length} agents with readable input agreed.`;

  return {
    schema: COUNCIL_SCHEMA, brain: CI_SCHEMA, status: 'OK', at: now,
    decisionId: decision?.id || null,
    verdict: decisionVerdict,
    confidence,
    votes,
    abstained: votes.filter((v) => v.verdict === 'ABSTAIN').map((v) => v.id),
    unanimous: dissent.length === 0,
    disagreements,
    narrative,
    /* The council NEVER grants permission — it can only withhold support. */
    grantsPermission: false
  };
}

/* ── §30 Financial Guardian ────────────────────────────────────────────── */

/**
 * Consistency and suitability, checked before a decision is offered. Returns
 * findings; the caller decides. The Guardian is deliberately incapable of
 * approving anything — `blocking` is the only verdict it can raise.
 */
export function financialGuardian({
  decision = null, goal = null, profile = null, financialState = null, freshnessReport = null, reversible = null, now = Date.now()
} = {}) {
  const findings = [];
  const check = (id, ok, detail, severity = 'WARN') => findings.push({ id, ok: ok === true, unknown: ok === null, severity: ok === true ? 'INFO' : severity, detail });

  /* Goal consistency. */
  if (!goal) check('goal-consistency', null, 'no goal is set, so goal consistency cannot be judged');
  else if (goal.type === 'PRESERVE_CAPITAL' && ['YIELD', 'LEVERAGE'].includes(String(decision?.type))) {
    check('goal-consistency', false, `«${goal.name}» is a capital-preservation goal and this candidate adds protocol and rate risk to the same capital`, 'BLOCK');
  } else check('goal-consistency', true, `consistent with «${goal.name}» (${goal.type})`);

  /* Risk tolerance. */
  const tolerance = String(profile?.riskProfile?.value || '').toUpperCase();
  const candRisk = String(decision?.riskLevel || '').toUpperCase();
  const ORDER = { LOW: 1, MODERATE: 2, ELEVATED: 3, HIGH: 4, CRITICAL: 5 };
  const CEIL = { CONSERVATIVE: 2, MODERATE: 3, GROWTH: 4, AGGRESSIVE: 5 };
  if (!tolerance) check('risk-tolerance', null, 'the user has not stated a risk tolerance, so the candidate is not judged against one');
  else if (ORDER[candRisk] && ORDER[candRisk] > (CEIL[tolerance] || 3)) {
    check('risk-tolerance', false, `candidate risk ${candRisk} exceeds the stated ${tolerance} tolerance`, 'BLOCK');
  } else check('risk-tolerance', true, `candidate risk ${candRisk || 'unrated'} sits inside the ${tolerance} band`);

  /* Exposure acceptability. */
  const need = num(decision?.capitalRequiredUsd);
  const capital = num(financialState?.availableCapitalUsd);
  if (need === null || capital === null) check('exposure', null, 'capital requirement or available capital was not readable');
  else if (need > capital * 0.6) check('exposure', false, `this commits ${round((need / capital) * 100, 1)}% of available capital in one action`, 'BLOCK');
  else check('exposure', true, `commits ${round((need / capital) * 100, 1)}% of available capital`);

  /* Data freshness. */
  const stale = Array.isArray(freshnessReport?.stale) ? freshnessReport.stale : [];
  if (!freshnessReport) check('data-freshness', null, 'no freshness report was supplied with this evaluation');
  else if (stale.length) check('data-freshness', false, `decided on stale sections: ${stale.map((s) => s.key || s).join(', ')}`, 'BLOCK');
  else check('data-freshness', true, 'every input section was live at decision time');

  /* Internal contradiction: an expected return that is negative but pitched as
     a benefit, or a benefit with no capital behind it. */
  const expected = num(decision?.expectedReturnPct);
  if (expected !== null && expected < 0 && decision?.type !== 'DELEVERAGE') {
    check('contradiction', false, 'the candidate offers a negative expected return while being presented as a benefit', 'BLOCK');
  } else check('contradiction', true, 'no internal contradiction found between the stated benefit and its inputs');

  /* Reversibility and downside. */
  check('reversibility', reversible === null ? null : reversible === true,
    reversible === null ? 'reversibility was not declared for this action type'
      : reversible ? 'this action can be unwound, at the cost of fees and slippage'
        : 'this action is not cleanly reversible; unwinding it is a new decision with new risk',
    'WARN');
  check('downside', Boolean(decision?.downside), decision?.downside || 'no downside was articulated for this candidate', 'BLOCK');

  const blocking = findings.filter((f) => !f.ok && !f.unknown && f.severity === 'BLOCK');
  const unknowns = findings.filter((f) => f.unknown);
  return {
    schema: GUARDIAN_SCHEMA, brain: CI_SCHEMA, at: now,
    guardian: 'FINANCIAL',
    status: blocking.length ? 'BLOCK' : unknowns.length ? 'WARN' : 'PASS',
    blocking: blocking.map((f) => ({ id: f.id, detail: f.detail })),
    unknowns: unknowns.map((f) => ({ id: f.id, detail: f.detail })),
    findings,
    /* Stated as a field so no caller can mistake this for an approval. */
    grantsPermission: false,
    note: 'the Financial Guardian can only withhold or warn; permission comes from the policy engine and the user'
  };
}

/* ── §31 Execution Guardian ────────────────────────────────────────────── */

/**
 * The pre-flight for anything that touches money. Every check is a hard gate
 * whose input must be PRESENT: a missing simulation is a block, not a pass.
 */
export function executionGuardian({
  action = null, quote = null, simulation = null, permission = null, allowance = null,
  contractRisk = null, route = null, idempotencyKey = null, maxSlippagePct = 1, maxGasUsd = null, now = Date.now()
} = {}) {
  const checks = [];
  const gate = (id, ok, detail) => { checks.push({ id, ok: ok === true, detail }); return ok === true; };

  gate('simulation', simulation?.status === 'OK' || simulation?.ok === true,
    simulation ? `simulation ${simulation.status || (simulation.ok ? 'OK' : 'FAILED')}` : 'no simulation was run — execution without a dry run is refused');
  const slip = num(quote?.slippagePct);
  gate('slippage', slip !== null && slip <= num(maxSlippagePct),
    slip === null ? 'slippage was not reported by the venue' : `slippage ${slip}% against a ${maxSlippagePct}% ceiling`);
  const gas = num(quote?.gasUsd ?? quote?.feeUsd);
  gate('gas', maxGasUsd === null ? gas !== null : gas !== null && gas <= num(maxGasUsd),
    gas === null ? 'gas/fee was not quoted' : `fee ${gas} USD${maxGasUsd === null ? '' : ` against a ${maxGasUsd} USD ceiling`}`);
  const impact = num(quote?.priceImpactPct);
  gate('price-impact', impact !== null && Math.abs(impact) <= 3,
    impact === null ? 'price impact was not reported' : `price impact ${impact}%`);
  gate('contract-risk', contractRisk === null ? false : contractRisk.honeypot !== true && !(contractRisk.flags || []).length,
    contractRisk === null ? 'the destination contract was not screened' : (contractRisk.flags || []).length ? `contract flags: ${(contractRisk.flags || []).join(', ')}` : 'contract screened clean');
  gate('route', Boolean(route?.venue || route?.path || quote?.route),
    route?.venue || route?.path || quote?.route ? `route via ${route?.venue || route?.path || quote?.route}` : 'no execution route was resolved');
  gate('permission', permission?.granted === true,
    permission?.granted === true ? `permission ${permission.scope || 'EXECUTE'} granted${permission.expiresAt ? `, expires ${new Date(permission.expiresAt).toISOString()}` : ''}` : 'the required permission has not been granted for this action');
  gate('allowance', allowance === null ? false : allowance.sufficient === true,
    allowance === null ? 'token allowance was not checked' : allowance.sufficient ? 'allowance sufficient' : `allowance ${allowance.currentUsd ?? '?'} is below the required ${allowance.requiredUsd ?? '?'}`);
  gate('idempotency', Boolean(idempotencyKey),
    idempotencyKey ? 'idempotency key present — a retry cannot double-spend' : 'no idempotency key: a network retry could execute twice');

  const failed = checks.filter((c) => !c.ok);
  return {
    schema: GUARDIAN_SCHEMA, brain: CI_SCHEMA, at: now,
    guardian: 'EXECUTION',
    actionId: action?.actionId || null,
    status: failed.length ? 'BLOCK' : 'PASS',
    allowExecute: failed.length === 0,
    failed: failed.map((c) => ({ id: c.id, detail: c.detail })),
    checks,
    note: 'every gate fails closed: an unchecked input is a refusal, never an assumption'
  };
}

/* ── §16/§17 Opportunity Engine ────────────────────────────────────────── */

/**
 * Normalise heterogeneous opportunity sources (yield pools, lending rates, LP,
 * staking, smart-money follows) into one comparable shape and rank them, with
 * an explicit reason for each adjacent pair.
 */
export function rankOpportunities(rows = [], { riskProfile = 'MODERATE', limit = 10, now = Date.now() } = {}) {
  const weights = riskProfile === 'CONSERVATIVE' ? { r: 0.3, k: 0.4, l: 0.2, c: 0.1 }
    : riskProfile === 'AGGRESSIVE' ? { r: 0.55, k: 0.15, l: 0.15, c: 0.15 }
      : { r: 0.4, k: 0.28, l: 0.17, c: 0.15 };
  const RISKMAP = { low: 0.9, moderate: 0.65, medium: 0.65, elevated: 0.4, high: 0.22, extreme: 0.02 };
  const scored = [];
  const rejected = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const apr = num(raw?.aprPct ?? raw?.apy ?? raw?.expectedReturnPct);
    if (apr === null) { rejected.push({ id: raw?.id || raw?.project || 'unknown', code: 'NO_RATE' }); continue; }
    const depth = num(raw?.depthUsd ?? raw?.tvlUsd);
    const riskKey = String(raw?.riskLevel || raw?.risk || 'unknown').toLowerCase();
    const riskScore = RISKMAP[riskKey] ?? 0.35;
    const liquidityScore = raw?.lockup ? 0.2 : depth === null ? 0.4 : depth > 50_000_000 ? 1 : depth > 5_000_000 ? 0.75 : depth > 1_000_000 ? 0.5 : 0.25;
    const conf = num(raw?.confidence) ?? (depth === null || riskKey === 'unknown' ? 0.35 : 0.65);
    const returnScore = Math.max(0, Math.min(1, apr / 30));
    const score = round(returnScore * weights.r + riskScore * weights.k + liquidityScore * weights.l + conf * weights.c, 4);
    scored.push({
      id: String(raw.id || `${raw.project || 'src'}:${raw.symbol || raw.chain || 'asset'}`),
      name: raw.name || raw.project || raw.id || 'opportunity',
      kind: raw.kind || raw.type || 'YIELD',
      chain: raw.chain || null,
      aprPct: round(apr, 2),
      depthUsd: depth,
      riskLevel: riskKey.toUpperCase(),
      lockup: raw.lockup || null,
      timeHorizonMonths: num(raw.timeHorizonMonths),
      confidence: round(conf, 3),
      opportunityScore: score,
      components: { returnScore: round(returnScore, 3), riskScore: round(riskScore, 3), liquidityScore: round(liquidityScore, 3), confidence: round(conf, 3) },
      weights,
      evidence: [{ source: raw.source || 'yields-engine', detail: `${apr}% on ${raw.project || raw.chain || 'unknown venue'}, depth ${depth ?? 'unknown'}, risk ${riskKey}` }],
      estimate: true
    });
  }
  scored.sort((a, b) => b.opportunityScore - a.opportunityScore);
  const kept = scored.slice(0, Math.max(1, limit)).map((r, i) => ({ rank: i + 1, ...r }));
  const comparisons = [];
  for (let i = 0; i + 1 < kept.length; i += 1) {
    const a = kept[i];
    const b = kept[i + 1];
    const drivers = Object.keys(a.components)
      .map((k) => ({ key: k, delta: round((a.components[k] - b.components[k]) * (weights[k[0]] ?? 0.15), 4) }))
      .filter((d) => Math.abs(d.delta) > 0.0005)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    comparisons.push({ better: a.id, worse: b.id, scoreDelta: round(a.opportunityScore - b.opportunityScore, 4), drivers: drivers.slice(0, 2) });
  }
  return {
    schema: OPPORTUNITY_SCHEMA, brain: CI_SCHEMA,
    status: kept.length ? 'OK' : 'UNAVAILABLE',
    reason: kept.length ? null : 'NO_RANKABLE_OPPORTUNITY',
    at: now, count: scored.length, ranked: kept, rejected, comparisons, weights, estimate: true
  };
}

/**
 * §18 Smart Money Brain: turn flow evidence into a score modifier the decision
 * engine can consume. It never produces a recommendation on its own.
 */
export function smartMoneyModifier({ accumulation = null, exchangeInflowUsd = null, holderConcentrationPct = null, whaleSellingUsd = null } = {}) {
  const signals = [];
  let modifier = 0;
  if (accumulation === true) { modifier += 0.08; signals.push({ code: 'SMART_MONEY_ACCUMULATION', direction: 'positive' }); }
  const inflow = num(exchangeInflowUsd);
  if (inflow !== null && inflow > 0) { modifier -= 0.06; signals.push({ code: 'EXCHANGE_INFLOW', direction: 'negative', valueUsd: inflow }); }
  const conc = num(holderConcentrationPct);
  if (conc !== null && conc > 50) { modifier -= 0.08; signals.push({ code: 'HOLDER_CONCENTRATION', direction: 'negative', valuePct: conc }); }
  const selling = num(whaleSellingUsd);
  if (selling !== null && selling > 0) { modifier -= 0.1; signals.push({ code: 'WHALE_SELLING', direction: 'negative', valueUsd: selling }); }
  if (!signals.length) {
    return { schema: OPPORTUNITY_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_FLOW_DATA', modifier: 0, signals: [], detail: 'no smart-money input was readable; the score is left untouched rather than nudged on a guess' };
  }
  return {
    schema: OPPORTUNITY_SCHEMA, brain: CI_SCHEMA, status: 'OK',
    modifier: round(Math.max(-0.25, Math.min(0.15, modifier)), 3),
    signals,
    direction: modifier > 0 ? 'SUPPORTIVE' : modifier < 0 ? 'CAUTIONARY' : 'NEUTRAL',
    note: 'a bounded score modifier, never a signal to act on its own'
  };
}
