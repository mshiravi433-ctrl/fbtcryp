/**
 * INTENT CROSS-CHAIN — browser client (Phase 153 wiring).
 * ---------------------------------------------------------------------------
 * This module connects the Intent OS UI to the REAL cross-chain surfaces that
 * already existed server-side but were unreachable from a browser:
 *
 *   1. Sequential settlement (Phase 4b): fbt.cross-chain-state.v1 plans and
 *      fbt.cross-chain-leg-receipt.v1 Ed25519-signed statements. The server
 *      always verified signatures with node:crypto — but the browser had NO
 *      Ed25519 implementation, so no screen could ever produce a signed
 *      receipt. This module adds exactly that: @noble/ed25519 signatures that
 *      are byte-identical to node:crypto's (proven by the phase probe).
 *   2. HTLC atomic swap (Phase 4d): status / plan / verify endpoints.
 *   3. REAL bridge quotes for the source leg (server-side LI.FI proxy).
 *
 * Honest properties (unchanged from the server's design):
 *   - Private keys are generated and stored ON THIS DEVICE ONLY. They are
 *     never sent anywhere; only public keys, signatures and tx hashes leave.
 *   - Receipts claim `userSigned: true, onChainVerified: false` — the claim of
 *     the signer, not a chain read. On-chain truth comes only from the
 *     server's verification reports, which re-read chains through the
 *     server's OWN configured RPCs.
 *   - Sequential settlement is NOT atomic. `claims.atomic === false` is baked
 *     into every plan. The atomic path is the HTLC contract flow, and only
 *     when its contracts are configured.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { getAddress } from 'ethers';
import { apiBase } from './apiBase.js';

/* noble/ed25519 v2 needs its sha512 wired to a concrete implementation. */
ed.hashes.sha512 = sha512;

export const CROSS_CHAIN_STATE_SCHEMA = 'fbt.cross-chain-state.v1';
export const CROSS_CHAIN_STATE_ID_DOMAIN = 'fbt.cross-chain-state.v1/id';
export const CROSS_CHAIN_RECEIPT_SCHEMA = 'fbt.cross-chain-leg-receipt.v1';
export const CROSS_CHAIN_RECEIPT_DOMAIN = 'fbt.cross-chain-leg-receipt.v1/signature';
export const CROSS_CHAIN_RECEIPT_ID_DOMAIN = 'fbt.cross-chain-leg-receipt.v1/id';
export const CROSS_CHAIN_MODE = 'sequential-user-signatures';
export const ED25519_ALGORITHM = 'Ed25519';

const API = apiBase();

/* ── canonical JSON — MUST stay byte-compatible with server/intentSignatures.js ── */

export function canonicalValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      const item = value[key];
      if (key !== 'signature' && item !== undefined && typeof item !== 'function') {
        out[key] = canonicalValue(item);
      }
      return out;
    }, {});
  }
  return String(value);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/* ── Ed25519 keys (raw 32-byte, base64url — same encoding the server verifies) ── */

export function generatePartyKey() {
  const seed = ed.utils.randomSecretKey();
  return {
    privateKey: toBase64Url(seed),
    publicKey: toBase64Url(ed.getPublicKey(seed))
  };
}

export function publicKeyFromSeed(seedB64Url) {
  return toBase64Url(ed.getPublicKey(fromBase64Url(seedB64Url)));
}

function signMessage(message, seedB64Url) {
  return toBase64Url(ed.sign(encoder.encode(message), fromBase64Url(seedB64Url)));
}

/** The exact message shape server-side signCanonicalPayload() signs. */
export function canonicalSigningMessage(domain, payload) {
  return JSON.stringify(canonicalValue({ domain, payload }));
}

/* ── device-local key custody (never transmitted) ─────────────────────────── */

const KEYS_STORAGE_KEY = 'fbt.intentCrossChain.keys.v1';

function readKeyStore() {
  try {
    return JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeKeyStore(store) {
  try {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(store));
  } catch { /* storage full/blocked — keys stay in memory only */ }
}

export function saveStateKeys(stateId, keys) {
  const store = readKeyStore();
  store[stateId] = { ...store[stateId], ...keys, savedAt: Date.now() };
  writeKeyStore(store);
}

export function loadStateKeys(stateId) {
  return readKeyStore()[stateId] || null;
}

export function forgetStateKeys(stateId) {
  const store = readKeyStore();
  delete store[stateId];
  writeKeyStore(store);
}

/* ── state plan builder — mirrors server normalization exactly ─────────────── */

const CHAIN_IDS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const SYMBOL_RE = /^[A-Z0-9.$₮_-]{1,16}$/;
const AMOUNT_RE = /^[1-9][0-9]{0,77}$/;
const PARTY_ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;

export function normalizeToken(input) {
  const symbol = String(input?.symbol || '').trim().toUpperCase();
  const decimals = Number(input?.decimals);
  if (!SYMBOL_RE.test(symbol) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (input?.native === true) {
    if (input.address) return null;
    return { symbol, address: null, native: true, decimals };
  }
  try {
    return { symbol, address: getAddress(String(input.address)), native: false, decimals };
  } catch {
    return null;
  }
}

export function normalizeLeg(input) {
  const chainId = Number(input?.chainId);
  const token = normalizeToken(input?.token);
  const amount = String(input?.amount || '');
  if (!CHAIN_IDS.has(chainId) || !token || !AMOUNT_RE.test(amount)) return null;
  return { chainId, token, amount };
}

function normalizeParty(input) {
  const id = String(input?.id || '').toLowerCase();
  if (!PARTY_ID_RE.test(id) || typeof input?.publicKey !== 'string' || input.publicKey.length < 40) return null;
  return { id, publicKey: input.publicKey };
}

/**
 * Build the immutable plan and its deterministic id, byte-compatible with the
 * server. Returns { ok, state } or { ok: false, code }.
 *
 * input: { createdAt?, source, destination, parties: {initiator, counterparty},
 *          windowHours (source/destination/refund schedule is derived) }
 */
export async function buildCrossChainStatePlan(input) {
  const createdAt = Math.floor(Number(input.createdAt ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(createdAt)) return { ok: false, code: 'BAD_CROSS_CHAIN_TIME' };

  const source = normalizeLeg(input.source);
  const destination = normalizeLeg(input.destination);
  if (!source || !destination || source.chainId === destination.chainId) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_LEG' };
  }
  const initiator = normalizeParty(input.parties?.initiator);
  const counterparty = normalizeParty(input.parties?.counterparty);
  if (!initiator || !counterparty || initiator.id === counterparty.id || initiator.publicKey === counterparty.publicKey) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_PARTIES' };
  }

  /* Windows: source signature window first, then destination, then refund —
     ordered strictly increasing, refund ≤ 30 days from creation. */
  const hours = Math.max(1, Math.min(24 * 29, Math.round(Number(input.windowHours) || 48)));
  const timeout = {
    sourceSignatureBy: createdAt + hours * 3600,
    destinationSignatureBy: createdAt + (hours + 24) * 3600,
    refundSignatureBy: createdAt + (hours + 48) * 3600
  };
  if (timeout.refundSignatureBy - createdAt > 30 * 86400) {
    timeout.refundSignatureBy = createdAt + 30 * 86400;
  }

  const core = {
    schema: CROSS_CHAIN_STATE_SCHEMA,
    createdAt,
    source,
    destination,
    parties: { initiator, counterparty },
    timeout,
    refund: {
      chainId: source.chainId,
      token: source.token,
      amount: source.amount,
      fromPartyId: counterparty.id,
      toPartyId: initiator.id,
      mode: 'user-signed-transfer',
      automatic: false,
      enforceableByFbt: false
    },
    settlement: CROSS_CHAIN_MODE,
    claims: {
      atomic: false,
      globalAtomicity: false,
      custody: false,
      escrow: false,
      automaticSettlement: false,
      onChainVerified: false,
      sequentialUserSignatures: true
    }
  };
  const stateId = await sha256Hex(`${CROSS_CHAIN_STATE_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
  return { ok: true, state: { ...core, stateId } };
}

/* ── leg receipts — signed on this device, verified server-side ────────────── */

function expectedLegFor(state, leg) {
  if (leg === 'source-transfer') {
    return { sequence: 1, transfer: state.source, from: state.parties.initiator, to: state.parties.counterparty, earliest: state.createdAt, deadline: state.timeout.sourceSignatureBy };
  }
  if (leg === 'destination-transfer') {
    return { sequence: 2, transfer: state.destination, from: state.parties.counterparty, to: state.parties.initiator, earliest: state.createdAt, deadline: state.timeout.destinationSignatureBy };
  }
  if (leg === 'refund') {
    return { sequence: 2, transfer: { chainId: state.refund.chainId, token: state.refund.token, amount: state.refund.amount }, from: state.parties.counterparty, to: state.parties.initiator, earliest: state.timeout.destinationSignatureBy, deadline: state.timeout.refundSignatureBy };
  }
  return null;
}

/**
 * Build + sign a leg receipt on this device.
 * `signerSeedB64Url` must be the FROM-party's private seed — the signer is
 * derived from the seed and REFUSED unless it is exactly the party the leg
 * expects to sign (fail-closed instead of producing an unverifiable receipt).
 */
export async function signLegReceipt({ state, priorReceipts = [], leg, txHash, signedAt = Math.floor(Date.now() / 1000) }, signerSeedB64Url) {
  const expected = expectedLegFor(state, leg);
  if (!expected) return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) return { ok: false, code: 'BAD_TX_HASH' };
  const signerPublicKey = toBase64Url(ed.getPublicKey(fromBase64Url(signerSeedB64Url)));
  if (signerPublicKey !== expected.from.publicKey) {
    return { ok: false, code: 'WRONG_SIGNER_KEY_FOR_LEG', expectedPartyId: expected.from.id };
  }
  const prior = Array.isArray(priorReceipts) ? priorReceipts : [];
  if (leg === 'source-transfer') {
    if (prior.length !== 0) return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
  } else if (prior.length !== 1 || !prior[0]?.receiptId || prior[0]?.leg !== 'source-transfer') {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
  }
  const priorReceiptId = leg === 'source-transfer' ? null : prior[0].receiptId;

  const core = {
    schema: CROSS_CHAIN_RECEIPT_SCHEMA,
    stateId: state.stateId,
    leg,
    sequence: expected.sequence,
    priorReceiptId,
    chainId: expected.transfer.chainId,
    token: expected.transfer.token,
    amount: expected.transfer.amount,
    fromPartyId: expected.from.id,
    toPartyId: expected.to.id,
    txHash,
    signedAt: Math.floor(signedAt),
    signer: { id: expected.from.id, publicKey: expected.from.publicKey, algorithm: ED25519_ALGORITHM },
    claims: { userSigned: true, onChainVerified: false, custody: false, atomicSettlement: false, automaticSettlement: false }
  };
  const receiptId = await sha256Hex(`${CROSS_CHAIN_RECEIPT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
  const message = canonicalSigningMessage(CROSS_CHAIN_RECEIPT_DOMAIN, { ...core, receiptId });
  return { ok: true, receipt: { ...core, receiptId, signature: signMessage(message, signerSeedB64Url) } };
}

/** Local sanity check before trusting the network with a receipt. */
export function verifyLegReceiptLocally(receipt, publicKeyB64Url) {
  try {
    const { signature, receiptId, ...core } = receipt;
    return ed.verify(fromBase64Url(signature), encoder.encode(canonicalSigningMessage(CROSS_CHAIN_RECEIPT_DOMAIN, { ...core, receiptId })), fromBase64Url(publicKeyB64Url));
  } catch {
    return false;
  }
}

/* ── REST surface ──────────────────────────────────────────────────────────── */

async function jsonOrThrow(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.error || body.detail || `HTTP_${res.status}`);
    error.code = body.error || body.detail || `HTTP_${res.status}`;
    throw error;
  }
  return body;
}

const getJson = (path) => fetch(`${API}${path}`, { headers: { accept: 'application/json' } }).then(jsonOrThrow);
const postJson = (path, body) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
}).then(jsonOrThrow);

/** REAL bridge quote for the source leg (server-side LI.FI proxy). */
export const quoteSourceLeg = ({ fromChain, toChain, amount, token }) =>
  getJson(`/intents/v1/bridge-quote?fromChain=${fromChain}&toChain=${toChain}&amount=${encodeURIComponent(amount)}&token=${encodeURIComponent(token)}`);

/** The POST /states input is the RAW plan — settlement, claims and the state
    id are derived server-side and must NOT be sent. */
export const createSettlementState = ({ stateId, settlement, claims, ...plan }) =>
  postJson('/intents/v1/cross-chain/states', plan);
export const fetchSettlementState = (stateId) => getJson(`/intents/v1/cross-chain/states/${stateId}`);
export const submitLegReceipt = (stateId, receipt) => postJson(`/intents/v1/cross-chain/states/${stateId}/receipts`, receipt);
export const requestLegVerification = (stateId, body) => postJson(`/intents/v1/cross-chain/states/${stateId}/verification-reports`, body);

/** Phase 4d HTLC atomic swap surface. */
export const getAtomicSwapStatus = () => getJson('/intents/v1/atomic-swap/status');
export const planAtomicSwap = (body) => postJson('/intents/v1/atomic-swap/plan', body);
export const verifyAtomicSwap = (body) => postJson('/intents/v1/atomic-swap/verify', body);

/** Local index of this device's states (ids only — the plan lives server-side). */
const STATES_INDEX_KEY = 'fbt.intentCrossChain.states.v1';

export function rememberLocalStateId(stateId, meta = {}) {
  try {
    const rows = JSON.parse(localStorage.getItem(STATES_INDEX_KEY) || '[]');
    const next = rows.filter((r) => r.stateId !== stateId);
    next.unshift({ stateId, ...meta, at: Date.now() });
    localStorage.setItem(STATES_INDEX_KEY, JSON.stringify(next.slice(0, 20)));
  } catch { /* storage unavailable — the plan still exists on the server */ }
}

export function listLocalStateIds() {
  try {
    return JSON.parse(localStorage.getItem(STATES_INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

export function forgetLocalStateId(stateId) {
  try {
    const rows = listLocalStateIds().filter((r) => r.stateId !== stateId);
    localStorage.setItem(STATES_INDEX_KEY, JSON.stringify(rows));
  } catch { /* noop */ }
}
