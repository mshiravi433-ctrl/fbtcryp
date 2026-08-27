/**
 * Wallet signer abstraction: (draftOrder, sessionKey) → signedTx.
 * Never submits. Never holds raw keys.
 *
 * Phase 51: the signer is no longer assumed. It is RESOLVED — a real
 * EIP-1193 wallet signature first, the test stub only where no user wallet
 * can exist. A missing signer is an honest NO_SIGNER, never a fake signature.
 */
import { scopeFor } from './sessionKeys.js';
import { classifyFailure } from './failureModes.js';
import { resolveExecutionSigner, isStubSigner } from './walletRuntime.js';

export function signDraft(draftOrder, sessionKey, { signer, walletSignature = null, walletAccount = null, allowStub } = {}) {
  const scoped = scopeFor(sessionKey, draftOrder);
  if (!scoped.ok) return { ok: false, error: scoped.error };
  const resolved = resolveExecutionSigner({ signer, walletSignature, walletAccount, allowStub });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const active = resolved.signer;
  if (typeof active !== 'function') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SIGNER' }) };
  }
  try {
    const signed = active({
      draftId: draftOrder.id,
      kind: draftOrder.kind,
      chainId: draftOrder.chainId,
      handle: scoped.scopedHandle
    });
    if (!signed || typeof signed !== 'object' || !signed.signedTx) {
      return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: 'SIGNER_EMPTY' }) };
    }
    return {
      ok: true,
      signedTx: signed.signedTx,
      draftId: draftOrder.id,
      submitted: false,
      // The receipt must be able to say HOW this was signed.
      signerKind: signed.signerKind || resolved.signerKind || 'injected',
      stubSigned: isStubSigner(active) === true || resolved.stub === true,
      account: signed.account || walletAccount || null
    };
  } catch (err) {
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) }) };
  }
}
