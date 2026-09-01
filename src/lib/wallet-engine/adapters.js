/**
 * FBT WALLET ENGINE — CHAIN ADAPTERS (EVM / Solana / Bitcoin)
 * ---------------------------------------------------------------------------
 * One normalized surface over three very different ledgers. The orchestrator
 * and every engine talk to an adapter, never to a raw provider, so the same
 * "prepare a send" flow works whether the wallet is an EVM EOA, a Solana
 * account or a Bitcoin watch address.
 *
 *   Wallet Core
 *       │
 *   Wallet Orchestrator
 *       │
 *   ┌────┼──────────────┐
 *   │    │              │
 *  EVM  Solana        Bitcoin   ← this file
 *
 * ─── WHAT AN ADAPTER OWNS ───────────────────────────────────────────────────
 * · address validation (structural — proving ownership is the signer's job)
 * · chain-reference normalization (numeric EVM chain id, `solana:…`, `bip122:…`)
 * · explorer link building (tx + address)
 * · the family's default capability ceiling (delegates to capabilities.js)
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * Address checks are STRUCTURAL only. A base58 string of the right length is
 * "a plausible Solana address", not "the address you meant". Ownership and
 * network liveness are always verified at signature/connect time, never here.
 *
 * EVM chain ids here mirror `src/lib/chains.js` (kept as a static set because
 * that module pulls fee/payout config with extensionless imports that Node's
 * ESM loader cannot resolve in the probe — see the test harness note). Keep
 * both lists in sync when a chain is added or removed.
 */

import { structurallyValidAddress } from '../walletRisk.js';
import { isValidBtcAddress } from '../btcAddress.js';
import { FAMILY_CAPABILITIES } from './capabilities.js';

export const ADAPTER_SCHEMA = 'fbt.wallet-adapter.v1';

/** EVM chain ids this build supports — mirror of EVM_CHAIN_ORDER in chains.js. */
export const EVM_CHAIN_IDS = Object.freeze([56, 1, 137, 42161, 8453, 10, 43114, 59144, 146]);

/** Well-known non-numeric chain references (CAIP-2 style). */
export const CHAIN_REFS = Object.freeze({
  solana: 'solana:mainnet',
  bitcoin: 'bip122:000000000019d6689c085ae165831e93'
});

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Structural Solana address check (base58 alphabet, 32–44 chars). */
export function isValidSolanaAddress(addr) {
  return typeof addr === 'string' && SOLANA_ADDR.test(addr.trim());
}

/** Validate an address for a family. Structural only — see the honesty rules. */
export function validateAddress(family, address) {
  const f = String(family || '').toLowerCase();
  if (f === 'evm') return structurallyValidAddress(address);
  if (f === 'solana') return isValidSolanaAddress(address);
  if (f === 'bitcoin') return isValidBtcAddress(address);
  return false;
}

/** Normalize a chain reference into `{ family, chainId, ref }`. */
export function normalizeChainRef(ref) {
  if (ref == null || ref === '') return { family: null, chainId: null, ref: null };
  const s = String(ref).trim();
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    if (EVM_CHAIN_IDS.includes(id)) return { family: 'evm', chainId: id, ref: s };
    return { family: 'evm', chainId: id, ref: s };
  }
  if (s.startsWith('solana')) return { family: 'solana', chainId: null, ref: s };
  if (s.startsWith('bip122') || s === 'bitcoin' || s === 'btc' || s === 'bitcoin:mainnet') {
    return { family: 'bitcoin', chainId: null, ref: s };
  }
  if (s === 'ton' || s.startsWith('ton:')) return { family: 'ton', chainId: null, ref: s };
  return { family: null, chainId: null, ref: s };
}

/** Which family a chain reference belongs to (null when unknown). */
export function chainFamily(ref) {
  return normalizeChainRef(ref).family;
}

/** Explorer URL builders — null when the chain has no explorer (honest missing). */
const EXPLORERS = {
  evm: {
    1: 'https://etherscan.io', 10: 'https://optimistic.etherscan.io', 56: 'https://bscscan.com',
    137: 'https://polygonscan.com', 146: 'https://sonicscan.org', 8453: 'https://basescan.org',
    42161: 'https://arbiscan.io', 43114: 'https://snowtrace.io', 59144: 'https://lineascan.build'
  },
  solana: 'https://solscan.io',
  bitcoin: 'https://mempool.space'
};

export function explorerTxUrl(family, chainId, hash) {
  if (!hash) return null;
  const f = String(family || '').toLowerCase();
  if (f === 'evm') {
    const base = EXPLORERS.evm[Number(chainId)];
    return base ? `${base}/tx/${hash}` : null;
  }
  if (f === 'solana') return `${EXPLORERS.solana}/tx/${hash}`;
  if (f === 'bitcoin') return `${EXPLORERS.bitcoin}/tx/${hash}`;
  return null;
}

export function explorerAddressUrl(family, chainId, address) {
  if (!address) return null;
  const f = String(family || '').toLowerCase();
  if (f === 'evm') {
    const base = EXPLORERS.evm[Number(chainId)];
    return base ? `${base}/address/${address}` : null;
  }
  if (f === 'solana') return `${EXPLORERS.solana}/account/${address}`;
  if (f === 'bitcoin') return `${EXPLORERS.bitcoin}/address/${address}`;
  return null;
}

/** The adapter registry, keyed by family. */
export const ADAPTERS = Object.freeze({
  evm: Object.freeze({
    schema: ADAPTER_SCHEMA,
    family: 'evm',
    label: 'EVM',
    validateAddress: (a) => validateAddress('evm', a),
    capabilities: FAMILY_CAPABILITIES.evm
  }),
  solana: Object.freeze({
    schema: ADAPTER_SCHEMA,
    family: 'solana',
    label: 'Solana',
    validateAddress: (a) => validateAddress('solana', a),
    capabilities: FAMILY_CAPABILITIES.solana
  }),
  bitcoin: Object.freeze({
    schema: ADAPTER_SCHEMA,
    family: 'bitcoin',
    label: 'Bitcoin',
    validateAddress: (a) => validateAddress('bitcoin', a),
    capabilities: FAMILY_CAPABILITIES.bitcoin
  })
});

/** Adapter for a family, or null when the family is unknown. */
export function adapterFor(family) {
  return ADAPTERS[String(family || '').toLowerCase()] || null;
}

/** The family a wallet belongs to, derived from its chain reference when unset. */
export function familyOfWallet(wallet) {
  if (wallet?.family) return String(wallet.family).toLowerCase();
  return chainFamily(wallet?.chainId);
}
