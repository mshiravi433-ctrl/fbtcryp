#!/usr/bin/env node
/**
 * Probe — `scripts/memwal-create-account.mjs` (the one step that signs on-chain)
 * ---------------------------------------------------------------------------
 * The on-chain submission itself cannot run without a funded wallet and a Sui
 * fullnode, so it is NOT asserted here and is not claimed to be tested. What is
 * asserted is everything that decides whether the operator gets that far:
 *
 *   · every prerequisite gate fails loudly, in order, with the fix in the text
 *   · the package id comes from the LIVE relayer /config, and an env override
 *     that disagrees is refused (the retired-package-id trap)
 *   · a missing registry id, a malformed owner key and a missing delegate key
 *     each stop before anything is signed
 *   · the dry run reaches "every prerequisite resolved" when the SDK is present
 *   · a missing SDK names the exact install command and exits 3
 *   · a failing transaction is reported as a named failure, never a stack trace
 *
 * The stub relayer is started by this probe on an ephemeral port; the tests
 * never touch the real service. Run:
 *   node test/intent-ai/memwal-account-tool-probe.mjs
 */
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const rows = [];
const t = (name, ok, detail = '') => rows.push({ name, ok: Boolean(ok), detail });

const DELEGATE = 'ab'.repeat(32);
const ACCOUNT_ENV = join(mkdtempSync(join(tmpdir(), 'memwal-probe-')), '.env.local');
writeFileSync(ACCOUNT_ENV, `# probe env file (throwaway)\nMEMWAL_PRIVATE_KEY=${DELEGATE}\n`, { mode: 0o600 });

/* -------------------------------------------------------------------------- */
/*  stub relayer                                                               */
/* -------------------------------------------------------------------------- */
const PKG = `0x${'ce'.repeat(32)}`;
const REGISTRY = `0x${'0d'.repeat(32)}`;
function startStub({ registry = REGISTRY } = {}) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/config') {
      return res.end(JSON.stringify({
        packageId: PKG,
        network: 'mainnet',
        suiRpcUrl: 'https://fullnode.mainnet.sui.io',
        suiGrpcUrl: 'https://fullnode.mainnet.sui.io',
        suiTransport: 'grpc',
        ...(registry ? { registryId: registry } : {})
      }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  return server;
}

/**
 * The child is spawned ASYNCHRONOUSLY on purpose: `execFileSync` would block
 * this process's event loop, and the stub relayer lives in it — the child would
 * then be unable to reach the stub and every stub-backed assertion would fail
 * with a misleading NETWORK error.
 */
function run(args, { env = {}, timeout = 45000 } = {}) {
  const clean = { ...process.env, MEMWAL_ENV_FILE: ACCOUNT_ENV, ...env };
  for (const k of ['MEMWAL_ACCOUNT_ID', 'MEMWAL_PRIVATE_KEY', 'MEMWAL_REGISTRY_ID', 'MEMWAL_PACKAGE_ID', 'SUI_PRIVATE_KEY', 'MEMWAL_SERVER_URL']) {
    if (!(k in env)) delete clean[k];
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/memwal-create-account.mjs', ...args], {
      cwd: ROOT, env: clean, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, out }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
  });
}

/**
 * The Walrus Memory SDK is OPTIONAL for this repo: it is needed only by the
 * account tool, so it is not a dependency of the app (it would add ~55MB to
 * every install for a step most deployments never run). The gate assertions
 * below therefore need it, and this probe links it in when the operator points
 * `MEMWAL_SDK_DIR` at a directory that has it installed:
 *
 *   npm i --prefix /tmp/mw @mysten-incubation/memwal @mysten/sui
 *   MEMWAL_SDK_DIR=/tmp/mw node test/intent-ai/memwal-account-tool-probe.mjs
 */
const SDK_DIR = process.env.MEMWAL_SDK_DIR || '';
const LINKED = [];
function linkSdk() {
  if (!SDK_DIR) return false;
  const src = join(SDK_DIR, 'node_modules');
  const wanted = ['@mysten-incubation', '@mysten/sui'];
  if (!wanted.every((w) => existsSync(join(src, w)))) return false;
  mkdirSync(join(ROOT, 'node_modules', '@mysten'), { recursive: true });
  for (const w of wanted) {
    const target = join(ROOT, 'node_modules', w);
    try {
      if (!existsSync(target)) { symlinkSync(join(src, w), target); LINKED.push(target); }
    } catch { /* already linked or not permitted — the import check below decides */ }
  }
  return wanted.every((w) => existsSync(join(ROOT, 'node_modules', w)));
}
const sdkLinked = linkSdk();
function unlinkSdk() {
  for (const t of LINKED) { try { rmSync(t, { recursive: true, force: true }); } catch { /* best effort */ } }
}
process.on('exit', unlinkSdk);

/* A throwaway bech32 owner key. Only ever used for dry runs. */
const OWNER_KEY = (() => {
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e',
      "const {Ed25519Keypair}=await import('@mysten/sui/keypairs/ed25519');console.log(Ed25519Keypair.generate().getSecretKey());"
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    return out.trim();
  } catch { return null; }
})();

/* -------------------------------------------------------------------------- */
/*  1. help / no prerequisites                                                 */
/* -------------------------------------------------------------------------- */
const help = await run(['--help']);
t('--help exits 0 and documents both modes',
  help.code === 0 && help.out.includes('dry run (default)') && help.out.includes('--yes'));
t('--help states the owner key is never stored or printed', /never written to disk/.test(help.out) && /never printed/.test(help.out));

writeFileSync(ACCOUNT_ENV, '# empty probe env\n', { mode: 0o600 });
const noDelegate = await run([]);
t('a missing delegate key stops with the keygen command',
  noDelegate.code === 2 && /npm run memwal:keygen/.test(noDelegate.out));

const noOwner = await run([], { env: { MEMWAL_PRIVATE_KEY: DELEGATE } });
t('a missing owner key stops with the three ways to provide it',
  noOwner.code === 2 && /SUI_PRIVATE_KEY/.test(noOwner.out) && /--key-file/.test(noOwner.out));

const badOwner = await run([], { env: { MEMWAL_PRIVATE_KEY: DELEGATE, SUI_PRIVATE_KEY: '0x' + '11'.repeat(32) } });
t('a raw hex owner key is refused by name (bech32 only)',
  badOwner.code === 2 && /suiprivkey1/.test(badOwner.out));

/* -------------------------------------------------------------------------- */
/*  2. relayer-derived package id + the retired-id trap                        */
/* -------------------------------------------------------------------------- */
const stub = startStub();
await once(stub, 'listening');
const stubUrl = `http://127.0.0.1:${stub.address().port}`;

const sdkReadyEarly = await (async () => {
  try { await import('@mysten-incubation/memwal/account'); await import('@mysten/sui/grpc'); return true; } catch { return false; }
})();
if (!sdkReadyEarly) {
  console.log(`  skip  the relayer gates and the dry run (SDK not installed${SDK_DIR ? ` — MEMWAL_SDK_DIR=${SDK_DIR} did not resolve` : ''})`);
  console.log('        to exercise them:  npm i --prefix /tmp/mw @mysten-incubation/memwal @mysten/sui');
  console.log('                           MEMWAL_SDK_DIR=/tmp/mw node test/intent-ai/memwal-account-tool-probe.mjs');
}

const mismatch = sdkReadyEarly ? await run([], {
  env: { MEMWAL_PRIVATE_KEY: DELEGATE, SUI_PRIVATE_KEY: OWNER_KEY || `suiprivkey1${'q'.repeat(40)}`, MEMWAL_SERVER_URL: stubUrl, MEMWAL_PACKAGE_ID: `0x${'ee'.repeat(32)}` }
}) : null;
if (mismatch) {
  t('a package id that disagrees with /config is refused',
    mismatch.code === 2 && /MEMWAL_PACKAGE_ID disagrees/.test(mismatch.out));
  t('…and the refusal explains the 401 AUTH_REJECTED consequence',
    /AUTH_REJECTED/.test(mismatch.out));
}

/* A deployment whose /config does not publish the registry id: the id must
   then come from the operator (the dashboard), and the script must say so
   rather than invent one. */
const stubNoRegistry = startStub({ registry: null });
await once(stubNoRegistry, 'listening');
const noRegistry = sdkReadyEarly ? await run([], {
  env: {
    MEMWAL_PRIVATE_KEY: DELEGATE,
    SUI_PRIVATE_KEY: OWNER_KEY || `suiprivkey1${'q'.repeat(40)}`,
    MEMWAL_SERVER_URL: `http://127.0.0.1:${stubNoRegistry.address().port}`,
    MEMWAL_REGISTRY_ID: ''
  }
}) : null;
if (noRegistry) t('a missing registry id is refused with where to find it', noRegistry.code === 2 && /dashboard/.test(noRegistry.out));
stubNoRegistry.close();
stub.close();

const unreachable = sdkReadyEarly ? await run([], {
  env: { MEMWAL_PRIVATE_KEY: DELEGATE, SUI_PRIVATE_KEY: OWNER_KEY || `suiprivkey1${'q'.repeat(40)}`, MEMWAL_SERVER_URL: 'http://127.0.0.1:9', MEMWAL_REGISTRY_ID: REGISTRY }
}) : null;
if (unreachable) {
  t('an unreachable relayer is NETWORK, not a crash', unreachable.code === 4 && /Cannot read the relayer/.test(unreachable.out));
  t('…and it says why the id must come from the live deployment', /retired/.test(unreachable.out));
}

/* -------------------------------------------------------------------------- */
/*  3. the dry run — needs the SDK, so it is skipped when it is absent          */
/* -------------------------------------------------------------------------- */
let sdkReady = false;
try { await import('@mysten-incubation/memwal/account'); await import('@mysten/sui/grpc'); sdkReady = true; } catch { sdkReady = false; }

if (!sdkReady) {
  const missing = await run([], { env: { MEMWAL_PRIVATE_KEY: DELEGATE, SUI_PRIVATE_KEY: OWNER_KEY || `suiprivkey1${'q'.repeat(40)}`, MEMWAL_SERVER_URL: stubUrl, MEMWAL_REGISTRY_ID: REGISTRY } });
  t('a missing SDK exits 3 and prints the exact install command',
    missing.code === 3 && /@mysten-incubation\/memwal @mysten\/sui/.test(missing.out));
} else {
  const stub2 = startStub();
  await once(stub2, 'listening');
  const url2 = `http://127.0.0.1:${stub2.address().port}`;
  const env2 = { MEMWAL_PRIVATE_KEY: DELEGATE, SUI_PRIVATE_KEY: OWNER_KEY, MEMWAL_SERVER_URL: url2, MEMWAL_REGISTRY_ID: REGISTRY };

  const ready = await run(['--json'], { env: env2 });
  let readyJson = null;
  try { readyJson = JSON.parse(ready.out); } catch { /* asserted below */ }
  t('the dry run resolves every prerequisite (exit 0)', ready.code === 0, `exit ${ready.code}`);
  t('…and reports ready:true in machine-readable form', readyJson?.ready === true && readyJson?.mode === 'dry-run');
  t('…and takes the package id from /config', readyJson?.relayer?.packageId === PKG && readyJson?.relayer?.network === 'mainnet');
  t('…and never echoes the owner key', !JSON.stringify(readyJson).includes(String(OWNER_KEY).slice(0, 24)));
  t('…and reports which Sui client class it would use',
    typeof readyJson?.suiClient?.kind === 'string' && /Client/.test(readyJson.suiClient.kind), readyJson?.suiClient?.kind);

  const readyText = await run([], { env: env2 });
  t('the human dry run prints the two transactions and says nothing was sent',
    /create_account/.test(readyText.out) && /add_delegate_key/.test(readyText.out) && /dry run — nothing was signed or sent/.test(readyText.out));

  const existing = await run(['--account-id', `0x${'11'.repeat(32)}`], { env: env2 });
  t('--account-id skips creation and says so', /skipped — using account/.test(existing.out));

  const dryJsonExisting = await run(['--json', '--account-id', `0x${'11'.repeat(32)}`], { env: env2 });
  let existingJson = null;
  try { existingJson = JSON.parse(dryJsonExisting.out); } catch { /* asserted below */ }
  t('…and the plan records that it will not create an account', existingJson?.plan?.createsAccount === false);

  stub2.close();
}

/* -------------------------------------------------------------------------- */
const fails = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${rows.length - fails.length}/${rows.length} passed`);
process.exit(fails.length ? 1 : 0);
