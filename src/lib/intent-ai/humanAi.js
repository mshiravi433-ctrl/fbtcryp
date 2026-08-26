/**
 * FBT INTENT AI — HUMAN ↔ AI SESSION (MODE A)
 * ---------------------------------------------------------------------------
 * Orchestrates the chat-style interaction where a human user talks to FBT
 * Intent AI. Ties together:
 *   - intentParser      : free text → structured intent
 *   - permissions/policy: permission levels L1/L2/L3
 *   - strategyAgent     : research & strategy proposals
 *   - executionOrch.    : review → plan
 *   - guardian          : final pre-execution gate
 *   - draftOrder        : L2/L3 artefacts
 *
 * A session is immutable-by-convention: every message is appended to an
 * audit log, and no message is ever edited. The session is local-first and
 * never sent to a server unless the user opts into learning.
 */

import { parseUserIntent, refineIntent } from './intentParser.js';
import { sanitizePolicy, describeLevel, canPrepare, canExecute } from './permissions.js';
import { formulateStrategies, STRATEGY_AGENT_IDENTITY } from './strategyAgent.js';
import { orchestrate, EXECUTION_ORCHESTRATOR_IDENTITY } from './executionOrchestrator.js';
import { guardianReview, emergencyStopCheck } from './guardian.js';
import { createDraftOrder, draftOrderFromPlanStep } from './draftOrder.js';
import { createPolicy, confirmPolicy, policyIsValid, policyPreview } from './policyModel.js';
import { prepareExecution, confirmAndSubmit, observeAndReconcile, emergencyHalt } from './controlledExecution.js';
import { classifyFailure } from './failureModes.js';

const SESSION_SCHEMA = 'fbt.human-ai-session.v1';

function sid() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start a new Human↔AI session at the given permission level.
 */
export function startSession({ level = 1, policyInput = null, defaultChainId = 42161 } = {}) {
  const lvl = Number(level) || 1;
  let policy;
  let policyErrors = [];

  if (lvl >= 3 && policyInput) {
    const created = createPolicy({ ...policyInput, level: 3 });
    policy = created.policy;
    policyErrors = created.errors || [];
  } else {
    // L1/L2 use an implicit "analysis/prepare only" policy (zero execution caps).
    const created = createPolicy({ level: lvl });
    policy = created.policy;
    policyErrors = created.errors || [];
  }

  return {
    schema: SESSION_SCHEMA,
    id: sid(),
    startedAt: Date.now(),
    level: lvl,
    defaultChainId,
    policy,
    policyErrors,
    messages: [
      systemMessage(`session.started`, {
        level: describeLevel(lvl),
        requiresUserConfirmation: lvl >= 3
      })
    ],
    drafts: [],
    plans: [],
    audit: [],
    status: 'ACTIVE',
    pendingClarifications: null,
    execution: null,
    learningOptIn: false
  };
}

/**
 * Append a human message and produce the AI's structured reply.
 *
 * @returns {{session: object, reply: object}}
 */
export function chatTurn(session, text, ctx = {}) {
  if (session.status !== 'ACTIVE') {
    return { session, reply: assistantMessage('session-inactive', {}) };
  }
  if (policyIsValid(session.policy, Date.now()).valid === false && session.level >= 3) {
    // L3 requires a confirmed valid policy. L1/L2 always valid.
    if (session.policy && !session.policy.userConfirmed) {
      return awaitingPolicyConfirm(session);
    }
  }

  // append user message
  session = push(session, userMessage(text));
  appendAudit(session, { type: 'user_input', length: text.length });

  // 1. parse (or reuse a refined intent from answerClarifications)
  let parsed = ctx.resolvedParsed
    || (ctx.resolvedIntent
      ? { ok: true, intent: ctx.resolvedIntent, signals: ctx.resolvedIntent.signals || {}, confidence: ctx.resolvedIntent.confidence || 70, clarifications: [] }
      : parseUserIntent(text, { defaultChainId: session.defaultChainId, ...ctx }));
  appendAudit(session, { type: 'parse', ok: parsed.ok, confidence: parsed.confidence, clarifications: parsed.clarifications });

  // 2. if clarifications needed, ask
  if (!parsed.ok && parsed.clarifications.length) {
    session = push(session, assistantMessage('clarifications-needed', {
      clarifications: parsed.clarifications,
      signals: parsed.signals
    }));
    session.pendingClarifications = { parsed };
    return { session, reply: session.messages[session.messages.length - 1] };
  }

  // 3. Level 1: analysis-only
  if (session.level === 1 || parsed.intent.kind === 'analysis') {
    const analysis = formulateStrategies(parsed.intent, ctx);
    session = push(session, assistantMessage('analysis', {
      intent: parsed.intent,
      signals: parsed.signals,
      confidence: parsed.confidence,
      research: analysis.evidence,
      suggestions: analysis.proposals.slice(0, 3).map((p) => ({ id: p.id, strategy: p.strategy, description: p.description, risk: p.risk })),
      canExecute: false,
      level: 1
    }));
    session.pendingClarifications = null;
    return { session, reply: session.messages[session.messages.length - 1] };
  }

  // 4. Level 2: prepare (quotes + draft orders)
  const strategies = formulateStrategies(parsed.intent, {
    ...ctx,
    disabledCapabilities: session.level < 3 ? { futures: false, dydx: false, bridge: false, cex: false, defi: false, externalAgent: false } : {}
  });

  // Treat stable-denominated amounts as 1:1 USD for quoting/cap purposes.
  const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD']);
  const amountUsd = parsed.intent.amountUsd
    || ctx.amountUsd
    || (parsed.intent.amount && STABLES.has(parsed.intent.amountUnit) ? parsed.intent.amount : null);

  const orch = orchestrate(strategies, session.policy, {
    amountUsd,
    slippagePct: ctx.slippagePct || 0.5,
    sessionStartAt: session.policy.sessionStartAt,
    disabledCapabilities: session.level < 3 ? { futures: false, dydx: false, bridge: false, cex: false, defi: false, externalAgent: false } : {},
    now: Date.now()
  });

  if (!orch.ok) {
    session = push(session, assistantMessage('unable-to-proceed', {
      reasons: [...(orch.guardian.reasons || []), ...(orch.review || []).filter((r) => r.level === 'block').map((r) => r.code)],
      review: orch.review
    }));
    appendAudit(session, { type: 'orchestrate', ok: false, reasons: orch.guardian.reasons });
    return { session, reply: session.messages[session.messages.length - 1] };
  }

  // Build draft orders for every step
  const drafts = [];
  for (const step of orch.plan.steps) {
    const d = draftOrderFromPlanStep(step, orch.plan, {
      amountUsd: parsed.intent.amountUsd || ctx.amountUsd,
      amountIn: parsed.intent.amount,
      slippagePct: ctx.slippagePct || 0.5,
      maxLossUsd: session.policy.maxLossUsd,
      policyId: session.policy.id
    });
    if (d.ok) drafts.push(d.order);
  }
  session.drafts.push(...drafts.map((d) => ({ ...d, sessionId: session.id, planId: orch.plan.planId })));
  session.plans.push(orch.plan);

  const replyKind = session.level === 2 ? 'prepared-draft' : 'ready-for-confirmation';

  session = push(session, assistantMessage(replyKind, {
    intent: parsed.intent,
    selectedStrategy: orch.selected,
    plan: orch.plan,
    drafts: drafts.map((d) => ({ id: d.id, kind: d.kind, summary: `${d.fromSymbol} → ${d.toSymbol || ''} ${d.amountIn}` })),
    terms: orch.terms,
    termsHash: orch.termsHash,
    canExecute: canExecute(session.level),
    requiresConfirmation: true,
    level: session.level
  }));

  appendAudit(session, { type: 'prepared', ok: true, planId: orch.plan.planId, draftCount: drafts.length });
  session.pendingClarifications = null;
  return { session, reply: session.messages[session.messages.length - 1] };
}

/**
 * User answers clarification questions.
 */
export function answerClarifications(session, answers) {
  if (!session.pendingClarifications?.parsed) return { session, reply: assistantMessage('nothing-to-clarify', {}) };
  const refined = refineIntent(session.pendingClarifications.parsed, answers);
  const next = { ...session, pendingClarifications: null };
  const label = refined.intent?.raw || Object.values(answers || {}).filter(Boolean).join(' ') || '(refined)';
  return chatTurn(next, label, { resolvedParsed: refined, resolvedIntent: refined.intent });
}

/**
 * After ConfirmationGate: sign → submit → monitor → reconcile.
 */
export function executeConfirmed(session, { action = 'CONFIRM', riskInput = {}, signer, brokerHandle, idempotencyKey, observation, submitVia = 'wallet' } = {}) {
  if (session.status === 'STOPPED' || session.policy?.emergencyStop) {
    const err = classifyFailure('EMERGENCY_STOP');
    session = push(session, assistantMessage('error', { code: err.code, class: err.class, translatable: err.translatable }));
    return { session, reply: session.messages.at(-1), ok: false, error: err };
  }
  const draft = session.drafts[session.drafts.length - 1];
  const lastPlan = session.plans[session.plans.length - 1];
  const termsHash = session.messages.filter((m) => m.payload?.termsHash).at(-1)?.payload?.termsHash;
  const prepared = prepareExecution({
    draftOrder: draft,
    policy: session.policy,
    session,
    riskInput,
    termsHash
  });
  if (!prepared.ok) {
    session = push(session, assistantMessage('error', { code: prepared.error.code, translatable: prepared.error.translatable }));
    return { session, reply: session.messages.at(-1), ok: false, error: prepared.error };
  }
  const submitted = confirmAndSubmit({
    prepared,
    action,
    policy: session.policy,
    session,
    signer,
    brokerHandle,
    idempotencyKey,
    currentTerms: prepared.gate.lockedTerms,
    submitVia
  });
  if (!submitted.ok) {
    const kind = submitted.reauthoriseRequired ? 'status' : 'error';
    session = push(session, assistantMessage(kind, {
      code: submitted.error?.code,
      translatable: submitted.error?.translatable,
      reauthoriseRequired: !!submitted.reauthoriseRequired
    }));
    return { session, reply: session.messages.at(-1), ok: false, error: submitted.error, reauthoriseRequired: submitted.reauthoriseRequired };
  }
  const rec = observeAndReconcile({
    submitted,
    observation: observation || { confirmed: false, confirmations: 0 },
    session,
    emergencyStop: session.policy.emergencyStop
  });
  const type = rec.partial ? 'partial' : rec.receipt?.confirmed ? 'status' : 'status';
  session = { ...session, execution: { submitted, receipt: rec.receipt } };
  session = push(session, assistantMessage(type, {
    status: rec.receipt?.status,
    confirmed: rec.receipt?.confirmed === true,
    partial: !!rec.partial,
    filledAmount: rec.receipt?.filledAmount,
    fabricated: false,
    translatable: rec.error?.translatable || 'intentAi.status.ok'
  }));
  return { session, reply: session.messages.at(-1), ok: rec.ok, receipt: rec.receipt };
}

/**
 * Confirm the L3 policy preview (user taps CONFIRM & START).
 */
export function confirmSessionPolicy(session, now = Date.now()) {
  if (!session.policy) return { session, ok: false, reason: 'NO_POLICY' };
  const confirmed = confirmPolicy(session.policy, now);
  session = { ...session, policy: confirmed, status: 'ACTIVE' };
  session = push(session, systemMessage('policy.confirmed', { policyId: confirmed.id }));
  appendAudit(session, { type: 'policy_confirmed', policyId: confirmed.id });
  return { session, ok: true };
}

/**
 * Emergency stop from the user. Always works, never blocked by any agent.
 */
export function userStop(session, now = Date.now()) {
  const stopped = Object.freeze({
    ...session.policy,
    emergencyStop: true,
    stoppedAt: now,
    autonomousExecution: false
  });
  emergencyHalt(stopped, session);
  const updated = { ...session, policy: stopped, status: 'STOPPED', execution: null };
  const withMsg = push(updated, systemMessage('emergency_stop.triggered', { at: now }));
  appendAudit(withMsg, { type: 'emergency_stop', at: now });
  return withMsg;
}

/* ---------- message helpers ---------- */

function systemMessage(type, payload) {
  return { role: 'system', type, payload, ts: Date.now(), id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` };
}
function userMessage(text) {
  return { role: 'user', text: String(text || '').slice(0, 1000), ts: Date.now(), id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` };
}
function assistantMessage(type, payload) {
  return { role: 'assistant', type, payload, ts: Date.now(), id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` };
}
function push(session, msg) {
  return { ...session, messages: [...session.messages, msg] };
}
function appendAudit(session, entry) {
  session.audit.push({ ...entry, ts: Date.now() });
  if (session.audit.length > 400) session.audit = session.audit.slice(-400);
}
function awaitingPolicyConfirm(session) {
  session = push(session, assistantMessage('policy-confirmation-required', {
    preview: policyPreview(session.policy),
    buttons: ['CONFIRM & START', 'CANCEL']
  }));
  return { session, reply: session.messages[session.messages.length - 1] };
}

export {
  STRATEGY_AGENT_IDENTITY,
  EXECUTION_ORCHESTRATOR_IDENTITY
};
