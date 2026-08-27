/**
 * FBT INTENT AI — PHASE 99: LONG-TERM SURVIVAL
 * ---------------------------------------------------------------------------
 * A launch is not a product. Phase 40 proved a one-year sustainment plan on
 * paper; phase 99 turns that plan into conditions the running product has to
 * keep meeting — updates that do not strand an old install, key rotation that
 * actually kills the old key, and a recovery drill with a real date.
 *
 *   · an update is only shippable when the previous version can still read
 *     what it wrote and a rollback target exists
 *   · rotation is not complete until the OLD key is proven dead; a rotation
 *     that leaves the old key usable is a failure, not a warning
 *   · a drill older than its cadence is expired — a drill from last year does
 *     not prove anything about today
 *   · readiness is the AND of every condition, and the missing ones are named
 */

import { classifyFailure } from './failureModes.js';
import { assertKeyUsable } from './accessRecovery.js';

export const SURVIVAL_SCHEMA = 'fbt.long-term-survival.v1';
export const SURVIVAL_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const DRILL_CADENCE_MS = 90 * 24 * 60 * 60 * 1000;
export const KEY_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

/** The conditions a product has to keep meeting, not tick once. */
export const SURVIVAL_CONDITIONS = Object.freeze([
  'update-path', 'key-rotation', 'recovery-drill', 'data-portability', 'owner-accountable'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

const SEMVER = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

/** Can this update ship without stranding somebody on an old install? */
export function planUpdate({ fromVersion = null, toVersion = null, rollbackVersion = null, migrations = [], now = Date.now() } = {}) {
  const from = String(fromVersion || '');
  const to = String(toVersion || '');
  const blockers = [];
  if (!SEMVER.test(from)) blockers.push('BAD_FROM_VERSION');
  if (!SEMVER.test(to)) blockers.push('BAD_TO_VERSION');
  if (SEMVER.test(from) && from === to) blockers.push('NOT_AN_UPDATE');
  const steps = Array.isArray(migrations) ? migrations : [];
  const irreversible = steps.filter((s) => s?.reversible !== true).map((s) => id(s?.id) || 'step');
  if (irreversible.length) blockers.push('IRREVERSIBLE_MIGRATION');
  if (!SEMVER.test(String(rollbackVersion || from))) blockers.push('NO_ROLLBACK_TARGET');
  const backwardCompatible = steps.every((s) => s?.backwardCompatible !== false);
  if (!backwardCompatible) blockers.push('OLD_VERSION_CANNOT_READ_DATA');
  return {
    ok: blockers.length === 0,
    schema: SURVIVAL_SCHEMA,
    fromVersion: from,
    toVersion: to,
    rollbackVersion: SEMVER.test(String(rollbackVersion || '')) ? String(rollbackVersion) : from,
    steps: steps.length,
    reversible: irreversible.length === 0,
    backwardCompatible,
    blockers,
    shippable: blockers.length === 0,
    i18nKey: blockers.length ? 'intentAI.survival.updateBlocked' : 'intentAI.survival.updateReady',
    i18nParams: { blockers: blockers.length },
    at: now,
    error: blockers.length ? classifyFailure('GUARDIAN_REJECTED', { detail: blockers[0] }) : null
  };
}

/**
 * Rotate a key and PROVE the old one is dead. Reuses the phase-68 tombstone
 * check rather than inventing a second, weaker notion of revoked.
 */
export function rotateAndRevoke({ oldKey = null, newKey = null, tombstones = [], now = Date.now() } = {}) {
  const oldId = id(oldKey?.id ?? oldKey?.keyId);
  const newId = id(newKey?.id ?? newKey?.keyId);
  if (!oldId || !newId) {
    return { ok: false, rotated: false, i18nKey: 'intentAI.survival.rotationFailed', error: classifyFailure('MISSING_DATA', { detail: 'MISSING_KEY' }) };
  }
  if (oldId === newId) {
    return { ok: false, rotated: false, i18nKey: 'intentAI.survival.rotationFailed', error: classifyFailure('MISSING_DATA', { detail: 'SAME_KEY' }) };
  }
  const oldStillUsable = assertKeyUsable(oldKey, tombstones, { now }).usable === true;
  const newUsable = assertKeyUsable(newKey, tombstones, { now }).usable === true;
  if (oldStillUsable) {
    // A rotation that leaves the old key alive has rotated nothing.
    return {
      ok: false, rotated: false, oldKeyDead: false, oldKeyId: oldId, newKeyId: newId,
      i18nKey: 'intentAI.survival.oldKeyAlive',
      error: classifyFailure('GUARDIAN_REJECTED', { detail: 'OLD_KEY_STILL_USABLE' })
    };
  }
  if (!newUsable) {
    return {
      ok: false, rotated: false, oldKeyDead: true, newKeyUsable: false,
      i18nKey: 'intentAI.survival.newKeyUnusable',
      error: classifyFailure('MISSING_DATA', { detail: 'NEW_KEY_NOT_USABLE' })
    };
  }
  return {
    ok: true,
    schema: SURVIVAL_SCHEMA,
    rotated: true,
    oldKeyId: oldId,
    newKeyId: newId,
    oldKeyDead: true,
    newKeyUsable: true,
    rotatedAt: now,
    i18nKey: 'intentAI.survival.rotated'
  };
}

/** A drill is only evidence while it is fresh. */
export function recoveryDrill({ lastDrillAt = null, succeeded = false, restoredFrom = null, cadenceMs = DRILL_CADENCE_MS, now = Date.now() } = {}) {
  const at = num(lastDrillAt);
  const cadence = num(cadenceMs) ?? DRILL_CADENCE_MS;
  if (at === null) {
    return { ok: false, current: false, reason: 'NEVER_DRILLED', i18nKey: 'intentAI.survival.neverDrilled', error: classifyFailure('MISSING_DATA', { detail: 'NEVER_DRILLED' }) };
  }
  const ageMs = now - at;
  const fresh = ageMs >= 0 && ageMs <= cadence;
  const passed = succeeded === true && Boolean(id(restoredFrom));
  return {
    ok: fresh && passed,
    schema: SURVIVAL_SCHEMA,
    lastDrillAt: at,
    ageMs,
    cadenceMs: cadence,
    fresh,
    succeeded: passed,
    restoredFrom: id(restoredFrom),
    // An expired drill proves what the product could do, not what it can.
    current: fresh && passed,
    reason: !passed ? 'DRILL_FAILED' : (!fresh ? 'DRILL_EXPIRED' : null),
    i18nKey: fresh && passed ? 'intentAI.survival.drillCurrent' : 'intentAI.survival.drillStale',
    i18nParams: { days: Math.floor(ageMs / 86_400_000) },
    at: now
  };
}

/** The whole picture: every condition, with the missing ones named. */
export function survivalReadiness({
  update = null,
  rotation = null,
  drill = null,
  portability = null,
  owner = null,
  now = Date.now()
} = {}) {
  const missing = [];
  if (update?.shippable !== true) missing.push('update-path');
  if (rotation?.rotated !== true || rotation?.oldKeyDead !== true) missing.push('key-rotation');
  if (drill?.current !== true) missing.push('recovery-drill');
  if (portability?.exportable !== true || portability?.lockIn === true) missing.push('data-portability');
  if (owner?.accountable !== true || !id(owner?.id)) missing.push('owner-accountable');
  const met = SURVIVAL_CONDITIONS.filter((c) => !missing.includes(c));
  return {
    ok: missing.length === 0,
    schema: SURVIVAL_SCHEMA,
    conditions: [...SURVIVAL_CONDITIONS],
    met,
    missing,
    // A year of sustainment is a promise; these are the conditions behind it.
    sustainableForMs: missing.length === 0 ? SURVIVAL_YEAR_MS : 0,
    survivable: missing.length === 0,
    i18nKey: missing.length ? 'intentAI.survival.notReady' : 'intentAI.survival.ready',
    i18nParams: { met: met.length, total: SURVIVAL_CONDITIONS.length },
    at: now,
    error: missing.length ? classifyFailure('MISSING_DATA', { detail: missing[0].toUpperCase().replace(/-/g, '_') }) : null
  };
}

/** No survival claim without the evidence behind it. */
export function assertSurvivable({ readiness = null, rotation = null, drill = null, update = null } = {}) {
  const reasons = [];
  if (readiness) {
    if (readiness.survivable === true && (readiness.missing || []).length) reasons.push('SURVIVABLE_WITH_MISSING_CONDITIONS');
    if (readiness.survivable !== true && num(readiness.sustainableForMs) > 0) reasons.push('SUSTAINMENT_CLAIMED_WITHOUT_READINESS');
  }
  if (rotation) {
    if (rotation.rotated === true && rotation.oldKeyDead !== true) reasons.push('ROTATED_WITH_LIVE_OLD_KEY');
    if (rotation.rotated === true && !id(rotation.newKeyId)) reasons.push('ROTATED_WITHOUT_NEW_KEY');
  }
  if (drill) {
    if (drill.current === true && drill.fresh !== true) reasons.push('STALE_DRILL_CALLED_CURRENT');
    if (drill.current === true && drill.succeeded !== true) reasons.push('FAILED_DRILL_CALLED_CURRENT');
  }
  if (update) {
    if (update.shippable === true && (update.blockers || []).length) reasons.push('SHIPPABLE_WITH_BLOCKERS');
    if (update.shippable === true && update.reversible !== true) reasons.push('SHIPPABLE_WITHOUT_ROLLBACK');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
