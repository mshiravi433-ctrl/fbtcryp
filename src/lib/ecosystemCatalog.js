/**
 * READ-ONLY client for the public ecosystem catalog (/api/ecosystem/*).
 *
 * Three rules this module exists to enforce on the client side:
 *
 *   1. `unavailable` is not `empty`. The server distinguishes "no durable
 *      registry is configured" from "the registry answered with zero rows",
 *      and so does the returned `status`, so the UI can say the honest thing
 *      instead of implying nobody has registered anything.
 *   2. Verified means CERTIFIED BY A REVIEWER, and nothing else. A row is
 *      shown as verified only when the server says
 *      `verification.status === 'certified'` and names at least one issuer —
 *      the badge is derived server-side from a certification store the
 *      submitter cannot write. Any other value, including a bare
 *      `verified: true` from a future or compromised payload, renders as
 *      self-reported.
 *   3. Reputation is observed or absent. A summary is kept only when the
 *      server marks it `observed`; a sample count under the server's floor
 *      arrives as `insufficient_data` and no number is displayed.
 *   3. No writes and no execution. There is deliberately no create/update/run
 *      export here: an unused writer is one import away from becoming a
 *      feature nobody reviewed.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

const PATHS = { agent: '/ecosystem/agents', strategy: '/ecosystem/strategies', liquidity: '/ecosystem/liquidity' };
const CERTIFICATION_STATUSES = new Set(['active', 'revoked', 'expired', 'superseded']);
const EVIDENCE_TYPES = new Set(['sandbox_test_run', 'code_review', 'documentation', 'signed_attestation']);
const EXECUTION_MODES = new Set(['manual', 'simulation-only']);
const TRIGGERS = new Set(['price', 'time', 'portfolio_drift', 'gas']);
const CERTIFICATION_TYPES = new Set(['api_verified', 'sandbox_reviewed', 'security_reviewed', 'identity_verified']);
const CONFIDENCE = new Set(['low', 'medium', 'high']);

const text = (value) => {
  if (typeof value === 'string') return value.trim() ? { en: value.trim() } : null;
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const [lang, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) out[lang] = entry.trim();
  }
  return Object.keys(out).length ? out : null;
};
const chains = (value) => (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 64);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * Pick a localized string with an English fallback. Never returns a raw key:
 * a listing with no translation for the active language reads in English for
 * a moment, which is a translation gap, not a broken screen.
 */
export function localizedValue(value, lang, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value[lang] || value[String(lang).split('-')[0]] || value.en || Object.values(value)[0] || fallback;
}

/** Verified ⇔ the server derived an active certification for this listing. */
function certification(value) {
  if (!value || value.status !== 'certified') return null;
  const types = (Array.isArray(value.types) ? value.types : []).filter((type) => CERTIFICATION_TYPES.has(type));
  const issuers = (Array.isArray(value.issuers) ? value.issuers : [])
    .filter((issuer) => typeof issuer === 'string' && issuer.trim())
    .map((issuer) => issuer.trim().slice(0, 48));
  /* An issuer nobody can name is not a certification worth a badge. */
  if (!types.length || !issuers.length) return null;
  return { types, issuers, issuedAt: num(value.issuedAt), expiresAt: num(value.expiresAt) };
}

/** Observed or nothing: an under-sampled score is dropped, not rounded up. */
function reputation(value) {
  if (!value || value.status !== 'observed') return null;
  const sampleSize = num(value.sampleSize);
  const successRate = num(value.successRate);
  if (!Number.isFinite(sampleSize) || sampleSize < 5 || !Number.isFinite(successRate)) return null;
  return {
    sampleSize: Math.round(sampleSize),
    successRate: Math.min(Math.max(successRate, 0), 1),
    confidence: CONFIDENCE.has(value.confidence) ? value.confidence : 'low',
    windowDays: num(value.windowDays)
  };
}

function normalize(kind, row) {
  if (!row || typeof row !== 'object') return null;
  const id = typeof row.id === 'string' ? row.id.slice(0, 64) : null;
  const name = text(row.name);
  if (!id || !name) return null;
  const certified = certification(row.verification);
  const base = {
    id,
    name,
    description: text(row.description),
    /* Never read from the row itself — only from the derived block above. */
    verified: Boolean(certified),
    certification: certified,
    reputation: reputation(row.reputation),
    updatedAt: num(row.updatedAt)
  };

  if (kind === 'agent') {
    return {
      ...base,
      supportedChains: chains(row.supportedChains),
      executionMode: EXECUTION_MODES.has(row.executionMode) ? row.executionMode : 'simulation-only',
      /* Displayed as facts, not as toggles. Both are false by contract. */
      permissions: { withdrawFunds: false, executeWithoutUser: false, requiresUserApproval: true }
    };
  }
  if (kind === 'strategy') {
    const policy = row.policy || {};
    return {
      ...base,
      trigger: TRIGGERS.has(row.trigger?.type) ? row.trigger.type : null,
      policy: {
        maxAmountUsd: num(policy.maxAmountUsd),
        maxSlippageBps: num(policy.maxSlippageBps),
        allowedChains: chains(policy.allowedChains),
        requiresUserApproval: true
      },
      automaticExecution: false
    };
  }
  return { ...base, supportedChains: chains(row.supportedChains), rfqSettlement: 'unavailable' };
}

/**
 * Fetch one catalog.
 *
 * Resolves to `{ status, items }` where status is 'live' (a durable registry
 * answered), 'unavailable' (none is configured) or 'error' (the request
 * failed). It never rejects: a catalog is discovery, and a failed discovery
 * call must not take the tab down with it.
 */
export async function fetchCatalog(kind, { timeout = 7000, signal } = {}) {
  const path = PATHS[kind];
  if (!path) return { status: 'error', items: [] };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { status: 'error', items: [] };
    const body = await res.json();
    const items = (Array.isArray(body?.data) ? body.data : []).map((row) => normalize(kind, row)).filter(Boolean);
    return {
      status: body?.meta?.dataStatus === 'live' ? 'live' : 'unavailable',
      items,
      limitations: Array.isArray(body?.meta?.limitations) ? body.meta.limitations : []
    };
  } catch {
    return { status: 'error', items: [] };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The evidence behind a badge, for the subject the user tapped.
 *
 * A badge nobody can check is a logo. This is the public read that turns
 * "Certified" into "certified by X on this date, and here is the artefact" —
 * so a user can disagree with the reviewer instead of having to trust them.
 *
 * Evidence links are normalised to https here as well as on the server: the
 * rendered anchor must never be able to become a javascript: or data: URL
 * because a stored record changed shape.
 */
export async function fetchCertifications(subjectId, { timeout = 7000 } = {}) {
  const id = String(subjectId || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) return { status: 'error', items: [] };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/ecosystem/certifications?subjectId=${encodeURIComponent(id)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return { status: 'error', items: [] };
    const body = await res.json();
    const items = (Array.isArray(body?.data) ? body.data : [])
      .filter((row) => row && typeof row.id === 'string' && CERTIFICATION_STATUSES.has(row.status))
      .map((row) => ({
        id: row.id,
        type: typeof row.certificationType === 'string' ? row.certificationType : null,
        issuer: typeof row.issuer === 'string' ? row.issuer.slice(0, 48) : null,
        status: row.status,
        issuedAt: num(row.issuedAt),
        expiresAt: num(row.expiresAt),
        evidence: (Array.isArray(row.evidence) ? row.evidence : [])
          .filter((item) => EVIDENCE_TYPES.has(item?.type))
          .map((item) => ({
            type: item.type,
            uri: httpsOnly(item.uri),
            sha256: typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256) ? item.sha256 : null
          }))
          .filter((item) => item.uri || item.sha256)
      }));
    return { status: body?.meta?.dataStatus === 'live' ? 'live' : 'unavailable', items };
  } catch {
    return { status: 'error', items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Anything that is not an https URL becomes null rather than a rendered link. */
function httpsOnly(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
