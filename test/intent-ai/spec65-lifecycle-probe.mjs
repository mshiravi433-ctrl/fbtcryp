/* Spec 65 — Priorities 5–6: Parallel strategies (25), Goal Progress/Tree
 * (41–42), Chat Replay (48), Disaster/Smart Pause (35–36), Dynamic route
 * switching (33), Intent expiration non-executable (39) and a recurring
 * scheduler that never signs (40). */
import {
  allocateParallelCapital,
  goalProgress,
  buildGoalTree,
  buildSessionReplay,
  evaluateDisasterMode,
  smartPause,
  evaluateRouteSwitch,
  createRecurringIntent,
  prepareRecurringRun,
  createLiveIntent,
  transitionLiveIntent,
  finalResult
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  // ── 25: Parallel strategies — fail-closed on policy incompatibility ────
  const okSplit = allocateParallelCapital({
    capitalUsd: 1000,
    allocations: [
      { strategyId: 'dex-route', weightPct: 50, riskPct: 30, evidence: [{}] },
      { strategyId: 'defi-route', weightPct: 50, riskPct: 40, evidence: [{}] }
    ],
    riskPolicy: { maxCapitalPerStrategyPct: 60, maxRiskPerStrategyPct: 50, maxPortfolioRiskPct: 40 },
    now
  });
  check('a policy-compatible split allocates bounded amounts', okSplit.ok && okSplit.allocations.length === 2 && okSplit.allocations[0].amountUsd === 500 && okSplit.executionAuthorized === false);
  const overSplit = allocateParallelCapital({
    capitalUsd: 1000,
    allocations: [
      { strategyId: 'dex-route', weightPct: 70, riskPct: 30, evidence: [{}] },
      { strategyId: 'defi-route', weightPct: 50, riskPct: 20, evidence: [{}] }
    ],
    riskPolicy: {}, now
  });
  check('over-allocation (>100%) is fail-closed', overSplit.ok === false && overSplit.code === 'POLICY_INCOMPATIBLE');
  const riskySplit = allocateParallelCapital({
    capitalUsd: 1000,
    allocations: [{ strategyId: 'perp-route', weightPct: 100, riskPct: 80, evidence: [{}] }],
    riskPolicy: { maxRiskPerStrategyPct: 50 }, now
  });
  check('a strategy above the risk cap cannot receive capital', riskySplit.ok === false && riskySplit.code === 'POLICY_INCOMPATIBLE');
  const noEvidenceSplit = allocateParallelCapital({
    capitalUsd: 1000,
    allocations: [{ strategyId: 'mystery-route', weightPct: 100, riskPct: 10 }],
    riskPolicy: {}, now
  });
  check('an unevidenced strategy is fail-closed', noEvidenceSplit.ok === false);
  check('allocation moves no funds by itself', okSplit.fundsMoved === false && okSplit.requiresFreshAuthorizationBeforeExecution === true);

  // ── 41: Goal Progress — attested balance or nothing ─────────────────────
  const unattested = goalProgress({ targetCapital: 2000, currentBalance: { valueUsd: 1500, confirmed: false }, capitalUsd: 1000, now });
  check('progress without an attested balance stays null (never fabricated)', unattested.status === 'unattested' && unattested.progressPct === null && unattested.progressComputable === false);
  const attested = goalProgress({ targetCapital: 2000, currentBalance: { valueUsd: 1500, checkedAt: now - 1000, providerId: 'wallet-provider-1', confirmed: true, evidenceId: 'ev-1' }, capitalUsd: 1000, now });
  check('attested balance yields Target/Current/Progress%', attested.status === 'attested' && attested.progressPct === 75 && attested.remainingUsd === 500);

  // ── 42: Goal Tree — a tree is not an execution ──────────────────────────
  const tree = buildGoalTree({
    root: { id: 'root-1', title: 'Grow capital safely', target: 2000 },
    subgoals: [
      { kind: 'capital-growth', id: 'sg-growth', weightPct: 40, target: 2000 },
      { kind: 'risk-control', id: 'sg-risk', weightPct: 30, target: 25 },
      { kind: 'monthly-dca', id: 'sg-dca', weightPct: 20 },
      { kind: 'yield', id: 'sg-yield', weightPct: 10 }
    ], now
  });
  check('goal tree decomposes into bounded weighted sub-goals', tree.ok && tree.subgoals.length === 4 && tree.totalWeightPct === 100);
  check('the tree cannot execute anything', tree.treeIsNotExecution === true && tree.subgoals.every((row) => row.executable === false));
  check('over-weighted trees are rejected', buildGoalTree({ root: { title: 'x' }, subgoals: [{ kind: 'yield', weightPct: 120 }] }).ok === false);

  // ── 48: Chat Replay — structured events only, no private reasoning ──────
  const replay = buildSessionReplay({
    sessionId: 'session-42',
    events: [
      { type: 'decision', actor: 'fbt.strategy', summary: 'Selected balanced route', sequence: 1 },
      { type: 'reason', actor: 'fbt.strategy', summary: 'Lower evidenced cost', sequence: 2 },
      { type: 'warning', actor: 'fbt.risk', summary: 'Slippage near policy cap', sequence: 3 },
      { type: 'strategy-switch', fromStrategyId: 'balanced', toStrategyId: 'conservative', summary: 'User choice after warning', sequence: 4 },
      { type: 'chainOfThought', summary: 'secret internal reasoning', sequence: 5 },
      { type: 'outcome', summary: 'see receipt', sequence: 6 }
    ],
    outcome: { status: 'COMPLETED', verifiedReceipt: true },
    now
  });
  check('replay contains decisions, reasons, warnings and strategy switches', replay.ok && replay.counts.decisions === 1 && replay.counts.warnings === 1 && replay.strategySwitches.length === 1);
  check('private chain-of-thought events are dropped, never replayed', replay.dropped.privateReasoning === 1 && replay.containsPrivateChainOfThought === false);
  check('outcome is stated only from a verified receipt', replay.outcome.verifiedReceipt === true && replay.containsSecrets === false);

  // ── 36: Disaster Mode — evidenced incidents, defensive, never auto-exit ─
  const noIncident = evaluateDisasterMode({ incidents: [], now });
  check('no incident evidence → no disaster assumption', noIncident.mode === 'normal' && noIncident.catastrophizing === false);
  const exploit = evaluateDisasterMode({ incidents: [{ trigger: 'bridge-exploit', source: 'security-feed', observedAt: now - 60000, severity: 'confirmed' }], now });
  check('evidenced bridge exploit switches to a defensive, policy-bound posture', exploit.mode === 'defensive' && exploit.posture[0].haltBridgeRoutes === true && exploit.bypassesGuardian === false && exploit.autoExit === false && exploit.autoSell === false);
  const rumor = evaluateDisasterMode({ incidents: [{ trigger: 'oracle-failure', source: 'someone-said', observedAt: now - 60000, severity: 'suspected' }], now });
  check('a suspected incident pends confirmation instead of seizing control', rumor.status === 'defensive-pending-confirmation');
  check('unknown trigger strings are ignored', evaluateDisasterMode({ incidents: [{ trigger: 'vibes', source: 'x', observedAt: now }] }).mode === 'normal');

  // ── 35: Smart Pause — pause ≠ permission to continue ────────────────────
  const pause = smartPause({ anomaly: { description: 'Spread widened beyond normal band' }, critical: false, now });
  check('non-critical anomaly pauses for re-evaluation instead of forced exit', pause.action === 'PAUSE_FOR_RE_EVALUATION' && pause.paused === true && pause.immediateExitForced === false);
  check('pause is explicitly not a permission to continue', pause.pauseIsPermissionToContinue === false && pause.resumeRequires.includes('RE_EVALUATION'));
  const critical = smartPause({ anomaly: { description: 'Oracle price deviates wildly' }, critical: true, now });
  check('a critical anomaly escalates to disaster-mode review', critical.action === 'ESCALATE_TO_DISASTER_MODE');

  // ── 33: Dynamic Route Switching — material delta needs re-authorization ─
  const noFailure = evaluateRouteSwitch({ currentRouteId: 'route-1', venueFailure: null, alternatives: [{ routeId: 'route-2', healthy: true, extraCostPct: 1 }], now });
  check('without failure evidence nothing switches — review only', noFailure.status === 'review-required' && noFailure.switched === false);
  const materialSwitch = evaluateRouteSwitch({
    currentRouteId: 'route-1',
    venueFailure: { venueId: 'dex-a', observedAt: now - 60000, source: 'venue-health' },
    alternatives: [{ routeId: 'route-2', healthy: true, extraCostPct: 9, extraRiskPct: 2, evidence: [{}] }],
    executedSteps: 2, now
  });
  check('a mid-execution material-delta switch requires re-authorization', materialSwitch.status === 'switch-proposed' && materialSwitch.recommendedAlternative.routeId === 'route-2' && materialSwitch.reAuthorizationRequired === true && materialSwitch.executionAuthorized === false);
  const trivialSwitch = evaluateRouteSwitch({
    currentRouteId: 'route-1',
    venueFailure: { venueId: 'dex-a', observedAt: now - 60000, source: 'venue-health' },
    alternatives: [{ routeId: 'route-2', healthy: true, extraCostPct: 0.5, extraRiskPct: 0, evidence: [{}] }],
    executedSteps: 0, now
  });
  check('a non-material pre-execution switch still needs policy review', trivialSwitch.reAuthorizationRequired === false && trivialSwitch.switched === false);
  const deadEnd = evaluateRouteSwitch({
    currentRouteId: 'route-1',
    venueFailure: { venueId: 'dex-a', observedAt: now - 60000, source: 'venue-health' },
    alternatives: [{ routeId: 'route-2', healthy: false }], now
  });
  check('no healthy alternative → paused review, not a forced bad route', deadEnd.status === 'no-healthy-alternative');

  // ── 39: Expired intents are not executable ──────────────────────────────
  const intent = createLiveIntent({ id: 'intent-exp-1', intent: { id: 'intent-exp-1' }, expiresAt: now + 1000, now: now - 2000 });
  const pending = transitionLiveIntent(intent.intent, 'PENDING', { reason: 'REVIEWED', now: now - 1000 });
  const expired = transitionLiveIntent(pending.intent, 'PARTIAL', { reason: 'WORK', now: now + 5000 });
  check('a passed-expiry intent is force-transitioned to EXPIRED', expired.ok === true && expired.intent.status === 'EXPIRED');
  check('an expired intent cannot complete without evidence, ever', finalResult({ ...expired.intent, status: 'EXPIRED' }).final === false);

  // ── 40: The scheduler prepares, it never signs or submits ───────────────
  const recurring = createRecurringIntent({ id: 'dca-1', intent: { id: 'dca-1' }, schedule: { intervalMs: 86_400_000, firstRunAt: now + 1000 }, expiresAt: now + 30 * 86_400_000, maxRuns: 10, now });
  check('recurring intent exists with explicit per-run authorization required', recurring.ok && recurring.recurring.userAuthorizationPerRun === true && recurring.recurring.executionAuthorized === false);
  const unsigned = await prepareRecurringRun(recurring.recurring, { now: now + 2_000_000, userAuthorized: false });
  check('a due run without user authorization is refused — scheduler cannot sign', unsigned.ok === false && unsigned.code === 'USER_AUTHORIZATION_REQUIRED');
  const noPolicy = await prepareRecurringRun(recurring.recurring, { now: now + 2_000_000, userAuthorized: true });
  check('a due run without a fresh policy recheck is unavailable — not run blind', noPolicy.ok === false && noPolicy.code === 'POLICY_RECHECK_UNAVAILABLE');
  const prepared = await prepareRecurringRun(recurring.recurring, { now: now + 2_000_000, userAuthorized: true, policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY', policyVersion: 'pv-1' }) });
  check('a prepared run is a review artifact: prepared, never submitted', prepared.ok && prepared.run.userAuthorized === true && prepared.run.executionAuthorized === false && prepared.nextRecurring.runCount === 1);
  const early = await prepareRecurringRun(recurring.recurring, { now: now + 500, userAuthorized: true, policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY' }) });
  check('a run before its scheduled time is not prepared', early.ok === false && early.code === 'RECURRING_NOT_DUE');

  console.log(JSON.stringify({ probe: 'spec65-lifecycle', passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'spec65-lifecycle', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}
export default results;
