#!/usr/bin/env node
/**
 * FBT INTENT AI — earn the four probeable evidence records, for real.
 *
 *   node scripts/collect-evidence.mjs --target https://your-app.vercel.app
 *
 * What it does, in order:
 *   1. certificate-authority   real TLS handshake against --target
 *   2. venue-health            real request to a public exchange endpoint
 *   3. slo-measurement         N real requests, uptime + p95 computed
 *   4. durable-immutable-audit reads --target's audit status, needs a root hash
 *
 * It writes ONLY the records it actually earned to --out (default
 * evidence.json) and prints exactly why each missing one is missing.
 *
 * Optional submission (dual-operator auth, same as the HTTP route):
 *   --submit --op1 alice --op2 bob
 * or set OPERATOR_1 / OPERATOR_2 in the environment.
 *
 * Nothing here invents a digest. If a check fails you get a non-zero exit and
 * no record for that kind — which is the honest outcome.
 */

import fs from 'node:fs';
import path from 'node:path';
import { probeAllEarnable, EARNABLE_KINDS } from '../server/evidenceProbes.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [flag, inline] = token.slice(2).split('=');
      if (inline !== undefined) args[flag] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[flag] = argv[++i];
      else args[flag] = true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Usage: node scripts/collect-evidence.mjs --target https://host [options]

  --target <url>     public origin to probe            (env: EVIDENCE_TARGET)
  --out <file>       output file                       (default: evidence.json)
  --samples <n>      SLO request samples               (default: 20)
  --venues <list>    comma separated                   (default: binance,kraken,coinbase)
  --slo-path <path>  endpoint used for the SLO run     (default: /api/intents/v1/public-status)
  --ttl-hours <n>    evidence lifetime                 (default: 6)
  --cert-ttl-hours   certificate evidence lifetime     (default: 24)
  --submit           POST the earned records to --target
  --op1 / --op2      operator ids for dual auth        (env: OPERATOR_1 / OPERATOR_2)
  --env              also print an INTENT_OPERATIONAL_EVIDENCE value to paste
                     into Vercel, so the records survive cold starts
  --merge <files>    comma separated earlier evidence files to fold into --env
                     (expired records are dropped, fresh ones win)
  --json             machine readable output only
`);
  process.exit(0);
}

const target = String(args.target || process.env.EVIDENCE_TARGET || '').trim();
if (!target) {
  console.error('✗ --target is required, e.g. --target https://your-app.vercel.app');
  process.exit(2);
}

const outFile = path.resolve(String(args.out || 'evidence.json'));
const quiet = args.json === true;
const log = (...parts) => { if (!quiet) console.log(...parts); };

const LABEL = {
  'certificate-authority': 'certificate-authority  (TLS of your site)',
  'venue-health': 'venue-health           (exchange reachable)',
  'slo-measurement': 'slo-measurement        (uptime + p95 measured)',
  'durable-immutable-audit': 'durable-immutable-audit (Blob + verified root)'
};

const HINT = {
  TARGET_NOT_HTTPS: 'The target must be https — TLS evidence cannot exist over plain http.',
  CA_CHAIN_NOT_TRUSTED: 'The served chain did not validate against the system trust store.',
  CA_HANDSHAKE_FAILED: 'No TLS handshake. Check the host name and that the deployment is live.',
  CA_HANDSHAKE_TIMEOUT: 'The handshake timed out. Retry, or check outbound network access.',
  CA_EXPIRED: 'The certificate is past notAfter. Renew it before claiming CA evidence.',
  NO_HEALTHY_VENUE: 'No venue endpoint answered. Check egress/network, then retry.',
  SLO_UPTIME_BELOW_TARGET: 'Measured uptime is below the threshold. Fix availability first.',
  SLO_P95_ABOVE_TARGET: 'p95 latency is above the threshold. This is a real result, not a config error.',
  AUDIT_STATUS_UNREACHABLE: 'GET /api/intents/v1/audit-status failed. Is the deployment serving the API?',
  DURABLE_STORE_NOT_CONFIGURED: 'Set BLOB_READ_WRITE_TOKEN on the deployment and redeploy.',
  AUDIT_ROOT_MISSING: 'The audit log has no root hash yet — append one entry, then re-run.',
  AUDIT_LOG_EMPTY: 'The audit log is empty — append one entry, then re-run.'
};

const now = Date.now();
const report = await probeAllEarnable({
  target,
  samples: args.samples ? Number(args.samples) : undefined,
  venues: args.venues ? String(args.venues).split(',').map((v) => v.trim()).filter(Boolean) : undefined,
  sloPath: args['slo-path'] || undefined,
  ttlHours: args['ttl-hours'] ? Number(args['ttl-hours']) : 6,
  certTtlHours: args['cert-ttl-hours'] ? Number(args['cert-ttl-hours']) : 24,
  now
});

log(`\nFBT evidence probe — ${target}`);
log('─'.repeat(72));

for (const kind of EARNABLE_KINDS) {
  const result = report.byKind[kind];
  if (result.ok) {
    log(`✓ ${LABEL[kind]}`);
    log(`    providerId ${result.evidence.providerId}`);
    log(`    digest     ${result.evidence.digest}`);
    log(`    expiresAt  ${new Date(result.evidence.expiresAt).toISOString()}`);
    if (kind === 'slo-measurement') {
      const m = result.detail.measurement;
      log(`    measured   uptime ${(m.uptime * 100).toFixed(2)}%  p50 ${m.p50LatencyMs}ms  p95 ${m.p95LatencyMs}ms  (${m.samples} samples)`);
    }
    if (kind === 'certificate-authority') {
      log(`    issuer     ${result.detail.issuerIdentity} — valid to ${result.detail.validTo}`);
    }
    if (kind === 'venue-health') {
      log(`    venue      ${result.detail.chosen}`);
    }
    if (kind === 'durable-immutable-audit') {
      log(`    entries    ${result.detail.entryCount}`);
    }
  } else {
    log(`✗ ${LABEL[kind]}`);
    log(`    code       ${result.code}`);
    if (HINT[result.code]) log(`    why        ${HINT[result.code]}`);
  }
  log('');
}

const payload = { evidence: report.earned };
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);

const detailFile = outFile.replace(/\.json$/, '') + '-probe-detail.json';
fs.writeFileSync(detailFile, `${JSON.stringify(report, null, 2)}\n`);

log('─'.repeat(72));
log(`earned ${report.earnedCount}/${EARNABLE_KINDS.length}  →  ${outFile}`);
log(`full probe detail            →  ${detailFile}`);

/* Optional submission through the same dual-operator route an operator would
   use by hand. Credentials are never read from, or written to, the payload. */
if (args.submit) {
  const op1 = String(args.op1 || process.env.OPERATOR_1 || '').trim();
  const op2 = String(args.op2 || process.env.OPERATOR_2 || '').trim();
  if (!op1 || !op2 || op1 === op2) {
    console.error('✗ --submit needs two distinct operator ids (--op1/--op2 or OPERATOR_1/OPERATOR_2)');
    process.exit(3);
  }
  if (report.earnedCount === 0) {
    console.error('✗ nothing earned — refusing to submit an empty payload');
    process.exit(4);
  }
  const url = new URL('/api/intents/v1/operator-evidence', target).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Operator-1': op1, 'X-Operator-2': op2 },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  log(`\nsubmit → ${response.status}`);
  log(body);
  if (!response.ok) process.exit(5);
}

/* Vercel runs this API as stateless functions: the in-memory evidence store is
   per-instance and empties on every cold start. INTENT_OPERATIONAL_EVIDENCE is
   the durable path — the server revalidates each record at boot exactly like an
   injected one, so an expired or malformed entry is dropped, never trusted. */
if (args.env) {
  const envFile = outFile.replace(/\.json$/, '') + '.env.txt';

  /* --merge lets the value be assembled across runs. durable-immutable-audit
     only becomes earnable AFTER a first injection has written an audit entry,
     so a complete four-record value physically cannot come from a single run.
     Merged records are re-checked here: an expired or unknown-kind leftover is
     dropped, and a fresh record always wins over an older one of the same kind. */
  const merged = new Map();
  let droppedExpired = 0;
  if (args.merge) {
    for (const file of String(args.merge).split(',').map((f) => f.trim()).filter(Boolean)) {
      let prior = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
        prior = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.evidence) ? parsed.evidence : [];
      } catch (e) {
        console.error(`✗ --merge could not read ${file}: ${e.message}`);
        process.exit(6);
      }
      for (const record of prior) {
        if (!record || typeof record !== 'object') continue;
        if (!/^[0-9a-f]{64}$/.test(String(record.digest || ''))) continue;
        if (!Number.isFinite(Number(record.expiresAt)) || Number(record.expiresAt) <= now) { droppedExpired += 1; continue; }
        merged.set(record.kind, record);
      }
    }
  }
  for (const record of report.earned) merged.set(record.kind, record);

  const value = JSON.stringify([...merged.values()]);
  fs.writeFileSync(envFile, `INTENT_OPERATIONAL_EVIDENCE=${value}\n`);

  log(`\nINTENT_OPERATIONAL_EVIDENCE (paste into Vercel → Settings → Environment Variables):`);
  log(value);
  log(`\ncontains ${merged.size} record(s): ${[...merged.keys()].join(', ') || 'none'}`);
  if (droppedExpired > 0) log(`dropped ${droppedExpired} expired record(s) from --merge`);
  log(`also written to → ${envFile}`);
  log('note: these records carry real expiry timestamps — re-run and update the');
  log('      variable before they lapse, or use --ttl-hours to widen the window.');
  log('note: after saving the variable in Vercel you MUST redeploy; env changes');
  log('      do not reach a running deployment.');
}

if (quiet) console.log(JSON.stringify(report, null, 2));

process.exit(report.earnedCount === EARNABLE_KINDS.length ? 0 : 1);
