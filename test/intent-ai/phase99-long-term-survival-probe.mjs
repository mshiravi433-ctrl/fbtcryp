/**
 * PHASE 99 — LONG-TERM SURVIVAL
 * Phase 40 proved a one-year plan on paper. This turns it into conditions the
 * running product keeps meeting: an update that can be rolled back, a rotation
 * that actually kills the old key, and a recovery drill with a real date.
 */
import { readFileSync } from 'node:fs';
import {
  planUpdate, rotateAndRevoke, recoveryDrill, survivalReadiness, assertSurvivable,
  revokeAccess, assertKeyUsable,
  SURVIVAL_CONDITIONS, SURVIVAL_YEAR_MS, DRILL_CADENCE_MS, SURVIVAL_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const OLD_KEY = { id: 'k-old', identityId: 'user-1', deviceId: 'phone-1', issuedAt: NOW - 10 * DAY };
const NEW_KEY = { id: 'k-new', identityId: 'user-1', deviceId: 'phone-2', issuedAt: NOW };

try {
  /* ---------- updates ---------- */
  const update = planUpdate({
    fromVersion: '1.39.0', toVersion: '1.40.0', rollbackVersion: '1.39.0',
    migrations: [{ id: 'm1', reversible: true, backwardCompatible: true }], now: NOW
  });
  check('a reversible, compatible update is shippable', update.ok === true && update.shippable === true);
  check('the update names its rollback target', update.rollbackVersion === '1.39.0');
  check('the update schema is stable', update.schema === SURVIVAL_SCHEMA);
  check('an irreversible migration blocks the update',
    planUpdate({ fromVersion: '1.39.0', toVersion: '1.40.0', migrations: [{ id: 'm1', reversible: false }], now: NOW }).shippable === false);
  check('the irreversible migration is named',
    planUpdate({ fromVersion: '1.39.0', toVersion: '1.40.0', migrations: [{ id: 'm1', reversible: false }], now: NOW }).blockers.includes('IRREVERSIBLE_MIGRATION'));
  check('an update that strands the old version is blocked',
    planUpdate({ fromVersion: '1.39.0', toVersion: '1.40.0', migrations: [{ id: 'm1', reversible: true, backwardCompatible: false }], now: NOW })
      .blockers.includes('OLD_VERSION_CANNOT_READ_DATA'));
  check('a bad from-version is refused', planUpdate({ fromVersion: 'latest', toVersion: '1.40.0', now: NOW }).shippable === false);
  check('a bad to-version is refused', planUpdate({ fromVersion: '1.39.0', toVersion: 'next', now: NOW }).shippable === false);
  check('an update to the same version is not an update',
    planUpdate({ fromVersion: '1.39.0', toVersion: '1.39.0', now: NOW }).blockers.includes('NOT_AN_UPDATE'));
  check('an update with no migrations is fine', planUpdate({ fromVersion: '1.39.0', toVersion: '1.40.0', now: NOW }).shippable === true);
  check('with no explicit rollback the previous version is the rollback',
    planUpdate({ fromVersion: '1.39.0', toVersion: '1.40.0', now: NOW }).rollbackVersion === '1.39.0');
  check('a blocked update is a translatable notice',
    planUpdate({ fromVersion: 'x', toVersion: '1.40.0', now: NOW }).i18nKey === 'intentAI.survival.updateBlocked');
  check('a blocked update is a guardian rejection',
    planUpdate({ fromVersion: 'x', toVersion: '1.40.0', now: NOW }).error.code === 'GUARDIAN_REJECTED');

  /* ---------- key rotation, proven against the phase-68 tombstones ---------- */
  const revocation = revokeAccess({
    scope: 'key', identityId: 'user-1', targetKeyId: 'k-old',
    reason: 'ROUTINE_ROTATION', requestedFromDeviceId: 'phone-2', identityProven: true, now: NOW
  });
  check('the old key can be revoked through the phase-68 path', revocation.ok === true);
  const tombstones = [revocation.tombstone];
  check('the old key is dead after the revoke', assertKeyUsable(OLD_KEY, tombstones, { now: NOW }).usable === false);
  const rotated = rotateAndRevoke({ oldKey: OLD_KEY, newKey: NEW_KEY, tombstones, now: NOW });
  check('a rotation with a dead old key succeeds', rotated.ok === true && rotated.rotated === true);
  check('the rotation proves the old key is dead', rotated.oldKeyDead === true);
  check('the rotation proves the new key works', rotated.newKeyUsable === true);
  check('the rotation is timestamped', rotated.rotatedAt === NOW);
  const halfRotated = rotateAndRevoke({ oldKey: OLD_KEY, newKey: NEW_KEY, tombstones: [], now: NOW });
  check('a rotation that leaves the old key alive fails', halfRotated.rotated === false);
  check('the live old key is named', halfRotated.oldKeyDead === false);
  check('the half-rotation is a translatable notice', halfRotated.i18nKey === 'intentAI.survival.oldKeyAlive');
  check('the half-rotation is a guardian rejection', halfRotated.error.code === 'GUARDIAN_REJECTED');
  const deadNew = rotateAndRevoke({
    oldKey: OLD_KEY,
    newKey: { ...NEW_KEY, expiresAt: NOW - 1 },
    tombstones, now: NOW
  });
  check('a rotation to an unusable new key fails', deadNew.rotated === false);
  check('rotating a key onto itself is refused', rotateAndRevoke({ oldKey: OLD_KEY, newKey: OLD_KEY, tombstones, now: NOW }).rotated === false);
  check('a rotation with a missing key is refused', rotateAndRevoke({ oldKey: OLD_KEY, tombstones, now: NOW }).rotated === false);

  /* ---------- recovery drills ---------- */
  const drill = recoveryDrill({ lastDrillAt: NOW - 10 * DAY, succeeded: true, restoredFrom: 'backup-2026-08', now: NOW });
  check('a fresh, successful drill is current', drill.ok === true && drill.current === true);
  check('the drill names what it restored from', drill.restoredFrom === 'backup-2026-08');
  check('a drill older than the cadence is expired',
    recoveryDrill({ lastDrillAt: NOW - DRILL_CADENCE_MS - DAY, succeeded: true, restoredFrom: 'old-backup', now: NOW }).current === false);
  check('the expired drill says how old it is',
    recoveryDrill({ lastDrillAt: NOW - DRILL_CADENCE_MS - DAY, succeeded: true, restoredFrom: 'b', now: NOW }).i18nParams.days > 90);
  check('a failed drill is not current',
    recoveryDrill({ lastDrillAt: NOW - DAY, succeeded: false, restoredFrom: 'b', now: NOW }).current === false);
  check('a drill with nothing restored is not a drill',
    recoveryDrill({ lastDrillAt: NOW - DAY, succeeded: true, now: NOW }).current === false);
  check('never drilling is honest, not a pass', recoveryDrill({ now: NOW }).reason === 'NEVER_DRILLED');
  check('an empty-string drill date is not read as the epoch', recoveryDrill({ lastDrillAt: '', succeeded: true, restoredFrom: 'b', now: NOW }).ok === false);
  check('a null drill date is not read as the epoch', recoveryDrill({ lastDrillAt: null, succeeded: true, restoredFrom: 'b', now: NOW }).ok === false);
  check('a boolean drill date is not read as one', recoveryDrill({ lastDrillAt: true, succeeded: true, restoredFrom: 'b', now: NOW }).ok === false);

  /* ---------- the whole picture ---------- */
  const portability = { exportable: true, lockIn: false };
  const owner = { id: 'ops-team', accountable: true };
  const ready = survivalReadiness({ update, rotation: rotated, drill, portability, owner, now: NOW });
  check('every condition met is survivable', ready.ok === true && ready.survivable === true);
  check('a full year is only claimed when everything is met', ready.sustainableForMs === SURVIVAL_YEAR_MS);
  check('all five conditions are listed', ready.conditions.length === SURVIVAL_CONDITIONS.length);
  check('nothing is missing', ready.missing.length === 0);
  const noDrill = survivalReadiness({ update, rotation: rotated, drill: { current: false }, portability, owner, now: NOW });
  check('a stale drill makes the product not survivable', noDrill.survivable === false);
  check('the missing condition is named', noDrill.missing.includes('recovery-drill'));
  check('no year is claimed when a condition is missing', noDrill.sustainableForMs === 0);
  check('lock-in makes the product not survivable',
    survivalReadiness({ update, rotation: rotated, drill, portability: { exportable: true, lockIn: true }, owner, now: NOW }).missing.includes('data-portability'));
  check('an unaccountable owner makes the product not survivable',
    survivalReadiness({ update, rotation: rotated, drill, portability, owner: { id: 'x' }, now: NOW }).missing.includes('owner-accountable'));
  check('a half-rotation makes the product not survivable',
    survivalReadiness({ update, rotation: halfRotated, drill, portability, owner, now: NOW }).missing.includes('key-rotation'));
  check('nothing supplied at all is not survivable', survivalReadiness({ now: NOW }).survivable === false);
  check('the empty readiness names every missing condition', survivalReadiness({ now: NOW }).missing.length === SURVIVAL_CONDITIONS.length);

  /* ---------- the guard ---------- */
  check('an honest readiness passes the guard',
    assertSurvivable({ readiness: ready, rotation: rotated, drill, update }).ok === true);
  check('claiming survivable with missing conditions is caught',
    assertSurvivable({ readiness: { ...noDrill, survivable: true } }).reasons.includes('SURVIVABLE_WITH_MISSING_CONDITIONS'));
  check('claiming a year without readiness is caught',
    assertSurvivable({ readiness: { survivable: false, sustainableForMs: SURVIVAL_YEAR_MS } }).reasons.includes('SUSTAINMENT_CLAIMED_WITHOUT_READINESS'));
  check('a rotation with a live old key is caught',
    assertSurvivable({ rotation: { rotated: true, oldKeyDead: false, newKeyId: 'k-new' } }).reasons.includes('ROTATED_WITH_LIVE_OLD_KEY'));
  check('a rotation with no new key is caught',
    assertSurvivable({ rotation: { rotated: true, oldKeyDead: true } }).reasons.includes('ROTATED_WITHOUT_NEW_KEY'));
  check('a stale drill called current is caught',
    assertSurvivable({ drill: { current: true, fresh: false, succeeded: true } }).reasons.includes('STALE_DRILL_CALLED_CURRENT'));
  check('a failed drill called current is caught',
    assertSurvivable({ drill: { current: true, fresh: true, succeeded: false } }).reasons.includes('FAILED_DRILL_CALLED_CURRENT'));
  check('an update shippable with blockers is caught',
    assertSurvivable({ update: { shippable: true, blockers: ['X'], reversible: true } }).reasons.includes('SHIPPABLE_WITH_BLOCKERS'));
  check('an update shippable without a rollback is caught',
    assertSurvivable({ update: { shippable: true, blockers: [], reversible: false } }).reasons.includes('SHIPPABLE_WITHOUT_ROLLBACK'));

  /* ---------- copy ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the survival copy is translated in en, fa and ar',
    locales.every((loc) => ['updateReady', 'updateBlocked', 'rotated', 'oldKeyAlive', 'drillCurrent', 'drillStale', 'ready', 'notReady']
      .every((k) => typeof loc?.intentAI?.survival?.[k] === 'string')));
  check('the english copy says the old key stops working',
    /no longer works/i.test(locales[0].intentAI.survival.rotated));
  check('the english copy admits an old drill does not count',
    /no longer counts/i.test(locales[0].intentAI.survival.drillStale));

  console.log(JSON.stringify({ probe: 'phase99-long-term-survival', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
