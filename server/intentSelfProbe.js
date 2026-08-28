/**
 * FBT INTENT AI — deployment self-probe.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Four of the twenty-one evidence kinds are facts a machine can establish by
 * actually contacting something: the TLS certificate this origin serves, a
 * venue's public health endpoint, the SLO of the traffic this process really
 * served, and the root hash of its own durable audit log.
 *
 * Until now the only way to earn them was scripts/collect-evidence.mjs, run
 * from a workstation. An operator without one — running the project entirely
 * from a phone and the Vercel dashboard — had no path at all. So the checks run
 * here, inside the deployment, where the network access already exists.
 *
 * THE RULE THIS DOES NOT BREAK
 * ---------------------------------------------------------------------------
 * intentAutoEvidence.js states it: a process may attest only what it actually
 * verified. That rule is about *verification*, not about who typed the command.
 * Every record below is issued only when the corresponding probe genuinely
 * succeeded in this process, in this run:
 *
 *   certificate-authority   — a real TLS handshake against this origin's public
 *                             hostname, with rejectUnauthorized, so the chain
 *                             validated against the system trust store. The
 *                             digest is the certificate's SHA-256 fingerprint.
 *   venue-health            — a real HTTPS request that returned a real body.
 *   slo-measurement         — the ring buffer of really served requests; below
 *                             the sample floor it reports nothing.
 *   durable-immutable-audit — an entry is appended to the Blob-backed log and
 *                             the chain is re-verified; the digest is the root
 *                             hash the store returned. A write plus a read-back
 *                             is the strongest available proof of durability.
 *
 * The other seventeen kinds are attestations about external parties and stay
 * exactly where they were: they require operator injection. This file never
 * touches them.
 */

import { createHash } from 'node:crypto';
import { probeCertificateAuthority, probeVenueHealth } from './evidenceProbes.js';
import { sloSnapshot } from './intentSloMeter.js';
import { auditAppend, auditVerify, auditStatus } from './intentAuditLog.js';
import { blobConfigured } from './blobCache.js';

export const SELF_PROBE_SCHEMA = 'fbt.self-probe.v1';

/** Kinds this probe can earn. Anything else is out of scope by design. */
export const SELF_PROBE_KINDS = Object.freeze([
  'certificate-authority',
  'venue-health',
  'slo-measurement',
  'durable-immutable-audit'
]);

const HOUR = 3600_000;
const MIN_INTERVAL_MS = 60_000;
const AUDIT_TIMEOUT_MS = 8_000;

/**
 * Bound a promise in time. The durable store speaks to a remote service; when
 * that service is unreachable the SDK can sit for minutes. A status endpoint
 * that hangs is worse than one that reports a failure, so the audit step is
 * given a deadline and a slow store is simply "not durable right now".
 */
function withDeadline(promise, ms, code) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true, code }), ms);
      if (timer.unref) timer.unref();
    })
  ]);
}

let lastReport = null;
let lastRunAt = 0;
let inFlight = null;

function sha256(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Work out the public origin to hand the TLS probe.
 *
 * Vercel injects VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL automatically, so
 * an operator does not have to configure anything. PUBLIC_ORIGIN overrides both
 * when the deployment sits behind a custom domain. The request Host header is
 * the last resort and is used only when it looks like a real hostname — never
 * localhost, which has no certificate to speak of.
 */
export function resolveOrigin(req = null) {
  const explicit = String(process.env.PUBLIC_ORIGIN || '').trim();
  if (/^https:\/\/[^/]+/.test(explicit)) return explicit.replace(/\/+$/, '');

  const vercelHost = String(
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || ''
  ).trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  const headerHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  if (headerHost && !/^(localhost|127\.|\[?::1\]?)/i.test(headerHost)) {
    const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return `${proto}://${headerHost}`;
  }

  return null;
}

/**
 * slo-measurement from the meter — never from a constant, never from a
 * synthetic self-request loop (which would measure the probe, not the service).
 */
function sloEvidenceFromMeter({ now, ttlHours }) {
  const snapshot = sloSnapshot({ now });
  if (!snapshot.measured) {
    return { ok: false, code: 'SLO_NOT_MEASURED', detail: snapshot };
  }
  if (snapshot.uptime === null || snapshot.uptime < 0.99) {
    return { ok: false, code: 'SLO_UPTIME_BELOW_TARGET', detail: snapshot };
  }
  if (snapshot.p95LatencyMs === null || snapshot.p95LatencyMs > 2_000) {
    return { ok: false, code: 'SLO_P95_ABOVE_TARGET', detail: snapshot };
  }
  return {
    ok: true,
    detail: snapshot,
    evidence: {
      kind: 'slo-measurement',
      providerId: 'slo-meter',
      digest: sha256('slo', JSON.stringify(snapshot)),
      checkedAt: now,
      expiresAt: now + ttlHours * HOUR,
      status: 'verified',
      health: 'healthy',
      attested: true
    }
  };
}

/**
 * durable-immutable-audit: append, then verify, then read the root back.
 * A store that cannot accept a write, or whose chain does not verify, yields
 * no evidence.
 */
async function auditEvidence({ now, ttlHours }) {
  if (!blobConfigured()) {
    return { ok: false, code: 'DURABLE_STORE_NOT_CONFIGURED', detail: { configured: false } };
  }
  try {
    const result = await withDeadline(
      auditEvidenceInner({ now, ttlHours }),
      AUDIT_TIMEOUT_MS,
      'AUDIT_STORE_TIMEOUT'
    );
    if (result?.__timedOut) {
      return { ok: false, code: result.code, detail: { timeoutMs: AUDIT_TIMEOUT_MS } };
    }
    return result;
  } catch (e) {
    /* A store that throws is a store that is not durable today. Report it;
       never let it take down the probe or the request. */
    return { ok: false, code: 'AUDIT_STORE_ERROR', detail: { message: e.message } };
  }
}

async function auditEvidenceInner({ now, ttlHours }) {
  const appended = await auditAppend({ action: 'self-probe', probe: SELF_PROBE_SCHEMA });
  if (!appended?.ok) {
    return { ok: false, code: appended?.code || 'AUDIT_APPEND_FAILED', detail: appended || {} };
  }

  const verified = await auditVerify();
  if (!verified?.ok || verified.tampered === true) {
    return { ok: false, code: 'AUDIT_TAMPER', detail: verified || {} };
  }

  const status = await auditStatus();
  const rootHash = String(status?.rootHash || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(rootHash)) {
    return { ok: false, code: 'AUDIT_ROOT_MISSING', detail: status || {} };
  }

  return {
    ok: true,
    detail: { entryCount: status.entryCount, chainValid: verified.chainValid === true },
    evidence: {
      kind: 'durable-immutable-audit',
      providerId: 'blob-audit-log',
      digest: rootHash,
      checkedAt: now,
      expiresAt: now + ttlHours * HOUR,
      status: 'verified',
      health: 'healthy',
      attested: true
    }
  };
}

/**
 * Run all four probes and store whatever was genuinely earned.
 * `store:false` makes it a pure read — useful for a dry run from a browser.
 */
export async function runSelfProbe({
  req = null,
  origin = null,
  now = Date.now(),
  ttlHours = 6,
  certTtlHours = 24,
  store = true
} = {}) {
  const target = origin || resolveOrigin(req);

  const cert = target
    ? await probeCertificateAuthority(target, { ttlHours: certTtlHours, now })
    : { ok: false, code: 'ORIGIN_UNKNOWN', detail: { hint: 'set PUBLIC_ORIGIN to the public https origin' } };
  const venue = await probeVenueHealth({ ttlHours, now });
  const slo = sloEvidenceFromMeter({ now, ttlHours });
  const audit = await auditEvidence({ now, ttlHours });

  const byKind = {
    'certificate-authority': cert,
    'venue-health': venue,
    'slo-measurement': slo,
    'durable-immutable-audit': audit
  };

  const earned = Object.values(byKind).filter((r) => r.ok).map((r) => r.evidence);

  if (store && earned.length > 0) {
    try {
      const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
      for (const record of earned) autoStoreEvidence(record);
    } catch { /* store unavailable — the report is still accurate */ }
  }

  /* Public report: verdicts, digests and measurements only. No secrets exist
     in this path, but the detail is trimmed to what a status page needs. */
  return {
    schema: SELF_PROBE_SCHEMA,
    origin: target,
    checkedAt: now,
    stored: store,
    earnedCount: earned.length,
    totalKinds: SELF_PROBE_KINDS.length,
    earned: earned.map((e) => ({ kind: e.kind, providerId: e.providerId, digest: e.digest, expiresAt: e.expiresAt })),
    missing: Object.entries(byKind)
      .filter(([, r]) => !r.ok)
      .map(([kind, r]) => ({ kind, code: r.code || 'UNKNOWN' })),
    detail: {
      certificate: cert.ok
        ? { issuer: cert.detail.issuerIdentity, validTo: cert.detail.validTo }
        : { code: cert.code, host: cert.detail?.host ?? null },
      venue: venue.ok ? { chosen: venue.detail.chosen } : { code: venue.code },
      slo: slo.ok
        ? { uptime: slo.detail.uptime, p95LatencyMs: slo.detail.p95LatencyMs, samples: slo.detail.samples }
        : { code: slo.code, samples: slo.detail?.samples ?? 0, reason: slo.detail?.reason ?? null },
      audit: audit.ok ? { entryCount: audit.detail.entryCount } : { code: audit.code }
    }
  };
}

/**
 * HTTP-facing wrapper. Cheap to call from a phone: results are cached for a
 * minute and concurrent calls share one run, so refreshing the page cannot
 * turn into an outbound request amplifier.
 */
export async function selfProbeReport({ req = null, now = Date.now(), force = false } = {}) {
  if (!force && lastReport && now - lastRunAt < MIN_INTERVAL_MS) {
    return { ...lastReport, cached: true, cachedForMs: MIN_INTERVAL_MS - (now - lastRunAt) };
  }
  if (inFlight) return { ...(await inFlight), cached: true };

  inFlight = runSelfProbe({ req, now })
    .then((report) => {
      lastReport = report;
      lastRunAt = Date.now();
      return report;
    })
    .finally(() => { inFlight = null; });

  return { ...(await inFlight), cached: false };
}

/** Tests only. */
export function resetSelfProbeCache() {
  lastReport = null;
  lastRunAt = 0;
  inFlight = null;
}
