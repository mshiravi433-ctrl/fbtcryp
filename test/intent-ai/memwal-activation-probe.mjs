#!/usr/bin/env node
/**
 * Probe — the Walrus Memory activation kit (`scripts/memwal-activate.mjs`).
 * ---------------------------------------------------------------------------
 * The activation kit is the only thing standing between an operator and a
 * half-configured memory tier, so its own behaviour is asserted:
 *
 *   · self-test runs the FULL preflight against a local stub and must report GO
 *   · an unregistered delegate key must report NO_GO with an actionable hint
 *   · keygen must never print the private key unless explicitly asked (--print)
 *   · status must tell an operator exactly which half is missing
 *   · every command must exit non-zero when it is not ready to be trusted
 *
 * Run: node test/intent-ai/memwal-activation-probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const rows = [];
const t = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail });

function run(args, { env = {}, expectExit = null } = {}) {
  const clean = { ...process.env, ...env };
  for (const k of ['MEMWAL_ACCOUNT_ID', 'MEMWAL_PRIVATE_KEY', 'MEMWAL_KEY', 'MEMWAL_ENABLED', 'MEMWAL_SERVER_URL']) {
    if (!(k in env)) delete clean[k];
  }
  try {
    const out = execFileSync(process.execPath, ['scripts/memwal-activate.mjs', ...args], {
      cwd: ROOT, encoding: 'utf8', env: clean, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe']
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/* -------------------------------------------------------------------------- */
/*  1. help                                                                    */
/* -------------------------------------------------------------------------- */
const help = run(['help']);
t('help exits 0 and lists the three commands',
  help.code === 0 && ['keygen', 'status', 'preflight'].every((c) => help.out.includes(c)));
t('help points at the runbook', help.out.includes('docs/WALRUS-MEMORY-ACTIVATION-FA.md'));

/* -------------------------------------------------------------------------- */
/*  2. keygen never leaks by default                                           */
/* -------------------------------------------------------------------------- */
const keygen = run(['keygen', '--no-write']);
const hexKeys = keygen.out.match(/\b[0-9a-f]{64}\b/g) || [];
t('keygen exits 0', keygen.code === 0);
t('keygen shows exactly one 64-hex key by default (the PUBLIC one)',
  hexKeys.length === 1, `found ${hexKeys.length}`);
t('keygen says the private key was not written', keygen.out.includes('--no-write'));
t('keygen tells the operator which key to register', /register THIS/i.test(keygen.out));

const keygenPrint = run(['keygen', '--no-write', '--print']);
const printed = keygenPrint.out.match(/\b[0-9a-f]{64}\b/g) || [];
t('keygen --print shows both keys and they differ',
  printed.length === 2 && printed[0] !== printed[1], `found ${printed.length}`);
t('keygen --no-write writes nothing', !existsSync(`${ROOT}.env.local`));

/* -------------------------------------------------------------------------- */
/*  3. status tells the truth about each missing half                          */
/* -------------------------------------------------------------------------- */
const off = run(['status']);
t('status exits 0 with nothing configured', off.code === 0);
t('status reports the free local tier as the active provider', /local \(free, lexical/.test(off.out));
t('status says long-term memory is already on', /ALREADY ON using the free local tier/.test(off.out));
t('status names the upgrade path to Walrus', /memwal-activate\.mjs keygen/.test(off.out));

const halfKey = run(['status'], { env: { MEMWAL_PRIVATE_KEY: 'ab'.repeat(32) } });
t('status detects a key without an account', halfKey.code === 0 && /MEMWAL_ACCOUNT_ID is missing/.test(halfKey.out));
t('status still shows the free tier serving in the meantime', /local \(free, lexical/.test(halfKey.out));
t('status prints the public key to register',
  (halfKey.out.match(/\b[0-9a-f]{64}\b/g) || []).length >= 1);

const killed = run(['status'], { env: { MEMWAL_PRIVATE_KEY: 'ab'.repeat(32), MEMWAL_ACCOUNT_ID: `0x${'cd'.repeat(32)}`, MEMWAL_ENABLED: '0' } });
t('status explains the kill switch', /DISABLED by MEMWAL_ENABLED/.test(killed.out) && /keys are present/.test(killed.out));

/* -------------------------------------------------------------------------- */
/*  4. preflight — GO on a healthy stub                                        */
/* -------------------------------------------------------------------------- */
const good = run(['preflight', '--self-test', '--json']);
let goodJson = null;
try { goodJson = JSON.parse(good.out); } catch { /* reported below */ }
t('self-test preflight exits 0', good.code === 0, `exit ${good.code}`);
t('self-test emits a parseable report', Boolean(goodJson) && goodJson.schema === 'fbt.memwal-preflight.v1');
t('self-test verdict is GO', goodJson?.verdict === 'GO');
t('self-test opens every gate',
  goodJson && Object.values(goodJson.gates).every(Boolean), JSON.stringify(goodJson?.gates));
t('self-test proves the round trip (memory recalled by meaning)',
  goodJson?.recall?.foundWrittenMemory === true && goodJson?.gates?.roundTrip === true);
t('self-test reports recall latency numbers',
  typeof goodJson?.recall?.medianMs === 'number' && goodJson.recall.probes === 3);
t('self-test records the blob id of the landed write',
  typeof goodJson?.writeJob?.blobId === 'string' && goodJson.writeJob.status === 'done');
t('self-test reports the relayer version and write state',
  goodJson?.health?.writes === 'ok' && goodJson?.health?.writeReady === true);

/* -------------------------------------------------------------------------- */
/*  5. preflight — NO_GO with an actionable reason                             */
/* -------------------------------------------------------------------------- */
const denied = run(['preflight', '--self-test', '--deny', '--json']);
let deniedJson = null;
try { deniedJson = JSON.parse(denied.out); } catch { /* reported below */ }
t('an unregistered delegate key exits non-zero', denied.code !== 0);
t('…and the verdict is NO_GO', deniedJson?.verdict === 'NO_GO');
t('…and the signed gate is the one that closed', deniedJson?.gates?.authenticated === false && deniedJson?.gates?.reachable === true);
t('…and the operator is told what to do about it',
  (deniedJson?.steps || []).some((s) => /registered on the account/.test(s.name) && /dashboard/.test(String(s.detail))));

const noCreds = run(['preflight', '--json']);
let noCredsJson = null;
try { noCredsJson = JSON.parse(noCreds.out); } catch { /* reported below */ }
t('a live preflight with no credentials still reports reachability honestly',
  noCredsJson?.verdict === 'NO_GO' && noCredsJson?.mode === 'live' && typeof noCredsJson?.gates?.reachable === 'boolean');

/* -------------------------------------------------------------------------- */
const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${rows.length - fails.length}/${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
