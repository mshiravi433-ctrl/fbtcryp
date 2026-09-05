#!/usr/bin/env node
/**
 * UPGRADE 10 — FBT FINANCIAL OS probe.
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MEASURES
 * The properties Upgrade 10 is only "complete" if it has (§70), asserted as
 * behaviour against the real engines with no mocks of our own code:
 *
 *   · financial state is computed, and an unread input is NULL + named, never 0
 *   · a decision set is several candidates with a stated "why #1 beat #2"
 *   · a candidate with no evidence CANNOT be ranked (§73)
 *   · the council keeps disagreement visible and caps confidence for it (§34)
 *   · the Financial Guardian can veto a high-scoring candidate (§30)
 *   · the Execution Guardian fails closed on every missing input (§31)
 *   · permissions are default-deny, time-limited, revocable (§45)
 *   · a kill switch beats a valid grant (§57)
 *   · autonomy downgrade revokes money grants (§46)
 *   · memory retrieval is bounded and inference cannot overwrite a stated fact
 *   · Monte Carlo is a distribution and is deterministic for a seed (§15)
 *   · the Twin never touches a wallet (§47)
 *   · monitoring detects material change and replans on it (§28)
 *   · outcome learning measures the gap; calibration refuses a tiny sample
 *   · NO route in the kernel can execute anything (§73)
 *
 * Run: npm run test:upgrade10
 */
import assert from 'node:assert/strict';
import { buildFinancialState, liquidityProfile } from '../../src/lib/central/financialState.js';
import { emptyProfile, updateProfile, assertedFacts, profileGaps, createGoal, goalProgress, detectGoalConflicts } from '../../src/lib/central/profile.js';
import { decide, scoreDecision, rankDecisions, weightsFor } from '../../src/lib/central/decision.js';
import { runScenarios, monteCarlo, optimizePortfolio, twinProject, STANDARD_SCENARIOS } from '../../src/lib/central/scenario.js';
import { createMemoryStore, evaluateOutcome, calibrate, MIN_CALIBRATION_SAMPLES, sanitize } from '../../src/lib/central/memory.js';
import { runCouncil, financialGuardian, executionGuardian, rankOpportunities, smartMoneyModifier } from '../../src/lib/central/council.js';
import { createPermissionCenter, createKillSwitches } from '../../src/lib/central/permission.js';
import { createStrategy, transitionStrategy, detectChanges, earlyWarnings, evaluateStrategy, interpretEvent, buildDailyBrief } from '../../src/lib/central/monitoring.js';
import { createKernel } from '../../server/ci/kernel.js';

const rows = [];
const t = (name, fn) => {
  try { fn(); rows.push([name, true, '']); } catch (error) { rows.push([name, false, String(error?.message || error).slice(0, 200)]); }
};

/* A realistic, DELIBERATELY INCOMPLETE portfolio: one holding has no price, so
   the "missing is null, not zero" rule has something to be tested against. */
const SECTIONS = {
  wallet: { connected: true, totalValueUsd: 24_000, balances: [{ symbol: 'ETH' }, { symbol: 'USDC' }] },
  portfolio: {
    totalValueUsd: 24_000,
    peakValueUsd: 32_000,
    holdings: [
      { symbol: 'BTC', valueUsd: 12_000, amount: 0.18, network: 'bitcoin' },
      { symbol: 'ETH', valueUsd: 6_000, amount: 2.1, network: 'ethereum' },
      { symbol: 'USDC', valueUsd: 6_000, amount: 6_000, network: 'ethereum' },
      { symbol: 'PEPE', amount: 1_000_000, network: 'ethereum' }
    ]
  },
  markets: { volatilityPct: { BTC: 55 }, trend: 'BULLISH' },
  lending: { positions: [{ asset: 'ETH', collateralUsd: 4_000, debtUsd: 1_500, healthFactor: 1.9, apyPct: 3 }] },
  farming: {
    pools: [
      { id: 'aave:usdc', project: 'aave', symbol: 'USDC', chain: 'ethereum', apy: 5.4, riskLevel: 'low', tvlUsd: 900_000_000 },
      { id: 'wild:xyz', project: 'wildfarm', symbol: 'XYZ', chain: 'base', apy: 240, riskLevel: 'extreme', tvlUsd: 40_000 },
      { id: 'curve:3pool', project: 'curve', symbol: '3CRV', chain: 'ethereum', apy: 3.1, riskLevel: 'low', tvlUsd: 300_000_000 }
    ]
  },
  risk: { level: 'MODERATE', confidence: 0.7, factors: ['concentration in BTC'] },
  capabilities: { swap: 'AVAILABLE', farming: 'AVAILABLE', borrowing: 'AVAILABLE', lending: 'AVAILABLE' }
};

/* ── §8 Financial state ─────────────────────────────────────────────────── */
t('financial state sums only priced holdings and names the unpriced one', () => {
  const fs = buildFinancialState(SECTIONS);
  assert.equal(fs.status, 'PARTIAL', 'an incomplete input set must not report OK');
  assert.equal(fs.holdingsUnvalued, 1, 'PEPE has no USD value and must be counted as unvalued');
  /* 12000 + 6000 + 6000 spot, + 4000 collateral, − 1500 debt = 26500 */
  assert.equal(fs.grossAssetsUsd, 28_000);
  assert.equal(fs.netWorthUsd, 26_500);
  assert.equal(fs.debtUsd, 1_500);
  assert.equal(fs.stableUsd, 6_000);
  assert.ok(fs.note.includes('1 holding'), 'the exclusion must be stated, not silent');
});

t('an unread input is null and named, never coerced to zero', () => {
  const fs = buildFinancialState({ portfolio: { holdings: [{ symbol: 'BTC', valueUsd: 100 }] } });
  assert.equal(fs.debtUsd, null, 'no lending section read → debt is unknown, not 0');
  assert.ok(fs.missing.includes('debt'));
  assert.equal(fs.drawdownPct, null, 'no peak recorded → no drawdown invented');
  assert.ok(fs.missing.includes('drawdown'));
});

t('nothing readable produces UNAVAILABLE rather than a zero net worth', () => {
  const fs = buildFinancialState({});
  assert.equal(fs.status, 'UNAVAILABLE');
  assert.equal(fs.reason, 'NO_VALUED_POSITION');
  assert.equal(fs.netWorthUsd, undefined);
});

t('confidence falls as inputs go missing', () => {
  const full = buildFinancialState(SECTIONS);
  const thin = buildFinancialState({ portfolio: { holdings: [{ symbol: 'BTC', valueUsd: 100 }] } });
  assert.ok(thin.confidence < full.confidence, 'a thinner read must not be reported as confidently');
});

t('liquidity profile treats collateral and LP as encumbered', () => {
  const fs = buildFinancialState(SECTIONS);
  const lp = liquidityProfile(fs);
  assert.equal(lp.immediateUsd, 6_000);
  assert.ok(lp.encumberedUsd >= 4_000, 'collateral must not be counted as spendable');
});

/* ── §9 Profile ─────────────────────────────────────────────────────────── */
t('an inference cannot overwrite a user-stated profile field', () => {
  let p = emptyProfile();
  p = updateProfile(p, { riskProfile: 'CONSERVATIVE' }, { origin: 'stated' }).profile;
  const res = updateProfile(p, { riskProfile: 'AGGRESSIVE' }, { origin: 'inferred' });
  assert.deepEqual(res.rejected[0].code, 'WOULD_OVERWRITE_STATED');
  assert.equal(res.profile.riskProfile.value, 'CONSERVATIVE');
});

t('assertedFacts returns only what the user actually said', () => {
  let p = emptyProfile();
  p = updateProfile(p, { riskProfile: 'MODERATE' }, { origin: 'stated' }).profile;
  p = updateProfile(p, { investmentHorizon: 'LONG' }, { origin: 'inferred' }).profile;
  const facts = assertedFacts(p);
  assert.equal(facts.riskProfile, 'MODERATE');
  assert.equal(facts.investmentHorizon, undefined, 'an inference is not a fact');
  assert.equal(p.investmentHorizon.confidence, 'MEDIUM');
});

t('a bad enum is rejected, never coerced', () => {
  const res = updateProfile(emptyProfile(), { riskProfile: 'YOLO' }, { origin: 'stated' });
  assert.equal(res.rejected[0].code, 'BAD_VALUE');
  assert.equal(res.profile.riskProfile.value, null);
});

t('profile gaps are ordered by what a decision needs first', () => {
  assert.equal(profileGaps(emptyProfile())[0], 'riskProfile');
});

/* ── §7 Goal OS ─────────────────────────────────────────────────────────── */
t('goal progress is computed against elapsed pace, not just the target', () => {
  const created = createGoal({ name: 'Grow', type: 'GROW_CAPITAL', targetUsd: 50_000, horizonMonths: 12 });
  assert.ok(created.ok);
  const goal = { ...created.goal, createdAt: Date.now() - 6 * 30 * 86_400_000 };
  const p = goalProgress(goal, buildFinancialState(SECTIONS));
  assert.equal(p.status, 'OK');
  assert.ok(p.expectedPct > 45 && p.expectedPct < 55, 'six months into twelve is about half the pace');
  assert.ok(['BEHIND', 'ON_TRACK', 'AT_RISK', 'AHEAD'].includes(p.track));
});

t('a goal with no target reports UNAVAILABLE and names what it needs', () => {
  const goal = createGoal({ name: 'Vague' }).goal;
  const p = goalProgress(goal, buildFinancialState(SECTIONS));
  assert.equal(p.status, 'UNAVAILABLE');
  assert.ok(p.needed.includes('targetUsd'));
});

t('opposing goals over the same capital are reported as a conflict', () => {
  const a = createGoal({ name: 'Grow', type: 'GROW_CAPITAL', targetUsd: 50_000, horizonMonths: 4 }).goal;
  const b = createGoal({ name: 'Preserve', type: 'PRESERVE_CAPITAL', targetUsd: 24_000, horizonMonths: 12 }).goal;
  const out = detectGoalConflicts([a, b], buildFinancialState(SECTIONS));
  assert.equal(out.conflicts[0].code, 'RISK_DIRECTION_CONFLICT');
  assert.ok(out.conflicts[0].resolution.length > 10, 'a conflict must come with a way out');
});

/* ── §11/§12 Decision engine ────────────────────────────────────────────── */
t('a candidate with no evidence cannot be scored', () => {
  const s = scoreDecision({ id: 'x', expectedReturnPct: 40, evidence: [] });
  assert.equal(s.status, 'UNSCORED');
  assert.equal(s.reason, 'NO_EVIDENCE');
});

t('a candidate with no evidenced return cannot be scored', () => {
  const s = scoreDecision({ id: 'x', evidence: [{ source: 'a' }] });
  assert.equal(s.status, 'UNSCORED');
  assert.equal(s.reason, 'NO_EVIDENCED_RETURN');
});

t('an unscorable candidate cannot win the ranking', () => {
  const out = rankDecisions([
    { id: 'fantasy', expectedReturnPct: 900, evidence: [], riskLevel: 'LOW' },
    { id: 'real', expectedReturnPct: 6, evidence: [{ source: 'yields' }], riskLevel: 'LOW', liquidity: 'FAST', steps: 1 }
  ]);
  assert.equal(out.ranked[0].id, 'real');
  assert.equal(out.unscored[0].id, 'fantasy');
});

t('weights are data, are returned, and are risk-profile dependent', () => {
  const cons = weightsFor('CONSERVATIVE');
  const agg = weightsFor('AGGRESSIVE');
  assert.ok(cons.risk > agg.risk, 'a conservative profile must weight risk more heavily');
  const s = scoreDecision({ id: 'a', expectedReturnPct: 10, evidence: [{ source: 'x' }], riskLevel: 'LOW' }, { weights: cons });
  assert.deepEqual(s.weights, cons, 'the score must carry the weights it used');
});

t('ranking explains why #1 beat #2 from the components that differed', () => {
  const out = decide({ financialState: buildFinancialState(SECTIONS), risk: SECTIONS.risk, capabilities: SECTIONS.capabilities, opportunities: rankOpportunities(SECTIONS.farming.pools).ranked });
  assert.equal(out.status, 'OK');
  assert.ok(out.ranking.ranked.length >= 2, 'a decision engine must produce alternatives, not one answer');
  assert.ok(out.ranking.comparisons.length >= 1);
  assert.ok(out.ranking.comparisons[0].because[0].length > 5);
});

t('"do nothing" is always a real, scoreable candidate', () => {
  const out = decide({ financialState: buildFinancialState(SECTIONS), risk: SECTIONS.risk, capabilities: SECTIONS.capabilities });
  assert.ok(out.candidates.some((c) => c.type === 'HOLD'), 'an engine that cannot recommend inaction always recommends a trade');
});

t('a candidate whose module is unavailable is skipped with a reason', () => {
  const out = decide({
    financialState: buildFinancialState(SECTIONS), risk: SECTIONS.risk,
    capabilities: { ...SECTIONS.capabilities, swap: 'UNAVAILABLE' }
  });
  assert.ok(out.skipped.some((s) => s.code === 'DEPENDENCY_UNAVAILABLE'));
});

t('no financial state means no recommendation at all', () => {
  const out = decide({ financialState: buildFinancialState({}) });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.candidates.length, 0);
});

/* ── §16/§17 Opportunity engine ─────────────────────────────────────────── */
t('opportunities are ranked and the extreme-risk 240% pool does not win', () => {
  const out = rankOpportunities(SECTIONS.farming.pools, { riskProfile: 'MODERATE' });
  assert.equal(out.status, 'OK');
  assert.notEqual(out.ranked[0].id, 'wild:xyz', 'a 240% APR on 40k of TVL with extreme risk must not top the list');
  assert.ok(out.comparisons.length >= 1, 'a ranking without a stated reason is a leaderboard, not advice');
});

t('a pool with no rate is rejected rather than assigned one', () => {
  const out = rankOpportunities([{ id: 'noapr', project: 'x' }]);
  assert.equal(out.rejected[0].code, 'NO_RATE');
  assert.equal(out.status, 'UNAVAILABLE');
});

t('smart money is a bounded modifier and abstains with no data', () => {
  assert.equal(smartMoneyModifier({}).status, 'UNAVAILABLE');
  const neg = smartMoneyModifier({ whaleSellingUsd: 5e6, exchangeInflowUsd: 2e6, holderConcentrationPct: 70 });
  assert.equal(neg.direction, 'CAUTIONARY');
  assert.ok(neg.modifier >= -0.25 && neg.modifier < 0, 'the modifier must stay bounded');
});

/* ── §33/§34 Agent council ──────────────────────────────────────────────── */
t('a security stop makes the council REJECT regardless of a bullish market', () => {
  const out = runCouncil({
    decision: { id: 'd', type: 'YIELD', expectedReturnPct: 20, capitalRequiredUsd: 100, evidence: [{ source: 'y' }] },
    financialState: buildFinancialState(SECTIONS),
    risk: { level: 'MODERATE', confidence: 0.8 },
    security: { signals: [{ code: 'HONEYPOT_DETECTED' }] },
    market: { trend: 'BULLISH' }
  });
  assert.equal(out.verdict, 'REJECT');
  assert.ok(out.confidence <= 0.2, 'a reject must cap confidence hard');
});

t('disagreement is visible and lowers confidence, exactly as §34 asks', () => {
  const out = runCouncil({
    decision: { id: 'd', type: 'YIELD', expectedReturnPct: 20, capitalRequiredUsd: 500, evidence: [{ source: 'a' }, { source: 'b' }] },
    financialState: buildFinancialState(SECTIONS),
    risk: { level: 'HIGH', confidence: 0.8 },
    security: { signals: [{ code: 'LOW_LIQUIDITY_WARNING' }] },
    market: { trend: 'BULLISH' },
    goal: createGoal({ name: 'g', type: 'GROW_CAPITAL', targetUsd: 1e5, horizonMonths: 12 }).goal
  });
  assert.equal(out.verdict, 'REVISE');
  assert.ok(out.disagreements.length >= 2, 'the disagreement must be enumerated, not averaged away');
  assert.ok(out.narrative.includes('confidence'), 'the narrative must state why confidence is what it is');
  assert.ok(out.confidence < 0.7);
});

t('an agent with no readable input abstains instead of defaulting to approve', () => {
  const out = runCouncil({
    decision: { id: 'd', expectedReturnPct: 5, evidence: [{ source: 'x' }] },
    financialState: buildFinancialState(SECTIONS)
  });
  assert.ok(out.abstained.includes('smart-money'));
  assert.ok(out.abstained.includes('risk'));
});

t('the council can never grant permission', () => {
  const out = runCouncil({ decision: { id: 'd', expectedReturnPct: 5, evidence: [{ source: 'x' }] }, financialState: buildFinancialState(SECTIONS) });
  assert.equal(out.grantsPermission, false);
});

/* ── §30/§31 Guardians ──────────────────────────────────────────────────── */
t('the Financial Guardian blocks a yield play against a preservation goal', () => {
  const goal = createGoal({ name: 'Keep it', type: 'PRESERVE_CAPITAL', targetUsd: 24_000, horizonMonths: 12 }).goal;
  const out = financialGuardian({
    decision: { id: 'y', type: 'YIELD', riskLevel: 'MODERATE', capitalRequiredUsd: 1000, downside: 'protocol risk', expectedReturnPct: 9 },
    goal, profile: emptyProfile(), financialState: buildFinancialState(SECTIONS), freshnessReport: { stale: [] }, reversible: true
  });
  assert.equal(out.status, 'BLOCK');
  assert.ok(out.blocking.some((b) => b.id === 'goal-consistency'));
  assert.equal(out.grantsPermission, false);
});

t('the Financial Guardian blocks a candidate with no articulated downside', () => {
  const out = financialGuardian({
    decision: { id: 'y', type: 'REBALANCE', riskLevel: 'LOW', capitalRequiredUsd: 100, expectedReturnPct: 4 },
    financialState: buildFinancialState(SECTIONS), freshnessReport: { stale: [] }, reversible: true
  });
  assert.ok(out.blocking.some((b) => b.id === 'downside'));
});

t('the Financial Guardian blocks a decision taken on stale data', () => {
  const out = financialGuardian({
    decision: { id: 'y', type: 'REBALANCE', riskLevel: 'LOW', capitalRequiredUsd: 100, downside: 'fees', expectedReturnPct: 4 },
    financialState: buildFinancialState(SECTIONS), freshnessReport: { stale: [{ key: 'portfolio' }] }, reversible: true
  });
  assert.ok(out.blocking.some((b) => b.id === 'data-freshness'));
});

t('the Execution Guardian fails closed when anything is unchecked', () => {
  const out = executionGuardian({});
  assert.equal(out.allowExecute, false);
  assert.ok(out.failed.length >= 8, 'every unsupplied input must be a failure, not a pass');
  assert.ok(out.failed.some((f) => f.id === 'idempotency'));
  assert.ok(out.failed.some((f) => f.id === 'simulation'));
});

t('the Execution Guardian passes only when every gate has real input', () => {
  const out = executionGuardian({
    action: { actionId: 'a1' },
    simulation: { status: 'OK' },
    quote: { slippagePct: 0.3, gasUsd: 4, priceImpactPct: 0.2, route: 'uniswap-v3' },
    permission: { granted: true, scope: 'execute:swap' },
    allowance: { sufficient: true },
    contractRisk: { honeypot: false, flags: [] },
    route: { venue: 'uniswap-v3' },
    idempotencyKey: 'idem-1',
    maxGasUsd: 25
  });
  assert.equal(out.allowExecute, true, out.failed.map((f) => f.id).join(','));
});

/* ── §45/§46/§57 Permission + kill switch ───────────────────────────────── */
t('money scopes are denied by default', () => {
  const pc = createPermissionCenter();
  assert.equal(pc.check('u1', 'execute:swap').granted, false);
  assert.equal(pc.check('u1', 'view:portfolio').granted, true);
});

t('a money grant is refused while autonomy forbids execution', () => {
  const pc = createPermissionCenter();
  const out = pc.grant('u2', 'execute:swap');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'MODE_FORBIDS_SCOPE');
});

t('a grant is time-limited and expires on its own', () => {
  let clock = 1_000_000;
  const pc = createPermissionCenter({ now: () => clock });
  pc.setMode('u3', 'APPROVE_EACH');
  pc.grant('u3', 'execute:swap', { ttlMs: 60_000 });
  assert.equal(pc.check('u3', 'execute:swap').granted, true);
  clock += 61_000;
  const after = pc.check('u3', 'execute:swap');
  assert.equal(after.granted, false);
  assert.equal(after.code, 'GRANT_EXPIRED');
});

t('a per-grant USD limit refuses both an over-limit and an unpriced action', () => {
  const pc = createPermissionCenter();
  pc.setMode('u4', 'APPROVE_EACH');
  pc.grant('u4', 'execute:swap', { limitUsd: 500 });
  assert.equal(pc.check('u4', 'execute:swap', { amountUsd: 400 }).granted, true);
  assert.equal(pc.check('u4', 'execute:swap', { amountUsd: 900 }).code, 'OVER_LIMIT');
  assert.equal(pc.check('u4', 'execute:swap').code, 'AMOUNT_UNKNOWN');
});

t('lowering autonomy immediately revokes money grants', () => {
  const pc = createPermissionCenter();
  pc.setMode('u5', 'LIMITED_AUTOMATION');
  pc.grant('u5', 'execute:bridge');
  assert.equal(pc.check('u5', 'execute:bridge').granted, true);
  const moved = pc.setMode('u5', 'SUGGEST');
  assert.ok(moved.revokedMoneyGrants >= 1);
  assert.equal(pc.check('u5', 'execute:bridge').granted, false);
});

t('a kill switch beats a valid, unexpired, in-limit grant', () => {
  const pc = createPermissionCenter();
  const ks = createKillSwitches();
  pc.setMode('u6', 'APPROVE_EACH');
  pc.grant('u6', 'execute:swap');
  assert.equal(pc.check('u6', 'execute:swap', { killSwitches: ks }).granted, true);
  ks.engage('EXECUTION', { reason: 'incident drill' });
  const blocked = pc.check('u6', 'execute:swap', { killSwitches: ks });
  assert.equal(blocked.granted, false);
  assert.equal(blocked.code, 'KILL_SWITCH_ENGAGED');
});

t('a kill switch cannot be turned off without a recorded reason', () => {
  const ks = createKillSwitches();
  ks.engage('GLOBAL', { reason: 'drill' });
  assert.equal(ks.disengage('GLOBAL').code, 'REASON_REQUIRED');
  assert.equal(ks.disengage('GLOBAL', { reason: 'drill complete' }).ok, true);
});

t('an unknown scope is denied, not allowed', () => {
  const pc = createPermissionCenter();
  assert.equal(pc.check('u7', 'execute:everything').code, 'UNKNOWN_SCOPE');
});

t('every allow and every deny leaves an audit row', () => {
  const pc = createPermissionCenter();
  pc.check('u8', 'execute:swap');
  pc.check('u8', 'view:wallet');
  const trail = pc.auditTrail('u8');
  assert.ok(trail.some((r) => r.action === 'DENY'));
  assert.ok(trail.some((r) => r.action === 'ALLOW'));
});

/* ── §22–§24 Memory OS ──────────────────────────────────────────────────── */
t('a secret can never enter memory', () => {
  const m = createMemoryStore();
  const res = m.write({ kind: 'PREFERENCE', key: 'k', value: { seedPhrase: 'abandon abandon abandon' } });
  assert.equal(JSON.stringify(res.record?.value || {}).includes('abandon'), false);
  assert.equal(sanitize('0x' + 'a'.repeat(64)), '[REDACTED]');
});

t('retrieval is bounded and reports what it withheld', () => {
  const m = createMemoryStore();
  for (let i = 0; i < 20; i += 1) m.write({ kind: 'DECISION', value: { note: `bitcoin decision ${i}` }, tags: ['DECISION'] });
  const out = m.retrieve({ text: 'bitcoin decision', limit: 5 });
  assert.equal(out.records.length, 5, 'the whole store must not be poured into a prompt');
  assert.ok(out.omitted > 0);
  assert.ok(out.note.includes('withheld'));
});

t('an irrelevant memory is not returned at any budget', () => {
  const m = createMemoryStore();
  m.write({ kind: 'EVENT', value: { note: 'unrelated dogecoin airdrop' } });
  const out = m.retrieve({ text: 'lending health factor', limit: 20 });
  assert.equal(out.records.length, 0, 'inventing continuity is worse than having none');
});

t('a keyed write replaces rather than stacking contradictions', () => {
  const m = createMemoryStore();
  m.write({ kind: 'PREFERENCE', key: 'risk', value: { v: 'LOW' }, origin: 'stated' });
  m.write({ kind: 'PREFERENCE', key: 'risk', value: { v: 'HIGH' }, origin: 'stated' });
  assert.equal(m.stats().byKind.PREFERENCE, 1);
});

t('an inferred memory cannot silently overwrite a stated one', () => {
  const m = createMemoryStore();
  m.write({ kind: 'PREFERENCE', key: 'risk', value: { v: 'LOW' }, origin: 'stated' });
  const res = m.write({ kind: 'PREFERENCE', key: 'risk', value: { v: 'HIGH' }, origin: 'inferred' });
  assert.equal(res.code, 'WOULD_OVERWRITE_STATED');
});

t('promotion from inference to fact requires the user', () => {
  const m = createMemoryStore();
  const w = m.write({ kind: 'PREFERENCE', key: 'horizon', value: { v: 'LONG' }, origin: 'inferred' });
  assert.equal(m.promote(w.record.id, {}).code, 'USER_CONFIRMATION_REQUIRED');
  assert.equal(m.promote(w.record.id, { confirmedByUser: true }).record.confidence, 'HIGH');
});

/* ── §25/§35 Learning + calibration ─────────────────────────────────────── */
t('outcome learning measures the gap and attributes a cause', () => {
  const out = evaluateOutcome({
    decision: { id: 'd', type: 'YIELD', expectedReturnPct: 15 },
    actual: { realisedReturnPct: 7, feesPaidUsd: 40, capitalUsd: 1000, aprAtEntryPct: 15, aprRealisedPct: 9 }
  });
  assert.equal(out.verdict, 'WORSE');
  assert.equal(out.gapPct, -8);
  assert.ok(out.causes.some((c) => c.code === 'APR_DECAY'));
  assert.ok(out.causes.some((c) => c.code === 'FEE_DRAG'));
  assert.equal(out.sampleSize, 1, 'one outcome must not be presented as a model change');
});

t('calibration refuses a sample too small to mean anything', () => {
  const out = calibrate([{ confidence: 0.8, correct: true }]);
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.need, MIN_CALIBRATION_SAMPLES);
});

t('calibration detects overconfidence on a real sample', () => {
  const rowsIn = Array.from({ length: 20 }, (_, i) => ({ confidence: 0.9, correct: i < 10 }));
  const out = calibrate(rowsIn);
  assert.equal(out.status, 'OK');
  assert.equal(out.verdict, 'OVERCONFIDENT');
  assert.ok(out.brierScore > 0);
});

/* ── §14/§15 Scenarios and Monte Carlo ──────────────────────────────────── */
t('all five standard scenarios run and stress is worse than bear', () => {
  const fs = buildFinancialState(SECTIONS);
  const out = runScenarios({ ...SECTIONS, financialState: fs });
  assert.equal(out.status, 'OK');
  const byId = Object.fromEntries(out.scenarios.map((s) => [s.id, s]));
  for (const id of Object.keys(STANDARD_SCENARIOS)) assert.ok(byId[id], `missing scenario ${id}`);
  assert.ok(byId.STRESS.deltaUsd < byId.BEAR.deltaUsd);
  assert.equal(out.worst, 'EXTREME_STRESS');
  assert.equal(out.estimate, true);
});

t('a depeg scenario costs the stable leg something', () => {
  const fs = buildFinancialState(SECTIONS);
  const out = runScenarios({ ...SECTIONS, financialState: fs });
  const extreme = out.scenarios.find((s) => s.id === 'EXTREME_STRESS');
  assert.ok(extreme.depegLossUsd > 0, 'a modelled depeg must actually move the number');
});

t('an out-of-range custom shock is rejected, not clamped', () => {
  const out = runScenarios({ ...SECTIONS, financialState: buildFinancialState(SECTIONS) }, { custom: [{ id: 'silly', shockPct: -500 }] });
  assert.equal(out.rejected[0].code, 'SHOCK_OUT_OF_RANGE');
});

t('Monte Carlo returns a distribution, not a number, and is seed-deterministic', () => {
  const a = monteCarlo({ startUsd: 10_000, months: 12, seed: 42, paths: 1200 });
  const b = monteCarlo({ startUsd: 10_000, months: 12, seed: 42, paths: 1200 });
  assert.deepEqual(a.percentiles, b.percentiles, 'a forecast that changes on reload is not a forecast');
  assert.ok(a.percentiles.p10 < a.percentiles.p50 && a.percentiles.p50 < a.percentiles.p90);
  assert.equal(a.estimate, true);
  assert.ok(a.disclaimer.includes('not a prediction'));
  const c = monteCarlo({ startUsd: 10_000, months: 12, seed: 43, paths: 1200 });
  assert.notDeepEqual(a.percentiles, c.percentiles, 'a different seed must actually resample');
});

t('Monte Carlo refuses to project from an unread portfolio value', () => {
  assert.equal(monteCarlo({ startUsd: null }).status, 'UNAVAILABLE');
});

t('the optimizer produces three allocations with a delta from today', () => {
  const out = optimizePortfolio({ financialState: buildFinancialState(SECTIONS) });
  assert.equal(out.status, 'OK');
  assert.equal(out.portfolios.length, 3);
  assert.ok(out.portfolios.every((p) => p.maxDrawdownEstimatePct < 0 && p.estimate === true));
  assert.ok(out.portfolios[0].deltaFromCurrent, 'an allocation with no delta is not actionable');
});

/* ── §47 Financial Twin ─────────────────────────────────────────────────── */
t('the twin projects a change without touching a wallet', () => {
  const out = twinProject({ financialState: buildFinancialState(SECTIONS), change: { addCapitalUsd: 5_000 } });
  assert.equal(out.status, 'OK');
  assert.equal(out.touchedWallet, false);
  assert.equal(out.afterUsd, 31_500);
  assert.ok(out.projections.length === 3);
  assert.ok(out.projections[0].afterP50 > out.projections[0].beforeP50);
});

t('the twin refuses a change that would go negative', () => {
  const out = twinProject({ financialState: buildFinancialState(SECTIONS), change: { removeCapitalUsd: 1e9 } });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(out.reason, 'CHANGE_EXCEEDS_CAPITAL');
});

/* ── §27–§29 Strategy lifecycle, monitoring, replanning ─────────────────── */
t('the strategy lifecycle refuses an illegal transition', () => {
  const s = createStrategy({ name: 'S1' }).strategy;
  assert.equal(transitionStrategy(s, 'ACTIVE').code, 'ILLEGAL_TRANSITION');
  const sim = transitionStrategy(s, 'SIMULATED').strategy;
  assert.equal(transitionStrategy(sim, 'APPROVED').ok, true);
});

t('change detection ignores noise and fires on a decision-relevant move', () => {
  const before = { netWorthUsd: 26_500, leverage: 1.1, stableSharePct: 21, drawdownPct: -17, riskLevel: 'MODERATE', concentration: { topSharePct: 40 } };
  const quiet = detectChanges(before, { ...before, netWorthUsd: 26_550 });
  assert.equal(quiet.changed, false);
  assert.ok(quiet.note.includes('threshold'));
  const loud = detectChanges(before, { ...before, netWorthUsd: 20_000, riskLevel: 'HIGH' });
  assert.equal(loud.changed, true);
  assert.ok(loud.changes.every((c) => c.why && c.threshold !== undefined), 'a threshold with no stated reason is a magic number');
});

t('early warnings fire before the problem is large, with a way out', () => {
  const fs = { status: 'OK', leverage: 2.8, stableSharePct: 2, drawdownPct: -30, concentration: { topSharePct: 60, topAsset: 'BTC' } };
  const out = earlyWarnings({ financialState: fs, profile: emptyProfile() });
  assert.equal(out.highest, 'HIGH');
  const codes = out.warnings.map((w) => w.code);
  for (const c of ['LEVERAGE_INCREASE', 'LIQUIDITY_DECREASE', 'DRAWDOWN_INCREASE', 'CONCENTRATION_INCREASE']) assert.ok(codes.includes(c), `missing ${c}`);
  assert.ok(out.warnings.every((w) => w.suggestion.length > 10));
});

t('replanning fires on a high-severity trigger and names its cause', () => {
  const strategy = { strategyId: 's1', name: 'S', state: 'ACTIVE' };
  const warnings = earlyWarnings({ financialState: { status: 'OK', leverage: 3.2, concentration: {} }, profile: emptyProfile() });
  const out = evaluateStrategy({ strategy, warnings, changes: null, triggers: [] });
  assert.equal(out.verdict, 'REPLAN_REQUIRED');
  assert.equal(out.suggestedState, 'DEGRADED');
  assert.ok(out.explanation.includes('trigger'));
});

t('a quiet market leaves the approved plan standing', () => {
  const out = evaluateStrategy({ strategy: { strategyId: 's', name: 'S', state: 'ACTIVE' }, changes: { changes: [] }, warnings: { warnings: [] } });
  assert.equal(out.verdict, 'STILL_VALID');
});

/* ── §50 Event intelligence + §49 brief ─────────────────────────────────── */
t('a whale transfer in an asset you do not hold is informational', () => {
  const out = interpretEvent({ type: 'WHALE_TRANSFER', symbol: 'DOGE', valueUsd: 5e6 }, { financialState: buildFinancialState(SECTIONS) });
  assert.equal(out.impact, 'INFORMATIONAL');
  assert.equal(out.action, 'MONITOR');
  assert.ok(out.explanation.includes('none of DOGE'));
});

t('the same event in a large holding escalates', () => {
  const out = interpretEvent({ type: 'WHALE_TRANSFER', symbol: 'BTC', valueUsd: 5e6 }, { financialState: buildFinancialState(SECTIONS) });
  assert.equal(out.impact, 'HIGH');
  assert.equal(out.affected[0].symbol, 'BTC');
});

t('an unmodelled event type gets no invented interpretation', () => {
  assert.equal(interpretEvent({ type: 'ALIEN_INVASION' }).status, 'UNAVAILABLE');
});

t('the daily brief does not send when nothing changed', () => {
  const out = buildDailyBrief({ financialState: buildFinancialState(SECTIONS), changes: { changes: [] }, warnings: { warnings: [] } });
  assert.equal(out.send, false);
  assert.equal(out.sections, null);
});

/* ── §4/§5 Kernel integration ───────────────────────────────────────────── */
t('the kernel composes state → goal → decision end to end', () => {
  const kernel = createKernel({ stateStore: fakeStore(SECTIONS) });
  const owner = 'dev:kernel-1';
  kernel.patchProfile(owner, { riskProfile: 'MODERATE', concentrationTolerancePct: 30 }, { origin: 'stated' });
  kernel.addGoal(owner, { name: 'Grow 4 months', type: 'GROW_CAPITAL', targetUsd: 50_000, horizonMonths: 4 });
  const out = kernel.advise(owner);
  assert.equal(out.status, 'OK');
  assert.ok(out.candidates.length >= 2, 'the user must be given a comparison, not a verdict');
  assert.ok(out.candidates.every((c) => c.council && c.guardian), 'every candidate must carry its council and guardian verdicts');
  assert.equal(out.executed, false);
  assert.ok(out.disclaimer.includes('estimate'));
  assert.ok(out.goal.progress.status === 'OK');
});

t('the kernel never executes and never grants permission by advising', () => {
  const kernel = createKernel({ stateStore: fakeStore(SECTIONS) });
  const owner = 'dev:kernel-2';
  const out = kernel.advise(owner);
  assert.equal(out.executed, false);
  const auth = kernel.authorize(owner, { scope: 'execute:swap', amountUsd: 100 });
  assert.equal(auth.granted, false, 'advising must not have created a grant');
  assert.equal(auth.executes, false);
});

t('kernel preflight refuses execution while the kill switch is engaged', () => {
  const kernel = createKernel({ stateStore: fakeStore(SECTIONS) });
  const owner = 'dev:kernel-3';
  kernel.permissions.setMode(owner, 'APPROVE_EACH');
  kernel.permissions.grant(owner, 'execute:swap');
  kernel.killSwitches.engage('GLOBAL', { reason: 'probe' });
  const out = kernel.preflight(owner, {
    scope: 'execute:swap', action: { actionId: 'a' }, simulation: { status: 'OK' },
    quote: { slippagePct: 0.2, gasUsd: 3, priceImpactPct: 0.1, amountUsd: 100 },
    allowance: { sufficient: true }, contractRisk: { honeypot: false, flags: [] },
    route: { venue: 'x' }, idempotencyKey: 'k', maxGasUsd: 10
  });
  assert.equal(out.allowExecute, false);
  assert.ok(out.failed.some((f) => f.id === 'permission'));
});

t('the kernel monitors, detects material change and replans', () => {
  const store = fakeStore(SECTIONS);
  const kernel = createKernel({ stateStore: store });
  const owner = 'dev:kernel-4';
  kernel.addGoal(owner, { name: 'G', type: 'GROW_CAPITAL', targetUsd: 50_000, horizonMonths: 4 });
  const s = kernel.registerStrategy(owner, { name: 'S', expectedReturnPct: 12 });
  kernel.moveStrategy(owner, s.strategy.strategyId, 'SIMULATED', 'probe');
  kernel.moveStrategy(owner, s.strategy.strategyId, 'APPROVED', 'probe');
  kernel.moveStrategy(owner, s.strategy.strategyId, 'ACTIVE', 'probe');
  kernel.assess(owner);
  /* Halve the portfolio: unambiguously a decision-relevant move. */
  store.__set({
    ...SECTIONS,
    portfolio: { ...SECTIONS.portfolio, totalValueUsd: 12_000, holdings: [{ symbol: 'BTC', valueUsd: 11_000 }, { symbol: 'USDC', valueUsd: 1_000 }] }
  });
  const out = kernel.monitor(owner);
  assert.equal(out.status, 'OK');
  assert.equal(out.changes.changed, true);
  assert.ok(out.replan, 'an active strategy must be re-evaluated when the state moves');
  assert.ok(['REPLAN_REQUIRED', 'REPLAN_RECOMMENDED', 'REVIEW'].includes(out.replan.verdict));
  assert.equal(out.brief.send, true, 'a halved portfolio is exactly what a brief exists for');
});

t('the kernel evaluation dashboard refuses to invent the metrics it cannot measure', () => {
  const kernel = createKernel({ stateStore: fakeStore(SECTIONS) });
  const snap = kernel.evaluationSnapshot('dev:kernel-5');
  assert.ok(snap.notMeasuredHere.includes('hallucinationRate'));
  assert.ok(snap.notMeasuredReason.includes('inventing'));
  assert.equal(snap.calibration.status, 'UNAVAILABLE');
});

t('a recorded outcome flows into memory and calibration', () => {
  const kernel = createKernel({ stateStore: fakeStore(SECTIONS) });
  const owner = 'dev:kernel-6';
  for (let i = 0; i < 12; i += 1) {
    kernel.recordOutcome(owner, {
      decision: { id: `d${i}`, type: 'YIELD', expectedReturnPct: 15, confidence: 0.9 },
      actual: { realisedReturnPct: i < 4 ? 15 : 3 }
    });
  }
  const cal = kernel.calibration(owner);
  assert.equal(cal.status, 'OK');
  assert.equal(cal.verdict, 'OVERCONFIDENT');
  assert.ok(kernel.memory.stats(owner).byKind.OUTCOME >= 10);
});

/** A minimal state store with the two methods the kernel uses. */
function fakeStore(sections) {
  let current = sections;
  const wrap = () => ({ sections: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, { data: v, source: 'probe', status: 'OK', updatedAt: Date.now() }])) });
  return {
    peek: () => wrap(),
    freshness: () => ({ status: 'LIVE', ageMs: 0 }),
    __set: (next) => { current = next; }
  };
}

/* ── report ─────────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok, detail] of rows) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
console.log(`\nUpgrade 10 — Financial OS: ${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) process.exitCode = 1;
