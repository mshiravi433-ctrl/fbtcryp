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

import { parseUserIntent, refineIntent, detectChain, normalizeToken } from './intentParser.js';
import { sanitizePolicy, describeLevel, canPrepare, canExecute } from './permissions.js';
import { formulateStrategies, STRATEGY_AGENT_IDENTITY } from './strategyAgent.js';
import { orchestrate, EXECUTION_ORCHESTRATOR_IDENTITY } from './executionOrchestrator.js';
import { guardianReview, emergencyStopCheck } from './guardian.js';
import { createDraftOrder, draftOrderFromPlanStep } from './draftOrder.js';
import { createPolicy, confirmPolicy, policyIsValid, policyPreview } from './policyModel.js';
import { prepareExecution, confirmAndSubmit, observeAndReconcile, emergencyHalt } from './controlledExecution.js';
import { classifyFailure } from './failureModes.js';
import { checkIntentLimits, INTENT_LIMITS } from './intentLimits.js';
import {
  createFlowFromParsed,
  applyFlowAnswer,
  flowQuestionPayload,
  declinedFromTools,
  detectYesNo
} from './guidedFlow.js';
import { termsFromDraft } from './confirmationGate.js';
import { termsFingerprint } from '../intentLifecycle.js';
import {
  PRIMARY_MODES,
  normalizeMode,
  modeDefinition,
  assertModeBoundary,
  buildPermissionBoundary,
  createModeSession,
  REQUEST_CLASSES
} from './sessionModes.js';
import { scanCapabilities } from './capabilityScanner.js';
import { assessTarget } from './targetReality.js';
import { challengeStrategy, runAgentCouncil } from './agentCouncil.js';
import { createIntentGenome } from './intentGenome.js';
import { createMemoryStore } from './agentMemory.js';
import { createControlState, applyControl } from './policyGuard.js';
import { discoverExternalAgents } from './externalAgentTrust.js';

const SESSION_SCHEMA = 'fbt.intent-session.v2';

const RAW_CREDENTIAL_TEXT = /(-----BEGIN[^-]*PRIVATE KEY-----|\b(?:0x)?[a-f0-9]{64}\b|\b(?:seed phrase|recovery phrase|mnemonic|private key|master password|raw secret)\b)/i;
const CREDENTIAL_FIELD = /^(?:seed|mnemonic|private.?key|master.?password|raw.?secret|secret.?key|credential|token|cookie)$/i;

function containsCredentialField(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => (
    CREDENTIAL_FIELD.test(key) || containsCredentialField(child, depth + 1, seen)
  ));
}

function sid() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start a session under exactly one of the three product modes. `level` is a
 * separate preparation/execution permission tier; it is never a fourth mode.
 */
export function startSession({
  mode = 'human-ai',
  level = 1,
  policyInput = null,
  defaultChainId = 42161,
  runtime = {},
  evidence = {},
  userId = null,
  genome = null,
  externalAgents = [],
  externalAgentsSource = 'unavailable'
} = {}) {
  const lvl = [1, 2, 3].includes(Number(level)) ? Number(level) : 1;
  const normalizedMode = normalizeMode(mode);
  const modeSession = createModeSession({ mode: normalizedMode || mode, userId });
  const now = Date.now();

  // Invalid mode is a visible, blocked state — never silently mapped to a
  // fallback mode. Omitted mode still uses the documented Human ↔ AI default.
  if (!normalizedMode || !modeSession.ok) {
    return {
      schema: SESSION_SCHEMA,
      id: sid(),
      startedAt: now,
      mode: null,
      modeError: 'UNKNOWN_PRIMARY_MODE',
      availableModes: [...PRIMARY_MODES],
      level: lvl,
      messages: [systemMessage('session.blocked', { code: 'UNKNOWN_PRIMARY_MODE', availableModes: [...PRIMARY_MODES] })],
      drafts: [], plans: [], audit: [], status: 'BLOCKED', pendingClarifications: null,
      execution: null, learningOptIn: false,
      controls: createControlState(),
      authorization: { analysis: false, preparation: false, financialExecution: false },
      capabilityScan: scanCapabilities({ runtime, evidence, now }),
      memory: createMemoryStore(),
      genome: createIntentGenome(genome || {})
    };
  }

  let policy;
  let policyErrors = [];
  if (lvl >= 3 && policyInput) {
    const created = createPolicy({ ...policyInput, level: 3 });
    policy = created.policy;
    policyErrors = created.errors || [];
  } else {
    // L1/L2 use an implicit analysis/prepare-only policy (zero execution caps).
    const created = createPolicy({ level: lvl });
    policy = created.policy;
    policyErrors = created.errors || [];
  }

  const capabilityScan = scanCapabilities({ runtime, evidence, now });
  const externalAgentDiscovery = normalizedMode === 'fbt-external-ai'
    ? discoverExternalAgents({
      agents: Array.isArray(externalAgents) ? externalAgents : [],
      source: externalAgentsSource === 'unavailable' && Array.isArray(externalAgents) && externalAgents.length ? 'runtime-input' : externalAgentsSource,
      trustedRegistry: externalAgentsSource === 'server-catalog',
      now
    })
    : null;
  const definition = modeDefinition(normalizedMode);
  return {
    schema: SESSION_SCHEMA,
    id: sid(),
    mode: normalizedMode,
    modeLabel: definition.label,
    modeDefinition: definition,
    modeSessionId: modeSession.id,
    availableModes: [...PRIMARY_MODES],
    startedAt: now,
    level: lvl,
    defaultChainId,
    policy,
    policyErrors,
    permissions: {
      analysis: true,
      preparation: lvl >= 2,
      financialExecution: lvl >= 3,
      executionAuthorized: false,
      explanation: 'Analysis and preparation do not authorize financial execution.'
    },
    authorization: {
      analysis: true,
      preparation: lvl >= 2,
      financialExecution: false,
      screenRequired: true,
      userConfirmed: false,
      guardianApproved: false
    },
    capabilityScan,
    capabilities: capabilityScan,
    externalAgentDiscovery,
    targetReality: null,
    council: null,
    challenge: null,
    genome: createIntentGenome(genome || {}),
    memory: createMemoryStore(),
    messages: [
      systemMessage('session.started', {
        mode: normalizedMode,
        modeLabel: definition.label,
        level: describeLevel(lvl),
        requiresUserConfirmation: lvl >= 3,
        executionAuthorizationSeparate: true
      }),
      // The guided flow starts the way a human assistant does: greet first,
      // then ask what the user wants to do (see intentAI.chat.welcome).
      assistantMessage('conversation', {
        conversationType: 'greeting',
        flowStart: true,
        asksTask: true,
        financialExecutionAuthorized: false
      })
    ],
    drafts: [],
    plans: [],
    audit: [],
    status: 'ACTIVE',
    pendingClarifications: null,
    execution: null,
    flow: null,
    goalDeadline: null,
    goalMeta: null,
    controls: createControlState(),
    learningOptIn: false
  };
}

/**
 * Append a human message and produce the AI's structured reply.
 *
 * Parsing, capability discovery and agent dialogue can prepare a proposal, but
 * this function never treats that work as financial execution. A later
 * Confirmation Gate must set authorization explicitly before an adapter can
 * be called.
 *
 * @returns {{session: object, reply: object}}
 */
export function chatTurn(session, text, ctx = {}) {
  if (!session || session.status !== 'ACTIVE') {
    return { session, reply: assistantMessage('session-inactive', {}) };
  }
  const controls = session.controls || {};
  if (controls.paused || controls.revoked || controls.disconnected || controls.emergency || controls.stopped) {
    const code = controls.emergency ? 'EMERGENCY_EXIT' : controls.revoked ? 'PERMISSION_REVOKED' : controls.disconnected ? 'DISCONNECTED' : controls.paused ? 'PAUSED' : 'STOPPED';
    const blocked = push(session, assistantMessage('execution-blocked', {
      code,
      message: 'This control state is fail-closed. No financial execution permission was granted.',
      financialExecutionAuthorized: false
    }));
    return { session: blocked, reply: blocked.messages.at(-1) };
  }

  const validity = policyIsValid(session.policy, Date.now());
  if (session.level >= 3 && !validity.valid) {
    if (validity.reason === 'NOT_CONFIRMED') return awaitingPolicyConfirm(session);
    const blocked = push(session, assistantMessage('execution-blocked', {
      code: `POLICY_${validity.reason || 'INVALID'}`,
      reason: 'The policy is not valid. No analysis result is treated as execution authorization.',
      financialExecutionAuthorized: false
    }));
    appendAudit(blocked, { type: 'policy_block', reason: validity.reason });
    return { session: blocked, reply: blocked.messages.at(-1) };
  }

  // Reject credential-shaped chat input before it reaches messages, memory or
  // any model/agent. We retain only a length/code audit entry, never the raw
  // value itself.
  const rawText = String(text || '');
  if (RAW_CREDENTIAL_TEXT.test(rawText)) {
    const reply = assistantMessage('credential-rejected', {
      code: 'RAW_CREDENTIAL_FORBIDDEN',
      message: 'Seed phrases, private keys, master passwords and raw secrets are never accepted by Intent AI.',
      persisted: false,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    appendAudit(session, { type: 'credential_rejected', length: rawText.length });
    return { session, reply };
  }

  // Append the human message and keep only bounded, structured memory.
  session = push(session, userMessage(rawText));
  appendAudit(session, { type: 'user_input', length: rawText.length });
  session.memory?.append?.('intent.created', { text: rawText.slice(0, 500), mode: session.mode }, { localFirst: true });

  // 0. Guided step-by-step flow: while the AI is waiting for a specific
  // answer (amount confirmation, network, tool permission, execution
  // confirmation…), the text is routed to the flow instead of being parsed
  // as a brand-new intent. A user who jumps ahead with a complete request is
  // honoured — the flow simply hands over to the normal pipeline.
  if (session.flow?.active && session.flow?.step && !ctx.resolvedParsed && !ctx.resolvedIntent) {
    return flowTurn(session, rawText, ctx);
  }

  // 1. Parse (or reuse a refined intent from answerClarifications).
  const parsedInput = ctx.resolvedParsed
    || (ctx.resolvedIntent
      ? { ok: true, intent: ctx.resolvedIntent, signals: ctx.resolvedIntent.signals || {}, confidence: ctx.resolvedIntent.confidence || 70, clarifications: [] }
      : parseUserIntent(text, { defaultChainId: session.defaultChainId, ...ctx }));
  const parsed = parsedInput?.intent
    ? { ...parsedInput, intent: { ...parsedInput.intent, mode: session.mode } }
    : parsedInput;
  appendAudit(session, { type: 'parse', ok: parsed.ok, confidence: parsed.confidence, clarifications: parsed.clarifications });
  return respondToParsed(session, parsed, ctx);
}

/**
 * Everything that happens after a structured intent exists: social replies,
 * capability discovery, mode boundaries, product limits, the guided flow
 * entry point and the strategy/plan/draft pipeline. Shared by the direct
 * chat path, the guided-flow completion and answerClarifications.
 */
function respondToParsed(session, parsed, ctx = {}) {

  if (parsed.intent?.kind === 'conversation' || parsed.intent?.kind === 'help') {
    let replyCode = 'help';
    if (parsed.intent?.subType === 'greeting') replyCode = 'greeting';
    else if (parsed.intent?.subType === 'thanks') replyCode = 'thanks';
    else if (parsed.intent?.subType === 'goodbye') replyCode = 'goodbye';

    const reply = assistantMessage('conversation', {
      conversationType: replyCode,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    return { session, reply };
  }


  // Capability discovery is refreshed per request. Runtime evidence is passed
  // in by the adapter boundary; no green status is inferred locally.
  const capabilityScan = scanCapabilities({
    runtime: ctx.runtime || {},
    evidence: ctx.evidence || {},
    intent: parsed.intent,
    now: Date.now()
  });
  session.capabilityScan = capabilityScan;
  session.capabilities = capabilityScan;
  session.memory?.append?.('capability.scanned', {
    available: capabilityScan.available.map((row) => row.id),
    conditional: capabilityScan.conditional.map((row) => row.id),
    evidenceComplete: capabilityScan.evidenceComplete
  });

  const externalInputs = Array.isArray(ctx.externalAgents)
    ? ctx.externalAgents
    : ctx.externalAgentPassport
      ? [ctx.externalAgentPassport]
      : ctx.externalAgent
        ? [ctx.externalAgent]
        : [];
  const externalAgentDiscovery = session.mode === 'fbt-external-ai'
    ? discoverExternalAgents({
      agents: externalInputs,
      intent: parsed.intent || {},
      source: ctx.externalAgentsSource || (externalInputs.length ? 'runtime-input' : 'unavailable'),
      trustedRegistry: ctx.externalAgentsSource === 'server-catalog',
      now: Date.now()
    })
    : session.externalAgentDiscovery;
  if (session.mode === 'fbt-external-ai') session.externalAgentDiscovery = externalAgentDiscovery;
  const selectedExternal = externalAgentDiscovery?.candidates?.find((candidate) => (
    candidate.passport.id === String(ctx.externalAgentId || ctx.externalAgentPassport?.id || '')
  )) || (externalAgentDiscovery?.candidates?.length === 1 ? externalAgentDiscovery.candidates[0] : null);
  const discoveredExternalVerified = selectedExternal?.eligibleForAnalysis === true;

  // The external mode cannot silently admit an unverified participant. For
  // analysis/preparation we pass an explicit stage so a swap request is not
  // mistaken for permission to execute a swap.
  const stage = session.level === 1 || parsed.intent?.kind === 'analysis'
    ? REQUEST_CLASSES.ANALYSIS
    : REQUEST_CLASSES.PREPARATION;
  const rawCredential = ctx.rawCredential === true || containsCredentialField(ctx);
  const boundary = assertModeBoundary({
    mode: session.mode || 'human-ai',
    intent: parsed.intent,
    stage,
    userAuthorized: false,
    externalVerified: ctx.externalVerified === true || discoveredExternalVerified,
    rawCredential
  });
  session.authorization = {
    ...(session.authorization || {}),
    lastRequestClass: stage,
    lastBoundary: boundary.code || 'OK',
    financialExecution: false,
    executionAuthorized: false
  };
  if (!boundary.ok) {
    const reply = assistantMessage('mode-boundary-blocked', {
      code: boundary.code,
      mode: session.mode,
      analysisPermission: false,
      financialExecutionPermission: false,
      externalAgentDiscovery,
      message: boundary.code === 'EXTERNAL_AGENT_NOT_VERIFIED'
        ? 'External Agent mode requires a verified, scoped participant before analysis is admitted.'
        : 'This request is blocked at the mode boundary; no credential or execution permission was granted.'
    });
    session = push(session, reply);
    appendAudit(session, { type: 'mode_boundary', ok: false, code: boundary.code });
    return { session, reply };
  }

  // 1b. Product limits — an over-limit number is never silently clamped. The
  // user gets a friendly warning naming the exact ceiling and is asked to
  // restate the request within the allowed range.
  const limitViolations = parsed.limitViolations
    ?? (parsed.intent ? checkIntentLimits(parsed.intent) : []);
  if (limitViolations.length) {
    session.flow = null;
    session.pendingClarifications = null;
    const reply = assistantMessage('limits-warning', {
      violations: limitViolations,
      limits: INTENT_LIMITS,
      friendly: true,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    appendAudit(session, { type: 'limits_warning', violations: limitViolations.map((v) => v.code) });
    session.memory?.append?.('limits.warned', { violations: limitViolations.map((v) => v.code) });
    return { session, reply };
  }

  // 2. If clarifications are needed, ask without creating an order — one
  // question at a time through the guided flow.
  if (!parsed.ok && parsed.clarifications.length) {
    const flow = createFlowFromParsed(parsed, {
      chainDetector: detectChain,
      tokenNormalizer: normalizeToken,
      // A chain the user named themselves is kept; a chain that only came
      // from the session default is still asked about in the flow.
      explicitChain: Boolean(detectChain(String(parsed?.raw || '')))
    });
    session.flow = flow;
    session = push(session, assistantMessage('clarifications-needed', {
      clarifications: parsed.clarifications,
      signals: parsed.signals,
      mode: session.mode,
      flow: flowQuestionPayload(flow),
      financialExecutionAuthorized: false
    }));
    session.pendingClarifications = { parsed };
    return { session, reply: session.messages.at(-1) };
  }

  const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD']);
  const amountUsd = parsed.intent?.amountUsd ?? ctx.amountUsd
    ?? (parsed.intent?.amount && STABLES.has(parsed.intent?.amountUnit) ? parsed.intent.amount : null);

  // A timed goal that reaches the pipeline becomes a live countdown target
  // for the UI (days / hours / minutes remaining), set when the goal is
  // prepared — and confirmed separately through the authorization screen.
  if (parsed.intent?.kind === 'goal' && Number(parsed.intent.durationHrs) > 0) {
    session = {
      ...session,
      goalDeadline: Date.now() + Number(parsed.intent.durationHrs) * 3_600_000,
      goalMeta: {
        pct: Number.isFinite(Number(parsed.intent.goalPct)) ? Number(parsed.intent.goalPct) : null,
        durationHrs: Number(parsed.intent.durationHrs),
        capital: amountUsd,
        setAt: Date.now()
      }
    };
  }
  return runIntentPipeline(session, parsed, ctx, { capabilityScan, externalAgentDiscovery, stage, amountUsd });
}

/**
 * Strategy → challenge → council → orchestration → drafts. Shared by every
 * path that has a complete, limit-compliant intent. Builds DRAFT artefacts
 * only; the per-action authorization screen is attached to the final reply.
 */
function runIntentPipeline(session, parsed, ctx, env = {}) {
  const { capabilityScan, externalAgentDiscovery, stage } = env;
  const amountUsd = env.amountUsd ?? parsed.intent?.amountUsd ?? ctx.amountUsd;
  const targetReality = parsed.intent?.kind === 'goal'
    ? assessTarget({
      capital: ctx.capitalUsd ?? amountUsd,
      targetPct: parsed.intent.goalPct,
      durationHrs: parsed.intent.durationHrs,
      probabilityPct: ctx.probabilityPct,
      expectedReturnPct: ctx.expectedReturnPct,
      potentialLossPct: ctx.potentialLossPct,
      maximumDrawdownPct: ctx.maximumDrawdownPct,
      confidencePct: ctx.confidencePct
    })
    : null;
  session.targetReality = targetReality;

  // 3. Level 1 and all analysis requests stay analysis-only.
  if (session.level === 1 || parsed.intent.kind === 'analysis') {
    const analysis = formulateStrategies(parsed.intent, ctx);
    session = push(session, assistantMessage('analysis', {
      mode: session.mode,
      modeLabel: session.modeLabel,
      intent: parsed.intent,
      signals: parsed.signals,
      confidence: parsed.confidence,
      research: analysis.evidence,
      suggestions: analysis.proposals.slice(0, 3).map((p) => ({ id: p.id, strategy: p.strategy, description: p.description, risk: p.risk })),
      targetReality,
      capabilityScan,
      externalAgentDiscovery,
      permission: buildPermissionBoundary({ mode: session.mode, request: { ...parsed.intent, stage }, userAuthorized: false }),
      canExecute: false,
      financialExecutionAuthorized: false,
      level: 1
    }));
    session.memory?.append?.('target.assessed', targetReality || { skipped: true });
    session.pendingClarifications = null;
    // Analysis closes any guided flow that produced it.
    session.flow = session.flow ? { ...session.flow, active: false, step: null } : null;
    return { session, reply: session.messages.at(-1) };
  }

  // 4. Level 2/3: prepare quotes and draft orders. Optional capability
  // declines are converted to a safe replan, not a dead-end.
  const levelDisabled = session.level < 3
    ? { futures: false, dydx: false, bridge: false, cex: false, defi: false, externalAgent: false }
    : {};
  const declined = Array.isArray(ctx.declinedCapabilities) ? ctx.declinedCapabilities : [];
  const declinedDisabled = Object.fromEntries(declined.map((id) => [id, false]));
  const disabledCapabilities = { ...levelDisabled, ...declinedDisabled, ...(ctx.disabledCapabilities || {}) };
  const strategies = formulateStrategies(parsed.intent, { ...ctx, disabledCapabilities });
  if (!strategies.proposals.length) {
    const reply = assistantMessage('unable-to-proceed', {
      reasons: ['NO_STRATEGY_AVAILABLE'],
      capabilityScan,
      targetReality,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    appendAudit(session, { type: 'strategy', ok: false, reason: 'NO_STRATEGY_AVAILABLE' });
    return { session, reply };
  }

  const candidate = strategies.proposals.find((p) => p.id === ctx.selectedProposalId) || strategies.proposals[0];
  const highValue = Number(amountUsd) >= Number(ctx.councilThresholdUsd ?? 10000);
  const highRisk = candidate.risk === 'high' || Number(parsed.intent?.goalPct || 0) >= 25 || Number(candidate.leverage || 1) > 1;
  // Low-risk planning can still be reviewed when capability metrics are
  // incomplete; high-risk/high-value decisions require real evidence rather
  // than a guessed green score.
  const evidenceComplete = ctx.evidenceComplete ?? (!highRisk && !highValue ? true : capabilityScan.evidenceComplete > 0);
  const challenge = challengeStrategy(candidate, {
    ...ctx,
    amountUsd,
    unavailableCapabilities: capabilityScan.unavailable.map((row) => row.id),
    evidenceComplete
  });
  const councilRequired = ctx.requireCouncil === true || highValue || highRisk || session.mode === 'ai-ai-inside-fbt';
  const council = councilRequired
    ? runAgentCouncil({
      proposal: candidate,
      context: {
        ...ctx,
        amountUsd,
        unavailableCapabilities: capabilityScan.unavailable.map((row) => row.id),
        evidenceComplete,
        guardianApproved: true,
        riskDecision: ctx.riskDecision
      },
      highValue,
      highRisk
    })
    : null;
  session.challenge = challenge;
  session.council = council;
  session.memory?.append?.('strategy.challenged', { decision: challenge.decision, disagreements: challenge.disagreements });

  if (councilRequired && (!council?.ok || council.decision !== 'APPROVE')) {
    const reply = assistantMessage('strategy-requires-revision', {
      reasons: council?.decision === 'REJECT' ? ['COUNCIL_REJECTED'] : ['COUNCIL_REVISE_REQUIRED'],
      challenge,
      council,
      targetReality,
      capabilityScan,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    appendAudit(session, { type: 'council', ok: false, decision: council?.decision });
    return { session, reply };
  }

  const orch = orchestrate(strategies, session.policy, {
    amountUsd,
    slippagePct: ctx.slippagePct ?? 0.5,
    sessionStartAt: session.policy.sessionStartAt,
    disabledCapabilities,
    selectedProposalId: ctx.selectedProposalId,
    now: Date.now()
  });

  if (!orch.ok) {
    const reply = assistantMessage('unable-to-proceed', {
      reasons: [...(orch.guardian.reasons || []), ...(orch.review || []).filter((r) => r.level === 'block').map((r) => r.code)],
      review: orch.review,
      challenge,
      council,
      capabilityScan,
      targetReality,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    appendAudit(session, { type: 'orchestrate', ok: false, reasons: orch.guardian.reasons });
    return { session, reply };
  }

  // Build DRAFT artefacts only. Nothing in this loop signs or submits.
  const drafts = [];
  for (const step of orch.plan.steps) {
    const d = draftOrderFromPlanStep(step, orch.plan, {
      amountUsd: parsed.intent.amountUsd ?? ctx.amountUsd,
      amountIn: parsed.intent.amount,
      slippagePct: ctx.slippagePct ?? 0.5,
      maxLossUsd: session.policy.maxLossUsd,
      policyId: session.policy.id
    });
    if (d.ok) drafts.push(d.order);
  }
  session.drafts.push(...drafts.map((d) => ({ ...d, sessionId: session.id, planId: orch.plan.planId })));
  session.plans.push(orch.plan);

  const replyKind = session.level === 2 ? 'prepared-draft' : 'ready-for-confirmation';  session.authorization = {
    ...(session.authorization || {}),
    financialExecution: false,
    executionAuthorized: false,
    screenRequired: true,
    userConfirmed: false,
    guardianApproved: orch.guardian.approved,
    state: 'PENDING_USER_AUTHORIZATION'
  };
  session.permissions = {
    ...(session.permissions || {}),
    executionAuthorized: false,
    explanation: 'A proposal, plan or Guardian approval never substitutes for the explicit authorization screen.'
  };
  const agentDialogue = {
    mode: session.mode,
    participants: session.modeDefinition?.participants || ['fbt-strategy', 'fbt-execution'],
    messages: [
      { from: 'fbt.strategy', type: 'proposal', executable: false },
      { from: 'fbt.execution', type: 'independent-review', executable: false },
      { from: 'fbt.guardian', type: 'gate-result', approved: orch.guardian.approved, executable: false }
    ],
    challenge,
    council,
    socialMessagesAreNonExecutable: true
  };

  // Multi-agent routing, made visible in the chat: two independent AI agents
  // (strategy + execution) analyse and debate the best route before the
  // result is announced. Their dialogue is never executable by itself.
  session = push(session, assistantMessage('agents-analyzing', {
    agents: [
      { id: 'fbt.strategy', role: 'STRATEGY_AGENT', identity: STRATEGY_AGENT_IDENTITY },
      { id: 'fbt.execution', role: 'EXECUTION_ORCHESTRATOR', identity: EXECUTION_ORCHESTRATOR_IDENTITY }
    ],
    collaboration: true,
    challengeDecision: challenge?.decision || null,
    councilDecision: council?.decision || null,
    agentDialogue,
    executable: false,
    financialExecutionAuthorized: false
  }));
  session.memory?.append?.('agents.collaborating', { planId: orch.plan.planId, strategy: orch.selected?.strategy });

  // The guided flow now waits for the user's chat confirmation of the
  // announced route ("do you confirm this swap?"). The authorization screen
  // attached to the reply below remains the actual execution boundary.
  session.flow = {
    schema: 'fbt.guided-flow.v1',
    active: true,
    step: 'EXECUTION_CONFIRMATION',
    draftIds: drafts.map((d) => d.id),
    executedDraftIds: [],
    nextIndex: 0,
    planId: orch.plan.planId,
    termsHash: orch.termsHash,
    collected: session.flow?.collected || null,
    tools: session.flow?.collected?.tools || null,
    awaitingSince: Date.now()
  };

  const bestRoute = {
    action: orch.selected?.strategy === 'goal_based_spot' ? 'goal'
      : parsed.intent?.kind === 'bridge' ? 'bridge'
        : parsed.intent?.kind === 'send' ? 'send' : 'swap',
    from: parsed.intent?.fromSymbol || orch.selected?.from || null,
    to: parsed.intent?.toSymbol || orch.selected?.to || null,
    strategy: orch.selected?.strategy || null,
    amountUsd: amountUsd ?? null,
    chainId: parsed.intent?.chainId ?? null,
    goalPct: parsed.intent?.goalPct ?? null,
    durationHrs: parsed.intent?.durationHrs ?? null
  };
  session = push(session, assistantMessage(replyKind, {
    mode: session.mode,
    modeLabel: session.modeLabel,
    intent: parsed.intent,
    selectedStrategy: orch.selected,
    plan: orch.plan,
    drafts: drafts.map((d) => ({
      id: d.id,
      kind: d.kind,
      summary: `${d.fromSymbol} → ${d.toSymbol || ''} ${d.amountIn}`,
      order: { ...d }
    })),
    terms: orch.terms,
    termsHash: orch.termsHash,
    bestRoute,
    goalDeadline: session.goalDeadline || null,
    goalMeta: session.goalMeta || null,
    awaitingChatConfirmation: true,
    targetReality,
    capabilityScan,
    externalAgentDiscovery,
    challenge,
    council,
    agentDialogue,
    authorizationScreen: {
      required: true,
      analysisPermission: true,
      financialExecutionPermission: false,
      buttons: ['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE'],
      guardianApproved: orch.guardian.approved
    },
    canExecute: false,
    financialExecutionAuthorized: false,
    requiresConfirmation: true,
    level: session.level
  }));

  session.memory?.append?.('strategy.proposed', { proposalId: orch.selected?.id, planId: orch.plan.planId, mode: session.mode });
  session.memory?.append?.('authorization.requested', { planId: orch.plan.planId, termsHash: orch.termsHash, financialExecutionAuthorized: false });
  appendAudit(session, { type: 'prepared', ok: true, planId: orch.plan.planId, draftCount: drafts.length, authorizationRequired: true });
  session.pendingClarifications = null;
  return { session, reply: session.messages.at(-1) };
}

/* ------------------------------------------------------------------ */
/* Guided step-by-step flow (see guidedFlow.js for the state machine)  */
/* ------------------------------------------------------------------ */

/**
 * Handle one chat turn while the guided flow is waiting for an answer.
 * The user always keeps two escape hatches: a social message is answered
 * politely (flow preserved), and a complete new request jumps straight to
 * the pipeline (flow abandoned). Limit breaches inside an answer get the
 * same friendly warning as direct input.
 */
function flowTurn(session, text, ctx = {}) {
  const flow = session.flow;
  const fresh = parseUserIntent(text, { defaultChainId: session.defaultChainId, ...ctx });

  // Social message in the middle of the flow: answer it, keep the flow alive.
  if (fresh.intent?.kind === 'conversation' || fresh.intent?.kind === 'help') {
    let replyCode = 'greeting';
    if (fresh.intent?.subType === 'thanks') replyCode = 'thanks';
    else if (fresh.intent?.subType === 'goodbye') replyCode = 'goodbye';
    const reply = assistantMessage('conversation', {
      conversationType: replyCode,
      flow: flowQuestionPayload(flow),
      financialExecutionAuthorized: false
    });
    return { session: push(session, reply), reply };
  }

  if (flow.step === 'EXECUTION_CONFIRMATION') {
    return executionConfirmationTurn(session, text, fresh, ctx);
  }

  // A complete, limit-compliant request bypasses the remaining questions.
  const freshViolations = fresh.limitViolations || [];
  if (!freshViolations.length && fresh.ok && fresh.intent?.kind !== 'analysis') {
    session = { ...session, flow: null, pendingClarifications: null };
    appendAudit(session, { type: 'flow_bypassed', viaStep: flow.step });
    const parsed = fresh.intent ? { ...fresh, intent: { ...fresh.intent, mode: session.mode } } : fresh;
    appendAudit(session, { type: 'parse', ok: parsed.ok, confidence: parsed.confidence, clarifications: parsed.clarifications });
    return respondToParsed(session, parsed, ctx);
  }
  if (!freshViolations.length && fresh.ok && fresh.intent?.kind === 'analysis' && fresh.intent?.action) {
    session = { ...session, flow: null, pendingClarifications: null };
    appendAudit(session, { type: 'flow_bypassed', viaStep: flow.step });
    const parsed = { ...fresh, intent: { ...fresh.intent, mode: session.mode } };
    return respondToParsed(session, parsed, ctx);
  }

  const result = applyFlowAnswer(flow, text, { chainDetector: detectChain, tokenNormalizer: normalizeToken });
  appendAudit(session, { type: 'flow_answer', step: flow.step, ok: result.ok, error: result.error || null });

  if (!result.ok) {
    session = { ...session, flow: result.flow };
    if (result.error === 'OVER_LIMIT') {
      const reply = assistantMessage('limits-warning', {
        violations: result.violations,
        limits: INTENT_LIMITS,
        friendly: true,
        flow: flowQuestionPayload(result.flow),
        financialExecutionAuthorized: false
      });
      session = push(session, reply);
      session.memory?.append?.('limits.warned', { violations: result.violations.map((v) => v.code) });
      return { session, reply };
    }
    const reply = assistantMessage('clarifications-needed', {
      clarifications: ['ANSWER_NOT_UNDERSTOOD'],
      mode: session.mode,
      flow: flowQuestionPayload(result.flow),
      retry: true,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    return { session, reply };
  }

  session = { ...session, flow: result.flow };
  if (!result.done) {
    const reply = assistantMessage('clarifications-needed', {
      clarifications: [],
      mode: session.mode,
      flow: flowQuestionPayload(result.flow),
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    return { session, reply };
  }

  // Flow complete: re-parse the assembled utterance through the SAME
  // auditable parser, then run the normal pipeline. Tools the user did not
  // permit are passed as declined capabilities (safe replan, not a dead-end).
  appendAudit(session, { type: 'flow_completed', task: result.flow.collected.task, chainId: result.flow.collected.chainId });
  session.memory?.append?.('flow.completed', { task: result.flow.collected.task, tools: result.flow.collected.tools });
  const parsedInput = parseUserIntent(result.utterance, { defaultChainId: session.defaultChainId, ...ctx });
  const parsed = parsedInput?.intent
    ? { ...parsedInput, intent: { ...parsedInput.intent, mode: session.mode } }
    : parsedInput;
  appendAudit(session, { type: 'parse', ok: parsed.ok, confidence: parsed.confidence, clarifications: parsed.clarifications, viaFlow: true });
  return respondToParsed(
    { ...session, pendingClarifications: null },
    parsed,
    { ...ctx, declinedCapabilities: declinedFromTools(result.flow.collected.tools) }
  );
}

/**
 * The user answered the "do you confirm this route?" question in chat.
 * "Yes" routes through executeConfirmed — the real Confirmation Gate path —
 * so a chat confirmation can never bypass the per-action screen logic.
 */
function executionConfirmationTurn(session, text, fresh, ctx = {}) {
  const flow = session.flow;
  const decision = detectYesNo(text);

  // A new complete request replaces the pending confirmation entirely.
  if (decision === null && fresh?.ok && fresh.intent?.kind !== 'conversation' && fresh.intent?.kind !== 'help' && fresh.intent?.kind !== 'analysis' && !(fresh.limitViolations || []).length) {
    session = { ...session, flow: null, pendingClarifications: null };
    appendAudit(session, { type: 'execution_confirmation_replaced' });
    const parsed = { ...fresh, intent: { ...fresh.intent, mode: session.mode } };
    return respondToParsed(session, parsed, ctx);
  }

  if (decision === null) {
    const reply = assistantMessage('clarifications-needed', {
      clarifications: ['CONFIRMATION_UNCLEAR'],
      mode: session.mode,
      flow: {
        step: 'EXECUTION_CONFIRMATION',
        pendingConfirm: null,
        collected: flow.collected || {},
        suggestions: [],
        termsHash: flow.termsHash,
        draftIds: flow.draftIds || []
      },
      retry: true,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    return { session, reply };
  }

  if (decision === false) {
    session = { ...session, flow: { ...flow, active: false, step: null, declinedAt: Date.now() } };
    const reply = assistantMessage('execution-declined', {
      termsHash: flow.termsHash,
      planId: flow.planId,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    appendAudit(session, { type: 'execution_declined', planId: flow.planId, termsHash: flow.termsHash });
    session.memory?.append?.('authorization.decided', { kind: 'chat', decision: 'declined', executionAuthorized: false });
    return { session, reply };
  }

  // decision === true → real execution path.
  if (session.level < 3) {
    const reply = assistantMessage('execution-requires-l3', {
      level: session.level,
      preparedOnly: true,
      financialExecutionAuthorized: false
    });
    session = push(session, reply);
    return { session, reply };
  }
  const draftId = flow.draftIds?.[flow.nextIndex ?? 0] || undefined;
  return executeConfirmed(session, { action: 'CONFIRM', draftId, riskInput: ctx.riskInput || {} });
}

/**
 * User answers clarification questions.
 */
export function answerClarifications(session, answers) {
  if (!session.pendingClarifications?.parsed) return { session, reply: assistantMessage('nothing-to-clarify', {}) };
  let serializedAnswers = '';
  try { serializedAnswers = JSON.stringify(answers ?? {}); } catch { serializedAnswers = '[unserializable]'; }
  if (RAW_CREDENTIAL_TEXT.test(serializedAnswers) || /\b(?:seed|mnemonic|credential|private.?key|master.?password|raw.?secret)\b/i.test(serializedAnswers)) {
    // Route a safe sentinel through the same rejection path; the supplied raw
    // answer is never handed to the parser, message list or memory.
    return chatTurn(session, 'private key');
  }
  const refined = refineIntent(session.pendingClarifications.parsed, answers);
  // Answering all clarifications at once ends the one-question-at-a-time
  // flow; the refined intent goes straight through the normal pipeline.
  const next = { ...session, pendingClarifications: null, flow: null };
  const label = refined.intent?.raw || Object.values(answers || {}).filter(Boolean).join(' ') || '(refined)';
  return chatTurn(next, label, { resolvedParsed: refined, resolvedIntent: refined.intent });
}

/**
 * After ConfirmationGate: sign → submit → monitor → reconcile.
 */
export function executeConfirmed(session, { action = 'CONFIRM', riskInput = {}, signer, brokerHandle, idempotencyKey, observation, submitVia = 'wallet', draftId = null } = {}) {
  if (!session || !PRIMARY_MODES.includes(session.mode || 'human-ai')) {
    const err = classifyFailure('INSUFFICIENT_PERMISSION');
    return { session, reply: assistantMessage('error', { code: err.code, translatable: err.translatable }), ok: false, error: err };
  }
  if (session.status === 'STOPPED' || session.policy?.emergencyStop || session.controls?.paused || session.controls?.revoked || session.controls?.disconnected || session.controls?.emergency) {
    const err = classifyFailure('EMERGENCY_STOP');
    session = push(session, assistantMessage('error', { code: err.code, class: err.class, translatable: err.translatable }));
    return { session, reply: session.messages.at(-1), ok: false, error: err };
  }

  // A caller cannot turn a draft, Guardian approval or policy confirmation
  // into an execution authorization by invoking this function directly. The
  // per-action authorization screen emitted by chatTurn must exist, and the
  // caller must submit one of its explicit decisions. `confirmAndSubmit`
  // performs the immutable Confirmation Gate check again immediately before
  // signing/submitting; this earlier check closes the screen-bypass path.
  const requestedAction = String(action || '').toUpperCase();
  const authorizationMessage = [...(session.messages || [])].reverse().find((message) => (
    message?.payload?.authorizationScreen?.required === true
    && message?.payload?.termsHash
  ));
  const screen = authorizationMessage?.payload?.authorizationScreen;
  const screenIsValid = session.authorization?.screenRequired === true
    && screen?.financialExecutionPermission === false
    && Array.isArray(screen?.buttons)
    && screen.buttons.includes(requestedAction);
  if (!screenIsValid) {
    const err = classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'AUTHORIZATION_SCREEN_NOT_CONFIRMED' });
    session = push(session, assistantMessage('error', {
      code: err.code,
      translatable: err.translatable,
      authorizationScreenRequired: true,
      financialExecutionAuthorized: false
    }));
    appendAudit(session, {
      type: 'authorization_screen',
      ok: false,
      action: requestedAction,
      reason: 'AUTHORIZATION_SCREEN_NOT_CONFIRMED'
    });
    return { session, reply: session.messages.at(-1), ok: false, error: err };
  }
  appendAudit(session, {
    type: 'authorization_screen',
    ok: true,
    action: requestedAction,
    confirmed: requestedAction === 'CONFIRM',
    termsHash: authorizationMessage.payload.termsHash
  });
  // A guided flow (or the interactive confirmation screen) may target a
  // specific draft of a multi-step plan; without a target the last draft is
  // used, exactly as before.
  const draft = (draftId && session.drafts.find((d) => d.id === draftId)) || session.drafts[session.drafts.length - 1];
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
  session = {
    ...session,
    execution: { submitted, receipt: rec.receipt },
    authorization: {
      ...(session.authorization || {}),
      financialExecution: true,
      executionAuthorized: true,
      userConfirmed: true,
      state: 'ACTION_CONFIRMED_AND_SUBMITTED'
    },
    permissions: {
      ...(session.permissions || {}),
      executionAuthorized: true
    }
  };
  session.memory?.append?.('execution.completed', { status: rec.receipt?.status, confirmed: rec.receipt?.confirmed === true, fabricated: false });
  session = push(session, assistantMessage(type, {
    status: rec.receipt?.status,
    confirmed: rec.receipt?.confirmed === true,
    partial: !!rec.partial,
    filledAmount: rec.receipt?.filledAmount,
    fabricated: false,
    translatable: rec.error?.translatable || 'intentAi.status.ok'
  }));

  // Guided-flow bookkeeping: a multi-step plan (e.g. swap then bridge)
  // continues with its next step. Each next step gets its own authorization
  // screen with its own terms hash — execution never chains silently.
  session = advanceFlowAfterExecution(session, draft?.id);
  return { session, reply: session.messages.at(-1), ok: rec.ok, receipt: rec.receipt };
}

/**
 * After a successful execution: mark the executed draft, and when the flow
 * still has pending steps, announce the next step together with a fresh
 * authorization screen. The flow then waits for another explicit
 * confirmation in chat (or via the interactive screen) before it runs.
 */
function advanceFlowAfterExecution(session, executedDraftId) {
  const flow = session.flow;
  if (!flow || flow.step !== 'EXECUTION_CONFIRMATION') return session;
  const executed = [...(flow.executedDraftIds || []), executedDraftId].filter(Boolean);
  const nextIndex = (flow.nextIndex || 0) + 1;
  const remainingIds = (flow.draftIds || []).slice(nextIndex);
  if (!remainingIds.length) {
    return {
      ...session,
      flow: { ...flow, executedDraftIds: executed, nextIndex, active: false, step: null, completedAt: Date.now() }
    };
  }
  const nextDraft = session.drafts.find((d) => d.id === remainingIds[0]);
  if (!nextDraft) {
    return {
      ...session,
      flow: { ...flow, executedDraftIds: executed, nextIndex, active: false, step: null, completedAt: Date.now() }
    };
  }
  const nextTerms = termsFromDraft(nextDraft);
  const nextHash = termsFingerprint(nextTerms);
  const updated = {
    ...session,
    flow: {
      ...flow,
      executedDraftIds: executed,
      nextIndex,
      step: 'EXECUTION_CONFIRMATION',
      termsHash: nextHash,
      active: true
    }
  };
  return push(updated, assistantMessage('next-step-ready', {
    planId: flow.planId,
    step: nextIndex + 1,
    totalSteps: (flow.draftIds || []).length,
    draft: {
      id: nextDraft.id,
      kind: nextDraft.kind,
      fromSymbol: nextDraft.fromSymbol,
      toSymbol: nextDraft.toSymbol,
      amountIn: nextDraft.amountIn,
      chainId: nextDraft.chainId
    },
    termsHash: nextHash,
    authorizationScreen: {
      required: true,
      analysisPermission: true,
      financialExecutionPermission: false,
      buttons: ['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE'],
      guardianApproved: true
    },
    awaitingChatConfirmation: true,
    financialExecutionAuthorized: false
  }));
}

/**
 * Confirm the L3 policy preview (user taps CONFIRM & START).
 */
export function confirmSessionPolicy(session, now = Date.now()) {
  if (!session.policy) return { session, ok: false, reason: 'NO_POLICY' };
  const confirmed = confirmPolicy(session.policy, now);
  if (!confirmed) return { session, ok: false, reason: 'INVALID_POLICY' };
  session = {
    ...session,
    policy: confirmed,
    status: 'ACTIVE',
    authorization: {
      ...(session.authorization || {}),
      userConfirmed: true,
      financialExecution: false,
      executionAuthorized: false,
      state: 'POLICY_CONFIRMED_ACTION_AUTH_STILL_REQUIRED'
    },
    permissions: {
      ...(session.permissions || {}),
      financialExecution: true,
      executionAuthorized: false
    }
  };
  session = push(session, systemMessage('policy.confirmed', { policyId: confirmed.id, financialExecutionStillRequiresActionScreen: true }));
  session.memory?.append?.('authorization.decided', { kind: 'policy', decision: 'confirmed', executionAuthorized: false });
  appendAudit(session, { type: 'policy_confirmed', policyId: confirmed.id, executionAuthorization: 'pending-per-action-screen' });
  return { session, ok: true };
}

/**
 * User-facing STOP, PAUSE, REVOKE, DISCONNECT and EMERGENCY EXIT controls.
 * Controls are not social messages and cannot be overridden by an Agent.
 */
export function userControl(session, action, now = Date.now()) {
  const value = String(action || '').toUpperCase();
  if (value === 'STOP' || value === 'KILL_SWITCH' || value === 'EMERGENCY_EXIT') return userStop(session, now);
  const result = applyControl(session?.controls || createControlState(), value);
  if (!result.ok) return { session, ok: false, error: result.code };
  let updated = { ...session, controls: result.controls };
  updated = push(updated, systemMessage('control.changed', { action: value, controls: result.controls }));
  updated.memory?.append?.('control.changed', { action: value, controls: result.controls });
  appendAudit(updated, { type: 'control_changed', action: value });
  return { session: updated, ok: true, action: value };
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
  const control = applyControl(session.controls || createControlState(), 'EMERGENCY_EXIT');
  const updated = {
    ...session,
    policy: stopped,
    status: 'STOPPED',
    execution: null,
    flow: { ...(session.flow || {}), active: false, step: null, stoppedAt: now },
    controls: control.controls
  };
  const withMsg = push(updated, systemMessage('emergency_stop.triggered', { at: now, controls: control.controls }));
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
