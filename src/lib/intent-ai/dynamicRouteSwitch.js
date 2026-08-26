/**
 * FBT INTENT AI — Spec 65 item 33: Dynamic Route Switching.
 *
 * If a DEX or venue fails mid-route, alternatives are evaluated from supplied
 * health evidence. A switch mid-execution that produces a material delta in
 * cost or risk REQUIRES re-authorization through the normal screen. Without
 * failure evidence the route stays and the case goes to review — no panic
 * switching, no silent rerouting.
 */

import { containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const ROUTE_SWITCH_SCHEMA = 'fbt.intent-route-switch.v1';

export const MATERIAL_DELTA_DEFAULTS = Object.freeze({ costPct: 5, riskPct: 10 });

function alternativeRow(input) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const id = safeId(input.routeId || input.venueId);
  if (!id) return null;
  return {
    routeId: id,
    venueId: safeId(input.venueId) || safeString(String(input.venueId || ''), 80),
    extraCostPct: finite(input.extraCostPct),
    extraRiskPct: finite(input.extraRiskPct),
    evidenceRows: Array.isArray(input.evidence) ? input.evidence.length : 0,
    healthy: input.healthy === true
  };
}

/**
 * Evaluate a mid-route switch after a venue failure. The failure itself must
 * be evidenced (health provider observation). The chosen alternative is only
 * a recommendation: a material delta forces the re-authorization screen
 * before anything changes.
 */
export function evaluateRouteSwitch({
  currentRouteId = null,
  venueFailure = null,
  alternatives = [],
  executedSteps = 0,
  materialDelta = MATERIAL_DELTA_DEFAULTS,
  now = Date.now()
} = {}) {
  if (containsRawSecret({ currentRouteId, venueFailure, alternatives })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const routeId = safeId(currentRouteId);
  if (!routeId) return fail('ROUTE_ID_REQUIRED');
  const failedVenue = safeId(venueFailure?.venueId) || safeString(String(venueFailure?.venueId || ''), 80);
  const observedAt = finite(venueFailure?.observedAt);
  const source = safeString(String(venueFailure?.source || ''), 80);
  if (!failedVenue || observedAt === null || !source) {
    return noExecutionPermission({
      ok: true,
      schema: ROUTE_SWITCH_SCHEMA,
      currentRouteId: routeId,
      status: 'review-required',
      switched: false,
      reason: 'A venue failure must be observed by a health source before any switch; rumors switch nothing.',
      executionAuthorized: false,
      evaluatedAt: now
    });
  }
  const rows = (Array.isArray(alternatives) ? alternatives : []).slice(0, 8).map(alternativeRow).filter((row) => row && row.routeId !== routeId && row.healthy === true);
  if (!rows.length) {
    return noExecutionPermission({
      ok: true,
      schema: ROUTE_SWITCH_SCHEMA,
      currentRouteId: routeId,
      status: 'no-healthy-alternative',
      switched: false,
      failureEvidence: { venueId: failedVenue, observedAt, source },
      note: 'No evidenced healthy alternative exists; the intent stays paused for review rather than forcing a bad route.',
      executionAuthorized: false,
      evaluatedAt: now
    });
  }
  const costLimit = finite(materialDelta?.costPct) ?? MATERIAL_DELTA_DEFAULTS.costPct;
  const riskLimit = finite(materialDelta?.riskPct) ?? MATERIAL_DELTA_DEFAULTS.riskPct;
  const ranked = rows
    .map((row) => ({
      ...row,
      materialDelta: (row.extraCostPct !== null && row.extraCostPct > costLimit) || (row.extraRiskPct !== null && row.extraRiskPct > riskLimit)
    }))
    .sort((a, b) => (a.extraCostPct ?? Infinity) - (b.extraCostPct ?? Infinity) || (a.extraRiskPct ?? Infinity) - (b.extraRiskPct ?? Infinity));
  const candidate = ranked[0];
  const executed = finite(executedSteps) ?? 0;
  const midExecution = executed > 0;
  return noExecutionPermission({
    ok: true,
    schema: ROUTE_SWITCH_SCHEMA,
    currentRouteId: routeId,
    status: 'switch-proposed',
    switched: false,
    failureEvidence: { venueId: failedVenue, observedAt, source },
    recommendedAlternative: { routeId: candidate.routeId, venueId: candidate.venueId, extraCostPct: candidate.extraCostPct, extraRiskPct: candidate.extraRiskPct },
    alternativesEvaluated: ranked.length,
    materialDelta: candidate.materialDelta,
    midExecution,
    reAuthorizationRequired: candidate.materialDelta || midExecution,
    note: candidate.materialDelta || midExecution
      ? 'The proposed switch is material or mid-execution: it requires the re-authorization screen and explicit user confirmation.'
      : 'The proposed switch is non-material; policy review is still required before applying it.',
    executionAuthorized: false,
    evaluatedAt: now
  });
}
