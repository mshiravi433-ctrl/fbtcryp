#!/usr/bin/env node
/**
 * BUILD AN OPERATOR EVIDENCE PAYLOAD
 * ---------------------------------------------------------------------------
 * Produces the JSON array for INTENT_OPERATIONAL_EVIDENCE, or a ready-to-paste
 * curl command for POST /api/intents/v1/operator-evidence.
 *
 * READ THIS FIRST
 * ---------------
 * Every record you generate here is a CLAIM THAT YOU CHECKED SOMETHING REAL.
 * The server cannot verify the claim — it can only check the shape. That is
 * the whole reason the hardcoded 21/21 was removed: a digest computed from a
 * kind's own name proves nothing.
 *
 * Only add a kind once the underlying fact is actually true:
 *   - independent-security-review  -> an audit report exists, by someone else
 *   - backup-restore-drill         -> you restored a backup and it worked
 *   - rollback-drill               -> you rolled a deploy back and it worked
 *
 * The digest should identify the real artefact (the audit PDF, the drill
 * report, the contract address). Pass --digest-from to hash a file, or
 * --digest-text to hash a string. Both are public identifiers; never pass a
 * key, seed phrase or credential — the server rejects those outright.
 *
 * USAGE
 *   node scripts/make-operator-evidence.mjs --list
 *   node scripts/make-operator-evidence.mjs --kind venue-health \
 *        --provider binance-spot --digest-text "checked 2026-08-28" --days 30
 *   node scripts/make-operator-evidence.mjs --kind independent-security-review \
 *        --provider acme-audits --digest-from ./audit-report.pdf --days 365
 *
 * Repeat --kind/--provider/--digest-* groups to emit several records at once.
 * Output is a JSON array suitable for INTENT_OPERATIONAL_EVIDENCE.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EVIDENCE_KINDS = [
  'approved-durable-registry', 'certificate-authority', 'sandbox-operator',
  'simulator', 'monitor', 'scheduler-operator', 'smart-wallet',
  'independent-guardian', 'production-signer', 'wallet-provider',
  'broker-provider', 'bridge-provider', 'venue-health', 'rpc',
  'policy-contract', 'durable-immutable-audit', 'backup-restore-drill',
  'independent-security-review', 'reproducible-deployment', 'rollback-drill',
  'slo-measurement'
];

/* The seven the server attests for itself from conditions it can check. */
const SELF_VERIFIABLE = new Set([
  'approved-durable-registry', 'simulator', 'monitor', 'scheduler-operator',
  'reproducible-deployment', 'rpc', 'wallet-provider'
]);

const WHAT_IT_MEANS = {
  'certificate-authority': 'TLS/PKI issuer is real, unrevoked and unexpired.',
  'sandbox-operator': 'Agent code runs in an isolated sandbox you operate.',
  'smart-wallet': 'A deployed smart account, paired with a guardian.',
  'independent-guardian': 'A guardian that can veto and is NOT controlled by the signer.',
  'production-signer': 'A policy-bound signer (KMS/HSM). Never a raw key in an env var.',
  'broker-provider': 'A broker integration that has been exercised end to end.',
  'bridge-provider': 'A bridge integration that has been exercised end to end.',
  'venue-health': 'A live venue health probe with a real result.',
  'policy-contract': 'An on-chain policy contract with a verified code hash.',
  'durable-immutable-audit': 'Append-only audit storage with a verified root.',
  'backup-restore-drill': 'You RESTORED a backup and confirmed the result.',
  'independent-security-review': 'A signed review by someone independent of the team.',
  'rollback-drill': 'You ROLLED BACK a deployment and confirmed the result.',
  'slo-measurement': 'SLOs are defined AND measured, with real numbers.'
};

function usage(msg) {
  if (msg) console.error(`\nerror: ${msg}`);
  console.error(`
Build an operator evidence payload.

  --list                    show every kind and what it means
  --kind <name>             evidence kind (repeatable)
  --provider <id>           provider id: letter first, then [A-Za-z0-9._:-], max 64
  --digest-text <string>    sha256 of this string
  --digest-from <path>      sha256 of this file's bytes
  --digest <64-hex>         a digest you already computed
  --days <n>                validity in days (default 90)
  --curl <base-url>         emit a curl command instead of raw JSON
  --op1 <id> --op2 <id>     operator ids for the curl form (must differ)

Each --kind starts a new record; --provider/--digest*/--days apply to it.
`);
  process.exit(msg ? 1 : 0);
}

const argv = process.argv.slice(2);
if (!argv.length) usage();
if (argv.includes('--list')) {
  console.log('\nEVIDENCE KINDS\n');
  for (const kind of EVIDENCE_KINDS) {
    const self = SELF_VERIFIABLE.has(kind);
    console.log(`  ${self ? '[auto]    ' : '[operator]'} ${kind}`);
    if (!self) console.log(`              ${WHAT_IT_MEANS[kind]}`);
  }
  console.log(`\n[auto]     = the server attests these itself when configured.`);
  console.log(`[operator] = only you can attest these. ${EVIDENCE_KINDS.length - SELF_VERIFIABLE.size} of ${EVIDENCE_KINDS.length}.\n`);
  process.exit(0);
}

const records = [];
let current = null;
let curlBase = null;
let op1 = null;
let op2 = null;

const flush = () => { if (current) records.push(current); current = null; };
const need = (i, flag) => {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) usage(`${flag} needs a value`);
  return v;
};

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--kind') { flush(); current = { kind: need(i, a), days: 90 }; i += 1; }
  else if (a === '--provider') { if (!current) usage('--provider before --kind'); current.providerId = need(i, a); i += 1; }
  else if (a === '--digest') { if (!current) usage('--digest before --kind'); current.digest = need(i, a); i += 1; }
  else if (a === '--digest-text') { if (!current) usage('--digest-text before --kind'); current.digest = createHash('sha256').update(need(i, a)).digest('hex'); i += 1; }
  else if (a === '--digest-from') {
    if (!current) usage('--digest-from before --kind');
    const p = need(i, a);
    try { current.digest = createHash('sha256').update(readFileSync(p)).digest('hex'); }
    catch (e) { usage(`cannot read ${p}: ${e.message}`); }
    i += 1;
  }
  else if (a === '--days') { if (!current) usage('--days before --kind'); current.days = Number(need(i, a)); i += 1; }
  else if (a === '--curl') { curlBase = need(i, a).replace(/\/+$/, ''); i += 1; }
  else if (a === '--op1') { op1 = need(i, a); i += 1; }
  else if (a === '--op2') { op2 = need(i, a); i += 1; }
  else usage(`unknown argument: ${a}`);
}
flush();

if (!records.length) usage('no --kind given');

const now = Date.now();
const out = [];
for (const r of records) {
  if (!EVIDENCE_KINDS.includes(r.kind)) usage(`unknown kind: ${r.kind}`);
  if (SELF_VERIFIABLE.has(r.kind)) {
    console.error(`note: "${r.kind}" is attested automatically by the server when configured; you normally do not need it here.`);
  }
  if (!r.providerId) usage(`--kind ${r.kind} needs --provider`);
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(r.providerId)) {
    usage(`provider "${r.providerId}" must start with a letter, then [A-Za-z0-9._:-], max 64 chars`);
  }
  if (!r.digest) usage(`--kind ${r.kind} needs --digest, --digest-text or --digest-from`);
  const digest = String(r.digest).replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) usage(`digest for ${r.kind} must be 64 hex characters (sha256)`);
  if (!Number.isFinite(r.days) || r.days <= 0) usage(`--days for ${r.kind} must be a positive number`);

  out.push({
    kind: r.kind,
    providerId: r.providerId,
    digest,
    checkedAt: now,
    expiresAt: now + Math.round(r.days * 86_400_000),
    status: 'verified',
    health: 'healthy',
    attested: true
  });
}

const json = JSON.stringify(out);
const blob = JSON.stringify(out, null, 2);

if (curlBase) {
  if (!op1 || !op2) usage('--curl needs --op1 and --op2');
  if (op1 === op2) usage('--op1 and --op2 must be different people');
  console.log(`\ncurl -X POST '${curlBase}/api/intents/v1/operator-evidence' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Operator-1: ${op1}' \\
  -H 'X-Operator-2: ${op2}' \\
  -d '${JSON.stringify({ evidence: out })}'\n`);
} else {
  console.log(`\n--- readable ---\n${blob}`);
  console.log(`\n--- single line, paste this as INTENT_OPERATIONAL_EVIDENCE ---\n${json}\n`);
  const expiry = new Date(out[0].expiresAt).toISOString().slice(0, 10);
  console.log(`${out.length} record(s). Earliest expiry ${expiry} — after that the count drops and the status says so.\n`);
}
