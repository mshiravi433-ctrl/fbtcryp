/**
 * PHASE 95 — PUBLIC INTENT OS API / SDK
 * A third-party developer gets the same fail-closed product the first-party
 * app gets. Keys are scoped and instantly revocable, a revoked key has no path
 * at all, and no scope at any price authorises execution or signing.
 */
import { readFileSync } from 'node:fs';
import {
  issueApiKey, revokeApiKey, isKeyRevoked, describeApiKey, authorizeApiCall,
  handleApiCall, publicApiManifest, assertNoBypass, _resetPublicApiStore,
  API_SCOPES, FORBIDDEN_API_SCOPES, API_OPERATIONS, API_KEY_MAX_TTL_MS, API_KEY_MIN_TTL_MS,
  PUBLIC_API_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const READ_SCOPES = ['read:status', 'read:quotes'];

try {
  _resetPublicApiStore();

  /* ---------- issuing a key ---------- */
  const issued = issueApiKey({ ownerId: 'dev-1', scopes: READ_SCOPES, label: 'demo', now: NOW });
  check('a scoped key is issued', issued.ok === true && issued.schema === PUBLIC_API_SCHEMA);
  check('the key carries only the scopes that were granted', issued.key.scopes.join(',') === READ_SCOPES.join(','));
  check('the key expires', issued.key.expiresAt === NOW + API_KEY_MAX_TTL_MS);
  check('the key never claims execution authority', issued.key.executionAuthorized === false);
  check('the raw secret is returned exactly once', typeof issued.secret === 'string' && issued.secretShownOnce === true);
  check('the public key view never carries the secret', !('secret' in issued.key) && !('secretDigest' in issued.key));
  check('the stored key view is frozen', Object.isFrozen(issued.key));
  check('the issuance is a translatable notice', issued.i18nKey === 'intentAI.api.keyIssued');
  check('an unknown scope is dropped, not granted',
    issueApiKey({ ownerId: 'dev-2', scopes: ['read:status', 'write:execute'], now: NOW }).key.scopes.includes('write:execute') === false);
  check('the dropped scope is reported back',
    issueApiKey({ ownerId: 'dev-3', scopes: ['read:status', 'write:execute'], now: NOW }).refusedScopes.includes('write:execute'));
  check('a key with no grantable scope is refused',
    issueApiKey({ ownerId: 'dev-4', scopes: ['write:execute', 'admin:*'], now: NOW }).ok === false);
  check('the scope refusal is a guardian rejection',
    issueApiKey({ ownerId: 'dev-5', scopes: ['admin:*'], now: NOW }).error.code === 'GUARDIAN_REJECTED');
  check('a key with no owner is refused', issueApiKey({ scopes: READ_SCOPES, now: NOW }).ok === false);
  check('a key with no expiry is refused', issueApiKey({ ownerId: 'dev-6', scopes: READ_SCOPES, ttlMs: null, now: NOW }).ok === false);
  check('an empty-string ttl is not read as zero', issueApiKey({ ownerId: 'dev-7', scopes: READ_SCOPES, ttlMs: '', now: NOW }).ok === false);
  check('a boolean ttl is not read as one', issueApiKey({ ownerId: 'dev-8', scopes: READ_SCOPES, ttlMs: true, now: NOW }).ok === false);
  check('a ttl beyond the maximum is refused',
    issueApiKey({ ownerId: 'dev-9', scopes: READ_SCOPES, ttlMs: API_KEY_MAX_TTL_MS + 1, now: NOW }).ok === false);
  check('a ttl below the minimum is refused',
    issueApiKey({ ownerId: 'dev-10', scopes: READ_SCOPES, ttlMs: API_KEY_MIN_TTL_MS - 1, now: NOW }).ok === false);

  /* ---------- what the scopes may do ---------- */
  const authorized = authorizeApiCall({ keyRef: issued.key, operation: 'status.get', now: NOW });
  check('an in-scope read is authorized', authorized.ok === true && authorized.authorized === true);
  check('an authorized call still never authorizes execution', authorized.executionAuthorized === false);
  check('an out-of-scope read is refused',
    authorizeApiCall({ keyRef: issued.key, operation: 'receipt.get', now: NOW }).authorized === false);
  check('the missing scope is named',
    authorizeApiCall({ keyRef: issued.key, operation: 'receipt.get', now: NOW }).missingScope === 'read:receipts');
  check('an unknown operation is refused',
    authorizeApiCall({ keyRef: issued.key, operation: 'nonsense.do', now: NOW }).authorized === false);
  check('execution is refused even with every readable scope',
    authorizeApiCall({ keyRef: issueApiKey({ ownerId: 'dev-11', scopes: [...API_SCOPES], now: NOW }).key, operation: 'intent.execute', now: NOW }).authorized === false);
  check('the execution refusal names the reason',
    authorizeApiCall({ keyRef: issued.key, operation: 'intent.execute', now: NOW }).reason === 'EXECUTION_NEVER_DELEGATED');
  check('the execution refusal points back at the confirmation gate',
    authorizeApiCall({ keyRef: issued.key, operation: 'intent.execute', now: NOW }).requiresConfirmationGate === true);
  check('signing is refused the same way',
    authorizeApiCall({ keyRef: issued.key, operation: 'intent.sign', now: NOW }).reason === 'EXECUTION_NEVER_DELEGATED');
  check('no operation in the table both executes and is reachable by scope',
    Object.values(API_OPERATIONS).filter((o) => o.executes === true).every((o) => !API_SCOPES.includes(o.scope)));
  check('drafting an intent still requires the confirmation gate',
    authorizeApiCall({
      keyRef: issueApiKey({ ownerId: 'dev-12', scopes: ['write:draft-intent'], now: NOW }).key,
      operation: 'intent.draft', now: NOW
    }).requiresConfirmationGate === true);

  /* ---------- revocation is immediate and total ---------- */
  const doomed = issueApiKey({ ownerId: 'dev-13', scopes: [...API_SCOPES], now: NOW });
  check('a live key is not revoked', isKeyRevoked(doomed.key, { now: NOW }) === false);
  const revoked = revokeApiKey(doomed.key, { now: NOW + 10 });
  check('the key is revoked', revoked.ok === true && revoked.key.revoked === true);
  check('revocation is timestamped', revoked.key.revokedAt === NOW + 10);
  check('the revoked key reads as revoked', isKeyRevoked(doomed.key, { now: NOW + 20 }) === true);
  for (const op of Object.keys(API_OPERATIONS)) {
    check(`a revoked key has no path to ${op}`,
      authorizeApiCall({ keyRef: doomed.key, operation: op, now: NOW + 20 }).authorized === false);
  }
  check('the revoked refusal is a revoked-key failure',
    authorizeApiCall({ keyRef: doomed.key, operation: 'status.get', now: NOW + 20 }).error.code === 'SESSION_KEY_REVOKED');
  check('an unknown key is treated as revoked', isKeyRevoked('ak_nope', { now: NOW }) === true);
  check('an unknown key cannot call anything',
    authorizeApiCall({ keyRef: 'ak_nope', operation: 'status.get', now: NOW }).authorized === false);
  check('revoking an unknown key is refused honestly', revokeApiKey('ak_nope').ok === false);
  const shortLived = issueApiKey({ ownerId: 'dev-14', scopes: READ_SCOPES, ttlMs: API_KEY_MIN_TTL_MS, now: NOW });
  check('an expired key cannot call anything',
    authorizeApiCall({ keyRef: shortLived.key, operation: 'status.get', now: NOW + API_KEY_MIN_TTL_MS + 1 }).authorized === false);
  check('the expiry refusal is an expired-key failure',
    authorizeApiCall({ keyRef: shortLived.key, operation: 'status.get', now: NOW + API_KEY_MIN_TTL_MS + 1 }).error.code === 'SESSION_KEY_EXPIRED');
  check('describing a key never exposes the secret digest',
    !('secretDigest' in (describeApiKey(issued.key) || {})));

  /* ---------- running a call ---------- */
  const call = await handleApiCall({
    keyRef: issued.key, operation: 'status.get', handler: async () => ({ status: 'ok' }), now: NOW
  });
  check('an authorized call runs the handler', call.ok === true && call.data.status === 'ok');
  check('the response never claims execution', call.executionAuthorized === false);
  const forged = await handleApiCall({
    keyRef: issued.key, operation: 'status.get',
    handler: async () => ({ status: 'ok', txHash: '0x'.concat('a'.repeat(64)), receipt: { status: 'COMPLETED' } }),
    now: NOW
  });
  check('a handler cannot smuggle a transaction hash into the response', forged.data.txHash === undefined);
  check('a handler cannot smuggle a receipt into the response', forged.data.receipt === undefined);
  check('a handler cannot return a signature', (await handleApiCall({
    keyRef: issued.key, operation: 'status.get', handler: async () => ({ signature: '0xdead' }), now: NOW
  })).data.signature === undefined);
  check('a throwing handler is an honest provider error',
    (await handleApiCall({ keyRef: issued.key, operation: 'status.get', handler: async () => { throw new Error('x'); }, now: NOW })).error.code === 'PROVIDER_ERROR');
  check('a missing handler is honestly unavailable',
    (await handleApiCall({ keyRef: issued.key, operation: 'status.get', now: NOW })).i18nKey === 'intentAI.api.unavailable');
  check('a revoked key never reaches the handler', (await handleApiCall({
    keyRef: doomed.key, operation: 'status.get', handler: async () => ({ leaked: true }), now: NOW + 20
  })).data === null);

  /* ---------- the manifest ---------- */
  const manifest = publicApiManifest({ now: NOW });
  check('the manifest offers no execution operation', manifest.executionOperations.length === 0);
  check('the manifest says it is fail-closed', manifest.failClosed === true);
  check('the manifest lists the forbidden scopes explicitly', manifest.forbiddenScopes.includes('write:execute'));
  check('no forbidden scope is also a granted scope', FORBIDDEN_API_SCOPES.every((s) => !API_SCOPES.includes(s)));

  /* ---------- the guard ---------- */
  check('an honest surface passes the guard',
    assertNoBypass({ key: issued.key, authorization: authorized, response: call, manifest }).ok === true);
  check('a key granting a forbidden scope is caught',
    assertNoBypass({ key: { ...issued.key, scopes: ['write:execute'] } }).reasons.includes('FORBIDDEN_SCOPE_GRANTED'));
  check('a key claiming execution is caught',
    assertNoBypass({ key: { ...issued.key, executionAuthorized: true } }).reasons.includes('KEY_CLAIMS_EXECUTION'));
  check('an immortal key is caught',
    assertNoBypass({ key: { ...issued.key, expiresAt: null } }).reasons.includes('KEY_NEVER_EXPIRES'));
  check('a key view leaking its secret is caught',
    assertNoBypass({ key: { ...issued.key, secret: 'fbt_sk_x' } }).reasons.includes('KEY_LEAKS_SECRET'));
  check('an authorization that authorized execution is caught',
    assertNoBypass({ authorization: { authorized: true, executionAuthorized: true } }).reasons.includes('AUTHORIZED_EXECUTION'));
  check('a response carrying a receipt is caught',
    assertNoBypass({ response: { data: { receipt: {} } } }).reasons.includes('RESPONSE_CARRIES_RECEIPT'));
  check('a manifest offering execution is caught',
    assertNoBypass({ manifest: { executionOperations: ['intent.execute'], failClosed: true } }).reasons.includes('MANIFEST_OFFERS_EXECUTION'));
  check('the guard rejection is a guardian rejection',
    assertNoBypass({ key: { ...issued.key, executionAuthorized: true } }).error.code === 'GUARDIAN_REJECTED');

  /* ---------- copy ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the api copy is translated in en, fa and ar',
    locales.every((loc) => ['keyIssued', 'keyRevoked', 'keyExpired', 'scopeRefused', 'executionRefused', 'manifest']
      .every((k) => typeof loc?.intentAI?.api?.[k] === 'string')));
  check('the english copy says execution stays with the user',
    /only the person holding the wallet/i.test(locales[0].intentAI.api.executionRefused));
  check('the english copy warns the secret is shown once',
    /only once/i.test(locales[0].intentAI.api.keyIssued));

  _resetPublicApiStore();
  console.log(JSON.stringify({ probe: 'phase95-public-api', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
