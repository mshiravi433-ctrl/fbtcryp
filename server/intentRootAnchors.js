/**
 * Optional publication of a transparency-log Merkle root (Phase 6).
 * --------------------------------------------------------------------------
 * Anyone may publish an exact fbt.merkle-root-manifest.v1 through a configured
 * permissionless IntentMerkleRootAnchor contract, then submit the transaction
 * hash. FBT accepts `externallyAnchored: true` only after independently reading
 * the configured RPC receipt, matching the exact event and confirmation count.
 *
 * No wallet or private key is held here; calldata construction and receipt
 * verification are public. An anchor timestamps a root. It does not prove
 * auction completeness, execution, settlement, or custody.
 */

import { createHash } from 'node:crypto';
import { Interface, getAddress } from 'ethers';
import { blobConfigured } from './blobCache.js';
import { canonicalValue } from './intentSignatures.js';
import { merkleRoot } from './intentTransparency.js';

export const MERKLE_ROOT_MANIFEST_SCHEMA = 'fbt.merkle-root-manifest.v1';
export const MERKLE_ROOT_ANCHOR_CLAIM_SCHEMA = 'fbt.merkle-root-anchor-claim.v1';
export const MERKLE_ROOT_ANCHOR_RECORD_SCHEMA = 'fbt.merkle-root-anchor-record.v1';
export const MERKLE_ROOT_ID_DOMAIN = 'fbt.merkle-root-manifest.v1/id';
export const MERKLE_ROOT_ANCHOR_ABI = Object.freeze([
  'function anchorRoot(bytes32 rootId, bytes32 intentHash, bytes32 merkleRoot, uint64 logSize)',
  'event MerkleRootAnchored(bytes32 indexed rootId, bytes32 indexed intentHash, bytes32 indexed merkleRoot, uint64 logSize, address anchorer)'
]);

const iface = new Interface(MERKLE_ROOT_ANCHOR_ABI);
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ALLOWED_CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const MANIFEST_CLAIM_FIELDS = new Set([
  'timestampPublication', 'inclusionSetCommitment', 'completenessProven',
  'executionProven', 'settlementProven', 'custody'
]);
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-root-anchor/v1/';
const memory = new Map();
const pending = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const recordPath = (rootId) => `${PREFIX}${rootId.slice(2)}.json`;

function safeHttps(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

export function parseMerkleAnchorNetworks(raw = process.env.INTENT_MERKLE_ANCHOR_NETWORKS || '') {
  if (!raw) return new Map();
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return new Map();
    const networks = new Map();
    for (const row of rows.slice(0, 12)) {
      const chainId = Number(row?.chainId);
      const rpcUrl = safeHttps(row?.rpcUrl);
      let contract;
      try { contract = getAddress(row?.contract); } catch { continue; }
      if (!Number.isInteger(chainId) || !ALLOWED_CHAINS.has(chainId)
        || !rpcUrl || /^0x0{40}$/i.test(contract) || networks.has(chainId)) continue;
      const minConfirmations = Number.isInteger(row.minConfirmations)
        ? Math.max(1, Math.min(128, row.minConfirmations)) : 2;
      networks.set(chainId, {
        chainId,
        name: String(row.name || `Chain ${chainId}`).replace(/[<>"'`\\]/g, '').slice(0, 60),
        contract,
        rpcUrl,
        explorerBaseUrl: safeHttps(row.explorerBaseUrl),
        minConfirmations
      });
    }
    return networks;
  } catch {
    return new Map();
  }
}

export function publicMerkleAnchorNetworks(networks = parseMerkleAnchorNetworks()) {
  return [...networks.values()].map(({ rpcUrl: _rpcUrl, ...row }) => row);
}

function rootIdFor(core) {
  return sha256Hex(`${MERKLE_ROOT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

export function validateMerkleRootManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['schema', 'rootId', 'intentHash', 'merkleRoot', 'logSize', 'claims'].includes(key))
    || input.schema !== MERKLE_ROOT_MANIFEST_SCHEMA
    || !TX_RE_64.test(String(input.rootId || ''))
    || !TX_RE_64.test(String(input.intentHash || ''))
    || !TX_RE_64.test(String(input.merkleRoot || ''))
    || !Number.isSafeInteger(input.logSize)
    || input.logSize <= 0) return { ok: false, code: 'BAD_MERKLE_ROOT_MANIFEST' };
  const claims = input.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !MANIFEST_CLAIM_FIELDS.has(key))
    || claims.timestampPublication !== true || claims.inclusionSetCommitment !== true
    || claims.completenessProven !== false || claims.executionProven !== false
    || claims.settlementProven !== false || claims.custody !== false) {
    return { ok: false, code: 'BAD_MERKLE_ROOT_CLAIMS' };
  }
  const { rootId, ...core } = input;
  if (rootIdFor(core) !== rootId.toLowerCase()) return { ok: false, code: 'BAD_MERKLE_ROOT_ID' };
  return { ok: true, manifest: { ...input, rootId: input.rootId.toLowerCase() } };
}

/** Recompute the root from every returned transparency entry before anchoring. */
export function buildMerkleRootManifest(log) {
  if (!log || log.schema !== 'fbt.transparency-log.v1'
    || !TX_RE_64.test(String(log.intentHash || ''))
    || !Array.isArray(log.entries)
    || log.entries.length !== log.size
    || log.size <= 0) return { ok: false, code: 'BAD_TRANSPARENCY_LOG' };
  const hashes = log.entries.map((row) => row?.entryHash);
  if (hashes.some((hash) => !TX_RE_64.test(String(hash || '')))
    || merkleRoot(hashes) !== String(log.root || '').toLowerCase()) {
    return { ok: false, code: 'MERKLE_ROOT_RECOMPUTE_MISMATCH' };
  }
  const core = {
    schema: MERKLE_ROOT_MANIFEST_SCHEMA,
    intentHash: log.intentHash.toLowerCase(),
    merkleRoot: log.root.toLowerCase(),
    logSize: log.size,
    claims: {
      timestampPublication: true,
      inclusionSetCommitment: true,
      completenessProven: false,
      executionProven: false,
      settlementProven: false,
      custody: false
    }
  };
  return { ok: true, manifest: { ...core, rootId: rootIdFor(core) } };
}

export function buildMerkleRootAnchorCalldata(manifest, chainId, networks = parseMerkleAnchorNetworks()) {
  const checked = validateMerkleRootManifest(manifest);
  if (!checked.ok) return checked;
  const network = networks.get(Number(chainId));
  if (!network) return { ok: false, code: 'MERKLE_ANCHOR_NETWORK_NOT_CONFIGURED' };
  try {
    return {
      ok: true,
      manifest: checked.manifest,
      chainId: network.chainId,
      contract: network.contract,
      to: network.contract,
      value: '0x0',
      data: iface.encodeFunctionData('anchorRoot', [
        checked.manifest.rootId,
        checked.manifest.intentHash,
        checked.manifest.merkleRoot,
        BigInt(checked.manifest.logSize)
      ]),
      function: 'anchorRoot(bytes32,bytes32,bytes32,uint64)',
      externallyAnchored: false
    };
  } catch {
    return { ok: false, code: 'MERKLE_ANCHOR_CALLDATA_FAILED' };
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

export async function verifyMerkleRootAnchorClaim(manifest, claim, {
  networks = parseMerkleAnchorNetworks(),
  rpc = defaultRpc,
  now = Date.now()
} = {}) {
  const checked = validateMerkleRootManifest(manifest);
  if (!checked.ok) return checked;
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)
    || Object.keys(claim).some((key) => !['schema', 'rootId', 'chainId', 'txHash'].includes(key))
    || claim.schema !== MERKLE_ROOT_ANCHOR_CLAIM_SCHEMA
    || !same(claim.rootId, checked.manifest.rootId)
    || !Number.isInteger(claim.chainId)
    || !TX_RE_64.test(String(claim.txHash || ''))) {
    return { ok: false, code: 'BAD_MERKLE_ANCHOR_CLAIM' };
  }
  const network = networks.get(claim.chainId);
  if (!network) return { ok: false, code: 'MERKLE_ANCHOR_NETWORK_NOT_CONFIGURED' };
  let receipt;
  let latest;
  try {
    [receipt, latest] = await Promise.all([
      rpc(network, 'eth_getTransactionReceipt', [claim.txHash]),
      rpc(network, 'eth_blockNumber', [])
    ]);
  } catch {
    return { ok: false, code: 'MERKLE_ANCHOR_RPC_UNAVAILABLE' };
  }
  if (!receipt) return { ok: false, code: 'MERKLE_ANCHOR_NOT_MINED' };
  if (String(receipt.status).toLowerCase() !== '0x1') return { ok: false, code: 'MERKLE_ANCHOR_TX_FAILED' };
  if (receipt.transactionHash && !same(receipt.transactionHash, claim.txHash)) {
    return { ok: false, code: 'MERKLE_ANCHOR_TX_MISMATCH' };
  }
  let matched = null;
  for (const log of Array.isArray(receipt.logs) ? receipt.logs : []) {
    if (log?.removed || !same(log.address, network.contract)) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name !== 'MerkleRootAnchored'
        || !same(parsed.args.rootId, checked.manifest.rootId)
        || !same(parsed.args.intentHash, checked.manifest.intentHash)
        || !same(parsed.args.merkleRoot, checked.manifest.merkleRoot)
        || BigInt(parsed.args.logSize) !== BigInt(checked.manifest.logSize)) continue;
      matched = parsed;
      break;
    } catch {
      // Unrelated event from the same contract.
    }
  }
  if (!matched) return { ok: false, code: 'MERKLE_ANCHOR_EVENT_MISMATCH' };
  const blockNumber = hexNumber(receipt.blockNumber);
  const latestBlock = hexNumber(latest);
  if (blockNumber == null || latestBlock == null || latestBlock < blockNumber
    || !TX_RE_64.test(String(receipt.blockHash || ''))) {
    return { ok: false, code: 'MERKLE_ANCHOR_BLOCK_INVALID' };
  }
  const confirmations = Number(latestBlock - blockNumber + 1n);
  if (confirmations < network.minConfirmations) {
    return {
      ok: false,
      code: 'MERKLE_ANCHOR_NOT_FINAL',
      confirmations,
      requiredConfirmations: network.minConfirmations
    };
  }
  return {
    ok: true,
    anchor: {
      ...checked.manifest,
      schema: MERKLE_ROOT_ANCHOR_RECORD_SCHEMA,
      verified: true,
      externallyAnchored: true,
      chainId: network.chainId,
      network: network.name,
      contract: network.contract,
      txHash: claim.txHash.toLowerCase(),
      blockNumber: Number(blockNumber),
      blockHash: receipt.blockHash.toLowerCase(),
      confirmationsAtVerification: confirmations,
      requiredConfirmations: network.minConfirmations,
      anchorer: String(matched.args.anchorer || '').toLowerCase(),
      explorerUrl: network.explorerBaseUrl ? `${network.explorerBaseUrl}/tx/${claim.txHash}` : null,
      verifiedAt: now,
      claims: checked.manifest.claims
    }
  };
}

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

async function readObject(path) {
  if (memory.has(path)) return memory.get(path);
  const mod = await blob();
  if (!blobConfigured()) return null;
  if (!mod) throw new Error('MERKLE_ANCHOR_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('MERKLE_ANCHOR_OBJECT_UNREADABLE');
    const row = await response.json();
    memory.set(path, row);
    return row;
  } catch {
    throw new Error('MERKLE_ANCHOR_STORE_UNAVAILABLE');
  }
}

async function writeObject(path, row) {
  if (memory.has(path) || pending.has(path)) return { ok: false, duplicate: true };
  pending.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'MERKLE_ANCHOR_STORE_UNAVAILABLE' };
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(row), {
          token: TOKEN,
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31536000
        });
      } catch {
        try { if (await readObject(path)) return { ok: false, duplicate: true }; } catch { /* preserve */ }
        return { ok: false, code: 'MERKLE_ANCHOR_WRITE_FAILED' };
      }
    }
    memory.set(path, row);
    return { ok: true };
  } finally {
    pending.delete(path);
  }
}

function validStored(record, manifest) {
  return Boolean(record
    && record.schema === MERKLE_ROOT_ANCHOR_RECORD_SCHEMA
    && record.verified === true
    && record.externallyAnchored === true
    && same(record.rootId, manifest.rootId)
    && same(record.intentHash, manifest.intentHash)
    && same(record.merkleRoot, manifest.merkleRoot)
    && record.logSize === manifest.logSize
    && Number.isInteger(record.chainId)
    && TX_RE_64.test(String(record.txHash || '')));
}

export async function storeMerkleRootAnchor(manifest, anchor) {
  const checked = validateMerkleRootManifest(manifest);
  if (!checked.ok || !anchor?.verified || !validStored(anchor, checked.manifest)) {
    return { ok: false, code: 'BAD_MERKLE_ANCHOR_RECORD' };
  }
  const path = recordPath(checked.manifest.rootId);
  try {
    const existing = await readObject(path);
    if (existing) return validStored(existing, checked.manifest)
      ? { ok: true, alreadyAnchored: true, anchor: existing }
      : { ok: false, code: 'INVALID_STORED_MERKLE_ANCHOR' };
    const stored = await writeObject(path, anchor);
    if (!stored.ok) {
      if (!stored.duplicate) return stored;
      const concurrent = await readObject(path);
      return validStored(concurrent, checked.manifest)
        ? { ok: true, alreadyAnchored: true, anchor: concurrent }
        : { ok: false, code: 'INVALID_STORED_MERKLE_ANCHOR' };
    }
    return { ok: true, alreadyAnchored: false, anchor };
  } catch {
    return { ok: false, code: 'MERKLE_ANCHOR_STORE_UNAVAILABLE' };
  }
}

export async function readMerkleRootAnchor(manifest) {
  const checked = validateMerkleRootManifest(manifest);
  if (!checked.ok) return { error: checked.code };
  try {
    const anchor = await readObject(recordPath(checked.manifest.rootId));
    if (!anchor) return { anchor: null };
    return validStored(anchor, checked.manifest)
      ? { anchor }
      : { error: 'INVALID_STORED_MERKLE_ANCHOR' };
  } catch {
    return { error: 'MERKLE_ANCHOR_STORE_UNAVAILABLE' };
  }
}

export function merkleRootAnchorStatus(networks = parseMerkleAnchorNetworks()) {
  return {
    supported: true,
    configured: networks.size > 0,
    manifestSchema: MERKLE_ROOT_MANIFEST_SCHEMA,
    claimSchema: MERKLE_ROOT_ANCHOR_CLAIM_SCHEMA,
    configuredNetworks: networks.size,
    externallyAnchoredByDefault: false,
    permissionlessPublisher: true,
    fbtAnchorWallet: false,
    custody: false,
    provesCompleteness: false,
    provesExecution: false,
    cli: 'scripts/intent-root-anchor.mjs'
  };
}

export { iface as merkleRootAnchorInterface };
