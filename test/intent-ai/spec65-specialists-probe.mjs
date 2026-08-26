/* Spec 65 — Priority 3: Specialist agent contracts 6–20 (each with explicit
 * input/output/cannot-execute), council quorum for important trades (21),
 * voting thresholds with Guardian veto (22), and independent Guardian STOP. */
import {
  SPECIALIST_ROLES,
  SPECIALIST_SPECS,
  IMPORTANT_TRADE_MIN_ROLES,
  runSpecialist,
  assertCouncilQuorum,
  tallyVotes,
  runAgentCouncil,
  councilDecisionAllowsReview,
  GUARDIAN_NON_DISABLEABLE
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const proposal = {
  id: 'prop-1', uses: ['swap'], route: ['USDC', 'ETH'],
  evidence: [{ source: 'dex-quote', observedAt: now, sampleSize: 9, quality: 0.8 }]
};

try {
  // ── 6–20: every specialist contract ────────────────────────────────────
  check('all 15 specialist roles have contracts', SPECIALIST_ROLES.length === 15 && SPECIALIST_ROLES.every((role) => SPECIALIST_SPECS[role]?.cannot?.length > 0));
  const universal = SPECIALIST_ROLES.filter((role) => role !== 'strategy' && role !== 'execution');
  check('strategy + execution are the only internal-real engines; others are contracts', SPECIALIST_SPECS.strategy.engine === 'internal-real' && SPECIALIST_SPECS.execution.engine === 'internal-real' && universal.every((role) => SPECIALIST_SPECS[role].live === false));

  const outputs = SPECIALIST_ROLES.map((role) => runSpecialist(role, { proposal, context: { riskPct: 30, maxRiskPct: 50, liquidityUsd: 100000, amountUsd: 20000, evidence: [{}], feeUsd: 3.2, gasUsd: 1.1, balanceAttested: true, timeline: [{}], bridgeQuote: { id: 'q1' } } }));
  check('every specialist runs deterministically with canExecute=false', outputs.every((row) => row.ok === true && row.canExecute === false));
  check('no specialist can sign or execute', outputs.every((row) => row.signsTransactions === false && row.executesOrders === false));
  check('every specialist explicitly cannot bypass Guardian/Risk/STOP', outputs.every((row) => row.cannot.includes('bypass-guardian') && row.cannot.includes('bypass-risk-policy') && row.cannot.includes('override-stop-or-pause') && row.cannot.includes('receive-seed-or-private-key')));

  const riskLow = runSpecialist('risk', { context: { riskPct: 70, maxRiskPct: 50 } });
  check('risk specialist flags above-policy proposals', riskLow.status === 'above-policy' && riskLow.advisory.block === true);
  const bridge = runSpecialist('bridge', { context: { bridgeQuote: { venue: 'x' } } });
  check('bridge specialist treats a quote as quote-only, not executable', bridge.status === 'quote-only' && bridge.advisory.quoteOnly === true);
  const portfolio = runSpecialist('portfolio', { context: { balanceAttested: false } });
  check('portfolio specialist refuses progress without an attested balance', portfolio.status === 'unattested' && portfolio.advisory.progressComputable === false);
  const guardianRun = runSpecialist('guardian', {});
  check('guardian keeps an independent, non-disableable STOP', guardianRun.advisory.independentStop === true && guardianRun.advisory.nonDisableable === true && GUARDIAN_NON_DISABLEABLE === true);
  check('unknown role is rejected', runSpecialist('wizard', {}).ok === false);

  // ── 21: council quorum for important trades ────────────────────────────
  const badQuorum = assertCouncilQuorum(['research', 'strategy']);
  check('an important trade without risk/liquidity/guardian lacks quorum', badQuorum.ok === false && badQuorum.missing.includes('risk') && badQuorum.missing.includes('liquidity') && badQuorum.missing.includes('guardian'));
  const goodQuorum = assertCouncilQuorum(IMPORTANT_TRADE_MIN_ROLES);
  check('minimum quorum = research, strategy, risk, liquidity, guardian', goodQuorum.ok === true && goodQuorum.councilExecutes === false);

  // ── 22: voting — permission to approach the screen, nothing more ───────
  const votes = [
    { role: 'research', decision: 'APPROVE' }, { role: 'strategy', decision: 'APPROVE' },
    { role: 'risk', decision: 'APPROVE' }, { role: 'liquidity', decision: 'APPROVE' }
  ];
  const tally = tallyVotes(votes, {});
  check('60%+ APPROVE allows proceeding to the authorization screen only', tally.decision === 'APPROVE' && tally.canProceedToAuthorizationScreen === true && tally.executesNothing === true);
  const guardianNo = tallyVotes([...votes, { role: 'guardian', decision: 'REJECT' }], {});
  check('Guardian ❌ = REJECT regardless of the tally', guardianNo.decision === 'REJECT' && guardianNo.guardianVetoApplied === true && guardianNo.canProceedToAuthorizationScreen === false);
  const split = tallyVotes([{ role: 'research', decision: 'APPROVE' }, { role: 'risk', decision: 'REJECT' }], {});
  check('a rejecting safety role blocks the screen', split.decision === 'REJECT');
  check('tally output never carries execution permission', tally.executionAuthorized === false && tally.financialExecutionAuthorized === false);

  // ── full council integration: council approves but still cannot execute ─
  const council = runAgentCouncil({ proposal, votes: { research: { decision: 'APPROVE' }, strategy: { decision: 'APPROVE' }, risk: { decision: 'APPROVE' }, liquidity: { decision: 'APPROVE' }, guardian: { decision: 'APPROVE' } }, context: { guardianApproved: true }, roles: IMPORTANT_TRADE_MIN_ROLES, highValue: true, now });
  check('a full APPROVE council still cannot execute', council.ok && council.decision === 'APPROVE' && council.canExecute === false && council.requiresUserAuthorization === true && council.replacesGuardian === false);
  check('council APPROVE only allows continuing toward review', councilDecisionAllowsReview(council) === true);
  const rejectedCouncil = runAgentCouncil({ proposal, votes: { guardian: { decision: 'REJECT' } }, roles: IMPORTANT_TRADE_MIN_ROLES, now });
  check('council with Guardian REJECT is REJECTED and allows nothing', rejectedCouncil.decision === 'REJECT' && councilDecisionAllowsReview(rejectedCouncil) === false);

  console.log(JSON.stringify({ probe: 'spec65-specialists', passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'spec65-specialists', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}
export default results;
