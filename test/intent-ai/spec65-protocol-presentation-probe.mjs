/* Spec 65 — Priorities 7–8 + protocol: Reputation/Leaderboard observed-only
 * (43–45), Personality/Avatar display-only (46–47), FBT Agent Protocol (51),
 * Payment layer caps (52), passport-gated envelope (53), Learning exchange
 * opt-in (54), Multi-agent chain (57), Optimizer/Suggestions (58/60). */
import {
  buildAgentReputation,
  agentLeaderboard,
  createAgentAppreciation,
  applyPersonality,
  personalityCannotChangeRisk,
  agentAvatar,
  createAgentEnvelope,
  buildAgentChain,
  advanceAgentChain,
  createPaymentPlan,
  requestAgentWithdrawal,
  settleFeeWithEvidence,
  createLearningExchange,
  suggestIntentOptions,
  optimizeIntent,
  replanAfterCapabilityDecline,
  suggestIntentOptions as suggestions
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  // ── 43: Reputation observed-only ────────────────────────────────────────
  const thin = buildAgentReputation({ agentId: 'agent-thin', samples: [{ outcome: 'success', confirmed: true }], now });
  check('reputation with a thin sample is insufficient_data with null scores', thin.compositeScore === null && thin.compositeStatus === 'insufficient_data' && thin.categories.every((c) => c.score === null));
  check('sample size below the minimum never rounds up to a percent', thin.categories.every((c) => c.status === 'insufficient_data'));
  const samples = [];
  for (let i = 0; i < 6; i += 1) {
    samples.push({ outcome: i < 5 ? 'success' : 'failure', confirmed: true, deliveredOnTime: i < 5, withinRiskPolicy: i < 4, communicationRating: 80, accuracyRating: 70 });
  }
  const rated = buildAgentReputation({ agentId: 'agent-rated', samples, now });
  check('five categories from observed samples produce a bounded composite', rated.compositeStatus === 'observed' && rated.compositeScore !== null && rated.compositeScore >= 0 && rated.compositeScore <= 100);
  check('a fabricated success without confirmation is dropped', buildAgentReputation({ agentId: 'a', samples: Array.from({ length: 6 }, () => ({ outcome: 'success', confirmed: false })) }).compositeStatus === 'insufficient_data');
  check('reputation never verifies an agent nor replaces Guardian', rated.scoreNeverVerifies === true && rated.scoreNeverReplacesGuardian === true);

  // ── 44: Leaderboard risk-adjusted, observed-only, honest sharing ────────
  const board = agentLeaderboard({ reputations: [rated, thin], now });
  check('unrated agents appear as unrated, never with invented scores', board.entries.length === 2 && board.entries.some((row) => row.status === 'insufficient_data' && row.compositeScore === null && row.badge === null));
  check('rating is risk-adjusted on observed data', board.entries[0].status === 'rated' && board.entries[0].riskAdjustedScore <= board.entries[0].compositeScore && board.rankedOn === 'risk-adjusted-observed-only');
  check('public sharing is opt-in and honest', agentLeaderboard({ reputations: [rated], publicSharing: true, now }).publicSharing === true);

  // ── 45: Appreciation — bidirectional, reasoned, Guardian-blind ──────────
  const kudos = createAgentAppreciation({ fromAgentId: 'agent-a', toAgentId: 'agent-b', rating: 85, reason: 'Clear warnings before the pause.', now });
  check('appreciation is bidirectional with a short required reason', kudos.ok && kudos.bidirectional === true && kudos.reason.length > 0);
  check('appreciation never affects Guardian, Risk or STOP', kudos.affectsGuardian === false && kudos.affectsRiskPolicy === false && kudos.affectsStop === false);
  check('self-appreciation is rejected', createAgentAppreciation({ fromAgentId: 'a', toAgentId: 'a', rating: 50, reason: 'x' }).ok === false);

  // ── 46: Personality — tone only, risk untouched ─────────────────────────
  const safetyPayload = { riskLevel: 'high', decision: 'BLOCK', maxLossPct: 12, riskCapPct: 30, riskEffect: 'none', policyEffect: 'none', guardianEffect: 'none', stopEffect: 'none', limitEffect: 'none' };
  const professional = applyPersonality({ tone: 'professional', text: 'Route blocked by risk policy. Review required.', now });
  const friendly = applyPersonality({ tone: 'friendly', text: 'Route blocked by risk policy. Review required.', now });
  check('five tones exist and wrap display text only', professional.ok && friendly.ok && friendly.displayText.startsWith('👋') && professional.scope === 'display-only');
  check('personality NEVER changes risk/policy/Guardian/STOP/limits', personalityCannotChangeRisk(professional, friendly, safetyPayload) === true && friendly.riskEffect === 'none' && friendly.stopEffect === 'none');
  check('an unknown tone is rejected', applyPersonality({ tone: 'aggressive', text: 'x' }).ok === false);

  // ── 47: Avatar — decorative identity, grants nothing ────────────────────
  const avatar = agentAvatar({ agentId: 'fbt.guardian', role: 'guardian', now });
  check('agents get deterministic visual identity', avatar.ok && avatar.glyph === '🛡' && agentAvatar({ agentId: 'fbt.guardian', role: 'guardian', now }).color === avatar.color);
  check('an avatar grants no permission and no trust', avatar.grantsPermission === false && avatar.grantsTrust === false && avatar.affectsGuardian === false);

  // ── 51/53: Protocol envelope + passport completeness gate ───────────────
  const env = createAgentEnvelope({
    agentId: 'external-alpha', externalPassport: null,
    capabilities: ['market-analysis'], permissions: ['read-only'],
    intent: { id: 'intent-77' }, risk: { level: 'medium', score: 40 },
    fee: { serviceUsd: 2, performancePct: 10, networkUsd: 0.5 },
    input: { pair: 'ETH/USDC' }, output: { signal: 'long-bias' },
    status: 'analysis', reputation: { compositeStatus: 'observed', compositeScore: 72 },
    expiration: now + 3_600_000, now
  });
  check('envelope carries the 11 protocol fields', env.ok && ['agentId', 'capabilities', 'permissions', 'intent', 'risk', 'fee', 'input', 'output', 'status', 'reputation', 'expiration'].every((field) => field in env.envelope));
  check('expired envelopes are flagged, none are executable', env.envelope.expired === false && env.executable === false && env.signsTransactions === false);
  const expiredEnv = createAgentEnvelope({ agentId: 'external-alpha', expiration: now - 1, now });
  check('an expired envelope cannot pass as valid currency', expiredEnv.ok && expiredEnv.envelope.expired === true && expiredEnv.executable === false);
  const incompleteEnv = createAgentEnvelope({ agentId: 'external-beta', externalPassport: { id: 'external-beta', name: 'Beta' }, now });
  check('an incomplete passport makes the envelope non-executable — no padding', incompleteEnv.ok && incompleteEnv.passportComplete === false && incompleteEnv.incompletePassportNonExecutable === true);

  // ── 57: Multi-agent chain — any link halts, no link signs ───────────────
  const chain = buildAgentChain({ goalId: 'goal-9', externalNeeded: true, now });
  check('chain is User→Goal→Research→Strategy→External?→Risk→Guardian→Execution→Exit', chain.links.length === 9 && chain.links[0].link === 'user' && chain.links[4].link === 'external-specialist' && chain.links[6].link === 'guardian');
  check('every link may halt; no link signs', chain.links.every((link) => link.canHalt === true && link.canSign === false) && chain.noLinkSigns === true);
  const halt = advanceAgentChain(chain, { toLink: 'risk', checkResult: { ok: false, decision: 'BLOCK', code: 'RISK_ABOVE_POLICY' }, now });
  check('a blocking Risk link halts the chain before Guardian/Execution', halt.ok === false && halt.haltedAt === 'risk' && halt.executionAuthorized === false);
  const pass = advanceAgentChain(chain, { toLink: 'research', checkResult: { ok: true }, now });
  check('a passing link advances without producing a signature', pass.ok && pass.advancedTo === 'research' && pass.noLinkSigns === true);

  // ── 52: Payment layer — caps and displayed ≠ paid ───────────────────────
  const plan = createPaymentPlan({ agentId: 'external-alpha', intentId: 'intent-77', fees: { serviceUsd: 2, performancePct: 10, networkUsd: 0.5 }, withdrawalCapUsd: 5, now });
  check('payment plan declares all fee classes with a withdrawal cap', plan.ok && plan.withdrawalCapUsd === 5 && plan.paid === false);
  check('a withdrawal above the cap is always blocked', requestAgentWithdrawal(plan, { amountUsd: 6, now }).ok === false);
  check('a within-cap withdrawal still needs settlement evidence', requestAgentWithdrawal(plan, { amountUsd: 4, now }).settled === false);
  const displayed = settleFeeWithEvidence(plan, { amountUsd: 2, settlement: { providerId: 'payer-1' }, now });
  check('a fee display without evidence stays displayed-only, not paid', displayed.status === 'displayed-only' && displayed.settled === false);
  const settled = settleFeeWithEvidence(plan, { amountUsd: 2, settlement: { providerId: 'payer-1', checkedAt: now - 10, confirmed: true, evidenceId: 'settle-1' }, now });
  check('settlement requires provider+checkedAt+confirmed+evidenceId', settled.status === 'settled-with-evidence' && settled.settled === true);
  const zeroFee = createPaymentPlan({ agentId: 'external-alpha', fees: { serviceUsd: 0, performancePct: 0, networkUsd: 0 }, withdrawalCapUsd: 0, now });
  check('a zero-fee claim without evidence is flagged, never trusted', zeroFee.unevidencedZeroFee === true);

  // ── 54: Learning exchange — opt-in, structured, local-only ──────────────
  const noOptIn = createLearningExchange({ sessionId: 'session-1', participants: ['agent-a'], optIn: {}, lessons: [], now });
  check('without opt-in nothing is stored or exchanged', noOptIn.status === 'opt-out' && noOptIn.stored === false);
  const exchange = createLearningExchange({
    sessionId: 'session-1', participants: ['agent-a', 'agent-b'], optIn: { 'agent-a': true, 'agent-b': true },
    lessons: [
      { kind: 'what-worked', lesson: 'Conservative route held slippage under cap.', strategyClass: 'dex-conservative' },
      { kind: 'wrong-hypothesis', lesson: 'Assumed liquidity buffer would hold at 3x amount.', strategyClass: 'defi-yield' },
      { kind: 'chatText', lesson: 'private conversation' }
    ], now
  });
  check('opted-in exchange carries structured lessons only', exchange.status === 'opted-in' && exchange.lessons.length === 2 && exchange.containsPrivateChatText === false);
  check('private chat text payloads are dropped, upload stays disabled', exchange.droppedPrivate.privateText === 1 && exchange.uploadEnabled === false && exchange.pipeline === 'local-only');
  check('learning never weakens Guardian or Risk', exchange.weakensGuardian === false && exchange.weakensRiskPolicy === false);

  // ── 58: Vague profit request → clarifying questions ─────────────────────
  const vague = suggestions({ message: 'میخوام سود بیشتر داشته باشم', now });
  check('a vague profit request triggers the seven clarifications', vague.vagueProfitRequest === true && vague.clarifications.length === 7 && ['risk', 'duration', 'capital', 'defi', 'futures', 'dydx', 'external'].every((id) => vague.clarifications.some((row) => row.id === id)));
  check('suggestions never activate anything', vague.suggestionOnly === true && vague.activation === false && vague.autoFillAnswers === false);

  // ── 60: Intent Optimizer — suggestion bundle, futures opt-in ────────────
  const bundle = optimizeIntent({ capitalUsd: 1000, riskAppetite: 'low', durationHrs: 24 * 30, targetPct: 8, maxLossPct: 10, optionalDydx: false, now });
  check('the recommended bundle states target/duration/risk/capital/max-loss', bundle.ok && bundle.targetPct === 8 && bundle.riskCapPct === 25 && bundle.maxLossPct === 10 && bundle.suggestionOnly === true);
  check('futures stay off without explicit opt-in; dYdX stays optional-or-excluded', bundle.futuresEnabled === false && bundle.dydx === 'excluded' && bundle.futuresRequiresExplicitOptIn === true);
  check('an inflated target is capped to the risk budget and flagged', optimizeIntent({ capitalUsd: 1000, riskAppetite: 'low', durationHrs: 24, targetPct: 40, maxLossPct: 10, now }).targetAdjusted === true);
  check('no bundle without a max-loss number', optimizeIntent({ capitalUsd: 1000, riskAppetite: 'low', durationHrs: 24, now }).ok === false);
  check('a bundle authorizes nothing', bundle.activationAuthorized === false && bundle.guaranteesProfit === false);

  // ── Required: decline → safe replan (integrated) ────────────────────────
  const strategy = { id: 'perp-main', uses: ['dydx', 'swap'], name: 'perp' };
  const declined = replanAfterCapabilityDecline({ strategies: [strategy, { id: 'spot-safe', uses: ['swap'], name: 'spot' }], declinedCapability: 'dydx' });
  check('declining dYdX produces a safe replan, not a dead end', declined.ok && declined.alternatives.some((row) => row.id === 'spot-safe') && declined.automaticExecution === false && declined.requiresReview === true);
  const noAlt = replanAfterCapabilityDecline({ strategies: [strategy], declinedCapability: 'dydx' });
  check('with no safe alternative the honest state is no-safe-alternative', noAlt.ok === false && noAlt.code === 'NO_SAFE_ALTERNATIVE' && noAlt.alternatives.length === 0);

  console.log(JSON.stringify({ probe: 'spec65-protocol-presentation', passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'spec65-protocol-presentation', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}
export default results;
