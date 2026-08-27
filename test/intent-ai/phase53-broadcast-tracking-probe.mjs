/**
 * PHASE 53 — REAL BROADCAST AND TRACKING
 * A signed transaction is not an executed one. `submitted` requires a real
 * transaction hash; `confirmed` requires a real receipt with enough
 * confirmations. COMPLETED is never fabricated.
 */
import {
  normalizeTxHash, broadcastSigned, trackTransaction, receiptStatusFor,
  reconcile, createMonitor, heartbeat
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const HASH = `0x${'ab'.repeat(32)}`;

try {
  /* --- hashes --- */
  check('only a real 32-byte hash is accepted', normalizeTxHash(HASH) === HASH);
  check('a short or fake hash is refused', normalizeTxHash('0x1234') === null && normalizeTxHash('submitted') === null);

  /* --- broadcasting --- */
  const noBroadcaster = await broadcastSigned({ tx: {} });
  check('no broadcaster is honest-unavailable', noBroadcaster.ok === false && noBroadcaster.status === 'unavailable' && noBroadcaster.error.detail === 'NO_BROADCASTER');

  const rejected = await broadcastSigned({ tx: {}, broadcaster: async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); } });
  check('a wallet rejection is USER_REJECTED and not a submission', rejected.ok === false && rejected.error.code === 'USER_REJECTED');

  const noHash = await broadcastSigned({ tx: {}, broadcaster: async () => 'ok' });
  check('a broadcaster that returns no hash is a failure, not a submission',
    noHash.ok === false && noHash.error.code === 'SUBMIT_REJECTED' && noHash.txHash === null);

  const sent = await broadcastSigned({ tx: { chainId: 42161 }, broadcaster: async () => HASH, idempotencyKey: 'k1' });
  check('a real broadcast yields a real hash and status submitted',
    sent.ok === true && sent.txHash === HASH && sent.status === 'submitted' && sent.confirmed === false && sent.fabricated === false);

  /* --- tracking --- */
  const noReceiptSource = await trackTransaction({ txHash: HASH });
  check('no receipt source keeps the status at submitted, never confirmed',
    noReceiptSource.status === 'submitted' && noReceiptSource.observation.confirmed === false);

  const notMined = await trackTransaction({ txHash: HASH, receiptSource: async () => null });
  check('no receipt yet is neither success nor failure',
    notMined.ok === true && notMined.status === 'submitted' && notMined.observation.confirmed === false);

  const oneConf = await trackTransaction({
    txHash: HASH,
    receiptSource: async () => ({ status: 1, blockNumber: 100 }),
    blockNumberSource: async () => 100,
    requiredConfirmations: 3
  });
  check('one confirmation out of three required is still not confirmed',
    oneConf.status === 'submitted' && oneConf.confirmations === 1 && oneConf.observation.confirmed === false);

  const enough = await trackTransaction({
    txHash: HASH,
    receiptSource: async () => ({ status: 1, blockNumber: 100 }),
    blockNumberSource: async () => 103,
    requiredConfirmations: 3,
    requestedAmount: 100
  });
  check('block-by-block confirmations are counted from the real head',
    enough.status === 'confirmed' && enough.confirmations === 4 && enough.observation.confirmed === true);

  const reverted = await trackTransaction({ txHash: HASH, receiptSource: async () => ({ status: 0, blockNumber: 100 }) });
  check('an on-chain revert is failed, with the honest cause',
    reverted.ok === false && reverted.status === 'failed' && reverted.error.code === 'ONCHAIN_REVERT' && reverted.observation.reverted === true);

  const providerDown = await trackTransaction({ txHash: HASH, receiptSource: async () => { throw new Error('rpc down'); } });
  check('a dead RPC keeps the transaction at submitted and says so',
    providerDown.ok === false && providerDown.status === 'submitted' && providerDown.error.code === 'PROVIDER_ERROR');

  /* --- the status word --- */
  check('status words follow the evidence', receiptStatusFor({}) === 'pending'
    && receiptStatusFor({ txHash: HASH }) === 'submitted'
    && receiptStatusFor({ txHash: HASH, confirmed: true }) === 'confirmed'
    && receiptStatusFor({ txHash: HASH, reverted: true }) === 'failed');

  /* --- the monitor and reconciliation agree with the chain --- */
  const monitor = createMonitor({ txRef: HASH, requiredConfirmations: 3 });
  const beat = heartbeat(monitor.monitor, enough.observation);
  check('the monitor reaches CONFIRMED only on a real confirmation', beat.monitor.status === 'CONFIRMED' && beat.confirmed === true);

  const recPending = reconcile({ lifecycleStatus: 'SUBMITTED', observation: notMined.observation });
  check('a pending transaction never reconciles to COMPLETED',
    recPending.receipt.status !== 'COMPLETED' && recPending.receipt.confirmed === false);

  const recDone = reconcile({ lifecycleStatus: 'CONFIRMED', observation: { ...enough.observation, filledAmount: 100, requestedAmount: 100 } });
  check('COMPLETED requires a confirmed on-chain observation',
    recDone.receipt.status === 'COMPLETED' && recDone.receipt.confirmed === true && recDone.receipt.fabricated === false);

  const recFake = reconcile({ lifecycleStatus: 'SUBMITTED', observation: { successClaim: true, confirmed: false } });
  check('a claimed success without confirmation is refused',
    recFake.ok === false && recFake.receipt.status === 'UNCONFIRMED');

  const recReverted = reconcile({ lifecycleStatus: 'SUBMITTED', observation: reverted.observation });
  check('a reverted transaction reconciles to FAILED', recReverted.receipt.status === 'FAILED');

  console.log(JSON.stringify({ probe: 'phase53-broadcast-tracking', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
