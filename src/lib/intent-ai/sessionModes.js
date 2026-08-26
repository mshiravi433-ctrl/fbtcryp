/**
 * FBT INTENT AI — the three primary interaction modes.
 *
 * Modes are a product boundary, not a styling choice. Analysis and financial
 * execution permissions stay separate in every mode; a mode can never grant
 * execution by itself.
 */

export const SESSION_MODE_SCHEMA = 'fbt.intent-session-mode.v1';
export const PRIMARY_MODES = Object.freeze([
  'human-ai',
  'ai-ai-inside-fbt',
  'fbt-external-ai'
]);
export const MODE_LABELS = Object.freeze({
  'human-ai': 'HUMAN ↔ AI',
  'ai-ai-inside-fbt': 'AI ↔ AI INSIDE FBT',
  'fbt-external-ai': 'FBT AI ↔ EXTERNAL AI AGENT'
});
export const REQUEST_CLASSES = Object.freeze({ ANALYSIS: 'analysis', PREPARATION: 'preparation', EXECUTION: 'execution' });

export const MODE_DEFINITIONS = Object.freeze({
  'human-ai': Object.freeze({
    id: 'human-ai',
    label: MODE_LABELS['human-ai'],
    participants: ['user', 'fbt-ai'],
    analysis: true,
    executionRequiresAuthorization: true,
    externalAgent: false
  }),
  'ai-ai-inside-fbt': Object.freeze({
    id: 'ai-ai-inside-fbt',
    label: MODE_LABELS['ai-ai-inside-fbt'],
    participants: ['fbt-strategy', 'fbt-execution'],
    analysis: true,
    executionRequiresAuthorization: true,
    externalAgent: false
  }),
  'fbt-external-ai': Object.freeze({
    id: 'fbt-external-ai',
    label: MODE_LABELS['fbt-external-ai'],
    participants: ['fbt-ai', 'external-agent'],
    analysis: true,
    executionRequiresAuthorization: true,
    externalAgent: true
  })
});

const EXECUTION_ACTIONS = new Set([
  'execute', 'submit', 'sign', 'trade', 'swap', 'bridge', 'withdraw',
  'open-position', 'close-position', 'rebalance', 'run-strategy'
]);
const PREPARATION_ACTIONS = new Set(['prepare', 'quote', 'draft', 'simulate', 'plan']);

export function isPrimaryMode(mode) {
  return PRIMARY_MODES.includes(String(mode));
}

export function normalizePrimaryMode(mode = 'human-ai') {
  return isPrimaryMode(mode) ? String(mode) : null;
}

export const normalizeMode = normalizePrimaryMode;

export function modeDefinition(mode = 'human-ai') {
  const normalized = normalizePrimaryMode(mode);
  return normalized ? MODE_DEFINITIONS[normalized] : null;
}

export const modeLabel = (mode) => MODE_LABELS[normalizePrimaryMode(mode)] || null;

/** Classify a requested action without interpreting natural-language sentiment. */
export function classifyPermissionRequest(actionOrIntent) {
  const raw = typeof actionOrIntent === 'string'
    ? actionOrIntent
    : actionOrIntent?.action || actionOrIntent?.kind || '';
  const action = String(raw).trim().toLowerCase().replace(/[_ ]+/g, '-');
  if (EXECUTION_ACTIONS.has(action) || /(^|-)execute($|-)|(^|-)sign($|-)|withdraw|transfer/.test(action)) {
    return REQUEST_CLASSES.EXECUTION;
  }
  if (PREPARATION_ACTIONS.has(action) || /prepare|quote|draft|simulate|plan/.test(action)) {
    return REQUEST_CLASSES.PREPARATION;
  }
  return REQUEST_CLASSES.ANALYSIS;
}

export const classifyRequest = classifyPermissionRequest;

/**
 * Explain whether the next step needs an authorization gate. This function
 * never authorizes; it only describes the boundary the UI must enforce.
 */
export function permissionRequirement({ mode = 'human-ai', action, intent, userAuthorized = false, stage = null } = {}) {
  const definition = modeDefinition(mode);
  if (!definition) return { ok: false, code: 'UNKNOWN_PRIMARY_MODE' };
  const kind = stage && Object.values(REQUEST_CLASSES).includes(stage)
    ? stage
    : classifyPermissionRequest(action || intent);
  const required = kind === REQUEST_CLASSES.EXECUTION;
  return {
    ok: true,
    mode: definition.id,
    permission: required ? 'financial-execution' : 'analysis',
    kind,
    required,
    userAuthorized: userAuthorized === true,
    canProceed: !required || userAuthorized === true,
    reason: required
      ? 'Financial execution requires an explicit user authorization screen.'
      : 'Analysis and preparation do not grant or require financial execution permission.'
  };
}

export function buildPermissionBoundary({ mode = 'human-ai', request = null, userAuthorized = false, externalVerified = false } = {}) {
  const requestedStage = Object.values(REQUEST_CLASSES).includes(request?.stage)
    ? request.stage
    : classifyPermissionRequest(request);
  const requirement = permissionRequirement({ mode, intent: request, userAuthorized, stage: requestedStage });
  return {
    schema: SESSION_MODE_SCHEMA,
    mode: normalizePrimaryMode(mode),
    requestClass: requestedStage,
    analysisAllowed: true,
    preparationAllowed: true,
    financialExecutionAllowed: Boolean(requirement.ok && requirement.canProceed && requestedStage === REQUEST_CLASSES.EXECUTION),
    externalVerified: externalVerified === true,
    authorizationRequired: requestedStage === REQUEST_CLASSES.EXECUTION,
    boundary: 'analysis-and-preparation-never-imply-execution'
  };
}

export const canAnalyze = (mode = 'human-ai') => Boolean(modeDefinition(mode)?.analysis);
export const canPrepare = (mode = 'human-ai') => Boolean(modeDefinition(mode));
export const canExecute = ({ mode = 'human-ai', userAuthorized = false, guardianApproved = false } = {}) => (
  Boolean(modeDefinition(mode) && userAuthorized === true && guardianApproved === true)
);

/**
 * Enforce mode-specific boundaries before orchestration. External analysis can
 * be admitted only as a verified, scoped participant; neither mode nor a
 * social message grants execution.
 */
export function assertModeBoundary({
  mode = 'human-ai',
  action,
  intent,
  userAuthorized = false,
  externalVerified = false,
  rawCredential = false,
  stage = null
} = {}) {
  const definition = modeDefinition(mode);
  if (!definition) return { ok: false, code: 'UNKNOWN_PRIMARY_MODE' };
  if (rawCredential === true) return { ok: false, code: 'RAW_CREDENTIAL_FORBIDDEN' };
  if (definition.externalAgent && externalVerified !== true) {
    return { ok: false, code: 'EXTERNAL_AGENT_NOT_VERIFIED' };
  }
  const requirement = permissionRequirement({ mode, action, intent, userAuthorized, stage });
  if (!requirement.ok) return requirement;
  if (!requirement.canProceed) return { ok: false, code: 'EXECUTION_AUTHORIZATION_REQUIRED', requirement };
  return { ok: true, requirement, mode: definition.id, externalAgent: definition.externalAgent };
}

export function createModeSession({ mode = 'human-ai', userId = null } = {}) {
  const normalized = normalizePrimaryMode(mode);
  if (!normalized) return { ok: false, code: 'UNKNOWN_PRIMARY_MODE' };
  return {
    ok: true,
    schema: SESSION_MODE_SCHEMA,
    id: `mode_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    mode: normalized,
    label: MODE_LABELS[normalized],
    userId: typeof userId === 'string' ? userId.slice(0, 128) : null,
    authorization: {
      analysis: true,
      financialExecution: false,
      requiresExplicitUserScreen: true,
      guardianCanBlock: true
    },
    createdAt: new Date().toISOString()
  };
}

export function modeCapabilitySummary(mode = 'human-ai') {
  const definition = modeDefinition(mode);
  if (!definition) return { ok: false, code: 'UNKNOWN_PRIMARY_MODE' };
  return {
    ok: true,
    mode: definition.id,
    label: definition.label,
    participants: [...definition.participants],
    analysis: definition.analysis,
    preparation: true,
    execution: false,
    executionRequiresAuthorization: true,
    externalAgent: definition.externalAgent,
    rawCredentialsAllowed: false
  };
}
