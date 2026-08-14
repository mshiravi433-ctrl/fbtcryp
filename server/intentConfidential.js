/**
 * Offline confidential-envelope cryptographic primitives (Phase 5b).
 * ---------------------------------------------------------------------------
 * These helpers make the envelope format testable, but they are NOT an
 * operational threshold protocol:
 *
 *   - `INTENT_CONFIDENTIAL_OPERATOR_KEYS` is only a public-key registry. Keys
 *     do not prove independent services, authenticated share release, or
 *     after-close orchestration, so capabilities stay unavailable even when
 *     registry entries exist.
 *   - `fbt.confidential-envelope.v1` uses hybrid encryption: a random 256-bit
 *     AES-256-GCM data key encrypts the intent; the data key is split into
 *     N-of-N XOR shares, and each share is ECDH-wrapped to one operator with
 *     an ephemeral X25519 key.
 *   - No production route collects or reconstructs those shares. Callers of
 *     the offline reconstruction helper must already possess every private
 *     operator key; that is not threshold-service readiness.
 *   - `tee` and `attestation` are ALWAYS false. This is not attested compute.
 *
 * Key-algorithm note: the operator registry holds X25519 public keys
 * (32-byte, strict base64url) because X25519 is the correct primitive for the
 * ECDH key wrap. Ed25519 remains the signing algorithm everywhere else; a
 * DH key is not a signing key and is never used for one.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes
} from 'node:crypto';

export const CONFIDENTIAL_ENVELOPE_SCHEMA = 'fbt.confidential-envelope.v1';
const X25519_PUBLIC_BYTES = 32;

const b64url = (value) => Buffer.from(value).toString('base64url');

/** Generate an operator X25519 key pair (for the confidential skeleton CLI). */
export function generateOperatorKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey: b64url(privateKey.export({ format: 'der', type: 'pkcs8' })),
    publicKey: b64url(publicDer.subarray(publicDer.length - X25519_PUBLIC_BYTES))
  };
}

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

function x25519PrivateObject(privateKey) {
  try {
    const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'x25519') throw new Error('BAD_OPERATOR_PRIVATE_KEY');
    return key;
  } catch {
    throw new Error('BAD_OPERATOR_PRIVATE_KEY');
  }
}

/** AES-256-GCM over raw bytes (ciphertext/iv/tag are base64url). The data key
    and shares are binary, so this deliberately avoids any UTF-8 text pass. */
function aesGcmEncrypt(key, data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return { ciphertext: b64url(ct), iv: b64url(iv), tag: b64url(cipher.getAuthTag()) };
}

function fromB64urlVar(value, code) {
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length === 0) throw new Error(code);
    const out = Buffer.from(value, 'base64url');
    if (out.toString('base64url') !== value) throw new Error(code);
    return out;
  } catch {
    throw new Error(code);
  }
}

function aesGcmDecrypt(key, { ciphertext, iv, tag }) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, fromB64url(iv, 12, 'BAD_IV'));
    decipher.setAuthTag(fromB64url(tag, 16, 'BAD_TAG'));
    return Buffer.concat([decipher.update(fromB64urlVar(ciphertext, 'BAD_CIPHERTEXT')), decipher.final()]);
  } catch {
    throw new Error('AES_GCM_DECRYPT_FAILED');
  }
}

/** XOR split of a 32-byte key into N shares (N-of-N threshold). */
export function xorSplit(secret, n) {
  const buf = Buffer.from(secret);
  const shares = [];
  for (let i = 0; i < n - 1; i += 1) shares.push(randomBytes(buf.length));
  let acc = Buffer.from(buf);
  for (const share of shares) acc = Buffer.from(acc.map((b, i) => b ^ share[i]));
  shares.push(acc);
  return shares;
}

/** XOR-combine N shares back into the original key. */
export function xorCombine(shares) {
  if (!Array.isArray(shares) || shares.length === 0) throw new Error('NO_SHARES');
  const len = shares[0].length;
  const out = Buffer.alloc(len);
  for (const share of shares) {
    const buf = Buffer.from(share);
    if (buf.length !== len) throw new Error('SHARE_LENGTH_MISMATCH');
    for (let i = 0; i < len; i += 1) out[i] ^= buf[i];
  }
  return out;
}

/* X25519 SPKI prefix (OID 1.3.101.110). Distinct from Ed25519's 1.3.101.112 —
   a DH key is not a signing key and must never decode as one. */
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

function x25519PublicKeyObject(rawPublicKey) {
  const raw = fromB64url(rawPublicKey, X25519_PUBLIC_BYTES, 'BAD_PUBLIC_KEY');
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function ecdhSharedSecret(operatorPublicRaw) {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const ephemeralPublicDer = publicKey.export({ format: 'der', type: 'spki' });
  const ephemeralPublic = b64url(ephemeralPublicDer.subarray(ephemeralPublicDer.length - X25519_PUBLIC_BYTES));
  const secret = diffieHellman({ privateKey, publicKey: x25519PublicKeyObject(operatorPublicRaw) });
  return { ephemeralPublic, wrapKey: createHash('sha256').update(Buffer.concat([secret, fromB64url(ephemeralPublic, X25519_PUBLIC_BYTES, 'BAD_KEY')])).digest() };
}

/**
 * Build a confidential envelope for a set of operators. The plaintext intent
 * is AES-256-GCM encrypted under a fresh data key; the data key is split into
 * N-of-N XOR shares and each share is ECDH-wrapped to one operator.
 */
export function buildConfidentialEnvelope(plaintext, operators) {
  const list = Array.isArray(operators) ? operators : [];
  if (!list.length) return { ok: false, code: 'NO_OPERATORS' };
  const dataKey = randomBytes(32);
  const { ciphertext, iv, tag } = aesGcmEncrypt(dataKey, Buffer.from(plaintext, 'utf8'));
  const shares = xorSplit(dataKey, list.length);
  const operatorShares = list.map((operator, index) => {
    const { ephemeralPublic, wrapKey } = ecdhSharedSecret(operator.publicKey);
    const wrapped = aesGcmEncrypt(wrapKey, shares[index]);
    return {
      operatorId: operator.id,
      ephemeralPublic,
      shareCiphertext: wrapped.ciphertext,
      shareIv: wrapped.iv,
      shareTag: wrapped.tag
    };
  });
  return {
    ok: true,
    envelope: {
      schema: CONFIDENTIAL_ENVELOPE_SCHEMA,
      algorithm: 'hybrid-aes256gcm-ecdh-x25519',
      threshold: list.length,
      sharesRequired: list.length,
      scheme: 'n-of-n-xor',
      ciphertext,
      iv,
      tag,
      operatorShares,
      claims: {
        tee: false,
        attestation: false,
        custody: false,
        canDecryptAfterClose: true
      }
    }
  };
}

/**
 * Reconstruct the plaintext by recovering the XOR shares with the provided
 * operator PRIVATE keys (which live in the operators' own secrets managers —
 * never here, never in VITE_*). This is server-side reconstruction with an
 * honest declaration: it is NOT a TEE.
 */
export function reconstructConfidentialEnvelope(envelope, operatorPrivateKeys) {
  if (!envelope || envelope.schema !== CONFIDENTIAL_ENVELOPE_SCHEMA) {
    return { ok: false, code: 'BAD_ENVELOPE' };
  }
  const shares = [];
  for (const share of envelope.operatorShares || []) {
    const priv = operatorPrivateKeys.find((row) => row.operatorId === share.operatorId);
    if (!priv?.privateKey) return { ok: false, code: 'MISSING_OPERATOR_SHARE' };
    try {
      const key = x25519PrivateObject(priv.privateKey);
      const secret = diffieHellman({ privateKey: key, publicKey: x25519PublicKeyObject(share.ephemeralPublic) });
      const wrapKey = createHash('sha256').update(Buffer.concat([secret, fromB64url(share.ephemeralPublic, X25519_PUBLIC_BYTES, 'BAD_KEY')])).digest();
      shares.push(aesGcmDecrypt(wrapKey, {
        ciphertext: share.shareCiphertext, iv: share.shareIv, tag: share.shareTag
      }));
    } catch (error) {
      return { ok: false, code: error?.message || 'SHARE_DECRYPT_FAILED' };
    }
  }
  if (shares.length !== envelope.sharesRequired) return { ok: false, code: 'THRESHOLD_NOT_MET' };
  const dataKey = xorCombine(shares);
  try {
    const plaintext = aesGcmDecrypt(dataKey, { ciphertext: envelope.ciphertext, iv: envelope.iv, tag: envelope.tag }).toString('utf8');
    return {
      ok: true,
      plaintext,
      claims: {
        tee: false,
        attestation: false,
        custody: false,
        serverSideReconstruction: true
      }
    };
  } catch (error) {
    return { ok: false, code: error?.message || 'ENVELOPE_DECRYPT_FAILED' };
  }
}

/**
 * Parse the operator public-key registry from `INTENT_CONFIDENTIAL_OPERATOR_KEYS`.
 * Format:
 *   [{"id":"op-1","publicKey":"<32-byte-X25519-base64url>","name":"Operator One"}]
 * Invalid rows are dropped; `status` reports how many survived.
 */
export function parseOperatorRegistry(raw = process.env.INTENT_CONFIDENTIAL_OPERATOR_KEYS || '') {
  if (!raw) return new Map();
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return new Map();
    const registry = new Map();
    for (const row of rows.slice(0, 32)) {
      const id = String(row?.id || '');
      if (!/^[a-z0-9][a-z0-9._-]{1,47}$/.test(id) || registry.has(id)) continue;
      try {
        fromB64url(row.publicKey, X25519_PUBLIC_BYTES, 'BAD_KEY');
      } catch {
        continue;
      }
      registry.set(id, {
        id,
        name: String(row.name || id).replace(/[<>\"'`\\]/g, '').slice(0, 80),
        publicKey: row.publicKey,
        algorithm: 'X25519'
      });
    }
    return registry;
  } catch {
    return new Map();
  }
}

export function publicOperatorRegistry(registry = parseOperatorRegistry()) {
  return [...registry.values()].map((row) => ({
    id: row.id, name: row.name, publicKey: row.publicKey, algorithm: 'X25519'
  }));
}

/**
 * Capability status is operational, not aspirational. X25519 public keys only
 * configure a registry; they do not create independent operator services,
 * authenticated share release, close-bound decryption, or attestation.
 */
export function confidentialProtocolStatus({ operatorRegistry = parseOperatorRegistry() } = {}) {
  return {
    available: false,
    frontendIntegrated: false,
    durablePrivateStorage: false,
    requesterAuthentication: false,
    earlyRevealProtection: false,
    hiddenFromFbt: false,
    metadataPrivacy: false,
    tee: false,
    attestation: false,
    unavailableReason: 'CONFIDENTIAL_PREREQUISITES_UNAVAILABLE',
    envelopeSchema: CONFIDENTIAL_ENVELOPE_SCHEMA,
    encryptionPrimitive: 'hybrid-aes256gcm-ecdh-x25519',
    sharingPrimitive: 'n-of-n-xor',
    operatorRegistry: 'INTENT_CONFIDENTIAL_OPERATOR_KEYS',
    thresholdEncryption: {
      configured: false,
      registryConfigured: operatorRegistry.size > 0,
      operational: false,
      registeredOperators: operatorRegistry.size,
      independentOperatorServices: false,
      authenticatedShareRelease: false,
      algorithm: 'X25519-ECDH primitives only',
      custody: false,
      decryptAfterCloseOnly: false,
      serverSideReconstruction: false,
      tee: false,
      attestation: false
    },
    commitReveal: {
      schema: 'fbt.intent-commitment.v1',
      available: false,
      frontendIntegrated: false,
      durablePrivateStorage: false,
      requesterAuthentication: false,
      earlyRevealProtection: false,
      preimageHolder: 'none-operational',
      commitRevealMetadataPrivacy: false,
      hiddenFromFbt: false,
      metadataPrivacy: false,
      tee: false,
      attestation: false
    }
  };
}
