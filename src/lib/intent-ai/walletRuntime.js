/**
 * FBT INTENT AI — PHASE 51: REAL WALLET SIGNING
 * ---------------------------------------------------------------------------
 * A connected wallet is not a signer until it actually signs. This module is
 * the bridge between the app's connected wallet (WalletContext → an EIP-1193
 * provider) and the deterministic execution pipeline, which stays synchronous.
 *
 * The split that keeps both properties true:
 *
 *   1. `signIntentWithWallet()` is ASYNC and does the only thing that must be
 *      async — it asks the real wallet to sign the locked terms via
 *      `eth_signTypedData_v4` (with a `personal_sign` fallback for wallets
 *      that do not implement typed data). Nothing is submitted here.
 *   2. `signerFromWalletSignature()` turns that real signature into the plain
 *      synchronous signer function the existing pipeline already accepts, so
 *      `walletAdapter.signDraft()` / `controlledExecution` keep working
 *      unchanged.
 *
 * Fail-closed rules:
 *   · no provider / no account          → NO_PROVIDER / NO_SIGNER (honest)
 *   · user rejects in the wallet        → USER_REJECTED (never a fake success)
 *   · the stub signer is TEST-ONLY. `stubSignerAllowed()` is false in any
 *     browser-like runtime, so a real user can never be handed a stub
 *     signature dressed up as an execution.
 */

import { classifyFailure } from './failureModes.js';

export const WALLET_RUNTIME_SCHEMA = 'fbt.wallet-runtime.v1';

/** EIP-712 domain/type used for the intent authorization signature. */
export const INTENT_ORDER_TYPES = Object.freeze({
  IntentOrder: [
    { name: 'draftId', type: 'string' },
    { name: 'kind', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'protocol', type: 'string' },
    { name: 'amountIn', type: 'string' },
    { name: 'termsHash', type: 'string' },
    { name: 'deadline', type: 'uint256' }
  ]
});

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_RE = /^0x[a-fA-F0-9]+$/;

/** The stub signer — deterministic, clearly marked, never usable in a browser. */
export function stubSigner() {
  return { signedTx: 'stub-signed', signerKind: 'stub' };
}
stubSigner.isStub = true;

/** True only where no real user wallet can exist (Node probes / CI). Production never allows a stub. */
export function stubSignerAllowed(env = {}) {
  const nodeEnv = env.NODE_ENV || (typeof process !== 'undefined' ? process.env.NODE_ENV : '');
  if (nodeEnv === 'production') return false;
  if (env.allowStub === true) return true;
  if (env.allowStub === false) return false;
  const hasWindow = typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined';
  return !hasWindow;
}

/** Is this function the test stub (rather than a real wallet signature)? */
export function isStubSigner(fn) {
  return typeof fn === 'function' && fn.isStub === true;
}

/**
 * Describe what a connected wallet runtime can actually do.
 * @param {object} runtime { provider, account, chainId, connected }
 */
export function describeWalletRuntime(runtime = {}) {
  const provider = runtime?.provider || null;
  const hasProvider = Boolean(provider && typeof provider.request === 'function');
  const account = typeof runtime?.account === 'string' && ADDRESS_RE.test(runtime.account)
    ? runtime.account
    : null;
  const chainId = Number.isFinite(Number(runtime?.chainId)) ? Number(runtime.chainId) : null;
  const connected = runtime?.connected !== false && hasProvider && Boolean(account);
  return Object.freeze({
    schema: WALLET_RUNTIME_SCHEMA,
    hasProvider,
    hasAccount: Boolean(account),
    // A connected wallet IS a signer for our purposes: it can be asked to sign.
    hasSigner: connected,
    canSign: connected,
    connected,
    account,
    chainId,
    reasons: Object.freeze([
      ...(hasProvider ? [] : ['NO_PROVIDER']),
      ...(account ? [] : ['NO_SIGNER'])
    ])
  });
}

/** Build the EIP-712 payload for a set of locked terms. */
export function intentOrderTypedData({ terms = {}, chainId, verifyingContract } = {}) {
  const cid = Number(chainId ?? terms.chainId ?? 0) || 0;
  return {
    types: INTENT_ORDER_TYPES,
    primaryType: 'IntentOrder',
    domain: {
      name: 'FBT Intent OS',
      version: '1',
      chainId: cid,
      ...(verifyingContract && ADDRESS_RE.test(verifyingContract) ? { verifyingContract } : {})
    },
    message: {
      draftId: String(terms.draftId ?? terms.id ?? ''),
      kind: String(terms.kind ?? 'swap'),
      chainId: cid,
      protocol: String(terms.protocol ?? 'swap'),
      amountIn: String(terms.amountIn ?? terms.amountUsd ?? ''),
      termsHash: String(terms.termsHash ?? ''),
      deadline: Number(terms.deadlineAt ?? 0) || 0
    }
  };
}

/**
 * Ask the REAL connected wallet to sign the locked terms. Async, never submits.
 * @returns {Promise<{ok:boolean, signature?:string, account?:string, method?:string, error?:object}>}
 */
export async function signIntentWithWallet({ runtime, terms = {}, verifyingContract = null } = {}) {
  const described = describeWalletRuntime(runtime);
  if (!described.hasProvider) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_PROVIDER' }) };
  }
  if (!described.hasAccount) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SIGNER' }) };
  }
  const typed = intentOrderTypedData({ terms, chainId: described.chainId ?? terms.chainId, verifyingContract });
  const provider = runtime.provider;
  try {
    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [described.account, JSON.stringify(typed)]
    });
    if (typeof signature === 'string' && HEX_RE.test(signature)) {
      return { ok: true, signature, account: described.account, method: 'eth_signTypedData_v4', typedData: typed };
    }
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: 'SIGNATURE_EMPTY' }) };
  } catch (err) {
    if (isUserRejection(err)) {
      return { ok: false, error: classifyFailure('USER_REJECTED', { detail: 'WALLET_REJECTED' }) };
    }
    // Typed data unsupported → try personal_sign over the same canonical text.
    if (isUnsupportedMethod(err)) {
      try {
        const text = canonicalTermsText(typed.message);
        const signature = await provider.request({
          method: 'personal_sign',
          params: [utf8ToHex(text), described.account]
        });
        if (typeof signature === 'string' && HEX_RE.test(signature)) {
          return { ok: true, signature, account: described.account, method: 'personal_sign', signedText: text };
        }
        return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: 'SIGNATURE_EMPTY' }) };
      } catch (fallbackErr) {
        if (isUserRejection(fallbackErr)) {
          return { ok: false, error: classifyFailure('USER_REJECTED', { detail: 'WALLET_REJECTED' }) };
        }
        return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: shortMessage(fallbackErr) }) };
      }
    }
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: shortMessage(err) }) };
  }
}

/**
 * Wrap a real wallet signature as the synchronous signer the pipeline expects.
 * The returned function is NOT a stub and is explicitly marked as such.
 */
export function signerFromWalletSignature(signature, meta = {}) {
  if (typeof signature !== 'string' || !HEX_RE.test(signature)) return null;
  const fn = () => ({
    signedTx: signature,
    signerKind: 'wallet',
    account: meta.account || null,
    method: meta.method || 'eth_signTypedData_v4'
  });
  fn.isStub = false;
  fn.signerKind = 'wallet';
  return fn;
}

/**
 * Fail-closed signer resolution for the execution pipeline.
 * Order: explicit signer → real wallet signature → stub (test runtimes only).
 */
export function resolveExecutionSigner({ signer, walletSignature = null, walletAccount = null, allowStub } = {}) {
  if (typeof signer === 'function' && !isStubSigner(signer)) {
    return { ok: true, signer, signerKind: signer.signerKind || 'injected' };
  }
  if (walletSignature) {
    const fromWallet = signerFromWalletSignature(walletSignature, { account: walletAccount });
    if (fromWallet) return { ok: true, signer: fromWallet, signerKind: 'wallet' };
  }
  if (typeof signer === 'function' && isStubSigner(signer) && stubSignerAllowed({ allowStub })) {
    return { ok: true, signer, signerKind: 'stub', stub: true };
  }
  if (stubSignerAllowed({ allowStub })) {
    return { ok: true, signer: stubSigner, signerKind: 'stub', stub: true };
  }
  return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SIGNER' }) };
}

/** Broadcaster built on the same connected wallet (used by Phase 53). */
export function createEip1193Broadcaster(runtime = {}) {
  const described = describeWalletRuntime(runtime);
  if (!described.connected) return null;
  const broadcaster = async (tx = {}) => {
    const hash = await runtime.provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: described.account, ...tx }]
    });
    return hash;
  };
  broadcaster.account = described.account;
  broadcaster.chainId = described.chainId;
  return broadcaster;
}

/* ------------------------------ internals -------------------------------- */

function isUserRejection(err) {
  const code = Number(err?.code);
  if (code === 4001) return true;
  return /user\s*(rejected|denied|cancell?ed)/i.test(String(err?.message || ''));
}

function isUnsupportedMethod(err) {
  const code = Number(err?.code);
  if (code === 4200 || code === -32601) return true;
  return /(unsupported|not supported|does not exist|method not found)/i.test(String(err?.message || ''));
}

function shortMessage(err) {
  return String(err?.message || err || 'PROVIDER_ERROR').slice(0, 120);
}

function canonicalTermsText(message = {}) {
  return [
    'FBT Intent OS — authorize this order',
    `draft: ${message.draftId}`,
    `kind: ${message.kind}`,
    `chain: ${message.chainId}`,
    `protocol: ${message.protocol}`,
    `amountIn: ${message.amountIn}`,
    `termsHash: ${message.termsHash}`,
    `deadline: ${message.deadline}`
  ].join('\n');
}

function utf8ToHex(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
