/**
 * PHASE 51 — REAL WALLET SIGNING
 * A connected wallet is not a signer until it signs, and a stub is never a
 * substitute for one in a real runtime.
 */
import {
  describeWalletRuntime, signIntentWithWallet, signerFromWalletSignature,
  resolveExecutionSigner, stubSigner, stubSignerAllowed, isStubSigner,
  intentOrderTypedData, createEip1193Broadcaster, signDraft, venueHealth, issueSessionKey
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const SIG = `0x${'ab'.repeat(65)}`;

function fakeProvider({ signature = SIG, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push(method);
      if (throws) throw throws;
      if (method === 'eth_signTypedData_v4') return signature;
      if (method === 'personal_sign') return signature;
      if (method === 'eth_sendTransaction') return `0x${'cd'.repeat(32)}`;
      throw Object.assign(new Error('method not found'), { code: -32601 });
    }
  };
}

try {
  /* --- describing the runtime honestly --- */
  const empty = describeWalletRuntime({});
  check('no wallet is not a signer', empty.canSign === false && empty.reasons.includes('NO_SIGNER') && empty.reasons.includes('NO_PROVIDER'));

  const live = describeWalletRuntime({ provider: fakeProvider(), account: ACCOUNT, chainId: 42161 });
  check('a connected wallet IS a provider and a signer', live.canSign === true && live.hasProvider === true && live.reasons.length === 0);

  const badAccount = describeWalletRuntime({ provider: fakeProvider(), account: 'not-an-address' });
  check('a malformed account is refused', badAccount.canSign === false);

  /* --- the EIP-712 payload actually carries the locked terms --- */
  const typed = intentOrderTypedData({ terms: { draftId: 'd1', kind: 'swap', chainId: 42161, amountIn: '100', termsHash: 'abc' } });
  check('the signed payload binds the terms hash and amount',
    typed.message.termsHash === 'abc' && typed.message.amountIn === '100' && typed.primaryType === 'IntentOrder');

  /* --- real signing over EIP-1193 --- */
  const provider = fakeProvider();
  const signedReal = await signIntentWithWallet({ runtime: { provider, account: ACCOUNT, chainId: 42161 }, terms: { draftId: 'd1' } });
  check('a connected wallet signs the terms over eth_signTypedData_v4',
    signedReal.ok === true && signedReal.signature === SIG && provider.calls[0] === 'eth_signTypedData_v4');

  const noProvider = await signIntentWithWallet({ runtime: { account: ACCOUNT }, terms: {} });
  check('no provider is an honest NO_PROVIDER, not a signature',
    noProvider.ok === false && noProvider.error.detail === 'NO_PROVIDER');

  const rejected = await signIntentWithWallet({
    runtime: { provider: fakeProvider({ throws: Object.assign(new Error('User rejected'), { code: 4001 }) }), account: ACCOUNT },
    terms: {}
  });
  check('a user rejection is USER_REJECTED and never a fake success',
    rejected.ok === false && rejected.error.code === 'USER_REJECTED');

  const fallbackProvider = fakeProvider({ throws: null });
  const originalRequest = fallbackProvider.request;
  fallbackProvider.request = async (args) => {
    if (args.method === 'eth_signTypedData_v4') throw Object.assign(new Error('method not found'), { code: -32601 });
    return originalRequest(args);
  };
  const fallback = await signIntentWithWallet({ runtime: { provider: fallbackProvider, account: ACCOUNT }, terms: {} });
  check('a wallet without typed data falls back to personal_sign',
    fallback.ok === true && fallback.method === 'personal_sign');

  /* --- the stub is test-only --- */
  check('the stub is marked as a stub', isStubSigner(stubSigner) === true);
  check('the stub is allowed where no user wallet can exist', stubSignerAllowed({}) === (typeof globalThis.window === 'undefined'));
  check('the stub is refused when the runtime says browser', stubSignerAllowed({ allowStub: false }) === false);

  const noSigner = resolveExecutionSigner({ allowStub: false });
  check('no wallet + no stub is fail-closed NO_SIGNER',
    noSigner.ok === false && noSigner.error.detail === 'NO_SIGNER');

  const fromWallet = resolveExecutionSigner({ walletSignature: SIG, walletAccount: ACCOUNT, allowStub: false });
  check('a real wallet signature resolves a real signer', fromWallet.ok === true && fromWallet.signerKind === 'wallet');
  check('the wallet signer returns the real signature', fromWallet.signer().signedTx === SIG);

  check('a bad signature never becomes a signer', signerFromWalletSignature('nope') === null);

  /* --- signDraft carries the signature through the session key scope --- */
  const sk = issueSessionKey({ policyId: 'p1', allowedChains: [42161], allowedProtocols: ['swap'], maxAmountUsd: 1000 });
  const draft = { id: 'd1', kind: 'swap', chainId: 42161, protocol: 'swap', amountUsd: 100, amountIn: 100 };
  const signedDraft = signDraft(draft, sk.sessionKey, { walletSignature: SIG, walletAccount: ACCOUNT, allowStub: false });
  check('signDraft signs with the real wallet signature',
    signedDraft.ok === true && signedDraft.signerKind === 'wallet' && signedDraft.stubSigned === false && signedDraft.submitted === false);

  const signedNone = signDraft(draft, sk.sessionKey, { allowStub: false });
  check('signDraft with no wallet is NO_SIGNER, not a stub signature',
    signedNone.ok === false && signedNone.error.detail === 'NO_SIGNER');

  const signedStub = signDraft(draft, sk.sessionKey, { allowStub: true });
  check('the stub path stays available to the test suite and is labelled',
    signedStub.ok === true && signedStub.stubSigned === true && signedStub.signerKind === 'stub');

  /* --- venueHealth stops lying when a wallet is connected --- */
  const swapDraft = { kind: 'swap', chainId: 42161, protocol: 'swap' };
  const blind = venueHealth(swapDraft, {});
  check('with no wallet venueHealth still says NO_SIGNER/NO_PROVIDER',
    blind.ok === false && blind.reasons.includes('NO_SIGNER') && blind.reasons.includes('NO_PROVIDER'));

  const withWallet = venueHealth(swapDraft, { walletRuntime: { provider: fakeProvider(), account: ACCOUNT, chainId: 42161 } });
  check('with a connected wallet venueHealth no longer claims NO_SIGNER/NO_PROVIDER',
    withWallet.ok === true
    && !withWallet.reasons.includes('NO_SIGNER')
    && !withWallet.reasons.includes('NO_PROVIDER'));

  const lockedWallet = venueHealth(swapDraft, { walletRuntime: { provider: fakeProvider(), account: ACCOUNT, connected: false } });
  check('a locked/disconnected wallet is still honestly unavailable', lockedWallet.ok === false);

  /* --- the same runtime can broadcast (used by Phase 53) --- */
  const broadcaster = createEip1193Broadcaster({ provider: fakeProvider(), account: ACCOUNT, chainId: 42161 });
  check('a connected wallet yields a broadcaster', typeof broadcaster === 'function');
  check('no wallet yields no broadcaster', createEip1193Broadcaster({}) === null);

  console.log(JSON.stringify({ probe: 'phase51-wallet-signing', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
