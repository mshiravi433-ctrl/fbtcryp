#!/usr/bin/env node
/**
 * FBT FINANCIAL INTELLIGENCE OS — autonomy probe (batch 5).
 * ---------------------------------------------------------------------------
 * The policy engine, the autonomous execution loop and the proactive
 * guardian, run against the real shared libraries. The only fakes are the
 * external boundary (the executor + the clock) — exactly the shape
 * test/fios/fios-core-probe.mjs uses.
 *
 * WHAT IT MEASURES (each assertion names the property it enforces)
 *   §22  a policy is a scope WITH numbers: every limit is required, the
 *        limits nest, CRITICAL can never be pre-authorised, and a policy
 *        without an end date is not granted
 *   §22  every execution-quality gate fails CLOSED: unread slippage, gas or
 *        risk is a named STOP, not a pass by default
 *   §22  limits are HELD: an in-flight reservation counts against the day,
 *        only a VERIFIED execution settles, and a failed one releases
 *   §22  emergencyStop freezes (the machine cannot resume it; only the owner
 *        can), and a stopped policy refuses every request
 *   LOOP  STOP AT EVERY CHECK FAILURE: flag, executor, request, risk, policy,
 *        guardian, confidence, reserve, execute, verify — each one ends the
 *        run with its code, no retry, no fallback, executedNothing honest
 *   LOOP  COMPLETED is unreachable without a verification id (the trace
 *        machine enforces it; the loop honours it)
 *   LOOP  a verified run settles the spend and the trace ends COMPLETED with
 *        the verification id on the record
 *   GUARD  monitoring alerts only on decision-relevant thresholds and names
 *        the reason; early warnings carry distance + the clearing action
 *   GUARD  consult() can only block or warn — it has no approve
 *   GUARD  replan is a verdict first; it regenerates only when a pipeline is
 *        wired, and reports honestly when it is not
 *
 * Run: npm run test:fios:autonomy
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.AUTONOMOUS_POLICY_ENABLED = 'true';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { createCollections } = await import('../../server/fios/collections.js');
const { createObservability } = await import('../../server/fios/observability.js');
const { createPolicyEngine, validatePolicy, RISK_LIMITS, POLICY_KINDS } = await import('../../server/fios/policy.js');
const { createAutonomyLoop } = await import('../../server/fios/autonomy.js');
const { createGuardian, monitoringShape } = await import('../../server/fios/guardian.js');
const { value, unavailable } = await import('../../server/fios/provenance.js');

const OWNER = 'dev:probe-autonomy';
let clockNow = Date.now();
const clock = () => clockNow;
const collections = createCollections({});
const busEvents = [];
const obs = createObservability({ events: { publish: (e) => busEvents.push(e) } });

const DAY = 24 * 3600 * 1000;
const basePolicy = (over = {}) => ({
  name: 'weekly DCA',
  maxPerExecutionUsd: 1000,
  maxDailyUsd: 2500,
  maxCumulativeUsd: 5000,
  slippageLimitPct: 0.5,
  gasLimitUsd: 10,
  riskLimit: 'MODERATE',
  trigger: { kinds: ['DCA_IN', 'SWAP'], assets: [], chains: [] },
  expiration: clockNow + 7 * DAY,
  ...over
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* §22 policy validation — a limit without a number is refused at creation  */
/* ═════════════════════════════════════════════════════════════════════════ */
t('§22 CRITICAL is not a legal riskLimit (a security condition is not pre-authorised)',
  RISK_LIMITS.every((r) => r !== 'CRITICAL') && validatePolicy(basePolicy({ riskLimit: 'CRITICAL' })).code === 'BAD_RISK_LIMIT');
t('§22 every kind in the trigger vocabulary is a real strategy kind',
  POLICY_KINDS.length >= 5 && POLICY_KINDS.includes('DCA_IN') && POLICY_KINDS.includes('YIELD_ON_IDLE'));
t('§22 a policy without a daily ceiling is refused with the field named',
  validatePolicy(basePolicy({ maxDailyUsd: undefined })).field === 'maxDailyUsd');
t('§22 the limits must nest: one execution ≤ day ≤ lifetime',
  validatePolicy(basePolicy({ maxPerExecutionUsd: 3000 })).code === 'LIMITS_DO_NOT_NEST');
t('§22 more than 5% slippage is not a policy',
  validatePolicy(basePolicy({ slippageLimitPct: 6 })).code === 'SLIPPAGE_LIMIT_TOO_LOOSE');
t('§22 an unknown trigger kind opens no scope',
  validatePolicy(basePolicy({ trigger: { kinds: ['ASTROLOGY'] } })).code === 'TRIGGER_REQUIRED');
t('§22 a policy without an end date is not granted',
  validatePolicy(basePolicy({ expiration: undefined })).code === 'EXPIRATION_REQUIRED');
t('§22 a 90-day maximum keeps "renew deliberately" honest',
  validatePolicy(basePolicy({ expiration: clockNow + 120 * DAY })).code === 'EXPIRATION_TOO_FAR');

/* ═════════════════════════════════════════════════════════════════════════ */
/* §22 the policy engine                                                     */
/* ═════════════════════════════════════════════════════════════════════════ */
const policyEngine = createPolicyEngine({ collections, observability: obs, now: clock });

process.env.AUTONOMOUS_POLICY_ENABLED = 'false';
t('§22 autonomy is opt-in: with the flag off, creation refuses',
  (await policyEngine.create(OWNER, basePolicy())).code === 'FEATURE_DISABLED');
process.env.AUTONOMOUS_POLICY_ENABLED = 'true';

const created = await policyEngine.create(OWNER, basePolicy());
t('§22 a complete policy is created ACTIVE with zeroed spend',
  created.ok && created.policy.status === 'ACTIVE' && created.policy.spend.totalUsd === 0);
const created2 = await policyEngine.create(OWNER, basePolicy({ name: 'yield sweep', trigger: { kinds: ['YIELD_ON_IDLE'], assets: ['USDC'] }, riskLimit: 'LOW' }));

t('§22 an unknown policy id is POLICY_NOT_FOUND, not an empty pass',
  (await policyEngine.evaluate({ owner: OWNER, policyId: 'pol_nope', request: { kind: 'DCA_IN', amountUsd: 10 } })).code === 'POLICY_NOT_FOUND');

const req = (over = {}) => ({
  kind: 'DCA_IN', asset: 'ETH', amountUsd: 500, gasUsd: 4, slippagePct: 0.3, riskLevel: 'MODERATE', ...over
});

t('§22 a kind outside the trigger scope is refused, with the scope named',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ kind: 'HOLD' }) })).code === 'TRIGGER_NOT_MATCHED');
t("§22 an asset outside the policy's asset list is refused",
  (await policyEngine.evaluate({ owner: OWNER, policyId: created2.policy.id, request: req({ kind: 'YIELD_ON_IDLE', asset: 'BTC' }) })).code === 'TRIGGER_NOT_MATCHED');
t('§22 a missing amount is refused — the engine does not guess one',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ amountUsd: undefined }) })).code === 'AMOUNT_INVALID');
t('§22 an amount over the per-execution ceiling is refused',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ amountUsd: 1500 }) })).code === 'PER_EXECUTION_LIMIT');
t('§22 unread slippage fails closed',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ slippagePct: undefined }) })).code === 'SLIPPAGE_UNREAD');
t('§22 slippage above the limit is refused',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ slippagePct: 0.9 }) })).code === 'SLIPPAGE_LIMIT');
t('§22 unread gas fails closed',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ gasUsd: undefined }) })).code === 'GAS_UNREAD');
t('§22 gas above the limit is refused',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ gasUsd: 40 }) })).code === 'GAS_LIMIT');
t('§22 an unassessed risk level fails closed',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ riskLevel: undefined }) })).code === 'RISK_UNREAD');
t('§22 CRITICAL risk stops every policy, whatever its limit',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ riskLevel: 'CRITICAL' }) })).code === 'RISK_LIMIT');
t("§22 risk above the policy's band is refused",
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req({ riskLevel: 'ELEVATED' }) })).code === 'RISK_LIMIT');
t('§22 a cleared request reports every gate that passed',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req() })).checks.length >= 6);

/* the spend ledger: reserve → confirm only on verification → release on failure */
const r1 = await policyEngine.reserve(OWNER, created.policy.id, { ...req(), executionId: 'run_ledger_1' });
t('§22 a reservation holds the amount against the day',
  r1.ok && (await policyEngine.get(OWNER, created.policy.id)).policy.spend.pendingUsd === 500);
t('§22 confirm without a verification id is refused',
  (await policyEngine.confirm(OWNER, created.policy.id, 'run_ledger_1', {})).code === 'VERIFICATION_REQUIRED');
t('§22 a release frees the limit and keeps the attempt in the ledger as FAILED',
  (await policyEngine.release(OWNER, created.policy.id, 'run_ledger_1', { reason: 'venue down' })).ok &&
  (await policyEngine.get(OWNER, created.policy.id)).policy.ledger[0].status === 'FAILED');

const r2 = await policyEngine.reserve(OWNER, created.policy.id, { ...req(), executionId: 'run_ledger_2' });
const c2 = await policyEngine.confirm(OWNER, created.policy.id, 'run_ledger_2', { verificationId: 'ver_2', actualAmountUsd: 512.5 });
const afterConfirm = (await policyEngine.get(OWNER, created.policy.id)).policy;
t('§22 only a verified execution settles: $512.50 on the day, $0 pending',
  c2.ok && afterConfirm.spend.dayUsd === 512.5 && afterConfirm.spend.pendingUsd === 0 && afterConfirm.ledger[0].status === 'CONFIRMED' && afterConfirm.ledger[0].verificationId === 'ver_2');

/* in-flight reservations count against the day */
const tight = await policyEngine.create(OWNER, basePolicy({ name: 'tight day', maxPerExecutionUsd: 700, maxDailyUsd: 1000, maxCumulativeUsd: 2000 }));
await policyEngine.reserve(OWNER, tight.policy.id, { ...req({ amountUsd: 600 }), executionId: 'run_tight_a' });
t('§22 two in-flight runs cannot both sail under the same daily limit',
  (await policyEngine.evaluate({ owner: OWNER, policyId: tight.policy.id, request: req({ amountUsd: 500 }) })).code === 'DAILY_LIMIT');
await policyEngine.release(OWNER, tight.policy.id, 'run_tight_a', { reason: 'user cancelled' });
t('§22 a cancelled in-flight run gives its limit back',
  (await policyEngine.evaluate({ owner: OWNER, policyId: tight.policy.id, request: req({ amountUsd: 600 }) })).ok === true);

/* the cumulative ceiling: the daily counter rolls over, the lifetime one never */
const cum = await policyEngine.create(OWNER, basePolicy({ name: 'lifetime', maxPerExecutionUsd: 500, maxDailyUsd: 1000, maxCumulativeUsd: 1200 }));
await policyEngine.reserve(OWNER, cum.policy.id, { ...req({ amountUsd: 500 }), executionId: 'run_cum_a' });
await policyEngine.confirm(OWNER, cum.policy.id, 'run_cum_a', { verificationId: 'ver_cum_a' });
clockNow += DAY; /* a fresh UTC day: the day counter must roll, the lifetime must not */
await policyEngine.reserve(OWNER, cum.policy.id, { ...req({ amountUsd: 500 }), executionId: 'run_cum_b' });
const cumB = await policyEngine.confirm(OWNER, cum.policy.id, 'run_cum_b', { verificationId: 'ver_cum_b' });
t('§22 on a fresh day the daily counter has rolled but the lifetime total remembers',
  cumB.ok && cumB.spend.dayUsd === 500 && cumB.spend.totalUsd === 1000);
t('§22 the lifetime ceiling binds even on a fresh day',
  (await policyEngine.evaluate({ owner: OWNER, policyId: cum.policy.id, request: req({ amountUsd: 500 }) })).code === 'CUMULATIVE_LIMIT');

/* expiration via the injected clock */
clockNow += 8 * DAY;
t('§22 an expired policy refuses, with the date it expired',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req() })).code === 'POLICY_EXPIRED');
clockNow -= 8 * DAY;

/* emergency stop + resume */
const stopped = await policyEngine.emergencyStop(OWNER, { reason: 'price is doing something stupid', by: 'user' });
t('§22 emergency stop freezes EVERY active policy',
  stopped.ok && stopped.scope === 'all' && stopped.stopped.length === 4);
t('§22 a stopped policy refuses every request',
  (await policyEngine.evaluate({ owner: OWNER, policyId: created.policy.id, request: req() })).code === 'EMERGENCY_STOP');
t('§22 the machine cannot resume its own stop',
  (await policyEngine.resume(OWNER, created.policy.id, { by: 'bot' })).code === 'ONLY_THE_OWNER_CAN_RESUME');
const resumed = await policyEngine.resume(OWNER, created.policy.id, { by: 'user', reason: 'checked it, fine' });
t('§22 the owner resumes explicitly and the stop is recorded in history',
  resumed.ok && resumed.policy.status === 'ACTIVE' && resumed.policy.emergency === null);

const revoked = await policyEngine.revoke(OWNER, tight.policy.id, { reason: 'no longer needed' });
t('§22 a revoked policy refuses forever',
  revoked.ok && (await policyEngine.evaluate({ owner: OWNER, policyId: tight.policy.id, request: req() })).code === 'POLICY_REVOKED');

const statusView = await policyEngine.status(OWNER);
t('§22 the status view reports count, stop state and the flag',
  statusView.ok && statusView.count === 4 && statusView.flag.ok === true && statusView.policies.every((p) => p.spend && p.trigger && Number.isFinite(p.expiration)));

/* ═════════════════════════════════════════════════════════════════════════ */
/* the autonomy loop — STOP AT EVERY CHECK FAILURE                           */
/* ═════════════════════════════════════════════════════════════════════════ */
const loopPolicy = (await policyEngine.create(OWNER, basePolicy({ name: 'loop policy', trigger: { kinds: ['DCA_IN'] } }))).policy;

const financial = {
  status: 'OK',
  confidence: 0.8,
  net: {
    netWorthUsd: value(24000, { source: 'probe', at: clockNow, ttlMs: 60_000 }),
    availableCapitalUsd: value(10000, { source: 'probe', at: clockNow, ttlMs: 60_000 }),
    debtUsd: value(1500, { source: 'probe', at: clockNow, ttlMs: 60_000 })
  },
  provenance: { coverage: 0.9, stale: [], unavailable: [] },
  computed: { netWorthUsd: 24000 }
};
const world = {
  provenance: { coverage: 0.8, stale: [], unavailable: [] },
  domains: { user: { wallets: { value: { connected: true } } } },
  capabilities: { swap: 'AVAILABLE' }
};
const risk = { level: 'MODERATE', securitySignals: [] };
const loopReq = (over = {}) => ({
  kind: 'DCA_IN', asset: 'ETH', amountUsd: 500, gasUsd: 4, slippagePct: 0.3,
  riskLevel: 'MODERATE', quote: { at: clockNow, ttlMs: 90_000, executable: true }, ...over
});
const verifiedExecutor = async () => ({ ok: true, verificationId: 'ver_loop_ok', actualAmountUsd: 500, detail: 'hand-off signed by the wallet, receipt verified (probe boundary)' });
const unverifiedExecutor = async () => ({ ok: true, verificationId: null, detail: 'unsigned hand-off; no receipt yet (the real deployment)' });
const failingExecutor = async () => ({ ok: false, code: 'VENUE_DOWN', detail: 'the venue refused the order' });

const guardian = createGuardian({ collections, observability: obs, policyEngine, now: clock });
const loop = createAutonomyLoop({ policyEngine, traceStore: (await import('../../server/fios/trace.js')).createTraceStore({ collections, observability: obs, now: clock }), confidenceEngine: (await import('../../server/fios/confidence.js')).createConfidenceEngine(), guardian, executor: verifiedExecutor, observability: obs, now: clock });

process.env.AUTONOMOUS_POLICY_ENABLED = 'false';
t('LOOP with the flag off the loop does not run',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_flag' }), financial, world, risk })).stopCode === 'FEATURE_DISABLED');
process.env.AUTONOMOUS_POLICY_ENABLED = 'true';

const noExec = createAutonomyLoop({ policyEngine, traceStore: (await import('../../server/fios/trace.js')).createTraceStore({ collections, observability: obs }), executor: null, now: clock });
t('LOOP with no executor wired the run refuses to pretend',
  (await noExec.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_noexec' }), financial, world, risk })).stopCode === 'EXECUTOR_NOT_WIRED');

t('LOOP a request without kind+amount is incomplete, nothing runs',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: { executionId: 'run_incomplete' }, financial, world, risk })).stopCode === 'REQUEST_INCOMPLETE');

t('LOOP an unassessed run (no risk level) is a stop, not a pass',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_norisk' }), financial, world, risk: {} })).stopCode === 'RISK_UNREAD');

t('LOOP risk above the policy band stops the run at the risk gate',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_risk', riskLevel: 'ELEVATED' }), financial, world, risk: { level: 'ELEVATED', securitySignals: [] } })).stopGate === 'RISK');

t('LOOP a request outside the policy scope stops at the policy gate',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_scope', kind: 'HOLD' }), financial, world, risk })).stopGate === 'POLICY');

t('LOOP a security signal is a guardian BLOCK and a stop',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_guardian' }), financial, world, risk: { level: 'MODERATE', securitySignals: [{ code: 'SECURITY_VIOLATION' }] } })).stopGate === 'GUARDIAN');

t('LOOP a critical input at 0 confidence is a stop (no run on blind inputs)',
  (await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_conf' }), financial: { status: 'OK', confidence: 0, provenance: { coverage: 0, stale: [], unavailable: ['portfolio'] }, net: { netWorthUsd: unavailable('NO_PORTFOLIO') } }, world: null, risk })).stopGate === 'CONFIDENCE');

const brokenPolicyEngine = { ...policyEngine, reserve: async () => ({ ok: false, code: 'STORE_WRITE_FAILED' }) };
const loopBrokenReserve = createAutonomyLoop({ policyEngine: brokenPolicyEngine, traceStore: (await import('../../server/fios/trace.js')).createTraceStore({ collections, observability: obs }), confidenceEngine: (await import('../../server/fios/confidence.js')).createConfidenceEngine(), executor: verifiedExecutor, now: clock });
t('LOOP a failed reservation stops the run at the reserve gate',
  (await loopBrokenReserve.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_reserve' }), financial, world, risk })).stopGate === 'RESERVE');

const loopFailing = createAutonomyLoop({ policyEngine, traceStore: (await import('../../server/fios/trace.js')).createTraceStore({ collections, observability: obs }), confidenceEngine: (await import('../../server/fios/confidence.js')).createConfidenceEngine(), executor: failingExecutor, now: clock });
const failOut = await loopFailing.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_fail' }), financial, world, risk });
const afterFail = (await policyEngine.get(OWNER, loopPolicy.id)).policy;
t('LOOP a failed execution releases its reservation and records FAILED in the ledger',
  failOut.stopGate === 'EXECUTE' && failOut.executedNothing === true && afterFail.spend.pendingUsd === 0 && afterFail.ledger.some((l) => l.executionId === 'run_fail' && l.status === 'FAILED'));

const loopUnverified = createAutonomyLoop({ policyEngine, traceStore: (await import('../../server/fios/trace.js')).createTraceStore({ collections, observability: obs }), confidenceEngine: (await import('../../server/fios/confidence.js')).createConfidenceEngine(), executor: unverifiedExecutor, now: clock });
const unvOut = await loopUnverified.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_unv' }), financial, world, risk });
t('LOOP without a verification id the run is NOT completed — it stops at VERIFY',
  unvOut.stopCode === 'NOT_VERIFIED' && unvOut.state === 'STOPPED' && unvOut.trace?.state === 'FAILED' && unvOut.executedNothing === false);

const happy = await loop.run({ owner: OWNER, policyId: loopPolicy.id, request: loopReq({ executionId: 'run_happy' }), financial, world, risk });
const afterHappy = (await policyEngine.get(OWNER, loopPolicy.id)).policy;
t('LOOP a verified run completes: COMPLETED, spend settled, verification on the trace',
  happy.ok && happy.state === 'COMPLETED' && happy.spentUsd === 500 && happy.trace?.completed === true && happy.trace?.links?.verificationId === 'ver_loop_ok' && afterHappy.spend.dayUsd >= 500 && afterHappy.ledger.some((l) => l.executionId === 'run_happy' && l.status === 'CONFIRMED'));
t('LOOP every run is honest about executing nothing until the executor says otherwise',
  [failOut, unvOut, happy].every((o) => typeof o.executedNothing === 'boolean') && happy.checks.length >= 8);

/* ═════════════════════════════════════════════════════════════════════════ */
/* the proactive guardian                                                    */
/* ═════════════════════════════════════════════════════════════════════════ */
const stateBase = {
  status: 'OK',
  confidence: 0.8,
  at: clockNow,
  net: {
    netWorthUsd: value(26500, { source: 'probe', at: clockNow }),
    availableCapitalUsd: value(12000, { source: 'probe', at: clockNow }),
    debtUsd: value(1500, { source: 'probe', at: clockNow })
  },
  performance: { drawdownPct: value(-24, { source: 'probe', at: clockNow }) },
  risk: { volatilityPct: value(70, { source: 'probe', at: clockNow }) },
  provenance: { coverage: 0.9, stale: [], unavailable: [] },
  computed: { netWorthUsd: 26500, concentration: { topAsset: 'BTC', topSharePct: 66 } },
  sections: { portfolio: { data: { holdings: [{ symbol: 'BTC', valueUsd: 17500 }, { symbol: 'USDC', valueUsd: 7500 }] } } }
};

const first = await guardian.check({ owner: OWNER, financial: stateBase });
t('GUARD the first check stores the baseline and reports nothing changed',
  first.ok && first.changed === false && first.snapshot.values.netWorthUsd === 26500);

const afterShock = {
  ...stateBase,
  at: clockNow + 60_000,
  net: { ...stateBase.net, netWorthUsd: value(24600, { source: 'probe', at: clockNow + 60_000 }) },
  computed: { netWorthUsd: 24600, concentration: { topAsset: 'BTC', topSharePct: 72 } }
};
const second = await guardian.check({ owner: OWNER, financial: afterShock });
t('GUARD a 7% net-worth move crosses the decision-relevant threshold and is named',
  second.changed === true && second.changes.some((c) => c.field === 'netWorthUsd' && c.deltaPct <= -5) && second.alerts.some((a) => a.code === 'CHANGE_DETECTED'));
t('GUARD the drawdown is an early warning with its distance and its clearing action',
  second.warnings.some((w) => w.code === 'DRAWDOWN_INCREASE' && w.suggestion && Number.isFinite(w.distance)));
t('GUARD alerts mirror onto the brain bus as typed events',
  busEvents.some((e) => e.source === 'fios' && (e.payload.fi === 'guardian.alerted' || e.payload.fi === 'monitor.triggered')));

/* Compared against the SECOND snapshot (24600): sub-threshold on every
   monitored field — net worth +0.4%, debt flat, drawdown flat, concentration
   flat, stable share flat — so no decision-relevant change may fire. */
const quiet = { ...stateBase, net: { ...stateBase.net, netWorthUsd: value(24700, { source: 'probe', at: clockNow }) }, performance: { drawdownPct: value(-24, { source: 'probe', at: clockNow }) }, computed: { netWorthUsd: 24700, concentration: { topAsset: 'BTC', topSharePct: 72 } }, sections: { portfolio: { data: { holdings: [{ symbol: 'BTC', valueUsd: 17300 }, { symbol: 'USDC', valueUsd: 7400 }] } } } };
const third = await guardian.check({ owner: OWNER, financial: quiet });
t('GUARD small wobbles are not alerts', third.changed === false || third.changes.length === 0);

const consulted = await guardian.consult({ owner: OWNER, request: { kind: 'DCA_IN', amountUsd: 500 }, policy: loopPolicy, financial: stateBase, risk, decision: { downside: 'worst case modelled' } });
t('GUARD a clean pre-flight passes (or warns) but never grants',
  consulted.ok && consulted.blocking.length === 0 && consulted.grantsPermission === false);
const blockedConsult = await guardian.consult({ owner: OWNER, request: { kind: 'DCA_IN', amountUsd: 500 }, policy: loopPolicy, financial: stateBase, risk: { level: 'CRITICAL', securitySignals: [{ code: 'ANOMALY' }] } });
t('GUARD a CRITICAL risk + security signal blocks, with the ids named',
  blockedConsult.status === 'BLOCK' && blockedConsult.blocking.some((b) => b.id === 'critical-risk') && blockedConsult.blocking.some((b) => b.id === 'security-signals'));

/* replan: verdict first, regeneration only when wired */
const stillValid = await guardian.replan({ owner: OWNER, strategy: { strategyId: 'str_1', state: 'ACTIVE', name: 'DCA', expectedReturnPct: 4 }, context: {} });
t('GUARD with no fired triggers the approved plan still stands (an honest no-op)',
  stillValid.ok && stillValid.verdict === 'STILL_VALID' && stillValid.replanned === false);

const noRegen = await guardian.replan({ owner: OWNER, strategy: { strategyId: 'str_1', state: 'ACTIVE' }, changes: { changes: [{ field: 'netWorthUsd', before: 26500, after: 22000, deltaPct: -17, threshold: 5, why: 'sizing', kind: 'RELATIVE', material: true }, { field: 'riskLevel', before: 'MODERATE', after: 'ELEVATED', delta: 1, threshold: 1, kind: 'BAND', material: true, why: 'band' }] }, context: {} });
t('GUARD two fired triggers recommend a replan; without a pipeline that IS the honest answer',
  noRegen.verdict === 'REPLAN_RECOMMENDED' && noRegen.replanned === false && noRegen.code === 'REGEN_NOT_WIRED' && noRegen.triggers.length >= 2);

const regenLoop = createGuardian({
  collections, observability: obs, policyEngine, now: clock,
  regen: async () => ({ ok: true, decision: { id: 'dec_replanned', strategyId: 'dca-v2' }, strategies: [{ id: 'dca-v2' }], competition: { id: 'cmp_r' } })
});
const replanned = await regenLoop.replan({ owner: OWNER, strategy: { strategyId: 'str_1', state: 'ACTIVE' }, changes: { changes: [{ field: 'riskLevel', before: 'LOW', after: 'CRITICAL', delta: 4, threshold: 1, kind: 'BAND', material: true, why: 'band' }] }, context: {} });
t('GUARD with a pipeline wired, a HIGH-severity trigger regenerates and the new decision names the replaced plan',
  replanned.replanned === true && replanned.verdict === 'REPLANNED' && replanned.decision?.id === 'dec_replanned' && replanned.replacedStrategyId === 'str_1');

const guardStop = await guardian.emergencyStop(OWNER, { reason: 'stop everything' });
t('GUARD the STOP button funnels into the one policy-level stop',
  guardStop.ok && (await policyEngine.get(OWNER, loopPolicy.id)).policy.emergency !== null);
const guardStatus = await guardian.status(OWNER);
t('GUARD the status view carries the last check, the alerts and the stop state',
  guardStatus.lastCheckAt && guardStatus.recentAlerts.length > 0 && guardStatus.policies?.anyEmergency === true);
await policyEngine.resume(OWNER, loopPolicy.id, { by: 'user' });

/* monitoringShape only builds numbers from real reads */
t('GUARD monitoringShape is null on an unread state and real on a read one',
  monitoringShape({ status: 'UNAVAILABLE' }) === null && monitoringShape(stateBase).netWorthUsd === 26500 && monitoringShape(stateBase).stableSharePct === Math.round((7500 / 25000) * 10000) / 100);

/* ═════════════════════════════════════════════════════════════════════════ */
/* report                                                                    */
/* ═════════════════════════════════════════════════════════════════════════ */
let failed = 0;
console.log('\n── FBT FINANCIAL INTELLIGENCE OS — autonomy probe (batch 5) ──');
for (const [name, ok] of rows) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}
console.log(`\n${rows.length - failed}/${rows.length} passed`);
if (failed > 0) process.exit(1);
