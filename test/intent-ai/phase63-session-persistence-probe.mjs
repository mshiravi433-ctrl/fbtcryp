/**
 * PHASE 63 — SESSION PERSISTENCE
 * A reload is not amnesia — but a corrupt snapshot is a CLEAN START, never a
 * crash and never a half-restored session. STOPPED survives verbatim, secrets
 * never reach disk, and a restore can never be more permissive than what was
 * saved.
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import {
  buildSnapshot, encryptSnapshot, restoreSnapshot, stripSecrets, snapshotDigest,
  assertRestoreNotEscalated, FORBIDDEN_FIELDS, SNAPSHOT_MAX_AGE_MS, PERSISTENCE_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const SECRET = 'device-secret-0123456789abcdef';
const SESSION = {
  id: 'sess-1', status: 'ACTIVE', level: 2,
  policy: { maxTransactionUsd: 200, maxCapitalUsd: 1000 },
  permissions: ['quote'], controls: [],
  privateKey: '0xdeadbeef', signature: '0xsigsigsig'
};

try {
  /* ---------- secrets never reach disk ---------- */
  const stripped = stripSecrets(SESSION);
  check('a private key is stripped', !('privateKey' in stripped));
  check('a signature is stripped', !('signature' in stripped));
  check('ordinary state survives the strip', stripped.status === 'ACTIVE' && stripped.level === 2);
  check('nested secrets are stripped too',
    !JSON.stringify(stripSecrets({ a: { b: { mnemonic: 'x y z' } } })).includes('mnemonic'));
  check('arrays are walked', stripSecrets([{ seedPhrase: 'a' }])[0].seedPhrase === undefined);

  const snap = buildSnapshot({ session: SESSION, messages: [{ role: 'user', text: 'hi' }], now: NOW });
  check('a snapshot is built', snap.ok === true && snap.schema === PERSISTENCE_SCHEMA);
  check('the snapshot body holds no secret field', snap.containsSecrets === false);
  check('no forbidden field name appears in the body',
    FORBIDDEN_FIELDS.every((f) => !new RegExp(`"${f}"`, 'i').test(snap.body)));
  check('the snapshot carries an integrity digest', typeof snap.digest === 'string' && snap.digest.length === 16);
  check('the digest changes when the body changes', snapshotDigest('a') !== snapshotDigest('b'));
  check('the digest is stable for the same body', snapshotDigest('abc') === snapshotDigest('abc'));
  check('a snapshot with no session is refused', buildSnapshot({ now: NOW }).ok === false);

  /* ---------- encryption ---------- */
  const enc = await encryptSnapshot({ snapshot: snap, deviceSecret: SECRET, crypto: webcrypto });
  check('the snapshot encrypts', enc.ok === true && typeof enc.envelope.ct === 'string');
  check('the envelope holds no plaintext', !enc.envelope.ct.includes('ACTIVE'));
  check('a weak device secret is refused', (await encryptSnapshot({ snapshot: snap, deviceSecret: 'short', crypto: webcrypto })).ok === false);
  check('no WebCrypto means no silent plaintext write',
    (await encryptSnapshot({ snapshot: snap, deviceSecret: SECRET, crypto: null })).ok === false);

  /* ---------- restore ---------- */
  const back = await restoreSnapshot({ envelope: enc.envelope, deviceSecret: SECRET, crypto: webcrypto, now: NOW + 1000 });
  check('the session restores', back.ok === true && back.cleanStart === false);
  check('the status is restored verbatim', back.session.status === 'ACTIVE');
  check('the policy is restored verbatim', back.session.policy.maxTransactionUsd === 200);
  check('the messages come back', back.messages.length === 1);
  check('no secret comes back', back.session.privateKey === undefined);
  check('a restore is never a re-authorization', back.executionAuthorized === false);
  check('a restore asks for confirmations again', back.requiresReconfirmation === true);

  /* ---------- STOPPED survives ---------- */
  const stoppedSnap = buildSnapshot({ session: { ...SESSION, status: 'STOPPED', stopReason: 'USER' }, now: NOW });
  const stoppedEnc = await encryptSnapshot({ snapshot: stoppedSnap, deviceSecret: SECRET, crypto: webcrypto });
  const stoppedBack = await restoreSnapshot({ envelope: stoppedEnc.envelope, deviceSecret: SECRET, crypto: webcrypto, now: NOW + 1000 });
  check('a STOPPED session comes back STOPPED', stoppedBack.session.status === 'STOPPED');
  check('the stop reason survives', stoppedBack.session.stopReason === 'USER');

  /* ---------- corrupt data is a clean start, not a crash ---------- */
  const cases = [
    ['no snapshot at all', { envelope: null }],
    ['a wrong device secret', { envelope: enc.envelope, deviceSecret: 'wrong-secret-0123456789' }],
    ['a tampered ciphertext', { envelope: { ...enc.envelope, ct: `${enc.envelope.ct.slice(0, -4)}AAAA` } }],
    ['a garbage envelope', { envelope: { v: 1, ct: 'not-base64-at-all', iv: 'x', salt: 'y' } }],
    ['a missing iv', { envelope: { ...enc.envelope, iv: '' } }]
  ];
  for (const [label, over] of cases) {
    const r = await restoreSnapshot({ deviceSecret: SECRET, crypto: webcrypto, now: NOW, ...over });
    check(`${label} yields a clean start, not a throw`, r.cleanStart === true && r.session === null);
  }
  const tamperedDigest = await restoreSnapshot({
    envelope: { ...enc.envelope, digest: 'ffffffffffffffff' }, deviceSecret: SECRET, crypto: webcrypto, now: NOW
  });
  check('a failed integrity check is a clean start', tamperedDigest.cleanStart === true);
  const expired = await restoreSnapshot({
    envelope: enc.envelope, deviceSecret: SECRET, crypto: webcrypto, now: NOW + SNAPSHOT_MAX_AGE_MS + 1
  });
  check('an expired snapshot is a clean start', expired.cleanStart === true);
  check('the clean start is a translatable notice', expired.i18nKey === 'intentAI.persistence.cleanStart');

  /* ---------- a restore may never escalate ---------- */
  check('an identical restore is fine', assertRestoreNotEscalated(SESSION, SESSION).ok === true);
  check('losing STOPPED on restore is caught',
    assertRestoreNotEscalated({ ...SESSION, status: 'STOPPED' }, { ...SESSION, status: 'ACTIVE' }).ok === false);
  check('a level escalation is caught',
    assertRestoreNotEscalated(SESSION, { ...SESSION, level: 3 }).ok === false);
  check('a widened transaction cap is caught',
    assertRestoreNotEscalated(SESSION, { ...SESSION, policy: { maxTransactionUsd: 5000 } }).ok === false);
  check('a widened capital cap is caught',
    assertRestoreNotEscalated(SESSION, { ...SESSION, policy: { maxCapitalUsd: 999999 } }).ok === false);
  check('a permission gained on restore is caught',
    assertRestoreNotEscalated(SESSION, { ...SESSION, permissions: ['quote', 'execute'] }).ok === false);
  check('a tightened restore is allowed',
    assertRestoreNotEscalated(SESSION, { ...SESSION, level: 1, policy: { maxTransactionUsd: 50 } }).ok === true);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the clean-start notice is translated in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.persistence?.cleanStart === 'string'));

  console.log(JSON.stringify({ probe: 'phase63-session-persistence', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
