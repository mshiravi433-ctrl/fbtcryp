/**
 * Phase 6 independent-operator bindings.
 * --------------------------------------------------------------------------
 * A public-key registry authenticates a signature; it does NOT prove that the
 * organisation holding that key is independent from FBT. This module adds a
 * signed, expiring operator attestation for every watcher/verifier key and
 * checks cryptographic key separation from solvers and the coordinator.
 *
 * Even a valid attestation is still the operator's public statement. The
 * protocol can prove key control and registry binding, not corporate/legal
 * independence. Capabilities therefore keep
 * `organizationalIndependenceProven: false` unconditionally.
 */

import { createHash } from 'node:crypto';
import {
  canonicalValue,
  isValidEd25519PublicKey,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';

export const OPERATOR_ATTESTATION_SCHEMA = 'fbt.operator-attestation.v1';
export const OPERATOR_ATTESTATION_DOMAIN = 'fbt.operator-attestation.v1/signature';
export const OPERATOR_ROLES = Object.freeze(['watcher', 'verifier']);
const ATTESTATION_ID_DOMAIN = 'fbt.operator-attestation.v1/id';
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const MAX_ATTESTATION_SECONDS = 366 * 86400;
const MAX_CLOCK_SKEW_SECONDS = 300;
const FIELDS = new Set([
  'schema', 'operatorId', 'operatorName', 'operatorUrl', 'role', 'registryId',
  'publicKey', 'relationship', 'issuedAt', 'expiresAt', 'claims',
  'attestationId', 'signature'
]);
const INPUT_FIELDS = new Set([
  'operatorId', 'operatorName', 'operatorUrl', 'role', 'registryId',
  'publicKey', 'issuedAt', 'expiresAt'
]);
const CLAIM_FIELDS = new Set([
  'keyControlProven', 'organizationalIndependenceSelfAttested',
  'organizationalIndependenceProven', 'fundsAccess'
]);

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

function safeName(value) {
  const cleaned = String(value || '').replace(/[<>"'`\\\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, 100) : null;
}

function safeHttps(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString().replace(/\/$/, '').slice(0, 300);
  } catch {
    return null;
  }
}

function attestationIdFor(core) {
  return sha256Hex(`${ATTESTATION_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function coreFrom(input) {
  const {
    attestationId: _attestationId,
    signature: _signature,
    ...core
  } = input;
  return core;
}

/** Strict structural + Ed25519 verification at a caller-selected time. */
export function verifyOperatorAttestation(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_OPERATOR_ATTESTATION' };
  }
  if (Object.keys(input).some((key) => !FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_OPERATOR_ATTESTATION_FIELD' };
  }
  if (input.schema !== OPERATOR_ATTESTATION_SCHEMA
    || !ID_RE.test(String(input.operatorId || ''))
    || !ID_RE.test(String(input.registryId || ''))
    || !OPERATOR_ROLES.includes(input.role)
    || input.relationship !== 'independent-third-party') {
    return { ok: false, code: 'BAD_OPERATOR_ATTESTATION' };
  }
  if (!safeName(input.operatorName) || safeName(input.operatorName) !== input.operatorName
    || !safeHttps(input.operatorUrl) || safeHttps(input.operatorUrl) !== input.operatorUrl
    || !isValidEd25519PublicKey(input.publicKey)) {
    return { ok: false, code: 'BAD_OPERATOR_IDENTITY' };
  }
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(input.issuedAt) || !Number.isSafeInteger(input.expiresAt)
    || input.expiresAt <= input.issuedAt
    || input.expiresAt - input.issuedAt > MAX_ATTESTATION_SECONDS
    || input.issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || input.expiresAt <= nowSeconds) {
    return { ok: false, code: 'OPERATOR_ATTESTATION_EXPIRED' };
  }
  const claims = input.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).some((key) => !CLAIM_FIELDS.has(key))
    || claims.keyControlProven !== true
    || claims.organizationalIndependenceSelfAttested !== true
    || claims.organizationalIndependenceProven !== false
    || claims.fundsAccess !== false) {
    return { ok: false, code: 'BAD_OPERATOR_ATTESTATION_CLAIMS' };
  }
  const core = coreFrom(input);
  if (!TX_RE_64.test(String(input.attestationId || ''))
    || attestationIdFor(core) !== input.attestationId) {
    return { ok: false, code: 'BAD_OPERATOR_ATTESTATION_ID' };
  }
  if (!verifyCanonicalSignature(
    OPERATOR_ATTESTATION_DOMAIN,
    { ...core, attestationId: input.attestationId },
    input.signature,
    input.publicKey
  )) {
    return { ok: false, code: 'OPERATOR_ATTESTATION_SIGNATURE_MISMATCH' };
  }
  return { ok: true, attestation: input };
}

/**
 * Sign an attestation in the independent operator's own environment. The
 * private key is never accepted by the API or placed in a server registry.
 */
export function buildOperatorAttestation(input, privateKey, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_OPERATOR_ATTESTATION' };
  }
  if (Object.keys(input).some((key) => !INPUT_FIELDS.has(key))) {
    return { ok: false, code: 'UNKNOWN_OPERATOR_ATTESTATION_FIELD' };
  }
  let publicKey;
  try { publicKey = publicKeyFromPrivateKey(privateKey); } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  if (input.publicKey != null && input.publicKey !== publicKey) {
    return { ok: false, code: 'OPERATOR_KEY_MISMATCH' };
  }
  const nowSeconds = Math.floor(now / 1000);
  const core = {
    schema: OPERATOR_ATTESTATION_SCHEMA,
    operatorId: String(input.operatorId || '').toLowerCase(),
    operatorName: safeName(input.operatorName),
    operatorUrl: safeHttps(input.operatorUrl),
    role: input.role,
    registryId: String(input.registryId || '').toLowerCase(),
    publicKey,
    relationship: 'independent-third-party',
    issuedAt: input.issuedAt == null ? nowSeconds : Number(input.issuedAt),
    expiresAt: Number(input.expiresAt),
    claims: {
      keyControlProven: true,
      organizationalIndependenceSelfAttested: true,
      organizationalIndependenceProven: false,
      fundsAccess: false
    }
  };
  const attestationId = attestationIdFor(core);
  let attestation;
  try {
    attestation = {
      ...core,
      attestationId,
      signature: signCanonicalPayload(
        OPERATOR_ATTESTATION_DOMAIN,
        { ...core, attestationId },
        privateKey
      )
    };
  } catch {
    return { ok: false, code: 'BAD_PRIVATE_KEY' };
  }
  return verifyOperatorAttestation(attestation, { now });
}

/** Parse only current, correctly signed public attestations from server env. */
export function parseOperatorAttestations(
  raw = process.env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS || '',
  { now = Date.now() } = {}
) {
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    const valid = [];
    for (const row of rows.slice(0, 200)) {
      const checked = verifyOperatorAttestation(row, { now });
      if (!checked.ok) continue;
      const key = `${row.role}:${row.registryId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push(row);
    }
    return valid.sort((a, b) => `${a.role}:${a.registryId}`.localeCompare(`${b.role}:${b.registryId}`));
  } catch {
    return [];
  }
}

function activeRows(registry) {
  return [...(registry?.values?.() || [])].filter((row) => row.active !== false);
}

/**
 * Correlate signed operator statements with the active watcher/verifier
 * registries. `configured` means every active observer key has a current
 * signed binding and is cryptographically separate from solver/coordinator
 * keys. It does NOT mean organizational independence was proven.
 */
export function independentVerificationStatus({
  watcherRegistry = new Map(),
  verifierRegistry = new Map(),
  solverRegistry = new Map(),
  coordinator = null,
  attestations = parseOperatorAttestations(),
  now = Date.now()
} = {}) {
  const observerRows = [
    ...activeRows(watcherRegistry).map((row) => ({ role: 'watcher', registryId: row.id, publicKey: row.publicKey })),
    ...activeRows(verifierRegistry).map((row) => ({ role: 'verifier', registryId: row.id, publicKey: row.publicKey }))
  ];
  const solverKeys = new Set(activeRows(solverRegistry).map((row) => row.publicKey));
  if (coordinator?.publicKey) solverKeys.add(coordinator.publicKey);
  const validAttestations = Array.isArray(attestations)
    ? attestations.filter((row) => verifyOperatorAttestation(row, { now }).ok)
    : [];
  const byBinding = new Map(validAttestations.map((row) => [`${row.role}:${row.registryId}`, row]));
  const bindings = observerRows.map((row) => {
    const attestation = byBinding.get(`${row.role}:${row.registryId}`) || null;
    const keyMatches = attestation?.publicKey === row.publicKey;
    const keySeparated = !solverKeys.has(row.publicKey);
    return {
      ...row,
      operatorId: keyMatches ? attestation.operatorId : null,
      operatorName: keyMatches ? attestation.operatorName : null,
      operatorUrl: keyMatches ? attestation.operatorUrl : null,
      attestationId: keyMatches ? attestation.attestationId : null,
      expiresAt: keyMatches ? attestation.expiresAt : null,
      cryptographicallyBound: Boolean(keyMatches),
      keySeparatedFromFbtCoordinatorAndSolvers: keySeparated
    };
  });
  const allBound = bindings.length > 0 && bindings.every((row) => row.cryptographicallyBound);
  const allSeparated = bindings.length > 0
    && bindings.every((row) => row.keySeparatedFromFbtCoordinatorAndSolvers);
  const operatorIds = new Set(bindings.map((row) => row.operatorId).filter(Boolean));
  return {
    schema: OPERATOR_ATTESTATION_SCHEMA,
    configured: allBound && allSeparated,
    registeredObserverKeys: bindings.length,
    signedOperatorBindings: bindings.filter((row) => row.cryptographicallyBound).length,
    distinctAttestedOperators: operatorIds.size,
    allObserverKeysAttested: allBound,
    keySeparationVerified: allSeparated,
    keyControlProven: allBound,
    organizationalIndependenceSelfAttested: allBound,
    organizationalIndependenceProven: false,
    independenceBasis: allBound
      ? 'signed-operator-statement-not-corporate-independence-proof'
      : 'unconfigured',
    note: 'A registry and a valid signature prove key control, not organizational independence. Independent operation must be established and audited outside this protocol.',
    bindings,
    cli: 'scripts/intent-operator.mjs'
  };
}

export function publicOperatorAttestations(attestations = parseOperatorAttestations()) {
  return attestations.map((row) => ({ ...row }));
}
