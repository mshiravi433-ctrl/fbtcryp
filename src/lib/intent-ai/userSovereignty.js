/**
 * FBT INTENT AI — PHASE 100: USER SOVEREIGNTY AND CLOSING
 * ---------------------------------------------------------------------------
 * Our control is not the goal. The last phase is the one that makes every
 * earlier phase honest: the user can take everything and leave, in an open
 * format, without asking us, and without anything of theirs staying behind.
 *
 *   · the export is COMPLETE or it is refused — a partial file dressed up as
 *     "your data" is the polite version of lock-in
 *   · the format is open and self-describing (JSON), never a private blob that
 *     only this app can read
 *   · leaving needs one explicit confirmation and nothing else: no retention
 *     offer, no cooling-off period, no support ticket, no fee
 *   · the exit is verified by reading every store back, and the probe for this
 *     phase is the one that proves nothing survived
 *
 * This module deliberately reuses the phase-92 lifecycle primitives rather
 * than growing a second, weaker deletion path.
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';
import { DATA_STORES, exportUserData, deleteUserData, verifyDeletion } from './dataLifecycle.js';

export const SOVEREIGNTY_SCHEMA = 'fbt.user-sovereignty.v1';
export const EXIT_STATES = Object.freeze(['none', 'packaged', 'erasing', 'complete', 'incomplete']);
export const PORTABLE_FORMATS = Object.freeze(['application/json']);

/** Everything an exit has to cover. Missing one of these is not an exit. */
export const EXIT_SURFACES = Object.freeze([
  'data', 'memory', 'history', 'preferences', 'authorizations'
]);

/** Things that would make leaving hard. Named so they can be tested for. */
export const LOCK_IN_PATTERNS = Object.freeze([
  'exit-fee', 'support-ticket-required', 'cooling-off-period', 'partial-export-only',
  'proprietary-format', 'retention-offer-required', 'account-must-stay-open'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** What leaving involves, said plainly, before the user commits to it. */
export function describeExitPath({ now = Date.now() } = {}) {
  return {
    ok: true,
    schema: SOVEREIGNTY_SCHEMA,
    surfaces: [...EXIT_SURFACES],
    stores: [...DATA_STORES],
    format: PORTABLE_FORMATS[0],
    // Everything below is deliberately false. That is the phase.
    requiresSupportTicket: false,
    requiresFee: false,
    coolingOffPeriodMs: 0,
    retentionOfferShown: false,
    stepsRequired: 2,
    reversible: false,
    i18nKey: 'intentAI.sovereignty.exitExplained',
    at: now
  };
}

/**
 * Build the take-everything package. Complete or refused — never a
 * partial file offered as if it were the whole of somebody's history.
 */
export async function buildExitPackage({ userId = null, readers = {}, now = Date.now() } = {}) {
  const who = id(userId);
  if (!who) {
    return { ok: false, complete: false, state: 'none', i18nKey: 'intentAI.sovereignty.exportFailed', error: classifyFailure('MISSING_DATA', { detail: 'NO_USER' }) };
  }
  const exported = await exportUserData({ userId: who, readers, now });
  if (!exported.ok || exported.complete !== true) {
    return {
      ok: false,
      complete: false,
      state: 'none',
      failedStores: exported.failedStores || [],
      // A hole in the export is a hole in the exit.
      i18nKey: 'intentAI.sovereignty.exportIncomplete',
      i18nParams: { missing: (exported.failedStores || []).length },
      error: exported.error || classifyFailure('PROVIDER_ERROR', { detail: 'EXPORT_INCOMPLETE' })
    };
  }
  const payload = {
    schema: SOVEREIGNTY_SCHEMA,
    exportedAt: now,
    userId: who,
    stores: [...DATA_STORES],
    data: exported.data
  };
  return {
    ok: true,
    schema: SOVEREIGNTY_SCHEMA,
    state: 'packaged',
    userId: who,
    format: PORTABLE_FORMATS[0],
    // Open, self-describing, readable without this app.
    openFormat: true,
    proprietaryFormat: false,
    payload,
    checksum: digest(payload),
    complete: true,
    surfaces: [...EXIT_SURFACES],
    containsSecrets: false,
    i18nKey: 'intentAI.sovereignty.packageReady',
    i18nParams: { stores: DATA_STORES.length },
    at: now
  };
}

/**
 * Leave. The package is built first (you cannot lose data on the way out),
 * then everything is erased, then the erasure is verified by reading back.
 */
export async function performExit({
  userId = null,
  readers = {},
  erasers = {},
  confirmed = false,
  now = Date.now()
} = {}) {
  const who = id(userId);
  if (!who) {
    return { ok: false, exited: false, state: 'none', i18nKey: 'intentAI.sovereignty.exitFailed', error: classifyFailure('MISSING_DATA', { detail: 'NO_USER' }) };
  }
  if (confirmed !== true) {
    // One explicit confirmation. Not a retention flow, not a phone call.
    return {
      ok: false, exited: false, state: 'none',
      i18nKey: 'intentAI.sovereignty.needsConfirmation',
      error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'EXIT_NOT_CONFIRMED' })
    };
  }
  const pkg = await buildExitPackage({ userId: who, readers, now });
  if (!pkg.ok) {
    // Nothing is deleted if we could not hand the data over first.
    return {
      ok: false, exited: false, state: 'none', deletionStarted: false,
      package: null, failedStores: pkg.failedStores || [],
      i18nKey: 'intentAI.sovereignty.exportIncomplete',
      error: pkg.error
    };
  }
  const deletion = await deleteUserData({ userId: who, erasers, confirmed: true, now });
  const verification = await verifyDeletion({ userId: who, readers, deletion, now });
  const clean = deletion.complete === true && verification.proven === true;
  return {
    ok: clean,
    schema: SOVEREIGNTY_SCHEMA,
    userId: who,
    state: clean ? 'complete' : 'incomplete',
    exited: clean,
    package: pkg.payload,
    checksum: pkg.checksum,
    deletion,
    verification,
    leftovers: verification.leftovers || [],
    unverifiable: verification.unverifiable || [],
    // The receipt only exists when there is genuinely nothing left.
    receipt: clean
      ? Object.freeze({
        userId: who,
        exitedAt: now,
        stores: DATA_STORES.length,
        proof: digest({ userId: who, at: now, stores: DATA_STORES, exit: true })
      })
      : null,
    i18nKey: clean ? 'intentAI.sovereignty.exitComplete' : 'intentAI.sovereignty.exitIncomplete',
    i18nParams: { remaining: (verification.leftovers || []).length + (verification.unverifiable || []).length },
    at: now,
    error: clean ? null : classifyFailure('PROVIDER_ERROR', { detail: 'RESIDUE_REMAINS' })
  };
}

/** Read every store back and name whatever is left. Proof, not a promise. */
export async function verifyNoResidue({ userId = null, readers = {}, now = Date.now() } = {}) {
  const who = id(userId);
  if (!who) {
    return { ok: false, clean: false, i18nKey: 'intentAI.sovereignty.residueUnknown', error: classifyFailure('MISSING_DATA', { detail: 'NO_USER' }) };
  }
  const residue = [];
  const unreadable = [];
  for (const store of DATA_STORES) {
    const reader = readers?.[store];
    if (typeof reader !== 'function') { unreadable.push({ store, reason: 'NO_READER' }); continue; }
    let value = null;
    try { value = await reader({ userId: who }); } catch { unreadable.push({ store, reason: 'READ_FAILED' }); continue; }
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.length === 0)
      || (typeof value === 'object' && Object.keys(value).length === 0);
    if (!empty) residue.push({ store, reason: 'DATA_REMAINS' });
  }
  const clean = residue.length === 0 && unreadable.length === 0;
  return {
    ok: clean,
    schema: SOVEREIGNTY_SCHEMA,
    userId: who,
    clean,
    residue,
    unreadable,
    storesChecked: DATA_STORES.length,
    // A store we could not read is not a store we proved empty.
    i18nKey: clean ? 'intentAI.sovereignty.noResidue' : 'intentAI.sovereignty.residueFound',
    i18nParams: { remaining: residue.length + unreadable.length },
    at: now
  };
}

/** Nothing in the product may make leaving harder than staying. */
export function assertNoLockIn({ exitPath = null, exitPackage = null, exit = null, residue = null } = {}) {
  const reasons = [];
  if (exitPath) {
    if (exitPath.requiresSupportTicket === true) reasons.push('SUPPORT_TICKET_REQUIRED');
    if (exitPath.requiresFee === true) reasons.push('EXIT_FEE');
    if (num(exitPath.coolingOffPeriodMs) > 0) reasons.push('COOLING_OFF_PERIOD');
    if (exitPath.retentionOfferShown === true) reasons.push('RETENTION_OFFER_REQUIRED');
    if (!PORTABLE_FORMATS.includes(exitPath.format)) reasons.push('PROPRIETARY_FORMAT');
    for (const surface of EXIT_SURFACES) {
      if (!(exitPath.surfaces || []).includes(surface)) reasons.push('EXIT_SURFACE_MISSING');
    }
  }
  if (exitPackage) {
    if (exitPackage.complete === true && (exitPackage.failedStores || []).length) reasons.push('PACKAGE_CLAIMS_COMPLETE');
    if (exitPackage.ok === true && exitPackage.openFormat !== true) reasons.push('PROPRIETARY_FORMAT');
    if (exitPackage.containsSecrets === true) reasons.push('PACKAGE_CONTAINS_SECRETS');
  }
  if (exit) {
    if (exit.exited === true && exit.verification?.proven !== true) reasons.push('EXIT_CLAIMED_WITHOUT_PROOF');
    if (exit.exited === true && (exit.leftovers || []).length) reasons.push('EXIT_WITH_LEFTOVERS');
    if (exit.exited === true && (exit.unverifiable || []).length) reasons.push('EXIT_WITHOUT_READING_EVERYTHING');
    if (exit.exited === true && !exit.package) reasons.push('DELETED_WITHOUT_EXPORT');
    if (exit.receipt && exit.exited !== true) reasons.push('RECEIPT_WITHOUT_EXIT');
  }
  if (residue) {
    if (residue.clean === true && (residue.residue || []).length) reasons.push('CLEAN_WITH_RESIDUE');
    if (residue.clean === true && (residue.unreadable || []).length) reasons.push('CLEAN_WITHOUT_READING_EVERYTHING');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}
