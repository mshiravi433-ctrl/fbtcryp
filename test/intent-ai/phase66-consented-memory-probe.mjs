/**
 * PHASE 66 — CONSENTED MEMORY
 * Memory is not an entitlement. Off means NOTHING is produced that could be
 * stored; consent is specific, dated and revocable; the revoke wipes; and the
 * export is complete or it refuses.
 */
import { readFileSync } from 'node:fs';
import {
  grantMemoryConsent, memoryOff, consentCovers, recordWithConsent,
  exportMemory, revokeMemoryConsent, assertNothingStored,
  MEMORY_SCOPES, CONSENT_MAX_AGE_MS, CONSENT_MEMORY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const CONSENT = grantMemoryConsent({ scopes: ['preferences', 'outcomes'], userConfirmed: true, now: NOW });

try {
  /* ---------- consent is explicit ---------- */
  check('consent requires an explicit confirmation',
    grantMemoryConsent({ scopes: ['preferences'], now: NOW }).ok === false);
  check('consent requires at least one scope',
    grantMemoryConsent({ scopes: [], userConfirmed: true, now: NOW }).ok === false);
  check('unknown scopes are dropped, not honoured',
    grantMemoryConsent({ scopes: ['everything'], userConfirmed: true, now: NOW }).ok === false);
  check('a real grant is recorded', CONSENT.ok === true && CONSENT.enabled === true);
  check('the grant names its scopes', CONSENT.scopes.includes('preferences'));
  check('the grant is dated', CONSENT.grantedAt === NOW);
  check('the grant expires', CONSENT.expiresAt === NOW + CONSENT_MAX_AGE_MS);
  check('the grant is revocable', CONSENT.revocable === true);
  check('the grant notice is a translatable key', CONSENT.i18nKey === 'intentAI.memory.consentGranted');
  check('every known scope is a real option', MEMORY_SCOPES.length >= 4);

  /* ---------- coverage ---------- */
  check('a consented scope is covered', consentCovers(CONSENT, 'preferences', { now: NOW }) === true);
  check('an unconsented scope is not covered', consentCovers(CONSENT, 'assets', { now: NOW }) === false);
  check('an expired consent covers nothing', consentCovers(CONSENT, 'preferences', { now: NOW + CONSENT_MAX_AGE_MS + 1 }) === false);
  check('memory-off covers nothing', consentCovers(memoryOff({ now: NOW }), 'preferences', { now: NOW }) === false);
  check('a hand-made object is not consent', consentCovers({ enabled: true, scopes: ['preferences'] }, 'preferences', { now: NOW }) === false);

  /* ---------- OFF means nothing is produced ---------- */
  const off = recordWithConsent({ consent: memoryOff({ now: NOW }), scope: 'preferences', record: { likes: 'eth' }, now: NOW });
  check('with memory off nothing is stored', off.stored === false);
  check('with memory off there is NO payload at all', off.payload === null);
  check('the refusal is a translatable key', off.i18nKey === 'intentAI.memory.notStored');
  check('the refusal names the reason', off.reason === 'MEMORY_OFF');
  check('the fail-closed guard confirms nothing was produced', assertNothingStored(off).ok === true);
  const outOfScope = recordWithConsent({ consent: CONSENT, scope: 'assets', record: { x: 1 }, now: NOW });
  check('a consented user still gets nothing stored outside the scopes', outOfScope.payload === null);
  check('the out-of-scope reason is distinct', outOfScope.reason === 'SCOPE_NOT_CONSENTED');
  const expiredConsent = recordWithConsent({ consent: CONSENT, scope: 'preferences', record: { x: 1 }, now: NOW + CONSENT_MAX_AGE_MS + 1 });
  check('an expired consent stores nothing', expiredConsent.payload === null);
  check('the guard rejects anything that claims it stored',
    assertNothingStored({ stored: true, payload: null }).ok === false);
  check('the guard rejects a lingering payload',
    assertNothingStored({ stored: false, payload: {} }).ok === false);

  /* ---------- ON stores, but never secrets ---------- */
  const on = recordWithConsent({ consent: CONSENT, scope: 'preferences', record: { likes: 'eth', privateKey: '0xdead' }, now: NOW });
  check('with consent the record is stored', on.stored === true && on.payload !== null);
  check('the payload carries the real data', on.payload.data.likes === 'eth');
  check('consent never covers credentials', on.payload.data.privateKey === undefined);
  check('the payload is scoped and dated', on.payload.scope === 'preferences' && on.payload.at === NOW);
  check('an empty record is refused', recordWithConsent({ consent: CONSENT, scope: 'preferences', now: NOW }).ok === false);

  /* ---------- export is complete or it refuses ---------- */
  const exported = exportMemory({ consent: CONSENT, records: [{ a: 1 }, { b: 2, mnemonic: 'x' }], now: NOW });
  check('the export hands everything back', exported.ok === true && exported.count === 2);
  check('the export declares itself complete', exported.complete === true);
  check('the export carries the consent record', exported.consent.scopes.includes('preferences'));
  check('the export holds no secret', exported.containsSecrets === false);
  check('an unreadable memory refuses to export a partial view',
    exportMemory({ consent: CONSENT, records: null, now: NOW }).ok === false);
  check('an export without a consent record is refused', exportMemory({ records: [], now: NOW }).ok === false);

  /* ---------- revoke wipes ---------- */
  let wiped = false;
  const revoked = revokeMemoryConsent({ consent: CONSENT, clearHandler: () => { wiped = true; }, now: NOW });
  check('revoking turns memory off', revoked.consent.enabled === false);
  check('revoking records the reason', revoked.consent.reason === 'USER_REVOKED');
  check('revoking actually wipes', wiped === true && revoked.cleared === true);
  check('the revoke notice is a translatable key', revoked.i18nKey === 'intentAI.memory.revoked');
  const failedWipe = revokeMemoryConsent({ consent: CONSENT, clearHandler: () => { throw new Error('disk'); }, now: NOW });
  check('a revoke that could not wipe is a FAILED revoke', failedWipe.ok === false && failedWipe.cleared === false);
  check('the failed wipe says so honestly', failedWipe.i18nKey === 'intentAI.memory.revokeFailed');
  check('the failed wipe carries a classified error', typeof failedWipe.error?.code === 'string');
  check('after a revoke, nothing is stored again',
    recordWithConsent({ consent: revoked.consent, scope: 'preferences', record: { x: 1 }, now: NOW }).payload === null);

  /* ---------- the default ---------- */
  const dflt = memoryOff({ now: NOW });
  check('the default state is off', dflt.enabled === false && dflt.schema === CONSENT_MEMORY_SCHEMA);
  check('the default state has no scopes', dflt.scopes.length === 0);
  check('the off state is a translatable notice', dflt.i18nKey === 'intentAI.memory.off');

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every memory string is translated in en, fa and ar',
    locales.every((loc) => ['off', 'consentGranted', 'notStored', 'stored', 'revoked', 'revokeFailed']
      .every((k) => typeof loc?.intentAI?.memory?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase66-consented-memory', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
