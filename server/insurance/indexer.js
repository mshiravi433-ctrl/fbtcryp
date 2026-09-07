/**
 * FBT Insurance OS — Blockchain indexer / verification (§25, §38).
 *
 * A payout (or coverage activation) is NEVER marked done just because a
 * provider API or a frontend says so. This layer independently verifies the
 * on-chain receipt against what FBT prepared.
 *
 * v1 runs in a clearly-labelled SANDBOX mode: sandbox providers have no real
 * chain, so verification confirms the prepared reference was acknowledged.
 * When an EVM chain + provider contract is configured (EVM_CONFIRMATIONS,
 * INSURANCE_RPC_*), real log/transaction verification would run here — the
 * method shape is identical, only the transport differs. Solana (§38) uses the
 * same interface with a different client.
 */
import { getProvider, healthOf } from './provider-registry.js';
import * as store from './store.js';
import { emit } from './events.js';

export const SANDBOX_MODE = process.env.INSURANCE_RPC_URL ? false : true;

function requireTxHash(txHash) {
  if (!txHash || typeof txHash !== 'string') throw new Error('TX_HASH_REQUIRED');
  return txHash;
}

/**
 * verifyReceipt({ kind: 'coverage-activation'|'payout', providerId, txHash,
 *   chainId, owner, recipient?, amountMicro?, coverageId?, claimId? })
 * Returns { verified, method, txHash, at } or throws on mismatch.
 */
export async function verifyReceipt(input) {
  const txHash = requireTxHash(input.txHash);
  const provider = getProvider(input.providerId);
  if (!provider) throw new Error('PROVIDER_UNKNOWN');
  if (healthOf(provider.providerId).status === 'UNAVAILABLE') throw new Error('PROVIDER_UNAVAILABLE');

  const expected = await store.get('provider-ledger', `reference-${input.coverageId || input.claimId || ''}`);
  let verified = false;
  let method = SANDBOX_MODE ? 'sandbox-simulated' : 'on-chain-confirmation';

  if (SANDBOX_MODE) {
    // Sandbox: no real chain. Accept an explicit simulated receipt matching our
    // prepared reference. Never claims a real chain confirmed anything. When the
    // prepared reference already carries a txHash it must match exactly; a fresh
    // reference accepts its first presented receipt.
    verified = !!txHash && (expected ? (expected.txHash ? expected.txHash === txHash : true) : true);
    // Real-chain verification (added in the provider milestone) checks recipient,
    // amount and confirmation depth against the actual transaction here.
  } else {
    // REAL mode (not wired in v1): fetch + confirm tx receipt from the RPC /
    // provider contract logs, check recipient + amount + confirmations. The
    // sandbox code-path above is replaced here in a later provider milestone.
    verified = false;
  }

  const record = {
    kind: input.kind,
    providerId: input.providerId,
    chainId: Number(input.chainId ?? 0),
    txHash,
    coverageId: input.coverageId || null,
    claimId: input.claimId || null,
    owner: String(input.owner || '').toLowerCase(),
    recipient: input.recipient || null,
    amountMicro: input.amountMicro ?? null,
    method,
    verified,
    at: Date.now()
  };
  await store.set('receipts', txHash.toLowerCase(), record);

  await emit({
    type: input.kind === 'payout' ? 'PayoutDetected' : 'CoveragePurchaseStarted',
    wallet: input.owner,
    providerId: input.providerId,
    coverageId: input.coverageId,
    claimId: input.claimId,
    payload: record
  });

  if (!verified) {
    // Never silently mark paid (§25).
    return { verified: false, method, txHash, at: record.at, reason: SANDBOX_MODE ? 'sandbox receipt mismatch' : 'on-chain verification pending' };
  }
  return { verified: true, method, txHash, at: record.at };
}

/** Replay / duplicate-tx guard: never process the same txHash twice. */
export async function receiptAlreadyProcessed(txHash, kind) {
  const rec = await store.get('receipts', String(txHash).toLowerCase());
  return !!rec && (kind ? rec.kind === kind : true) && rec.verified === true;
}
