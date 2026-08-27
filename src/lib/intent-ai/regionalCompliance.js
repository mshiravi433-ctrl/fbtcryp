/**
 * FBT INTENT AI — PHASE 87: REGIONAL COMPLIANCE GATE
 * ---------------------------------------------------------------------------
 * A feature is not legal everywhere. Phase 87 gates features by region, wires
 * that to the phase-36 legal hold, and — the part that matters — shows the
 * user a plain map of what is on and off where they are.
 *
 *   · unknown region = the STRICTEST policy, never the most permissive
 *   · a legal hold overrides every allow: held means blocked, and the block is
 *     explained rather than hidden behind a disabled button
 *   · the availability map is user-visible and complete: every feature appears
 *     with a state and a reason
 *   · gating restricts features; it never grants one that policy denies
 */

import { classifyFailure } from './failureModes.js';

export const COMPLIANCE_SCHEMA = 'fbt.regional-compliance.v1';
export const FEATURE_STATES = Object.freeze(['available', 'restricted', 'blocked', 'unknown']);

export const GATED_FEATURES = Object.freeze([
  'swap', 'bridge', 'send', 'automation', 'agent-market', 'fiat-onramp', 'fiat-offramp'
]);

/** Deliberately conservative. A region we do not know gets DEFAULT_POLICY. */
export const REGION_POLICY = Object.freeze({
  DEFAULT: Object.freeze({ blocked: ['fiat-onramp', 'fiat-offramp'], restricted: ['automation', 'agent-market'] }),
  EU: Object.freeze({ blocked: [], restricted: ['agent-market'] }),
  GB: Object.freeze({ blocked: ['fiat-onramp'], restricted: ['automation'] }),
  US: Object.freeze({ blocked: ['fiat-onramp', 'fiat-offramp'], restricted: ['automation', 'agent-market'] }),
  TR: Object.freeze({ blocked: ['fiat-onramp'], restricted: [] }),
  AE: Object.freeze({ blocked: [], restricted: [] })
});

const norm = (r) => (typeof r === 'string' && r.trim() ? r.trim().toUpperCase().slice(0, 2) : null);

function policyFor(region) {
  const key = norm(region);
  return { key, policy: (key && REGION_POLICY[key]) || REGION_POLICY.DEFAULT, known: Boolean(key && REGION_POLICY[key]) };
}

/** Is this one feature usable here, right now? */
export function featureState({ feature = null, region = null, legalHold = null, now = Date.now() } = {}) {
  if (!GATED_FEATURES.includes(feature)) {
    return { feature, state: 'unknown', reason: 'UNKNOWN_FEATURE', i18nKey: 'intentAI.compliance.unknownFeature' };
  }
  const held = legalHoldCovers(legalHold, feature, region);
  if (held.held) {
    // A legal hold beats every allow-list.
    return {
      feature, state: 'blocked', reason: 'LEGAL_HOLD', holdRef: held.ref,
      i18nKey: 'intentAI.compliance.legalHold',
      error: classifyFailure('GUARDIAN_REJECTED', { detail: 'LEGAL_HOLD' })
    };
  }
  const { policy, known } = policyFor(region);
  if (policy.blocked.includes(feature)) {
    return { feature, state: 'blocked', reason: known ? 'REGION_BLOCKED' : 'REGION_UNKNOWN_STRICT', i18nKey: 'intentAI.compliance.blocked', regionKnown: known };
  }
  if (policy.restricted.includes(feature)) {
    return { feature, state: 'restricted', reason: known ? 'REGION_RESTRICTED' : 'REGION_UNKNOWN_STRICT', i18nKey: 'intentAI.compliance.restricted', regionKnown: known, requiresAcknowledgement: true };
  }
  return { feature, state: 'available', reason: null, i18nKey: 'intentAI.compliance.available', regionKnown: known, at: now };
}

/** Does a phase-36 legal hold cover this feature/region? */
export function legalHoldCovers(legalHold, feature, region) {
  const holds = Array.isArray(legalHold) ? legalHold : (legalHold ? [legalHold] : []);
  for (const h of holds) {
    if (h?.active !== true) continue;
    const scopeFeature = !h.features || (Array.isArray(h.features) && (h.features.includes(feature) || h.features.includes('*')));
    const scopeRegion = !h.regions || (Array.isArray(h.regions) && (h.regions.includes(norm(region)) || h.regions.includes('*')));
    if (scopeFeature && scopeRegion) return { held: true, ref: h.ref ?? h.id ?? 'HOLD' };
  }
  return { held: false, ref: null };
}

/** The whole picture, for the user, with nothing missing. */
export function availabilityMap({ region = null, legalHold = null, now = Date.now() } = {}) {
  const { key, known } = policyFor(region);
  const features = GATED_FEATURES.map((f) => featureState({ feature: f, region, legalHold, now }));
  return {
    ok: true,
    schema: COMPLIANCE_SCHEMA,
    region: key,
    regionKnown: known,
    features,
    // Every gated feature is listed. No quiet omissions.
    complete: features.length === GATED_FEATURES.length,
    blocked: features.filter((f) => f.state === 'blocked').map((f) => f.feature),
    restricted: features.filter((f) => f.state === 'restricted').map((f) => f.feature),
    userVisible: true,
    i18nKey: known ? 'intentAI.compliance.mapTitle' : 'intentAI.compliance.regionUnknown',
    at: now
  };
}

/** The gate an action must pass before it is even drafted. */
export function assertFeaturePermitted({ feature = null, region = null, legalHold = null, acknowledged = false, now = Date.now() } = {}) {
  const state = featureState({ feature, region, legalHold, now });
  if (state.state === 'available') {
    return { ok: true, permitted: true, state, executionAuthorized: false, requiresConfirmationGate: true };
  }
  if (state.state === 'restricted' && acknowledged === true) {
    return { ok: true, permitted: true, restricted: true, state, executionAuthorized: false, requiresConfirmationGate: true };
  }
  return {
    ok: false,
    permitted: false,
    state,
    i18nKey: state.i18nKey,
    error: state.error || classifyFailure('GUARDIAN_REJECTED', { detail: state.reason || 'NOT_PERMITTED' })
  };
}

/** Geo-gating may only ever subtract. */
export function assertGateOnlyRestricts({ base = null, gated = null } = {}) {
  const reasons = [];
  const baseSet = new Set(Array.isArray(base) ? base : []);
  for (const f of Array.isArray(gated) ? gated : []) {
    if (!baseSet.has(f)) reasons.push(`GRANTED_BY_GEO:${f}`);
  }
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('GUARDIAN_REJECTED', { detail: reasons[0] }) }
    : { ok: true };
}
