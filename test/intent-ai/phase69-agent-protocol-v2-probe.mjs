/**
 * PHASE 69 — AGENT PROTOCOL v2
 * A directory is not a protocol. Every message is signed and versioned; an
 * unsigned, replayed, stale or downgraded message is rejected fail-closed.
 */
import { readFileSync } from 'node:fs';
import {
  startHandshake, completeHandshake, signMessage, verifyMessage, negotiateVersion,
  assertSessionUsable, canonicalPayload, HANDSHAKE_SCHEMA, PROTOCOL_VERSIONS,
  SESSION_TTL_MS, MESSAGE_KINDS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const sign = (payload) => `sig:${payload.length}:${payload.slice(0, 12)}`;
const verify = (payload, signature) => signature === sign(payload);

try {
  /* ---------- signing ---------- */
  const started = startHandshake({ selfId: 'fbt', peerId: 'agent-1', capabilities: ['read:market'], sign, now: NOW });
  check('a handshake starts', started.ok === true);
  check('the hello is signed', typeof started.hello.signature === 'string');
  check('the hello is versioned', PROTOCOL_VERSIONS.includes(started.hello.version));
  check('the hello carries a nonce', started.hello.nonce.length >= 16);
  check('the hello is frozen', Object.isFrozen(started.hello));
  check('the hello carries a payload hash', typeof started.hello.payloadHash === 'string');
  check('two handshakes never reuse a nonce',
    startHandshake({ selfId: 'fbt', peerId: 'agent-1', sign, now: NOW }).hello.nonce !== started.hello.nonce);
  check('without a signer nothing is sent', startHandshake({ selfId: 'fbt', peerId: 'a', now: NOW }).ok === false);
  check('a failing signer sends nothing', signMessage({ kind: 'hello' }, { sign: () => { throw new Error('x'); } }).ok === false);
  check('a signer returning junk sends nothing', signMessage({ kind: 'hello' }, { sign: () => 42 }).ok === false);
  check('the canonical payload is stable', canonicalPayload(started.hello) === canonicalPayload({ ...started.hello }));
  check('every message kind is declared', MESSAGE_KINDS.length === 5);

  /* ---------- verification is the door ---------- */
  const reply = signMessage({
    version: '2.1', kind: 'accept', from: 'agent-1', to: 'fbt', nonce: 'nonce-abcdef123456',
    sessionId: null, body: { replyTo: started.hello.nonce, versions: ['2.1', '2.0'], capabilities: ['read:market', 'sign'] }, at: NOW
  }, { sign }).message;
  const seen = new Set();
  check('a properly signed message is accepted', verifyMessage(reply, { verify, expectedFrom: 'agent-1', seenNonces: seen, now: NOW }).accepted === true);
  const unsigned = { ...reply }; delete unsigned.signature;
  check('an UNSIGNED message is rejected', verifyMessage(unsigned, { verify, now: NOW }).accepted === false);
  check('the unsigned rejection is named', verifyMessage(unsigned, { verify, now: NOW }).reason === 'UNSIGNED_MESSAGE');
  check('an unsigned message never degrades to accepted-with-warning', verifyMessage(unsigned, { verify, now: NOW }).ok === false);
  check('a forged signature is rejected', verifyMessage({ ...reply, signature: 'sig:whatever' }, { verify, now: NOW }).reason === 'BAD_SIGNATURE');
  check('a tampered body is rejected',
    ['BAD_SIGNATURE', 'PAYLOAD_TAMPERED'].includes(verifyMessage({ ...reply, body: { evil: true } }, { verify, now: NOW }).reason));
  check('an unversioned message is rejected', verifyMessage({ ...reply, version: null }, { verify, now: NOW }).reason === 'UNSUPPORTED_VERSION');
  check('an unknown version is rejected', verifyMessage({ ...reply, version: '9.9' }, { verify, now: NOW }).reason === 'UNSUPPORTED_VERSION');
  check('a wrong schema is rejected', verifyMessage({ ...reply, schema: 'other' }, { verify, now: NOW }).reason === 'WRONG_SCHEMA');
  check('an unknown kind is rejected', verifyMessage({ ...reply, kind: 'exec' }, { verify, now: NOW }).reason === 'UNKNOWN_KIND');
  check('a message from the wrong sender is rejected', verifyMessage(reply, { verify, expectedFrom: 'agent-2', now: NOW }).reason === 'WRONG_SENDER');
  check('a stale message is rejected', verifyMessage(reply, { verify, now: NOW + 600_000 }).reason === 'STALE_MESSAGE');
  check('with no verifier nothing is accepted', verifyMessage(reply, { now: NOW }).reason === 'NO_VERIFIER');
  check('a replayed nonce is rejected', verifyMessage(reply, { verify, seenNonces: seen, now: NOW }).reason === 'REPLAYED_NONCE');
  check('a non-message is rejected', verifyMessage(null, { verify, now: NOW }).accepted === false);

  /* ---------- version negotiation never downgrades ---------- */
  check('the highest common version wins', negotiateVersion(['2.0', '2.1']).version === '2.1');
  check('an older peer still negotiates', negotiateVersion(['2.0']).version === '2.0');
  check('no overlap means NO session', negotiateVersion(['1.0']).ok === false);
  check('an empty version list means no session', negotiateVersion([]).ok === false);
  check('the mismatch is a translatable key', negotiateVersion(['1.0']).i18nKey === 'intentAI.protocol.versionMismatch');

  /* ---------- the session ---------- */
  const session = completeHandshake({ hello: started.hello, reply, verify, seenNonces: new Set(), grantedCapabilities: ['read:market'], now: NOW });
  check('a valid handshake opens a session', session.ok === true && session.session.schema === HANDSHAKE_SCHEMA);
  check('the session has an id derived from both nonces', typeof session.session.sessionId === 'string');
  check('only granted capabilities survive', session.session.capabilities.length === 1 && session.session.capabilities[0] === 'read:market');
  check('a capability the agent asked for but we never grant is dropped', session.session.capabilities.includes('sign') === false);
  check('a session NEVER authorizes execution', session.session.executionAuthorized === false);
  check('a session still requires the confirmation gate', session.session.requiresConfirmationGate === true);
  check('the session expires', session.session.expiresAt === NOW + SESSION_TTL_MS);
  check('the session object is frozen', Object.isFrozen(session.session));
  check('an unsigned reply opens no session',
    completeHandshake({ hello: started.hello, reply: unsigned, verify, now: NOW }).ok === false);
  const wrongEcho = signMessage({ ...reply, body: { ...reply.body, replyTo: 'someone-elses-nonce' }, nonce: 'nonce-zzzzzzzzzzzz' }, { sign }).message;
  check('a reply that does not echo our nonce opens no session',
    completeHandshake({ hello: started.hello, reply: wrongEcho, verify, now: NOW }).reason === 'NONCE_NOT_ECHOED');
  const notAccept = signMessage({ ...reply, kind: 'request' }, { sign }).message;
  check('a non-accept reply opens no session', completeHandshake({ hello: started.hello, reply: notAccept, verify, now: NOW }).ok === false);
  const oldPeer = signMessage({ ...reply, body: { ...reply.body, versions: ['1.0'] } }, { sign }).message;
  check('a peer with no common version opens no session',
    completeHandshake({ hello: started.hello, reply: oldPeer, verify, now: NOW }).reason === 'NO_COMMON_VERSION');

  /* ---------- using the session ---------- */
  check('a granted capability is usable', assertSessionUsable(session.session, { capability: 'read:market', now: NOW }).usable === true);
  check('an ungranted capability is refused', assertSessionUsable(session.session, { capability: 'sign', now: NOW }).usable === false);
  check('the refusal is translatable', assertSessionUsable(session.session, { capability: 'sign', now: NOW }).i18nKey === 'intentAI.protocol.notPermitted');
  check('an expired session is unusable', assertSessionUsable(session.session, { now: NOW + SESSION_TTL_MS + 1 }).reason === 'SESSION_EXPIRED');
  check('a session claiming authority is refused outright',
    assertSessionUsable({ ...session.session, executionAuthorized: true }, { now: NOW }).usable === false);
  check('a hand-made session object is not a session', assertSessionUsable({ capabilities: ['sign'] }, { now: NOW }).usable === false);
  check('even a usable session does not authorize execution',
    assertSessionUsable(session.session, { capability: 'read:market', now: NOW }).executionAuthorized === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the protocol copy is translated in en, fa and ar',
    locales.every((loc) => ['established', 'handshakeFailed', 'versionMismatch', 'rejected', 'expired', 'notPermitted']
      .every((k) => typeof loc?.intentAI?.protocol?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase69-agent-protocol-v2', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
