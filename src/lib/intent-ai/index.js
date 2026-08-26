/**
 * FBT INTENT AI — Phase 1: Intent Foundation
 * ---------------------------------------------------------------------------
 * Public API surface. Everything exported here is a deterministic,
 * pure-function module with no network access, no wallet access, and no
 * secret material. Execution adapters (broker / wallet / CEX / DEX) live
 * in later phases and must route through Guardian.
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

export const INTENT_AI_VERSION = 'phase2.controlled-execution.v1';
