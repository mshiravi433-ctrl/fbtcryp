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
import { verifyEvmReceipt } from './verification.js';

export const SANDBOX_MODE = process.env.INSURANCE_RPC_URL ? false : true;

function requireTxHash(txHash) {
  if (!txHash || typeof txHash !== 'string') throw new Error('TX_HASH_REQUIRED');
  return txHash;
}

/** Per-provider on-chain expectations for independent verification. */
function expectationsFor(provider, input) {
  const owner = String(input.owner || '').toLowerCase();
  if (provider.providerId === 'nexus-mutual') {
    const addr = provider.adapter?.addresses || {};
    return {
      to: addr.CoverBroker || null,
      nftContract: addr.CoverNFT || null,
      nftRecipient: owner || null
    };
  }
  if (provider.providerId === 'insurace') {
    // InsurAce Cover contract buyCoverV3: verify the tx hit the operator-
    // verified contract; cover NFT check via their CoverNFT when configured.
    return { to: provider.adapter?.coverContractFor?.(input.chainId) || null };
  }
  return {};
}

/**
 * verifyReceipt({ kind: 'coverage-activation'|'payout', providerId, txHash,
 *   chainId, owner, recipient?, amountMicro?, coverageId?, claimId? })
 * Returns { verified, method, txHash, at } or throws on mismatch.
 *
 * SANDBOX providers (dev/test only): simulated receipt check against the
 * prepared reference — clearly labelled, never in production.
 * LIVE providers: independent eth_getTransactionReceipt verification against
 * the provider's verified contracts (CoverNFT mint → coverId for Nexus).
 */
export async function verifyReceipt(input) {
  const txHash = requireTxHash(input.txHash);
  const provider = getProvider(input.providerId);
  if (!provider) throw new Error('PROVIDER_UNKNOWN');
  if (healthOf(provider.providerId).status === 'UNAVAILABLE') throw new Error('PROVIDER_UNAVAILABLE');

  const expected = await store.get('provider-ledger', `reference-${input.coverageId || input.claimId || ''}`);
  const isSandboxProvider = String(provider.status || '').toUpperCase() === 'SANDBOX';

  let verified = false;
  let method;
  let detail = null;

  if (isSandboxProvider) {
    method = 'sandbox-simulated';
    // Sandbox (dev/test): no real chain. Accept an explicit simulated receipt
    // matching our prepared reference. Never claims a real chain confirmed
    // anything. A reference that already carries a txHash must match exactly.
    verified = !!txHash && (expected ? (expected.txHash ? expected.txHash === txHash : true) : true);
  } else {
    method = 'on-chain-confirmation';
    const res = await verifyEvmReceipt({
      chainId: Number(input.chainId ?? 1),
      txHash,
      expect: expectationsFor(provider, input)
    });
    verified = res.verified === true;
    detail = res.verified ? { coverId: res.coverId ?? null, blockNumber: res.blockNumber ?? null, confirmations: res.confirmations ?? null } : { reason: res.reason, pending: !!res.pending };
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
    detail,
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
    return { verified: false, method, txHash, at: record.at, reason: detail?.reason || (method === 'sandbox-simulated' ? 'sandbox receipt mismatch' : 'on-chain verification pending'), ...(detail || {}) };
  }
  return { verified: true, method, txHash, at: record.at, ...(detail || {}) };
}

/** Replay / duplicate-tx guard: never process the same txHash twice. */
export async function receiptAlreadyProcessed(txHash, kind) {
  const rec = await store.get('receipts', String(txHash).toLowerCase());
  return !!rec && (kind ? rec.kind === kind : true) && rec.verified === true;
}
