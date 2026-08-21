/**
 * CERTIFICATIONS — the only thing in this system allowed to say "verified".
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 * A catalog listing is self-reported. Its own fields can never make it
 * verified — otherwise "verified" means "the submitter typed true". A listing
 * is certified when, and only when, a SEPARATE record exists that was issued
 * by an allowlisted reviewer, carries evidence, and has not been revoked or
 * expired. `certifiedSubjects()` derives that badge from this store; the
 * registry never reads it from the listing.
 *
 * WHO MAY ISSUE
 * ---------------------------------------------------------------------------
 * `ECOSYSTEM_CERTIFIERS` — a comma-separated list of `telegramUserId:Label`
 * pairs, e.g. `12345:FBT Review,67890:External Audit`. Unset means NOBODY can
 * issue, which means nothing can ever be published as certified. That is the
 * intended default: an unconfigured review pipeline must produce an empty
 * catalog, not a self-certified one.
 *
 * The issuer stored on the record is the LABEL, never the reviewer's Telegram
 * id — a certification is a public document and must not leak an operator's
 * account id.
 *
 * WHAT EVIDENCE IS
 * ---------------------------------------------------------------------------
 * An allowlisted evidence type plus either an https URI or a sha256 digest.
 * Free text is refused: evidence people cannot check is decoration, and an
 * open string field is how PII ends up in a public record.
 */

import { randomUUID } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
import { SCHEMAS, validateCertification } from './phase2Schemas.js';

export const CERTIFICATION_STORE_KEY = 'ecosystem-certifications:v1';
export const CERTIFICATION_TYPES = Object.freeze(['api_verified', 'sandbox_reviewed', 'security_reviewed', 'identity_verified']);
export const EVIDENCE_TYPES = Object.freeze(['sandbox_test_run', 'code_review', 'documentation', 'signed_attestation']);
export const CERTIFICATION_LIMITATIONS = Object.freeze([
  'A certification describes a review that happened; it is not a guarantee of behaviour.',
  'A certification never grants signing, execution, settlement or withdrawal authority.'
]);

const SUBJECT_TYPES = new Set(['agent', 'strategy', 'liquidity', 'project', 'solver']);
const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ROWS = 500;
const MAX_EVIDENCE = 8;
const MAX_TTL_MS = 365 * 24 * 3600_000;

const durableStore = Object.freeze({ durable: blobConfigured, get: storeGet, set: storeSet });
const fail = (code) => ({ ok: false, code });

/**
 * Parse the reviewer allowlist. Returns a Map of telegram id → public label.
 * A malformed entry is skipped rather than guessed at: a certifier you cannot
 * name is a certifier you cannot audit.
 */
export function certifierRegistry(raw = process.env.ECOSYSTEM_CERTIFIERS || '') {
  const out = new Map();
  for (const chunk of String(raw).split(',')) {
    const [id, ...rest] = chunk.split(':');
    const userId = String(id || '').trim();
    const label = rest.join(':').trim().slice(0, 48);
    if (!/^\d{1,20}$/.test(userId) || !label) continue;
    out.set(userId, label);
  }
  return out;
}

export const certificationsConfigured = () => certifierRegistry().size > 0;
export const certifierLabel = (userId) => certifierRegistry().get(String(userId)) || null;

function evidenceList(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value.slice(0, MAX_EVIDENCE)) {
    if (!item || typeof item !== 'object') continue;
    if (!EVIDENCE_TYPES.includes(item.type)) continue;
    let uri = null;
    if (typeof item.uri === 'string' && item.uri.length <= 300) {
      try { const parsed = new URL(item.uri); if (parsed.protocol === 'https:') uri = parsed.toString(); } catch { uri = null; }
    }
    const digest = typeof item.sha256 === 'string' && SHA256.test(item.sha256.toLowerCase()) ? item.sha256.toLowerCase() : null;
    if (!uri && !digest) continue;
    out.push({ type: item.type, uri, sha256: digest, at: Number.isFinite(Number(item.at)) ? Number(item.at) : Date.now() });
  }
  return out.length ? out : null;
}

async function readRows(store) {
  const rows = await store.get(CERTIFICATION_STORE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

/** Expiry is evaluated at read time so a stale row can never look active. */
const activeNow = (row, now) => row?.status === 'active' && (!row.expiresAt || row.expiresAt > now);

export function publicCertification(row) {
  if (!row) return null;
  const { issuerRef, ...rest } = row;
  return rest;
}

/**
 * Issue a certification.
 *
 * `issuerId` is the authenticated Telegram id of the reviewer; it is checked
 * against the allowlist and then replaced by the public label. The stored
 * record is `validateCertification`'s output, never the raw input.
 */
export async function issueCertification(issuerId, input = {}, store = durableStore) {
  const label = certifierLabel(issuerId);
  if (!label) return fail('CERTIFIER_NOT_AUTHORIZED');
  if (!store.durable()) return fail('REGISTRY_STORE_UNAVAILABLE');

  const subjectId = String(input.subjectId || '').toLowerCase();
  if (!ID.test(subjectId)) return fail('INVALID_SUBJECT');
  const subjectType = SUBJECT_TYPES.has(input.subjectType) ? input.subjectType : null;
  if (!subjectType) return fail('INVALID_SUBJECT_TYPE');
  if (!CERTIFICATION_TYPES.includes(input.certificationType)) return fail('INVALID_CERTIFICATION_TYPE');

  const evidence = evidenceList(input.evidence);
  if (!evidence) return fail('EVIDENCE_REQUIRED');
  const issuedAt = Date.now();
  const requestedExpiry = Number(input.expiresAt);
  const expiresAt = Number.isFinite(requestedExpiry) && requestedExpiry > issuedAt
    ? Math.min(requestedExpiry, issuedAt + MAX_TTL_MS)
    : issuedAt + MAX_TTL_MS;

  const candidate = {
    schema: SCHEMAS.certification,
    id: `cert_${randomUUID()}`,
    subjectId,
    subjectType,
    certificationType: input.certificationType,
    issuer: label,
    issuedAt,
    expiresAt,
    status: 'active',
    evidence,
    limitations: [...CERTIFICATION_LIMITATIONS]
  };
  /* The shared fail-closed validator has the final say: an active
     certification without an evidence array is refused here too. */
  const validated = validateCertification(candidate);
  if (!validated.ok) return validated;

  const rows = await readRows(store);
  /* One active certification per (subject, type): re-issuing supersedes the
     previous one instead of stacking duplicates that all read as "certified". */
  const superseded = rows.map((row) => (row.subjectId === subjectId && row.certificationType === candidate.certificationType && row.status === 'active')
    ? { ...row, status: 'superseded', supersededAt: issuedAt }
    : row);
  await store.set(CERTIFICATION_STORE_KEY, [candidate, ...superseded].slice(0, MAX_ROWS));
  return { ok: true, certification: publicCertification(candidate) };
}

/** Revoke: only an allowlisted reviewer, and the record is kept for the trail. */
export async function revokeCertification(issuerId, certificationId, store = durableStore) {
  if (!certifierLabel(issuerId)) return fail('CERTIFIER_NOT_AUTHORIZED');
  if (!store.durable()) return fail('REGISTRY_STORE_UNAVAILABLE');
  const rows = await readRows(store);
  const found = rows.find((row) => row?.id === String(certificationId));
  if (!found) return fail('CERTIFICATION_NOT_FOUND');
  const revoked = { ...found, status: 'revoked', revokedAt: Date.now() };
  await store.set(CERTIFICATION_STORE_KEY, rows.map((row) => (row?.id === revoked.id ? revoked : row)));
  return { ok: true, certification: publicCertification(revoked) };
}

/** Public read, optionally filtered by subject. */
export async function listCertifications({ subjectId = null, subjectType = null, now = Date.now() } = {}, store = durableStore) {
  if (!store.durable()) return { ok: true, dataStatus: 'unavailable', data: [] };
  const wanted = subjectId ? String(subjectId).toLowerCase() : null;
  if (wanted && !ID.test(wanted)) return { ok: false, code: 'INVALID_SUBJECT', dataStatus: 'live', data: [] };
  const rows = (await readRows(store))
    .filter((row) => (!wanted || row?.subjectId === wanted) && (!subjectType || row?.subjectType === subjectType))
    /* Expiry is applied on read, so an expired row reports itself expired. */
    .map((row) => (row?.status === 'active' && !activeNow(row, now) ? { ...row, status: 'expired' } : row))
    .sort((a, b) => (b?.issuedAt || 0) - (a?.issuedAt || 0))
    .map(publicCertification);
  return { ok: true, dataStatus: 'live', data: rows };
}

/**
 * The trust lookup the registry uses: subjectId → active certification summary.
 * Returns a Map so a catalog page costs ONE store read regardless of size.
 */
export async function certifiedSubjects({ now = Date.now() } = {}, store = durableStore) {
  if (!store.durable()) return new Map();
  const out = new Map();
  for (const row of await readRows(store)) {
    if (!activeNow(row, now)) continue;
    const current = out.get(row.subjectId) || { status: 'certified', types: [], issuers: [], issuedAt: 0, expiresAt: null };
    if (!current.types.includes(row.certificationType)) current.types.push(row.certificationType);
    if (!current.issuers.includes(row.issuer)) current.issuers.push(row.issuer);
    current.issuedAt = Math.max(current.issuedAt, row.issuedAt || 0);
    current.expiresAt = current.expiresAt === null ? (row.expiresAt ?? null) : Math.max(current.expiresAt, row.expiresAt ?? 0);
    out.set(row.subjectId, current);
  }
  return out;
}

/** Single-subject check used by the publish gate. */
export async function hasActiveCertification(subjectId, options = {}, store = durableStore) {
  const map = await certifiedSubjects(options, store);
  return map.has(String(subjectId).toLowerCase());
}
