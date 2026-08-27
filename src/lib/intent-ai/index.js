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
  refineIntent,
  detectChain,
  normalizeToken
} from './intentParser.js';

// User-facing financial & time limits + guided step-by-step chat flow
export { INTENT_LIMITS, MAX_GOAL_DURATION_HRS, checkIntentLimits, usdValueOf, limitHintFor } from './intentLimits.js';
export {
  FLOW_SCHEMA,
  FLOW_STEPS,
  FLOW_CHAIN_SUGGESTIONS,
  FLOW_TASK_SUGGESTIONS,
  FLOW_TOOL_SUGGESTIONS,
  createFlowFromParsed,
  applyFlowAnswer,
  flowQuestionPayload,
  assembleUtterance,
  declinedFromTools,
  detectYesNo
} from './guidedFlow.js';

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

// ── Phases 51-57: real execution ────────────────────────────────────────────
// Phase 51 — a connected wallet becomes the actual signer.
export {
  WALLET_RUNTIME_SCHEMA,
  describeWalletRuntime,
  intentOrderTypedData,
  signIntentWithWallet,
  signerFromWalletSignature,
  resolveExecutionSigner,
  createEip1193Broadcaster,
  stubSigner,
  stubSignerAllowed,
  isStubSigner
} from './walletRuntime.js';
// Phase 52 — live quote locked into the terms + slippage re-check.
export {
  LIVE_QUOTE_SCHEMA,
  QUOTE_MAX_AGE_MS,
  DEFAULT_MAX_SLIPPAGE_PCT,
  normalizeQuote,
  fetchExecutionQuote,
  lockQuoteIntoTerms,
  effectiveSlippageLimit,
  recheckQuoteBeforeExecute
} from './liveQuote.js';
// Phase 53 — real broadcast and block-by-block tracking.
export {
  BROADCAST_SCHEMA,
  TX_STATUSES,
  normalizeTxHash,
  broadcastSigned,
  trackTransaction,
  receiptStatusFor
} from './broadcastAdapter.js';
// Phase 54 — bridge execution behind its own explicit approval.
export {
  BRIDGE_EXECUTION_SCHEMA,
  bridgeWired,
  bridgeHealth,
  assertBridgeApproval,
  executeBridge,
  trackBridgeDelivery
} from './bridgeExecution.js';
// Phase 55 — MEV / slippage shield.
export {
  MEV_SHIELD_SCHEMA,
  DEFAULT_DEADLINE_SECS,
  HARD_MAX_SLIPPAGE_PCT,
  SUBMISSION_CHANNELS,
  applyMevShield,
  assertProtected,
  shieldTransaction
} from './mevShield.js';
// Phase 56 — honest receipt error taxonomy + session-policy ceilings.
export {
  RECEIPT_REASONS,
  RECEIPT_REASON_SCHEMA,
  sessionPolicyCaps,
  checkSessionPolicy,
  explainExecutionFailure,
  receiptStatusForReason,
  normalizeGuardianReasons,
  guardianReasonsFromError
} from './executionErrorTaxonomy.js';
// Phase 57 — live DCA trigger.
export {
  LIVE_DCA_SCHEMA,
  DCA_HALT_REASONS,
  armLiveDcaProgram,
  assertDcaAuthorization,
  tickLiveDca,
  stopLiveDca
} from './liveDcaTrigger.js';

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

export {
  OPERATIONAL_EVIDENCE_SCHEMA,
  OPERATIONAL_READINESS_SCHEMA,
  PHASE21_SCHEMA,
  EVIDENCE_KINDS,
  CRITICAL_FAILURE_CODES,
  normalizeEvidence,
  verifyCertificateAuthority,
  verifySandboxOperator,
  verifySimulator,
  verifyMonitor,
  verifyScheduler,
  verifySmartWalletAndGuardian,
  verifySigner,
  verifyProviderHealth,
  verifyRpcAndContract,
  verifyAuditIntegrity,
  verifyBackupRestore,
  verifyIndependentReview,
  verifyReproducibleBuild,
  verifyRollbackDrill,
  verifySloMeasurement,
  aggregateOperationalReadiness,
  phase21PublicStatus
} from './operationalActivation.js';

export {
  PHASE22_SCHEMA,
  operateDurableRegistry,
  operateCertificateAuthority,
  revokeCertificate,
  handshakeWithCertificate,
  evaluateRegistryCaPlane
} from './phase22RegistryCaOps.js';
export {
  PHASE23_SCHEMA,
  SANDBOX_STAGES,
  runSandboxMesh,
  auditSandboxStage,
  evaluateSandboxMeshPlane
} from './phase23SandboxMesh.js';
export {
  PHASE24_SCHEMA,
  operateSimulator,
  operateMonitor,
  operateScheduler,
  interpretQuote,
  evaluateSimMonitorPlane
} from './phase24SimMonitorOps.js';
export {
  PHASE25_SCHEMA,
  FEE_CATEGORIES,
  operateSmartWallet,
  operateProductionSigner,
  authorizationFeesPresent,
  evaluateSignerGuardianPlane
} from './phase25SignerGuardianOps.js';
export {
  PHASE26_SCHEMA,
  ADAPTERS as VENUE_ADAPTERS,
  federateVenueHealth,
  quoteVenueOnly,
  evaluateVenueFederationPlane
} from './phase26VenueFederation.js';
export {
  PHASE27_SCHEMA,
  operateRpcQuorum,
  enforceOnchainPolicy,
  evaluateRpcPolicyPlane
} from './phase27RpcPolicyOps.js';
export {
  PHASE28_SCHEMA,
  operateImmutableAudit,
  operateBackupRestore,
  evaluateAuditDrPlane
} from './phase28AuditDrOps.js';
export {
  PHASE29_SCHEMA,
  THREATS,
  operateAssurance,
  evaluateAssurancePlane
} from './phase29AssuranceNetwork.js';
export {
  PHASE30_SCHEMA,
  LAUNCH_BANNER,
  evaluateLaunchControlPlane,
  applyLaunchControl,
  evaluateLaunchPlane
} from './phase30LaunchControlPlane.js';
export {
  CONTROL_PLANE_SCHEMA,
  activateControlPlane,
  controlPlaneRow
} from './controlPlaneActivation.js';
export { PHASE31_SCHEMA, operateIncidentCommand, evaluateIncidentCommandPlane } from './phase31IncidentCommand.js';
export { PHASE32_SCHEMA, operateSecretRotation, evaluateSecretRotationPlane } from './phase32SecretRotation.js';
export { PHASE33_SCHEMA, operateFailover, evaluateFailoverCapacityPlane } from './phase33FailoverCapacity.js';
export { PHASE34_SCHEMA, operateAbuseLimits, evaluateAbuseRateLimitPlane } from './phase34AbuseRateLimits.js';
export { PHASE35_SCHEMA, operatePublicDisclosure, evaluatePublicDisclosurePlane } from './phase35PublicDisclosure.js';
export { PHASE36_SCHEMA, operateResidencyHold, evaluateResidencyHoldPlane } from './phase36ResidencyLegalHold.js';
export { PHASE37_SCHEMA, operateDependencyAttestation, evaluateDependencyAttestationPlane } from './phase37DependencyAttestation.js';
export { PHASE38_SCHEMA, operateContinuousVerification, evaluateContinuousVerificationPlane } from './phase38ContinuousVerification.js';
export { PHASE39_SCHEMA, operateGameDay, evaluateGameDayPlane } from './phase39GameDayRehearsal.js';
export { PHASE40_SCHEMA, operateSustainment, evaluateSustainmentPlane } from './phase40SustainmentGovernance.js';
export { PHASE41_SCHEMA, operateReleaseTrain, evaluateReleaseTrainPlane } from './phase41ReleaseTrain.js';
export { PHASE42_SCHEMA, operateBreakGlass, evaluateBreakGlassPlane } from './phase42BreakGlassSupport.js';
export { PHASE43_SCHEMA, operateCostKillSpend, evaluateCostKillSpendPlane } from './phase43CostKillSpend.js';
export { PHASE44_SCHEMA, operateWorkforceAccess, evaluateWorkforceAccessPlane } from './phase44WorkforceAccess.js';
export { PHASE45_SCHEMA, operateTelemetryIntegrity, evaluateTelemetryIntegrityPlane } from './phase45TelemetryIntegrity.js';
export { PHASE46_SCHEMA, operateModelSupplyChain, evaluateModelSupplyChainPlane } from './phase46ModelSupplyChain.js';
export { PHASE47_SCHEMA, operateAgentFleet, evaluateAgentFleetPlane } from './phase47AgentFleetGov.js';
export { PHASE48_SCHEMA, operateCapitalBond, evaluateCapitalBondPlane } from './phase48CapitalBondOps.js';
export { PHASE49_SCHEMA, operateRegulatoryReporting, evaluateRegulatoryReportingPlane } from './phase49RegulatoryReporting.js';
export { PHASE50_SCHEMA, operateProgramControl, evaluateProgramControlPlane } from './phase50ProgramControl.js';

// ── Spec 65 gap-fill: contracts for every incomplete specification item ────
// These are honest contracts: they fill specification gaps without claiming
// operational activation. Evidence stays required; nothing here is live.
export {
  GOAL_NEGOTIATION_SCHEMA,
  GOAL_NEGOTIATION_OPTIONS,
  negotiateGoal,
  applyGoalChoice,
  negotiationGrantsExecution
} from './goalNegotiation.js';
export {
  COST_TO_GOAL_SCHEMA,
  NET_OUTCOME_SCHEMA,
  COST_CLASSES,
  computeCostToGoal,
  predictNetOutcome
} from './costToGoal.js';
export {
  WHY_DECISION_SCHEMA,
  WHY_PERMISSION_SCHEMA,
  PERMISSION_REQUESTING_CAPABILITIES,
  whyThisDecision,
  whyThisPermission
} from './whyTransparency.js';
export {
  SHADOW_RUN_SCHEMA,
  SHADOW_RUN_STATUSES,
  createShadowRun,
  advanceShadowRun,
  paperToRealRequirements
} from './shadowExecution.js';
export {
  CAPABILITY_ACTIVATION_SCHEMA,
  CAPABILITY_MARKETPLACE_SCHEMA,
  ACTIVATION_STAGES,
  requestCapabilityActivation,
  discoverForCapability
} from './capabilityActivation.js';
export {
  AUTO_REVOKE_SCHEMA,
  REVOCABLE_GRANT_KINDS,
  sweepAutoRevoke,
  assertBoundedGrant,
  revokeGrantNow,
  reapplyGrantAfterControl
} from './autoRevoke.js';
export {
  SPECIALIST_AGENTS_SCHEMA,
  SPECIALIST_ROLES,
  SPECIALIST_SPECS,
  IMPORTANT_TRADE_MIN_ROLES,
  runSpecialist,
  assertCouncilQuorum,
  tallyVotes
} from './specialistAgents.js';
export {
  MARKET_REGIME_SCHEMA,
  REGIME_LABELS,
  detectMarketRegime
} from './marketRegime.js';
export {
  CONFIDENCE_DECAY_SCHEMA,
  DEFAULT_HALF_LIFE_HRS,
  DEFAULT_REVIEW_THRESHOLD,
  decayConfidence,
  applyDecayToEvidence
} from './confidenceDecay.js';
export {
  EVENT_RISK_SCHEMA,
  EVENT_TYPES as SPEC65_EVENT_TYPES,
  SOURCE_CLASSES,
  assessEventRisk
} from './eventRiskAdapter.js';
export {
  SMART_MONEY_SCHEMA,
  WHALE_EVENT_KINDS,
  smartMoneyEvidence
} from './smartMoneyAdapter.js';
export {
  PARALLEL_STRATEGIES_SCHEMA,
  allocateParallelCapital
} from './parallelStrategies.js';
export {
  GOAL_PROGRESS_SCHEMA,
  GOAL_TREE_SCHEMA,
  goalProgress,
  buildGoalTree
} from './goalProgress.js';
export {
  AGENT_SUGGESTIONS_SCHEMA,
  INTENT_OPTIMIZER_SCHEMA,
  suggestIntentOptions,
  optimizeIntent
} from './intentOptimizer.js';
export {
  CHAT_REPLAY_SCHEMA,
  REPLAY_EVENT_TYPES,
  buildSessionReplay
} from './chatReplay.js';
export {
  AGENT_REPUTATION_SCHEMA,
  AGENT_LEADERBOARD_SCHEMA,
  AGENT_APPRECIATION_SCHEMA,
  REPUTATION_CATEGORIES,
  MIN_REPUTATION_SAMPLE_SIZE,
  buildAgentReputation,
  agentLeaderboard,
  createAgentAppreciation
} from './agentReputation.js';
export {
  PERSONALITY_SCHEMA,
  AGENT_AVATAR_SCHEMA,
  PERSONALITY_TONES,
  applyPersonality,
  personalityCannotChangeRisk,
  agentAvatar
} from './personalityLayer.js';
export {
  AGENT_PROTOCOL_SCHEMA,
  AGENT_CHAIN_SCHEMA,
  ENVELOPE_FIELDS,
  CHAIN_LINKS,
  createAgentEnvelope,
  buildAgentChain,
  advanceAgentChain
} from './agentProtocol.js';
export {
  AGENT_PAYMENT_SCHEMA,
  createPaymentPlan,
  requestAgentWithdrawal,
  settleFeeWithEvidence
} from './agentPayment.js';
export { AGENT_LEARNING_EXCHANGE_SCHEMA, createLearningExchange } from './agentLearningExchange.js';
export {
  DISASTER_MODE_SCHEMA,
  SMART_PAUSE_SCHEMA,
  DISASTER_TRIGGERS,
  evaluateDisasterMode,
  smartPause
} from './disasterMode.js';
export {
  ROUTE_SWITCH_SCHEMA,
  MATERIAL_DELTA_DEFAULTS,
  evaluateRouteSwitch
} from './dynamicRouteSwitch.js';
export {
  scanSummary,
  assertScanBeforeStart
} from './capabilityScanner.js';
export { createNonBypassableControls } from './phaseBoundary.js';

/* Arc C — user and memory (phases 63-68) */
export {
  PERSISTENCE_SCHEMA, SNAPSHOT_MAX_AGE_MS, FORBIDDEN_FIELDS, SAFETY_FIELDS,
  stripSecrets, snapshotDigest, buildSnapshot, encryptSnapshot, restoreSnapshot,
  assertRestoreNotEscalated
} from './sessionPersistence.js';
export {
  CONTINUITY_SCHEMA, HANDOFF_TTL_MS, NON_TRANSFERABLE,
  resolveLinkedIdentity, createHandoff, acceptHandoff, assertNoTransferredAuthority
} from './crossDeviceContinuity.js';
export {
  LEDGER_SCHEMA, RECEIPT_STATES, SETTLED_STATE,
  validateReceipt, buildLedger, assertLedgerHonest
} from './portfolioLedger.js';
export {
  CONSENT_MEMORY_SCHEMA, MEMORY_SCOPES, CONSENT_MAX_AGE_MS,
  grantMemoryConsent, memoryOff, consentCovers, recordWithConsent,
  exportMemory, revokeMemoryConsent, assertNothingStored
} from './consentedMemory.js';
export {
  NOTIFY_SCHEMA,
  CHANNELS as NOTIFY_CHANNELS,
  EVENTS as NOTIFY_EVENTS,
  DEFAULT_AUTHORIZATION_WINDOW_MS,
  buildNotification, deliverNotification, requestReauthorization,
  resolveAuthorizationTimeout, programMayContinue
} from './intentNotifications.js';
export {
  RECOVERY_SCHEMA as ACCESS_RECOVERY_SCHEMA,
  REVOKE_SCOPES, REVOCATION_REASONS,
  revokeAccess, revokeEverything, assertKeyUsable, applyRevocation, assertNothingSurvives
} from './accessRecovery.js';

/* Arc E — trust and proof (phases 75-79) */
export {
  ANCHOR_SCHEMA, ANCHOR_STATES, MAX_BATCH_SIZE, digest, buildReceiptLeaf, buildBatch,
  merkleProof, verifyProof, anchorBatch, explorerUrl, verifyAgainstAnchor
} from './onchainReceipt.js';
export {
  TIMELINE_SCHEMA, TIMELINE_MAX_ROWS, TIMELINE_GROUPS, toTimelineRow, buildTimeline,
  assertAppendOnly, assertTimelineSafe
} from './auditTimeline.js';
export {
  TERMS_DIFF_SCHEMA, MATERIAL_FIELDS, COSMETIC_FIELDS, SEVERITIES as TERMS_DIFF_SEVERITIES,
  diffTerms, summarizeDiff, assertTermsUnchanged
} from './termsDiff.js';
export {
  VERIFICATION_SCHEMA, MIN_INDEPENDENT_VERIFIERS, VERIFICATION_TIMEOUT_MS, VERDICTS,
  buildVerificationPacket, requestIndependentVerification, assurancePlaneReady, assertVerificationHonest
} from './thirdPartyVerification.js';
export {
  BOUNTY_SCHEMA, SEVERITY_BANDS, REWARD_BANDS, REWARD_CAP_USD, RESPONSE_WINDOW_MS,
  IN_SCOPE as BOUNTY_IN_SCOPE, OUT_OF_SCOPE as BOUNTY_OUT_OF_SCOPE, REPORT_STATES,
  buildBountyPolicy, submitReport, assessReward, disclosureDecision, assertNoLiabilityPromise
} from './bugBounty.js';

/* Arc F — product risk and security (phases 80-84) */
export {
  ADAPTIVE_RISK_SCHEMA,
  VOLATILITY_TIERS,
  VOLATILITY_MAX_AGE_MS,
  UNKNOWN_TIER,
  classifyVolatility,
  adaptiveLimits,
  assessAdaptiveRisk,
  riskDecisionRecord,
  assertNeverLoosens
} from './adaptiveRisk.js';
export {
  ASSET_SCREEN_SCHEMA,
  SCREEN_VERDICTS,
  SCREEN_REASONS,
  LIQUIDITY_DEPTH_MULTIPLE,
  MIN_POOL_LIQUIDITY_USD,
  detectImpostor,
  assessLiquidity,
  screenAsset,
  assertScreenedBeforeQuote
} from './assetScreening.js';
export {
  ADDRESS_SHIELD_SCHEMA,
  HEAD_CHARS,
  TAIL_CHARS,
  DUST_THRESHOLD_USD,
  SHIELD_FLAGS,
  addressFingerprint,
  looksAlike,
  screenRecipient,
  assertRecipientCleared
} from './addressShield.js';
export {
  APPROVAL_SCHEMA,
  MAX_UINT256,
  EFFECTIVELY_UNLIMITED,
  STALE_APPROVAL_MS,
  APPROVAL_HEADROOM_PCT,
  APPROVAL_RISKS,
  classifyAllowance,
  approvalInventory,
  minimalApproval,
  revokePlan,
  assertNoUnlimitedApproval
} from './approvalHygiene.js';
export {
  PRESIGN_SCHEMA,
  SIMULATION_MAX_AGE_MS,
  SIMULATION_STATUSES,
  REVERT_REASON_KEYS,
  txFingerprint,
  classifyRevert,
  simulateBeforeSign,
  assertSimulatedBeforeSign,
  describeSimulation
} from './simulationGate.js';

/* Arc B — live market data (phases 58-62) */
export {
  LIVE_REGIME_SCHEMA,
  DEFAULT_REGIME_MAX_AGE_HRS,
  MIN_REGIME_POINTS,
  normalizeSeries,
  seriesMetrics,
  buildRegimeEvidence,
  detectLiveMarketRegime,
  describeLiveRegime
} from './liveMarketRegime.js';
export {
  ALERT_PROPOSAL_SCHEMA,
  PROPOSAL_STATUSES,
  PROPOSAL_MAX_PRICE_AGE_MS,
  PROPOSAL_TTL_MS,
  proposalFromAlert,
  informedUnavailable,
  acceptProposal,
  declineProposal,
  assertNoAlertShortcut
} from './alertProposals.js';
export {
  LIVE_WHY_SCHEMA,
  DEFAULT_DATA_MAX_AGE_MS,
  screenDataPoints,
  whyFromLiveData,
  assertExplainable
} from './liveWhy.js';
export {
  LIVE_GOAL_PROGRESS_SCHEMA,
  DEFAULT_PRICE_MAX_AGE_MS,
  valueHoldings,
  liveGoalProgress,
  progressBarState
} from './liveGoalProgress.js';
export {
  BACKTEST_SCHEMA,
  BACKTEST_LABEL,
  MIN_BACKTEST_POINTS,
  movingAverageStrategy,
  runHonestBacktest,
  assertNoLookAhead,
  describeBacktest,
  assertNoProfitPromise
} from './honestBacktest.js';

export const INTENT_AI_VERSION = 'spec65.gap-fill.contracts.fail-closed.v1';
