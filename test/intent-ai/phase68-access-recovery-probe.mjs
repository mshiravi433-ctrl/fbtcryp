/**
 * PHASE 68 — ACCESS RECOVERY
 * A lost device is not lost capital. A revoke raised from any device that
 * proves the same identity kills the keys — and after that NOTHING survives,
 * including keys a stale client still holds.
 */
import { readFileSync } from 'node:fs';
import {
  revokeAccess, revokeEverything, assertKeyUsable, applyRevocation, assertNothingSurvives,
  REVOKE_SCOPES, REVOCATION_REASONS, ACCESS_RECOVERY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const ME = 'tg:987654';
const key = (over = {}) => ({ id: 'k1', deviceId: 'phone', identityId: ME, issuedAt: NOW - 60_000, expiresAt: NOW + 86_400_000, ...over });
const KEYS = [
  key(),
  key({ id: 'k2', deviceId: 'phone' }),
  key({ id: 'k3', deviceId: 'laptop' }),
  key({ id: 'k4', deviceId: 'tablet', identityId: 'tg:other' })
];

try {
  /* ---------- raising a revocation ---------- */
  check('a revoke needs a proven identity',
    revokeAccess({ scope: 'identity', identityId: ME, now: NOW }).ok === false);
  check('a revoke needs an identity at all',
    revokeAccess({ scope: 'identity', identityProven: true, now: NOW }).ok === false);
  check('a bad scope is refused', revokeAccess({ scope: 'everything', identityId: ME, identityProven: true, now: NOW }).ok === false);
  check('a device revoke needs a device', revokeAccess({ scope: 'device', identityId: ME, identityProven: true, now: NOW }).ok === false);
  check('a key revoke needs a key', revokeAccess({ scope: 'key', identityId: ME, identityProven: true, now: NOW }).ok === false);
  const revoke = revokeAccess({ scope: 'device', identityId: ME, targetDeviceId: 'phone', identityProven: true, requestedFromDeviceId: 'laptop', reason: 'DEVICE_LOST', now: NOW });
  check('a proven revoke succeeds', revoke.ok === true && revoke.schema === ACCESS_RECOVERY_SCHEMA);
  check('it can be raised from ANOTHER device', revoke.tombstone.requestedFromDeviceId === 'laptop');
  check('the tombstone is permanent', revoke.tombstone.permanent === true);
  check('the tombstone is immutable', Object.isFrozen(revoke.tombstone));
  check('the tombstone is dated', revoke.tombstone.revokedAt === NOW);
  check('the tombstone kills keys issued before it', revoke.tombstone.revokesIssuedBefore === NOW);
  check('an unknown reason falls back to a known one',
    revokeAccess({ scope: 'identity', identityId: ME, identityProven: true, reason: 'because', now: NOW }).tombstone.reason === 'USER_REQUEST');
  check('all three scopes are real', REVOKE_SCOPES.length === 3);
  check('the reasons include a lost device', REVOCATION_REASONS.includes('DEVICE_LOST'));

  /* ---------- after a device revoke ---------- */
  const after = [revoke];
  check('a key on the revoked device is dead', assertKeyUsable(key(), after, { now: NOW + 1 }).usable === false);
  check('the death is named a revocation', assertKeyUsable(key(), after, { now: NOW + 1 }).reason === 'KEY_REVOKED');
  check('the revoked key carries a classified error',
    assertKeyUsable(key(), after, { now: NOW + 1 }).error.code === 'SESSION_KEY_REVOKED');
  check('the revoke scope travels with the refusal',
    assertKeyUsable(key(), after, { now: NOW + 1 }).revocationScope === 'device');
  check('a key on another device still works', assertKeyUsable(key({ id: 'k3', deviceId: 'laptop' }), after, { now: NOW + 1 }).usable === true);
  check('another identity is untouched', assertKeyUsable(key({ identityId: 'tg:other' }), after, { now: NOW + 1 }).usable === true);
  check('the refusal is a translatable notice', assertKeyUsable(key(), after, { now: NOW + 1 }).i18nKey === 'intentAI.recovery.keyDead');

  /* ---------- the panic button ---------- */
  const all = revokeEverything({ identityId: ME, identityProven: true, requestedFromDeviceId: 'laptop', now: NOW });
  check('everything can be revoked without knowing the key ids', all.ok === true && all.tombstone.scope === 'identity');
  const tombstones = [all];
  check('every key of this identity dies',
    KEYS.filter((k) => k.identityId === ME).every((k) => assertKeyUsable(k, tombstones, { now: NOW + 1 }).usable === false));
  check('a stale client holding an old key still fails',
    assertKeyUsable(key({ id: 'forgotten', issuedAt: NOW - 999_999 }), tombstones, { now: NOW + 1 }).usable === false);
  check('a key issued AFTER the revoke is not retroactively killed',
    assertKeyUsable(key({ id: 'fresh', issuedAt: NOW + 5000 }), tombstones, { now: NOW + 6000 }).usable === true);
  const applied = applyRevocation({ keys: KEYS, tombstones, now: NOW + 1 });
  check('the summary counts what died', applied.revokedCount === 3);
  check('the summary counts what survived', applied.remainingUsable === 1);
  check('the affected devices are named', applied.devicesAffected.includes('phone') && applied.devicesAffected.includes('laptop'));
  check('the summary is a translatable key', applied.i18nKey === 'intentAI.recovery.summary');

  /* ---------- a single key ---------- */
  const single = revokeAccess({ scope: 'key', identityId: ME, targetKeyId: 'k2', identityProven: true, now: NOW });
  check('one key can be revoked alone', assertKeyUsable(key({ id: 'k2' }), [single], { now: NOW + 1 }).usable === false);
  check('its neighbours survive', assertKeyUsable(key({ id: 'k1' }), [single], { now: NOW + 1 }).usable === true);

  /* ---------- ordinary key hygiene still applies ---------- */
  check('an expired key is refused even with no revocation',
    assertKeyUsable(key({ expiresAt: NOW - 1 }), [], { now: NOW }).usable === false);
  check('the expiry is named distinctly', assertKeyUsable(key({ expiresAt: NOW - 1 }), [], { now: NOW }).reason === 'KEY_EXPIRED');
  check('an incomplete key is never usable', assertKeyUsable({}, [], { now: NOW }).usable === false);
  check('a valid key with no revocations works', assertKeyUsable(key(), [], { now: NOW }).usable === true);

  /* ---------- the fail-closed guard ---------- */
  check('after revoking everything, nothing of this identity survives',
    assertNothingSurvives({ keys: KEYS.filter((k) => k.identityId === ME), tombstones, now: NOW + 1 }).ok === true);
  check('a surviving key is caught and named',
    assertNothingSurvives({ keys: KEYS, tombstones: [revoke], now: NOW + 1 }).survivors.includes('k3'));
  check('the survivor guard carries a classified error',
    assertNothingSurvives({ keys: KEYS, tombstones: [revoke], now: NOW + 1 }).error.code === 'SESSION_KEY_REVOKED');
  check('with no tombstones every key survives, and the guard says so',
    assertNothingSurvives({ keys: KEYS, tombstones: [], now: NOW }).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the recovery strings are translated in en, fa and ar',
    locales.every((loc) => ['revoked', 'keyDead', 'summary'].every((k) => typeof loc?.intentAI?.recovery?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase68-access-recovery', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
