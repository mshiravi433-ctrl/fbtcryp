#!/usr/bin/env node
/**
 * FBT AI Collective — activation evidence writer.
 *
 * WHAT THIS IS
 * The keyless GitHub Actions job compiles the Collective, runs the contract
 * probe, the API tests and the full local Ganache rehearsal. This script turns
 * that run into two files that are safe to publish:
 *
 *   server/collective/activation.snapshot.js   read by the API at build time
 *   public/collective/activation.json          static, fetchable, auditable
 *
 * Both contain ONLY public facts:
 *   · the commit and run that produced them,
 *   · the deployed-bytecode hash and size of every compiled contract,
 *   · which checks passed,
 *   · a verified live-deployment record (addresses + block) if one exists.
 *
 * WHAT THIS IS NOT
 * It is not a key store. Before writing, the output is scanned for private
 * keys, 32-byte hex secrets and credential-bearing URLs; if anything matches,
 * the script fails instead of publishing. It never reads
 * COLLECTIVE_DEPLOYER_PRIVATE_KEY.
 *
 * Usage:
 *   node scripts/collective-evidence.mjs --write
 *   node scripts/collective-evidence.mjs --check
 *   node scripts/collective-evidence.mjs --write --source local --rehearsal test/.out/collective-deployment.local.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const ARTIFACT_DIR = path.join(root, 'test', '.out', 'collective');
const SNAPSHOT_FILE = path.resolve(root, valueOf('--snapshot', 'server/collective/activation.snapshot.js'));
const PUBLIC_FILE = path.resolve(root, valueOf('--public', 'public/collective/activation.json'));
const REHEARSAL_FILE = path.resolve(root, valueOf('--rehearsal', 'test/.out/collective-deployment.local.json'));
const DEPLOYMENT_FILE = path.resolve(root, valueOf('--deployment', 'deployments/collective-4663.json'));
const EIP170_LIMIT = 24_576;
const REPO = process.env.GITHUB_REPOSITORY || 'mshiravi433-ctrl/fbtcryp';

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const git = (command, fallback = null) => {
  try {
    return execFileSync('git', command, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

const iso = (seconds) => (Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).toISOString() : null);

function readArtifacts() {
  if (!fs.existsSync(ARTIFACT_DIR)) return [];
  return fs.readdirSync(ARTIFACT_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const artifact = readJson(path.join(ARTIFACT_DIR, name));
      if (!artifact?.deployedBytecode) return null;
      const hex = String(artifact.deployedBytecode).replace(/^0x/, '');
      return {
        contract: String(artifact.contractName || name.replace(/\.json$/, '')),
        compiler: String(artifact.compiler || ''),
        bytes: Math.floor(hex.length / 2),
        limitBytes: EIP170_LIMIT,
        sha256: createHash('sha256').update(String(artifact.deployedBytecode)).digest('hex')
      };
    })
    .filter(Boolean);
}

function rehearsalCheck() {
  const record = readJson(REHEARSAL_FILE);
  if (!record) {
    return { id: 'rehearsal', label: 'Full local rehearsal', ok: null, detail: 'no rehearsal record in this run' };
  }
  const transactions = Array.isArray(record.transactions) ? record.transactions.length : 0;
  const hasVault = Boolean(record.vault?.address);
  const hasTimelock = Number.isFinite(Number(record.timelockReadyAt));
  return {
    id: 'rehearsal',
    label: 'Full local rehearsal (deploy → timelock → activate → deposit)',
    ok: hasVault && hasTimelock && transactions > 0,
    detail: `${transactions} transactions · vault ${hasVault ? 'created' : 'missing'} · gas ${String(record.gas?.totalGasUsed ?? '0')} units`
  };
}

const PUBLIC_RPC_FALLBACK = 'https://rpc.mainnet.chain.robinhood.com';

/**
 * The read RPC is published (the API needs it) but a provider key must never
 * be: anything with user-info or a non-HTTPS scheme is replaced by the public
 * endpoint instead of being written to a committed file.
 */
function publicRpcUrl() {
  const raw = String(process.env.COLLECTIVE_PUBLIC_RPC_URL || '').trim();
  if (!raw) return PUBLIC_RPC_FALLBACK;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return PUBLIC_RPC_FALLBACK;
    return url.toString().replace(/\/$/, '');
  } catch {
    return PUBLIC_RPC_FALLBACK;
  }
}

function liveDeployment() {
  const record = readJson(DEPLOYMENT_FILE);
  if (!record) return null;
  const active = Boolean(record.vault?.address);
  const verified = process.env.COLLECTIVE_VERIFIED === 'true' || process.env.COLLECTIVE_VERIFIED === '1';
  return {
    status: active ? 'activated' : 'queued',
    chainId: Number(record.chainId) || 4663,
    factoryAddress: record.contracts?.factory ?? null,
    assetAddress: record.asset?.address ?? null,
    deploymentBlock: Number(record.factoryDeploymentBlock) || null,
    rpcUrl: publicRpcUrl(),
    timelockReadyAt: iso(record.timelockReadyAt),
    vaultAddress: record.vault?.address ?? null,
    verified: active && verified,
    verifiedAt: active && verified ? new Date().toISOString() : null
  };
}

function buildSnapshot() {
  const artifacts = readArtifacts();
  const largest = artifacts.reduce((max, row) => Math.max(max, row.bytes), 0);
  const compileOk = artifacts.length > 0 && artifacts.every((row) => row.bytes <= EIP170_LIMIT);
  const runId = Number(process.env.GITHUB_RUN_ID || 0) || null;
  const startedSeconds = Number(process.env.COLLECTIVE_STARTED_AT || 0) || null;
  const nowIso = new Date().toISOString();
  const createdAt = iso(startedSeconds) || nowIso;
  const durationSeconds = startedSeconds
    ? Math.max(0, Math.round((Date.parse(nowIso) - startedSeconds * 1000) / 1000))
    : null;
  const commit = String(process.env.GITHUB_SHA || git(['rev-parse', 'HEAD'], '') || '') || null;
  const source = String(process.env.COLLECTIVE_EVIDENCE_SOURCE || valueOf('--source', '') || (runId ? 'github-actions' : 'local'));
  const rehearsal = rehearsalCheck();
  const live = liveDeployment();

  return {
    schema: 'fbt.collective.activation.snapshot.v1',
    generatedAt: nowIso,
    source,
    repo: REPO,
    commit,
    workflow: 'collective-activation.yml',
    run: {
      id: runId,
      number: Number(process.env.GITHUB_RUN_NUMBER || 0) || null,
      url: runId ? `https://github.com/${REPO}/actions/runs/${runId}` : null,
      event: String(process.env.GITHUB_EVENT_NAME || source),
      conclusion: String(process.env.COLLECTIVE_RUN_CONCLUSION || 'success'),
      headSha: commit,
      createdAt,
      updatedAt: nowIso,
      durationSeconds
    },
    checks: [
      {
        id: 'compile',
        label: `Compile ${artifacts.length} contracts (solc)`,
        ok: compileOk,
        detail: compileOk
          ? `largest deployed bytecode ${largest} / ${EIP170_LIMIT} bytes (EIP-170)`
          : artifacts.length ? 'at least one contract exceeds EIP-170' : 'no artifacts were compiled'
      },
      {
        id: 'contract',
        label: 'Contract probe on Ganache (no funds)',
        ok: has('--contract-ok') ? true : null,
        detail: has('--contract-ok') ? 'local chain only, no real funds' : 'not part of this invocation'
      },
      {
        id: 'api',
        label: 'API + activation tests',
        ok: has('--api-ok') ? true : null,
        detail: has('--api-ok') ? 'node --test' : 'not part of this invocation'
      },
      rehearsal
    ],
    artifacts,
    liveDeployment: live
  };
}

const SECRET_PATTERNS = [
  { re: /PRIVATE_KEY\s*[:=]\s*["']?0x[0-9a-fA-F]{64}/, why: 'private key assignment' },
  { re: /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/, why: '32-byte hex secret' },
  { re: /https?:\/\/[^\s"'@]+:[^\s"'@]+@/, why: 'credentials in a URL' }
];

function assertNoSecrets(text) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) throw new Error(`refusing to publish: ${pattern.why} detected`);
  }
}

function renderSnapshotJs(snapshot) {
  return `/**
 * Public activation snapshot for the FBT AI Collective.
 *
 * GENERATED by scripts/collective-evidence.mjs — do not hand-edit.
 * Written by .github/workflows/collective-activation.yml. Contains no secret:
 * no private key, no RPC credential, no keeper secret, no user data.
 *
 * run ${snapshot.run?.id ?? '—'} · commit ${snapshot.commit?.slice(0, 7) ?? '—'} · ${snapshot.generatedAt}
 */
export const ACTIVATION_SNAPSHOT = Object.freeze(${JSON.stringify(snapshot, null, 2)});

export default ACTIVATION_SNAPSHOT;
`;
}

const snapshot = buildSnapshot();
const snapshotText = renderSnapshotJs(snapshot);
const publicText = `${JSON.stringify(snapshot, null, 2)}\n`;
assertNoSecrets(snapshotText);
assertNoSecrets(publicText);

if (has('--check')) {
  const currentSnapshot = fs.existsSync(SNAPSHOT_FILE) ? fs.readFileSync(SNAPSHOT_FILE, 'utf8') : '';
  const currentPublic = fs.existsSync(PUBLIC_FILE) ? fs.readFileSync(PUBLIC_FILE, 'utf8') : '';
  assertNoSecrets(currentSnapshot);
  assertNoSecrets(currentPublic);
  const problems = [];
  if (!currentSnapshot.includes('ACTIVATION_SNAPSHOT')) problems.push('snapshot module is missing or malformed');
  if (!currentPublic.trim().startsWith('{')) problems.push('public activation JSON is missing or malformed');
  const parsed = readJson(PUBLIC_FILE);
  if (!parsed) problems.push('public activation JSON does not parse');
  else if (parsed.schema !== 'fbt.collective.activation.snapshot.v1') problems.push('unexpected public schema');
  if (problems.length) {
    console.error(problems.map((line) => `✗ ${line}`).join('\n'));
    process.exit(1);
  }
  console.log('✓ activation evidence is present, parses, and contains no secret material');
  process.exit(0);
}

fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
fs.mkdirSync(path.dirname(PUBLIC_FILE), { recursive: true });
fs.writeFileSync(SNAPSHOT_FILE, snapshotText);
fs.writeFileSync(PUBLIC_FILE, publicText);
console.log(`✓ wrote ${path.relative(root, SNAPSHOT_FILE)}`);
console.log(`✓ wrote ${path.relative(root, PUBLIC_FILE)}`);
console.log(`  ${snapshot.checks.map((row) => `${row.ok === true ? '✓' : row.ok === false ? '✗' : '·'} ${row.label}`).join('\n  ')}`);
if (snapshot.liveDeployment) {
  console.log(`  live deployment: ${snapshot.liveDeployment.status}${snapshot.liveDeployment.verified ? ' (verified on-chain)' : ''}`);
}
