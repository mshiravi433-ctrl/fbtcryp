/**
 * FBT INTENT AI — Phases 1-8
 * ---------------------------------------------------------------------------
 * Public client API surface. Everything exported here is deterministic and
 * carries no raw credential material. Server-only Secret Manager and
 * activation boundaries stay outside this browser bundle; execution adapters
 * must route through Guardian, Risk and the Confirmation Gate.
 */

// Permission model & levels
export {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_NAMES,
  DEFAULT_POLICY_CAPS,
  sanitizePolicy,
  canPrepare,
  canExecute,
  describeLevel,
  ALLOWED_CHAINS,
  ALLOWED_PROTOCOLS
} from './permissions.js';

// Policy (session-scoped, user-confirmed authorization)
export {
  POLICY_SCHEMA,
  createPolicy,
  confirmPolicy,
  triggerEmergencyStop,
  policyIsValid,
  policyPreview,
  savePolicy,
  loadPolicies,
  loadPolicy,
  deletePolicy,
  policyAuditSummary
} from './policyModel.js';

// Intent Parser (natural language → structured intent)
export {
  parseUserIntent,
  refineIntent
} from './intentParser.js';

// Guardian (independent, non-disableable pre-execution gate)
export {
  guardianReview,
  emergencyStopCheck,
  GUARDIAN_NON_DISABLEABLE
} from './guardian.js';

// Strategy Agent (Agent 1 — research & proposals)
export {
  STRATEGY_AGENT_ID,
  STRATEGY_AGENT_IDENTITY,
  formulateStrategies,
  strategySocial
} from './strategyAgent.js';

// Execution Orchestrator (Agent 2 — builds plans, never signs)
export {
  EXECUTION_ORCHESTRATOR_ID,
  EXECUTION_ORCHESTRATOR_IDENTITY,
  reviewProposal,
  buildExecutionPlan,
  orchestrate,
  orchestratorSocial
} from './executionOrchestrator.js';

// Draft Orders (LEVEL 2 PREPARE artefacts)
export {
  DRAFT_ORDER_SCHEMA,
  createDraftOrder,
  draftOrderFromPlanStep,
  confirmationSummary
} from './draftOrder.js';

// Human ↔ AI session (Mode A)
export {
  startSession,
  chatTurn,
  answerClarifications,
  confirmSessionPolicy,
  userStop,
  STRATEGY_AGENT_IDENTITY as _STRATEGY_AGENT_IDENTITY,
  EXECUTION_ORCHESTRATOR_IDENTITY as _EXECUTION_ORCHESTRATOR_IDENTITY
} from './humanAi.js';

// Agent Social Protocol (Mode B agent-to-agent)
export {
  SOCIAL_TYPES,
  isSocialType,
  socialMessage,
  agentHandshake
} from './socialProtocol.js';

// Stickers (UI reactions — never commands)
export {
  STICKERS,
  isSafeSticker,
  stickerEmoji,
  stickerMessage,
  safeSticker
} from './stickers.js';

// Audit log (append-only, local-first)
export {
  AUDIT_SCHEMA,
  audit,
  persistAuditEntries,
  loadGlobalAudit,
  clearGlobalAudit,
  exportAudit,
  auditStats
} from './audit.js';

/** Version sentinel for UI & telemetry. */
export {
  openConfirmationGate,
  decideGate,
  assertGateAllowsSubmit,
  termsFromDraft,
  materialDelta
} from './confirmationGate.js';
export { evaluateRisk } from './riskEngine.js';
export { issueSessionKey, revokeSessionKey, scopeFor, revokeAllForPolicy } from './sessionKeys.js';
export { signDraft } from './walletAdapter.js';
export { brokerSubmit, bindBrokerHandle } from './brokerAdapter.js';
export { createMonitor, heartbeat } from './executionMonitor.js';
export { evaluateExit } from './exitPolicy.js';
export { reconcile } from './reconciliation.js';
export { classifyFailure, FAILURE_CLASSES } from './failureModes.js';
export { buildConfirmationBlock, GATE_BUTTONS } from './confirmationUI.js';
export { prepareExecution, confirmAndSubmit, observeAndReconcile, emergencyHalt } from './controlledExecution.js';
export { executeConfirmed } from './humanAi.js';

// ── Phase 3: Multi-Agent Ecosystem ──────────────────────────────────────────
export {
  issueCapabilityToken,
  revokeCapabilityToken,
  revokeAllForPolicy as revokeAllCapabilityTokensForPolicy,
  scopeCapabilityToken,
  tokenHasForbiddenKey,
  FORBIDDEN_CAPABILITY_TOKENS,
  ALLOWED_CAPABILITY_TOKENS
} from './capabilityToken.js';
export {
  registerAgent,
  registerInternalAgent,
  deregisterAgent,
  getAgent,
  listAgents,
  isVerified,
  matchAgent,
  assertAgentForExecute,
  DIRECTORY_IS_SELF_REPORTED
} from './agentDirectory.js';
export {
  coordinateMultiAgent,
  multiAgentHandshake,
  emergencyStopAllForPolicy,
  MULTIAGENT_SCHEMA
} from './multiAgentOrchestrator.js';
export {
  recordLearningSample,
  loadLearningSamples,
  clearLearningSamples,
  learningConsent,
  LEARNING_SCHEMA
} from './learningOptIn.js';

// ── Phase 4: Agent Scoring & Specialist Marketplace ─────────────────────────
export {
  observedScore,
  scoreDisplayLabel,
  MIN_OBSERVED_SAMPLE_SIZE,
  AGENT_SCORE_SCHEMA,
  SCORE_IS_OBSERVED,
  SCORE_NEVER_VERIFIES
} from './agentScore.js';
export {
  listSpecialists,
  quote as specialistQuote,
  hire as hireSpecialist,
  MARKET_SCHEMA
} from './specialistMarket.js';
export {
  createCollaborationSession,
  collaborationTurn,
  readCollaborationTranscript,
  isExecutableMessage,
  COLLAB_SCHEMA
} from './collaborationSession.js';

// ── Phase 5: Local-First Adaptive Learning ──────────────────────────────────
export {
  loadMemory,
  memoryStats,
  clearMemory,
  memoryCapabilities,
  rememberOutcome,
  MEMORY_SCHEMA,
  MAX_MEMORY_RECORDS
} from './adaptiveMemory.js';
export {
  refineStrategies,
  MAX_REFINED_CONFIDENCE,
  REFINE_NUDGE_CAP,
  REFINE_DISCLAIMERS,
  REFINE_SCHEMA
} from './strategyRefine.js';
export {
  buildConfidentialEnvelope,
  redactForCollab,
  carriesSecret,
  confidentialCapabilities,
  CONFIDENTIAL_COLLAB_SCHEMA
} from './confidentialCollab.js';

// ── Phase 6: Live Adapter Wiring (honest, fail-closed) ─────────────────────
export {
  routeForDraft,
  chainSupportedForSwap,
  venueReadiness,
  LIVE_VENUES
} from './liveRouterBridge.js';
export { venueHealth } from './venueHealth.js';
export { submitPipeline } from './submitPipeline.js';

export const INTENT_AI_VERSION = 'phase8.production-activation.v1';
