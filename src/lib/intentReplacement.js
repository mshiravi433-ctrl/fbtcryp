/**
 * INTENT REPLACEMENT TRACKING
 * ---------------------------------------------------------------------------
 * When a user (or their wallet) replaces a pending transaction — speed-up
 * (repriced), cancel, or a different transaction on the same nonce — ethers v6
 * `wait()` rejects with a `TRANSACTION_REPLACED` error that carries the
 * replacement hash, its reason and, when already mined, its receipt. This
 * module turns that error into something the swap UI can show and follow:
 *
 *   · name the replacement hash (never fabricate one)
 *   · state WHY it was replaced (repriced / cancelled / replaced)
 *   · keep watching the replacement hash until it settles
 *
 * Honesty: if the error carries no hash, `replacementHashFromError` returns
 * null — we never invent a hash. If no receipt is available yet, the swap
 * polls the replacement hash; if that times out it reports a
 * CONFIRMATION_TIMEOUT recovery instead of guessing an outcome.
 *
 * The module is pure in its dependencies (`provider` and `sleep` are injected)
 * so the tracking logic is testable without a live chain.
 */

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** True when a value looks like a real transaction hash. */
export function isTxHash(value) {
  return typeof value === 'string' && HASH_RE.test(value);
}

/**
 * Pull the replacement transaction hash out of a thrown `wait()` error.
 * Checks the shapes ethers v6 and the wallet SDKs actually use, in order:
 *   error.hash  (ethers v6 TRANSACTION_REPLACED carries the replacement hash)
 *   error.replacement?.hash
 *   error.replacementHash
 *   a 64-hex hash in the message (last-resort, some SDKs stringify it)
 * Returns null when there is no hash to follow.
 */
export function replacementHashFromError(error) {
  if (!error) return null;
  if (isTxHash(error.hash)) return error.hash;
  const repl = error.replacement;
  if (repl && isTxHash(repl.hash)) return repl.hash;
  if (isTxHash(error.replacementHash)) return error.replacementHash;
  const message = String(error?.message || error?.shortMessage || '');
  const hit = message.match(/0x[0-9a-fA-F]{64}/);
  return hit ? hit[0] : null;
}

/** The human-meaningful reason a transaction was replaced, or null. */
export function replacementReasonOf(error) {
  const reason = String(error?.reason || error?.replacement?.reason || '');
  if (reason === 'repriced' || reason === 'cancelled' || reason === 'replaced') return reason;
  return null;
}

/** True when the wait error already carries a mined replacement receipt. */
export function hasReplacementReceipt(error) {
  return Boolean(error?.receipt);
}

/**
 * Keep watching a replacement hash until it settles (or the budget runs out).
 *
 * @param {object} opts
 * @param {object} opts.provider        read-only provider with getTransactionReceipt
 * @param {string} opts.replacementHash the hash to follow
 * @param {number} [opts.intervalMs]    poll interval (default 3000)
 * @param {number} [opts.timeoutMs]     overall budget (default 120_000)
 * @param {Function} [opts.sleep]       injectable sleep(ms) for tests
 * @returns {Promise<{ok:true, receipt:object, hash:string}|
 *                    {ok:false, code:'BAD_HASH'|'NO_PROVIDER'|'TIMEOUT', hash:string|null}>}
 */
export async function trackReplacement({
  provider,
  replacementHash,
  intervalMs = 3000,
  timeoutMs = 120_000,
  sleep = null
}) {
  const hash = String(replacementHash || '');
  if (!isTxHash(hash)) return { ok: false, code: 'BAD_HASH', hash: null };
  if (!provider || typeof provider.getTransactionReceipt !== 'function') {
    return { ok: false, code: 'NO_PROVIDER', hash };
  }
  const doSleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return { ok: true, receipt, hash };
    } catch {
      /* a node hiccup is not an outcome — keep watching */
    }
    await doSleep(Math.max(250, Number(intervalMs) || 3000));
  }
  return { ok: false, code: 'TIMEOUT', hash };
}
