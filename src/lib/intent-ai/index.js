/**
 * FBT INTENT AI — Phases 1-9
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
  userControl,
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

// ── Phase 9: Intent AI OS contracts ────────────────────────────────────────
export {
  PRIMARY_MODES,
  MODE_LABELS,
  MODE_DEFINITIONS,
  modeLabel,
  REQUEST_CLASSES,
  SESSION_MODE_SCHEMA,
  isPrimaryMode,
  normalizePrimaryMode,
  normalizeMode,
  modeDefinition,
  classifyPermissionRequest,
  classifyRequest,
  permissionRequirement,
  buildPermissionBoundary,
  canAnalyze as modeCanAnalyze,
  canPrepare as modeCanPrepare,
  canExecute as modeCanExecute,
  assertModeBoundary,
  createModeSession,
  modeCapabilitySummary
} from './sessionModes.js';
export {
  CAPABILITY_CATALOG,
  CAPABILITY_SCORING,
  CAPABILITY_SCANNER_SCHEMA,
  CAPABILITY_SCAN_SCHEMA,
  CAPABILITY_SCORE_SCHEMA,
  scanCapabilities,
  scoreCapability,
  capabilityScore,
  recommendOptionalCapabilities,
  replanAfterCapabilityDecline,
  capabilityById
} from './capabilityScanner.js';
export {
  TARGET_REALITY_SCHEMA,
  TARGET_DISCLAIMERS,
  assessTarget,
  realityChoice
} from './targetReality.js';
export {
  COUNCIL_SCHEMA,
  CHALLENGE_SCHEMA,
  COUNCIL_ROLES,
  challengeStrategy,
  runAgentCouncil,
  councilDecisionAllowsReview
} from './agentCouncil.js';
export {
  GENOME_SCHEMA,
  GENOME_DIMENSIONS,
  createIntentGenome,
  rejectSecretGenomeInput,
  matchIntentDNA,
  evolveIntentGenome
} from './intentGenome.js';
export {
  MEMORY_SCHEMA as INTENT_AGENT_MEMORY_SCHEMA,
  EVENT_TYPES,
  createMemoryStore,
  buildLearningBatch,
  feedbackFromDecision
} from './agentMemory.js';
export {
  POLICY_SCHEMA as INTENT_OS_POLICY_SCHEMA,
  CONTROL_SCHEMA,
  DEFAULT_POLICY as INTENT_OS_DEFAULT_POLICY,
  normalizePolicy as normalizeIntentOSPolicy,
  evaluatePolicy,
  createControlState,
  applyControl,
  feeTransparency
} from './policyGuard.js';
export {
  EXTERNAL_AGENT_TRUST_SCHEMA,
  EXTERNAL_AGENT_PASSPORT_SCHEMA,
  EXTERNAL_AGENT_DISCOVERY_SCHEMA,
  EXTERNAL_AGENT_SECURITY_SCHEMA,
  EXTERNAL_AGENT_SANDBOX_SCHEMA,
  EXTERNAL_AGENT_HANDSHAKE_SCHEMA,
  EXTERNAL_AGENT_REPUTATION_SCHEMA,
  EXTERNAL_AGENT_RATING_SCHEMA,
  EXTERNAL_AGENT_SCOPE_SCHEMA,
  EXTERNAL_AGENT_SANDBOX_STAGES,
  EXTERNAL_AGENT_REPUTATION_CATEGORIES,
  EXTERNAL_AGENT_REQUIRED_PERMISSIONS,
  sanitizeExternalAgentPassport,
  passportFromCatalog,
  evaluateExternalAgentSecurity,
  discoverExternalAgents,
  createExternalAgentSandbox,
  advanceExternalAgentSandbox,
  createExternalAgentHandshake,
  externalAgentHandshakeTurn,
  handshakeTranscript,
  buildExternalAgentReputation,
  createBidirectionalAgentRating,
  authorizeExternalAgentScope,
  revokeExternalAgentScope
} from './externalAgentTrust.js';

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

// ── Phase 11: strategy competition and simulation ───────────────────────────
export {
  STRATEGY_PROPOSAL_SCHEMA,
  STRATEGY_SIMULATION_SCHEMA,
  STRATEGY_COMPETITION_SCHEMA,
  STRATEGY_MONITOR_SCHEMA,
  STRATEGY_SWITCH_SCHEMA,
  generateStrategies,
  compareStrategies,
  simulateRoute,
  competeStrategies,
  explainStrategyComparison,
  explainStrategy,
  switchStrategy,
  monitorStrategy,
  replanAfterCapabilityDecline as replanAfterStrategyCapabilityDecline
} from './strategyCompetition.js';

// ── Phase 12: Smart Wallet, Guardian and policy ─────────────────────────────
export {
  SMART_WALLET_POLICY_SCHEMA,
  GUARDIAN_DECISION_SCHEMA,
  FEE_SHEET_SCHEMA,
  AUTHORIZATION_SCREEN_SCHEMA,
  AUTHORIZATION_SCHEMA,
  CONTROLS_SCHEMA,
  FEE_TYPES,
  createSmartWalletPolicy,
  validateSmartWalletPolicy,
  evaluateSmartWalletPolicy,
  buildFeeSheet,
  guardianDecision,
  createAuthorizationScreen,
  confirmAuthorization,
  authorizeFinancialExecution,
  createControls,
  applyControl as applySmartWalletControl,
  controlsAreBlocking,
  policyPublicSummary
} from './smartWalletPolicy.js';

// ── Phase 13: live and recurring intent lifecycle ───────────────────────────
export {
  LIVE_INTENT_SCHEMA,
  RECURRING_INTENT_SCHEMA,
  INTENT_TIMELINE_SCHEMA,
  INTENT_RESULT_SCHEMA,
  LIVE_INTENT_STATUSES,
  TERMINAL_LIVE_STATUSES,
  LIVE_TRANSITIONS,
  createLiveIntent,
  createRecurringIntent,
  transitionLiveIntent,
  finalizeLiveIntent,
  recordLiveFailure,
  monitorLiveIntent,
  prepareRecurringRun,
  applyLiveControl,
  finalResult
} from './liveRecurringIntents.js';

// ── Phase 14: Intent Genome and local-first memory ──────────────────────────
export {
  INTENT_GENOME_SCHEMA,
  GENOME_MATCH_SCHEMA,
  GENOME_EVOLUTION_SCHEMA,
  LOCAL_MEMORY_SCHEMA,
  MEMORY_EVENT_SCHEMA,
  LEARNING_BATCH_SCHEMA,
  GENOME_DIMENSIONS as PHASE14_GENOME_DIMENSIONS,
  createIntentGenome as createPhase14IntentGenome,
  rejectSecretGenomeInput as rejectPhase14SecretGenomeInput,
  matchIntentGenome,
  evolveIntentGenome as evolvePhase14IntentGenome,
  redactMemoryEvent,
  createLocalFirstMemory,
  buildLearningBatch as buildPhase14LearningBatch,
  localMemoryCapabilities
} from './intentGenomeMemory.js';

// ── Phase 15: External Agent runtime ───────────────────────────────────────
export {
  EXTERNAL_RUNTIME_SCHEMA,
  RUNTIME_SESSION_SCHEMA,
  CAPABILITY_NEGOTIATION_SCHEMA,
  RUNTIME_REQUEST_SCHEMA,
  RUNTIME_EVENT_SCHEMA,
  createExternalAgentRuntime,
  validateExternalRuntimeRequest
} from './externalAgentRuntime.js';

// ── Phase 16: execution adapter activation ─────────────────────────────────
export {
  EXECUTION_ADAPTER_SCHEMA,
  ADAPTER_READINESS_SCHEMA,
  TRANSACTION_SIMULATION_SCHEMA,
  EXECUTION_ATTEMPT_SCHEMA,
  ADAPTER_KINDS,
  verifyTransactionRequest,
  checkAdapterReadiness,
  simulateTransaction,
  executeWithAdapter,
  clearExecutionIdempotency,
  adapterStatus
} from './executionAdapters.js';

// ── Phase 17: on-chain policy enforcement ──────────────────────────────────
export {
  ONCHAIN_POLICY_SCHEMA,
  DEPLOYMENT_EVIDENCE_SCHEMA,
  ONCHAIN_EVALUATION_SCHEMA,
  POLICY_MIGRATION_SCHEMA,
  ONCHAIN_REVOKE_SCHEMA,
  verifyPolicyDeployment,
  evaluateOnchainPolicy,
  migrateOnchainPolicy,
  revokeOnchainSession,
  onchainPolicyStatus
} from './onchainPolicy.js';

// ── Phase 18: observability and proof ───────────────────────────────────────
export {
  AUDIT_TIMELINE_SCHEMA,
  AUDIT_EVENT_SCHEMA,
  RECEIPT_INTEGRITY_SCHEMA,
  EXECUTION_PROOF_SCHEMA as PHASE18_EXECUTION_PROOF_SCHEMA,
  INCIDENT_SCHEMA,
  RECOVERY_SCHEMA,
  contentHash,
  createAuditTimeline,
  verifyAuditTimeline,
  createExecutionReceipt,
  verifyExecutionReceipt,
  whyEngine,
  classifyIncident,
  recoverExecution,
  disasterRecoveryStatus
} from './observabilityProof.js';

// ── Phase 19: security, privacy and compliance ─────────────────────────────
export {
  SECURITY_COMPLIANCE_SCHEMA,
  THREAT_MODEL_SCHEMA,
  PRIVACY_BOUNDARY_SCHEMA,
  SECURITY_EVENT_SCHEMA,
  COMPLIANCE_SCHEMA,
  INDEPENDENT_REVIEW_SCHEMA,
  THREAT_CATEGORIES,
  containsSecuritySecret,
  sanitizeSecurityPayload,
  validatePrivacyBoundary,
  createSecurityAuditEvent,
  buildThreatModel,
  independentReviewStatus,
  complianceChecklist,
  securityPosture,
  securityBoundaryForApi,
  retentionPolicy
} from './securityCompliance.js';

// ── Phase 20: launch and governance ─────────────────────────────────────────
export {
  RELEASE_MANIFEST_SCHEMA,
  MIGRATION_SCHEMA,
  ROLLBACK_SCHEMA,
  SLO_SCHEMA,
  CHANGE_CONTROL_SCHEMA,
  LAUNCH_GATE_SCHEMA,
  PUBLIC_STATUS_SCHEMA,
  GOVERNANCE_SCHEMA,
  createReleaseManifest,
  validateReleaseManifest,
  createMigrationPlan,
  createRollbackPlan,
  defineSLO,
  approveChange,
  evaluateLaunchGate,
  publicStatusPage,
  governanceStatus,
  launchChecklist
} from './launchGovernance.js';

export const INTENT_AI_VERSION = 'phase20.specification-contracts.partial.v2';
