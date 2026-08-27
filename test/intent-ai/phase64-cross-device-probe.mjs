/**
 * PHASE 64 — CROSS-DEVICE CONTINUITY
 * A device is not a user. Context travels; authority does not. Every financial
 * confirmation is taken again on the second device, and a mismatched or
 * unverified identity gets nothing at all.
 */
import { readFileSync } from 'node:fs';
import {
  resolveLinkedIdentity, createHandoff, acceptHandoff, assertNoTransferredAuthority,
  NON_TRANSFERABLE, HANDOFF_TTL_MS, CONTINUITY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const TG = { id: '987654', verified: true, verifiedAt: NOW - 60_000 };
const SESSION = {
  id: 'sess-1', status: 'ACTIVE', level: 2, policy: { maxTransactionUsd: 200 },
  goalDeadline: NOW + 86_400_000,
  sessionKeys: [{ id: 'k1' }], signatures: ['0xabc'], gateDecisions: ['CONFIRM'],
  confirmations: [{ id: 'c1' }], walletRuntime: {}, approvals: ['0xspender']
};

try {
  /* ---------- identity ---------- */
  const who = resolveLinkedIdentity({ telegram: TG, now: NOW });
  check('a verified linked login resolves an identity', who.ok === true && who.identityId === 'tg:987654');
  check('no login means no identity', resolveLinkedIdentity({ now: NOW }).ok === false);
  check('an unverified login is refused', resolveLinkedIdentity({ telegram: { id: '1' }, now: NOW }).ok === false);
  check('a login with no time is refused', resolveLinkedIdentity({ telegram: { id: '1', verified: true }, now: NOW }).ok === false);

  /* ---------- the handoff ---------- */
  const handoff = createHandoff({ session: SESSION, messages: [{ role: 'user', text: 'hi' }], identity: who, fromDeviceId: 'phone', now: NOW });
  check('a handoff is created for a linked identity', handoff.ok === true && handoff.schema === CONTINUITY_SCHEMA);
  check('the context travels', handoff.context.goalDeadline === SESSION.goalDeadline);
  check('the policy travels', handoff.context.policy.maxTransactionUsd === 200);
  check('the messages travel', handoff.messages.length === 1);
  for (const field of NON_TRANSFERABLE) {
    check(`authority does not travel: ${field}`, !(field in handoff.context));
  }
  check('the stripped fields are reported by name',
    handoff.strippedFields.includes('sessionKeys') && handoff.strippedFields.includes('gateDecisions'));
  check('only fields that were actually present are reported as stripped',
    handoff.strippedFields.every((f) => f in SESSION));
  check('the handoff carries no authority', handoff.carriesAuthority === false && handoff.executionAuthorized === false);
  check('the handoff demands reconfirmation', handoff.handoffRequiresReconfirmation === true);
  check('the handoff expires', handoff.expiresAt === NOW + HANDOFF_TTL_MS);
  check('a handoff without an identity is refused', createHandoff({ session: SESSION, now: NOW }).ok === false);
  check('a handoff without a session is refused', createHandoff({ identity: who, now: NOW }).ok === false);

  /* ---------- accepting it ---------- */
  const accepted = acceptHandoff(handoff, { identity: who, toDeviceId: 'laptop', now: NOW + 1000 });
  check('the same identity may accept', accepted.ok === true);
  check('the session arrives', accepted.session.policy.maxTransactionUsd === 200);
  check('accepting authorizes nothing', accepted.executionAuthorized === false);
  check('accepting demands reconfirmation', accepted.requiresReconfirmation === true);
  check('the reconfirmation list is explicit', accepted.pendingReconfirmation.includes('confirmationGate'));
  check('the wallet signature must be taken again', accepted.pendingReconfirmation.includes('walletSignature'));
  check('the resume notice is a translatable key', accepted.i18nKey === 'intentAI.continuity.resumed');
  for (const field of NON_TRANSFERABLE) {
    check(`the accepted session holds no ${field}`, !(field in accepted.session));
  }

  /* ---------- who may not accept ---------- */
  const other = resolveLinkedIdentity({ telegram: { ...TG, id: '111' }, now: NOW });
  check('a different account cannot accept', acceptHandoff(handoff, { identity: other, now: NOW }).ok === false);
  check('the mismatch is named as such',
    acceptHandoff(handoff, { identity: other, now: NOW }).error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('an unverified identity cannot accept',
    acceptHandoff(handoff, { identity: { id: '987654' }, now: NOW }).ok === false);
  check('an expired handoff cannot be accepted',
    acceptHandoff(handoff, { identity: who, now: NOW + HANDOFF_TTL_MS + 1 }).ok === false);
  check('nothing at all cannot be accepted', acceptHandoff(null, { identity: who, now: NOW }).ok === false);

  /* ---------- a STOPPED session arrives STOPPED ---------- */
  const stopped = createHandoff({ session: { ...SESSION, status: 'STOPPED' }, identity: who, now: NOW });
  const stoppedAccepted = acceptHandoff(stopped, { identity: who, now: NOW + 1 });
  check('continuity never restarts a stopped session', stoppedAccepted.session.status === 'STOPPED');

  /* ---------- the fail-closed guard ---------- */
  check('the guard accepts a clean handoff', assertNoTransferredAuthority(accepted).ok === true);
  check('the guard rejects a handoff claiming execution',
    assertNoTransferredAuthority({ ...accepted, executionAuthorized: true }).ok === false);
  check('the guard rejects a handoff skipping reconfirmation',
    assertNoTransferredAuthority({ ...accepted, requiresReconfirmation: false }).ok === false);
  check('the guard catches authority that travelled',
    assertNoTransferredAuthority({ ...accepted, session: { ...accepted.session, sessionKeys: ['k'] } }).ok === false);
  check('the guard rejects a non-handoff', assertNoTransferredAuthority({}).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the resume notice is translated in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.continuity?.resumed === 'string'));

  console.log(JSON.stringify({ probe: 'phase64-cross-device', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
