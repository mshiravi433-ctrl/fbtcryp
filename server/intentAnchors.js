/**
 * Independent EVM anchoring for signed auction-close receipts.
 *
 * FBT never holds an anchor wallet here. Anyone may call the configured
 * IntentAuctionAnchor contract, then submit the transaction hash. The server
 * accepts an anchor record only after an RPC receipt contains the exact event
 * for the signed close and the configured confirmation threshold is met.
 */

import { Interface, getAddress } from 'ethers';
import { verifyAuctionClose } from './intentAuctions.js';

export const AUCTION_ANCHOR_CLAIM_SCHEMA = 'fbt.auction-anchor-claim.v1';
export const INTENT_ANCHOR_ABI = [
  'function anchor(bytes32 closeId, bytes32 intentHash, bytes32 logRoot, uint64 logSize, uint64 closedAt)',
  'event AuctionRootAnchored(bytes32 indexed closeId, bytes32 indexed intentHash, bytes32 indexed logRoot, uint64 logSize, uint64 closedAt, address anchorer)'
];
const iface = new Interface(INTENT_ANCHOR_ABI);
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const ALLOWED_CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);

function safeHttps(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

const DEFAULT_EXPLORERS = {
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  56: 'https://bscscan.com',
  137: 'https://polygonscan.com',
  146: 'https://sonicscan.org',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  43114: 'https://snowtrace.io',
  59144: 'https://lineascan.build'
};

function anchorNetworkFromSimpleEnv(env = process.env) {
  const contractRaw = env.INTENT_AUCTION_ANCHOR_ADDRESS || env.INTENT_ANCHOR_ADDRESS;
  let contract;
  try { contract = getAddress(contractRaw); } catch { return null; }
  if (/^0x0{40}$/i.test(contract)) return null;
  const chainId = Number(env.INTENT_AUCTION_ANCHOR_CHAIN_ID || env.INTENT_ANCHOR_CHAIN_ID || env.INTENT_ANCHOR_CHAIN || env.CHAIN_ID || 0);
  if (!Number.isInteger(chainId) || !ALLOWED_CHAINS.has(chainId)) return null;
  const rpcUrl = safeHttps(env.INTENT_AUCTION_ANCHOR_RPC_URL || env.INTENT_ANCHOR_RPC_URL || env.RPC_URL);
  const explorerBaseUrl = safeHttps(env.INTENT_AUCTION_ANCHOR_EXPLORER_BASE_URL || env.INTENT_ANCHOR_EXPLORER_BASE_URL)
    || DEFAULT_EXPLORERS[chainId] || null;
  const minConfirmationsRaw = Number(env.INTENT_AUCTION_ANCHOR_MIN_CONFIRMATIONS || env.INTENT_ANCHOR_MIN_CONFIRMATIONS);
  const minConfirmations = Number.isInteger(minConfirmationsRaw) ? Math.max(1, Math.min(128, minConfirmationsRaw)) : 12;
  return {
    chainId,
    name: String(env.INTENT_AUCTION_ANCHOR_NETWORK_NAME || env.INTENT_ANCHOR_NETWORK_NAME || `Chain ${chainId}`).replace(/[<>"'`\\]/g, '').slice(0, 60),
    contract,
    rpcUrl,
    explorerBaseUrl,
    minConfirmations
  };
}

export function parseAnchorNetworks(raw = process.env.INTENT_ANCHOR_NETWORKS || '') {
  if (!raw) {
    const simple = anchorNetworkFromSimpleEnv(process.env);
    if (!simple) return new Map();
    return new Map([[simple.chainId, simple]]);
  }
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return new Map();
    const networks = new Map();
    for (const row of rows.slice(0, 12)) {
      const chainId = Number(row?.chainId);
      const rpcUrl = safeHttps(row?.rpcUrl);
      let contract;
      try { contract = getAddress(row?.contract); } catch { continue; }
      if (!Number.isInteger(chainId)
        || !ALLOWED_CHAINS.has(chainId)
        || !rpcUrl
        || /^0x0{40}$/i.test(contract)
        || networks.has(chainId)) continue;
      const explorerBaseUrl = safeHttps(row.explorerBaseUrl);
      const minConfirmations = Number.isInteger(row.minConfirmations)
        ? Math.max(1, Math.min(128, row.minConfirmations)) : 2;
      networks.set(chainId, {
        chainId,
        name: String(row.name || `Chain ${chainId}`).replace(/[<>"'`\\]/g, '').slice(0, 60),
        contract,
        rpcUrl,
        explorerBaseUrl,
        minConfirmations
      });
    }
    return networks;
  } catch {
    return new Map();
  }
}

export function publicAnchorNetworks(networks = parseAnchorNetworks()) {
  return [...networks.values()].map(({ rpcUrl: _rpcUrl, ...network }) => network);
}

export function buildAnchorCalldata(close, chainId, networks = parseAnchorNetworks()) {
  if (!verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  const network = networks.get(Number(chainId));
  if (!network) return { ok: false, code: 'ANCHOR_NETWORK_NOT_CONFIGURED' };
  if (!close.logRoot) return { ok: false, code: 'EMPTY_AUCTION_CANNOT_BE_ANCHORED' };
  try {
    return {
      ok: true,
      chainId: network.chainId,
      contract: network.contract,
      to: network.contract,
      value: '0x0',
      data: iface.encodeFunctionData('anchor', [
        close.closeId,
        close.intentHash,
        close.logRoot,
        BigInt(close.logSize),
        BigInt(close.closedAt)
      ]),
      function: 'anchor(bytes32,bytes32,bytes32,uint64,uint64)',
      externallyAnchored: false
    };
  } catch {
    return { ok: false, code: 'ANCHOR_CALLDATA_FAILED' };
  }
}

async function defaultRpc(network, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(network.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.json();
    if (body?.error) throw new Error('RPC_ERROR');
    return body?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

const hexNumber = (value) => {
  try { return BigInt(value); } catch { return null; }
};
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export async function verifyAnchorClaim(close, claim, {
  networks = parseAnchorNetworks(),
  rpc = defaultRpc,
  now = Date.now()
} = {}) {
  if (!verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return { ok: false, code: 'BAD_ANCHOR_CLAIM' };
  if (Object.keys(claim).some((key) => !['schema', 'chainId', 'txHash'].includes(key))) {
    return { ok: false, code: 'UNKNOWN_ANCHOR_FIELD' };
  }
  if (claim.schema !== AUCTION_ANCHOR_CLAIM_SCHEMA) return { ok: false, code: 'BAD_ANCHOR_SCHEMA' };
  if (!Number.isInteger(claim.chainId)) return { ok: false, code: 'BAD_ANCHOR_CHAIN' };
  if (!TX_RE.test(String(claim.txHash || ''))) return { ok: false, code: 'BAD_ANCHOR_TX' };
  const network = networks.get(claim.chainId);
  if (!network) return { ok: false, code: 'ANCHOR_NETWORK_NOT_CONFIGURED' };

  let receipt;
  let latest;
  try {
    [receipt, latest] = await Promise.all([
      rpc(network, 'eth_getTransactionReceipt', [claim.txHash]),
      rpc(network, 'eth_blockNumber', [])
    ]);
  } catch {
    return { ok: false, code: 'ANCHOR_RPC_UNAVAILABLE' };
  }
  if (!receipt) return { ok: false, code: 'ANCHOR_NOT_MINED' };
  if (String(receipt.status).toLowerCase() !== '0x1') return { ok: false, code: 'ANCHOR_TX_FAILED' };
  if (receipt.transactionHash && !same(receipt.transactionHash, claim.txHash)) {
    return { ok: false, code: 'ANCHOR_TX_MISMATCH' };
  }

  let matched = null;
  for (const log of Array.isArray(receipt.logs) ? receipt.logs : []) {
    if (log?.removed || !same(log.address, network.contract)) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name !== 'AuctionRootAnchored') continue;
      if (!same(parsed.args.closeId, close.closeId)
        || !same(parsed.args.intentHash, close.intentHash)
        || !same(parsed.args.logRoot, close.logRoot)
        || BigInt(parsed.args.logSize) !== BigInt(close.logSize)
        || BigInt(parsed.args.closedAt) !== BigInt(close.closedAt)) continue;
      matched = parsed;
      break;
    } catch {
      // A different event from the configured contract is irrelevant.
    }
  }
  if (!matched) return { ok: false, code: 'ANCHOR_EVENT_MISMATCH' };

  const blockNumber = hexNumber(receipt.blockNumber);
  const latestBlock = hexNumber(latest);
  if (blockNumber == null
    || latestBlock == null
    || latestBlock < blockNumber
    || !TX_RE.test(String(receipt.blockHash || ''))) {
    return { ok: false, code: 'ANCHOR_BLOCK_INVALID' };
  }
  const confirmations = Number(latestBlock - blockNumber + 1n);
  if (confirmations < network.minConfirmations) {
    return {
      ok: false,
      code: 'ANCHOR_NOT_FINAL',
      confirmations,
      requiredConfirmations: network.minConfirmations
    };
  }

  return {
    ok: true,
    anchor: {
      verified: true,
      chainId: network.chainId,
      network: network.name,
      contract: network.contract,
      txHash: String(claim.txHash).toLowerCase(),
      blockNumber: Number(blockNumber),
      blockHash: TX_RE.test(String(receipt.blockHash || '')) ? receipt.blockHash.toLowerCase() : null,
      confirmationsAtVerification: confirmations,
      requiredConfirmations: network.minConfirmations,
      anchorer: String(matched.args.anchorer || '').toLowerCase(),
      explorerUrl: network.explorerBaseUrl ? `${network.explorerBaseUrl}/tx/${claim.txHash}` : null,
      verifiedAt: now
    }
  };
}
