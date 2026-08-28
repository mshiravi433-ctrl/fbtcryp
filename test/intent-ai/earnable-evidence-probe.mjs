#!/usr/bin/env node
/**
 * Earnable-evidence probe.
 *
 * Verifies that the four evidence kinds an operator can genuinely earn on
 * their own — certificate-authority, venue-health, slo-measurement and
 * durable-immutable-audit — are produced by REAL checks, and that each one
 * fails closed when the underlying fact is absent.
 *
 * Network egress is not assumed: the venue and TLS probes are exercised
 * against unreachable/plain-http targets so the failure paths are asserted
 * deterministically. When FBT_PROBE_NETWORK=1 the live paths run too.
 */

import http from 'node:http';
import { createHash } from 'node:crypto';

const results = [];
const check = (name, ok) => results.push({ name, ok });

const {
  probeCertificateAuthority,
  probeVenueHealth,
  probeSlo,
  probeDurableAudit,
  probeAllEarnable,
  EARNABLE_KINDS
} = await import('../../scripts/lib/evidenceProbes.mjs');

check('four earnable kinds are declared', EARNABLE_KINDS.length === 4);
check('earnable kinds are the probeable four',
  ['certificate-authority', 'venue-health', 'slo-measurement', 'durable-immutable-audit']
    .every((k) => EARNABLE_KINDS.includes(k)));

/* Every earnable kind must be a kind the injection route accepts. */
const { EVIDENCE_KINDS } = await import('../../src/lib/intent-ai/operationalActivation.js');
check('earnable kinds are valid evidence kinds', EARNABLE_KINDS.every((k) => EVIDENCE_KINDS.includes(k)));

/* ── certificate-authority fails closed on non-TLS and on dead hosts ────── */
const httpTarget = await probeCertificateAuthority('http://example.invalid');
check('CA probe rejects plain http', httpTarget.ok === false && httpTarget.code === 'TARGET_NOT_HTTPS');

const deadHost = await probeCertificateAuthority('https://this-host-does-not-exist.invalid', { timeoutMs: 3000 });
check('CA probe fails closed on unreachable host', deadHost.ok === false && deadHost.evidence === undefined);

/* ── slo-measurement measures a real local server ───────────────────────── */
const server = http.createServer((req, res) => {
  if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('ok'); }, 30); return; }
  if (req.url === '/down') { res.writeHead(503); res.end('no'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const goodSlo = await probeSlo({ target: base, path: '/ok', samples: 8, ttlHours: 1 });
check('SLO probe earns evidence from a healthy endpoint', goodSlo.ok === true);
check('SLO evidence carries a 64-hex digest', /^[0-9a-f]{64}$/.test(goodSlo.evidence?.digest || ''));
check('SLO measurement reports the real sample count', goodSlo.detail.measurement.samples === 8);
check('SLO measurement computes p95 from samples', typeof goodSlo.detail.measurement.p95LatencyMs === 'number');
check('SLO evidence expires in the future', goodSlo.evidence.expiresAt > Date.now());

const failingSlo = await probeSlo({ target: base, path: '/down', samples: 6, ttlHours: 1 });
check('SLO probe refuses evidence when the endpoint is 5xx',
  failingSlo.ok === false && failingSlo.code === 'SLO_UPTIME_BELOW_TARGET');
check('failed SLO issues no evidence', failingSlo.evidence === undefined);

const strictSlo = await probeSlo({ target: base, path: '/slow', samples: 6, maxP95Ms: 1, ttlHours: 1 });
check('SLO probe enforces the p95 threshold', strictSlo.ok === false && strictSlo.code === 'SLO_P95_ABOVE_TARGET');

/* ── durable-immutable-audit requires a durable store and a real root ───── */
const rootHash = createHash('sha256').update('entry').digest('hex');
const auditServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url === '/unconfigured') return res.end(JSON.stringify({ configured: false, durable: false, entryCount: 0, rootHash: null }));
  if (req.url === '/empty') return res.end(JSON.stringify({ configured: true, durable: true, entryCount: 0, rootHash: null }));
  return res.end(JSON.stringify({ configured: true, durable: true, entryCount: 3, rootHash }));
});
await new Promise((resolve) => auditServer.listen(0, '127.0.0.1', resolve));
const auditBase = `http://127.0.0.1:${auditServer.address().port}`;

const goodAudit = await probeDurableAudit({ target: auditBase, path: '/good', ttlHours: 1 });
check('audit probe earns evidence from a durable, non-empty log', goodAudit.ok === true);
check('audit evidence digest IS the root hash', goodAudit.evidence.digest === rootHash);

const noBlob = await probeDurableAudit({ target: auditBase, path: '/unconfigured', ttlHours: 1 });
check('audit probe fails closed without a durable store',
  noBlob.ok === false && noBlob.code === 'DURABLE_STORE_NOT_CONFIGURED');

const emptyLog = await probeDurableAudit({ target: auditBase, path: '/empty', ttlHours: 1 });
check('audit probe fails closed on an empty log', emptyLog.ok === false && emptyLog.evidence === undefined);

/* ── venue-health fails closed when no venue answers ────────────────────── */
const noVenue = await probeVenueHealth({ venues: ['not-a-venue'], timeoutMs: 2000 });
check('venue probe rejects an unknown venue', noVenue.ok === false && noVenue.code === 'NO_HEALTHY_VENUE');

/* ── the aggregate reports what is missing, and why ─────────────────────── */
const aggregate = await probeAllEarnable({ target: base, venues: ['not-a-venue'], samples: 5, sloPath: '/ok' });
check('aggregate reports one entry per kind', Object.keys(aggregate.byKind).length === 4);
check('aggregate lists missing kinds with a reason', aggregate.missing.every((m) => typeof m.code === 'string' && m.code.length > 0));
check('aggregate only emits earned records', aggregate.earned.length === aggregate.earnedCount);
check('aggregate never emits a record for a failed kind',
  aggregate.earned.every((e) => aggregate.byKind[e.kind].ok === true));

/* ── every earned record satisfies the injection route's validator ──────── */
const { normalizeEvidence } = await import('../../src/lib/intent-ai/operationalActivation.js');
for (const record of [...aggregate.earned, goodAudit.evidence, goodSlo.evidence]) {
  const normalized = normalizeEvidence(record);
  check(`earned ${record.kind} record normalizes to verified`, normalized.ok === true);
}

/* ── the server-side SLO meter is fed by real traffic only ──────────────── */
const { sloSnapshot, recordSloSample, resetSloMeter } = await import('../../server/intentSloMeter.js');
resetSloMeter();
const cold = sloSnapshot();
check('SLO meter starts unmeasured', cold.measured === false && cold.uptime === null);
check('SLO meter explains why it is unmeasured', cold.reason === 'INSUFFICIENT_SAMPLES');
for (let i = 0; i < 19; i += 1) recordSloSample({ durationMs: 10, ok: true });
check('SLO meter stays unmeasured below the sample floor', sloSnapshot().measured === false);
recordSloSample({ durationMs: 10, ok: false });
const warm = sloSnapshot();
check('SLO meter measures once the floor is reached', warm.measured === true && warm.samples === 20);
check('SLO meter counts 5xx against uptime', warm.uptime === 0.95);
resetSloMeter();

/* ── optional live network paths ────────────────────────────────────────── */
if (process.env.FBT_PROBE_NETWORK === '1') {
  const liveCa = await probeCertificateAuthority('https://vercel.com');
  check('live CA probe reads a trusted certificate', liveCa.ok === true && /^[0-9a-f]{64}$/.test(liveCa.evidence.digest));
  const liveVenue = await probeVenueHealth({});
  check('live venue probe reaches an exchange', liveVenue.ok === true);
}

server.close();
auditServer.close();

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'earnable-evidence', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
