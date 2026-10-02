#!/usr/bin/env node
/**
 * WALRUS MEMORY — CREATE THE ACCOUNT (the one step that needs a wallet)
 * ===========================================================================
 * A MemWal account is a Sui object. Creating it is one transaction signed by
 * the owner's wallet, and registering the delegate key is a second one. This
 * script does both, on YOUR machine, with YOUR key — which never leaves that
 * machine and is never written to disk by this file.
 *
 *   node scripts/memwal-create-account.mjs              # dry run: prove readiness
 *   node scripts/memwal-create-account.mjs --yes        # execute on-chain
 *
 * WHY A SCRIPT AT ALL, WHEN THERE IS A DASHBOARD
 *   1. The dashboard is fine. This exists for operators who would rather not
 *      paste anything into a web page, and it is scriptable and diffable.
 *   2. It reads the CURRENT package id from the relayer's own /config instead
 *      of trusting a document. The published docs have already listed a retired
 *      mainnet package once; an account created under a stale package is an
 *      account the production relayer refuses (HTTP 401 AUTH_REJECTED). If
 *      MEMWAL_PACKAGE_ID is set and disagrees with /config, this script stops.
 *   3. It passes an explicit Sui client into the SDK. As of @mysten/sui 2.33 the
 *      `SuiClient` class no longer exists, and the MemWal account helpers throw
 *      "SuiClient not found. For @mysten/sui v2.6.0+, pass suiClient in opts."
 *      without one. This script builds the right client for the transport the
 *      relayer itself prefers (gRPC, else JSON-RPC, else legacy).
 *
 * NOT EXERCISED IN CI. The on-chain submission cannot run in a sandbox with no
 * wallet and no Sui fullnode access, so it is not claimed to be tested here:
 * the offline paths are asserted by
 * `test/intent-ai/memwal-account-tool-probe.mjs` and the dry run is the gate
 * you run before `--yes`.
 *
 * WHAT IT NEEDS
 *   · @mysten-incubation/memwal + @mysten/sui installed (the script says the
 *     exact command if they are missing; nothing is installed for you)
 *   · MEMWAL_REGISTRY_ID (from the dashboard) — or a relayer that returns it
 *   · the delegate key from `npm run memwal:keygen` (.env.local)
 *   · the OWNER Sui private key (bech32, `suiprivkey1…`) via SUI_PRIVATE_KEY,
 *     --key-file, or a hidden prompt. One Sui address can own exactly one account.
 */
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELAYER_DEFAULT = 'https://relayer.memory.walrus.xyz';
/* Where the delegate key is read from and the account id is written to.
   Overridable so a probe (or an operator keeping credentials outside the
   checkout) can point at another file without touching the default. */
const ENV_FILE = (() => {
  const i = process.argv.indexOf('--env-file');
  const fromArg = i >= 0 ? process.argv[i + 1] : null;
  return fromArg || process.env.MEMWAL_ENV_FILE || join(ROOT, '.env.local');
})();
const PKCS8_PREFIX = '302e020100300506032b657004220420';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const JSON_OUT = flag('--json');
const say = (...a) => { if (!JSON_OUT) console.log(...a); };

const CODES = {
  EXIT_OK: 0,
  EXIT_UNEXPECTED: 1,
  EXIT_NOT_READY: 2,
  EXIT_SDK_MISSING: 3,
  EXIT_RELAYER: 4,
  EXIT_TX_FAILED: 5
};

/* -------------------------------------------------------------------------- */
/*  env file (read-only here; only the ACCOUNT ID is ever written back)        */
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
  return out;
}

function upsertEnvFile(pairs, file = ENV_FILE) {
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
    next.push('# ─── Walrus Memory account (written by scripts/memwal-create-account.mjs) ───');
    for (const k of missing) next.push(`${k}=${pairs[k]}`);
  }
  writeFileSync(file, next.join('\n'), 'utf8');
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

/* -------------------------------------------------------------------------- */
/*  keys                                                                       */
/* -------------------------------------------------------------------------- */
function delegatePublicKeyHex(env) {
  const raw = String(process.env.MEMWAL_PRIVATE_KEY || process.env.MEMWAL_KEY || env.MEMWAL_PRIVATE_KEY || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(raw) && !/^[0-9a-fA-F]{128}$/.test(raw)) return null;
  const seed = Buffer.from(raw.slice(0, 64), 'hex');
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from(PKCS8_PREFIX, 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Buffer.from(spki).subarray(-32).toString('hex');
}

/** Hidden prompt — a wallet key typed at a terminal must not be echoed. */
function askHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    let buf = '';
    const onData = (chunk) => {
      const s = String(chunk);
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          if (stdin.setRawMode) stdin.setRawMode(wasRaw === true);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(buf.trim() || null);
          return;
        }
        if (ch === '\u0003') { // Ctrl-C
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function ownerKey(env) {
  const fromEnv = String(process.env.SUI_PRIVATE_KEY || '').trim();
  if (fromEnv) return { key: fromEnv, source: 'SUI_PRIVATE_KEY' };
  const file = opt('--key-file') || env.SUI_PRIVATE_KEY_FILE;
  if (file) {
    if (!existsSync(file)) return { error: `key file not found: ${file}` };
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return { error: `key file is empty: ${file}` };
    return { key: raw, source: `file ${file}` };
  }
  return { key: null, source: null };
}

/* -------------------------------------------------------------------------- */
/*  relayer /config — the CURRENT package id, not a document's              */
/* -------------------------------------------------------------------------- */
async function relayerConfig(serverUrl, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}/config`, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', detail: String(err?.message || err).slice(0, 160) };
  } finally {
    clearTimeout(t);
  }
}

/* -------------------------------------------------------------------------- */
/*  SDK loading + the Sui client the MemWal account helpers now require        */
/* -------------------------------------------------------------------------- */
async function loadSdk() {
  try {
    const account = await import('@mysten-incubation/memwal/account');
    await import('@mysten/sui/transactions');
    return { ok: true, account };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * `@mysten/sui` 2.33 has no `SuiClient`; MemWal's helpers throw without one.
 * Build the client for the transport the relayer prefers, and say which class
 * was chosen so a failure is diagnosable from the log alone.
 */
async function buildSuiClient({ network = 'mainnet', transport = null, grpcUrl = null, rpcUrl = null } = {}) {
  const tries = [];
  if (transport !== 'jsonrpc') {
    try {
      const { SuiGrpcClient } = await import('@mysten/sui/grpc');
      if (typeof SuiGrpcClient === 'function') {
        const client = grpcUrl
          ? new SuiGrpcClient({ network, baseUrl: grpcUrl })
          : new SuiGrpcClient({ network });
        return { ok: true, client, kind: 'SuiGrpcClient', url: grpcUrl || `default ${network}` };
      }
      tries.push('@mysten/sui/grpc: SuiGrpcClient not exported');
    } catch (err) { tries.push(`@mysten/sui/grpc: ${String(err?.message || err).slice(0, 80)}`); }
  }
  try {
    const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
    if (typeof SuiJsonRpcClient === 'function' && rpcUrl) {
      const client = new SuiJsonRpcClient({ network, url: rpcUrl });
      return { ok: true, client, kind: 'SuiJsonRpcClient', url: rpcUrl };
    }
    tries.push('@mysten/sui/jsonRpc: needs a url');
  } catch (err) { tries.push(`@mysten/sui/jsonRpc: ${String(err?.message || err).slice(0, 80)}`); }
  try {
    const legacy = await import('@mysten/sui/client');
    if (typeof legacy.SuiClient === 'function' && rpcUrl) {
      const client = new legacy.SuiClient({ url: rpcUrl });
      return { ok: true, client, kind: 'SuiClient (legacy)', url: rpcUrl };
    }
    tries.push('@mysten/sui/client: no SuiClient export (removed in v2.6+)');
  } catch (err) { tries.push(`@mysten/sui/client: ${String(err?.message || err).slice(0, 80)}`); }
  return { ok: false, error: 'NO_SUI_CLIENT', tries };
}

/** Move abort codes → what the operator should actually do. */
function explainAbort(message) {
  const text = String(message || '');
  const codes = Object.entries({
    0: 'EDelegateKeyAlreadyExists — this delegate key is already registered on the account. Nothing to do.',
    2: 'ETooManyDelegateKeys — the account already holds the maximum of 20 delegate keys. Remove one first.',
    3: 'EAccountAlreadyExists — this Sui address already owns a MemWal account. Re-run with --account-id <0x…> (the dashboard shows it) to only register the delegate key.',
    4: 'ENotOwner — the key you supplied is not the owner of that account.',
    5: 'EInvalidPublicKeyLength — the delegate public key is not 32 bytes. Re-run `npm run memwal:keygen`.',
    6: 'EAccountDeactivated — the account is frozen.',
    7: 'EWrongVersion — the registry behavior version does not match this package. Your packageId/registryId pair is likely stale.',
    20: 'EAccountQuarantined — an administrator quarantined the account; only an admin can clear it.'
  });
  for (const [code, text2] of codes) {
    if (new RegExp(`(abort|code|MoveAbort)[^0-9]{0,12}${code}\\b`, 'i').test(text) || new RegExp(`\\b${code}\\b\\s*\\)`).test(text)) return text2;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  plan + run                                                                 */
/* -------------------------------------------------------------------------- */
async function main() {
  if (flag('--help') || flag('-h')) {
    say(`
  Walrus Memory — create the on-chain account and register the delegate key

    node scripts/memwal-create-account.mjs                  dry run (default)
    node scripts/memwal-create-account.mjs --yes             execute the two transactions
    node scripts/memwal-create-account.mjs --account-id 0x…  skip creation, register the key only

  flags
    --yes                 actually sign and submit (default is a dry run)
    --account-id <0x…>    existing MemWalAccount (skips create_account)
    --label "<text>"      delegate key label (default: "FBT Intent OS")
    --network <net>       override the network reported by the relayer
    --key-file <path>     file containing the owner suiprivkey1… (else SUI_PRIVATE_KEY / hidden prompt)
    --rpc-url <url>       Sui JSON-RPC endpoint override
    --grpc-url <url>      Sui gRPC endpoint override
    --env-file <path>     read the delegate key from / write the account id to this file
    --json                machine-readable output

  the owner key is never written to disk by this script and is never printed.
`);
    return CODES.EXIT_OK;
  }

  const env = loadEnvFile();
  const serverUrl = String(opt('--relayer') || process.env.MEMWAL_SERVER_URL || env.MEMWAL_SERVER_URL || RELAYER_DEFAULT).replace(/\/+$/, '');
  const report = { schema: 'fbt.memwal-account-tool.v1', mode: flag('--yes') ? 'execute' : 'dry-run', at: new Date().toISOString(), relayer: serverUrl, steps: [] };
  const fail = (reason, code, extra = {}) => {
    Object.assign(report, { ok: false, reason, ...extra });
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    else console.log(`\n  ${reason}${extra.detail ? `\n  ${extra.detail}` : ''}\n`);
    return code;
  };

  /* 1 — the delegate key (from `npm run memwal:keygen`) */
  const delegateHex = delegatePublicKeyHex(env);
  if (!delegateHex) {
    return fail('No delegate key found.', CODES.EXIT_NOT_READY, {
      detail: 'Run first:  npm run memwal:keygen\n  It writes MEMWAL_PRIVATE_KEY to .env.local (git-ignored) and prints the public key.'
    });
  }
  report.delegate = { publicKeyHex: delegateHex };
  say(`  delegate public key : ${delegateHex}`);

  /* 2 — the owner key: never stored, never printed */
  const owner = ownerKey(env);
  if (owner.error) return fail(owner.error, CODES.EXIT_NOT_READY);
  let ownerKeyValue = owner.key;
  if (!ownerKeyValue) {
    ownerKeyValue = await askHidden('  owner Sui private key (suiprivkey1…, input hidden): ');
    if (!ownerKeyValue) {
      return fail('No owner key provided.', CODES.EXIT_NOT_READY, {
        detail: 'Set SUI_PRIVATE_KEY (a Sui wallet key with a little SUI for two transactions), pass --key-file <path>, or run this in a terminal so it can prompt.'
      });
    }
  }
  if (!/^suiprivkey1[0-9a-z]+$/i.test(ownerKeyValue)) {
    return fail('The owner key is not in the expected bech32 format.', CODES.EXIT_NOT_READY, {
      detail: 'Sui private keys look like `suiprivkey1…`. A raw hex key is not accepted here on purpose.'
    });
  }
  report.ownerKeySource = owner.source || 'prompt';
  say(`  owner key           : loaded (${report.ownerKeySource}) — not stored, not printed`);

  /* 3 — the relayer's /config is the source of truth for the package id */
  const cfgRes = await relayerConfig(serverUrl);
  if (!cfgRes.ok) {
    return fail(`Cannot read the relayer's /config (${cfgRes.reason}).`, CODES.EXIT_RELAYER, {
      detail: 'The package id must come from the live deployment; a documented id can be retired and accounts created under it are rejected by the production relayer.'
    });
  }
  const cfg = cfgRes.json || {};
  const network = String(opt('--network') || cfg.network || 'mainnet');
  const packageId = String(cfg.packageId || '').trim();
  if (!/^0x[0-9a-fA-F]+$/.test(packageId)) return fail('The relayer did not report a usable packageId.', CODES.EXIT_RELAYER);
  const envPackage = String(process.env.MEMWAL_PACKAGE_ID || env.MEMWAL_PACKAGE_ID || '').trim();
  if (envPackage && envPackage.toLowerCase() !== packageId.toLowerCase()) {
    return fail('MEMWAL_PACKAGE_ID disagrees with the relayer.', CODES.EXIT_NOT_READY, {
      detail: `  env    : ${envPackage}\n  relayer: ${packageId}\n  An account created under a package the relayer does not serve is invisible to it (HTTP 401 AUTH_REJECTED). Unset the env value or point MEMWAL_SERVER_URL at the deployment that serves it.`
    });
  }
  const registryId = String(process.env.MEMWAL_REGISTRY_ID || env.MEMWAL_REGISTRY_ID || cfg.registryId || '').trim();
  if (!/^0x[0-9a-fA-F]+$/.test(registryId)) {
    return fail('MEMWAL_REGISTRY_ID is missing.', CODES.EXIT_NOT_READY, {
      detail: 'Copy it from the Walrus Memory dashboard (or set it in .env.local). The relayer does not always publish the registry id in /config.'
    });
  }
  report.relayer = { serverUrl, network, packageId, registryId, transport: cfg.suiTransport || null };
  say(`  relayer             : ${serverUrl} (${network})`);
  say(`  package id          : ${packageId}  (from /config, not from docs)`);
  say(`  registry id         : ${registryId}`);

  /* 4 — the SDK, then the client the current @mysten/sui no longer provides by default */
  const sdk = await loadSdk();
  if (!sdk.ok) {
    return fail('The Walrus Memory SDK is not installed in this project.', CODES.EXIT_SDK_MISSING, {
      detail: `  npm i -D @mysten-incubation/memwal @mysten/sui\n  (${sdk.error})`
    });
  }
  const clientRes = await buildSuiClient({
    network,
    transport: cfg.suiTransport || null,
    grpcUrl: String(opt('--grpc-url') || cfg.suiGrpcUrl || '').trim() || null,
    rpcUrl: String(opt('--rpc-url') || cfg.suiRpcUrl || '').trim() || null
  });
  if (!clientRes.ok) {
    return fail('Could not build a Sui client for this SDK version.', CODES.EXIT_SDK_MISSING, {
      detail: `  tried:\n    ${(clientRes.tries || []).join('\n    ')}\n  Pass --grpc-url or --rpc-url explicitly.`
    });
  }
  report.suiClient = { kind: clientRes.kind, url: clientRes.url };
  say(`  sui client          : ${clientRes.kind} (${clientRes.url})`);

  const existingAccountId = String(opt('--account-id') || '').trim();
  const label = String(opt('--label') || 'FBT Intent OS').slice(0, 64);
  const txOpts = { packageId, registryId, suiPrivateKey: ownerKeyValue, suiNetwork: network, suiClient: clientRes.client };

  const plan = {
    network,
    packageId,
    registryId,
    delegatePublicKey: delegateHex,
    delegateLabel: label,
    createsAccount: !existingAccountId,
    accountId: existingAccountId || null,
    willRegisterDelegateKey: true
  };
  report.plan = plan;

  if (report.mode === 'dry-run') {
    Object.assign(report, { ok: true, ready: true, reason: 'DRY_RUN_READY' });
    if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return CODES.EXIT_OK; }
    say('');
    say('  ── PLAN (dry run — nothing was signed or sent) ───────────────────');
    if (plan.createsAccount) say(`  tx 1 : create_account(registry)                 → new MemWalAccount owned by your address`);
    else say(`  tx 1 : (skipped — using account ${plan.accountId})`);
    say(`  tx 2 : add_delegate_key(account, public_key, "${label}")`);
    say('');
    say('  Every prerequisite resolved. Re-run with --yes to execute.');
    say('');
    return CODES.EXIT_OK;
  }

  /* 5 — execute */
  let accountId = existingAccountId;
  try {
    if (!accountId) {
      say('');
      say('  → create_account …');
      const created = await sdk.account.createAccount(txOpts);
      accountId = created?.accountId;
      report.createAccount = { accountId, owner: created?.owner || null, digest: created?.digest || null };
      say(`    done. account ${accountId}${created?.digest ? ` (tx ${created.digest})` : ''}`);
    } else {
      say(`  → using existing account ${accountId}`);
    }
    say('  → add_delegate_key …');
    const added = await sdk.account.addDelegateKey({ ...txOpts, accountId, publicKey: delegateHex, label });
    report.addDelegateKey = { digest: added?.digest || null, publicKey: added?.publicKey || delegateHex, suiAddress: added?.suiAddress || null };
    say(`    done. delegate key registered${added?.suiAddress ? ` (sui address ${added.suiAddress})` : ''}`);
  } catch (err) {
    const message = String(err?.message || err);
    const explained = explainAbort(message);
    Object.assign(report, { ok: false, reason: explained ? 'CONTRACT_REJECTED' : 'TRANSACTION_FAILED', error: message.slice(0, 400), ...(explained ? { explanation: explained } : {}) });
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`\n  Transaction failed: ${message.slice(0, 300)}`);
      if (explained) console.log(`  ${explained}`);
      console.log('');
    }
    return CODES.EXIT_TX_FAILED;
  }

  upsertEnvFile({ MEMWAL_ACCOUNT_ID: accountId, MEMWAL_REGISTRY_ID: registryId });
  Object.assign(report, { ok: true, accountId, wroteEnv: ['MEMWAL_ACCOUNT_ID', 'MEMWAL_REGISTRY_ID'] });
  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return CODES.EXIT_OK; }

  say('');
  say('  ────────────────────────────────────────────────────────────────');
  say(`  account id written to .env.local: ${accountId}`);
  say('');
  say('  NEXT — put the two credentials into the deployment:');
  say('    vercel env add MEMWAL_ACCOUNT_ID  production   # the id above (public)');
  say('    vercel env add MEMWAL_PRIVATE_KEY production   # from .env.local (secret)');
  say('  redeploy, then:');
  say('    npm run memwal:preflight');
  say('');
  return CODES.EXIT_OK;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (JSON_OUT) console.log(JSON.stringify({ schema: 'fbt.memwal-account-tool.v1', ok: false, reason: 'UNEXPECTED', error: String(err?.message || err) }, null, 2));
    else console.log(`\n  Unexpected failure: ${String(err?.message || err)}\n`);
    process.exit(CODES.EXIT_UNEXPECTED);
  });
