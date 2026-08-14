/**
 * Sequential cross-chain settlement state machine (Phase 4b).
 * --------------------------------------------------------------------------
 * This is deliberately NOT an atomic bridge or an escrow. Two parties sign
 * evidence for separate source and destination transfers. If the destination
 * transfer misses its window, the counterparty may sign a source-chain refund
 * transfer. FBT stores and verifies those signed statements, but cannot force
 * either transaction, verify it on-chain, or move funds.
 *
 * The immutable plan uses fbt.cross-chain-state.v1. Each transition is an
 * fbt.cross-chain-leg-receipt.v1 Ed25519 statement pinned to the plan and the
 * prior receipt. The envelope/Risk Engine remains draft-only under
 * ATOMIC_CROSS_CHAIN_UNAVAILABLE; this module never upgrades it to executable.
 */

import { createHash } from 'node:crypto';
import { getAddress, isAddress } from 'ethers';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  isValidEd25519PublicKey,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';

export const CROSS_CHAIN_STATE_SCHEMA = 'fbt.cross-chain-state.v1';
export const CROSS_CHAIN_RECEIPT_SCHEMA = 'fbt.cross-chain-leg-receipt.v1';
export const CROSS_CHAIN_RECEIPT_DOMAIN = 'fbt.cross-chain-leg-receipt.v1/signature';
export const CROSS_CHAIN_MODE = 'sequential-user-signatures';
export const CROSS_CHAIN_LEGS = Object.freeze(['source-transfer', 'destination-transfer', 'refund']);

const STATE_ID_DOMAIN = 'fbt.cross-chain-state.v1/id';
const RECEIPT_ID_DOMAIN = 'fbt.cross-chain-leg-receipt.v1/id';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-cross-chain/v1/';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const SYMBOL_RE = /^[A-Z0-9.$₮_-]{1,16}$/;
const AMOUNT_RE = /^[1-9][0-9]{0,77}$/;
const CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const MAX_WINDOW_SECONDS = 30 * 86400;
const MAX_CLOCK_SKEW_SECONDS = 30;
const STATE_FIELDS = new Set([
  'schema', 'stateId', 'createdAt', 'source', 'destination', 'parties',
  'timeout', 'refund', 'settlement', 'claims'
]);
const STATE_INPUT_FIELDS = new Set([
  'schema', 'createdAt', 'source', 'destination', 'parties', 'timeout', 'refund'
]);
const STATE_CLAIM_FIELDS = new Set([
  'atomic', 'globalAtomicity', 'custody', 'escrow', 'automaticSettlement',
  'onChainVerified', 'sequentialUserSignatures'
]);
const RECEIPT_CLAIM_FIELDS = new Set([
  'userSigned', 'onChainVerified', 'custody', 'atomicSettlement', 'automaticSettlement'
]);
const RECEIPT_FIELDS = new Set([
  'schema', 'stateId', 'leg', 'sequence', 'priorReceiptId', 'chainId',
  'token', 'amount', 'fromPartyId', 'toPartyId', 'txHash', 'signedAt',
  'signer', 'claims', 'receiptId', 'signature'
]);

const memory = new Map();
const pending = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const statePath = (stateId) => `${PREFIX}states/${stateId.slice(2)}.json`;
const receiptDir = (stateId) => `${PREFIX}receipts/${stateId.slice(2)}/`;
const receiptPath = (receipt) => `${receiptDir(receipt.stateId)}${receipt.sequence}-${receipt.receiptId.slice(2)}.json`;

function sameCanonical(a, b) {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));
}

function normalizedToken(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !['symbol', 'address', 'native', 'decimals'].includes(key))) return null;
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const native = input.native === true;
  const decimals = Number(input.decimals);
  if (!SYMBOL_RE.test(symbol) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (native) {
    if (input.address != null && input.address !== '') return null;
    return { symbol, address: null, native: true, decimals };
  }
  if (!isAddress(String(input.address || ''))) return null;
  return { symbol, address: getAddress(input.address), native: false, decimals };
}

function normalizedLeg(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !['chainId', 'token', 'amount'].includes(key))) return null;
  const chainId = Number(input.chainId);
  const token = normalizedToken(input.token);
  const amount = String(input.amount || '');
  if (!Number.isInteger(chainId) || !CHAINS.has(chainId) || !token || !AMOUNT_RE.test(amount)) return null;
  return { chainId, token, amount };
}

function normalizedParty(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !['id', 'publicKey'].includes(key))) return null;
  const id = String(input.id || '').toLowerCase();
  if (!ID_RE.test(id) || !isValidEd25519PublicKey(input.publicKey)) return null;
  return { id, publicKey: input.publicKey };
}

function stateIdFor(core) {
  return sha256Hex(`${STATE_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function receiptIdFor(core) {
  return sha256Hex(`${RECEIPT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function stateCore(input) {
  const { stateId: _stateId, ...core } = input;
  return core;
}

/** Strict structural validation of a complete immutable state plan. */
export function validateCrossChainState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_STATE' };
  }
  if (Object.keys(input).some((key) => !STATE_FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_CROSS_CHAIN_FIELD' };
  }
  if (input.schema !== CROSS_CHAIN_STATE_SCHEMA || !TX_RE_64.test(String(input.stateId || ''))) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_SCHEMA' };
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt <= 0) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TIME' };
  }
  const source = normalizedLeg(input.source);
  const destination = normalizedLeg(input.destination);
  if (!source || !destination || source.chainId === destination.chainId) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_LEG' };
  }
  const initiator = normalizedParty(input.parties?.initiator);
  const counterparty = normalizedParty(input.parties?.counterparty);
  if (!initiator || !counterparty
    || initiator.id === counterparty.id
    || initiator.publicKey === counterparty.publicKey
    || Object.keys(input.parties || {}).some((key) => !['initiator', 'counterparty'].includes(key))) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_PARTIES' };
  }
  const timeout = input.timeout;
  if (!timeout || typeof timeout !== 'object' || Array.isArray(timeout)
    || Object.keys(timeout).some((key) => !['sourceSignatureBy', 'destinationSignatureBy', 'refundSignatureBy'].includes(key))) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TIMEOUT' };
  }
  const sourceBy = Number(timeout.sourceSignatureBy);
  const destinationBy = Number(timeout.destinationSignatureBy);
  const refundBy = Number(timeout.refundSignatureBy);
  if (![sourceBy, destinationBy, refundBy].every(Number.isSafeInteger)
    || sourceBy <= input.createdAt
    || destinationBy <= sourceBy
    || refundBy <= destinationBy
    || refundBy - input.createdAt > MAX_WINDOW_SECONDS) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TIMEOUT' };
  }
  const refund = input.refund;
  if (!refund || typeof refund !== 'object' || Array.isArray(refund)
    || Object.keys(refund).some((key) => ![
      'chainId', 'token', 'amount', 'fromPartyId', 'toPartyId', 'mode',
      'automatic', 'enforceableByFbt'
    ].includes(key))) {
    return { ok: false, code: 'BAD_REFUND_PATH' };
  }
  const refundLeg = normalizedLeg({
    chainId: refund.chainId,
    token: refund.token,
    amount: refund.amount
  });
  if (!refundLeg
    || !sameCanonical(refundLeg, source)
    || refund.fromPartyId !== counterparty.id
    || refund.toPartyId !== initiator.id
    || refund.mode !== 'user-signed-transfer'
    || refund.automatic !== false
    || refund.enforceableByFbt !== false) {
    return { ok: false, code: 'BAD_REFUND_PATH' };
  }
  if (input.settlement !== CROSS_CHAIN_MODE) return { ok: false, code: 'BAD_CROSS_CHAIN_MODE' };
  const claims = input.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !STATE_CLAIM_FIELDS.has(key))
    || claims.atomic !== false
    || claims.globalAtomicity !== false
    || claims.custody !== false
    || claims.escrow !== false
    || claims.automaticSettlement !== false
    || claims.onChainVerified !== false
    || claims.sequentialUserSignatures !== true) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_CLAIMS' };
  }

  const normalized = {
    schema: CROSS_CHAIN_STATE_SCHEMA,
    stateId: input.stateId.toLowerCase(),
    createdAt: input.createdAt,
    source,
    destination,
    parties: { initiator, counterparty },
    timeout: {
      sourceSignatureBy: sourceBy,
      destinationSignatureBy: destinationBy,
      refundSignatureBy: refundBy
    },
    refund: {
      ...refundLeg,
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
  if (stateIdFor(stateCore(normalized)) !== normalized.stateId) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_STATE_ID' };
  }
  return { ok: true, state: normalized };
}

/** Build a canonical immutable plan. No coordinator or server signature. */
export function createCrossChainState(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_STATE' };
  }
  if (Object.keys(input).some((key) => !STATE_INPUT_FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_CROSS_CHAIN_FIELD' };
  }
  if (input.schema !== CROSS_CHAIN_STATE_SCHEMA) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_SCHEMA' };
  }
  const nowSeconds = Math.floor(now / 1000);
  const createdAt = input.createdAt == null ? nowSeconds : Number(input.createdAt);
  if (!Number.isSafeInteger(createdAt) || Math.abs(createdAt - nowSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TIME' };
  }
  const source = normalizedLeg(input.source);
  const destination = normalizedLeg(input.destination);
  const initiator = normalizedParty(input.parties?.initiator);
  const counterparty = normalizedParty(input.parties?.counterparty);
  if (!source || !destination) return { ok: false, code: 'BAD_CROSS_CHAIN_LEG' };
  if (!initiator || !counterparty) return { ok: false, code: 'BAD_CROSS_CHAIN_PARTIES' };
  const timeout = {
    sourceSignatureBy: Number(input.timeout?.sourceSignatureBy),
    destinationSignatureBy: Number(input.timeout?.destinationSignatureBy),
    refundSignatureBy: Number(input.timeout?.refundSignatureBy)
  };
  if (!input.refund || typeof input.refund !== 'object' || Array.isArray(input.refund)
    || Object.keys(input.refund).some((key) => ![
      'chainId', 'token', 'amount', 'fromPartyId', 'toPartyId', 'mode',
      'automatic', 'enforceableByFbt'
    ].includes(key))) {
    return { ok: false, code: 'BAD_REFUND_PATH' };
  }
  const refundLeg = normalizedLeg({
    chainId: input.refund?.chainId,
    token: input.refund?.token,
    amount: input.refund?.amount
  });
  if (!refundLeg) return { ok: false, code: 'BAD_REFUND_PATH' };
  const core = {
    schema: CROSS_CHAIN_STATE_SCHEMA,
    createdAt,
    source,
    destination,
    parties: { initiator, counterparty },
    timeout,
    refund: {
      ...refundLeg,
      fromPartyId: String(input.refund?.fromPartyId || '').toLowerCase(),
      toPartyId: String(input.refund?.toPartyId || '').toLowerCase(),
      mode: input.refund?.mode,
      automatic: input.refund?.automatic,
      enforceableByFbt: input.refund?.enforceableByFbt
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
  const state = { ...core, stateId: stateIdFor(core) };
  /* Put stateId in the schema's stable position only through canonicalValue;
     object insertion order has no effect on either the id or signatures. */
  const canonicalState = { schema: state.schema, stateId: state.stateId, ...stateCore(state) };
  const checked = validateCrossChainState(canonicalState);
  if (!checked.ok) return checked;
  if (checked.state.timeout.sourceSignatureBy <= nowSeconds) {
    return { ok: false, code: 'CROSS_CHAIN_SOURCE_WINDOW_CLOSED' };
  }
  return { ok: true, state: checked.state };
}

function expectedLeg(state, leg) {
  if (leg === 'source-transfer') {
    return {
      sequence: 1,
      transfer: state.source,
      from: state.parties.initiator,
      to: state.parties.counterparty,
      earliest: state.createdAt,
      deadline: state.timeout.sourceSignatureBy
    };
  }
  if (leg === 'destination-transfer') {
    return {
      sequence: 2,
      transfer: state.destination,
      from: state.parties.counterparty,
      to: state.parties.initiator,
      earliest: state.createdAt,
      deadline: state.timeout.destinationSignatureBy
    };
  }
  if (leg === 'refund') {
    return {
      sequence: 2,
      transfer: { chainId: state.refund.chainId, token: state.refund.token, amount: state.refund.amount },
      from: state.parties.counterparty,
      to: state.parties.initiator,
      earliest: state.timeout.destinationSignatureBy,
      deadline: state.timeout.refundSignatureBy
    };
  }
  return null;
}

function receiptCoreFor(state, leg, txHash, signedAt, priorReceiptId) {
  const expected = expectedLeg(state, leg);
  return {
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
    txHash: String(txHash).toLowerCase(),
    signedAt,
    signer: {
      id: expected.from.id,
      publicKey: expected.from.publicKey,
      algorithm: 'Ed25519'
    },
    claims: {
      userSigned: true,
      onChainVerified: false,
      custody: false,
      atomicSettlement: false,
      automaticSettlement: false
    }
  };
}

/** Verify one receipt against the immutable plan and all prior receipts. */
export function verifyCrossChainReceipt(input, {
  state,
  previousReceipts = [],
  now = Date.now(),
  enforceCurrentClock = false
} = {}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const plan = checkedState.state;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT' };
  }
  if (Object.keys(input).some((key) => !RECEIPT_FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_CROSS_CHAIN_RECEIPT_FIELD' };
  }
  if (input.schema !== CROSS_CHAIN_RECEIPT_SCHEMA || !same(input.stateId, plan.stateId)) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT_BINDING' };
  }
  const expected = expectedLeg(plan, input.leg);
  if (!expected || input.sequence !== expected.sequence) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
  }
  if (!TX_RE_64.test(String(input.txHash || '')) || !Number.isSafeInteger(input.signedAt)) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT' };
  }
  if (input.signedAt < expected.earliest || input.signedAt > expected.deadline) {
    return { ok: false, code: input.leg === 'refund' ? 'REFUND_WINDOW_CLOSED' : 'CROSS_CHAIN_LEG_WINDOW_CLOSED' };
  }
  if (enforceCurrentClock && input.signedAt > Math.floor(now / 1000) + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT_TIME' };
  }
  const prior = Array.isArray(previousReceipts) ? previousReceipts : [];
  if (input.leg === 'source-transfer') {
    if (prior.length !== 0 || input.priorReceiptId !== null) {
      return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
    }
  } else {
    if (prior.length !== 1 || prior[0]?.leg !== 'source-transfer'
      || input.priorReceiptId !== prior[0].receiptId
      || input.signedAt < prior[0].signedAt) {
      return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
    }
    const priorChecked = verifyCrossChainReceipt(prior[0], { state: plan, previousReceipts: [] });
    if (!priorChecked.ok) return { ok: false, code: 'BAD_PRIOR_CROSS_CHAIN_RECEIPT' };
  }
  if (input.chainId !== expected.transfer.chainId
    || !sameCanonical(input.token, expected.transfer.token)
    || input.amount !== expected.transfer.amount
    || input.fromPartyId !== expected.from.id
    || input.toPartyId !== expected.to.id) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSFER_BINDING' };
  }
  const signer = input.signer;
  if (!signer || typeof signer !== 'object' || Array.isArray(signer)
    || Object.keys(signer).some((key) => !['id', 'publicKey', 'algorithm'].includes(key))
    || signer.id !== expected.from.id || signer.publicKey !== expected.from.publicKey
    || signer.algorithm !== 'Ed25519' || !isValidEd25519PublicKey(signer.publicKey)) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_SIGNER' };
  }
  const claims = input.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !RECEIPT_CLAIM_FIELDS.has(key))
    || claims.userSigned !== true || claims.onChainVerified !== false
    || claims.custody !== false || claims.atomicSettlement !== false
    || claims.automaticSettlement !== false) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT_CLAIMS' };
  }
  const { receiptId, signature, ...core } = input;
  if (!TX_RE_64.test(String(receiptId || '')) || receiptIdFor(core) !== receiptId) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT_ID' };
  }
  if (!verifyCanonicalSignature(CROSS_CHAIN_RECEIPT_DOMAIN, { ...core, receiptId }, signature, signer.publicKey)) {
    return { ok: false, code: 'CROSS_CHAIN_SIGNATURE_MISMATCH' };
  }
  return { ok: true, receipt: input };
}

/** Build a user/counterparty signed transition. Private keys stay CLI-side. */
export function buildCrossChainReceipt({
  state,
  previousReceipts = [],
  leg,
  txHash,
  signedAt = Math.floor(Date.now() / 1000)
}, privateKey) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  const expected = expectedLeg(checkedState.state, leg);
  if (!expected) return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
  try {
    if (publicKeyFromPrivateKey(privateKey) !== expected.from.publicKey) {
      return { ok: false, code: 'CROSS_CHAIN_SIGNER_KEY_MISMATCH' };
    }
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  const priorReceiptId = leg === 'source-transfer' ? null : previousReceipts?.[0]?.receiptId;
  const core = receiptCoreFor(checkedState.state, leg, txHash, Number(signedAt), priorReceiptId);
  const receiptId = receiptIdFor(core);
  let receipt;
  try {
    receipt = {
      ...core,
      receiptId,
      signature: signCanonicalPayload(CROSS_CHAIN_RECEIPT_DOMAIN, { ...core, receiptId }, privateKey)
    };
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  return verifyCrossChainReceipt(receipt, {
    state: checkedState.state,
    previousReceipts,
    now: Number(signedAt) * 1000,
    enforceCurrentClock: true
  });
}

/** Deterministically derive the public state from an immutable plan + receipts. */
export function evaluateCrossChainState(state, receipts = [], { now = Date.now() } = {}) {
  const checkedState = validateCrossChainState(state);
  if (!checkedState.ok) return checkedState;
  if (!Array.isArray(receipts) || receipts.length > 2) {
    return { ok: false, code: 'BAD_CROSS_CHAIN_RECEIPT_SET' };
  }
  const source = receipts.filter((row) => row?.leg === 'source-transfer');
  const terminal = receipts.filter((row) => row?.leg === 'destination-transfer' || row?.leg === 'refund');
  if (source.length > 1 || terminal.length > 1 || receipts.length !== source.length + terminal.length) {
    return { ok: false, code: 'CROSS_CHAIN_TRANSITION_CONFLICT' };
  }
  if (source.length) {
    const checked = verifyCrossChainReceipt(source[0], { state: checkedState.state, previousReceipts: [] });
    if (!checked.ok) return checked;
  }
  if (terminal.length) {
    if (!source.length) return { ok: false, code: 'BAD_CROSS_CHAIN_TRANSITION' };
    const checked = verifyCrossChainReceipt(terminal[0], {
      state: checkedState.state,
      previousReceipts: source
    });
    if (!checked.ok) return checked;
  }
  const nowSeconds = Math.floor(now / 1000);
  let status = 'awaiting-source-signature';
  let nextLeg = 'source-transfer';
  if (!source.length && nowSeconds > checkedState.state.timeout.sourceSignatureBy) {
    status = 'source-window-expired';
    nextLeg = null;
  } else if (terminal[0]?.leg === 'destination-transfer') {
    status = 'settled-sequential';
    nextLeg = null;
  } else if (terminal[0]?.leg === 'refund') {
    status = 'refunded-by-signed-claim';
    nextLeg = null;
  } else if (source.length && nowSeconds <= checkedState.state.timeout.destinationSignatureBy) {
    status = 'awaiting-destination-signature';
    nextLeg = 'destination-transfer';
  } else if (source.length && nowSeconds <= checkedState.state.timeout.refundSignatureBy) {
    status = 'refund-signature-available';
    nextLeg = 'refund';
  } else if (source.length) {
    status = 'refund-window-expired';
    nextLeg = null;
  }
  return {
    ok: true,
    state: checkedState.state,
    receipts: [...source, ...terminal],
    status,
    nextLeg,
    complete: status === 'settled-sequential' || status === 'refunded-by-signed-claim',
    atomic: false,
    custody: false,
    onChainVerified: false
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

async function listReceiptRecords(stateId) {
  const prefix = receiptDir(stateId);
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
      if (row?.schema !== 'fbt.cross-chain-receipt-record.v1' || row.path !== item.pathname) {
        throw new Error('INVALID_STORED_CROSS_CHAIN_RECEIPT');
      }
      return row;
    }));
    return [...new Map([...remote, ...local].map((row) => [row.path, row])).values()];
  } catch {
    throw new Error('CROSS_CHAIN_STORE_UNAVAILABLE');
  }
}

export async function storeCrossChainState(state) {
  const checked = validateCrossChainState(state);
  if (!checked.ok) return checked;
  const path = statePath(checked.state.stateId);
  try {
    const existing = await readObject(path);
    if (existing) {
      return sameCanonical(existing.state, checked.state)
        ? { ok: true, alreadyStored: true, state: existing.state }
        : { ok: false, code: 'CROSS_CHAIN_STATE_CONFLICT' };
    }
    const record = {
      schema: 'fbt.cross-chain-state-record.v1',
      path,
      storedAt: Date.now(),
      state: checked.state
    };
    const stored = await writeObject(path, record);
    if (!stored.ok) {
      if (!stored.duplicate) return stored;
      const concurrent = await readObject(path);
      return concurrent && sameCanonical(concurrent.state, checked.state)
        ? { ok: true, alreadyStored: true, state: concurrent.state }
        : { ok: false, code: 'CROSS_CHAIN_STATE_CONFLICT' };
    }
    return { ok: true, alreadyStored: false, state: checked.state };
  } catch {
    return { ok: false, code: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

export async function readCrossChainState(stateId, { now = Date.now() } = {}) {
  const id = TX_RE_64.test(String(stateId || '')) ? String(stateId).toLowerCase() : null;
  if (!id) return { error: 'BAD_CROSS_CHAIN_STATE_ID' };
  try {
    const record = await readObject(statePath(id));
    if (!record) return { error: 'CROSS_CHAIN_STATE_NOT_FOUND' };
    if (record.schema !== 'fbt.cross-chain-state-record.v1' || record.path !== statePath(id)) {
      return { error: 'INVALID_STORED_CROSS_CHAIN_STATE' };
    }
    const rows = await listReceiptRecords(id);
    const receipts = rows.map((row) => row.receipt);
    const evaluated = evaluateCrossChainState(record.state, receipts, { now });
    if (!evaluated.ok) return { error: 'INVALID_STORED_CROSS_CHAIN_STATE', detail: evaluated.code };
    return {
      schema: 'fbt.cross-chain-public-state.v1',
      durable: blobConfigured(),
      ...evaluated
    };
  } catch {
    return { error: 'CROSS_CHAIN_STORE_UNAVAILABLE' };
  }
}

export async function storeCrossChainReceipt(stateId, receipt, { now = Date.now() } = {}) {
  const current = await readCrossChainState(stateId, { now });
  if (current.error) return { ok: false, code: current.error };
  const duplicate = current.receipts.find((row) => row.receiptId === receipt?.receiptId);
  if (duplicate) return { ok: true, alreadyStored: true, receipt: duplicate, state: current };
  if (current.complete || current.receipts.length >= 2) {
    return { ok: false, code: 'CROSS_CHAIN_TRANSITION_CONFLICT' };
  }
  const checked = verifyCrossChainReceipt(receipt, {
    state: current.state,
    previousReceipts: current.receipts,
    now,
    enforceCurrentClock: true
  });
  if (!checked.ok) return checked;
  const path = receiptPath(checked.receipt);
  const record = {
    schema: 'fbt.cross-chain-receipt-record.v1',
    path,
    storedAt: now,
    receipt: checked.receipt
  };
  const stored = await writeObject(path, record);
  if (!stored.ok && !stored.duplicate) return stored;
  const refreshed = await readCrossChainState(stateId, { now });
  if (refreshed.error) return { ok: false, code: refreshed.error };
  return {
    ok: true,
    alreadyStored: Boolean(stored.duplicate),
    receipt: checked.receipt,
    state: refreshed
  };
}

export function crossChainProtocolStatus() {
  const durable = blobConfigured();
  return {
    available: true,
    configured: durable,
    schema: CROSS_CHAIN_STATE_SCHEMA,
    receiptSchema: CROSS_CHAIN_RECEIPT_SCHEMA,
    mode: CROSS_CHAIN_MODE,
    signingAlgorithm: 'Ed25519',
    sequentialUserSignatures: true,
    sourceAndDestinationReceipts: true,
    refundPath: 'counterparty-user-signed-source-transfer',
    persistenceMode: durable ? 'vercel-blob-immutable' : 'process-memory-ephemeral',
    durable,
    atomic: false,
    globalAtomicity: false,
    custody: false,
    escrow: false,
    automaticSettlement: false,
    onChainTxVerification: false,
    refundEnforcedByFbt: false,
    crossInstanceTransitionAtomicity: false,
    envelopeStatus: 'draft-only',
    envelopeBlockCode: 'ATOMIC_CROSS_CHAIN_UNAVAILABLE',
    cli: 'scripts/intent-cross-chain.mjs'
  };
}
