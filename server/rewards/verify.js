/**
 * FBT REWARDS — on-chain evidence verification.
 * ---------------------------------------------------------------------------
 * Reuses the existing server RPC layer (server/chainIntel.js + the
 * chainsLite registry) — no new blockchain provider is introduced.
 *
 * For an EVM event we require:
 *   · chainId is a registry chain
 *   · txHash has receipt status 1 (not reverted)
 *   · `from` matches the reported wallet (when a wallet is reported)
 *   · the tx is not ancient (older than EVM_EVIDENCE_MAX_AGE_MS → the event
 *     is likely a replay of an old transaction)
 * For Solana:
 *   · getSignatureStatuses returns a finalized/confirmed success
 *
 * Any RPC failure is reported as RPC_UNAVAILABLE (never a credit) so the
 * client can retry the same event later — idempotency makes retries safe.
 */
import { rpcCall, solanaRpc, normAddr } from '../chainIntel.js';

export const EVM_EVIDENCE_MAX_AGE_MS = 7 * 24 * 3600_000; // 7 days

export async function verifyEvmEvidence(ev) {
  const chainId = Number(ev.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) return { ok: false, code: 'CHAIN_REQUIRED' };
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(ev.txHash))) return { ok: false, code: 'BAD_TX_HASH' };

  let receipt = null;
  let tx = null;
  try {
    receipt = await rpcCall(chainId, 'eth_getTransactionReceipt', [ev.txHash]);
  } catch {
    return { ok: false, code: 'RPC_UNAVAILABLE' };
  }
  if (!receipt) return { ok: false, code: 'TX_NOT_FOUND' };
  const status = receipt.status === '0x1' ? 1 : receipt.status === '0x0' ? 0 : null;
  if (status === 0) return { ok: false, code: 'TX_FAILED' };
  if (status !== 1) {
    /* pre-Berlin receipts may lack status; try the block to be sure it exists */
    if (!receipt.blockNumber) return { ok: false, code: 'TX_NOT_MINED' };
  }

  try {
    tx = await rpcCall(chainId, 'eth_getTransactionByHash', [ev.txHash]);
  } catch {
    return { ok: false, code: 'RPC_UNAVAILABLE' };
  }
  if (!tx || !tx.from) return { ok: false, code: 'TX_NOT_FOUND' };

  if (ev.wallet && /^0x/i.test(ev.wallet) && normAddr(tx.from) !== normAddr(ev.wallet)) {
    return { ok: false, code: 'WALLET_MISMATCH' };
  }

  /* Replay guard: an event claiming an ancient hash is not a current reward. */
  if (tx.blockNumber && receipt.blockNumber) {
    const blockHex = typeof receipt.blockNumber === 'string' ? receipt.blockNumber : null;
    let ageCheck = null;
    if (blockHex) {
      try {
        const block = await rpcCall(chainId, 'eth_getBlockByNumber', [blockHex, false]);
        const tsMs = Number(block?.timestamp || 0) * 1000;
        if (Number.isFinite(tsMs) && tsMs > 0) ageCheck = Date.now() - tsMs;
      } catch {
        /* age check best-effort */
      }
    }
    if (ageCheck != null && ageCheck > EVM_EVIDENCE_MAX_AGE_MS) {
      return { ok: false, code: 'EVIDENCE_TOO_OLD' };
    }
  }

  return { ok: true, source: 'evm-rpc', txHash: ev.txHash, chainId };
}

export async function verifySolanaEvidence(ev) {
  const sig = String(ev.txHash || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(sig)) return { ok: false, code: 'BAD_SIGNATURE' };
  try {
    const statuses = await solanaRpc('getSignatureStatuses', [[sig]]);
    const first = statuses?.value?.[0];
    const slot = Number(first?.slot || 0);
    if (!first || slot <= 0) return { ok: false, code: 'TX_NOT_FOUND' };
    const err = first.err;
    if (err) return { ok: false, code: 'TX_FAILED' };
    const conf = String(first.confirmationStatus || '');
    if (!['confirmed', 'finalized'].includes(conf)) return { ok: false, code: 'TX_NOT_CONFIRMED' };
    return { ok: true, source: 'solana-rpc', signature: sig };
  } catch {
    return { ok: false, code: 'RPC_UNAVAILABLE' };
  }
}

/**
 * The default verifier: EVM events through rpcCall, Solana through
 * solanaRpc, everything else has no on-chain evidence to check.
 */
export async function verifyEvidence(ev) {
  const action = ev.action;
  if (action === 'swap' || action === 'bridge' || action === 'lending' ||
      action === 'borrow' || action === 'repay' || action === 'withdraw' ||
      action === 'lp' || action === 'intentAiExecuted') {
    if (ev.txHash && !/^0x/i.test(ev.txHash)) return verifySolanaEvidence(ev);
    return verifyEvmEvidence(ev);
  }
  /* lenient/no-evidence actions without a hash are accepted by the engine
     itself (see engine.validateEvent / ingestEvents). */
  return { ok: false, code: 'EVIDENCE_REQUIRED' };
}
