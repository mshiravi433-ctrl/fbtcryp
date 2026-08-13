/**
 * Signed solver quote commitments for FBT Intent Protocol v1.
 * ---------------------------------------------------------------------------
 * Ed25519 is used because signatures are deterministic, compact and supported
 * by Node's built-in crypto implementation. Solver private keys never belong
 * in the web app or in a VITE_* variable. The server registry contains public
 * keys only.
 *
 * A signature covers the canonical commitment with `signature` omitted. Any
 * change to amount, gas, expiry, route commitment or intent binding therefore
 * invalidates it.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify
} from 'node:crypto';

export const SOLVER_QUOTE_SCHEMA = 'fbt.solver-quote.v1';
export const SOLVER_SIGNING_DOMAIN = 'fbt.solver-quote.v1/signature';
export const MAX_QUOTE_VALIDITY_SECONDS = 300;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PUBLIC_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const MAX_CLOCK_SKEW_SECONDS = 30;
const CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const COMMITMENT_FIELDS = new Set([
  'schema', 'intentHash', 'solverId', 'chainId', 'amountOut', 'maxGas',
  'feeBps', 'slippageBps', 'executable', 'issuedAt', 'validUntil',
  'nonce', 'routeCommitment', 'signature'
]);

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

export function solverSigningPayload(commitment) {
  return JSON.stringify(canonicalValue({
    domain: SOLVER_SIGNING_DOMAIN,
    commitment
  }));
}

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
  let der;
  try {
    if (typeof privateKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(privateKey)) throw new Error('BAD_PRIVATE_KEY');
    der = Buffer.from(privateKey, 'base64url');
    if (der.length < 40 || der.length > 128 || der.toString('base64url') !== privateKey) throw new Error('BAD_PRIVATE_KEY');
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('BAD_PRIVATE_KEY');
    return key;
  } catch {
    throw new Error('BAD_PRIVATE_KEY');
  }
}

export function generateSolverKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey: b64url(privateDer),
    publicKey: b64url(publicDer.subarray(publicDer.length - ED25519_PUBLIC_BYTES))
  };
}

export function publicKeyFromPrivateKey(privateKey) {
  const publicDer = createPublicKey(privateKeyObject(privateKey)).export({ format: 'der', type: 'spki' });
  return b64url(publicDer.subarray(publicDer.length - ED25519_PUBLIC_BYTES));
}

export function signCanonicalPayload(domain, payload, privateKey) {
  const message = JSON.stringify(canonicalValue({ domain, payload }));
  return b64url(cryptoSign(null, Buffer.from(message), privateKeyObject(privateKey)));
}

export function verifyCanonicalSignature(domain, payload, signature, publicKey) {
  try {
    const message = JSON.stringify(canonicalValue({ domain, payload }));
    return cryptoVerify(
      null,
      Buffer.from(message),
      publicKeyObject(publicKey),
      fromB64url(signature, ED25519_SIGNATURE_BYTES, 'BAD_SIGNATURE')
    );
  } catch {
    return false;
  }
}

export function signSolverCommitment(commitment, privateKey) {
  const payload = Buffer.from(solverSigningPayload(commitment));
  return {
    ...commitment,
    signature: b64url(cryptoSign(null, payload, privateKeyObject(privateKey)))
  };
}

/**
 * Parse the public-key registry from an environment value.
 *
 * Format:
 *   [{"id":"mm-a","publicKey":"<32-byte-base64url>","name":"Market maker A"}]
 *
 * Invalid rows are ignored rather than taking down every public API route.
 * Status reports how many survived, so a typo is visible without becoming an
 * application outage.
 */
export function parseSolverRegistry(raw = process.env.INTENT_SOLVER_KEYS || '') {
  if (!raw) return new Map();
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return new Map();
    const registry = new Map();
    for (const row of rows.slice(0, 100)) {
      const id = String(row?.id || '');
      if (!/^[a-z0-9][a-z0-9._-]{1,47}$/.test(id) || registry.has(id)) continue;
      try {
        publicKeyObject(row.publicKey);
      } catch {
        continue;
      }
      registry.set(id, {
        id,
        name: String(row.name || id).replace(/[<>"'`\\]/g, '').slice(0, 80),
        publicKey: row.publicKey,
        active: row.active !== false
      });
    }
    return registry;
  } catch {
    return new Map();
  }
}

export function publicSolverRegistry(registry = parseSolverRegistry()) {
  return [...registry.values()].filter((row) => row.active).map((row) => ({
    id: row.id,
    name: row.name,
    publicKey: row.publicKey,
    algorithm: 'Ed25519'
  }));
}

function positiveIntegerString(value, maxLength = 78) {
  return typeof value === 'string' && new RegExp(`^[0-9]{1,${maxLength}}$`).test(value) && BigInt(value) > 0n;
}

/** Strict validation before any signature or storage work. */
export function validateSolverCommitment(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_BODY' };
  if (Object.keys(input).some((key) => !COMMITMENT_FIELDS.has(key))) return { ok: false, code: 'UNKNOWN_FIELD' };
  if (input.schema !== SOLVER_QUOTE_SCHEMA) return { ok: false, code: 'BAD_SCHEMA' };
  if (!/^[a-z0-9][a-z0-9._-]{1,47}$/.test(String(input.solverId || ''))) return { ok: false, code: 'BAD_SOLVER' };
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(input.intentHash || ''))) return { ok: false, code: 'BAD_INTENT_HASH' };
  if (!Number.isInteger(input.chainId) || !CHAINS.has(input.chainId)) return { ok: false, code: 'BAD_CHAIN' };
  if (!positiveIntegerString(input.amountOut)) return { ok: false, code: 'BAD_AMOUNT_OUT' };
  if (!positiveIntegerString(input.maxGas, 20)) return { ok: false, code: 'BAD_MAX_GAS' };
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 100) return { ok: false, code: 'BAD_FEE' };
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 5 || input.slippageBps > 500) {
    return { ok: false, code: 'BAD_SLIPPAGE' };
  }
  if (typeof input.executable !== 'boolean') return { ok: false, code: 'BAD_EXECUTABILITY' };
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(input.routeCommitment || ''))) return { ok: false, code: 'BAD_ROUTE_COMMITMENT' };
  if (!/^0x[a-fA-F0-9]{32,128}$/.test(String(input.nonce || ''))) return { ok: false, code: 'BAD_NONCE' };

  const issuedAt = input.issuedAt;
  const validUntil = input.validUntil;
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isInteger(issuedAt)
    || issuedAt < nowSeconds - MAX_QUOTE_VALIDITY_SECONDS
    || issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_ISSUED_AT' };
  }
  if (!Number.isInteger(validUntil) || validUntil <= issuedAt) return { ok: false, code: 'BAD_EXPIRY' };
  if (validUntil - issuedAt > MAX_QUOTE_VALIDITY_SECONDS) {
    return { ok: false, code: 'QUOTE_VALIDITY_TOO_LONG' };
  }
  if (validUntil <= nowSeconds) return { ok: false, code: 'QUOTE_EXPIRED' };
  if (validUntil > nowSeconds + MAX_QUOTE_VALIDITY_SECONDS + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, code: 'BAD_EXPIRY' };
  }

  try {
    fromB64url(input.signature, ED25519_SIGNATURE_BYTES, 'BAD_SIGNATURE');
  } catch {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }

  return { ok: true };
}

export function verifySolverCommitment(input, {
  now = Date.now(),
  registry = parseSolverRegistry()
} = {}) {
  const validation = validateSolverCommitment(input, { now });
  if (!validation.ok) return validation;

  const solver = registry.get(input.solverId);
  if (!solver || !solver.active) return { ok: false, code: 'UNREGISTERED_SOLVER' };

  try {
    const valid = cryptoVerify(
      null,
      Buffer.from(solverSigningPayload(input)),
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
