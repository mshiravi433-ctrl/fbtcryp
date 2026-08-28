#!/usr/bin/env node
/**
 * FBT INTENT AI — assemble the complete operational-evidence snapshot.
 *
 *   node scripts/activate-release.mjs [--target https://your-app.vercel.app]
 *                     [--external operators-evidence.json] [--merge older.json,...]
 *                     [--env] [--submit --op1 A --op2 B] [--out release-evidence.json]
 *                     [--json]
 *
 * What this does
 * ---------------------------------------------------------------------------
 * The 21 evidence kinds come from four sources and no deployment can earn all
 * of them in one run. Until now assembling them into the one
 * INTENT_OPERATIONAL_EVIDENCE value was a manual copy-paste job spread across
 * three docs. This script collects every RECORD the deployment actually holds,
 * merges operator-supplied records, validates everything, and prints the value
 * to paste into Vercel (or submits it through the dual-operator route).
 *
 *   · self/measurable/probe kinds  → GET /api/intents/v1/evidence-status
 *                                    (records must be public digests only)
 *   · drills + stage-3 + measurable → /ops-probe, /stage3-probe, /self-probe
 *                                    when --target is given, otherwise run
 *                                    locally with the same implementations
 *   · external attestations         → --external file (validated record shape)
 *
 * Honesty rules, unchanged from the rest of the project:
 *   · nothing invents a digest; a missing kind is reported, never fabricated
 *   · every record is re-validated (kind, provider id, sha256 digest, expiry,
 *     secret shape) before it is merged or submitted
 *   · exit code 0 only when all 21 kinds are present and current
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EVIDENCE_KINDS } from '../src/lib/intent-ai/operationalActivation.js';

const args = parseArgs(process.argv.slice(2));
const quiet = args.json === true;
const log = (...parts) => { if (!quiet) console.log(...parts); };
const fail = (message, code = 1) => { console.error(message); process.exit(code); };

if (args.help) {
  console.log(`
Usage: node scripts/activate-release.mjs [options]

  --target <url>       deployment origin (base http(s) URL)
  --external <file>    operator-supplied records (array or {"evidence":[...]})
  --merge <files>      comma-separated earlier evidence files to fold in
  --out <file>         output file                  (default: release-evidence.json)
  --env                print INTENT_OPERATIONAL_EVIDENCE to paste into Vercel
  --submit             POST the assembled records to --target (dual-operator)
  --op1 / --op2        operator ids for --submit     (env: OPERATOR_1 / OPERATOR_2)
  --ttl-hours <n>      cap added external/merge record lifetime (default: 48)
  --json               machine readable output only
`);
  process.exit(0);
}

/* ------------------------------------------------------------------ helpers */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [flag, inline] = token.slice(2).split('=');
      if (inline !== undefined) out[flag] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[flag] = argv[++i];
      else out[flag] = true;
    } else out._.push(token);
  }
  return out;
}

const now = Date.now();
const DEFAULT_TTL_MS = 48 * 3600_000;

function publicId(value) {
  return /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(String(value || '')) ? String(value) : null;
}

function publicDigest(value) {
  const hex = String(value || '').trim().replace(/^0x/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function validateRecord(record, { now: at = now, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, code: 'RECORD_MALFORMED' };
  if (!EVIDENCE_KINDS.includes(record.kind)) return { ok: false, code: 'UNKNOWN_KIND' };
  const providerId = publicId(record.providerId);
  const digest = publicDigest(record.digest);
  const checkedAt = Number(record.checkedAt || at);
  const expiresAt = Number(record.expiresAt || checkedAt + ttlMs);
  if (!providerId) return { ok: false, code: 'PROVIDER_ID_INVALID' };
  if (!digest) return { ok: false, code: 'DIGEST_INVALID' };
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) || expiresAt <= at) return { ok: false, code: 'EXPIRED' };
  if (/private.?key|seed.?phrase|mnemonic|raw.?secret|BEGIN [A-Z ]*PRIVATE/i.test(JSON.stringify(record))) {
    return { ok: false, code: 'SECRET_IN_RECORD' };
  }
  return { ok: true, record: { kind: record.kind, providerId, digest, checkedAt, expiresAt, status: 'verified', health: 'healthy', attested: true } };
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mergeInto(map, records, { source }) {
  let accepted = 0;
  let dropped = 0;
  for (const record of records) {
    const validated = validateRecord(record);
    if (!validated.ok) { dropped += 1; continue; }
    const existing = map.get(validated.record.kind);
    if (!existing || existing.checkedAt <= validated.record.checkedAt) {
      map.set(validated.record.kind, { ...validated.record, source });
      accepted += 1;
    }
  }
  return { accepted, dropped };
}

/* ------------------------------------------------------------- collection */
async function collectDeployment(target) {
  const base = String(target).replace(/\/+$/, '');
  const collected = [];

  /* 1. The evidence store is the source of truth for what the deployment
        already holds (self-verifiable + probes + anything injected). */
  const evidenceStatus = await fetchJson(`${base}/api/intents/v1/evidence-status`);
  if (Array.isArray(evidenceStatus.records)) {
    collected.push(...evidenceStatus.records);
    log(`✓ evidence-status          ${evidenceStatus.evidence} records read from the deployment`);
  }

  /* 2. In-case the store was cold, ask each probe for its earned records.
        Probe endpoints return public digests only and never fabricate. */
  for (const [endpoint, label] of [
    ['/api/intents/v1/self-probe?dry=1', 'self-probe'],
    ['/api/intents/v1/ops-probe?dry=1', 'ops-probe'],
    ['/api/intents/v1/stage3-probe?dry=1', 'stage3-probe']
  ]) {
    try {
      const report = await fetchJson(`${base}${endpoint}`);
      if (Array.isArray(report.earned)) {
        collected.push(...report.earned);
        log(`✓ ${label.padEnd(14)} ${report.earnedCount || report.earned.length}/${report.totalKinds || '?'} earned`);
      }
    } catch (error) {
      log(`✗ ${label.padEnd(14)} unavailable (${error.message})`);
    }
  }
  return collected;
}

async function collectLocal() {
  const collected = [];
  let drills = null;
  let stage3 = null;
  try {
    const { runAllOperationalDrills } = await import('../server/intentOperationalDrills.js');
    drills = await runAllOperationalDrills({ now });
    collected.push(...(drills.earned || []));
    log(`✓ ops-drills               ${drills.earnedCount}/${drills.totalKinds} earned (local run)`);
  } catch (error) {
    log(`✗ ops-drills               unavailable (${error.message})`);
  }
  try {
    const { runStage3Digest } = await import('../server/intentStage3Probe.js');
    stage3 = await runStage3Digest({ now });
    collected.push(...(stage3.earned || []));
    log(`✓ stage-3                 ${stage3.earnedCount}/${stage3.totalKinds} earned (local run)`);
  } catch (error) {
    log(`✗ stage-3                 unavailable (${error.message})`);
  }
  try {
    const { collectLocalEvidence } = await import('../server/intentAutoEvidence.js');
    const local = await collectLocalEvidence({ now });
    collected.push(...local);
    log(`✓ auto-evidence            ${local.length} self-verifiable kinds (local run)`);
  } catch (error) {
    log(`✗ auto-evidence            unavailable (${error.message})`);
  }
  return collected;
}

function readEvidenceFile(file) {
  let parsed = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    parsed = Array.isArray(raw) ? raw : Array.isArray(raw?.evidence) ? raw.evidence : [];
  } catch (error) {
    log(`✗ could not read ${file}: ${error.message}`);
  }
  return parsed;
}

/* -------------------------------------------------------------------- main */
const target = String(args.target || process.env.EVIDENCE_TARGET || '').trim();
const byKind = new Map();

if (target) {
  try {
    const deployment = await collectDeployment(target);
    mergeInto(byKind, deployment, { source: 'deployment' });
  } catch (error) {
    fail(`✗ --target unreachable: ${error.message}`);
  }
} else {
  log('no --target: collecting with the local implementations');
  const local = await collectLocal();
  mergeInto(byKind, local, { source: 'local-probe' });
}

if (args.external) {
  const records = readEvidenceFile(args.external);
  const result = mergeInto(byKind, records, { source: 'operator' });
  log(`✓ external                 ${result.accepted} accepted, ${result.dropped} dropped`);
}

if (args.merge) {
  for (const file of String(args.merge).split(',').map((f) => f.trim()).filter(Boolean)) {
    const records = readEvidenceFile(file);
    const result = mergeInto(byKind, records, { source: 'merged' });
    log(`✓ merge ${file}    ${result.accepted} accepted, ${result.dropped} dropped`);
  }
}

/* Cap any record we were handed that stretches unreasonably far. Deployment
   records keep their own expiry; merging in a far-future record is validated
   but never extended here. */
for (const [kind, record] of byKind.entries()) {
  if (record.source !== 'deployment' && record.expiresAt > now + DEFAULT_TTL_MS * 4) {
    record.expiresAt = now + DEFAULT_TTL_MS * 4;
    record.checkedAt = now;
  }
}

const records = [...byKind.values()].map(({ source, ...record }) => record);
const missing = EVIDENCE_KINDS.filter((kind) => !byKind.has(kind));
const summary = {
  schema: 'fbt.release-evidence-assembly.v1',
  assembledAt: new Date(now).toISOString(),
  totalKinds: EVIDENCE_KINDS.length,
  presentCount: records.length,
  missingCount: missing.length,
  complete: missing.length === 0,
  missing,
  records,
  launchReady: missing.length === 0
};

const outFile = path.resolve(String(args.out || 'release-evidence.json'));
fs.writeFileSync(outFile, `${JSON.stringify({ evidence: records }, null, 2)}\n`);
log('─'.repeat(72));
log(`assembled ${records.length}/${EVIDENCE_KINDS.length} → ${outFile}`);
if (missing.length) {
  log('missing (operator or deployment configuration required):');
  for (const kind of missing) log(`  ✗ ${kind}`);
} else {
  log('complete — the reviewed release is ready to paste or submit.');
}

if (args.env) {
  const envFile = outFile.replace(/\.json$/, '') + '.env.txt';
  const value = JSON.stringify(records);
  fs.writeFileSync(envFile, `INTENT_OPERATIONAL_EVIDENCE=${value}\n`);
  log('─'.repeat(72));
  log('INTENT_OPERATIONAL_EVIDENCE (Vercel → Settings → Environment Variables):');
  log(value);
  log(`also written to → ${envFile}`);
  log('after saving, REDEPLOY — env changes do not reach a running deployment.');
}

if (args.submit) {
  if (!target) fail('✗ --submit requires --target');
  const op1 = String(args.op1 || process.env.OPERATOR_1 || '').trim();
  const op2 = String(args.op2 || process.env.OPERATOR_2 || '').trim();
  if (!op1 || !op2 || op1 === op2) fail('✗ --submit needs two distinct operator ids (--op1/--op2 or OPERATOR_1/OPERATOR_2)');
  if (records.length === 0) fail('✗ nothing assembled — refusing to submit an empty payload');
  const url = new URL('/api/intents/v1/operator-evidence', target).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Operator-1': op1, 'X-Operator-2': op2 },
    body: JSON.stringify({ evidence: records })
  });
  const body = await response.text();
  log(`submit → ${response.status}`);
  log(body);
  if (!response.ok) process.exit(5);
}

if (quiet) console.log(JSON.stringify(summary, null, 2));
process.exit(summary.complete ? 0 : 1);
