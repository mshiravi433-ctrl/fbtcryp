/**
 * FBT INTENT AI — Spec 65 items 35–36: Smart Pause and Disaster Mode.
 *
 * Smart Pause replaces an immediate exit when conditions are merely unusual:
 * the intent is paused for re-evaluation, and a pause is NOT a permission to
 * continue. Disaster Mode reacts to evidenced incidents — bridge exploit,
 * contract exploit, oracle failure, extreme volatility, liquidity collapse —
 * with the policy's defensive posture. It does not assume catastrophe: each
 * trigger needs a sourced incident observation, and the defensive state never
 * bypasses Guardian, policy or STOP.
 */

import { applyNonBypassableControl } from './phaseBoundary.js';
import { containsRawSecret, fail, finite, noExecutionPermission, safeString } from './phaseBoundary.js';

export const DISASTER_MODE_SCHEMA = 'fbt.intent-disaster-mode.v1';
export const SMART_PAUSE_SCHEMA = 'fbt.intent-smart-pause.v1';

export const DISASTER_TRIGGERS = Object.freeze([
  'bridge-exploit', 'contract-exploit', 'oracle-failure', 'extreme-volatility', 'liquidity-collapse'
]);

const DEFENSIVE_POSTURE = Object.freeze({
  'bridge-exploit': { haltBridgeRoutes: true, preferNativeExit: true, tightenLimits: true, forcedLiquidation: false },
  'contract-exploit': { haltAffectedProtocols: true, freezeNewIntents: true, preferNativeExit: true, forcedLiquidation: false },
  'oracle-failure': { haltOracleDependentRoutes: true, widenSlippageGuard: true, requireManualReview: true, forcedLiquidation: false },
  'extreme-volatility': { tightenLimits: true, requireFreshQuotes: true, reduceNewExposure: true, forcedLiquidation: false },
  'liquidity-collapse': { haltLargeRoutes: true, splitOrDelayExits: true, widenSlippageGuard: false, forcedLiquidation: false }
});

function incidentRow(input) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const trigger = DISASTER_TRIGGERS.includes(input.trigger) ? input.trigger : null;
  const source = safeString(String(input.source || ''), 80);
  const observedAt = finite(input.observedAt);
  if (!trigger || !source || observedAt === null) return null;
  return { trigger, source, observedAt, severity: ['suspected', 'confirmed'].includes(input.severity) ? input.severity : 'suspected' };
}

/**
 * Evaluate disaster posture from supplied incident evidence. Un-evidenced
 * claims produce a review request, not a defensive takeover. The posture is
 * defensive and policy-bound; nothing here exits positions by itself.
 */
export function evaluateDisasterMode({ incidents = [], policyAllowsDefensivePosture = true, now = Date.now() } = {}) {
  if (containsRawSecret(incidents)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const rows = (Array.isArray(incidents) ? incidents : []).slice(0, 16).map(incidentRow).filter(Boolean);
  const confirmed = rows.filter((row) => row.severity === 'confirmed');
  if (!rows.length) {
    return noExecutionPermission({
      ok: true,
      schema: DISASTER_MODE_SCHEMA,
      mode: 'normal',
      status: 'no-evidenced-incident',
      posture: null,
      catastrophizing: false,
      defensiveState: false,
      note: 'No evidenced incident was supplied; disaster mode stays off instead of assuming catastrophe.',
      evaluatedAt: now
    });
  }
  const active = confirmed.length ? confirmed : rows;
  const posture = active.map((row) => ({
    trigger: row.trigger,
    severity: row.severity,
    ...(policyAllowsDefensivePosture === true ? DEFENSIVE_POSTURE[row.trigger] : { manualReviewOnly: true })
  }));
  return noExecutionPermission({
    ok: true,
    schema: DISASTER_MODE_SCHEMA,
    mode: 'defensive',
    status: confirmed.length ? 'defensive-evidenced' : 'defensive-pending-confirmation',
    posture,
    policyBound: true,
    bypassesGuardian: false,
    bypassesStop: false,
    autoExit: false,
    autoSell: false,
    note: 'Defensive posture per policy: routes halt, limits tighten, exits go through review. It never bypasses Guardian or STOP.',
    evaluatedAt: now
  });
}

/**
 * Spec 65 item 35 — Smart Pause. For non-critical anomalies, pause and
 * re-evaluate instead of forcing an immediate exit. A pause is never a
 * permission to continue: resuming requires a fresh re-evaluation and, for
 * execution, the full gate chain again.
 */
export function smartPause({ anomaly = null, critical = false, controls = null, now = Date.now() } = {}) {
  if (containsRawSecret({ anomaly })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const description = safeString(String(anomaly?.description || anomaly || ''), 240);
  if (!description) return fail('ANOMALY_DESCRIPTION_REQUIRED');
  const applied = applyNonBypassableControl(controls && typeof controls === 'object' ? controls : {}, 'PAUSE', now);
  return noExecutionPermission({
    ok: true,
    schema: SMART_PAUSE_SCHEMA,
    anomalyDescription: description,
    critical: critical === true,
    action: critical === true ? 'ESCALATE_TO_DISASTER_MODE' : 'PAUSE_FOR_RE_EVALUATION',
    paused: applied.controls.paused,
    immediateExitForced: false,
    pauseIsPermissionToContinue: false,
    resumeRequires: ['RE_EVALUATION', 'FRESH_POLICY_CHECK', ...(critical === true ? ['DISASTER_MODE_REVIEW'] : [])],
    controls: applied.controls,
    pausedAt: now
  });
}
