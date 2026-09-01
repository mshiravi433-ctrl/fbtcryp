/**
 * FBT INTENT OS — chain adapters.
 * ---------------------------------------------------------------------------
 * EVM and Solana do not share a transaction model. This file gives them one
 * interface so the execution runtime never treats a Solana signature like an
 * EIP-1559 blob (or the other way around).
 *
 *   getBalance → simulate → buildTransaction → sendTransaction → waitForConfirmation
 *
 * Adapters never invent a receipt. `waitForConfirmation` returns success only
 * when the chain itself said so.
 */

export const CHAIN_ADAPTER_SCHEMA = 'fbt.ai-chain-adapter.v1';

export const ADAPTER_KINDS = Object.freeze(['evm', 'solana']);

const EVM_TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function fail(code, detail = null) {
  return { ok: false, schema: CHAIN_ADAPTER_SCHEMA, code, detail };
}

export function chainKind(chainId) {
  const id = Number(chainId);
  if (id === 501 || String(chainId).toLowerCase() === 'solana') return 'solana';
  return 'evm';
}

/**
 * Shared contract. Concrete adapters fill the five methods; this wrapper
 * refuses to let a Solana payload go down the EVM path.
 */
export function createChainAdapter({ kind, impl } = {}) {
  if (!ADAPTER_KINDS.includes(kind) || !impl || typeof impl !== 'object') {
    return fail('ADAPTER_UNAVAILABLE');
  }
  const call = (name) => (typeof impl[name] === 'function' ? impl[name].bind(impl) : null);
  return {
    ok: true,
    schema: CHAIN_ADAPTER_SCHEMA,
    kind,
    async getBalance(address) {
      const fn = call('getBalance');
      if (!fn) return fail('GET_BALANCE_UNAVAILABLE');
      return fn(address);
    },
    async simulate(tx) {
      const fn = call('simulate');
      if (!fn) return fail('SIMULATOR_UNAVAILABLE');
      if (tx && tx.kind && tx.kind !== kind) return fail('CHAIN_KIND_MISMATCH');
      return fn(tx);
    },
    async buildTransaction(action) {
      const fn = call('buildTransaction');
      if (!fn) return fail('BUILDER_UNAVAILABLE');
      return fn(action);
    },
    async sendTransaction(tx) {
      const fn = call('sendTransaction');
      if (!fn) return fail('SENDER_UNAVAILABLE');
      if (tx && tx.kind && tx.kind !== kind) return fail('CHAIN_KIND_MISMATCH');
      return fn(tx);
    },
    async waitForConfirmation(txHash) {
      const fn = call('waitForConfirmation');
      if (!fn) return fail('RECEIPT_SOURCE_UNAVAILABLE');
      if (kind === 'evm' && !EVM_TX_HASH.test(String(txHash || ''))) return fail('TX_HASH_INVALID');
      if (kind === 'solana' && !SOL_SIG.test(String(txHash || ''))) return fail('TX_HASH_INVALID');
      const receipt = await fn(txHash);
      return normalizeReceipt(kind, receipt, txHash);
    }
  };
}

export function normalizeReceipt(kind, receipt, txHash) {
  if (!receipt || typeof receipt !== 'object') {
    return { ok: true, status: 'PENDING', txHash, receipt: null, confirmed: false };
  }
  if (kind === 'evm') {
    const status = receipt.status;
    const ok = status === 1 || status === '0x1' || status === true;
    const reverted = status === 0 || status === '0x0' || status === false;
    if (reverted) return { ok: false, status: 'FAILED', txHash, receipt, confirmed: false, code: 'ONCHAIN_REVERT' };
    if (!ok) return { ok: true, status: 'PENDING', txHash, receipt, confirmed: false };
    return {
      ok: true,
      status: 'CONFIRMED',
      txHash,
      receipt,
      confirmed: true,
      blockNumber: Number.isFinite(Number(receipt.blockNumber)) ? Number(receipt.blockNumber) : null
    };
  }
  const conf = String(receipt.confirmationStatus || receipt.confirmationsStatus || '').toLowerCase();
  const err = receipt.err != null && receipt.err !== false;
  if (err) return { ok: false, status: 'FAILED', txHash, receipt, confirmed: false, code: 'ONCHAIN_REVERT' };
  if (conf === 'finalized' || conf === 'confirmed') {
    return {
      ok: true,
      status: 'CONFIRMED',
      txHash,
      receipt,
      confirmed: true,
      slot: Number.isFinite(Number(receipt.slot)) ? Number(receipt.slot) : null
    };
  }
  return { ok: true, status: 'PENDING', txHash, receipt, confirmed: false };
}

/**
 * EVM adapter over an EIP-1193 provider + optional ethers-style helpers.
 * All five methods are injected so Node probes do not import ethers.
 */
export function createEvmAdapter({
  getBalance,
  simulate,
  buildTransaction,
  sendTransaction,
  waitForConfirmation
} = {}) {
  return createChainAdapter({
    kind: 'evm',
    impl: { getBalance, simulate, buildTransaction, sendTransaction, waitForConfirmation }
  });
}

/** Solana adapter — same surface, different payload. */
export function createSolanaAdapter({
  getBalance,
  simulate,
  buildTransaction,
  sendTransaction,
  waitForConfirmation
} = {}) {
  return createChainAdapter({
    kind: 'solana',
    impl: { getBalance, simulate, buildTransaction, sendTransaction, waitForConfirmation }
  });
}

export function adapterForChain(chainId, adapters = {}) {
  const kind = chainKind(chainId);
  const adapter = kind === 'solana' ? adapters.solana : adapters.evm;
  if (!adapter || adapter.ok !== true) return fail('ADAPTER_UNAVAILABLE', kind);
  if (adapter.kind !== kind) return fail('CHAIN_KIND_MISMATCH', kind);
  return adapter;
}
