#!/usr/bin/env node
/**
 * WALRUS MEMORY — ACTIVATION KIT
 * ===========================================================================
 * Everything that can be automated about switching Intent OS's long-term
 * memory ON, without a single dependency and without ever printing a secret to
 * a chat log.
 *
 *   node scripts/memwal-activate.mjs keygen          generate the delegate key
 *   node scripts/memwal-activate.mjs status          is this deployment on?
 *   node scripts/memwal-activate.mjs preflight       phase-0 measurement (Go/No-Go)
 *   node scripts/memwal-activate.mjs preflight --self-test
 *                                                    the same, against a stub
 *
 * WHAT THIS SCRIPT CANNOT DO, AND WHY
 * A MemWal account is a Sui object. Creating it is one transaction signed by a
 * wallet the operator controls, plus registering the delegate key against it —
 * both happen in the Walrus Memory dashboard (https://memory.walrus.xyz). No
 * script can do that on the user's behalf without their wallet key, and their
 * wallet key must never pass through this app or a chat window. So:
 *
 *   1. operator creates the account in the dashboard        (their wallet)
 *   2. `keygen` makes the delegate key HERE, locally        (this script)
 *   3. operator registers the PUBLIC key in the dashboard   (their wallet)
 *   4. operator pastes MEMWAL_ACCOUNT_ID into the deployment env
 *   5. `preflight` proves the whole loop end to end         (this script)
 *
 * Step 4 is the only manual paste, and it is a public object id, not a secret.
 * The delegate PRIVATE key never has to leave the machine: `keygen` writes it
 * to `.env.local` (git-ignored, 0600) so it can be piped straight into
 * `vercel env add` without ever appearing on screen.
 */
import { createHash, generateKeyPairSync, randomUUID, sign as cryptoSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env.local');

/* -------------------------------------------------------------------------- */
/*  tiny .env.local loader (no dependency, never overrides a real env var)     */
/* -------------------------------------------------------------------------- */
function loadEnvFile(file = ENV_FILE) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  for (const [k, v] of Object.entries(out)) if (process.env[k] === undefined) process.env[k] = v;
  return out;
}

const say = (...a) => console.log(...a);
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function upsertEnvFile(file, pairs) {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = existing ? existing.split('\n') : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !(m[1] in pairs)) return line;
    seen.add(m[1]);
    return `${m[1]}=${pairs[m[1]]}`;
  });
  const missing = Object.keys(pairs).filter((k) => !seen.has(k));
  if (missing.length) {
    if (next.length && next[next.length - 1].trim() !== '') next.push('');
    next.push('# ─── Walrus Memory (Intent OS long-term memory) ───');
    for (const k of missing) next.push(`${k}=${pairs[k]}`);
  }
  writeFileSync(file, next.join('\n'), 'utf8');
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

/* -------------------------------------------------------------------------- */
/*  keygen                                                                     */
/* -------------------------------------------------------------------------- */
function keygen(argv) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' })).subarray(-32);
  const pubHex = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex');
  const privHex = seed.toString('hex');

  say('');
  say('  WALRUS MEMORY — delegate key');
  say('  ────────────────────────────────────────────────────────────────');
  say(`  public key (register THIS in the dashboard):\n    ${pubHex}`);
  say('');
  say(`  private key: ${ok('written to .env.local (git-ignored, chmod 600)')}`);
  if (argv.includes('--print')) {
    say(`    ${warn('shown because you passed --print:')} ${privHex}`);
  } else {
    say(dim('    (hidden on purpose: a secret in a terminal scrollback is a leaked secret)'));
    say(dim('     re-run with --print if you really need it on screen.'));
  }
  if (argv.includes('--no-write')) {
    say('');
    say(warn('  --no-write: nothing was written. Nothing was printed either unless you also passed --print.'));
    if (!argv.includes('--print')) return;
  } else {
    upsertEnvFile(ENV_FILE, { MEMWAL_PRIVATE_KEY: privHex });
    say('');
    say(`  saved → ${ENV_FILE}`);
  }
  say('');
  say('  NEXT');
  say('  1. dashboard → create a Walrus Memory account (one Sui transaction)');
  say('  2. dashboard → add a delegate key → paste the public key above');
  say(`  3. copy the MemWalAccount object id, then add BOTH to the deployment env:`);
  say(`       ${dim('vercel env add MEMWAL_PRIVATE_KEY production   # paste from .env.local')}`);
  say(`       ${dim('vercel env add MEMWAL_ACCOUNT_ID  production   # 0x… (public)')}`);
  say('  4. redeploy, then:  node scripts/memwal-activate.mjs preflight');
  say('');
}

/* -------------------------------------------------------------------------- */
/*  status                                                                     */
/* -------------------------------------------------------------------------- */
async function status() {
  loadEnvFile();
  const { bridgeStatus } = await import('../server/walrusMemoryBridge.js');
  const s = bridgeStatus();
  say('');
  say('  WALRUS MEMORY — status of this process');
  say('  ────────────────────────────────────────────────────────────────');
  say(`  configured : ${s.configured ? ok('yes') : warn('no')}   mode: ${s.mode}`);
  say(`  relayer    : ${s.relayer || dim('(not used while off)')}`);
  say(`  account    : ${s.account || dim('(none)')}`);
  say(`  namespace  : ${s.namespacePrefix}-<hash of owner>`);
  say(`  counters   : ${JSON.stringify(s.counters)}`);
  if (s.lastError) say(`  last error : ${bad(s.lastError)}`);
  say('');
  if (s.configured && !s.enabled) {
    say(warn('  The feature is DISABLED by MEMWAL_ENABLED — the keys are present and untouched.'));
    say('  Remove MEMWAL_ENABLED (or set it to 1) and redeploy to turn it back on.');
    say('');
    return s;
  }
  if (!s.configured) {
    say(warn('  The feature is OFF. Nothing is sent anywhere.'));
    const hasKey = Boolean(process.env.MEMWAL_PRIVATE_KEY || process.env.MEMWAL_KEY);
    const hasAccount = Boolean(process.env.MEMWAL_ACCOUNT_ID);
    if (!hasKey && !hasAccount) say('  Missing both halves. Start with:  node scripts/memwal-activate.mjs keygen');
    else if (!hasKey) say('  Missing MEMWAL_PRIVATE_KEY. Run:  node scripts/memwal-activate.mjs keygen');
    else if (!hasAccount) {
      say('  The delegate key exists but MEMWAL_ACCOUNT_ID is missing.');
      say('  Create the account in the dashboard, register the public key, then set MEMWAL_ACCOUNT_ID.');
      const { keyPair } = (await import('../server/walrusMemoryBridge.js')).__internals;
      const seed = (await import('../server/walrusMemoryBridge.js')).__internals.parseSeed(process.env.MEMWAL_PRIVATE_KEY || process.env.MEMWAL_KEY);
      if (seed) say(`  Public key to register: ${keyPair(seed).publicKeyHex}`);
    }
    say('');
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/*  preflight                                                                  */
/* -------------------------------------------------------------------------- */
const POLL_INTERVAL_MS = 1500;
const POLL_BUDGET_MS = 90_000;

async function preflight(argv) {
  const selfTest = argv.includes('--self-test');
  const cleanup = argv.includes('--cleanup');
  const asJson = argv.includes('--json');
  const nsOverride = (() => {
    const i = argv.indexOf('--namespace');
    return i >= 0 ? String(argv[i + 1] || '').trim() : '';
  })();

  loadEnvFile();
  const { relayerRequest, bridgeStatus } = await import('../server/walrusMemoryBridge.js');

  const report = {
    schema: 'fbt.memwal-preflight.v1',
    mode: selfTest ? 'self-test' : 'live',
    at: new Date().toISOString(),
    steps: [],
    verdict: 'UNKNOWN',
    gates: {}
  };
  const step = (name, pass, detail = null, extra = null) => {
    report.steps.push({ name, pass: Boolean(pass), detail, ...(extra ? { extra } : {}) });
    if (!asJson) say(`  ${pass ? ok(' ok ') : bad('FAIL')}  ${name}${detail ? dim(`  ${detail}`) : ''}`);
    return pass;
  };

  const stub = selfTest ? await startStub({ denySigned: argv.includes('--deny') }) : null;
  if (stub) {
    process.env.MEMWAL_SERVER_URL = `http://127.0.0.1:${stub.port}`;
    if (!process.env.MEMWAL_ACCOUNT_ID) process.env.MEMWAL_ACCOUNT_ID = `0x${'ab'.repeat(32)}`;
    if (!process.env.MEMWAL_PRIVATE_KEY) process.env.MEMWAL_PRIVATE_KEY = stub.seedHex;
  }

  const cfg = bridgeStatus();
  const started = Date.now();
  const namespace = nsOverride || `fbt-preflight-${randomUUID().slice(0, 8)}`;
  report.namespace = namespace;

  if (!asJson) {
    say('');
    say(`  WALRUS MEMORY — preflight (${report.mode})`);
    say('  ────────────────────────────────────────────────────────────────');
    say(`  relayer : ${cfg.relayer || process.env.MEMWAL_SERVER_URL || '(default)'}`);
  }

  /* 1 — is the service alive at all? (public route, no credentials) */
  const health = await relayerRequest('/health', { method: 'GET', public: true });
  if (!step('relayer /health answers', health.ok, health.ok ? `status=${health.json?.status} writes=${health.json?.writes}` : `${health.reason}${health.detail ? ` (${health.detail})` : ''}`)) {
    report.verdict = 'NO_GO';
    report.gates = { reachable: false };
    return finish(report, asJson, stub);
  }
  report.health = {
    status: health.json?.status || null,
    writes: health.json?.writes || null,
    writeReady: health.json?.write_ready === true,
    version: health.json?.relayerVersion || health.json?.version || null
  };
  report.gates.reachable = true;
  report.gates.writesAccepting = health.json?.writes === 'ok';
  step('the relayer accepts writes', health.json?.writes === 'ok',
    health.json?.writes === 'ok' ? null : `writes=${health.json?.writes} — a paused/degraded relayer will refuse remember`);

  /* 2 — deployment parameters (public route) */
  const config = await relayerRequest('/config', { method: 'GET', public: true });
  step('relayer /config answers', config.ok, config.ok ? `network=${config.json?.network}` : config.reason);
  if (config.ok) {
    report.config = { network: config.json?.network || null, packageId: config.json?.packageId || null, suiTransport: config.json?.suiTransport || null };
    step('the deployment reports a package id', typeof config.json?.packageId === 'string' && config.json.packageId.startsWith('0x'));
  }

  /* 3 — credentials + the signed write path */
  if (!cfg.configured) {
    step('credentials are configured', false, 'set MEMWAL_ACCOUNT_ID + MEMWAL_PRIVATE_KEY (see the activation runbook)');
    report.verdict = 'NO_GO';
    report.gates.credentials = false;
    return finish(report, asJson, stub);
  }
  report.gates.credentials = true;
  step('credentials are configured', true, `account ${cfg.account}`);

  const text = `preflight ${new Date().toISOString()} — این یک حافظهٔ آزمایشی است و هیچ دادهٔ کاربری نیست`;
  const writeStarted = Date.now();
  const remember = await relayerRequest('/api/remember', { method: 'POST', payload: { text, namespace } });
  report.gates.authenticated = remember.ok;
  step('signed /api/remember is accepted', remember.ok,
    remember.ok ? `job ${remember.json?.job_id}` : `${remember.reason}${remember.detail ? ` — ${remember.detail}` : ''}`);
  if (!remember.ok) {
    report.verdict = 'NO_GO';
    if (remember.reason === 'HTTP_401' || remember.reason === 'HTTP_403') {
      step('the delegate key is registered on the account', false,
        'the relayer resolved the key against MemWalAccount.delegate_keys and rejected it — add the public key in the dashboard');
    }
    return finish(report, asJson, stub);
  }
  const jobId = remember.json?.job_id;
  report.writeAcceptedMs = Date.now() - writeStarted;

  /* 4 — does the write actually land? (poll the job) */
  let job = null;
  const until = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < until) {
    const poll = await relayerRequest(`/api/remember/${encodeURIComponent(String(jobId))}`, { method: 'GET' });
    if (!poll.ok) { job = { status: 'poll_failed', error: poll.reason }; break; }
    job = poll.json;
    if (['done', 'uploaded', 'failed'].includes(String(job?.status))) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  report.writeJob = { id: jobId, status: job?.status || 'timeout', blobId: job?.blob_id || null, error: job?.error || null, totalMs: Date.now() - writeStarted };
  const landed = ['done', 'uploaded'].includes(String(job?.status));
  step('the write lands on Walrus (job reaches done)', landed,
    landed ? `blob ${job?.blob_id || '(pending id)'} in ${report.writeJob.totalMs}ms` : `status=${job?.status}${job?.error ? ` error=${job.error}` : ''}`);
  if (!landed) {
    report.verdict = 'NO_GO';
    report.gates.writesLanded = false;
    return finish(report, asJson, stub);
  }
  report.gates.writesLanded = true;

  /* 5 — recall: correctness first, then latency */
  const probes = [];
  let hitText = null;
  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now();
    const recall = await relayerRequest('/api/recall', {
      method: 'POST',
      payload: { query: 'preflight memory test', limit: 5, namespace, deadline_ms: 15000 }
    });
    const ms = Date.now() - t0;
    probes.push({ ok: recall.ok, ms, reason: recall.reason || null, count: Array.isArray(recall.json?.results) ? recall.json.results.length : 0 });
    if (recall.ok && Array.isArray(recall.json?.results)) {
      const found = recall.json.results.find((r) => String(r?.text || '').includes('preflight'));
      if (found) hitText = String(found.text).slice(0, 80);
    }
  }
  const okProbes = probes.filter((p) => p.ok);
  const times = okProbes.map((p) => p.ms).sort((a, b) => a - b);
  report.recall = {
    probes: probes.length,
    succeeded: okProbes.length,
    minMs: times[0] ?? null,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
    maxMs: times.length ? times[times.length - 1] : null,
    foundWrittenMemory: Boolean(hitText),
    sample: hitText
  };
  step('recall answers', okProbes.length > 0, okProbes.length ? `${times[0]}–${times[times.length - 1]}ms` : String(probes[0]?.reason || 'no answer'));
  step('the written memory is recalled by meaning', Boolean(hitText), hitText || 'the probe text did not come back in the top 5');
  report.gates.recallWorks = okProbes.length > 0;
  report.gates.roundTrip = Boolean(hitText);

  /* 6 — the deadline gate: does the relayer respect the budget? */
  const t0 = Date.now();
  const deadlineProbe = await relayerRequest('/api/recall', {
    method: 'POST',
    payload: { query: 'preflight memory test', limit: 5, namespace, deadline_ms: 2000 }
  });
  const deadlineMs = Date.now() - t0;
  report.deadline = { ms: deadlineMs, ok: deadlineProbe.ok, reason: deadlineProbe.reason || null };
  step('a 2s deadline is honoured (or answers in time)', deadlineMs < 6000, `${deadlineMs}ms`);

  /* 7 — cleanup of the throwaway namespace (opt-in) */
  if (cleanup) {
    const forget = await relayerRequest('/api/forget', { method: 'POST', payload: { namespace } });
    step('preflight namespace cleared from the index', forget.ok,
      forget.ok ? `deleted=${forget.json?.deleted}` : forget.reason);
  } else {
    step('preflight namespace left in place', true,
      `re-run with --cleanup to drop it, or POST /api/forget {"namespace":"${namespace}"}`);
  }

  const healthy = report.gates.reachable && report.gates.credentials && report.gates.authenticated
    && report.gates.writesLanded && report.gates.roundTrip;
  report.verdict = healthy ? 'GO' : 'NO_GO';
  report.totalMs = Date.now() - started;
  return finish(report, asJson, stub);
}

/* -------------------------------------------------------------------------- */
/*  self-test stub relayer (proves this script, needs no credentials)          */
/* -------------------------------------------------------------------------- */
async function startStub({ denySigned = false } = {}) {
  const { privateKey } = generateKeyPairSync('ed25519');
  const seedHex = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' })).subarray(-32).toString('hex');
  const memories = new Map();
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      const signed = ['x-public-key', 'x-signature', 'x-timestamp', 'x-nonce'].every((h) => req.headers[h]);
      if (req.url === '/health') return send(200, { status: 'ok', writes: 'ok', write_ready: true, relayerVersion: 'stub' });
      if (req.url === '/config') return send(200, { network: 'testnet', packageId: `0x${'ab'.repeat(32)}`, suiTransport: 'grpc' });
      if (!signed) return send(401, { error: 'missing signed headers' });
      /* `--deny` reproduces the most common first-run failure: the delegate key
         is valid but not yet registered in MemWalAccount.delegate_keys. */
      if (denySigned) return send(401, { error: 'AUTH_REJECTED' });
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/api/remember' && req.method === 'POST') {
        const id = randomUUID();
        memories.set(id, { text: body.text, namespace: body.namespace });
        return send(202, { job_id: id, status: 'running' });
      }
      if (req.url?.startsWith('/api/remember/') && req.method === 'GET') {
        const id = req.url.split('/').pop();
        if (!memories.has(id)) return send(404, { error: 'unknown job' });
        return send(200, { job_id: id, status: 'done', blob_id: `blob-${createHash('sha256').update(id).digest('hex').slice(0, 12)}` });
      }
      if (req.url === '/api/recall') {
        const rows = [...memories.values()].filter((m) => m.namespace === body.namespace);
        const results = rows.map((m) => ({ blob_id: 'blob-1', text: m.text, distance: 0.1, score: 0.9 }));
        return send(200, { results: body.query.includes('preflight') ? results : [], total: results.length });
      }
      if (req.url === '/api/forget') return send(200, { deleted: memories.size, namespace: body.namespace });
      return send(404, { error: 'not found' });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, seedHex, close: () => server.close() };
}

function finish(report, asJson, stub) {
  if (stub) stub.close();
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    say('  ────────────────────────────────────────────────────────────────');
    const g = report.gates;
    say(`  gates: reachable=${g.reachable ? ok('yes') : bad('no')} credentials=${g.credentials ? ok('yes') : bad('no')} signed=${g.authenticated ? ok('yes') : bad('no')} written=${g.writesLanded ? ok('yes') : bad('no')} recalled=${g.roundTrip ? ok('yes') : bad('no')}`);
    if (report.recall?.medianMs != null) say(`  recall latency: min ${report.recall.minMs}ms · median ${report.recall.medianMs}ms · max ${report.recall.maxMs}ms`);
    say(`  verdict: ${report.verdict === 'GO' ? ok('GO') : bad(report.verdict)}`);
    if (report.verdict === 'GO' && report.mode === 'live') {
      say('');
      say('  Next: set MEMWAL_ENABLED is unset (or not false) in the deployment and redeploy,');
      say('  then open GET /api/v1/ai/memory/long-term — mode should read "on".');
    }
    say('');
  }
  process.exit(report.verdict === 'GO' ? 0 : 1);
}

/* -------------------------------------------------------------------------- */
const [, , cmd = 'help', ...rest] = process.argv;
const commands = { keygen, status, preflight };
if (!commands[cmd]) {
  say('');
  say('  Walrus Memory activation kit — Intent OS long-term memory');
  say('');
  say('    keygen      generate the delegate keypair (public key → dashboard, private → .env.local)');
  say('    status      is this process configured and on?');
  say('    preflight   live Go/No-Go measurement against the relayer (--cleanup, --json)');
  say('    preflight --self-test   the same flow against a local stub (no credentials, no network)');
  say('');
  say(`  runbook: ${dim('docs/WALRUS-MEMORY-ACTIVATION-FA.md')}`);
  say('');
  process.exit(cmd === 'help' ? 0 : 2);
}
await commands[cmd](rest);
