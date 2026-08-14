/**
 * Phase 4c — independent multi-RPC verification of cross-chain legs.
 * --------------------------------------------------------------------------
 * A Phase 4b fbt.cross-chain-leg-receipt.v1 is a SIGNED PARTY CLAIM: the
 * txHash inside it is what the party says happened, so the receipt honestly
 * carries onChainVerified:false forever. This module adds a separate,
 * derived verification layer that actually reads the chain:
 *
 *   1. fbt.cross-chain-account-binding.v1 — a party binds an on-chain
 *      address to the SAME Ed25519 key pinned in the state. The binding is
 *      self-attested address control; it is NOT a wallet signature and NOT
 *      funds authority, and its claims say so explicitly.
 *   2. fbt.cross-chain-tx-verification.v1 — a registered verifier reads the
 *      transaction from AT LEAST TWO https RPC endpoints with distinct
 *      hostnames, checks exact transfer facts against the immutable plan and
 *      the signed bindings, and signs a bounded report. The server refuses to
 *      store any report it cannot fully recompute from its own RPC reads.
 *
 * Fail-closed by design: RPC disagreement, reorg/block-hash drift, a failed
 * receipt, a missing transaction, insufficient confirmations, a wrong token
 * contract/sender/recipient/amount, an expired or mis-keyed binding, or fewer
 * than two agreeing endpoints all refuse verification. An outage is an
 * outage — it never becomes "verified" and never becomes an empty success.
 *
 * What this deliberately does NOT change: verifying the two legs of a
 * sequential swap proves two separate transactions happened. It does not make
 * them atomic, it creates no escrow or custody, and it gives FBT no power to
 * enforce a refund. atomic/globalAtomicity/custody/escrow/automaticSettlement
 * and refundEnforcedByFbt stay false even when every submitted leg is
 * on-chain verified, and the outer envelope stays draft-only under
 * ATOMIC_CROSS_CHAIN_UNAVAILABLE.
 *
 * RPC endpoints are configured ONLY through the server-side
 * INTENT_CROSS_CHAIN_RPC_NETWORKS variable. URLs are never echoed in public
 * responses, logs or errors, and two distinct hostnames are a plumbing
 * requirement — they are NOT proof of provider independence, so capabilities
 * publish providerIndependenceProven:false.
 */

import { createHash } from 'node:crypto';
import { Interface, getAddress, isAddress } from 'ethers';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  isValidEd25519PublicKey,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import {
  CROSS_CHAIN_LEGS,
  readCrossChainState,
  validateCrossChainState,
  verifyCrossChainReceipt
} from './intentCrossChain.js';

export const ACCOUNT_BINDING_SCHEMA = 'fbt.cross-chain-account-binding.v1';
export const ACCOUNT_BINDING_DOMAIN = 'fbt.cross-chain-account-binding.v1/signature';
export const TX_VERIFICATION_SCHEMA = 'fbt.cross-chain-tx-verification.v1';
export const TX_VERIFICATION_DOMAIN = 'fbt.cross-chain-tx-verification.v1/signature';
export const VERIFICATION_QUORUM = 2;
/** Deterministic on-chain outcomes a signed rejection may carry. Anything
 *  transient (outage, missing tx, drift, pending confirmations) is refused
 *  instead of being frozen into an immutable verdict. */
export const FINAL_REJECT_REASONS = Object.freeze([
  'TX_RECEIPT_FAILED', 'WRONG_TOKEN_CONTRACT', 'WRONG_SENDER',
  'WRONG_RECIPIENT', 'WRONG_AMOUNT'
]);
export const TRANSIENT_VERIFICATION_CODES = Object.freeze([
  'RPC_QUORUM_UNAVAILABLE', 'RPC_DISAGREEMENT', 'TX_NOT_FOUND',
  'INSUFFICIENT_CONFIRMATIONS'
]);
export const LEG_VERIFICATION_STATUSES = Object.freeze([
  'signed-only', 'verification-pending', 'rpc-disagreement',
  'confirmations-pending', 'onchain-verified', 'verification-rejected'
]);

const BINDING_ID_DOMAIN = 'fbt.cross-chain-account-binding.v1/id';
const REPORT_ID_DOMAIN = 'fbt.cross-chain-tx-verification.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const MAX_BINDING_SECONDS = 366 * 86400;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_OBSERVATIONS = 9;
const TRANSFER_IFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
const TRANSFER_TOPIC = TRANSFER_IFACE.getEvent('Transfer').topicHash;

const BINDING_FIELDS = new Set([
  'schema', 'stateId', 'partyId', 'chainId', 'address', 'issuedAt',
  'expiresAt', 'publicKey', 'claims', 'bindingId', 'signature'
]);
const BINDING_CLAIM_FIELDS = new Set([
  'addressControlSelfAttested', 'walletSignatureVerified',
  'fundsAuthorityGranted', 'custody'
]);
const REPORT_FIELDS = new Set([
  'schema', 'stateId', 'receiptId', 'leg', 'chainId', 'token', 'amount',
  'txHash', 'fromPartyId', 'toPartyId', 'fromAddress', 'toAddress',
  'fromBindingId', 'toBindingId', 'blockNumber', 'blockHash', 'receiptStatus',
  'confirmations', 'minConfirmations', 'observations', 'quorum', 'verifiedAt',
  'verifier', 'verdict', 'rejectReason', 'claims', 'reportId', 'signature'
]);
const REPORT_CLAIM_FIELDS = new Set([
  'legOnChainVerified', 'atomicSettlement', 'globalAtomicity', 'custody',
  'providerIndependenceProven'
]);
const OBSERVATION_FIELDS = new Set([
  'index', 'ok', 'code', 'blockNumber', 'blockHash', 'status', 'confirmations'
]);

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-cross-chain/v1/';
const memory = new Map();
const pending = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const bindingPath = (stateId, partyId, chainId) =>
  `${PREFIX}bindings/${String(stateId).slice(2)}/${partyId}-${chainId}.json`;
const reportPath = (stateId, leg, reportId) =>
  `${PREFIX}verifications/${String(stateId).slice(2)}/${leg}-${String(reportId).slice(2)}.json`;

function sameCanonical(a, b) {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));
}

/* ------------------------- multi-RPC configuration ------------------------ */

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Server-only RPC configuration. A chain counts as configured ONLY with at
 * least two https endpoints on distinct hostnames — one provider answering
 * twice proves nothing. The parsed URLs never leave this process: public
 * status exposes counts, never endpoints.
 */
export function parseCrossChainRpcNetworks(raw = process.env.INTENT_CROSS_CHAIN_RPC_NETWORKS || '') {
  if (!raw) return new Map();
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return new Map();
    const networks = new Map();
    for (const row of rows.slice(0, 12)) {
      const chainId = Number(row?.chainId);
      if (!Number.isInteger(chainId) || !CHAINS.has(chainId) || networks.has(chainId)) continue;
      const urls = [];
      const hosts = new Set();
      for (const candidate of (Array.isArray(row?.rpcUrls) ? row.rpcUrls : []).slice(0, 8)) {
        const url = safeHttpsUrl(candidate);
        if (!url || urls.some((existing) => existing === url.toString())) continue;
        urls.push(url.toString());
        hosts.add(url.hostname.toLowerCase());
      }
      if (urls.length < VERIFICATION_QUORUM || hosts.size < VERIFICATION_QUORUM) continue;
      const minConfirmations = Number.isInteger(row.minConfirmations)
        ? Math.max(1, Math.min(128, row.minConfirmations)) : 3;
      networks.set(chainId, {
        chainId,
        name: String(row.name || `Chain ${chainId}`).replace(/[<>"'`\\]/g, '').slice(0, 60),
        rpcUrls: urls,
        distinctRpcHosts: hosts.size,
        minConfirmations
      });
    }
    return networks;
  } catch {
    return new Map();
  }
}

/** Public capability view. No URL, no hostname, no provider name leaves the server. */
export function crossChainVerificationStatus(networks = parseCrossChainRpcNetworks()) {
  return {
    schema: TX_VERIFICATION_SCHEMA,
    accountBindingSchema: ACCOUNT_BINDING_SCHEMA,
    available: true,
    multiRpcConfigured: networks.size > 0,
    quorumRequired: VERIFICATION_QUORUM,
    chains: [...networks.values()].map((row) => ({
      chainId: row.chainId,
      name: row.name,
      endpoints: row.rpcUrls.length,
      distinctRpcHosts: row.distinctRpcHosts,
      minConfirmations: row.minConfirmations
    })),
    rpcUrlsPublished: false,
    /* Distinct hostnames are a plumbing requirement, not an audit. Two URLs
       can still resolve to one operator, so independence is never claimed. */
    providerIndependenceProven: false,
    legStatuses: LEG_VERIFICATION_STATUSES,
    finalRejectReasons: FINAL_REJECT_REASONS,
    verifiedLegsRemainNonAtomic: true,
    note: 'Verifying two separate transactions proves each happened; it does not make them atomic, add custody or escrow, or let FBT enforce a refund.'
  };
}

/* --------------------------- account bindings ----------------------------- */

function bindingIdFor(core) {
  return sha256Hex(`${BINDING_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function partyInState(state, partyId) {
  if (state.parties.initiator.id === partyId) return state.parties.initiator;
  if (state.parties.counterparty.id === partyId) return state.parties.counterparty;
  return null;
}

/**
 * Strict verification of one signed account binding against the immutable
 * plan. The binding MUST be signed by the exact Ed25519 key the state pins
 * for that party — an address arriving in an API request body proves nothing.
 */
export function verifyAccountBinding(input, { state, now = Date.now() } = {}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const plan = checkedState.state;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_ACCOUNT_BINDING' };
  }
  if (Object.keys(input).some((key) => !BINDING_FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_ACCOUNT_BINDING_FIELD' };
  }
  if (input.schema !== ACCOUNT_BINDING_SCHEMA || !same(input.stateId, plan.stateId)) {
    return { ok: false, code: 'BAD_ACCOUNT_BINDING_BINDING' };
  }
  const party = ID_RE.test(String(input.partyId || '')) ? partyInState(plan, input.partyId) : null;
  if (!party) return { ok: false, code: 'UNKNOWN_BINDING_PARTY' };
  if (input.publicKey !== party.publicKey || !isValidEd25519PublicKey(input.publicKey)) {
    return { ok: false, code: 'BINDING_KEY_MISMATCH' };
  }
  const chainId = input.chainId;
  if (!Number.isInteger(chainId) || !CHAINS.has(chainId)
    || ![plan.source.chainId, plan.destination.chainId].includes(chainId)) {
    return { ok: false, code: 'BAD_BINDING_CHAIN' };
  }
  if (!isAddress(String(input.address || '')) || getAddress(input.address) !== input.address) {
    return { ok: false, code: 'BAD_BINDING_ADDRESS' };
  }
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(input.issuedAt) || !Number.isSafeInteger(input.expiresAt)
    || input.expiresAt <= input.issuedAt
    || input.expiresAt - input.issuedAt > MAX_BINDING_SECONDS
    || input.issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_BINDING_WINDOW' };
  }
  if (input.expiresAt <= nowSeconds) return { ok: false, code: 'ACCOUNT_BINDING_EXPIRED' };
  const claims = input.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !BINDING_CLAIM_FIELDS.has(key))
    || claims.addressControlSelfAttested !== true
    /* walletSignatureVerified stays false until a REAL EIP-191/EIP-712
       verification exists as its own schema. Nothing here checks a wallet
       signature, so nothing here may claim wallet ownership. */
    || claims.walletSignatureVerified !== false
    || claims.fundsAuthorityGranted !== false
    || claims.custody !== false) {
    return { ok: false, code: 'BAD_ACCOUNT_BINDING_CLAIMS' };
  }
  const { bindingId, signature, ...core } = input;
  if (!TX_RE_64.test(String(bindingId || '')) || bindingIdFor(core) !== bindingId) {
    return { ok: false, code: 'BAD_ACCOUNT_BINDING_ID' };
  }
  if (!verifyCanonicalSignature(ACCOUNT_BINDING_DOMAIN, { ...core, bindingId }, signature, party.publicKey)) {
    return { ok: false, code: 'ACCOUNT_BINDING_SIGNATURE_MISMATCH' };
  }
  return { ok: true, binding: input };
}

/** Build a binding in the party's own environment. Key stays CLI-side. */
export function buildAccountBinding({
  state,
  partyId,
  chainId,
  address,
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt
}, privateKey, { now = Date.now() } = {}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const party = partyInState(checkedState.state, String(partyId || '').toLowerCase());
  if (!party) return { ok: false, code: 'UNKNOWN_BINDING_PARTY' };
  try {
    if (publicKeyFromPrivateKey(privateKey) !== party.publicKey) {
      return { ok: false, code: 'BINDING_KEY_MISMATCH' };
    }
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  let checksummed;
  try { checksummed = getAddress(String(address || '')); } catch {
    return { ok: false, code: 'BAD_BINDING_ADDRESS' };
  }
  const core = {
    schema: ACCOUNT_BINDING_SCHEMA,
    stateId: checkedState.state.stateId,
    partyId: party.id,
    chainId: Number(chainId),
    address: checksummed,
    issuedAt: Number(issuedAt),
    expiresAt: Number(expiresAt),
    publicKey: party.publicKey,
    claims: {
      addressControlSelfAttested: true,
      walletSignatureVerified: false,
      fundsAuthorityGranted: false,
      custody: false
    }
  };
  const bindingId = bindingIdFor(core);
  let binding;
  try {
    binding = {
      ...core,
      bindingId,
      signature: signCanonicalPayload(ACCOUNT_BINDING_DOMAIN, { ...core, bindingId }, privateKey)
    };
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  return verifyAccountBinding(binding, { state: checkedState.state, now });
}

/* ------------------------- multi-RPC observation -------------------------- */

async function defaultRpc(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal
    });
    /* Never quote the URL back — RPC endpoints are server secrets. */
    if (!response.ok) throw new Error('RPC_HTTP_ERROR');
    const body = await response.json();
    if (body?.error) throw new Error('RPC_ERROR');
    return body?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

const hexInt = (value) => {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
};

function decodeTransferLog(log) {
  try {
    if (!Array.isArray(log?.topics) || !same(log.topics[0], TRANSFER_TOPIC)) return null;
    const parsed = TRANSFER_IFACE.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return null;
    return {
      from: getAddress(parsed.args.from),
      to: getAddress(parsed.args.to),
      value: BigInt(parsed.args.value)
    };
  } catch {
    return null;
  }
}

/**
 * Read one leg from a single endpoint and check the deterministic transfer
 * facts. Returns either transport failure, a deterministic mismatch code, or
 * the exact chain facts observed.
 */
async function observeEndpoint({ url, index, expected, rpc }) {
  let receipt;
  let tx;
  let latest;
  try {
    [receipt, tx, latest] = await Promise.all([
      rpc(url, 'eth_getTransactionReceipt', [expected.txHash]),
      rpc(url, 'eth_getTransactionByHash', [expected.txHash]),
      rpc(url, 'eth_blockNumber', [])
    ]);
  } catch {
    return { index, ok: false, code: 'RPC_UNAVAILABLE' };
  }
  const latestBlock = hexInt(latest);
  if (latestBlock == null) return { index, ok: false, code: 'RPC_UNAVAILABLE' };
  if (!receipt || !tx) return { index, ok: true, code: 'TX_NOT_FOUND' };
  const blockNumber = hexInt(receipt.blockNumber);
  const blockHash = TX_RE_64.test(String(receipt.blockHash || '')) ? String(receipt.blockHash).toLowerCase() : null;
  if (blockNumber == null || !blockHash
    || (receipt.transactionHash && !same(receipt.transactionHash, expected.txHash))) {
    return { index, ok: false, code: 'RPC_UNAVAILABLE' };
  }
  const confirmations = latestBlock >= blockNumber ? Number(latestBlock - blockNumber + 1n) : 0;
  const base = {
    index,
    ok: true,
    blockNumber: Number(blockNumber),
    blockHash,
    confirmations
  };
  if (String(receipt.status).toLowerCase() !== '0x1') {
    return { ...base, code: 'TX_RECEIPT_FAILED', status: 'failed' };
  }
  if (expected.native) {
    let txFrom;
    let txTo;
    try {
      txFrom = getAddress(String(tx.from || ''));
      txTo = getAddress(String(tx.to || ''));
    } catch {
      return { ...base, code: 'WRONG_RECIPIENT', status: 'success' };
    }
    if (txFrom !== expected.fromAddress) return { ...base, code: 'WRONG_SENDER', status: 'success' };
    if (txTo !== expected.toAddress) return { ...base, code: 'WRONG_RECIPIENT', status: 'success' };
    const value = hexInt(tx.value);
    if (value == null || value !== BigInt(expected.amount)) {
      return { ...base, code: 'WRONG_AMOUNT', status: 'success' };
    }
    return { ...base, code: null, status: 'success' };
  }
  /* ERC-20: the Transfer event must come from EXACTLY the planned token
     contract and carry exactly the planned sender, recipient and amount. */
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const tokenLogs = logs.filter((log) => !log?.removed && same(log?.address, expected.tokenAddress));
  const transfers = tokenLogs.map(decodeTransferLog).filter(Boolean);
  if (!transfers.length) return { ...base, code: 'WRONG_TOKEN_CONTRACT', status: 'success' };
  const fromMatches = transfers.filter((row) => row.from === expected.fromAddress);
  if (!fromMatches.length) return { ...base, code: 'WRONG_SENDER', status: 'success' };
  const toMatches = fromMatches.filter((row) => row.to === expected.toAddress);
  if (!toMatches.length) return { ...base, code: 'WRONG_RECIPIENT', status: 'success' };
  if (!toMatches.some((row) => row.value === BigInt(expected.amount))) {
    return { ...base, code: 'WRONG_AMOUNT', status: 'success' };
  }
  return { ...base, code: null, status: 'success' };
}

/**
 * Observe one leg across every configured endpoint and derive the quorum
 * outcome. `final: true` marks a deterministic verdict a signed report may
 * carry; everything else is transient and must be retried, never stored.
 */
export async function observeLegAcrossRpcs({ network, expected, rpc = defaultRpc }) {
  const observations = await Promise.all(
    network.rpcUrls.slice(0, MAX_OBSERVATIONS).map((url, index) =>
      observeEndpoint({ url, index, expected, rpc }))
  );
  const reachable = observations.filter((row) => row.ok);
  const found = reachable.filter((row) => row.code !== 'TX_NOT_FOUND');
  const summary = {
    observations: observations.map(({ index, ok, code, blockNumber, blockHash, status, confirmations }) => ({
      index,
      ok,
      code: code ?? null,
      blockNumber: blockNumber ?? null,
      blockHash: blockHash ?? null,
      status: status ?? null,
      confirmations: confirmations ?? null
    })),
    quorum: { required: VERIFICATION_QUORUM, total: observations.length, agreeing: 0 }
  };
  if (reachable.length < VERIFICATION_QUORUM) {
    return { ...summary, final: false, code: 'RPC_QUORUM_UNAVAILABLE' };
  }
  if (found.length && found.length < reachable.length) {
    /* One endpoint sees the tx, another does not: reorg in progress or
       provider drift. Fail closed either way. */
    return { ...summary, final: false, code: 'RPC_DISAGREEMENT' };
  }
  if (!found.length) {
    return { ...summary, final: false, code: 'TX_NOT_FOUND' };
  }
  const first = found[0];
  const agree = found.every((row) =>
    row.blockNumber === first.blockNumber
    && row.blockHash === first.blockHash
    && row.status === first.status
    && (row.code ?? null) === (first.code ?? null));
  if (!agree) return { ...summary, final: false, code: 'RPC_DISAGREEMENT' };
  summary.quorum.agreeing = found.length;
  const confirmations = Math.min(...found.map((row) => row.confirmations));
  const facts = {
    blockNumber: first.blockNumber,
    blockHash: first.blockHash,
    receiptStatus: first.status,
    confirmations
  };
  if (confirmations < network.minConfirmations) {
    /* Even a deterministic-looking mismatch is not frozen before the
       confirmation floor: a shallow block can still reorg away. */
    return { ...summary, ...facts, final: false, code: 'INSUFFICIENT_CONFIRMATIONS' };
  }
  if (first.code) {
    /* Deterministic mined outcome every agreeing endpoint reports at full
       confirmation depth: storable rejection. */
    return { ...summary, ...facts, final: true, verdict: 'verification-rejected', rejectReason: first.code };
  }
  return { ...summary, ...facts, final: true, verdict: 'onchain-verified', rejectReason: null };
}

/* ----------------------- leg verification orchestration ------------------- */

function expectedFactsFor(state, receipt, fromBinding, toBinding) {
  return {
    txHash: receipt.txHash,
    native: receipt.token.native === true,
    tokenAddress: receipt.token.native ? null : receipt.token.address,
    amount: receipt.amount,
    fromAddress: fromBinding.address,
    toAddress: toBinding.address
  };
}

/**
 * Full leg verification: receipt vs plan, bindings vs plan and parties, then
 * quorum observation of the actual chain. Never mutates the stored receipt.
 */
export async function verifyLegOnChain({
  state,
  receipt,
  previousReceipts = [],
  fromBinding,
  toBinding,
  networks = parseCrossChainRpcNetworks(),
  rpc = defaultRpc,
  now = Date.now()
}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const plan = checkedState.state;
  const checkedReceipt = verifyCrossChainReceipt(receipt, { state: plan, previousReceipts });
  if (!checkedReceipt.ok) return checkedReceipt;
  const leg = checkedReceipt.receipt;
  const checkedFrom = verifyAccountBinding(fromBinding, { state: plan, now });
  if (!checkedFrom.ok) return checkedFrom;
  const checkedTo = verifyAccountBinding(toBinding, { state: plan, now });
  if (!checkedTo.ok) return checkedTo;
  if (checkedFrom.binding.partyId !== leg.fromPartyId
    || checkedTo.binding.partyId !== leg.toPartyId
    || checkedFrom.binding.chainId !== leg.chainId
    || checkedTo.binding.chainId !== leg.chainId) {
    return { ok: false, code: 'BINDING_LEG_MISMATCH' };
  }
  const network = networks.get(leg.chainId);
  if (!network) return { ok: false, code: 'VERIFICATION_CHAIN_NOT_CONFIGURED' };
  const observed = await observeLegAcrossRpcs({
    network,
    expected: expectedFactsFor(plan, leg, checkedFrom.binding, checkedTo.binding),
    rpc
  });
  return {
    ok: true,
    state: plan,
    receipt: leg,
    fromBinding: checkedFrom.binding,
    toBinding: checkedTo.binding,
    network: { chainId: network.chainId, minConfirmations: network.minConfirmations },
    result: observed
  };
}

/* --------------------------- verification reports ------------------------- */

function reportIdFor(core) {
  return sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function reportCore(input) {
  const { reportId: _reportId, signature: _signature, ...core } = input;
  return core;
}

/**
 * Structural + signature verification of a bounded report against the exact
 * state, receipt and bindings. This does NOT touch the network; recomputation
 * against live RPC happens separately so the two failure classes stay apart.
 */
export function verifyTxVerificationReport(input, {
  state,
  receipt,
  previousReceipts = [],
  fromBinding,
  toBinding,
  registry = new Map(),
  now = Date.now()
} = {}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const plan = checkedState.state;
  const checkedReceipt = verifyCrossChainReceipt(receipt, { state: plan, previousReceipts });
  if (!checkedReceipt.ok) return checkedReceipt;
  const leg = checkedReceipt.receipt;
  const checkedFrom = verifyAccountBinding(fromBinding, { state: plan, now });
  if (!checkedFrom.ok) return checkedFrom;
  const checkedTo = verifyAccountBinding(toBinding, { state: plan, now });
  if (!checkedTo.ok) return checkedTo;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT' };
  }
  if (Object.keys(input).some((key) => !REPORT_FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_VERIFICATION_REPORT_FIELD' };
  }
  if (input.schema !== TX_VERIFICATION_SCHEMA
    || !same(input.stateId, plan.stateId)
    || input.receiptId !== leg.receiptId
    || !CROSS_CHAIN_LEGS.includes(input.leg)
    || input.leg !== leg.leg
    || input.chainId !== leg.chainId
    || !sameCanonical(input.token, leg.token)
    || input.amount !== leg.amount
    || !same(input.txHash, leg.txHash)
    || input.fromPartyId !== leg.fromPartyId
    || input.toPartyId !== leg.toPartyId) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT_BINDING' };
  }
  if (input.fromAddress !== checkedFrom.binding.address
    || input.toAddress !== checkedTo.binding.address
    || input.fromBindingId !== checkedFrom.binding.bindingId
    || input.toBindingId !== checkedTo.binding.bindingId) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT_ADDRESSES' };
  }
  if (!Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0
    || !TX_RE_64.test(String(input.blockHash || ''))
    || !['success', 'failed'].includes(input.receiptStatus)
    || !Number.isSafeInteger(input.confirmations) || input.confirmations < 0
    || !Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1
    || input.minConfirmations > 128
    || !Number.isSafeInteger(input.verifiedAt) || input.verifiedAt <= 0
    || input.verifiedAt > Math.floor(now / 1000) + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT' };
  }
  if (!Array.isArray(input.observations) || input.observations.length < VERIFICATION_QUORUM
    || input.observations.length > MAX_OBSERVATIONS
    || input.observations.some((row) => !row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some((key) => !OBSERVATION_FIELDS.has(key)))) {
    return { ok: false, code: 'BAD_VERIFICATION_OBSERVATIONS' };
  }
  const quorum = input.quorum;
  if (!quorum || typeof quorum !== 'object' || Array.isArray(quorum)
    || Object.keys(quorum).some((key) => !['required', 'total', 'agreeing'].includes(key))
    || quorum.required !== VERIFICATION_QUORUM
    || !Number.isSafeInteger(quorum.total) || quorum.total !== input.observations.length
    || !Number.isSafeInteger(quorum.agreeing) || quorum.agreeing < VERIFICATION_QUORUM
    || quorum.agreeing > quorum.total) {
    return { ok: false, code: 'BAD_VERIFICATION_QUORUM' };
  }
  if (input.confirmations < input.minConfirmations) {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  if (input.verdict === 'onchain-verified') {
    if (input.rejectReason !== null || input.receiptStatus !== 'success') {
      return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
    }
  } else if (input.verdict === 'verification-rejected') {
    if (!FINAL_REJECT_REASONS.includes(input.rejectReason)) {
      return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
    }
  } else {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  const claims = input.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !REPORT_CLAIM_FIELDS.has(key))
    || claims.legOnChainVerified !== (input.verdict === 'onchain-verified')
    || claims.atomicSettlement !== false
    || claims.globalAtomicity !== false
    || claims.custody !== false
    || claims.providerIndependenceProven !== false) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT_CLAIMS' };
  }
  const verifier = input.verifier;
  if (!verifier || typeof verifier !== 'object' || Array.isArray(verifier)
    || Object.keys(verifier).some((key) => !['id', 'publicKey', 'algorithm'].includes(key))
    || !ID_RE.test(String(verifier.id || ''))
    || verifier.algorithm !== 'Ed25519'
    || !isValidEd25519PublicKey(verifier.publicKey)) {
    return { ok: false, code: 'BAD_VERIFICATION_VERIFIER' };
  }
  const registered = registry.get(verifier.id);
  if (!registered || registered.active === false || registered.publicKey !== verifier.publicKey) {
    return { ok: false, code: 'UNREGISTERED_VERIFIER' };
  }
  const core = reportCore(input);
  if (!TX_RE_64.test(String(input.reportId || '')) || reportIdFor(core) !== input.reportId) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT_ID' };
  }
  if (!verifyCanonicalSignature(
    TX_VERIFICATION_DOMAIN,
    { ...core, reportId: input.reportId },
    input.signature,
    verifier.publicKey
  )) {
    return { ok: false, code: 'VERIFICATION_SIGNATURE_MISMATCH' };
  }
  return { ok: true, report: input };
}

/**
 * Build a signed report in the verifier's own environment. The verifier does
 * its OWN RPC reads; a transient outcome refuses to sign anything.
 */
export async function buildTxVerificationReport({
  state,
  receipt,
  previousReceipts = [],
  fromBinding,
  toBinding,
  verifier,
  networks = parseCrossChainRpcNetworks(),
  rpc = defaultRpc,
  registry = new Map(),
  now = Date.now()
}, privateKey) {
  let publicKey;
  try { publicKey = publicKeyFromPrivateKey(privateKey); } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  const verifierId = String(verifier?.id || '').toLowerCase();
  if (!ID_RE.test(verifierId)) return { ok: false, code: 'BAD_VERIFICATION_VERIFIER' };
  const observed = await verifyLegOnChain({
    state, receipt, previousReceipts, fromBinding, toBinding, networks, rpc, now
  });
  if (!observed.ok) return observed;
  if (!observed.result.final) {
    return { ok: false, code: observed.result.code, result: observed.result };
  }
  const core = {
    schema: TX_VERIFICATION_SCHEMA,
    stateId: observed.state.stateId,
    receiptId: observed.receipt.receiptId,
    leg: observed.receipt.leg,
    chainId: observed.receipt.chainId,
    token: observed.receipt.token,
    amount: observed.receipt.amount,
    txHash: observed.receipt.txHash,
    fromPartyId: observed.receipt.fromPartyId,
    toPartyId: observed.receipt.toPartyId,
    fromAddress: observed.fromBinding.address,
    toAddress: observed.toBinding.address,
    fromBindingId: observed.fromBinding.bindingId,
    toBindingId: observed.toBinding.bindingId,
    blockNumber: observed.result.blockNumber,
    blockHash: observed.result.blockHash,
    receiptStatus: observed.result.receiptStatus,
    confirmations: observed.result.confirmations,
    minConfirmations: observed.network.minConfirmations,
    observations: observed.result.observations,
    quorum: observed.result.quorum,
    verifiedAt: Math.floor(now / 1000),
    verifier: { id: verifierId, publicKey, algorithm: 'Ed25519' },
    verdict: observed.result.verdict,
    rejectReason: observed.result.rejectReason,
    claims: {
      legOnChainVerified: observed.result.verdict === 'onchain-verified',
      atomicSettlement: false,
      globalAtomicity: false,
      custody: false,
      providerIndependenceProven: false
    }
  };
  const reportId = reportIdFor(core);
  let report;
  try {
    report = {
      ...core,
      reportId,
      signature: signCanonicalPayload(TX_VERIFICATION_DOMAIN, { ...core, reportId }, privateKey)
    };
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  const checked = verifyTxVerificationReport(report, {
    state, receipt, previousReceipts, fromBinding, toBinding,
    registry: registry.size ? registry : new Map([[verifierId, { id: verifierId, publicKey, active: true }]]),
    now
  });
  return checked.ok ? { ...checked, result: observed.result } : checked;
}

/**
 * Server-side recomputation: read the SAME chain facts through the server's
 * own configured endpoints and require the exact signed verdict to reproduce.
 * A report the server cannot recompute is refused, whatever its signature.
 */
export async function recomputeTxVerificationReport(report, {
  state,
  receipt,
  previousReceipts = [],
  fromBinding,
  toBinding,
  registry = new Map(),
  networks = parseCrossChainRpcNetworks(),
  rpc = defaultRpc,
  now = Date.now()
} = {}) {
  const checked = verifyTxVerificationReport(report, {
    state, receipt, previousReceipts, fromBinding, toBinding, registry, now
  });
  if (!checked.ok) return checked;
  const observed = await verifyLegOnChain({
    state, receipt, previousReceipts, fromBinding, toBinding, networks, rpc, now
  });
  if (!observed.ok) return observed;
  if (!observed.result.final) {
    return { ok: false, code: observed.result.code, transient: true };
  }
  const fresh = observed.result;
  if (fresh.verdict !== checked.report.verdict
    || (fresh.rejectReason ?? null) !== (checked.report.rejectReason ?? null)
    || fresh.blockNumber !== checked.report.blockNumber
    || fresh.blockHash !== checked.report.blockHash
    || fresh.receiptStatus !== checked.report.receiptStatus
    || fresh.confirmations < checked.report.minConfirmations
    || observed.network.minConfirmations !== checked.report.minConfirmations) {
    return { ok: false, code: 'VERIFICATION_NOT_RECOMPUTABLE' };
  }
  return { ok: true, report: checked.report, recomputed: fresh };
}

/* ------------------------------- persistence ------------------------------ */

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
  if (!mod) throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('CROSS_CHAIN_OBJECT_UNREADABLE');
    const value = await response.json();
    memory.set(path, value);
    return value;
  } catch {
    throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
  }
}

async function writeObject(path, value) {
  if (memory.has(path) || pending.has(path)) return { ok: false, duplicate: true };
  pending.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(value), {
          token: TOKEN,
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31536000
        });
      } catch {
        try {
          if (await readObject(path)) return { ok: false, duplicate: true };
        } catch {
          // Preserve the original write failure.
        }
        return { ok: false, code: 'CROSS_CHAIN_WRITE_FAILED' };
      }
    }
    memory.set(path, value);
    return { ok: true };
  } finally {
    pending.delete(path);
  }
}

async function listPrefix(prefix, schema) {
  const local = [...memory.entries()].filter(([key]) => key.startsWith(prefix)).map(([, row]) => row);
  const mod = await blob();
  if (!blobConfigured()) return local;
  if (!mod) throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
  try {
    const blobs = [];
    let cursor;
    do {
      const page = await mod.list({ prefix, limit: 100, cursor, token: TOKEN });
      blobs.push(...(page?.blobs || []));
      if (page?.hasMore && !page.cursor) throw new Error('CROSS_CHAIN_CURSOR_MISSING');
      cursor = page?.hasMore ? page.cursor : undefined;
    } while (cursor);
    const remote = await Promise.all(blobs.map(async (item) => {
      const response = await fetch(item.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('CROSS_CHAIN_OBJECT_UNREADABLE');
      const row = await response.json();
      if (row?.schema !== schema || row.path !== item.pathname) {
        throw new Error('INVALID_STORED_CROSS_CHAIN_OBJECT');
      }
      return row;
    }));
    return [...new Map([...remote, ...local].map((row) => [row.path, row])).values()];
  } catch {
    throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
  }
}

/** Store one immutable binding per (party, chain) per state. */
export async function storeAccountBinding(stateId, binding, { now = Date.now() } = {}) {
  const current = await readCrossChainState(stateId, { now });
  if (current.error) return { ok: false, code: current.error };
  const checked = verifyAccountBinding(binding, { state: current.state, now });
  if (!checked.ok) return checked;
  const path = bindingPath(current.state.stateId, checked.binding.partyId, checked.binding.chainId);
  try {
    const existing = await readObject(path);
    if (existing) {
      return sameCanonical(existing.binding, checked.binding)
        ? { ok: true, alreadyStored: true, binding: existing.binding }
        : { ok: false, code: 'ACCOUNT_BINDING_CONFLICT' };
    }
    const record = {
      schema: 'fbt.cross-chain-account-binding-record.v1',
      path,
      storedAt: now,
      binding: checked.binding
    };
    const stored = await writeObject(path, record);
    if (!stored.ok) {
      if (!stored.duplicate) return stored;
      const concurrent = await readObject(path);
      return concurrent && sameCanonical(concurrent.binding, checked.binding)
        ? { ok: true, alreadyStored: true, binding: concurrent.binding }
        : { ok: false, code: 'ACCOUNT_BINDING_CONFLICT' };
    }
    return { ok: true, alreadyStored: false, binding: checked.binding };
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

export async function readAccountBindings(stateId) {
  const id = TX_RE_64.test(String(stateId || '')) ? String(stateId).toLowerCase() : null;
  if (!id) return { error: 'BAD_CROSS_CHAIN_STATE_ID' };
  try {
    const rows = await listPrefix(`${PREFIX}bindings/${id.slice(2)}/`, 'fbt.cross-chain-account-binding-record.v1');
    return {
      bindings: rows.map((row) => row.binding)
        .sort((a, b) => `${a.partyId}:${a.chainId}`.localeCompare(`${b.partyId}:${b.chainId}`))
    };
  } catch {
    return { error: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

async function storedBindingFor(stateId, partyId, chainId) {
  return readObject(bindingPath(stateId, partyId, chainId));
}

/**
 * Server-side admission of a signed verification report. Registry check,
 * binding re-verification, independent RPC recomputation, then immutable
 * storage. Anything transient answers with a retryable code and stores
 * nothing.
 */
export async function storeTxVerificationReport(stateId, report, {
  registry = new Map(),
  networks = parseCrossChainRpcNetworks(),
  rpc = defaultRpc,
  now = Date.now()
} = {}) {
  const current = await readCrossChainState(stateId, { now });
  if (current.error) return { ok: false, code: current.error };
  const leg = CROSS_CHAIN_LEGS.includes(report?.leg)
    ? current.receipts.find((row) => row.leg === report.leg) : null;
  if (!leg || leg.receiptId !== report?.receiptId) {
    return { ok: false, code: 'VERIFICATION_RECEIPT_NOT_FOUND' };
  }
  const previousReceipts = leg.leg === 'source-transfer'
    ? [] : current.receipts.filter((row) => row.leg === 'source-transfer');
  let fromRecord;
  let toRecord;
  try {
    [fromRecord, toRecord] = await Promise.all([
      storedBindingFor(current.state.stateId, leg.fromPartyId, leg.chainId),
      storedBindingFor(current.state.stateId, leg.toPartyId, leg.chainId)
    ]);
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
  if (!fromRecord || !toRecord) return { ok: false, code: 'ACCOUNT_BINDING_NOT_FOUND' };
  const path = reportPath(current.state.stateId, leg.leg, report?.reportId || '0x0');
  try {
    const existing = TX_RE_64.test(String(report?.reportId || '')) ? await readObject(path) : null;
    if (existing) {
      return sameCanonical(existing.report, report)
        ? { ok: true, alreadyStored: true, report: existing.report }
        : { ok: false, code: 'VERIFICATION_REPORT_CONFLICT' };
    }
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
  const recomputed = await recomputeTxVerificationReport(report, {
    state: current.state,
    receipt: leg,
    previousReceipts,
    fromBinding: fromRecord.binding,
    toBinding: toRecord.binding,
    registry,
    networks,
    rpc,
    now
  });
  if (!recomputed.ok) return recomputed;
  const record = {
    schema: 'fbt.cross-chain-tx-verification-record.v1',
    path,
    storedAt: now,
    report: recomputed.report
  };
  try {
    const stored = await writeObject(path, record);
    if (!stored.ok && !stored.duplicate) return stored;
    return { ok: true, alreadyStored: Boolean(stored.duplicate), report: recomputed.report };
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

export async function readTxVerificationReports(stateId) {
  const id = TX_RE_64.test(String(stateId || '')) ? String(stateId).toLowerCase() : null;
  if (!id) return { error: 'BAD_CROSS_CHAIN_STATE_ID' };
  try {
    const rows = await listPrefix(`${PREFIX}verifications/${id.slice(2)}/`, 'fbt.cross-chain-tx-verification-record.v1');
    return {
      reports: rows.map((row) => row.report)
        .sort((a, b) => `${a.leg}:${a.reportId}`.localeCompare(`${b.leg}:${b.reportId}`))
    };
  } catch {
    return { error: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

/* --------------------------- derived public view -------------------------- */

/**
 * Pure derivation of one leg's verification status. `attempt` may carry the
 * transient outcome of the most recent live check so callers can surface
 * 'rpc-disagreement' / 'confirmations-pending' without ever storing them.
 */
export function deriveLegVerificationStatus({
  reports = [],
  networkConfigured = false,
  attempt = null
} = {}) {
  const verified = reports.find((row) => row.verdict === 'onchain-verified');
  if (verified) return { status: 'onchain-verified', reportId: verified.reportId, rejectReason: null };
  const rejected = reports.find((row) => row.verdict === 'verification-rejected');
  if (rejected) {
    return { status: 'verification-rejected', reportId: rejected.reportId, rejectReason: rejected.rejectReason };
  }
  if (attempt === 'RPC_DISAGREEMENT') return { status: 'rpc-disagreement', reportId: null, rejectReason: null };
  if (attempt === 'INSUFFICIENT_CONFIRMATIONS') {
    return { status: 'confirmations-pending', reportId: null, rejectReason: null };
  }
  if (networkConfigured) return { status: 'verification-pending', reportId: null, rejectReason: null };
  return { status: 'signed-only', reportId: null, rejectReason: null };
}

/**
 * Public cross-chain state extended with bindings + derived verification.
 * The historical fbt.cross-chain-state.v1 / leg receipts are returned exactly
 * as stored; verification lives ONLY in this derived block. Two verified
 * transactions are still two separate transactions, so every atomicity/
 * custody flag stays pinned false here too.
 */
export async function readCrossChainStateWithVerification(stateId, {
  networks = parseCrossChainRpcNetworks(),
  now = Date.now()
} = {}) {
  const base = await readCrossChainState(stateId, { now });
  if (base.error) return base;
  const [bindings, reports] = await Promise.all([
    readAccountBindings(base.state.stateId),
    readTxVerificationReports(base.state.stateId)
  ]);
  if (bindings.error) return { error: bindings.error };
  if (reports.error) return { error: reports.error };
  const legVerification = {};
  for (const receipt of base.receipts) {
    legVerification[receipt.leg] = deriveLegVerificationStatus({
      reports: reports.reports.filter((row) => row.receiptId === receipt.receiptId),
      networkConfigured: networks.has(receipt.chainId)
    });
  }
  const submitted = base.receipts.length;
  const allVerified = submitted > 0
    && base.receipts.every((receipt) => legVerification[receipt.leg]?.status === 'onchain-verified');
  return {
    ...base,
    accountBindings: bindings.bindings,
    verificationReports: reports.reports,
    legVerification,
    allSubmittedLegsOnChainVerified: allVerified,
    /* Even with every submitted leg verified, nothing here became atomic:
       these remain independent transactions on independent chains. */
    atomic: false,
    globalAtomicity: false,
    custody: false,
    escrow: false,
    automaticSettlement: false,
    refundEnforcedByFbt: false
  };
}
