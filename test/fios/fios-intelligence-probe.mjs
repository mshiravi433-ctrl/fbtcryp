// FBT Financial Intelligence OS — intelligence probe (batch 6).
//
// Covers: AI Council (6 roles + persisted disagreement), External Agents
// registry + Agent Trust Score, and the Learning Engine (verified-only).
//
// These are pure module probes: no network, real filesystem KV (tmp dir),
// honest unavailable when the environment cannot support a feature.

import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.TEMP_DIR = `fios-int-${randomUUID().slice(0, 8)}`;
process.env.RATE_LIMIT = '10000,60000';
process.env.AI_RATE_LIMIT = '10000,60000';
process.env.BRAIN_RATE_LIMIT = '10000,60000';
process.env.MEM_RATE_LIMIT = '10000,60000';
process.env.SAFE_INTENTS_ONLY = 'true';
process.env.AUTONOMOUS_POLICY_ENABLED = 'true';
process.env.LEARNING_ENGINE_ENABLED = 'true';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.FBT_DATA_DIR;
process.env.FBT_CENTRAL_FS_DIR = `./${process.env.TEMP_DIR}`;

const { createCollections } = await import('../../server/fios/collections.js');
const { createObservability } = await import('../../server/fios/observability.js');
const { createMemory2 } = await import('../../server/fios/memory.js');
const { createPreferenceModel } = await import('../../server/fios/preferences.js');
const { createBehaviorModel } = await import('../../server/fios/behavior.js');
const { createGenomeModel } = await import('../../server/fios/genome.js');
const { createStrategyCompetition } = await import('../../server/fios/competition.js');
const { createCouncil, COUNCIL_ROLES, COUNCIL_VERDICTS } = await import('../../server/fios/council.js');
const { createAgentRegistry, TRUST_FLOOR_FOR_AUTHORIZATION, computeAgentTrustScore } = await import('../../server/fios/agents.js');
const { createLearningEngine } = await import('../../server/fios/learning.js');
const { EXTERNAL_AGENT_SANDBOX_STAGES } = await import('../../src/lib/intent-ai/externalAgentTrust.js');
const { STRATEGY_PROPOSAL_SCHEMA } = await import('../../src/lib/intent-ai/strategyCompetition.js');

let passed = 0;
let failed = 0;
const failures = [];

function t(name, cond, detail = null) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const collections = createCollections({});
const obs = createObservability({});
const memory = createMemory2({ collections, observability: obs });
const preferences = createPreferenceModel({ memory, observability: obs });
const behavior = createBehaviorModel({ collections, memory, observability: obs });
const genome = createGenomeModel({ collections, preferences, memory, observability: obs });
const competition = createStrategyCompetition({ collections, observability: obs });
const council = createCouncil({ collections, competition, observability: obs });
const registry = createAgentRegistry({ collections, observability: obs });
const learning = createLearningEngine({ collections, memory, preferences, behavior, genome, observability: obs });

const safe = (id, over = {}) => ({
  schema: STRATEGY_PROPOSAL_SCHEMA,
  id, name: `strategy ${id}`, kind: 'HOLD', riskPct: 12, expectedReturnPct: 6,
  potentialLossPct: 5, feesUsd: 1, goalCompatibilityPct: 90,
  evidence: ['observed: 12-month fill history'], evidenceQuality: { status: 'observed' },
  ...over
});

/* ══════════════════════  COUNCIL  ══════════════════════ */

t('§C1 the council has exactly six roles, the Guardian last', JSON.stringify(COUNCIL_ROLES) === JSON.stringify(['FINANCIAL_ANALYST', 'STRATEGY_ARCHITECT', 'RISK_AUDITOR', 'YIELD_ANALYST', 'TRADING_ANALYST', 'GUARDIAN']));
t('§C1 verdicts are a closed list', JSON.stringify([...COUNCIL_VERDICTS]) === JSON.stringify(['APPROVE', 'REVISE', 'REJECT', 'ABSTAIN']));

/* A: the Risk Auditor's veto is the loudest voice — a REJECT beats every APPROVE */
const vetoOwner = 'council-veto';
const vetoSet = [
  safe('safe', { expectedReturnPct: 8 }),
  safe('risky', { kind: 'LEVERAGED_YIELD', riskPct: 75, expectedReturnPct: 21, potentialLossPct: 35, feesUsd: 4, goalCompatibilityPct: 40, name: 'leverage yield' })
];
const cVeto = await council.convene({ owner: vetoOwner, strategies: vetoSet, preferences: { riskTolerance: 'CONSERVATIVE' }, goal: { targetUsd: 40000 } });
t('§C1 a vetoed strategy is a REJECT for the whole council', cVeto.ok && cVeto.council.verdict === 'REJECT', cVeto.council?.verdict);
t('§C1 every one of the six roles voted or abstained, with a named reason',
  cVeto.council.votes.length === 6 && cVeto.council.votes.every((v) => COUNCIL_ROLES.includes(v.role) && COUNCIL_VERDICTS.includes(v.verdict) && v.reason));
t('§C1 the dissent is named: the Risk Auditor with its veto reason',
  cVeto.council.disagreement === true && cVeto.council.disagreements.some((d) => d.role === 'RISK_AUDITOR' && d.verdict === 'REJECT' && /ceiling/.test(d.reason)),
  cVeto.council?.disagreements);
t('§C1 one REJECT caps confidence at 20% whatever the approvals say', cVeto.council.confidence === 0.2, cVeto.council?.confidence);
t('§C1 the council never grants permission', cVeto.council.grantsPermission === false);
const cRecent = await council.recent(vetoOwner);
t('§C1 the council record is persisted (disagreement included)',
  cRecent.ok && cRecent.records.length === 1 && cRecent.records[0].disagreement === true && cRecent.records[0].disagreements.length >= 1);
const cGot = await council.get(vetoOwner, cVeto.council.id);
t('§C1 the persisted council is retrievable by id', cGot.ok && cGot.record.verdict === 'REJECT');
const cEvents = obs.recent(vetoOwner, { limit: 50 });
t('§C1 convening emits a strategy.selected event with the dissenters',
  cEvents.some((e) => e.type === 'strategy.selected' && e.payload.councilId === cVeto.council.id && e.payload.dissenters.includes('RISK_AUDITOR')));

/* B: everyone who could judge agreed → unanimous, honest abstentions named */
const uniOwner = 'council-uni';
const uniFinancial = {
  status: 'ok',
  net: { availableCapitalUsd: { value: 10000, status: 'ok' }, netWorthUsd: { value: 25000, status: 'ok' } },
  provenance: { coverage: 0.9, stale: [], unavailable: [] }
};
const cUni = await council.convene({
  owner: uniOwner,
  strategies: [safe('A'), safe('B', { riskPct: 40, potentialLossPct: 10, feesUsd: 9, goalCompatibilityPct: 60, name: 'the expensive one' })],
  preferences: { riskTolerance: 'MODERATE' },
  goal: { targetUsd: 40000, name: 'Reach 40k' },
  financial: uniFinancial,
  risk: { level: 'MODERATE', securitySignals: [] },
  decision: { id: 'dec_x', type: 'HOLD', reversible: true, downside: 'modelled: max drawdown 5%', capitalRequiredUsd: 500, expectedReturnPct: 6 },
  goalSpec: { type: 'GROW_CAPITAL', name: 'Reach 40k' }
});
t('§C2 a clear candidate with readable inputs gets a unanimous APPROVE', cUni.ok && cUni.council.verdict === 'APPROVE' && cUni.council.unanimous === true, cUni.council?.verdict);
t('§C2 no disagreement was recorded', cUni.council.disagreement === false && cUni.council.disagreements.length === 0);
t('§C2 the roles with nothing to read ABSTAIN and are named as abstaining',
  JSON.stringify([...cUni.council.abstained].sort()) === JSON.stringify(['TRADING_ANALYST', 'YIELD_ANALYST']), cUni.council?.abstained);
t('§C2 the Guardian voted APPROVE on fully readable input', cUni.council.votes.find((v) => v.role === 'GUARDIAN').verdict === 'APPROVE');
t('§C2 unanimity is confidence: above the split-verdict caps', cUni.council.confidence > 0.6, cUni.council?.confidence);
t('§C2 the winner is the dominant candidate', cUni.council.winnerId === 'A', cUni.council?.winnerId);

/* C: the judge found no winner — the council cannot crown one either */
const nowinOwner = 'council-nowinner';
const cNowin = await council.convene({
  owner: nowinOwner,
  strategies: [safe('x', { evidence: [], evidenceQuality: { status: null } }), safe('y', { riskPct: 15, feesUsd: 2, evidence: [], evidenceQuality: { status: null } })],
  preferences: { riskTolerance: 'MODERATE' }
});
t('§C2 when the judge found no winner, the council records winnerId null', cNowin.ok && cNowin.council.winnerId === null, cNowin.council?.winnerId);

/* D: the Guardian can BLOCK — an oversized exposure beats four approvals */
const blockOwner = 'council-block';
const cBlock = await council.convene({
  owner: blockOwner,
  strategies: [safe('A'), safe('B', { riskPct: 40, potentialLossPct: 10, feesUsd: 9, goalCompatibilityPct: 60, name: 'the expensive one' })],
  preferences: { riskTolerance: 'MODERATE' },
  goal: { targetUsd: 40000, name: 'Reach 40k' },
  financial: uniFinancial,
  risk: { level: 'MODERATE', securitySignals: [] },
  decision: { id: 'dec_y', type: 'HOLD', reversible: true, downside: 'modelled', capitalRequiredUsd: 9000, expectedReturnPct: 6 },
  goalSpec: { type: 'GROW_CAPITAL', name: 'Reach 40k' }
});
t('§C2 a blocking Guardian finding is a REJECT for the whole council', cBlock.ok && cBlock.council.verdict === 'REJECT', cBlock.council?.verdict);
t('§C2 the blocking reason names the exposure', cBlock.council.disagreements.some((d) => d.role === 'GUARDIAN' && /capital/i.test(d.reason)), cBlock.council?.disagreements);
t('§C2 the blocked council is capped at 20% confidence', cBlock.council.confidence === 0.2);

/* E: the external agent gets a seventh seat — down-weighted, untrusted, never counted */
const extOwner = 'council-ext';
const sha = 'ab'.repeat(32);
const catalogRow = {
  id: 'ext-good-1',
  name: 'Verified Yield Adviser',
  verification: { status: 'active', issuers: ['fbt-trust'], method: 'independent_review', issuedAt: Date.now() - 86400000, expiresAt: Date.now() + 30 * 86400000, evidence: [{ type: 'signed_attestation', sha256: sha }] },
  sandbox: {
    stage: 'production', operatorApproved: true,
    completedStages: [...EXTERNAL_AGENT_SANDBOX_STAGES],
    evidence: Object.fromEntries(EXTERNAL_AGENT_SANDBOX_STAGES.map((s) => [s, [{ type: 'sandbox_test_run', sha256: sha }]]))
  },
  expiresAt: Date.now() + 60 * 86400000
};
const catRes = await registry.registerFromCatalog(extOwner, catalogRow);
t('§C3 a catalog agent with real verification registers as verified', catRes.ok && catRes.verified === true, catRes.code);
for (let i = 0; i < 5; i += 1) await registry.recordInteraction(extOwner, catRes.agent.id, { ok: true, verified: true, detail: `verified fill ${i}` });
await registry.authorize(extOwner, catRes.agent.id, { scope: 'council-vote' });
const extSeat = await registry.forCompetition(extOwner, catRes.agent.id);
t('§C3 the competition seat carries exactly the shape the competition expects',
  extSeat.ok && extSeat.externalAgent.authorized === true && extSeat.externalAgent.trust.score >= 70 && Boolean(extSeat.externalAgent.passport.id));
const cExt = await council.convene({ owner: extOwner, strategies: [safe('A'), safe('B', { riskPct: 40, feesUsd: 9, name: 'b' })], preferences: { riskTolerance: 'MODERATE' }, externalAgent: extSeat.externalAgent });
t('§C3 an attending external agent is marked untrusted and never counted',
  cExt.ok && cExt.council.externalAgent && cExt.council.externalAgent.untrusted === true && cExt.council.externalAgent.counted === false, cExt.council?.externalAgent);
await registry.revoke(extOwner, catRes.agent.id, { reason: 'test' });
const noSeat = await registry.forCompetition(extOwner, catRes.agent.id);
const cExtOff = await council.convene({ owner: extOwner, strategies: [safe('A'), safe('B', { riskPct: 40, feesUsd: 9, name: 'b' })], preferences: { riskTolerance: 'MODERATE' }, externalAgent: noSeat.externalAgent });
t('§C3 a revoked agent is excluded and the exclusion is recorded',
  cExtOff.ok && cExtOff.council.externalAgent?.verdict === 'ABSTAIN' && /excluded/i.test(cExtOff.council.externalAgent.reason || ''), cExtOff.council?.externalAgent);

/* ══════════════════════  AGENTS  ══════════════════════ */

const agOwner = 'agents-1';

t('§A1 the tiers are a closed list, EXPIRED first', JSON.stringify(registry.TIERS) === JSON.stringify(['EXPIRED', 'UNTRUSTED', 'LIMITED', 'TRUSTED', 'HIGH_TRUST']));
const agRes = await registry.register(agOwner, {
  name: 'DCA Bot', provider: 'acme', capabilities: ['dca-planning'],
  passport: { id: 'dca-bot-1', name: 'DCA Bot', capabilities: ['dca-planning'] }
});
t('§A1 registration sanitises the passport and scores it from real artifacts',
  agRes.ok && agRes.agent.passport.id === 'dca-bot-1' && agRes.agent.trust.tier === 'UNTRUSTED', agRes.agent?.trust);
t('§A1 an unverified agent fails the security evaluation with the code named',
  agRes.agent.security.ok === false && agRes.agent.security.failures.includes('AGENT_NOT_VERIFIED'), agRes.agent?.security);
t('§A1 no agent can execute, whatever its score', agRes.agent.canExecute === false);
t('§A1 the trust basis names every component that made the score',
  agRes.agent.trust.basis.map((b) => b.component).join(',') === 'passport,security,sandbox,reputation');
const badReg = await registry.register(agOwner, { name: 'Evil', passport: { id: 'evil-1', privateKey: `0x${'a'.repeat(64)}` } });
t('§A1 raw credentials are refused at the door', badReg.code === 'RAW_CREDENTIAL_FORBIDDEN', badReg.code);

const cat2 = await registry.registerFromCatalog(agOwner, {
  id: 'ext-good-2',
  name: 'Verified Yield Adviser 2',
  verification: { status: 'active', issuers: ['fbt-trust'], method: 'independent_review', issuedAt: Date.now() - 86400000, expiresAt: Date.now() + 30 * 86400000, evidence: [{ type: 'signed_attestation', sha256: sha }] },
  sandbox: {
    stage: 'production', operatorApproved: true,
    completedStages: [...EXTERNAL_AGENT_SANDBOX_STAGES],
    evidence: Object.fromEntries(EXTERNAL_AGENT_SANDBOX_STAGES.map((s) => [s, [{ type: 'sandbox_test_run', sha256: sha }]]))
  },
  expiresAt: Date.now() + 60 * 86400000
});
t('§A2 a verified catalog agent with a complete production sandbox scores LIMITED',
  cat2.ok && cat2.agent.security.ok === true && cat2.agent.trust.tier === 'LIMITED' && cat2.agent.trust.score === 65, cat2.agent?.trust);

const expired = await registry.registerFromCatalog(agOwner, {
  id: 'ext-old-1', name: 'Old Timer',
  verification: { status: 'active', issuers: ['fbt-trust'], issuedAt: Date.now() - 200 * 86400000, expiresAt: Date.now() - 30 * 86400000, evidence: [{ type: 'signed_attestation', sha256: sha }] },
  expiresAt: Date.now() - 30 * 86400000
});
t('§A2 an expired passport is a corpse: score 0, tier EXPIRED',
  expired.ok && expired.agent.trust.score === 0 && expired.agent.trust.tier === 'EXPIRED' && expired.agent.expired === true, expired.agent?.trust);

const preAuth = await registry.authorize(agOwner, cat2.agent.id, { scope: 'council-vote' });
t('§A2 authorization below the 70 floor is refused with the score and the floor named',
  preAuth.code === 'AUTHORIZATION_REFUSED' && preAuth.score === 65 && preAuth.required === TRUST_FLOOR_FOR_AUTHORIZATION, preAuth);
const uncounted = await registry.recordInteraction(agOwner, cat2.agent.id, { ok: true, verified: false, detail: 'a claimed fill the chain never confirmed' });
t('§A2 an unverified interaction builds no reputation in either direction',
  uncounted.counted === false && /VERIFIED/.test(uncounted.reason));
for (let i = 0; i < 3; i += 1) await registry.recordInteraction(agOwner, cat2.agent.id, { ok: true, verified: true, detail: `fill ${i}` });
const afterThree = await registry.get(agOwner, cat2.agent.id);
t('§A2 three verified successes earn the reputation band: 90, HIGH_TRUST',
  afterThree.record.trust.score === 90 && afterThree.record.trust.tier === 'HIGH_TRUST', afterThree.record?.trust);
const nowAuth = await registry.authorize(agOwner, cat2.agent.id, { scope: 'council-vote' });
t('§A2 at the TRUSTED floor the authorization is granted', nowAuth.ok && nowAuth.agent.authorizedScopes.includes('council-vote'));
const scopeRefused = await registry.authorize(agOwner, cat2.agent.id, { scope: 'withdraw-funds' });
t('§A2 there is no execution scope to grant an agent', scopeRefused.code === 'UNKNOWN_SCOPE', scopeRefused.code);
await registry.recordInteraction(agOwner, cat2.agent.id, { ok: false, verified: true, detail: 'a bad fill' });
const afterFail = await registry.get(agOwner, cat2.agent.id);
t('§A2 a verified failure costs double a success (3−2·1)/4·25',
  afterFail.record.trust.score === 71.25 && afterFail.record.trust.tier === 'TRUSTED', afterFail.record?.trust);
const seat2 = await registry.forCompetition(agOwner, cat2.agent.id);
t('§A2 the competition seat is the exact competition shape',
  seat2.ok && seat2.externalAgent.authorized === true && typeof seat2.externalAgent.trust.score === 'number' && seat2.externalAgent.trust.expired === false && seat2.externalAgent.passport.id === 'ext-good-2');
const rev2 = await registry.revoke(agOwner, cat2.agent.id, { reason: 'user lost confidence' });
t('§A2 revocation clears every scope', rev2.ok && rev2.agent.authorizedScopes.length === 0);
const afterRevoke = await registry.recordInteraction(agOwner, cat2.agent.id, { ok: true, verified: true });
t('§A2 a revoked agent takes no further credit', afterRevoke.code === 'AGENT_REVOKED', afterRevoke.code);
const perfect = computeAgentTrustScore({
  passport: { id: 'p', expiresAt: null, sandbox: { stage: 'production', productionReady: true, completedStages: [...EXTERNAL_AGENT_SANDBOX_STAGES] } },
  security: { ok: true, failures: [] },
  interactions: { success: 10, failure: 0, samples: [] }
});
t('§A2 the score is capped at 95: perfect trust does not exist for software touching money', perfect.score === 90 && perfect.cap === 95 && perfect.tier === 'HIGH_TRUST', perfect);
const all = await registry.list(agOwner);
t('§A2 the registry lists every agent with its live trust', all.ok && all.count === 3 && all.agents.every((a) => typeof a.trust.score === 'number' && a.canExecute === false));

/* ══════════════════════  LEARNING  ══════════════════════ */

const lrn1 = 'learn-1';
const unverified = await learning.learn(lrn1, { execution: { executionId: 'run_1', strategyId: 'strat-dca', verified: false, kind: 'DCA_IN', amountUsd: 1000, pnlUsd: 40 } });
t('§L1 an unverified outcome learns nothing', unverified.code === 'OUTCOME_NOT_VERIFIED', unverified.code);
const l1 = await learning.learn(lrn1, {
  execution: {
    executionId: 'run_1', strategyId: 'strat-dca', verified: true, verificationId: 'ver_1',
    kind: 'DCA_IN', asset: 'ETH', riskLevel: 'MODERATE',
    amountUsd: 1000, pnlUsd: 40, feesUsd: 1, slippagePct: 0.9, gasUsd: 4,
    expected: { returnPct: 5, feeUsd: 1.2 }, decisionId: 'dec_x'
  }
});
t('§L1 a verified completion learns into memory, behavior and the record',
  l1.ok && l1.record.lessons.length >= 2 && l1.record.grantsExecution === false, l1.record?.lessons);
t('§L1 the prediction-vs-actual pair is computed, not guessed',
  l1.record.expectedReturnPct === 5 && l1.record.actualReturnPct === 4 && l1.record.deltaPct === -1, l1.record);
const memOutcomes = await memory.outcomes(lrn1, { limit: 10 });
t('§L1 the outcome landed in the strategy-outcome store, expectation included',
  memOutcomes.rows.length === 1 && memOutcomes.rows[0].kind === 'DCA_IN' && memOutcomes.rows[0].expected?.feeUsd === 1.2, memOutcomes.rows[0]);
t('§L1 the genome was not built, so the lesson says no evolution instead of one',
  l1.lessons.some((x) => /genome not built/i.test(x)), l1.lessons);

const gRebuild = await genome.rebuild(lrn1, { goals: ['Reach 40k'] });
const gBefore = gRebuild.ok ? (await genome.get(lrn1)).genome.vector.values.automationPreference : null;
const l2 = await learning.learn(lrn1, {
  execution: { executionId: 'run_2', strategyId: 'strat-dca', verified: true, verificationId: 'ver_2', kind: 'DCA_IN', asset: 'ETH', amountUsd: 1000, pnlUsd: -10, expected: { returnPct: 3 } }
});
const gAfter = (await genome.get(lrn1)).genome.vector.values.automationPreference;
t('§L1 with the genome rebuilt, an unfavorable verified DCA dampens exactly its mapped dimension',
  l2.ok && gBefore !== null && gAfter === gBefore - 5 && l2.lessons.some((x) => /automationPreference/.test(x)),
  { gBefore, gAfter, lessons: l2.lessons });

t('§L1 calibration below the sample floor is a stated minimum, not a number', (await learning.calibration(lrn1)).directionHitRate === null);
await learning.learn(lrn1, {
  execution: { executionId: 'run_3', strategyId: 'strat-y', verified: true, verificationId: 'ver_3', kind: 'YIELD_ON_IDLE', amountUsd: 1000, pnlUsd: 50, expected: { returnPct: 3 } }
});
await learning.learn(lrn1, {
  execution: { executionId: 'run_4', strategyId: 'strat-z', verified: true, verificationId: 'ver_4', kind: 'DCA_IN', amountUsd: 1000, pnlUsd: -10, expected: { returnPct: 2 } }
});
const cal = await learning.calibration(lrn1);
/* pairs: (5,4) hit · (3,−1) miss · (3,5) hit · (2,−1) miss → 2/4, mae (1+4+2+3)/4 */
t('§L1 verified (expected, actual) pairs yield a direction hit rate and an honest MAE',
  cal.samples === 4 && cal.directionHitRate === 0.5 && cal.maePct === 2.5, cal);

const lrn2 = 'learn-2';
for (let i = 0; i < 3; i += 1) {
  await learning.learn(lrn2, {
    execution: { executionId: `run_f${i}`, strategyId: `strat-f${i}`, verified: true, verificationId: `ver_f${i}`, kind: 'DCA_IN', amountUsd: 500, pnlUsd: 20, feesUsd: 1, slippagePct: 0.9, expected: { feeUsd: 1.2 } }
  });
}
const lFees = await learning.history(lrn2, { limit: 5 });
t('§L2 cheap verified fills infer fee sensitivity into the preference model',
  lFees.outcomes.length === 3 && lFees.outcomes[0].lessons.some((x) => /feeSensitivity inferred/.test(x)), lFees.outcomes[0]?.lessons);
const lrnPrefs = await preferences.resolve(lrn2);
t('§L2 the inferred preference is resolvable and marked AI_INFERRED origin', lrnPrefs.feeSensitivity === 'HIGH' && lrnPrefs.origins.feeSensitivity === 'AI_INFERRED', lrnPrefs);

process.env.LEARNING_ENGINE_ENABLED = 'false';
const flagOff = await learning.learn('learn-3', { execution: { executionId: 'r', strategyId: 's', verified: true, verificationId: 'v', kind: 'DCA_IN' } });
process.env.LEARNING_ENGINE_ENABLED = 'true';
t('§L2 the learning engine is opt-in: with the flag off it refuses', flagOff.code === 'FEATURE_DISABLED' && flagOff.flag === 'LEARNING_ENGINE_ENABLED', flagOff);

/* ── summary ─────────────────────────────────────────────────────────────── */
console.log('');
console.log(`  ${passed}/${passed + failed} passed`);
if (failed) {
  console.log(`  FAILED: ${failures.join(' | ')}`);
  process.exitCode = 1;
}
const dir = `./${process.env.TEMP_DIR}`;
try { rmSync(dir, { recursive: true, force: true }); } catch { /* test tmp dir */ }
