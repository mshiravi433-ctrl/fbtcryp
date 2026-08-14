/**
 * Signed outcome bids for the FBT outcome marketplace (Phase 5 of Intent OS:
 * Outcome Marketplace).
 * ---------------------------------------------------------------------------
 * An outcome bid is NOT a spot quote. It is a bounded, signed promise about a
 * future outcome — e.g. "deliver at least 10 ETH by time T for at most
 * 20,000 USDC" — where the solver keeps its method private but binds itself
 * to a guaranteed minimum, a total maximum cost, an expiry, a settlement
 * chain and a partial-fill policy.
 *
 * Honesty boundary, identical to every other signed record in this protocol:
 *   - The bid is SIGNED EVIDENCE, never a machine-verified guarantee and
 *     never a transfer of funds. `custody: false` is structural.
 *   - FBT accepts a bid ONLY from a solver that is (a) registered in
 *     INTENT_SOLVER_KEYS and (b) declared BONDED in INTENT_SOLVER_BONDS at
 *     admission time. A bondless solver is never admitted to an outcome
 *     market.
 *   - Every money field is BOUNDED server-side. `guaranteedMinimum`,
 *     `totalMaxCost`, `expiry`, `settlementChainId` and `partialFillPolicy`
 *     are validated against fixed limits before any signature or storage
 *     work; the client cannot widen a field the protocol has not defined.
 *   - The public `POST /bids` endpoint stays closed. Outcome bids enter
 *     exclusively through the authenticated, signed submission path with a
 *     transactional admission receipt and a replay-proof nonce.
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify
} from 'node:crypto';
import {
  canonicalValue,
  publicKeyFromPrivateKey
} from './intentSignatures.js';

export const OUTCOME_BID_SCHEMA = 'fbt.outcome-bid.v1';
export const OUTCOME_BID_SIGNING_DOMAIN = 'fbt.outcome-bid.v1/signature';
export const OUTCOME_BID_MAX_VALIDITY_SECONDS = 300;
export const OUTCOME_MAX_EXPIRY_DAYS = 30;
export const PARTIAL_FILL_POLICIES = Object.freeze(['full-only', 'partial-allowed']);
const ED25519_SIGNATURE_BYTES = 64;
const MAX_CLOCK_SKEW_SECONDS = 30;
const CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);

const OUTCOME_BID_FIELDS = new Set([
  'schema', 'intentHash', 'solverId', 'chainId', 'settlementChainId',
  'guaranteedMinimum', 'totalMaxCost', 'feeBps', 'slippageBps',
  'partialFillPolicy', 'expiry', 'executable', 'issuedAt', 'validUntil',
  'nonce', 'routeCommitment', 'signature'
]);

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PUBLIC_BYTES = 32;

const b64url = (value) => Buffer.from(value).toString('base64url');

function fromB64url(value, bytes, code) {
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(code);
    const out = Buffer.from(value, 'base64url');
    if (out.length !== bytes || out.toString('base64url') !== value) throw new Error(code);
    return out;
  } catch {
    throw new Error(code);
  }
}

function publicKeyObject(rawPublicKey) {
  const raw = fromB64url(rawPublicKey, ED25519_PUBLIC_BYTES, 'BAD_PUBLIC_KEY');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki'
  });
}

function privateKeyObject(privateKey) {
  try {
    const der = Buffer.from(privateKey, 'base64url');
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('BAD_PRIVATE_KEY');
    return key;
  } catch {
    throw new Error('BAD_PRIVATE_KEY');
  }
}

function positiveIntegerString(value, maxLength = 78) {
  return typeof value === 'string'
    && new RegExp(`^[0-9]{1,${maxLength}}$`).test(value)
    && BigInt(value) > 0n;
}

/** Canonical signing payload for an outcome bid. */
export function outcomeBidSigningPayload(bid) {
  return JSON.stringify(canonicalValue({
    domain: OUTCOME_BID_SIGNING_DOMAIN,
    bid
  }));
}

/** Sign a bounded outcome bid with a solver Ed25519 private key. */
export function signOutcomeBid(bid, privateKey) {
  const payload = Buffer.from(outcomeBidSigningPayload(bid));
  return {
    ...bid,
    signature: b64url(cryptoSign(null, payload, privateKeyObject(privateKey)))
  };
}

/**
 * Strict bounded structural validation of an outcome bid BEFORE any signature
 * or storage work. Every money-relevant field is fixed here: the maximum
 * validity of the bid window, the maximum outcome expiry, the bounded fee and
 * slippage, the settlement chain membership, and the closed partial-fill
 * vocabulary.
 */
export function validateOutcomeBid(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_BODY' };
  if (Object.keys(input).some((key) => !OUTCOME_BID_FIELDS.has(key))) return { ok: false, code: 'UNKNOWN_FIELD' };
  if (input.schema !== OUTCOME_BID_SCHEMA) return { ok: false, code: 'BAD_SCHEMA' };
  if (!ID_RE.test(String(input.solverId || ''))) return { ok: false, code: 'BAD_SOLVER' };
  if (!TX_RE_64.test(String(input.intentHash || ''))) return { ok: false, code: 'BAD_INTENT_HASH' };
  if (!Number.isInteger(input.chainId) || !CHAINS.has(input.chainId)) return { ok: false, code: 'BAD_CHAIN' };
  if (!Number.isInteger(input.settlementChainId) || !CHAINS.has(input.settlementChainId)) {
    return { ok: false, code: 'BAD_SETTLEMENT_CHAIN' };
  }
  /* The two money limits are bounded and cannot be widened by the caller. */
  if (!positiveIntegerString(input.guaranteedMinimum)) return { ok: false, code: 'BAD_GUARANTEED_MINIMUM' };
  if (!positiveIntegerString(input.totalMaxCost)) return { ok: false, code: 'BAD_TOTAL_MAX_COST' };
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 100) return { ok: false, code: 'BAD_FEE' };
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 5 || input.slippageBps > 500) {
    return { ok: false, code: 'BAD_SLIPPAGE' };
  }
  if (!PARTIAL_FILL_POLICIES.includes(input.partialFillPolicy)) return { ok: false, code: 'BAD_PARTIAL_FILL' };
  if (typeof input.executable !== 'boolean') return { ok: false, code: 'BAD_EXECUTABILITY' };
  if (!/^0x[a-fA-F0-9]{32,128}$/.test(String(input.nonce || ''))) return { ok: false, code: 'BAD_NONCE' };
  if (input.routeCommitment != null && !TX_RE_64.test(String(input.routeCommitment))) {
    return { ok: false, code: 'BAD_ROUTE_COMMITMENT' };
  }

  const issuedAt = input.issuedAt;
  const validUntil = input.validUntil;
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isInteger(issuedAt)
    || issuedAt < nowSeconds - OUTCOME_BID_MAX_VALIDITY_SECONDS
    || issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_ISSUED_AT' };
  }
  if (!Number.isInteger(validUntil) || validUntil <= issuedAt) return { ok: false, code: 'BAD_EXPIRY' };
  if (validUntil - issuedAt > OUTCOME_BID_MAX_VALIDITY_SECONDS) {
    return { ok: false, code: 'BID_VALIDITY_TOO_LONG' };
  }
  if (validUntil <= nowSeconds) return { ok: false, code: 'BID_EXPIRED' };
  if (validUntil > nowSeconds + OUTCOME_BID_MAX_VALIDITY_SECONDS + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_EXPIRY' };
  }

  /* The outcome settlement deadline is bounded server-side. */
  const expiry = input.expiry;
  if (!Number.isSafeInteger(expiry) || expiry <= nowSeconds) return { ok: false, code: 'BAD_OUTCOME_EXPIRY' };
  if (expiry > nowSeconds + OUTCOME_MAX_EXPIRY_DAYS * 86400) return { ok: false, code: 'OUTCOME_EXPIRY_TOO_FAR' };

  try {
    fromB64url(input.signature, ED25519_SIGNATURE_BYTES, 'BAD_SIGNATURE');
  } catch {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }
  return { ok: true };
}

/**
 * Full verification: structural bounds + registered solver + valid Ed25519
 * signature + solver declared BONDED at admission time. A solver that is not
 * both registered and bonded is rejected with an explicit, honest code.
 */
export function verifyOutcomeBid(input, {
  now = Date.now(),
  registry = new Map(),
  bondedSolvers = null
} = {}) {
  const validation = validateOutcomeBid(input, { now });
  if (!validation.ok) return validation;

  const solver = registry.get(input.solverId);
  if (!solver || !solver.active) return { ok: false, code: 'UNREGISTERED_SOLVER' };
  /* Outcome markets require a declared bond. `bondedSolvers` is a Set of
     solverIds whose declared bond is live at admission time (derived from
     the same deterministic board the public bonds endpoint serves). */
  if (!bondedSolvers || !bondedSolvers.has(input.solverId)) {
    return { ok: false, code: 'SOLVER_NOT_BONDED' };
  }

  try {
    const valid = cryptoVerify(
      null,
      Buffer.from(outcomeBidSigningPayload(input)),
      publicKeyObject(solver.publicKey),
      fromB64url(input.signature, ED25519_SIGNATURE_BYTES, 'BAD_SIGNATURE')
    );
    return valid
      ? { ok: true, solver: { id: solver.id, name: solver.name, publicKey: solver.publicKey } }
      : { ok: false, code: 'SIGNATURE_MISMATCH' };
  } catch {
    return { ok: false, code: 'SIGNATURE_MISMATCH' };
  }
}

/** CLI-only identity: derive the solver public key from a private key. */
export function outcomeSolverConfigFromPrivateKey(privateKey = process.env.INTENT_SOLVER_PRIVATE_KEY || '') {
  if (!privateKey) return null;
  const id = String(process.env.INTENT_SOLVER_ID || 'independent-solver').toLowerCase();
  if (!ID_RE.test(id)) return null;
  try {
    return {
      id,
      name: String(process.env.INTENT_SOLVER_NAME || id).replace(/[<>\"'`\\]/g, '').slice(0, 80),
      privateKey,
      publicKey: publicKeyFromPrivateKey(privateKey)
    };
  } catch {
    return null;
  }
}
