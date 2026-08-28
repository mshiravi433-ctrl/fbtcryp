#!/usr/bin/env node
/**
 * FBT INTENT AI — check what a LIVE deployment actually has configured.
 *
 *   node scripts/check-deployment-env.mjs --target https://your-app.vercel.app
 *
 * Nobody can read another account's Vercel dashboard, and this script does not
 * try to: it asks the running deployment public questions and infers the answer
 * from behaviour. That is strictly better than reading the dashboard anyway —
 * a variable that is set but not redeployed shows as "set" in the dashboard and
 * as MISSING here, and here is the truth the code sees.
 *
 * No secret is ever read, printed or transmitted. Every signal below is a
 * boolean or a count already exposed on a public endpoint.
 */

const ENDPOINTS = {
  health: '/api/health',
  audit: '/api/intents/v1/audit-status',
  evidence: '/api/intents/v1/evidence-status',
  slo: '/api/intents/v1/slo-status',
  ecosystem: '/api/ecosystem/status',
  publicStatus: '/api/intents/v1/public-status'
};

/* The seven kinds the server can self-verify. Anything stored BEYOND these
   came from an operator injection or INTENT_OPERATIONAL_EVIDENCE. */
const SELF_VERIFIABLE = [
  'approved-durable-registry', 'simulator', 'monitor', 'scheduler-operator',
  'reproducible-deployment', 'rpc', 'wallet-provider'
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [flag, inline] = token.slice(2).split('=');
    if (inline !== undefined) args[flag] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[flag] = argv[++i];
    else args[flag] = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = String(args.target || process.env.EVIDENCE_TARGET || '').trim();
if (!target) {
  console.error('✗ --target is required, e.g. --target https://your-app.vercel.app');
  process.exit(2);
}

async function get(path) {
  const url = new URL(path, target).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON is itself a signal */ }
    return { ok: response.ok, status: response.status, body, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.name === 'AbortError' ? 'timeout' : e.message, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const responses = {};
for (const [name, path] of Object.entries(ENDPOINTS)) {
  responses[name] = await get(path);
}

/* If the origin itself is unreachable, everything below would be a guess. */
if (!responses.health.ok && !responses.evidence.ok && !responses.publicStatus.ok) {
  console.error(`\n✗ ${target} did not answer any API endpoint.`);
  console.error(`  health   → ${responses.health.status || responses.health.error}`);
  console.error(`  evidence → ${responses.evidence.status || responses.evidence.error}`);
  console.error('\n  Nothing can be inferred about the environment variables of a');
  console.error('  deployment that is not serving. Check the URL and the deployment first.');
  process.exit(3);
}

const audit = responses.audit.body || {};
const evidence = responses.evidence.body || {};
const eco = responses.ecosystem.body?.data || {};
const slo = responses.slo.body || {};

const stored = Array.isArray(evidence.stored) ? evidence.stored : [];
const externalStored = stored.filter((k) => !SELF_VERIFIABLE.includes(k));

const findings = [
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    required: true,
    present: audit.configured === true && audit.durable === true,
    signal: `audit-status.configured=${audit.configured} durable=${audit.durable}`,
    needed: 'durable-immutable-audit + approved-durable-registry',
    fix: 'Vercel → Storage → Blob → Connect to Project, then REDEPLOY.'
  },
  {
    name: 'INTENT_OPERATIONAL_EVIDENCE',
    required: true,
    present: externalStored.length > 0,
    signal: `${externalStored.length} externally-supplied evidence kind(s) live${externalStored.length ? `: ${externalStored.join(', ')}` : ''}`,
    needed: 'evidence surviving a cold start on stateless functions',
    fix: 'npm run evidence:collect -- --target <url> --env   then paste into Vercel and REDEPLOY.'
  },
  {
    name: 'RPC_URL',
    required: false,
    present: stored.includes('rpc'),
    signal: `evidence kind "rpc" ${stored.includes('rpc') ? 'present' : 'absent'}`,
    needed: 'rpc evidence (wave 1)',
    fix: 'Set RPC_URL to an https endpoint (Alchemy/QuickNode).'
  },
  {
    name: 'VITE_WALLETCONNECT_PROJECT_ID',
    required: false,
    present: stored.includes('wallet-provider'),
    signal: `evidence kind "wallet-provider" ${stored.includes('wallet-provider') ? 'present' : 'absent'}`,
    needed: 'wallet-provider evidence',
    fix: 'Set the WalletConnect project id.'
  },
  {
    name: 'ECOSYSTEM_CERTIFIERS',
    required: false,
    present: eco.certificationIssuerConfigured === true,
    signal: `ecosystem/status.certificationIssuerConfigured=${eco.certificationIssuerConfigured ?? 'unavailable'}`,
    needed: 'wave 0 completion (not any of the four earnable kinds)',
    fix: 'Set ECOSYSTEM_CERTIFIERS=telegramUserId:Label.'
  }
];

const line = '─'.repeat(74);
console.log(`\nFBT deployment configuration check — ${target}`);
console.log(line);

for (const f of findings) {
  const mark = f.present ? '✓' : (f.required ? '✗' : '○');
  console.log(`${mark} ${f.name}${f.required ? '' : '  (optional here)'}`);
  console.log(`    observed  ${f.signal}`);
  if (!f.present) {
    console.log(`    needed by ${f.needed}`);
    console.log(`    fix       ${f.fix}`);
  }
  console.log('');
}

console.log(line);
console.log(`evidence     ${evidence.evidence ?? 'unavailable'}   (stored ${stored.length}, missing ${evidence.missingCount ?? '?'})`);
console.log(`audit log    entries ${audit.entryCount ?? 0}, root ${audit.rootHash ? `${String(audit.rootHash).slice(0, 16)}…` : 'none'}`);
console.log(`slo meter    ${slo.measured === true
  ? `uptime ${slo.uptime} p95 ${slo.p95LatencyMs}ms over ${slo.samples} samples`
  : `not yet measured (${slo.reason || 'no data'})`}`);
console.log(`api latency  health ${responses.health.latencyMs}ms`);

const missingRequired = findings.filter((f) => f.required && !f.present);
console.log(line);
if (missingRequired.length === 0) {
  console.log('✓ every variable these four evidence kinds depend on is live on the deployment.');
} else {
  console.log(`✗ ${missingRequired.length} required variable(s) not effective: ${missingRequired.map((f) => f.name).join(', ')}`);
  console.log('  (a variable saved in the dashboard but not redeployed counts as not effective)');
}

if (args.json) {
  console.log(JSON.stringify({ schema: 'fbt.deployment-env-check.v1', target, findings, evidence, audit, slo }, null, 2));
}

process.exit(missingRequired.length === 0 ? 0 : 1);
