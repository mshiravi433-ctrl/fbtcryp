/**
 * INTENT REPLACEMENT TRACKING PROBE
 * ---------------------------------------------------------------------------
 * A replaced transaction must be NAMED, SHOWN and FOLLOWED — never fabricated
 * into a fake hash and never silently re-broadcast. This probes the pure
 * extraction helpers and the injectable follower:
 *
 *   · the replacement hash is pulled from the shapes ethers/wallet SDKs use
 *   · a hash is never invented when the error carries none
 *   · the follower watches a hash until it settles
 *   · a timed-out follow reports CONFIRMATION_TIMEOUT instead of guessing
 */

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const rep = await import('../src/lib/intentReplacement.js');

  const HASH = '0x' + 'ab'.repeat(32);
  const HASH2 = '0x' + 'cd'.repeat(32);

  /* -------------------------- hash extraction ---------------------------- */
  t('reads the replacement hash from ethers v6 error.hash',
    rep.replacementHashFromError({ code: 'TRANSACTION_REPLACED', hash: HASH, reason: 'repriced' }) === HASH);
  t('reads the replacement hash from error.replacement.hash',
    rep.replacementHashFromError({ replacement: { hash: HASH } }) === HASH);
  t('reads the replacement hash from a flat replacementHash field',
    rep.replacementHashFromError({ replacementHash: HASH }) === HASH);
  t('falls back to a 64-hex hash embedded in the message',
    rep.replacementHashFromError({ message: `replaced by ${HASH} on same nonce` }) === HASH);
  t('never invents a hash when the error carries none',
    rep.replacementHashFromError({ message: 'transaction was replaced' }) === null);
  t('returns null for a non-object', rep.replacementHashFromError(null) === null);

  /* ----------------------------- reasons --------------------------------- */
  t('names a repriced replacement', rep.replacementReasonOf({ reason: 'repriced' }) === 'repriced');
  t('names a cancelled replacement', rep.replacementReasonOf({ reason: 'cancelled' }) === 'cancelled');
  t('names a plain replacement', rep.replacementReasonOf({ reason: 'replaced' }) === 'replaced');
  t('unknown reasons are not invented', rep.replacementReasonOf({ reason: 'something-else' }) === null);

  /* ---------------------- already-mined receipt -------------------------- */
  t('an attached receipt means it is already settled',
    rep.hasReplacementReceipt({ receipt: { status: 1 } }) === true);
  t('no receipt means it still needs following',
    rep.hasReplacementReceipt({ reason: 'repriced' }) === false);

  /* ----------------------------- following ------------------------------- */
  {
    const provider = { getTransactionReceipt: async () => ({ status: 1, hash: HASH }) };
    const followed = await rep.trackReplacement({
      provider,
      replacementHash: HASH,
      intervalMs: 1,
      sleep: async () => {}
    });
    t('a settled replacement is returned with its receipt',
      followed.ok === true && followed.hash === HASH && followed.receipt?.status === 1);
  }

  {
    let reads = 0;
    const provider = {
      getTransactionReceipt: async () => {
        reads += 1;
        return reads >= 3 ? { status: 1 } : null;
      }
    };
    const followed = await rep.trackReplacement({
      provider,
      replacementHash: HASH,
      intervalMs: 1,
      timeoutMs: 5000,
      sleep: async () => {}
    });
    t('the follower keeps watching until the replacement settles',
      followed.ok === true && reads >= 3);
  }

  {
    const provider = { getTransactionReceipt: async () => null };
    const timedOut = await rep.trackReplacement({
      provider,
      replacementHash: HASH2,
      intervalMs: 1,
      timeoutMs: 20,
      sleep: async () => {}
    });
    t('an unsettled replacement reports TIMEOUT, never a guess',
      timedOut.ok === false && timedOut.code === 'TIMEOUT' && timedOut.hash === HASH2);
  }

  {
    const badHash = await rep.trackReplacement({ provider: {}, replacementHash: 'not-a-hash' });
    t('a malformed replacement hash is refused', badHash.ok === false && badHash.code === 'BAD_HASH');
  }

  {
    const noProvider = await rep.trackReplacement({ provider: null, replacementHash: HASH });
    t('following without a provider is refused', noProvider.ok === false && noProvider.code === 'NO_PROVIDER');
  }

  return rows;
}
