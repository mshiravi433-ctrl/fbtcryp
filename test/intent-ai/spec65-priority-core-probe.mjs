/* Spec 65 — Priority 1: Goal Negotiation, Cost-to-Goal/Net Outcome, Why
 * Permission, and Shadow Paper execution (paper ≠ live). */
import {
  negotiateGoal,
  applyGoalChoice,
  negotiationGrantsExecution,
  computeCostToGoal,
  predictNetOutcome,
  whyThisDecision,
  whyThisPermission,
  createShadowRun,
  advanceShadowRun,
  paperToRealRequirements,
  CAPABILITY_SCANNER_SCHEMA,
  scanCapabilities
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  // ── 59: Goal Negotiation ────────────────────────────────────────────────
  const absurd = negotiateGoal({ capital: 1000, targetPct: 50, durationHrs: 24 }, { now });
  check('an unrealistic +50%/24h goal is NEGOTIATE (rejected), not accepted', absurd.ok && absurd.decision === 'NEGOTIATE' && absurd.targetRejected === true);
  check('rejection states reasons and the three bounded options', absurd.reasons.length > 0 && absurd.options.map((o) => o.choice).join(',').includes('KEEP_TARGET') && absurd.options.every((o) => o.grantsExecution === false));
  const modest = negotiateGoal({ capital: 1000, targetPct: 2, durationHrs: 24 * 30 }, { now });
  check('a modest goal is ACKNOWLEDGE without rejection', modest.ok && modest.decision === 'ACKNOWLEDGE' && modest.targetRejected === false);
  const choice = applyGoalChoice(absurd, 'EXTEND_DURATION');
  check('applying a choice records it but authorizes no execution', choice.ok && choice.choice === 'EXTEND_DURATION' && choice.executionAuthorized === false && choice.guardianPrecheckStillRequired === true);
  check('accepted/negotiated goals never grant execution', negotiationGrantsExecution(absurd) === false && negotiationGrantsExecution(choice) === false);
  check('secret-bearing goal input is rejected', negotiateGoal({ capital: 1000, targetPct: 5, durationHrs: 24, seedPhrase: 'abandon abandon abandon' }).ok === false);
  check('unknown choice is rejected', applyGoalChoice(absurd, 'AUTO_YOLO').ok === false);

  // ── 30: Cost-to-Goal ────────────────────────────────────────────────────
  const partial = computeCostToGoal({
    capitalUsd: 1000, targetUsd: 1100,
    costs: { swap: 3, gas: 2, bridge: null, funding: null, spread: 1.5, slippage: 2, performance: 0, externalAgent: null },
    costEvidence: { performance: true },
    now
  });
  check('known costs are summed; unknown costs are unavailable, never zero', partial.ok && partial.status === 'partial' && partial.unknownCostClasses.includes('bridge') && partial.unknownCostClasses.includes('externalAgent'));
  check('net remainder is flagged as a lower bound while costs are unknown', partial.netIsLowerBound === true && partial.totalKnownCostUsd === 8.5);
  const nothing = computeCostToGoal({ capitalUsd: 1000, targetUsd: 1100, costs: {}, now });
  check('with zero evidenced costs the report is unavailable, not free', nothing.ok === false || nothing.status === 'unavailable');
  check('cost report carries no execution permission', partial.executionAuthorized === false && partial.financialExecutionAuthorized === false);

  // ── 31: Net Outcome Predictor ───────────────────────────────────────────
  const net = predictNetOutcome({ grossOutputUsd: 1100, costs: { swap: 3, gas: 2, spread: 1.5, slippage: 2, performance: 0 }, costEvidence: { performance: true }, now });
  check('Expected Net = Gross − evidenced costs (1091.5)', net.ok && net.expectedNetUsd === 1091.5);
  check('no profit is ever promised', net.profitPromised === false && net.disclaimers.includes('NOT_GUARANTEED'));
  const netPartial = predictNetOutcome({ grossOutputUsd: 1100, costs: { swap: 3 }, now });
  check('missing cost classes keep the net a lower bound', netPartial.status === 'partial' && netPartial.netIsLowerBound === true && netPartial.unknownCostClasses.length > 0);

  // ── 49: Why This Decision ───────────────────────────────────────────────
  const why = whyThisDecision({
    action: 'select-route-A', decision: 'Route A has evidenced lower cost and adequate liquidity.',
    evidence: [{ source: 'dex-quote', observedAt: now, quality: 0.8 }],
    costs: 4.5, liquidity: 500_000, risk: 30, executionLikelihood: 70,
    alternative: { id: 'route-B', costs: 6.1, risk: 30 },
    now
  });
  check('WHY explains an action from evidence with cost/liquidity/risk factors', why.ok && why.evidenceBacked === true && why.factors.cost === 4.5 && why.factors.liquidity === 500000);
  check('a comparative "better" claim requires evidence on both sides', why.alternative.comparison.claim === 'COMPARED_ON_EVIDENCED_DIMENSIONS_ONLY' && why.saysBetter === true);
  const whyNoEvidence = whyThisDecision({ action: 'x', decision: 'because', alternative: { id: 'y' }, now });
  check('without evidence no "better" claim is made', whyNoEvidence.ok && whyNoEvidence.saysBetter === false && whyNoEvidence.alternative.comparison.claim === 'NO_COMPARISON_WITHOUT_EVIDENCE');

  // ── 50: Why This Permission ─────────────────────────────────────────────
  const strategy = { id: 'main', uses: ['dydx', 'swap'], name: 'perp route' };
  const alt = [{ id: 'spot', name: 'spot route', uses: ['swap'] }];
  const perm = whyThisPermission({ capability: 'dydx', requestReason: 'Hedged perp leg needs a venue.', strategy, alternatives: alt, now });
  check('permission WHY states reason and honest risk summary', perm.ok && perm.requestedReason.length > 0 && /liquidation/i.test(perm.riskSummary));
  check('the WHY offers a viable alternative without the permission', perm.hasViableAlternative === true && perm.alternativesWithoutCapability[0].id === 'spot');
  check('decline is a safe replan: not a dead end, not an auto-enable', perm.declinePath.outcome === 'SAFE_REPLAN' && perm.declinePath.deadEnd === false && perm.declinePath.autoEnable === false);
  check('the permission request itself grants nothing', perm.grantsPermission === false && perm.executionAuthorized === false);
  check('a permission WHY without a reason is rejected', whyThisPermission({ capability: 'futures', strategy }).ok === false);

  // ── 24: Shadow / Paper Execution (paper ≠ live) ─────────────────────────
  const sandbox = { isolated: true, operatorId: 'sandbox-op-1', attestedAt: now };
  const run = createShadowRun({ strategyId: 'strat-1', sandbox, paperCapitalUsd: 1000, now });
  check('shadow run requires an attested isolated sandbox', run.ok && run.sandbox.isolated === true && run.venue === 'paper-sandbox');
  check('shadow run rejects mainnet/production-signer references', createShadowRun({ strategyId: 'strat-1', sandbox: { ...sandbox, productionSigner: '0x123' }, paperCapitalUsd: 1000, now }).ok === false);
  check('no sandbox → no run (fail-closed)', createShadowRun({ strategyId: 'strat-1', sandbox: null, paperCapitalUsd: 1000, now }).ok === false);

  const paperSim = async () => ({ passed: true, outputUsd: 1040, costUsd: 4, slippagePct: 0.3 });
  const passed = await advanceShadowRun(run, { paperSimulator: paperSim, now });
  check('a passed paper run is paper-passed, NOT live-ready', passed.ok && passed.status === 'paper-passed' && passed.liveReady === false && passed.paperOnly === true);

  const timeoutSim = () => new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 20));
  const timedOut = await advanceShadowRun(run, { paperSimulator: timeoutSim, timeoutMs: 5, now });
  check('a timeout is a timeout, never a quote (no output/cost zeros)', timedOut.status === 'timeout' && timedOut.outputUsd === null && timedOut.costUsd === null && timedOut.timeoutIsQuote === false);

  const hungSim = () => new Promise(() => {});
  const hung = await advanceShadowRun(run, { paperSimulator: hungSim, timeoutMs: 5, now });
  check('a hung simulator also resolves as timeout, not as a fill', hung.status === 'timeout' && hung.timeoutIsQuote === false);

  const noSim = await advanceShadowRun(run, { paperSimulator: null, now });
  check('missing paper simulator is fail-closed, not zero-cost success', noSim.ok === false && noSim.status === 'sandbox-rejected');

  const reqs = paperToRealRequirements(passed);
  check('paper success never auto-converts to real execution', reqs.canGoLiveDirectly === false && reqs.autoUpgradeFromPaper === false);
  check('real execution still requires the full independent gate chain', reqs.requiredBeforeRealExecution.includes('NEW_AUTHORIZATION_SCREEN') && reqs.requiredBeforeRealExecution.includes('INDEPENDENT_GUARDIAN_REVIEW') && reqs.executionAuthorized === false);

  // The scanner contract used above stays scan-only.
  const scan = scanCapabilities({ runtime: {}, now });
  check('pre-start scan stays scan-only (scan ≠ activation)', scan.schema === CAPABILITY_SCANNER_SCHEMA);

  console.log(JSON.stringify({ probe: 'spec65-priority-core', passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'spec65-priority-core', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}
export default results;
