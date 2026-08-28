/**
 * FBT INTENT AI — Real probes for the four *earnable* evidence kinds.
 *
 * "Earnable" means: this machine can establish the fact by actually contacting
 * the thing and observing the result. No template, no placeholder, no env flag.
 *
 *   certificate-authority   — real TLS handshake against the public origin;
 *                             the digest IS the server certificate's SHA-256
 *                             fingerprint and the expiry IS notAfter.
 *   venue-health            — real HTTPS request to a venue's public status
 *                             endpoint; latency and reachability are measured.
 *   slo-measurement         — N real requests against a public endpoint;
 *                             uptime and p95 are computed from the samples.
 *   durable-immutable-audit — reads the deployment's own audit status and
 *                             requires a durable store plus a real root hash.
 *
 * Every probe returns either
 *   { ok: true,  evidence: {...}, detail: {...} }
 * or
 *   { ok: false, code: 'WHY_NOT', detail: {...} }
 *
 * A probe NEVER fabricates an evidence record when the check did not pass.
 * That is the whole point: `ok:false` is a legitimate, useful answer.
 */

import tls from 'node:tls';
import { createHash } from 'node:crypto';

export const PROBE_SCHEMA = 'fbt.evidence-probe.v1';

/** Kinds this file can genuinely earn. */
export const EARNABLE_KINDS = Object.freeze([
  'certificate-authority',
  'venue-health',
  'slo-measurement',
  'durable-immutable-audit'
]);

const HOUR = 3600_000;

function sha256(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function hexDigest(value) {
  const text = String(value ?? '').trim().replace(/^0x/, '').replace(/:/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

/** providerId must satisfy the injection route's public-id format. */
function publicId(value, fallback) {
  const text = String(value ?? '').trim().replace(/[^A-Za-z0-9._:-]/g, '-');
  return /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(text) ? text : fallback;
}

function evidence({ kind, providerId, digest, checkedAt, expiresAt }) {
  return {
    kind,
    providerId,
    digest,
    checkedAt,
    expiresAt,
    status: 'verified',
    health: 'healthy',
    attested: true
  };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const index = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, index)];
}

function originOf(target) {
  const url = new URL(target);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${url.protocol}`);
  }
  return url;
}

/* ─────────────────────────── certificate-authority ─────────────────────── */

/**
 * Perform a real TLS handshake and read the served leaf certificate.
 * The handshake runs with rejectUnauthorized:true, so `authorized === true`
 * means the chain actually validated against the system trust store — that
 * is the CA fact we are attesting, not a self-declaration.
 */
export function probeCertificateAuthority(target, { timeoutMs = 10_000, ttlHours = 24, now = Date.now() } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = originOf(target);
    } catch (e) {
      return resolve({ ok: false, code: 'TARGET_INVALID', detail: { message: e.message } });
    }
    if (url.protocol !== 'https:') {
      return resolve({ ok: false, code: 'TARGET_NOT_HTTPS', detail: { target } });
    }

    const host = url.hostname;
    const port = Number(url.port || 443);
    const started = Date.now();

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] },
      () => {
        const authorized = socket.authorized === true;
        const cert = socket.getPeerCertificate(false) || {};
        const handshakeMs = Date.now() - started;
        socket.end();

        const fingerprint = hexDigest(cert.fingerprint256);
        const notAfter = Date.parse(cert.valid_to || '');
        const issuer = cert.issuer || {};
        const issuerIdentity = issuer.O || issuer.CN || null;

        const detail = {
          host,
          authorized,
          issuerIdentity,
          issuerCN: issuer.CN || null,
          subjectCN: cert.subject?.CN || null,
          validFrom: cert.valid_from || null,
          validTo: cert.valid_to || null,
          fingerprint256: cert.fingerprint256 || null,
          handshakeMs
        };

        if (!authorized) return resolve({ ok: false, code: 'CA_CHAIN_NOT_TRUSTED', detail });
        if (!fingerprint) return resolve({ ok: false, code: 'CA_FINGERPRINT_UNREADABLE', detail });
        if (!issuerIdentity) return resolve({ ok: false, code: 'CA_ISSUER_UNKNOWN', detail });
        if (!Number.isFinite(notAfter)) return resolve({ ok: false, code: 'CA_EXPIRY_UNREADABLE', detail });
        if (notAfter <= now) return resolve({ ok: false, code: 'CA_EXPIRED', detail });

        /* Evidence must be re-earned regularly even though the certificate
           itself lives longer — a cert that was valid last month says nothing
           about the origin serving it today. */
        const expiresAt = Math.min(notAfter, now + ttlHours * HOUR);

        resolve({
          ok: true,
          detail,
          evidence: evidence({
            kind: 'certificate-authority',
            providerId: publicId(issuerIdentity, 'tls-issuer'),
            digest: fingerprint,
            checkedAt: now,
            expiresAt
          })
        });
      }
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ ok: false, code: 'CA_HANDSHAKE_TIMEOUT', detail: { host, timeoutMs } });
    });
    socket.on('error', (err) => {
      resolve({ ok: false, code: 'CA_HANDSHAKE_FAILED', detail: { host, message: err.message } });
    });
  });
}

/* ────────────────────────────── venue-health ───────────────────────────── */

export const VENUE_ENDPOINTS = Object.freeze({
  binance: 'https://api.binance.com/api/v3/time',
  kraken: 'https://api.kraken.com/0/public/SystemStatus',
  coinbase: 'https://api.exchange.coinbase.com/time',
  bitfinex: 'https://api-pub.bitfinex.com/v2/platform/status'
});

async function timedFetch(url, { timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const body = await response.text();
    return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, body };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one or more venues. Evidence is issued for the healthiest reachable
 * venue; the digest binds venue id, HTTP status, latency and the response body
 * hash, so it cannot be reproduced without having made the call.
 */
export async function probeVenueHealth({
  venues = ['binance', 'kraken', 'coinbase'],
  timeoutMs = 8_000,
  ttlHours = 6,
  now = Date.now()
} = {}) {
  const results = [];
  for (const venueId of venues) {
    const url = VENUE_ENDPOINTS[venueId];
    if (!url) {
      results.push({ venueId, ok: false, code: 'UNKNOWN_VENUE' });
      continue;
    }
    const res = await timedFetch(url, { timeoutMs });
    results.push({
      venueId,
      ok: res.ok,
      httpStatus: res.status,
      latencyMs: res.latencyMs,
      error: res.error || null,
      bodyHash: res.body ? sha256(res.body) : null
    });
  }

  const healthy = results.filter((r) => r.ok).sort((a, b) => a.latencyMs - b.latencyMs);
  if (healthy.length === 0) {
    return { ok: false, code: 'NO_HEALTHY_VENUE', detail: { results } };
  }

  const best = healthy[0];
  return {
    ok: true,
    detail: { results, chosen: best.venueId },
    evidence: evidence({
      kind: 'venue-health',
      providerId: publicId(best.venueId, 'venue'),
      digest: sha256('venue-health', best.venueId, String(best.httpStatus), String(best.latencyMs), best.bodyHash || '', String(now)),
      checkedAt: now,
      expiresAt: now + ttlHours * HOUR
    })
  };
}

/* ───────────────────────────── slo-measurement ─────────────────────────── */

/**
 * Measure uptime and latency percentiles with real traffic against a real
 * endpoint. `samples` requests are issued sequentially; a request counts as
 * available when it returns a non-5xx response.
 *
 * The SLO is only met — and evidence only issued — when the measurement
 * clears the thresholds. A failed SLO is reported, never rounded up.
 */
export async function probeSlo({
  target,
  path = '/api/intents/v1/public-status',
  samples = 20,
  timeoutMs = 10_000,
  minUptime = 0.99,
  maxP95Ms = 2_000,
  ttlHours = 6,
  now = Date.now()
} = {}) {
  let url;
  try {
    url = new URL(path, originOf(target)).toString();
  } catch (e) {
    return { ok: false, code: 'TARGET_INVALID', detail: { message: e.message } };
  }

  const count = Math.max(5, Math.min(500, Number(samples) || 20));
  const latencies = [];
  let available = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < count; i += 1) {
    const res = await timedFetch(url, { timeoutMs });
    const up = res.status > 0 && res.status < 500;
    if (up) {
      available += 1;
      latencies.push(res.latencyMs);
    } else {
      failed += 1;
    }
  }

  const windowMs = Date.now() - startedAt;
  const sorted = [...latencies].sort((a, b) => a - b);
  const uptime = count > 0 ? available / count : 0;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const errorRate = count > 0 ? failed / count : 1;

  const measurement = {
    url,
    samples: count,
    available,
    failed,
    uptime: Number(uptime.toFixed(4)),
    errorRate: Number(errorRate.toFixed(4)),
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    windowMs,
    startedAt,
    endedAt: startedAt + windowMs
  };

  if (uptime < minUptime) {
    return { ok: false, code: 'SLO_UPTIME_BELOW_TARGET', detail: { measurement, minUptime } };
  }
  if (p95 === null || p95 > maxP95Ms) {
    return { ok: false, code: 'SLO_P95_ABOVE_TARGET', detail: { measurement, maxP95Ms } };
  }

  return {
    ok: true,
    detail: { measurement, minUptime, maxP95Ms },
    evidence: evidence({
      kind: 'slo-measurement',
      providerId: 'slo-meter',
      digest: sha256('slo', JSON.stringify(measurement)),
      checkedAt: now,
      expiresAt: now + ttlHours * HOUR
    })
  };
}

/* ────────────────────────── durable-immutable-audit ────────────────────── */

/**
 * Ask the deployment for its audit status and require two things that cannot
 * be faked from the client side: a configured durable store and a real
 * sha256 root hash over at least one appended entry. The root hash itself
 * becomes the evidence digest.
 */
export async function probeDurableAudit({
  target,
  path = '/api/intents/v1/audit-status',
  timeoutMs = 10_000,
  ttlHours = 6,
  now = Date.now()
} = {}) {
  let url;
  try {
    url = new URL(path, originOf(target)).toString();
  } catch (e) {
    return { ok: false, code: 'TARGET_INVALID', detail: { message: e.message } };
  }

  const res = await timedFetch(url, { timeoutMs });
  if (!res.ok) {
    return { ok: false, code: 'AUDIT_STATUS_UNREACHABLE', detail: { url, httpStatus: res.status, error: res.error || null } };
  }

  let status = null;
  try {
    status = JSON.parse(res.body);
  } catch {
    return { ok: false, code: 'AUDIT_STATUS_MALFORMED', detail: { url } };
  }

  const detail = {
    url,
    configured: status.configured === true,
    durable: status.durable === true,
    entryCount: Number(status.entryCount) || 0,
    rootHash: status.rootHash || null
  };

  if (!detail.configured || !detail.durable) {
    return { ok: false, code: 'DURABLE_STORE_NOT_CONFIGURED', detail };
  }
  const rootHash = hexDigest(status.rootHash);
  if (!rootHash) {
    return { ok: false, code: 'AUDIT_ROOT_MISSING', detail };
  }
  if (detail.entryCount < 1) {
    return { ok: false, code: 'AUDIT_LOG_EMPTY', detail };
  }

  return {
    ok: true,
    detail,
    evidence: evidence({
      kind: 'durable-immutable-audit',
      providerId: 'blob-audit-log',
      digest: rootHash,
      checkedAt: now,
      expiresAt: now + ttlHours * HOUR
    })
  };
}

/* ──────────────────────────────── all four ─────────────────────────────── */

/**
 * Run every earnable probe against one target. Returns one entry per kind,
 * plus the subset of evidence records that were actually earned.
 */
export async function probeAllEarnable({
  target,
  venues,
  samples,
  sloPath,
  ttlHours = 6,
  certTtlHours = 24,
  now = Date.now()
} = {}) {
  const [ca, venue, slo, audit] = await Promise.all([
    probeCertificateAuthority(target, { ttlHours: certTtlHours, now }),
    probeVenueHealth({ venues, ttlHours, now }),
    probeSlo({ target, samples, path: sloPath, ttlHours, now }),
    probeDurableAudit({ target, ttlHours, now })
  ]);

  const byKind = {
    'certificate-authority': ca,
    'venue-health': venue,
    'slo-measurement': slo,
    'durable-immutable-audit': audit
  };

  const earned = Object.values(byKind).filter((r) => r.ok).map((r) => r.evidence);

  return {
    schema: PROBE_SCHEMA,
    target,
    checkedAt: now,
    byKind,
    earned,
    earnedCount: earned.length,
    missing: Object.entries(byKind).filter(([, r]) => !r.ok).map(([kind, r]) => ({ kind, code: r.code }))
  };
}
