#!/usr/bin/env node
/**
 * FBT AI Collective — public, chain-bound activation evidence writer.
 *
 * Writes only public facts to the API snapshot and static JSON. Deployment
 * entries are keyed by their own chainId, and a selected testnet run can only
 * update deployments/collective-46630.json plus the 46630 snapshot entry; it
 * cannot overwrite the 4663 record or be presented as mainnet.
 *
 * The output is scanned for private keys, 32-byte hex secrets and credentialed
 * URLs before either file is written. This script never reads a signing key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NETWORKS, networkByChainId, networkByName } from './lib/collectiveDeployment.mjs';

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
const REPO = process.env.GITHUB_REPOSITORY || 'mshiravi433-ctrl/fbtcryp';
const PREVIOUS_SNAPSHOT = readJson(PUBLIC_FILE);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function parseNetworkArg() {
  const raw = valueOf('--chain', process.env.COLLECTIVE_EVIDENCE_CHAIN_ID || process.env.COLLECTIVE_CHAIN_ID || null);
  if (raw == null || String(raw).trim() === '') return null;
  const byName = networkByName(raw);
  if (byName) return byName;
  const id = Number(raw);
  const byId = Number.isSafeInteger(id) ? networkByChainId(id) : null;
  if (!byId) throw new Error(`unsupported evidence chain ${raw}; allowed chain IDs: ${Object.values(NETWORKS).map((network) => network.chainId).join(', ')}`);
  return byId;
}

const selectedNetwork = parseNetworkArg();
const hasExplicitDeployment = has('--deployment');
const defaultNetwork = selectedNetwork ?? networkByName('robinhood');
const DEPLOYMENT_FILE = path.resolve(root, valueOf('--deployment', path.join('deployments', `collective-${defaultNetwork.chainId}.json`)));
const DEPLOYMENT = readJson(DEPLOYMENT_FILE);
const targetChainId = selectedNetwork?.chainId ?? (hasExplicitDeployment ? Number(DEPLOYMENT?.chainId) || null : null);
if (hasExplicitDeployment && targetChainId == null) {
  throw new Error('cannot infer a chain from the requested deployment record; provide --chain and the exact public record');
}
const targetNetwork = targetChainId == null ? null : networkByChainId(targetChainId);
if (targetChainId != null && !targetNetwork) {
  throw new Error(`unsupported deployment chainId ${targetChainId}; refusing to write chain-ambiguous evidence`);
}
if (selectedNetwork && DEPLOYMENT && Number(DEPLOYMENT.chainId) !== selectedNetwork.chainId) {
  throw new Error(`deployment record chainId ${DEPLOYMENT.chainId} does not match selected chain ${selectedNetwork.chainId}`);
}

const git = (command, fallback = null) => {
  try { return execFileSync('git', command, { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return fallback; }
};

const iso = (seconds) => (Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).toISOString() : null);
const trueValue = (value) => ['true', '1'].includes(String(value ?? '').trim().toLowerCase());

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
        limitBytes: 24_576,
        sha256: createHash('sha256').update(String(artifact.deployedBytecode)).digest('hex')
      };
    })
    .filter(Boolean);
}

function rehearsalCheck() {
  const record = readJson(REHEARSAL_FILE);
  if (!record) return { id: 'rehearsal', label: 'Full local rehearsal', ok: null, detail: 'no rehearsal record in this run' };
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

/** The witness uses only the published, chain-specific public RPC. */
function publicRpcUrl(network) {
  return network.rpcUrl;
}

function validateDeployment(record, network, file = DEPLOYMENT_FILE) {
  if (!record) throw new Error(`deployment record not found: ${path.relative(root, file)}`);
  if (Number(record.chainId) !== network.chainId) {
    throw new Error(`deployment record chainId ${record.chainId} does not match selected chain ${network.chainId}`);
  }
  if ((network.testnet && record.testnet !== true) ||
      (record.testnet != null && Boolean(record.testnet) !== network.testnet)) {
    throw new Error(`deployment record testnet flag does not match chain ${network.chainId}`);
  }
  return record;
}

function deploymentEvidence(record, network) {
  validateDeployment(record, network);
  const active = Boolean(record.vault?.address);
  const verified = active && record.verified === true && trueValue(process.env.COLLECTIVE_VERIFIED);
  return {
    status: active ? 'activated' : 'queued',
    chainId: network.chainId,
    testnet: network.testnet,
    factoryAddress: record.contracts?.factory ?? null,
    assetAddress: record.asset?.address ?? null,
    deploymentBlock: Number(record.factoryDeploymentBlock) || null,
    rpcUrl: publicRpcUrl(network),
    timelockReadyAt: iso(record.timelockReadyAt),
    vaultAddress: record.vault?.address ?? null,
    verified,
    verifiedAt: verified ? (record.verifiedAt || new Date().toISOString()) : null
  };
}

function previousDeployments() {
  const rows = {};
  const map = PREVIOUS_SNAPSHOT?.liveDeployments;
  if (Array.isArray(map)) {
    for (const row of map) {
      const id = Number(row?.chainId);
      if (networkByChainId(id) && Number(row.chainId) === id) rows[String(id)] = row;
    }
  } else if (map && typeof map === 'object') {
    for (const [key, row] of Object.entries(map)) {
      const id = Number(key);
      const network = networkByChainId(id);
      if (network && row && Number(row.chainId) === id && Boolean(row.testnet) === network.testnet) rows[String(id)] = row;
    }
  }
  const legacy = PREVIOUS_SNAPSHOT?.liveDeployment;
  if (legacy && typeof legacy === 'object') {
    const id = Number(legacy.chainId);
    const network = networkByChainId(id);
    if (network && Boolean(legacy.testnet) === network.testnet && !rows[String(id)]) rows[String(id)] = legacy;
  }
  return rows;
}

function verifiedChain(rows, id) {
  const network = networkByChainId(id);
  const row = rows[String(id)];
  return Boolean(network && row && Number(row.chainId) === network.chainId && row.status === 'activated' &&
    row.verified === true && Boolean(row.testnet) === network.testnet);
}

function chooseDefaultChain(rows) {
  if (targetNetwork && verifiedChain(rows, targetNetwork.chainId)) return targetNetwork.chainId;
  const previous = Number(PREVIOUS_SNAPSHOT?.defaultChainId);
  if (networkByChainId(previous) && verifiedChain(rows, previous)) return previous;
  if (verifiedChain(rows, 4663)) return 4663;
  const verified = Object.keys(rows).map(Number).filter((id) => verifiedChain(rows, id));
  if (verified.length === 1) return verified[0];
  return 4663;
}

function buildSnapshot() {
  const artifacts = readArtifacts();
  const largest = artifacts.reduce((max, row) => Math.max(max, row.bytes), 0);
  const compileOk = artifacts.length > 0 && artifacts.every((row) => row.bytes <= 24_576);
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
  const liveDeployments = previousDeployments();
  let current = null;

  if (targetNetwork) {
    const record = validateDeployment(DEPLOYMENT, targetNetwork);
    current = deploymentEvidence(record, targetNetwork);
    // Update only the exact chain's map entry. In particular, testnet evidence
    // can never write the mainnet record or inherit its addresses.
    liveDeployments[String(targetNetwork.chainId)] = current;
  }

  const defaultChainId = chooseDefaultChain(liveDeployments);
  const legacyLive = liveDeployments[String(defaultChainId)] ?? null;

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
        detail: compileOk ? `largest deployed bytecode ${largest} / 24576 bytes (EIP-170)` : artifacts.length ? 'at least one contract exceeds EIP-170' : 'no artifacts were compiled'
      },
      {
        id: 'contract',
        label: 'Contract probe on Ganache (no funds)',
        ok: has('--contract-ok') ? true : null,
        detail: has('--contract-ok') ? 'local chain only, no public funds' : 'not part of this invocation'
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
    defaultChainId,
    liveDeployments,
    liveDeployment: legacyLive
  };
}

const SECRET_PATTERNS = [
  { re: /PRIVATE_KEY\s*[:=]\s*["']?0x[0-9a-fA-F]{64}/, why: 'private key assignment' },
  { re: /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/, why: '32-byte hex secret' },
  { re: /https?:\/\/[^\s"'@]+:[^\s"'@]+@/, why: 'credentials in a URL' },
  { re: /https?:\/\/[^\s"'?#]+\?[^\s"']+/, why: 'query-bearing RPC URL' }
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
 * Contains public addresses and chain-bound verification facts only.
 * No private key, credentialed RPC, keeper secret or user data is published.
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
  const currentSnapshotText = fs.existsSync(SNAPSHOT_FILE) ? fs.readFileSync(SNAPSHOT_FILE, 'utf8') : '';
  const currentPublicText = fs.existsSync(PUBLIC_FILE) ? fs.readFileSync(PUBLIC_FILE, 'utf8') : '';
  assertNoSecrets(currentSnapshotText);
  assertNoSecrets(currentPublicText);
  const problems = [];
  if (!currentSnapshotText.includes('ACTIVATION_SNAPSHOT')) problems.push('snapshot module is missing or malformed');
  if (!currentPublicText.trim().startsWith('{')) problems.push('public activation JSON is missing or malformed');
  const parsed = readJson(PUBLIC_FILE);
  if (!parsed) problems.push('public activation JSON does not parse');
  else if (parsed.schema !== 'fbt.collective.activation.snapshot.v1') problems.push('unexpected public schema');

  if (targetNetwork) {
    const record = validateDeployment(DEPLOYMENT, targetNetwork);
    const witnessed = parsed?.liveDeployments?.[String(targetNetwork.chainId)] ??
      (Number(parsed?.liveDeployment?.chainId) === targetNetwork.chainId ? parsed.liveDeployment : null);
    if (!witnessed) problems.push(`activation evidence has no record for chain ${targetNetwork.chainId}`);
    else {
      if (Number(witnessed.chainId) !== targetNetwork.chainId) problems.push('witness chainId does not match the deployment record');
      if (Boolean(witnessed.testnet) !== targetNetwork.testnet) problems.push('witness testnet flag does not match the deployment record');
      if (Number(record.chainId) === 46630 && (record.testnet !== true || witnessed.testnet !== true)) problems.push('testnet record/evidence must both say testnet=true');
      if (record.verified === true && witnessed.verified !== true) problems.push('verified deployment record is not verified in the public witness');
      if (record.verified === true && Number(parsed.defaultChainId) !== targetNetwork.chainId) problems.push('verified chain is not the automatic public default');
    }
  }

  if (problems.length) {
    console.error(problems.map((line) => `✗ ${line}`).join('\n'));
    process.exit(1);
  }
  console.log('✓ activation evidence is present, parses, is chain-bound, and contains no secret material');
  process.exit(0);
}

if (targetNetwork && !DEPLOYMENT) {
  throw new Error(`cannot write chain ${targetNetwork.chainId} evidence without its deployment record`);
}
fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
fs.mkdirSync(path.dirname(PUBLIC_FILE), { recursive: true });
fs.writeFileSync(SNAPSHOT_FILE, snapshotText);
fs.writeFileSync(PUBLIC_FILE, publicText);
console.log(`✓ wrote ${path.relative(root, SNAPSHOT_FILE)}`);
console.log(`✓ wrote ${path.relative(root, PUBLIC_FILE)}`);
console.log(`  default chain: ${snapshot.defaultChainId} (${networkByChainId(snapshot.defaultChainId)?.name || 'unknown'})`);
console.log(`  ${snapshot.checks.map((row) => `${row.ok === true ? '✓' : row.ok === false ? '✗' : '·'} ${row.label}`).join('\n  ')}`);
if (targetNetwork) {
  console.log(`  chain ${targetNetwork.chainId}: ${snapshot.liveDeployments[String(targetNetwork.chainId)].status} · testnet=${targetNetwork.testnet} · verified=${snapshot.liveDeployments[String(targetNetwork.chainId)].verified}`);
}
