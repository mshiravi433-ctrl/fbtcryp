/**
 * FBT INTENT AI — Spec 65 items 58 and 60: Agent Suggestions and Intent
 * Optimizer.
 *
 * When the user speaks vaguely ("I want more profit"), the assistant must ask
 * bounded clarifying questions (Risk / Duration / Capital / DeFi / Futures /
 * dYdX / External) instead of guessing. The Intent Optimizer turns explicit
 * constraints into a RECOMMENDED intent bundle — a suggestion only, never an
 * activation, and futures are off unless the user explicitly opts in.
 */

import { bounded, containsRawSecret, fail, finite, noExecutionPermission, safeId } from './phaseBoundary.js';
import { assessTarget } from './targetReality.js';

export const AGENT_SUGGESTIONS_SCHEMA = 'fbt.intent-agent-suggestions.v1';
export const INTENT_OPTIMIZER_SCHEMA = 'fbt.intent-optimizer.v1';

const VAGUE_MARKERS = [
  'more profit', 'more gains', 'make money', 'higher yield', 'best return',
  'سود بیشتر', 'درآورد پول', 'بیشترین سود', 'پولم بیشتر بشه'
];

const CLARIFICATIONS = Object.freeze([
  { id: 'risk', question: 'How much maximum loss can you accept for this intent?', options: ['very-low', 'low', 'medium', 'high'], required: true },
  { id: 'duration', question: 'What time horizon should the intent target?', options: ['24h', '1w', '1m', '3m+'], required: true },
  { id: 'capital', question: 'How much capital should the intent be allowed to use?', options: ['fixed-amount', 'percentage-of-portfolio'], required: true },
  { id: 'defi', question: 'Should DeFi routes (lending/farming/staking) be considered?', options: ['yes', 'no'], required: false },
  { id: 'futures', question: 'Should futures/perpetuals be considered at all?', options: ['no', 'yes-explicit-opt-in'], required: false, default: 'no' },
  { id: 'dydx', question: 'Should dYdX be an optional capability?', options: ['no', 'optional-with-permission'], required: false, default: 'no' },
  { id: 'external', question: 'May external agents be discovered for missing capabilities?', options: ['no', 'discover-only', 'discover-and-hire-with-gates'], required: false, default: 'discover-only' }
]);

/**
 * Detect a vague profit request and return the clarifying questions. A
 * suggestion never activates anything and never fills in the user's answers.
 */
export function suggestIntentOptions({ message = null, now = Date.now() } = {}) {
  if (containsRawSecret({ message })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  const vague = VAGUE_MARKERS.some((marker) => text.includes(marker));
  return noExecutionPermission({
    ok: true,
    schema: AGENT_SUGGESTIONS_SCHEMA,
    vagueProfitRequest: vague || text.length === 0,
    detection: vague ? 'explicit-vague-marker' : text.length === 0 ? 'no-constraints-supplied' : 'not-detected',
    clarifications: CLARIFICATIONS.map((row) => ({ ...row })),
    suggestionOnly: true,
    activation: false,
    autoFillAnswers: false,
    note: 'The assistant asks; only the user answers. Answers feed the optimizer, never an execution path.',
    askedAt: now
  });
}

/**
 * Build a recommended intent bundle from explicit constraints. The bundle is
 * a suggestion: futures stay disabled unless explicitly opted in, dYdX stays
 * optional, and a max-loss number must exist for the bundle to be complete.
 */
export function optimizeIntent({
  capitalUsd = null,
  riskAppetite = null,
  durationHrs = null,
  targetPct = null,
  noFutures = true,
  optionalDydx = false,
  defiRoutes = [],
  maxLossPct = null,
  now = Date.now()
} = {}) {
  if (containsRawSecret({ capitalUsd, riskAppetite, defiRoutes })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const capital = finite(capitalUsd);
  if (capital === null || capital <= 0) return fail('CAPITAL_REQUIRED');
  const duration = finite(durationHrs);
  if (duration === null || duration <= 0) return fail('DURATION_REQUIRED');
  const riskMap = { 'very-low': 10, low: 25, medium: 45, high: 65 };
  const riskCap = bounded(riskAppetite) ?? riskMap[riskAppetite] ?? null;
  if (riskCap === null) return fail('RISK_APPETITE_REQUIRED', 'Answer the risk clarification first.');
  const target = bounded(targetPct) ?? null;
  const maxLoss = bounded(maxLossPct);
  if (maxLoss === null) return fail('MAX_LOSS_REQUIRED', 'A recommended bundle must state its maximum acceptable loss.');

  // A target above the risk cap is not recommended: it would promise more
  // than the risk budget can plausibly support.
  const targetCapped = target === null ? null : Math.min(target, riskCap);
  const reality = assessTarget({ capital, targetPct: targetCapped, durationHrs: duration });
  const realismLevel = reality.ok ? reality.realism.level : 'unknown';

  const bundle = {
    ok: true,
    schema: INTENT_OPTIMIZER_SCHEMA,
    recommended: true,
    suggestionOnly: true,
    activationAuthorized: false,
    capitalUsd: capital,
    targetPct: targetCapped,
    targetAdjusted: target !== null && targetCapped !== target,
    durationHrs: duration,
    riskCapPct: riskCap,
    maxLossPct: maxLoss,
    futuresEnabled: noFutures === true ? false : true,
    futuresRequiresExplicitOptIn: true,
    dydx: optionalDydx === true ? 'optional-with-permission' : 'excluded',
    defiRoutes: Array.isArray(defiRoutes) ? defiRoutes.slice(0, 8).map((row) => safeId(String(row || '')) || safeId(String(row || '').replace(/[^a-z0-9-]/gi, '-'))) .filter(Boolean).slice(0, 8) : [],
    realism: realismLevel,
    guaranteesProfit: false,
    requiresUserChoice: true,
    optimizedAt: now
  };
  return noExecutionPermission(bundle);
}
