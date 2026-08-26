/**
 * FBT INTENT AI — Spec 65 items 2 and 4: Capability Marketplace discovery and
 * One-Click Capability Activation.
 *
 * One click is a PERMISSION REQUEST, never financial execution. The staged
 * flow is Permission → Wallet → Limits → Activate, and `Activate` cannot turn
 * green while the capability has no operational evidence: it stays
 * `pending-evidence`. For capabilities FBT does not implement, discovery can
 * list external agents — a listing is not a permission and never an execution.
 */

import { containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';
import { CAPABILITY_SCANNER_SCHEMA, capabilityById } from './capabilityScanner.js';
import { discoverExternalAgents } from './externalAgentTrust.js';

export const CAPABILITY_ACTIVATION_SCHEMA = 'fbt.capability-activation.v1';
export const CAPABILITY_MARKETPLACE_SCHEMA = 'fbt.capability-marketplace.v1';

export const ACTIVATION_STAGES = Object.freeze(['permission-request', 'wallet-connect', 'limits-set', 'activate']);

const EVIDENCE_KINDS_BY_STAGE = Object.freeze({
  'permission-request': 'user-opt-in-recorded',
  'wallet-connect': 'wallet-provider-evidence',
  'limits-set': 'policy-limits-acknowledged',
  activate: 'operational-capability-evidence'
});

function capabilityOperational(scan, capabilityId) {
  const row = Array.isArray(scan?.capabilities) ? scan.capabilities.find((item) => item.id === capabilityId) : null;
  return { operational: row?.operational === true, configured: row?.configured === true, status: row?.status || 'unknown' };
}

/**
 * Advance the one-click activation flow. Every call returns the stage that is
 * now required; only a stage whose evidence exists is marked done, and the
 * final `activate` stage stays `pending-evidence` without real operational
 * evidence. Nothing here can execute a trade.
 */
export function requestCapabilityActivation({ capabilityId = null, scan = null, stage = 'permission-request', walletConnected = false, limits = null, evidence = null, now = Date.now() } = {}) {
  if (containsRawSecret({ capabilityId, limits, evidence })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeString(String(capabilityId || '').toLowerCase(), 64);
  const catalog = capabilityById(id);
  if (!catalog) return fail('CAPABILITY_UNKNOWN', id);
  if (!scan || scan.schema !== CAPABILITY_SCANNER_SCHEMA) return fail('SCAN_REQUIRED', 'Run scanCapabilities before requesting activation.');
  const runtime = capabilityOperational(scan, id);
  const stageIndex = ACTIVATION_STAGES.indexOf(safeString(String(stage || ''), 32));
  if (stageIndex < 0) return fail('UNKNOWN_STAGE', String(stage || ''));

  if (stageIndex === 0) {
    return noExecutionPermission({
      ok: true,
      schema: CAPABILITY_ACTIVATION_SCHEMA,
      capabilityId: id,
      capabilityName: catalog.name,
      stage: 'permission-request',
      stageStatus: 'request-created',
      nextStage: 'wallet-connect',
      oneClickMeaning: 'PERMISSION_REQUEST_ONLY_NOT_EXECUTION',
      executionAuthorized: false,
      financialExecutionAuthorized: false,
      requestedAt: now
    });
  }
  if (stageIndex === 1) {
    if (walletConnected !== true) {
      return fail('WALLET_CONNECTION_REQUIRED', 'The wallet stage requires a real connected wallet before limits.', { capabilityId: id, nextStage: 'wallet-connect' });
    }
    return noExecutionPermission({
      ok: true,
      schema: CAPABILITY_ACTIVATION_SCHEMA,
      capabilityId: id,
      stage: 'wallet-connect',
      stageStatus: 'wallet-evidenced',
      nextStage: 'limits-set',
      executionAuthorized: false,
      advancedAt: now
    });
  }
  if (stageIndex === 2) {
    if (!limits || typeof limits !== 'object') return fail('LIMITS_REQUIRED', 'Capital/transaction/risk limits must be set before activation.', { capabilityId: id, nextStage: 'limits-set' });
    const numeric = ['capitalUsd', 'transactionUsd', 'riskPct'].filter((key) => finite(limits[key]) === null || finite(limits[key]) < 0);
    if (numeric.length) return fail('LIMITS_INCOMPLETE', `Missing or invalid: ${numeric.join(', ')}`, { capabilityId: id, nextStage: 'limits-set' });
    return noExecutionPermission({
      ok: true,
      schema: CAPABILITY_ACTIVATION_SCHEMA,
      capabilityId: id,
      stage: 'limits-set',
      stageStatus: 'limits-acknowledged',
      nextStage: 'activate',
      limits: { capitalUsd: finite(limits.capitalUsd), transactionUsd: finite(limits.transactionUsd), riskPct: finite(limits.riskPct) },
      executionAuthorized: false,
      advancedAt: now
    });
  }
  // Final stage: activation. Without operational evidence the button stays
  // pending — never green.
  if (runtime.operational !== true || !evidence || evidence.attested !== true) {
    return noExecutionPermission({
      ok: true,
      schema: CAPABILITY_ACTIVATION_SCHEMA,
      capabilityId: id,
      stage: 'activate',
      stageStatus: 'pending-evidence',
      activated: false,
      green: false,
      reason: runtime.operational !== true
        ? 'The capability is not operationally evidenced in the current scan; activation stays pending.'
        : 'Activation requires attested operational evidence; a permission request alone is not evidence.',
      requiredEvidence: EVIDENCE_KINDS_BY_STAGE.activate,
      executionAuthorized: false,
      financialExecutionAuthorized: false,
      evaluatedAt: now
    });
  }
  return noExecutionPermission({
    ok: true,
    schema: CAPABILITY_ACTIVATION_SCHEMA,
    capabilityId: id,
    stage: 'activate',
    stageStatus: 'activated-within-policy',
    activated: true,
    green: true,
    greenMeaning: 'CAPABILITY_ENABLED_FOR_PLANNING_NOT_EXECUTION',
    requiredEvidence: EVIDENCE_KINDS_BY_STAGE.activate,
    executionAuthorized: false,
    financialExecutionAuthorized: false,
    activatedAt: now
  });
}

/**
 * Spec 65 item 2 — when a capability is not available inside FBT, discover
 * external candidates. A listing is NOT a permission and NOT an execution;
 * hiring requires a complete passport, user opt-in and the full gate chain.
 */
export function discoverForCapability({ capabilityId = null, agents = [], criteria = {}, now = Date.now() } = {}) {
  if (containsRawSecret({ capabilityId, criteria })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeString(String(capabilityId || '').toLowerCase(), 64);
  if (!id) return fail('CAPABILITY_REQUIRED');
  const catalog = capabilityById(id);
  const inFbt = catalog?.implemented === true;
  const discovery = discoverExternalAgents({ agents, intent: { ...criteria, requiredCapabilities: [id] }, now });
  return noExecutionPermission({
    ok: true,
    schema: CAPABILITY_MARKETPLACE_SCHEMA,
    capabilityId: id,
    availableInFbt: inFbt,
    externalNeeded: !inFbt,
    listingStatus: Array.isArray(discovery?.candidates) && discovery.candidates.length ? 'listed' : 'no-listing',
    listings: discovery?.candidates || [],
    rejected: discovery?.rejected || [],
    listingIsNot: { permission: false, execution: false, verification: false },
    hireRequires: ['COMPLETE_PASSPORT', 'USER_OPT_IN', 'GUARDIAN', 'RISK_POLICY', 'SCOPED_PERMISSIONS', 'REVOCATION_PATH'],
    externalAgentsNeverReceive: ['seed', 'private-key', 'master-password', 'raw-secret'],
    listedAt: now
  });
}
