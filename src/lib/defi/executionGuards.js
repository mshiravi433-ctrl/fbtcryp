/**
 * Shared guards for non-custodial DeFi writes.
 *
 * These helpers deliberately do not know a protocol ABI. They protect the
 * boundary between a quoted/simulated transaction and the wallet prompt:
 * the account and chain are checked again immediately before signing, and a
 * receipt is never treated as success until it is mined with status 1.
 */

import { withRpcRetry } from './rpcRetry.js';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export class ExecutionGuardError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.name = 'ExecutionGuardError';
    this.code = code;
    this.detail = detail;
  }
}

export const isAddress = (value) => typeof value === 'string' && ADDRESS_RE.test(value);
export const sameAddress = (a, b) =>
  isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();

/**
 * Prove that the read provider used for a quote/simulation is on the intended
 * chain. A provider which cannot answer eth_chainId is not a safe provider.
 */
export async function assertProviderChain(provider, expectedChainId) {
  if (!provider || typeof provider.getNetwork !== 'function') {
    throw new ExecutionGuardError('EXECUTION_PROVIDER_UNAVAILABLE', { expectedChainId });
  }
  let network;
  try {
    // getNetwork() on a fallback stack can fail transiently when every public
    // endpoint hiccups in the same instant — retry once or twice before
    // declaring EXECUTION_NETWORK_UNREADABLE (the code behind the user-facing
    // «شبکه در دسترس نیست» errors). A wrong chainId is NOT retried: that is
    // a deterministic answer, not a blip.
    network = await withRpcRetry(() => provider.getNetwork(), {
      attempts: 3, delayMs: 300, label: `assertProviderChain(${expectedChainId})`
    });
  } catch (cause) {
    throw new ExecutionGuardError('EXECUTION_NETWORK_UNREADABLE', { expectedChainId, cause });
  }
  const found = Number(network?.chainId ?? network?.id ?? 0);
  if (!Number.isSafeInteger(found) || found !== Number(expectedChainId)) {
    throw new ExecutionGuardError('EXECUTION_WRONG_CHAIN', {
      expectedChainId: Number(expectedChainId),
      found: Number.isFinite(found) ? found : null
    });
  }
  return found;
}

/**
 * Re-check both the connected account and the signer provider immediately
 * before a signature. Wallets can change account/network while a sheet is
 * open, or while the user is returning from another wallet application.
 */
export async function assertSignerContext(signer, { owner, chainId } = {}) {
  if (!signer || typeof signer.getAddress !== 'function') {
    throw new ExecutionGuardError('EXECUTION_SIGNER_UNAVAILABLE');
  }
  if (!isAddress(owner)) {
    throw new ExecutionGuardError('EXECUTION_BAD_OWNER', { owner });
  }
  let signerOwner;
  try {
    signerOwner = await signer.getAddress();
  } catch (cause) {
    throw new ExecutionGuardError('EXECUTION_ACCOUNT_UNREADABLE', { cause });
  }
  if (!sameAddress(signerOwner, owner)) {
    throw new ExecutionGuardError('EXECUTION_ACCOUNT_CHANGED', { expected: owner, found: signerOwner });
  }
  if (!signer.provider) {
    throw new ExecutionGuardError('EXECUTION_PROVIDER_UNAVAILABLE', { chainId });
  }
  await assertProviderChain(signer.provider, chainId);
  return { owner: signerOwner, chainId: Number(chainId) };
}

/** Wallet rejection is not a protocol failure and must not be recorded as one. */
export function isUserRejection(error) {
  const code = error?.code;
  return code === 4001 || code === 'ACTION_REJECTED' || /reject|denied|user denied/i.test(
    String(error?.message ?? error?.shortMessage ?? '')
  );
}

export function isTransactionReplacement(error) {
  return error?.code === 'TRANSACTION_REPLACED' || error?.code === 'REPLACED' || Boolean(error?.replacement);
}

export function isTransactionTimeout(error) {
  return error?.code === 'TRANSACTION_TIMEOUT' || error?.code === 'TIMEOUT';
}

function timeoutPromise(ms) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timer = null;
      reject(new ExecutionGuardError('TRANSACTION_TIMEOUT', { timeoutMs: ms }));
    }, ms);
  });
  return { promise, cancel: () => { if (timer) clearTimeout(timer); timer = null; } };
}

/**
 * Wait for a mined receipt with an explicit timeout and replacement taxonomy.
 * A replacement is returned only when ethers supplied a mined replacement
 * receipt; a timeout remains pending and is never falsely marked confirmed.
 */
export async function waitForMinedReceipt(transaction, { timeoutMs = 180_000 } = {}) {
  if (!transaction || typeof transaction.wait !== 'function') {
    throw new ExecutionGuardError('TRANSACTION_HANDLE_UNAVAILABLE');
  }
  const timeout = timeoutPromise(timeoutMs);
  try {
    const receipt = await Promise.race([transaction.wait(), timeout.promise]);
    timeout.cancel();
    if (!receipt || Number(receipt.status ?? 0) !== 1) {
      throw new ExecutionGuardError('TRANSACTION_RECEIPT_FAILED', {
        hash: transaction.hash ?? null,
        status: receipt?.status ?? null
      });
    }
    return { receipt, replaced: false, replacementHash: null };
  } catch (error) {
    timeout.cancel();
    if (isTransactionReplacement(error)) {
      const receipt = error.receipt;
      if (receipt && Number(receipt.status ?? 0) === 1) {
        return {
          receipt,
          replaced: true,
          replacementHash: error.replacement?.hash ?? receipt.hash ?? null
        };
      }
      throw new ExecutionGuardError('TRANSACTION_REPLACED', {
        originalHash: transaction.hash ?? null,
        replacementHash: error.replacement?.hash ?? null,
        cancelled: Boolean(error.cancelled),
        receipt: receipt ?? null
      });
    }
    if (error instanceof ExecutionGuardError) throw error;
    throw error;
  }
}

/**
 * A small, testable receipt invariant shared by protocol-specific verifiers.
 */
export function assertSuccessfulReceipt(receipt) {
  if (!receipt || Number(receipt.status ?? 0) !== 1) {
    throw new ExecutionGuardError('TRANSACTION_RECEIPT_FAILED', {
      status: receipt?.status ?? null,
      hash: receipt?.hash ?? null
    });
  }
  return receipt;
}

/**
 * Parse a log with an ethers Interface without allowing a malformed/unrelated
 * log to abort scanning. Protocol adapters use this to require their own
 * event, rather than accepting any successful receipt.
 */
export function parseReceiptLogs(receipt, iface, address, eventName) {
  const target = String(address ?? '').toLowerCase();
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const found = [];
  for (const log of logs) {
    if (target && String(log?.address ?? '').toLowerCase() !== target) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!eventName || parsed?.name === eventName) found.push({ parsed, log });
    } catch {
      // The receipt can contain events from many contracts. Unknown ABI entries
      // are expected and are not evidence either way.
    }
  }
  return found;
}