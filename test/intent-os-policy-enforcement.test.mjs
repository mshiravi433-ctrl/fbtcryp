/**
 * INTENT OS OBEYS THE SMART WALLET — the three user-facing controls, pinned.
 *
 * «لیست مجاز مقصد»، «مخاطبان بازیابی اجتماعی»، «کلید نشست»
 *
 * The Smart Wallet screen used to write these into localStorage while Intent
 * OS ran its own gates with no policy gate at all (a missing gate was recorded
 * as `NO_POLICY_GATE` and the pipeline carried on). This file pins the bridge:
 * an intent is checked against the SAME local policy, fail closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear()
};

const KEYS = ['fbt-smart-wallet-v1', 'fbt-smart-wallet-spend-v1', 'fbt-intent-memory-v1'];
test.beforeEach(() => { KEYS.forEach((k) => mem.delete(k)); });

const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

test('the destination allowlist covers EVM, Solana and Bitcoin destinations', async () => {
  const { addAllowlist, checkPolicy } = await import('../src/lib/smartWallet.js');
  addAllowlist(SOL);
  addAllowlist(BTC);
  assert.equal(checkPolicy({ usd: 10, to: EVM, origin: 'intent' }).code, 'NOT_ALLOWLISTED');
  assert.equal(checkPolicy({ usd: 10, to: SOL, origin: 'intent' }).ok, true);
  assert.equal(checkPolicy({ usd: 10, to: BTC, origin: 'intent' }).ok, true);
  assert.equal(checkPolicy({ usd: 10, to: EVM, origin: 'intent' }).code, 'NOT_ALLOWLISTED');
});

test('a session key is required before an intent may use the raised cap', async () => {
  const {
    checkPolicy, loadPolicy, requestSocialRecovery, startSession, verifySessionKey
  } = await import('../src/lib/smartWallet.js');
  const { savePolicy } = await import('../src/lib/smartWallet.js');

  savePolicy({ dailyLimitUsd: 100, perTxLimitUsd: 100 });
  assert.equal(checkPolicy({ usd: 400, origin: 'intent' }).code, 'OVER_TX_LIMIT');

  const opened = startSession({ minutes: 30, bonusUsd: 500, perTxUsd: 500 });
  assert.ok(opened.key.startsWith('sess_'));
  assert.equal(verifySessionKey(opened.key).ok, true);
  assert.equal(verifySessionKey('wrong').ok, false);
  /* A normal user-signed send still works without pasting a key; the INTENT
     path is the one that must prove it holds the session. */
  assert.equal(checkPolicy({ usd: 400, origin: 'user' }).ok, true);
  assert.equal(checkPolicy({ usd: 400, origin: 'intent' }).code, 'SESSION_KEY_REQUIRED');
  const allowed = checkPolicy({ usd: 400, origin: 'intent', sessionKey: opened.key });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.sessionKeyUsed, true);
  assert.equal(loadPolicy().session.key, opened.key);

  /* Social recovery uses the GUARDIANS, not the destination allowlist. */
  assert.equal(requestSocialRecovery({ recipients: [EVM] }).code, 'NOT_A_GUARDIAN');
  const { addGuardian } = await import('../src/lib/smartWallet.js');
  addGuardian(EVM);
  const recovery = requestSocialRecovery({ recipients: [EVM], approvals: 1 });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.approvalsRequired, 1);
  assert.equal(checkPolicy({ usd: 0, recovery: { recipients: [EVM] } }).ok, true);
});

test('Intent OS has no opt-out: its default gate reads the Smart Wallet policy', async () => {
  const { addAllowlist, startSession } = await import('../src/lib/smartWallet.js');
  const { runSafetyPipeline, defaultIntentPolicyGate, STAGE } = await import('../src/lib/intent-ai/os/upgrade7/safety.js');

  addAllowlist(SOL);
  const blocked = await runSafetyPipeline({
    intent: { type: 'SEND' },
    action: { kind: 'send', to: EVM, usd: 10 },
    gates: {
      assessRisk: async () => ({}), checkPermission: async () => ({ granted: true }),
      refreshData: async () => ({ ok: true }), simulate: async () => ({ status: 'clean' }),
      requestConfirmation: async () => true, sign: async () => ({}),
      execute: async () => ({}), verify: async () => ({ verified: true })
    }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockedAt, STAGE.POLICY);
  assert.equal(blocked.reason, 'NOT_ALLOWLISTED', 'a missing explicit gate is NOT a pass');

  const allowed = defaultIntentPolicyGate({ intent: { type: 'SEND' }, action: { to: SOL, usd: 10 } });
  assert.equal(allowed.allowed, true);

  startSession({ minutes: 30, bonusUsd: 500 });
  const noKey = defaultIntentPolicyGate({ intent: { type: 'SEND' }, action: { to: SOL, usd: 10 } });
  assert.equal(noKey.allowed, false);
  assert.equal(noKey.reason, 'SESSION_KEY_REQUIRED');
});
