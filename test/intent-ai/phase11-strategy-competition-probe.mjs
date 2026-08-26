/* Phase 11 — strategy generation, competition, simulation and replan. */
import {
  generateStrategies,
  compareStrategies,
  simulateRoute,
  competeStrategies,
  explainStrategyComparison,
  switchStrategy,
  monitorStrategy,
  replanAfterStrategyCapabilityDecline
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  const generated = generateStrategies({ intent: { id: 'intent-11' } });
  check('generation returns multiple proposal-only strategies', generated.ok && generated.strategies.length >= 2 && generated.proposalOnly && generated.financialExecutionAuthorized === false);
  check('proposals never guarantee profit or create execution permission', generated.strategies.every((row) => row.guaranteed === false && row.executionAuthorized === false && row.automaticExecution === false));

  const insufficient = compareStrategies(generated.strategies);
  check('comparison with insufficient evidence withholds the winner', insufficient.winnerId === null && insufficient.winnerStatus === 'no-winner-without-evidence');

  const observed = generateStrategies({
    intent: { id: 'intent-11' },
    candidates: [
      { id: 'observed-a', expectedReturnPct: 8, riskPct: 10, evidence: [{ source: 'runtime-a', sampleSize: 10, quality: 85 }] },
      { id: 'observed-b', expectedReturnPct: 5, riskPct: 5, evidence: [{ source: 'runtime-b', sampleSize: 10, quality: 80 }] }
    ]
  });
  const comparedObserved = compareStrategies(observed.strategies);
  check('evidence-backed comparison is deterministic but provisional', comparedObserved.winnerId && comparedObserved.winnerStatus === 'evidence-backed-provisional' && comparedObserved.requiresUserChoice === true);

  const unavailable = await simulateRoute(generated.strategies[0]);
  check('missing simulator is unavailable rather than a successful zero quote', unavailable.status === 'unavailable' && unavailable.code === 'SIMULATOR_UNAVAILABLE');
  const failedSimulation = await simulateRoute(generated.strategies[0], { simulator: async () => ({ ok: false, status: 'reverted' }) });
  check('failed simulation never grants execution permission', failedSimulation.status === 'unavailable' && failedSimulation.executionPermission !== true);
  const passedSimulation = await simulateRoute(generated.strategies[0], {
    simulator: async () => ({ ok: true, status: 'passed', output: 100, fee: 1, slippagePct: 0.2, providerId: 'sim-provider', evidence: [{ source: 'simulation', sampleSize: 5, quality: 90 }] }),
    now
  });
  check('a passing injected simulator returns bounded evidence only', passedSimulation.ok && passedSimulation.status === 'passed' && passedSimulation.executionPermission === false);

  const competition = competeStrategies({ strategies: generated.strategies, simulations: [passedSimulation] });
  check('competition does not turn a simulation winner into authorization', competition.strategySelection === 'PROVISIONAL_ONLY' && competition.winnerId && competition.executionAuthorized === false && competition.userChoiceRequired === true);
  const explained = explainStrategyComparison({ strategies: generated.strategies, competition, now });
  check('comparison exposes risk, assumptions and evidence without a promise', explained.ok && explained.provisional && explained.userChoiceRequired && explained.explanations.length > 0 && explained.executionAuthorized === false);
  const switched = switchStrategy({ currentStrategyId: generated.strategies[0].id, selectedStrategyId: generated.strategies[1].id, strategies: generated.strategies });
  check('switching forces recalculation and remains preparation only', switched.ok && switched.recalculationRequired && switched.status === 'replanning' && switched.executionAuthorized === false);
  const replanned = replanAfterStrategyCapabilityDecline({ strategy: generated.strategies[0], declinedCapability: 'simulation', alternatives: generated.strategies });
  check('declining an optional capability produces a safe replan', replanned.ok && replanned.recalculationRequired && replanned.userChoiceRequired && replanned.executionAuthorized === false);
  const monitored = await monitorStrategy('observed-a');
  check('monitoring without a runtime monitor is unavailable', monitored.status === 'unavailable' && monitored.code === 'MONITOR_UNAVAILABLE');

  console.log(JSON.stringify({ probe: 'phase11-strategy-competition', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase11-strategy-competition', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
