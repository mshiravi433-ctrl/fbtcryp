/**
 * PHASE 67 — NOTIFICATION AND HANDING CONTROL BACK
 * A silent execution is not a consented one. An authorization deadline that
 * lapses HALTS the program — silence is never a yes — and a user who could not
 * be reached on any channel is a reason to stop, not to carry on.
 */
import { readFileSync } from 'node:fs';
import {
  buildNotification, deliverNotification, requestReauthorization,
  resolveAuthorizationTimeout, programMayContinue,
  NOTIFY_EVENTS, NOTIFY_CHANNELS, DEFAULT_AUTHORIZATION_WINDOW_MS, NOTIFY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const allSenders = { 'web-push': async () => true, telegram: async () => true, 'in-app': async () => true };

try {
  /* ---------- notifications are keys, not prose ---------- */
  const done = buildNotification({ event: 'completed', intentId: 'i1', now: NOW });
  check('a completion notification is built', done.ok === true && done.schema === NOTIFY_SCHEMA);
  check('it is an i18n key, not a sentence', done.i18nKey === NOTIFY_EVENTS.COMPLETED);
  check('a notification never authorizes anything', done.executionAuthorized === false);
  check('a failure notification exists', buildNotification({ event: 'failed', now: NOW }).i18nKey === NOTIFY_EVENTS.FAILED);
  check('a reauthorize notification asks for user action',
    buildNotification({ event: 'reauthorize', now: NOW }).requiresUserAction === true);
  check('a completion needs no user action', done.requiresUserAction === false);
  check('an unknown event is refused', buildNotification({ event: 'party', now: NOW }).ok === false);
  check('all five events have keys', Object.keys(NOTIFY_EVENTS).length === 5);

  /* ---------- delivery is honest ---------- */
  const delivered = await deliverNotification(done, { senders: allSenders, now: NOW });
  check('a notification goes out on every working channel', delivered.delivered.length === NOTIFY_CHANNELS.length);
  check('a successful delivery reports the user was reached', delivered.reachedUser === true);
  const partial = await deliverNotification(done, { senders: { telegram: async () => true }, now: NOW });
  check('a partial delivery still reaches the user', partial.reachedUser === true && partial.ok === true);
  check('the channels that failed are named', partial.failures.some((f) => f.reason === 'NO_CHANNEL'));
  const throwing = await deliverNotification(done, { senders: { telegram: async () => { throw new Error('x'); } }, now: NOW });
  check('a throwing channel does not crash the delivery', throwing.ok === false);
  check('an undeliverable notification says the user was NOT reached', throwing.reachedUser === false);
  check('the total failure carries a classified error', typeof throwing.error?.code === 'string');
  const rejected = await deliverNotification(done, { senders: { telegram: async () => ({ ok: false }) }, now: NOW });
  check('a channel that rejects is counted as a failure', rejected.reachedUser === false);
  check('delivering nothing is refused', (await deliverNotification(null, { senders: allSenders })).ok === false);

  /* ---------- an authorization request always has a deadline ---------- */
  const req = requestReauthorization({ intentId: 'i1', reason: 'PRICE_MOVED', now: NOW });
  check('a reauthorization request is created', req.ok === true);
  check('it always has a deadline', req.request.expiresAt === NOW + DEFAULT_AUTHORIZATION_WINDOW_MS);
  check('a tiny window is floored, not honoured',
    requestReauthorization({ windowMs: 1, now: NOW }).request.expiresAt >= NOW + 60_000);
  check('a missing window still produces a deadline',
    requestReauthorization({ windowMs: null, now: NOW }).request.expiresAt > NOW);
  check('the request authorizes nothing', req.executionAuthorized === false);
  check('it starts unanswered', req.request.answered === false && req.request.approved === false);
  check('it carries the notification to send', req.notification.i18nKey === NOTIFY_EVENTS.REAUTHORIZE);

  /* ---------- silence is not consent ---------- */
  const waiting = resolveAuthorizationTimeout(req, { now: NOW + 1000 });
  check('inside the window the program waits', waiting.waiting === true && waiting.halted === false);
  check('waiting is not authorization', waiting.executionAuthorized === false);
  const lapsed = resolveAuthorizationTimeout(req, { now: NOW + DEFAULT_AUTHORIZATION_WINDOW_MS + 1 });
  check('a lapsed deadline HALTS', lapsed.halted === true);
  check('a lapsed deadline is never an approval', lapsed.approved === false && lapsed.executionAuthorized === false);
  check('the halt reason is the timeout', lapsed.reason === 'AUTHORIZATION_TIMEOUT');
  check('the timeout notice is a translatable key', lapsed.i18nKey === NOTIFY_EVENTS.AUTHORIZATION_EXPIRED);
  check('the timeout carries a classified error', lapsed.error.code === 'USER_AUTHORIZATION_REQUIRED');
  const declined = resolveAuthorizationTimeout({ request: { ...req.request, answered: true, approved: false } }, { now: NOW });
  check('an explicit decline halts too', declined.halted === true && declined.reason === 'USER_DECLINED');
  const approved = resolveAuthorizationTimeout({ request: { ...req.request, answered: true, approved: true } }, { now: NOW });
  check('an explicit approval does not halt', approved.halted === false);
  check('even an approval still goes through the confirmation gate',
    approved.executionAuthorized === false && approved.requiresConfirmationGate === true);
  check('no request at all halts', resolveAuthorizationTimeout(null, { now: NOW }).halted === true);

  /* ---------- may a long-running program continue? ---------- */
  check('with the user reached and no pending authorization, it may continue',
    programMayContinue({ delivery: delivered, now: NOW }).mayContinue === true);
  check('an unreachable user stops the program',
    programMayContinue({ delivery: throwing, now: NOW }).mayContinue === false);
  check('the unreachable reason is named',
    programMayContinue({ delivery: throwing, now: NOW }).reasons.includes('USER_UNREACHABLE'));
  check('a lapsed authorization stops the program',
    programMayContinue({ delivery: delivered, authorization: req, now: NOW + DEFAULT_AUTHORIZATION_WINDOW_MS + 1 }).mayContinue === false);
  check('a program still inside its window may continue',
    programMayContinue({ delivery: delivered, authorization: req, now: NOW + 1000 }).mayContinue === true);
  check('the stop is a translatable notice',
    programMayContinue({ delivery: throwing, now: NOW }).i18nKey === NOTIFY_EVENTS.HALTED);
  check('nothing at all may continue by default',
    programMayContinue({ delivery: { reachedUser: false }, now: NOW }).mayContinue === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every notification event is translated in en, fa and ar',
    locales.every((loc) => ['completed', 'failed', 'reauthorize', 'halted', 'authorizationExpired']
      .every((k) => typeof loc?.intentAI?.notify?.[k] === 'string')));
  check('the timeout message says the program stopped, not continued',
    /stopped/i.test(locales[0].intentAI.notify.authorizationExpired));

  console.log(JSON.stringify({ probe: 'phase67-notifications', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
