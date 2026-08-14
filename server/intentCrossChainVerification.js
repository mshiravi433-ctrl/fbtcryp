/**
 * Phase 4c — independent multi-RPC verification of cross-chain legs.
 * --------------------------------------------------------------------------
 * A Phase 4b fbt.cross-chain-leg-receipt.v1 is a SIGNED PARTY CLAIM: the
 * txHash inside it is what the party says happened, so the receipt honestly
 * carries onChainVerified:false forever. This module adds a separate,
 * derived verification layer that actually reads the chain:
 *
 *   1. fbt.cross-chain-account-binding.v1 — a party binds an on-chain
 *      address to the SAME Ed25519 key pinned in the state. A binding may
 *      additionally carry an EIP-191 wallet proof: a deterministic challenge
 *      (domain + schema + stateId + partyId + chainId + address + Ed25519
 *      public key + issuedAt + expiresAt + nonce) signed with
 *      personal_sign by the address owner. The server verifies it with
 *      ethers.verifyMessage and requires the recovered address to equal the
 *      bound address. A binding WITHOUT a wallet proof is storable as a
 *      signed self-assertion (claims say exactly that) but is never enough
 *      for onchain-verified. EIP-1271 (smart-contract wallets) is NOT
 *      implemented and is explicitly rejected — no fake fallback exists.
 *   2. fbt.cross-chain-tx-verification.v1 — a registered verifier reads the
 *      transaction from at least two https RPC endpoints with distinct
 *      hostnames (per-network quorum, minimum 2), checks exact transfer
 *      facts against the immutable plan and the signed bindings, and signs a
 *      bounded report. The server refuses to store any report it cannot
 *      recompute from its own RPC reads, and the stored record carries the
 *      server-side serverRecomputedBeforeStorage attestation.
 *
 * Fail-closed by design: RPC disagreement, reorg/block drift, a failed
 * receipt, a missing transaction, insufficient confirmations, a wrong token
 * contract/sender/recipient/amount, an ambiguous Transfer event, an expired
 * or mis-keyed binding, an invalid wallet proof, or fewer than the required
 * number of agreeing endpoints all refuse verification. An outage is an
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
import { Interface, getAddress, isAddress, verifyMessage } from 'ethers';
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
export const WALLET_CHALLENGE_DOMAIN = 'fbt.cross-chain-account-binding.v1/wallet-challenge';
export const TX_VERIFICATION_SCHEMA = 'fbt.cross-chain-tx-verification.v1';
export const TX_VERIFICATION_DOMAIN = 'fbt.cross-chain-tx-verification.v1/signature';
/** Absolute floor for every per-network quorum. */
export const MIN_VERIFICATION_QUORUM = 2;
export const MAX_RPC_PROVIDERS = 8;
export const MAX_OBSERVATIONS = MAX_RPC_PROVIDERS;
export const MAX_REPORTS_PER_RECEIPT = 3;
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;
export const MAX_RPC_RESPONSE_CHARS = 512 * 1024;
export const MAX_RECEIPT_LOGS = 256;
export const MAX_LOG_DATA_CHARS = 16 * 1024;
/** Deterministic on-chain outcomes a signed rejection may carry. Anything
 *  transient (outage, missing tx, drift, pending confirmations) is refused
 *  as a FINAL verdict and may only be stored as an honest transient
 *  snapshot that never counts as verified. */
export const FINAL_REJECT_REASONS = Object.freeze([
  'TX_RECEIPT_FAILED', 'WRONG_TOKEN_CONTRACT', 'MALFORMED_TRANSFER_EVENT',
  'WRONG_SENDER', 'WRONG_RECIPIENT', 'WRONG_AMOUNT', 'AMBIGUOUS_TRANSFER_EVENT'
]);
export const TRANSIENT_VERIFICATION_CODES = Object.freeze([
  'RPC_QUORUM_UNAVAILABLE', 'RPC_DISAGREEMENT', 'REORG_DETECTED',
  'TX_NOT_FOUND', 'INSUFFICIENT_CONFIRMATIONS'
]);
/** The honest per-leg status ladder. `verification-rejected` and
 *  `onchain-verified` are terminal; everything else is progress or a
 *  transient observation and never counts as verified. */
export const LEG_VERIFICATION_STATUSES = Object.freeze([
  'signed-only', 'binding-required', 'wallet-proof-required',
  'verification-pending', 'confirmations-pending', 'rpc-disagreement',
  'reorg-detected', 'verification-unavailable', 'verification-rejected',
  'onchain-verified'
]);
export const REPORT_VERDICTS = Object.freeze([
  'onchain-verified', 'verification-rejected', 'confirmations-pending',
  'rpc-disagreement', 'reorg-detected', 'verification-unavailable'
]);

const BINDING_ID_DOMAIN = 'fbt.cross-chain-account-binding.v1/id';
const REPORT_ID_DOMAIN = 'fbt.cross-chain-tx-verification.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const NONCE_RE = /^[A-Za-z0-9._-]{0,64}$/;
const WALLET_SIG_RE = /^0x[0-9a-fA-F]{128,132}$/;
const CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const MAX_BINDING_SECONDS = 366 * 86400;
const MAX_CLOCK_SKEW_SECONDS = 300;
const TRANSFER_IFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
const TRANSFER_TOPIC = TRANSFER_IFACE.getEvent('Transfer').topicHash;

const BINDING_FIELDS = new Set([
  'schema', 'stateId', 'partyId', 'chainId', 'address', 'partyPublicKey',
  'issuedAt', 'expiresAt', 'walletProof', 'claims', 'bindingId', 'signature'
]);
const BINDING_CLAIM_FIELDS = new Set([
  'addressControlSelfAttested', 'walletSignatureScheme',
  'walletSignatureVerified', 'fundsAuthorityGranted', 'custody'
]);
const WALLET_PROOF_FIELDS = new Set(['scheme', 'nonce', 'signature']);
const REPORT_FIELDS = new Set([
  'schema', 'stateId', 'receiptId', 'leg', 'chainId', 'token', 'amount',
  'txHash', 'fromPartyId', 'toPartyId', 'fromAddress', 'toAddress',
  'fromBindingId', 'toBindingId', 'blockNumber', 'blockHash', 'receiptStatus',
  'confirmations', 'minConfirmations', 'observations', 'quorum', 'verdict',
  'reasonCodes', 'evaluatedAt', 'verifier', 'claims', 'verificationId',
  'signature'
]);
const REPORT_CLAIM_FIELDS = new Set([
  'serverRecomputedBeforeStorage', 'multiRpcQuorumReached',
  'walletBindingsVerified', 'transactionObservedOnChain', 'atomicSettlement',
  'globalAtomicity', 'custody', 'escrow', 'automaticSettlement',
  'providerIndependenceProven'
]);
const OBSERVATION_FIELDS = new Set([
  'index', 'ok', 'code', 'blockNumber', 'blockHash', 'status', 'confirmations'
]);
const QUORUM_FIELDS = new Set(['required', 'total', 'agreeing']);
const VERIFIER_FIELDS = new Set(['id', 'publicKey', 'algorithm']);

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-cross-chain/v1/';
const memory = new Map();
const pending = new Set();
let blobApi = null;
let blobOverride = null;

/** Test-only hook: inject a blob client so outage paths can be exercised
 *  without touching the real store. Never used by the server itself. */
export function __overrideBlobForTests(client = null) {
  blobOverride = client;
}

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const bindingPath = (stateId, partyId, chainId) =>
  `${PREFIX}bindings/${String(stateId).slice(2)}/${partyId}-${chainId}.json`;
const reportPath = (stateId, leg, verificationId) =>
  `${PREFIX}verifications/${String(stateId).slice(2)}/${leg}-${String(verificationId).slice(2)}.json`;

function sameCanonical(a, b) {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));
}

export function verdictForTransientCode(code) {
  if (code === 'INSUFFICIENT_CONFIRMATIONS') return 'confirmations-pending';
  if (code === 'RPC_DISAGREEMENT') return 'rpc-disagreement';
  if (code === 'REORG_DETECTED') return 'reorg-detected';
  if (code === 'RPC_QUORUM_UNAVAILABLE' || code === 'TX_NOT_FOUND') {
    return 'verification-unavailable';
  }
  return null;
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

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;

/**
 * Server-only RPC configuration.
 *
 * Spec format (quorum + named providers):
 *   [{"chainId":8453,"quorum":2,"minConfirmations":12,"providers":[
 *      {"id":"base-provider-a","rpcUrl":"https://..."},
 *      {"id":"base-provider-b","rpcUrl":"https://..."}]}]
 *
 * The legacy `rpcUrls: [url, ...]` shape is still accepted for
 * compatibility. A chain counts as configured ONLY with at least two https
 * endpoints on distinct hostnames, a quorum >= 2 that never exceeds the
 * provider count, and bounded providers. The parsed URLs never leave this
 * process: public status exposes counts, never endpoints.
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
      const providers = [];
      const seen = new Set();
      const addProvider = (id, url) => {
        if (providers.length >= MAX_RPC_PROVIDERS) return;
        const parsed = safeHttpsUrl(url);
        if (!parsed) return;
        const canonicalUrl = parsed.toString();
        if (seen.has(canonicalUrl)) return;
        const providerId = String(id || `provider-${providers.length + 1}`).toLowerCase();
        if (!PROVIDER_ID_RE.test(providerId)) return;
        if (providers.some((row) => row.id === providerId)) return;
        seen.add(canonicalUrl);
        providers.push({ id: providerId, rpcUrl: canonicalUrl });
      };
      if (Array.isArray(row?.providers)) {
        for (const provider of row.providers.slice(0, MAX_RPC_PROVIDERS)) {
          addProvider(provider?.id, provider?.rpcUrl);
        }
      } else if (Array.isArray(row?.rpcUrls)) {
        for (const url of row.rpcUrls.slice(0, MAX_RPC_PROVIDERS)) addProvider(null, url);
      }
      const hosts = new Set(providers.map((provider) => {
        try { return new URL(provider.rpcUrl).hostname.toLowerCase(); } catch { return ''; }
      }));
      if (providers.length < MIN_VERIFICATION_QUORUM || hosts.size < MIN_VERIFICATION_QUORUM) continue;
      const quorum = Number.isInteger(row.quorum) ? row.quorum : MIN_VERIFICATION_QUORUM;
      /* quorum must be >= 2 and never exceed the provider count — an invalid
         quorum refuses the chain (fail-closed), it is never silently changed. */
      if (!Number.isInteger(quorum) || quorum < MIN_VERIFICATION_QUORUM || quorum > providers.length) continue;
      const minConfirmations = Number.isInteger(row.minConfirmations)
        ? Math.max(1, Math.min(128, row.minConfirmations)) : 3;
      networks.set(chainId, {
        chainId,
        name: String(row.name || `Chain ${chainId}`).replace(/[<>"'`\\]/g, '').slice(0, 60),
        quorum,
        minConfirmations,
        providers,
        rpcUrls: providers.map((provider) => provider.rpcUrl),
        distinctRpcHosts: hosts.size
      });
    }
    return networks;
  } catch {
    return new Map();
  }
}

/** Public capability view. No URL, no hostname, no provider name leaves the server. */
export function crossChainVerificationStatus(networks = parseCrossChainRpcNetworks()) {
  const configured = networks.size > 0;
  return {
    schema: TX_VERIFICATION_SCHEMA,
    accountBindingSchema: ACCOUNT_BINDING_SCHEMA,
    bindingSchema: ACCOUNT_BINDING_SCHEMA,
    verificationSchema: TX_VERIFICATION_SCHEMA,
    available: true,
    configured,
    /* EIP-191 personal_sign wallet proofs are verified for EOAs. EIP-1271
       (smart-contract wallets) is NOT implemented: it is explicitly
       unsupported and no fallback exists. */
    walletProof: 'EIP-191',
    eip1271Supported: false,
    multiRpcRequired: true,
    minimumQuorum: MIN_VERIFICATION_QUORUM,
    configuredChains: networks.size,
    chains: [...networks.values()].map((row) => ({
      chainId: row.chainId,
      name: row.name,
      providers: row.providers.length,
      distinctRpcHosts: row.distinctRpcHosts,
      quorum: row.quorum,
      minConfirmations: row.minConfirmations
    })),
    rpcUrlsPublished: false,
    /* Distinct hostnames are a plumbing requirement, not an audit. Two URLs
       can still resolve to one operator, so independence is never claimed. */
    providerIndependenceProven: false,
    serverRecomputesBeforeStorage: true,
    onChainTxVerification: configured,
    atomic: false,
    custody: false,
    /* Legacy field names kept for clients of the 1.35.0 release. */
    multiRpcConfigured: configured,
    quorumRequired: MIN_VERIFICATION_QUORUM,
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
 * Deterministic EIP-191 challenge that binds the binding core to the
 * wallet: domain, schema, stateId, partyId, chainId, address, the party's
 * pinned Ed25519 public key, issuedAt, expiresAt and a nonce/challenge id.
 * The message is fully recomputable from the signed binding itself.
 */
export function buildAccountBindingChallenge({
  state,
  partyId,
  chainId,
  address,
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt,
  nonce = ''
}, { now = Date.now() } = {}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const plan = checkedState.state;
  const party = ID_RE.test(String(partyId || '')) ? partyInState(plan, String(partyId).toLowerCase()) : null;
  if (!party) return { ok: false, code: 'UNKNOWN_BINDING_PARTY' };
  let checksummed;
  try { checksummed = getAddress(String(address || '')); } catch {
    return { ok: false, code: 'BAD_BINDING_ADDRESS' };
  }
  const chain = Number(chainId);
  if (!Number.isInteger(chain) || !CHAINS.has(chain)
    || ![plan.source.chainId, plan.destination.chainId].includes(chain)) {
    return { ok: false, code: 'BAD_BINDING_CHAIN' };
  }
  const issued = Number(issuedAt);
  const expires = Number(expiresAt);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)
    || expires <= issued || expires - issued > MAX_BINDING_SECONDS
    || issued > nowSeconds + MAX_CLOCK_SKEW_SECONDS || expires <= nowSeconds) {
    return { ok: false, code: 'BAD_BINDING_WINDOW' };
  }
  if (!NONCE_RE.test(String(nonce))) return { ok: false, code: 'BAD_WALLET_PROOF_NONCE' };
  const core = {
    schema: ACCOUNT_BINDING_SCHEMA,
    stateId: plan.stateId,
    partyId: party.id,
    chainId: chain,
    address: checksummed,
    partyPublicKey: party.publicKey,
    issuedAt: issued,
    expiresAt: expires,
    nonce: String(nonce)
  };
  const message = `${WALLET_CHALLENGE_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`;
  return { ok: true, challenge: { ...core, domain: WALLET_CHALLENGE_DOMAIN, message } };
}

function challengeMessageFor(core, walletProof) {
  return `${WALLET_CHALLENGE_DOMAIN}\n${JSON.stringify(canonicalValue({
    schema: core.schema,
    stateId: core.stateId,
    partyId: core.partyId,
    chainId: core.chainId,
    address: core.address,
    partyPublicKey: core.partyPublicKey,
    issuedAt: core.issuedAt,
    expiresAt: core.expiresAt,
    nonce: walletProof?.nonce ?? ''
  }))}`;
}

/**
 * Real EIP-191 verification: recover the signer of the deterministic
 * challenge with ethers.verifyMessage and require the exact bound address.
 * The wallet private key is never requested or received — only the public
 * signature over the public challenge is checked.
 */
function verifyWalletProof(core, walletProof, address) {
  if (!walletProof || typeof walletProof !== 'object' || Array.isArray(walletProof)) {
    return { ok: false, code: 'BAD_WALLET_PROOF' };
  }
  if (Object.keys(walletProof).some((key) => !WALLET_PROOF_FIELDS.has(key))) {
    return { ok: false, code: 'BAD_WALLET_PROOF' };
  }
  if (walletProof.scheme === 'EIP-1271') {
    /* Smart-contract wallet verification is NOT implemented. Explicitly
       unsupported: nothing here pretends to verify a 1271 callback. */
    return { ok: false, code: 'WALLET_PROOF_SCHEME_UNSUPPORTED' };
  }
  if (walletProof.scheme !== 'EIP-191') return { ok: false, code: 'BAD_WALLET_PROOF' };
  if (!NONCE_RE.test(String(walletProof.nonce ?? ''))) {
    return { ok: false, code: 'BAD_WALLET_PROOF_NONCE' };
  }
  if (!WALLET_SIG_RE.test(String(walletProof.signature || ''))) {
    return { ok: false, code: 'BAD_WALLET_PROOF' };
  }
  let recovered;
  try {
    recovered = verifyMessage(challengeMessageFor(core, walletProof), walletProof.signature);
  } catch {
    return { ok: false, code: 'WALLET_PROOF_INVALID' };
  }
  if (!same(recovered, address)) return { ok: false, code: 'WALLET_PROOF_INVALID' };
  return { ok: true };
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
  /* The pinned party key must appear under partyPublicKey, be a strict
     32-byte canonical base64url Ed25519 public key, and match the state. */
  if (input.partyPublicKey !== party.publicKey || !isValidEd25519PublicKey(input.partyPublicKey)) {
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
    || claims.fundsAuthorityGranted !== false
    || claims.custody !== false) {
    return { ok: false, code: 'BAD_ACCOUNT_BINDING_CLAIMS' };
  }
  const walletProof = input.walletProof;
  const hasWalletProof = walletProof !== null && walletProof !== undefined;
  if (!hasWalletProof) {
    if (claims.walletSignatureVerified !== false || claims.walletSignatureScheme !== null) {
      return { ok: false, code: 'BAD_ACCOUNT_BINDING_CLAIMS' };
    }
  } else {
    const proof = verifyWalletProof({
      schema: input.schema,
      stateId: input.stateId,
      partyId: input.partyId,
      chainId: input.chainId,
      address: input.address,
      partyPublicKey: input.partyPublicKey,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt
    }, walletProof, input.address);
    if (!proof.ok) return proof;
    /* A verified wallet proof upgrades the claims exactly as defined. */
    if (claims.walletSignatureVerified !== true || claims.walletSignatureScheme !== 'EIP-191') {
      return { ok: false, code: 'BAD_ACCOUNT_BINDING_CLAIMS' };
    }
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

/** Build a binding in the party's own environment. Key stays CLI-side. The
 *  optional walletProof is the EIP-191 signature over the deterministic
 *  challenge from buildAccountBindingChallenge. */
export function buildAccountBinding({
  state,
  partyId,
  chainId,
  address,
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt,
  walletProof = null
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
  const hasWalletProof = walletProof !== null && walletProof !== undefined;
  let checkedProof = null;
  const core = {
    schema: ACCOUNT_BINDING_SCHEMA,
    stateId: checkedState.state.stateId,
    partyId: party.id,
    chainId: Number(chainId),
    address: checksummed,
    partyPublicKey: party.publicKey,
    issuedAt: Number(issuedAt),
    expiresAt: Number(expiresAt),
    walletProof: null,
    claims: {
      addressControlSelfAttested: true,
      walletSignatureScheme: hasWalletProof ? 'EIP-191' : null,
      walletSignatureVerified: hasWalletProof,
      fundsAuthorityGranted: false,
      custody: false
    }
  };
  if (hasWalletProof) {
    core.walletProof = {
      scheme: String(walletProof?.scheme || 'EIP-191'),
      nonce: String(walletProof?.nonce ?? ''),
      signature: String(walletProof?.signature || '')
    };
    checkedProof = verifyWalletProof({
      schema: core.schema,
      stateId: core.stateId,
      partyId: core.partyId,
      chainId: core.chainId,
      address: core.address,
      partyPublicKey: core.partyPublicKey,
      issuedAt: core.issuedAt,
      expiresAt: core.expiresAt
    }, core.walletProof, core.address);
    if (!checkedProof.ok) return checkedProof;
  }
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

export async function defaultRpc(url, method, params, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal
    });
    /* Never quote the URL back — RPC endpoints are server secrets. */
    if (!response.ok) throw new Error('RPC_HTTP_ERROR');
    /* Response size is bounded before parsing: a raw unlimited receipt body
       is never kept or stored. */
    const text = await response.text();
    if (text.length > MAX_RPC_RESPONSE_CHARS) throw new Error('RPC_RESPONSE_TOO_LARGE');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('RPC_MALFORMED_RESPONSE');
    }
    if (!body || typeof body !== 'object' || body.error) throw new Error('RPC_ERROR');
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
    if (!Array.isArray(log?.topics) || log.topics.length !== 3 || !same(log.topics[0], TRANSFER_TOPIC)) {
      return null;
    }
    if (typeof log.data !== 'string' || log.data.length > MAX_LOG_DATA_CHARS) return null;
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

/** Bounded, strict receipt shape: status, blockNumber, blockHash and a
 *  bounded logs array are mandatory; anything else is unusable evidence. */
function normalizeReceipt(receipt, expectedTxHash) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  if (!TX_RE_64.test(String(receipt.transactionHash || ''))
    || !same(receipt.transactionHash, expectedTxHash)) return null;
  const blockNumber = hexInt(receipt.blockNumber);
  const blockHash = TX_RE_64.test(String(receipt.blockHash || '')) ? String(receipt.blockHash).toLowerCase() : null;
  const status = ['0x0', '0x1'].includes(String(receipt.status).toLowerCase())
    ? String(receipt.status).toLowerCase() : null;
  if (blockNumber == null || !blockHash || !status) return null;
  const logs = Array.isArray(receipt.logs) ? receipt.logs.slice(0, MAX_RECEIPT_LOGS) : [];
  if (!Array.isArray(receipt.logs) || receipt.logs.length > MAX_RECEIPT_LOGS) return null;
  for (const log of logs) {
    if (!log || typeof log !== 'object' || Array.isArray(log)) return null;
    if (!Array.isArray(log.topics) || log.topics.length > 4) return null;
    if (typeof log.data !== 'string' || log.data.length > MAX_LOG_DATA_CHARS) return null;
  }
  return { status, blockNumber, blockHash, logs };
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
  const checked = normalizeReceipt(receipt, expected.txHash);
  if (!checked) return { index, ok: true, code: 'TX_NOT_FOUND' };
  const confirmations = latestBlock >= checked.blockNumber
    ? Number(latestBlock - checked.blockNumber + 1n) : 0;
  /* Reorg check at the single endpoint level: the transaction object must
     agree with the receipt on block identity when it names one. */
  if (tx && typeof tx === 'object' && !Array.isArray(tx)
    && TX_RE_64.test(String(tx.blockHash || ''))
    && !same(tx.blockHash, checked.blockHash)) {
    return {
      index, ok: true, code: 'REORG_DETECTED', status: 'success',
      blockNumber: Number(checked.blockNumber), blockHash: checked.blockHash,
      confirmations
    };
  }
  const base = {
    index,
    ok: true,
    code: null,
    blockNumber: Number(checked.blockNumber),
    blockHash: checked.blockHash,
    confirmations
  };
  if (checked.status !== '0x1') {
    return { ...base, code: 'TX_RECEIPT_FAILED', status: 'failed' };
  }
  if (expected.native) {
    let txFrom;
    let txTo;
    try {
      txFrom = getAddress(String(tx?.from || ''));
      txTo = getAddress(String(tx?.to || ''));
    } catch {
      return { ...base, code: 'WRONG_RECIPIENT', status: 'success' };
    }
    if (txFrom !== expected.fromAddress) return { ...base, code: 'WRONG_SENDER', status: 'success' };
    if (txTo !== expected.toAddress) return { ...base, code: 'WRONG_RECIPIENT', status: 'success' };
    const value = hexInt(tx?.value);
    if (value == null || value !== BigInt(expected.amount)) {
      return { ...base, code: 'WRONG_AMOUNT', status: 'success' };
    }
    return { ...base, status: 'success' };
  }
  /* ERC-20: the Transfer event must come from EXACTLY the planned token
     contract and carry exactly the planned sender, recipient and amount.
     Fee-on-transfer/rebasing tokens surface as WRONG_AMOUNT here — they are
     never verified without an explicit policy, and ambiguous duplicate
     events are rejected rather than guessed. */
  const tokenLogs = checked.logs.filter((log) => !log?.removed && same(log?.address, expected.tokenAddress));
  const transfers = tokenLogs.map(decodeTransferLog).filter(Boolean);
  /* A Transfer-shaped event from any OTHER contract is never accepted, and
     a log at the right contract that does not decode as a standard Transfer
     is malformed evidence — fail closed, never guessed. */
  if (!tokenLogs.length) return { ...base, code: 'WRONG_TOKEN_CONTRACT', status: 'success' };
  if (!transfers.length) return { ...base, code: 'MALFORMED_TRANSFER_EVENT', status: 'success' };
  const fromMatches = transfers.filter((row) => row.from === expected.fromAddress);
  if (!fromMatches.length) return { ...base, code: 'WRONG_SENDER', status: 'success' };
  const toMatches = fromMatches.filter((row) => row.to === expected.toAddress);
  if (!toMatches.length) return { ...base, code: 'WRONG_RECIPIENT', status: 'success' };
  const exact = toMatches.filter((row) => row.value === BigInt(expected.amount));
  if (exact.length !== 1) {
    return exact.length === 0
      ? { ...base, code: 'WRONG_AMOUNT', status: 'success' }
      : { ...base, code: 'AMBIGUOUS_TRANSFER_EVENT', status: 'success' };
  }
  return { ...base, status: 'success' };
}

const observationSummary = (row) => ({
  index: row.index,
  ok: row.ok,
  code: row.code ?? null,
  blockNumber: row.blockNumber ?? null,
  blockHash: row.blockHash ?? null,
  status: row.status ?? null,
  confirmations: row.confirmations ?? null
});

/**
 * Observe one leg across every configured endpoint and derive the quorum
 * outcome. `final: true` marks a deterministic verdict a signed report may
 * carry as terminal; transient outcomes are honest snapshots that never
 * count as verified.
 */
export async function observeLegAcrossRpcs({ network, expected, rpc = defaultRpc }) {
  const quorumRequired = Math.max(MIN_VERIFICATION_QUORUM,
    Math.min(MAX_OBSERVATIONS, Number.isInteger(network?.quorum) ? network.quorum : MIN_VERIFICATION_QUORUM));
  const observations = await Promise.all(
    network.rpcUrls.slice(0, MAX_OBSERVATIONS).map((url, index) =>
      observeEndpoint({ url, index, expected, rpc }))
  );
  const reachable = observations.filter((row) => row.ok);
  const found = reachable.filter((row) => row.code !== 'TX_NOT_FOUND');
  const summary = {
    observations: observations.map(observationSummary),
    quorum: { required: quorumRequired, total: observations.length, agreeing: 0 }
  };
  if (reachable.length < quorumRequired) {
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
  /* Reorg classification: the same transaction observed in different blocks,
     with different canonical block hashes, or with a transaction/receipt
     block mismatch on any endpoint is a reorg, not a quorum. */
  if (found.some((row) => row.code === 'REORG_DETECTED')
    || found.some((row) => row.blockNumber !== first.blockNumber)) {
    return { ...summary, final: false, code: 'REORG_DETECTED' };
  }
  if (found.some((row) => row.blockHash !== first.blockHash)) {
    return { ...summary, final: false, code: 'REORG_DETECTED' };
  }
  const agree = found.every((row) =>
    row.status === first.status && (row.code ?? null) === (first.code ?? null));
  if (!agree) return { ...summary, final: false, code: 'RPC_DISAGREEMENT' };
  if (found.length < quorumRequired) {
    return { ...summary, final: false, code: 'RPC_QUORUM_UNAVAILABLE' };
  }
  summary.quorum.agreeing = found.length;
  const confirmations = Math.min(...found.map((row) => row.confirmations));
  const facts = {
    blockNumber: first.blockNumber,
    blockHash: first.blockHash,
    receiptStatus: first.status === 'failed' ? 'failed' : 'success',
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
    return { ...summary, ...facts, final: true, verdict: 'verification-rejected', reasonCodes: [first.code] };
  }
  return { ...summary, ...facts, final: true, verdict: 'onchain-verified', reasonCodes: [] };
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

/** Both bindings must carry a REAL verified EIP-191 wallet proof before a
 *  leg may reach onchain-verified; a self-attested binding is storable but
 *  insufficient. */
function bindingsHaveWalletProof(fromBinding, toBinding) {
  return fromBinding.claims?.walletSignatureVerified === true
    && fromBinding.claims?.walletSignatureScheme === 'EIP-191'
    && toBinding.claims?.walletSignatureVerified === true
    && toBinding.claims?.walletSignatureScheme === 'EIP-191';
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
  if (!bindingsHaveWalletProof(checkedFrom.binding, checkedTo.binding)) {
    return { ok: false, code: 'WALLET_PROOF_REQUIRED' };
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
    network: { chainId: network.chainId, quorum: network.quorum, minConfirmations: network.minConfirmations },
    result: observed
  };
}

/* --------------------------- verification reports ------------------------- */

function reportIdFor(core) {
  return sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function reportCore(input) {
  const { verificationId: _verificationId, signature: _signature, ...core } = input;
  return core;
}

const TRANSIENT_REASON = {
  'INSUFFICIENT_CONFIRMATIONS': 'confirmations-pending',
  'RPC_DISAGREEMENT': 'rpc-disagreement',
  'REORG_DETECTED': 'reorg-detected',
  'RPC_QUORUM_UNAVAILABLE': 'verification-unavailable',
  'TX_NOT_FOUND': 'verification-unavailable'
};

function expectedReasonCodes(verdict, rejectReasonCodes) {
  const reasons = Array.isArray(rejectReasonCodes) ? [...rejectReasonCodes] : [];
  if (verdict === 'onchain-verified') return reasons.length === 0;
  if (verdict === 'verification-rejected') {
    return reasons.length > 0 && reasons.length <= 3
      && new Set(reasons).size === reasons.length
      && reasons.every((reason) => FINAL_REJECT_REASONS.includes(reason));
  }
  const codes = Object.keys(TRANSIENT_REASON).filter((key) => TRANSIENT_REASON[key] === verdict);
  return codes.length > 0 && reasons.length === 1 && codes.includes(reasons[0]);
}

function expectedClaimsFor(verdict) {
  const final = verdict === 'onchain-verified' || verdict === 'verification-rejected';
  return {
    serverRecomputedBeforeStorage: false,
    multiRpcQuorumReached: final,
    walletBindingsVerified: true,
    transactionObservedOnChain: final,
    atomicSettlement: false,
    globalAtomicity: false,
    custody: false,
    escrow: false,
    automaticSettlement: false,
    providerIndependenceProven: false
  };
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
  if (!bindingsHaveWalletProof(checkedFrom.binding, checkedTo.binding)) {
    return { ok: false, code: 'WALLET_PROOF_REQUIRED' };
  }
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
  const finalVerdict = input.verdict === 'onchain-verified' || input.verdict === 'verification-rejected';
  /* Final verdicts pin exact block facts; transient snapshots may carry
     nulls where the chain did not provide a fact yet — never invented. */
  if (!Number.isSafeInteger(input.evaluatedAt) || input.evaluatedAt <= 0
    || input.evaluatedAt > Math.floor(now / 1000) + MAX_CLOCK_SKEW_SECONDS
    || (finalVerdict
      ? (!Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0
        || !TX_RE_64.test(String(input.blockHash || ''))
        || !['success', 'failed'].includes(input.receiptStatus)
        || !Number.isSafeInteger(input.confirmations) || input.confirmations < 0)
      : ((input.blockNumber !== null && (!Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0))
        || (input.blockHash !== null && !TX_RE_64.test(String(input.blockHash)))
        || (input.receiptStatus !== null && !['success', 'failed'].includes(input.receiptStatus))
        || (input.confirmations !== null && (!Number.isSafeInteger(input.confirmations) || input.confirmations < 0))))
    || !Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1
    || input.minConfirmations > 128) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT' };
  }
  if (!Array.isArray(input.observations) || input.observations.length < 1
    || input.observations.length > MAX_OBSERVATIONS
    || input.observations.some((row) => !row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some((key) => !OBSERVATION_FIELDS.has(key))
      || !Number.isInteger(row.index) || row.index < 0
      || (row.blockNumber !== null && !Number.isSafeInteger(row.blockNumber))
      || (row.blockHash !== null && !TX_RE_64.test(String(row.blockHash)))
      || (row.confirmations !== null && !Number.isSafeInteger(row.confirmations)))) {
    return { ok: false, code: 'BAD_VERIFICATION_OBSERVATIONS' };
  }
  const quorum = input.quorum;
  if (!quorum || typeof quorum !== 'object' || Array.isArray(quorum)
    || Object.keys(quorum).some((key) => !QUORUM_FIELDS.has(key))
    || !Number.isInteger(quorum.required)
    || quorum.required < MIN_VERIFICATION_QUORUM
    || quorum.required > MAX_OBSERVATIONS
    || !Number.isInteger(quorum.total) || quorum.total !== input.observations.length
    || !Number.isInteger(quorum.agreeing) || quorum.agreeing < 0
    || quorum.agreeing > quorum.total) {
    return { ok: false, code: 'BAD_VERIFICATION_QUORUM' };
  }
  if (!REPORT_VERDICTS.includes(input.verdict)) {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  if (!expectedReasonCodes(input.verdict, input.reasonCodes)) {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  const final = input.verdict === 'onchain-verified' || input.verdict === 'verification-rejected';
  if (final && quorum.agreeing < quorum.required) {
    return { ok: false, code: 'BAD_VERIFICATION_QUORUM' };
  }
  if (final && input.confirmations < input.minConfirmations) {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  if (input.verdict === 'onchain-verified' && input.receiptStatus !== 'success') {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  const claims = input.claims;
  const expectedClaims = expectedClaimsFor(input.verdict);
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !REPORT_CLAIM_FIELDS.has(key))
    || Object.keys(expectedClaims).some((key) => claims[key] !== expectedClaims[key])) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT_CLAIMS' };
  }
  const verifier = input.verifier;
  if (!verifier || typeof verifier !== 'object' || Array.isArray(verifier)
    || Object.keys(verifier).some((key) => !VERIFIER_FIELDS.has(key))
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
  if (!TX_RE_64.test(String(input.verificationId || '')) || reportIdFor(core) !== input.verificationId) {
    return { ok: false, code: 'BAD_VERIFICATION_REPORT_ID' };
  }
  if (!verifyCanonicalSignature(
    TX_VERIFICATION_DOMAIN,
    { ...core, verificationId: input.verificationId },
    input.signature,
    verifier.publicKey
  )) {
    return { ok: false, code: 'VERIFICATION_SIGNATURE_MISMATCH' };
  }
  return { ok: true, report: input };
}

/**
 * Build a signed report in the verifier's own environment. The verifier does
 * its OWN RPC reads; final verdicts are signed as terminal, transient
 * outcomes are signed as honest pending/disagreement snapshots with the
 * matching claims (never as verified).
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
  const verdict = observed.result.verdict ?? verdictForTransientCode(observed.result.code) ?? null;
  if (!verdict) return { ok: false, code: observed.result.code ?? 'BAD_VERIFICATION_VERDICT', result: observed.result };
  const reasonCodes = observed.result.final
    ? (observed.result.reasonCodes ?? [])
    : [observed.result.code];
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
    blockNumber: observed.result.blockNumber ?? null,
    blockHash: observed.result.blockHash ?? null,
    receiptStatus: observed.result.receiptStatus ?? null,
    confirmations: observed.result.confirmations ?? null,
    minConfirmations: observed.network.minConfirmations,
    observations: observed.result.observations,
    quorum: observed.result.quorum,
    verdict,
    reasonCodes,
    evaluatedAt: Math.floor(now / 1000),
    verifier: { id: verifierId, publicKey, algorithm: 'Ed25519' },
    claims: expectedClaimsFor(verdict)
  };
  if (verdict === 'onchain-verified' && core.receiptStatus !== 'success') {
    return { ok: false, code: 'BAD_VERIFICATION_VERDICT' };
  }
  const verificationId = reportIdFor(core);
  let report;
  try {
    report = {
      ...core,
      verificationId,
      signature: signCanonicalPayload(TX_VERIFICATION_DOMAIN, { ...core, verificationId }, privateKey)
    };
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  const checked = verifyTxVerificationReport(report, {
    state, receipt, previousReceipts, fromBinding, toBinding,
    registry: registry.size ? registry : new Map([[verifierId, { id: verifierId, publicKey, active: true }]]),
    now
  });
  return checked.ok ? { ...checked, result: observed.result } : { ...checked, report };
}

/**
 * Server-side recomputation: read the SAME chain facts through the server's
 * own configured endpoints and require the signed verdict to be reproducible
 * against the server's configured network quorum. A final report the server
 * cannot recompute is refused, whatever its signature; a transient snapshot
 * is accepted only while the server itself still observes a non-final
 * outcome (a superseding final outcome invalidates the snapshot).
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
  const fresh = observed.result;
  if (observed.network.quorum !== checked.report.quorum.required
    || observed.network.minConfirmations !== checked.report.minConfirmations) {
    return { ok: false, code: 'VERIFICATION_NOT_RECOMPUTABLE' };
  }
  const reportFinal = checked.report.verdict === 'onchain-verified'
    || checked.report.verdict === 'verification-rejected';
  if (reportFinal) {
    if (!fresh.final
      || fresh.verdict !== checked.report.verdict
      || (fresh.reasonCodes ?? []).join(',') !== (checked.report.reasonCodes ?? []).join(',')
      || fresh.blockNumber !== checked.report.blockNumber
      || fresh.blockHash !== checked.report.blockHash
      || fresh.receiptStatus !== checked.report.receiptStatus
      || fresh.confirmations < checked.report.minConfirmations) {
      return { ok: false, code: 'VERIFICATION_NOT_RECOMPUTABLE' };
    }
  } else if (fresh.final) {
    /* The pending/disagreement snapshot is superseded by a final outcome. */
    return { ok: false, code: 'VERIFICATION_SUPERSEDED', transient: true, result: fresh };
  }
  return { ok: true, report: checked.report, recomputed: fresh };
}

/* ------------------------------- persistence ------------------------------ */

async function blob() {
  if (blobOverride) return blobOverride;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

async function readObject(path) {
  if (memory.has(path)) return memory.get(path);
  const mod = await blob();
  if (!mod) {
    if (process.env.BLOB_READ_WRITE_TOKEN && !blobConfigured()) {
      /* The server process has no blob configuration: nothing can be read
         back, which is an outage — never an empty valid result. */
      throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
    }
    return null;
  }
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
    if (!mod) {
      if (process.env.BLOB_READ_WRITE_TOKEN && !blobConfigured()) {
        return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
      }
    }
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
  if (!mod) {
    if (process.env.BLOB_READ_WRITE_TOKEN && !blobConfigured()) {
      throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
    }
    return local;
  }
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

/* --- legacy record normalization (records written by the first 1.35.0
       release used `publicKey`, `reportId`, `verifiedAt`, `rejectReason`
       and a smaller claims set; they are read back, re-verified against the
       exact rules they were written under, and served in the current shape) - */

function normalizeLegacyBinding(record) {
  const binding = record?.binding;
  if (!binding || typeof binding !== 'object') return null;
  if (binding.partyPublicKey !== undefined) return record;
  if (!binding.publicKey || !binding.bindingId || !binding.signature) return null;
  return {
    ...record,
    binding: {
      schema: binding.schema,
      stateId: binding.stateId,
      partyId: binding.partyId,
      chainId: binding.chainId,
      address: binding.address,
      partyPublicKey: binding.publicKey,
      issuedAt: binding.issuedAt,
      expiresAt: binding.expiresAt,
      walletProof: null,
      claims: {
        addressControlSelfAttested: binding.claims?.addressControlSelfAttested === true,
        walletSignatureScheme: null,
        walletSignatureVerified: binding.claims?.walletSignatureVerified === false ? false : null,
        fundsAuthorityGranted: binding.claims?.fundsAuthorityGranted === false ? false : null,
        custody: binding.claims?.custody === false ? false : null
      },
      bindingId: binding.bindingId,
      signature: binding.signature
    },
    legacy: true
  };
}

function normalizeLegacyReport(record) {
  const report = record?.report;
  if (!report || typeof report !== 'object') return null;
  if (report.verificationId !== undefined) return record;
  if (!report.reportId || !report.signature || !report.verdict) return null;
  return {
    ...record,
    report: {
      schema: report.schema,
      stateId: report.stateId,
      receiptId: report.receiptId,
      leg: report.leg,
      chainId: report.chainId,
      token: report.token,
      amount: report.amount,
      txHash: report.txHash,
      fromPartyId: report.fromPartyId,
      toPartyId: report.toPartyId,
      fromAddress: report.fromAddress,
      toAddress: report.toAddress,
      fromBindingId: report.fromBindingId,
      toBindingId: report.toBindingId,
      blockNumber: report.blockNumber,
      blockHash: report.blockHash,
      receiptStatus: report.receiptStatus,
      confirmations: report.confirmations,
      minConfirmations: report.minConfirmations,
      observations: report.observations,
      quorum: report.quorum,
      verdict: report.verdict,
      reasonCodes: report.rejectReason ? [report.rejectReason] : [],
      evaluatedAt: report.verifiedAt,
      verifier: report.verifier,
      claims: {
        serverRecomputedBeforeStorage: false,
        multiRpcQuorumReached: report.claims?.legOnChainVerified === true,
        walletBindingsVerified: true,
        transactionObservedOnChain: report.claims?.legOnChainVerified === true,
        atomicSettlement: false,
        globalAtomicity: false,
        custody: false,
        escrow: false,
        automaticSettlement: false,
        providerIndependenceProven: false
      },
      verificationId: report.reportId,
      signature: report.signature
    },
    legacy: true
  };
}

/** Store one immutable binding per (party, chain) per state. */
export async function storeAccountBinding(stateId, binding, { now = Date.now() } = {}) {
  const current = await readCrossChainState(stateId, { now });
  if (current.error) return { ok: false, code: current.error };
  const checked = verifyAccountBinding(binding, { state: current.state, now });
  if (!checked.ok) return checked;
  const path = bindingPath(current.state.stateId, checked.binding.partyId, checked.binding.chainId);
  try {
    const existing = normalizeLegacyBinding(await readObject(path));
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
      const concurrent = normalizeLegacyBinding(await readObject(path));
      return concurrent && sameCanonical(concurrent.binding, checked.binding)
        ? { ok: true, alreadyStored: true, binding: concurrent.binding }
        : { ok: false, code: 'ACCOUNT_BINDING_CONFLICT' };
    }
    return { ok: true, alreadyStored: false, binding: checked.binding };
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

/** Public reads re-verify every stored binding cryptographically against its
 *  embedded party key (independent of any registry). Legacy records are
 *  checked against the exact legacy core they were signed over. */
function recheckStoredBinding(record) {
  const raw = record?.binding;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.partyPublicKey === undefined) {
    const legacyCore = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== 'bindingId' && key !== 'signature'));
    if (!TX_RE_64.test(String(raw.bindingId || ''))) return null;
    if (raw.bindingId !== sha256Hex(`${BINDING_ID_DOMAIN}\n${JSON.stringify(canonicalValue(legacyCore))}`)) return null;
    if (!isValidEd25519PublicKey(raw.publicKey)) return null;
    if (!verifyCanonicalSignature(ACCOUNT_BINDING_DOMAIN, { ...legacyCore, bindingId: raw.bindingId },
      raw.signature, raw.publicKey)) return null;
    return normalizeLegacyBinding(record);
  }
  const { bindingId, signature, ...core } = raw;
  if (!TX_RE_64.test(String(bindingId || '')) || bindingIdFor(core) !== bindingId) return null;
  if (!isValidEd25519PublicKey(raw.partyPublicKey)) return null;
  if (!verifyCanonicalSignature(ACCOUNT_BINDING_DOMAIN, { ...core, bindingId },
    signature, raw.partyPublicKey)) return null;
  return normalizeLegacyBinding(record);
}

export async function readAccountBindings(stateId) {
  const id = TX_RE_64.test(String(stateId || '')) ? String(stateId).toLowerCase() : null;
  if (!id) return { error: 'BAD_CROSS_CHAIN_STATE_ID' };
  try {
    const rows = await listPrefix(`${PREFIX}bindings/${id.slice(2)}/`, 'fbt.cross-chain-account-binding-record.v1');
    const bindings = [];
    for (const row of rows) {
      const checked = recheckStoredBinding(row);
      if (!checked) throw new Error('INVALID_STORED_CROSS_CHAIN_OBJECT');
      bindings.push(checked.binding);
    }
    return {
      bindings: bindings
        .sort((a, b) => `${a.partyId}:${a.chainId}`.localeCompare(`${b.partyId}:${b.chainId}`))
    };
  } catch {
    return { error: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

async function storedBindingFor(stateId, partyId, chainId) {
  return normalizeLegacyBinding(await readObject(bindingPath(stateId, partyId, chainId)));
}

/** Re-verify one stored report with the exact rules it was written under.
 *  Legacy records (reportId/verifiedAt/rejectReason) are verified against
 *  their legacy core; current records re-derive verificationId + signature
 *  against the embedded verifier key — so historical reports stay verifiable
 *  even after registry rotation. */
function recheckStoredReport(record) {
  const raw = record?.report;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.verificationId === undefined) {
    /* Legacy shape: signature covers { ...core, reportId }. */
    const legacyCore = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== 'reportId' && key !== 'signature'));
    if (!TX_RE_64.test(String(raw.reportId || ''))) return null;
    if (raw.reportId !== sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(legacyCore))}`)) return null;
    if (!isValidEd25519PublicKey(raw.verifier?.publicKey)) return null;
    if (!verifyCanonicalSignature(TX_VERIFICATION_DOMAIN, { ...legacyCore, reportId: raw.reportId },
      raw.signature, raw.verifier.publicKey)) return null;
    if (!REPORT_VERDICTS.includes(raw.verdict)) return null;
    return normalizeLegacyReport(record);
  }
  const core = reportCore(raw);
  if (!TX_RE_64.test(String(raw.verificationId || '')) || reportIdFor(core) !== raw.verificationId) return null;
  if (!isValidEd25519PublicKey(raw.verifier?.publicKey)) return null;
  if (!verifyCanonicalSignature(TX_VERIFICATION_DOMAIN, { ...core, verificationId: raw.verificationId },
    raw.signature, raw.verifier.publicKey)) return null;
  return normalizeLegacyReport(record);
}

/** Bounded count of stored reports for one receipt. */
async function storedReportCount(stateId, receiptId) {
  const rows = await listPrefix(`${PREFIX}verifications/${String(stateId).slice(2)}/`, 'fbt.cross-chain-tx-verification-record.v1');
  return rows.filter((row) => row.report?.receiptId === receiptId).length;
}

/**
 * Server-side admission of a signed verification report. Registry check,
 * binding re-verification, independent RPC recomputation, then immutable
 * storage. Anything transient may be stored only as an honest non-final
 * snapshot while the server still observes a non-final outcome; an outage
 * is an outage and stores nothing.
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
  const fromBinding = fromRecord.binding;
  const toBinding = toRecord.binding;
  const verificationId = String(report?.verificationId || report?.reportId || '0x0').toLowerCase();
  if (!TX_RE_64.test(verificationId)) return { ok: false, code: 'BAD_VERIFICATION_REPORT_ID' };
  const path = reportPath(current.state.stateId, leg.leg, verificationId);
  try {
    const existing = normalizeLegacyReport(await readObject(path));
    if (existing) {
      return sameCanonical(existing.report, report)
        ? { ok: true, alreadyStored: true, report: existing.report, record: existing }
        : { ok: false, code: 'VERIFICATION_REPORT_CONFLICT' };
    }
    if (await storedReportCount(current.state.stateId, leg.receiptId) >= MAX_REPORTS_PER_RECEIPT) {
      return { ok: false, code: 'VERIFICATION_REPORT_LIMIT' };
    }
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
  const recomputed = await recomputeTxVerificationReport(report, {
    state: current.state,
    receipt: leg,
    previousReceipts,
    fromBinding,
    toBinding,
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
    /* Server attestation: the report below was fully recomputed by the
       server from its own RPC reads BEFORE storage. */
    serverRecomputedBeforeStorage: true,
    serverRecomputedAt: now,
    report: recomputed.report
  };
  try {
    const stored = await writeObject(path, record);
    if (!stored.ok && !stored.duplicate) return stored;
    return { ok: true, alreadyStored: Boolean(stored.duplicate), report: recomputed.report, record };
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

export async function readTxVerificationReports(stateId) {
  const id = TX_RE_64.test(String(stateId || '')) ? String(stateId).toLowerCase() : null;
  if (!id) return { error: 'BAD_CROSS_CHAIN_STATE_ID' };
  try {
    const rows = await listPrefix(`${PREFIX}verifications/${id.slice(2)}/`, 'fbt.cross-chain-tx-verification-record.v1');
    const records = [];
    for (const row of rows) {
      const checked = recheckStoredReport(row);
      if (!checked) throw new Error('INVALID_STORED_CROSS_CHAIN_OBJECT');
      records.push(checked);
    }
    return {
      records: records.sort((a, b) => String(a.report.verificationId).localeCompare(String(b.report.verificationId)))
    };
  } catch {
    return { error: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

/* --------------------------- derived public view -------------------------- */

/**
 * Pure derivation of one leg's verification status from immutable stored
 * evidence. `attempt` may carry the transient outcome of the most recent
 * live check so callers can surface 'rpc-disagreement' / 'reorg-detected' /
 * 'verification-unavailable' / 'confirmations-pending' without storing them.
 */
export function deriveLegVerificationStatus({
  reports = [],
  fromBinding = null,
  toBinding = null,
  networkConfigured = false,
  attempt = null
} = {}) {
  const reportList = reports
    .map((row) => row?.report ?? row)
    .filter((row) => row && REPORT_VERDICTS.includes(row.verdict));
  const verified = reportList.find((row) => row.verdict === 'onchain-verified');
  if (verified) return { status: 'onchain-verified', verificationId: verified.verificationId, reasonCodes: [] };
  const rejected = reportList.find((row) => row.verdict === 'verification-rejected');
  if (rejected) {
    return { status: 'verification-rejected', verificationId: rejected.verificationId, reasonCodes: rejected.reasonCodes ?? [] };
  }
  if (attempt === 'RPC_DISAGREEMENT') return { status: 'rpc-disagreement', verificationId: null, reasonCodes: [] };
  if (attempt === 'REORG_DETECTED') return { status: 'reorg-detected', verificationId: null, reasonCodes: [] };
  if (attempt === 'INSUFFICIENT_CONFIRMATIONS') {
    return { status: 'confirmations-pending', verificationId: null, reasonCodes: [] };
  }
  if (attempt === 'RPC_QUORUM_UNAVAILABLE' || attempt === 'TX_NOT_FOUND'
    || attempt === 'VERIFICATION_CHAIN_NOT_CONFIGURED') {
    return { status: 'verification-unavailable', verificationId: null, reasonCodes: [] };
  }
  if (attempt === 'WALLET_PROOF_REQUIRED') {
    return { status: 'wallet-proof-required', verificationId: null, reasonCodes: [] };
  }
  if (attempt === 'ACCOUNT_BINDING_NOT_FOUND') {
    return { status: 'binding-required', verificationId: null, reasonCodes: [] };
  }
  const transient = reportList.find((row) => row.verdict !== 'onchain-verified' && row.verdict !== 'verification-rejected');
  if (!networkConfigured) return { status: 'signed-only', verificationId: null, reasonCodes: [] };
  if (!fromBinding || !toBinding) return { status: 'binding-required', verificationId: null, reasonCodes: [] };
  if (fromBinding.claims?.walletSignatureVerified !== true || toBinding.claims?.walletSignatureVerified !== true) {
    return { status: 'wallet-proof-required', verificationId: null, reasonCodes: [] };
  }
  if (transient) {
    return { status: transient.verdict, verificationId: transient.verificationId, reasonCodes: transient.reasonCodes ?? [] };
  }
  return { status: 'verification-pending', verificationId: null, reasonCodes: [] };
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
  const records = reports.records;
  const legVerification = {};
  for (const receipt of base.receipts) {
    const fromBinding = bindings.bindings.find((row) =>
      row.partyId === receipt.fromPartyId && row.chainId === receipt.chainId) ?? null;
    const toBinding = bindings.bindings.find((row) =>
      row.partyId === receipt.toPartyId && row.chainId === receipt.chainId) ?? null;
    legVerification[receipt.leg] = deriveLegVerificationStatus({
      reports: records.filter((row) => row.report?.receiptId === receipt.receiptId),
      fromBinding,
      toBinding,
      networkConfigured: networks.has(receipt.chainId)
    });
  }
  const submitted = base.receipts.length;
  const allVerified = submitted > 0
    && base.receipts.every((receipt) => legVerification[receipt.leg]?.status === 'onchain-verified');
  return {
    ...base,
    accountBindings: bindings.bindings,
    verificationReports: records,
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
