/**
 * Wallet signer abstraction: (draftOrder, sessionKey) → signedTx.
 * Never submits. Never holds raw keys.
 */
import { scopeFor } from './sessionKeys.js';
import { classifyFailure } from './failureModes.js';

export function signDraft(draftOrder, sessionKey, { signer } = {}) {
  const scoped = scopeFor(sessionKey, draftOrder);
  if (!scoped.ok) return { ok: false, error: scoped.error };
  if (typeof signer !== 'function') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SIGNER' }) };
  }
  try {
    const signed = signer({
      draftId: draftOrder.id,
      kind: draftOrder.kind,
      chainId: draftOrder.chainId,
      handle: scoped.scopedHandle
    });
    if (!signed || typeof signed !== 'object' || !signed.signedTx) {
      return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: 'SIGNER_EMPTY' }) };
    }
    return { ok: true, signedTx: signed.signedTx, draftId: draftOrder.id, submitted: false };
  } catch (err) {
    return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) }) };
  }
}
