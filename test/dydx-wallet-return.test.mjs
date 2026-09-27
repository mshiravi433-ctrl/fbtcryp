/** Real signing guard + dYdX onboarding, simulated wallet/relay and clock.
 * No wallet credentials, network, orders or funds are used. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Wallet } from 'ethers';
import { guardEip1193, SIGN_ERRORS } from '../src/lib/wc/signing.js';
import { TIMEOUT } from '../src/lib/wc/config.js';
import { requestDydxOnboardingSignature, dydxOnboardingTypedData, classifyDydxError } from '../src/lib/dydx.js';

const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const typed = dydxOnboardingTypedData();
const signature = await wallet.signTypedData(typed.domain, { dYdX: typed.types.dYdX }, typed.message);

function events(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name) { for (const fn of listeners.get(name) ?? []) fn(); },
    count() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); }
  };
}

async function setup(t, { relayRecovery = false, method = 'eth_signTypedData_v4' } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const doc = events({ visibilityState: 'visible' });
  const win = events();
  const trace = [];
  let resolveWallet, rejectWallet, calls = 0, probes = 0, restarts = 0;
  const answer = new Promise((resolve, reject) => { resolveWallet = resolve; rejectWallet = reject; });
  const relayer = {
    connected: true,
    provider: {
      request: async () => {
        probes++;
        if (probes === 1) return { messages: [] }; // pre-sign is healthy
        return new Promise(() => {}); // dead-but-connected socket after app switch
      }
    },
    restartTransport: () => {
      restarts++;
      // Restart completes within its 9s budget; the SDK delivers history later.
      return new Promise((resolve) => setTimeout(() => {
        resolve();
        setTimeout(() => resolveWallet(signature), 2_000);
      }, 8_500));
    }
  };
  const provider = {
    chainId: 1,
    accounts: [wallet.address],
    session: {
      topic: 'a'.repeat(64),
      namespaces: { eip155: {
        chains: ['eip155:1'], methods: [method], accounts: [`eip155:1:${wallet.address}`]
      } }
    },
    signer: { client: { core: { relayer } } },
    request: ({ method: requested, params }) => {
      if (requested === 'eth_chainId') return Promise.resolve('0x1');
      if (requested === method) {
        calls++;
        if (method === 'eth_signTypedData_v4') assert.deepEqual(JSON.parse(params[1]), typed);
        return answer;
      }
      throw new Error(`Unexpected method ${requested}`);
    }
  };
  const guarded = guardEip1193(provider, {
    doc, win, relayLiveness: relayRecovery,
    onTrace: (name) => trace.push(name)
  });
  let result = null;
  const pending = (method === 'eth_signTypedData_v4'
    ? requestDydxOnboardingSignature({ getProvider: () => guarded, address: wallet.address })
    : guarded.request({ method, params: [] })
  ).then((value) => { result = { value }; }, (error) => { result = { error }; });
  await nextTurn();
  assert.equal(calls, 1);
  return {
    doc, win, trace, pending,
    get result() { return result; },
    get calls() { return calls; },
    get probes() { return probes; },
    get restarts() { return restarts; },
    resolve: (value = signature) => resolveWallet(value),
    reject: rejectWallet,
    visibility(state) { doc.visibilityState = state; doc.fire('visibilitychange'); },
    async advance(ms) { t.mock.timers.tick(ms); await nextTurn(); },
    assertClean() { assert.equal(doc.count(), 0); assert.equal(win.count(), 0); }
  };
}

for (const method of ['eth_signTypedData_v4', 'personal_sign', 'eth_sendTransaction']) {
  test(`${method}: approved response arriving >12s after wallet return is not discarded`, async (t) => {
    const f = await setup(t, { method });
    f.visibility('hidden');
    await f.advance(30_000);
    f.visibility('visible');
    f.win.fire('fbt:app-resume');
    await f.advance(13_000);
    assert.equal(f.result, null, 'return is not evidence of cancellation');
    f.resolve();
    await f.pending;
    assert.equal(f.result.value, signature);
    assert.equal(f.calls, 1, 'never resend a signature/transaction on resume');
    f.assertClean();
  });
}

test('dYdX: relay probe + restart + delayed history delivery succeeds after wallet return', async (t) => {
  const f = await setup(t, { relayRecovery: true });
  f.visibility('hidden');
  await f.advance(20_000);
  f.visibility('visible');
  f.win.fire('fbt:app-resume');
  await f.advance(3_000); // probe expires; start restart
  assert.equal(f.restarts, 1);
  await f.advance(8_500); // restart resolves
  await f.advance(2_000); // response/history reaches original pending request
  await f.pending;
  assert.equal(f.result.value, signature);
  assert.equal(f.calls, 1);
  assert.equal(f.probes, 2, 'duplicate lifecycle signals do not duplicate recovery');
  f.assertClean();
});

test('native-only resume recovers the response when WebView never reported hidden', async (t) => {
  const f = await setup(t, { relayRecovery: true });
  f.win.fire('fbt:app-resume');
  f.win.fire('fbt:app-resume');
  await f.advance(3_000);
  await f.advance(8_500);
  await f.advance(2_000);
  await f.pending;
  assert.equal(f.result.value, signature);
  assert.equal(f.restarts, 1);
  assert.equal(f.calls, 1);
  f.assertClean();
});

test('wallet rejection after return stays a genuine 4001 rejection', async (t) => {
  const f = await setup(t);
  f.visibility('hidden');
  f.visibility('visible');
  await f.advance(13_000);
  const rejection = Object.assign(new Error('User rejected the request'), { code: 4001 });
  f.reject(rejection);
  await f.pending;
  assert.equal(f.result.error, rejection);
  assert.equal(classifyDydxError(f.result.error), 'REJECTED');
  f.assertClean();
});

test('unanswered return remains bounded and reports NO_RESPONSE, not an unsigned claim', async (t) => {
  const f = await setup(t);
  f.visibility('hidden');
  await f.advance(20_000);
  f.visibility('visible');
  await f.advance(TIMEOUT.signInWallet - 1);
  assert.equal(f.result, null);
  await f.advance(1);
  await f.pending;
  assert.equal(f.result.error.code, SIGN_ERRORS.NO_RESPONSE);
  assert.equal(classifyDydxError(f.result.error), 'NO_RESPONSE');
  f.assertClean();
});

test('repeated hide/show and native resumes cannot reset the visible budget', async (t) => {
  const f = await setup(t);
  await f.advance(60_000);
  for (let i = 0; i < 2; i++) {
    f.visibility('hidden');
    await f.advance(20_000);
    f.visibility('visible');
    f.win.fire('fbt:app-resume');
    await f.advance(60_000);
  }
  await f.pending;
  assert.equal(f.result.error.code, SIGN_ERRORS.NO_RESPONSE);
  assert.equal(f.calls, 1);
  f.assertClean();
});

test('hard cap while hidden also reports NO_RESPONSE and cleans up listeners', async (t) => {
  const f = await setup(t);
  f.visibility('hidden');
  await f.advance(TIMEOUT.signHardCap);
  await f.pending;
  assert.equal(f.result.error.code, SIGN_ERRORS.NO_RESPONSE);
  assert.equal(classifyDydxError(f.result.error), 'NO_RESPONSE');
  f.assertClean();
});
