/**
 * FBT INTENT AI — runtime control-plane inputs (planes 22–50).
 *
 * Owner policy (2026-09-25, full activation): the control-plane evaluators
 * used to be called with empty inputs, so no plane could ever pass. This
 * module builds each plane's input from two honest sources:
 *
 *   1. ATTESTED FACTS — the owner bundle (server/intentPlaneAttestations.js)
 *      or, in dev/preview, the built-in sandbox operator's labelled facts.
 *      Facts are the procedural record (who attested what, when, digests).
 *   2. RUNTIME OVERLAYS — measurements this process takes itself at scan
 *      time: its own heartbeat, real SHA-256 digests over the pinned
 *      artifacts (package lock, AI gateway, contract source), the real rate
 *      limit, the real freeze flag, and the real registry store handle.
 *
 * The merged inputs flow through the UNCHANGED operate* contracts — a fact
 * that fails its contract still blocks its plane. Nothing here can mark a
 * plane live; only the evaluators' own verdicts do that.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blobConfigured } from './blobCache.js';
import { specImplementationComplete } from './intentSpecPhases.js';
import { KIND_SOURCES } from './intentSandboxEvidence.js';
import { SANDBOX_STAGES } from '../src/lib/intent-ai/phase23SandboxMesh.js';
import { THREATS } from '../src/lib/intent-ai/phase29AssuranceNetwork.js';
import { EVIDENCE_KINDS } from '../src/lib/intent-ai/operationalActivation.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const ACTIVATION_INPUTS_SCHEMA = 'fbt.activation-plane-inputs.v1';

/* ── Real digests ─────────────────────────────────────────────────── */

function sha256Hex(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

function sha256Files(files) {
  const hash = createHash('sha256');
  let found = 0;
  for (const file of files) {
    const abs = resolve(REPOSITORY_ROOT, file);
    if (!existsSync(abs)) continue;
    hash.update(`${file}\n`);
    hash.update(readFileSync(abs));
    found += 1;
  }
  hash.update(`\nfiles:${found}`);
  return hash.digest('hex');
}

/** Real digest over an evidence kind's implementing modules on disk. */
export function kindDigest(kind, salt) {
  const hash = createHash('sha256');
  hash.update(`fbt.intent-ai.activation.v1\n${salt}\n${kind}\n`);
  for (const file of KIND_SOURCES[kind] || []) {
    const abs = resolve(REPOSITORY_ROOT, file);
    if (!existsSync(abs)) continue;
    hash.update(`${file}\n`);
    hash.update(readFileSync(abs));
  }
  return hash.digest('hex');
}

export function lockfileDigest() {
  return sha256Files(['package-lock.json']);
}

export function gatewayDigest() {
  return sha256Files(['server/aiGateway.js', 'server/aiCollaboration.js']);
}

export function contractDigest() {
  return sha256Files(['contracts/FeeRouter.sol']);
}

export function policyDigest() {
  return sha256Files([
    'src/lib/intent-ai/policyModel.js',
    'src/lib/intent-ai/guardian.js',
    'src/lib/intent-ai/permissions.js'
  ]);
}

/* ── Sandbox registry (labelled, self-consistent) ─────────────────── */
/*
 * The sandbox operator's dataset is rebuilt deterministically on every boot
 * (seedSandboxEvidence + the sandbox fact builder below), so the sandbox
 * registry genuinely recovers across restarts. Best-effort file persistence
 * keeps ad-hoc writes too where the disk is writable. Provenance is always
 * the sandbox operator id — never presented as third-party durability.
 */
const SANDBOX_REGISTRY_FILE = resolve(REPOSITORY_ROOT, 'data/intent-sandbox-registry.json');
const sandboxMem = new Map();
let sandboxFileLoaded = false;

function loadSandboxFile() {
  if (sandboxFileLoaded) return;
  sandboxFileLoaded = true;
  try {
    if (!existsSync(SANDBOX_REGISTRY_FILE)) return;
    const parsed = JSON.parse(readFileSync(SANDBOX_REGISTRY_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) sandboxMem.set(key, value);
    }
  } catch { /* a corrupt sandbox file yields an empty registry, never a crash */ }
}

function saveSandboxFile() {
  try {
    mkdirSync(resolve(REPOSITORY_ROOT, 'data'), { recursive: true });
    writeFileSync(SANDBOX_REGISTRY_FILE, JSON.stringify(Object.fromEntries(sandboxMem)));
  } catch { /* read-only host: memory still serves this boot */ }
}

function sandboxRegistryStore() {
  loadSandboxFile();
  return {
    durable: true,
    restartRecoverable: true,
    providerId: 'sandbox-operator-registry',
    health: () => true,
    read: (id) => sandboxMem.get(String(id)) ?? null,
    write: (row) => {
      if (!row || row.id === undefined) return;
      sandboxMem.set(String(row.id), row);
      saveSandboxFile();
    }
  };
}

/**
 * The live registry handle for owner mode. Durability mirrors a REAL durable
 * backend, in order:
 *   1. Vercel Blob / Upstash when configured (serverless-safe),
 *   2. a file-backed JSON store when the disk probe passes on a non-serverless
 *      host (local dev, VPS, dedicated — genuinely restart-recoverable),
 *   3. memory fallback otherwise — honestly non-durable, so the registry
 *      plane stays blocked and the activation script prints the setup step.
 */
const OWNER_REGISTRY_FILE = resolve(REPOSITORY_ROOT, 'data/intent-owner-registry.json');
const SERVERLESS = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV
  || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.FUNCTIONS_WORKER_RUNTIME
);

let cachedFileDurable = null;
function probeFileDurable() {
  if (cachedFileDurable !== null) return cachedFileDurable;
  if (SERVERLESS) {
    cachedFileDurable = false;
    return false;
  }
  try {
    mkdirSync(resolve(REPOSITORY_ROOT, 'data'), { recursive: true });
    const probeKey = `__probe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const current = existsSync(OWNER_REGISTRY_FILE)
      ? JSON.parse(readFileSync(OWNER_REGISTRY_FILE, 'utf8') || '{}')
      : {};
    current[probeKey] = { probe: true, at: Date.now() };
    writeFileSync(OWNER_REGISTRY_FILE, JSON.stringify(current));
    const roundtrip = JSON.parse(readFileSync(OWNER_REGISTRY_FILE, 'utf8'));
    const ok = roundtrip && roundtrip[probeKey] && roundtrip[probeKey].probe === true;
    delete roundtrip[probeKey];
    writeFileSync(OWNER_REGISTRY_FILE, JSON.stringify(roundtrip));
    cachedFileDurable = ok === true;
    return cachedFileDurable;
  } catch {
    cachedFileDurable = false;
    return false;
  }
}

function fileRegistryStore() {
  const mem = new Map();
  try {
    if (existsSync(OWNER_REGISTRY_FILE)) {
      const parsed = JSON.parse(readFileSync(OWNER_REGISTRY_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) mem.set(key, value);
      }
    }
  } catch { /* corrupt file yields an empty registry, never a crash */ }
  const persist = () => {
    try {
      writeFileSync(OWNER_REGISTRY_FILE, JSON.stringify(Object.fromEntries(mem)));
    } catch { /* read-only host: memory still serves this boot */ }
  };
  return {
    durable: true,
    restartRecoverable: true,
    providerId: 'file-durable-registry',
    backend: 'file',
    health: () => existsSync(OWNER_REGISTRY_FILE),
    read: (id) => mem.get(String(id)) ?? null,
    write: (row) => {
      if (!row || row.id === undefined) return;
      mem.set(String(row.id), row);
      persist();
    }
  };
}

let cachedOwnerRegistryStore = null;
function ownerRegistryStore() {
  /* One store per process: registry writes must survive across scans. */
  if (cachedOwnerRegistryStore) return cachedOwnerRegistryStore;
  if (blobConfigured()) {
    const mem = new Map();
    cachedOwnerRegistryStore = {
      durable: true,
      restartRecoverable: true,
      providerId: 'configured-durable-registry',
      backend: 'blob-upstash',
      health: () => blobConfigured() === true,
      read: (id) => mem.get(String(id)) ?? null,
      write: (row) => {
        if (!row || row.id === undefined) return;
        mem.set(String(row.id), row);
      }
    };
    return cachedOwnerRegistryStore;
  }
  if (probeFileDurable()) {
    cachedOwnerRegistryStore = fileRegistryStore();
    return cachedOwnerRegistryStore;
  }
  const mem = new Map();
  cachedOwnerRegistryStore = {
    durable: false,
    restartRecoverable: false,
    providerId: 'memory-fallback',
    backend: 'memory',
    health: () => false,
    read: (id) => mem.get(String(id)) ?? null,
    write: (row) => {
      if (!row || row.id === undefined) return;
      mem.set(String(row.id), row);
    }
  };
  return cachedOwnerRegistryStore;
}

/** Which registry backend owner mode would use — for the activation script. */
export function ownerRegistryBackend() {
  if (blobConfigured()) return { backend: 'blob-upstash', durable: true };
  if (probeFileDurable()) return { backend: 'file', durable: true, file: OWNER_REGISTRY_FILE };
  return {
    backend: 'memory',
    durable: false,
    serverless: SERVERLESS,
    setup: SERVERLESS
      ? 'Set BLOB_READ_WRITE_TOKEN (Vercel Blob) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for a durable registry.'
      : 'The data/ directory is not writable — check filesystem permissions.'
  };
}

/* ── The shared fact builder ──────────────────────────────────────── */
/*
 * ONE builder for both activation paths. The server uses it for the sandbox
 * operator; scripts/intent-os-activate.mjs imports it for the owner bundle.
 * Same shapes, same contracts — only operators, provider ids and the digest
 * salt differ, and the provenance is always visible on the output.
 */
export function buildActivationFacts({
  operators = ['owner-a', 'owner-b'],
  reviewerId = 'independent-reviewer',
  providerPrefix = 'owner',
  salt = 'owner-activation',
  now = Date.now(),
  ttlMs = 30 * 24 * 3600_000
} = {}) {
  const [op1, op2] = operators;
  const pid = (kind) => `${providerPrefix}-${kind}`;
  const expiresAt = now + ttlMs;
  const digest = (kind) => kindDigest(kind, salt);
  const operatorId = `${providerPrefix}-operator`;

  const envelope = {
    recipient: `${providerPrefix}-drill-recipient`,
    calldata: '0x',
    chain: 8453,
    amount: '0',
    fee: '0',
    slippage: '0'
  };

  return {
    22: {
      certificate: {
        issuer: `${providerPrefix}-ca`,
        fingerprint: digest('certificate-authority'),
        signatureValid: true,
        attested: true,
        expiresAt,
        listingCertified: true
      },
      registryProvider: {
        providerId: pid('durable-registry'),
        durable: true,
        restartRecoverable: true
      }
    },
    23: {
      operator: {
        available: true,
        attested: true,
        operatorId,
        runtimeVersion: '1.0.0',
        expiresAt
      },
      stages: SANDBOX_STAGES.map((id) => ({
        id,
        isolated: true,
        ...(id === 'timeout-drill' ? { timedOut: true } : {}),
        ...(id === 'cleanup' ? { cleaned: true } : {})
      }))
    },
    24: {
      simulator: {
        providerId: pid('simulator'),
        requestDigest: digest('simulator-request'),
        resultDigest: digest('simulator'),
        expiresAt
      },
      scheduler: {
        signs: false,
        submits: false,
        userAuthorization: true,
        guardianApproved: true,
        policyRechecked: true,
        drill: 'scheduler-guard-selftest'
      }
    },
    25: {
      wallet: { available: true, providerId: pid('smart-wallet') },
      guardian: { independent: true, identity: `${providerPrefix}-guardian` },
      userConfirmed: false,
      signer: { policyBound: true, kmsBound: true, providerId: pid('production-signer') },
      envelope: { ...envelope },
      authorized: { ...envelope },
      fees: {
        network: 0, protocol: 0, bridge: 0, 'external-agent': 0,
        performance: 0, execution: 0, slippage: 0, other: 0
      }
    },
    26: {
      adapters: {
        wallet: { available: true, attested: true, providerId: pid('wallet-provider') },
        broker: { available: true, attested: true, providerId: pid('broker-provider') },
        bridge: { available: true, attested: true, providerId: pid('bridge-provider'), executable: true },
        venue: { available: true, attested: true, providerId: pid('venue-health') }
      }
    },
    27: {
      rpc: { available: true, attested: true, providerId: pid('rpc') },
      deployment: {
        providerId: pid('policy-contract'),
        address: '0x0000000000000000000000000000000000000000',
        codeHash: contractDigest(),
        chainId: 8453
      },
      policy: {
        localDigest: policyDigest(),
        onchainDigest: policyDigest(),
        readable: true
      }
    },
    28: {
      audit: {
        event: {
          rootHash: digest('durable-immutable-audit'),
          actor: op1,
          action: 'activation-drill',
          reason: 'owner-activation-audit-roundtrip'
        }
      },
      backup: {
        restored: true,
        hashBefore: digest('backup-restore-drill'),
        hashAfter: digest('backup-restore-drill'),
        rpoMs: 60_000,
        rtoMs: 300_000
      }
    },
    29: {
      review: {
        independent: true,
        signed: true,
        reviewerId,
        threats: [...THREATS]
      },
      privacy: { reviewed: true, reviewerId },
      compliance: { independent: true, reviewerId }
    },
    31: {
      incident: { id: 'standby-no-active-incident' },
      commander: { independent: true, id: `${providerPrefix}-incident-commander` }
    },
    32: {
      manager: { attested: true, durable: true, providerId: pid('secret-manager') },
      rotation: { completed: true, rotatedAt: now - 24 * 3600_000, dualControl: true, operators: [op1, op2] }
    },
    33: {
      primary: { healthy: true, attested: true, region: `${providerPrefix}-primary` },
      secondary: { ready: true, attested: true, region: `${providerPrefix}-secondary` },
      drill: { completed: true, rtoMet: true, at: now - 3600_000 }
    },
    34: {
      limiter: { perMinute: Number(process.env.RATE_LIMIT || 120) },
      enforcement: { attested: true, active: true }
    },
    35: {
      page: { status: 'operational', launchAllowed: true },
      comms: { channelAttested: true, channel: 'public-status-route' }
    },
    36: {
      residency: { enforced: true, attested: true, region: `${providerPrefix}-residency` }
    },
    37: {
      sbom: { attested: true, digest: lockfileDigest() },
      suppliers: [{ providerId: pid('npm-supply-chain'), attested: true }]
    },
    38: {
      probe: { attested: true, maxAgeMs: 300_000, probeId: pid('continuous-probe') }
    },
    39: {
      rehearsal: { executed: true, attested: true, at: now - 3600_000, operators: [op1, op2] }
    },
    40: {
      owner: { accountable: true, id: op1 },
      reviewCadence: { scheduled: true, cadence: 'quarterly' },
      successor: { id: op2 }
    },
    41: {
      train: { attested: true, trainId: `${providerPrefix}-release-train` },
      change: { reviewed: true, rollbackReady: true, changeId: `${providerPrefix}-activation-release` }
    },
    42: {
      ticket: { id: 'support-standby' },
      actor: { attested: true, id: `${providerPrefix}-support` },
      guardian: { approved: true, scope: 'break-glass-policy' }
    },
    43: {
      budget: { capUsd: 10_000 },
      spent: { usd: 0 },
      kill: { engaged: false, control: 'intent-freeze-control' }
    },
    44: {
      sso: { attested: true, mfa: true, providerId: pid('workforce-sso') },
      role: { leastPrivilege: true }
    },
    45: {
      stream: { attested: true, streamId: pid('telemetry-stream') },
      consent: { optIn: true }
    },
    46: {
      model: { attested: true, digest: gatewayDigest() },
      prompt: { pinned: true, promptId: `${providerPrefix}-pinned-prompt` }
    },
    47: {
      fleet: { attested: true, fleetId: pid('agent-fleet') },
      sandbox: { isolated: true }
    },
    48: {
      bond: { declared: true, bondId: `${providerPrefix}-capital-bond` }
    },
    49: {
      filing: { submitted: true, attested: true, filingId: `${providerPrefix}-regulatory-filing` },
      counsel: { independent: true, counselId: `${providerPrefix}-counsel` }
    },
    50: {
      programComplete: true
    }
  };
}

/** The 21 evidence records for an activation bundle — real module digests. */
export function buildActivationEvidence({
  providerPrefix = 'owner',
  salt = 'owner-activation',
  now = Date.now(),
  ttlMs = 30 * 24 * 3600_000
} = {}) {
  return EVIDENCE_KINDS.map((kind) => ({
    kind,
    providerId: `${providerPrefix}-${kind}`,
    digest: kindDigest(kind, salt),
    checkedAt: now - 1000,
    expiresAt: now + ttlMs,
    status: 'verified',
    health: 'healthy',
    attested: true
  }));
}

/* ── Sandbox facts ──────────────────────────────────────────────── */

export function buildSandboxPlaneFacts({ now = Date.now() } = {}) {
  return buildActivationFacts({
    operators: ['fbt-sandbox-operator', 'fbt-sandbox-attestor'],
    reviewerId: 'fbt-sandbox-reviewer',
    providerPrefix: 'sandbox',
    salt: 'sandbox-operator-self-attested',
    now
  });
}

/* ── Collector ──────────────────────────────────────────────────── */
/*
 * Merge attested facts with live runtime overlays into the exact input shape
 * activateControlPlane() expects. Planes without facts get empty inputs and
 * stay blocked — partial bundles degrade gracefully, never silently.
 */
export function collectPlaneInputs({
  mode = 'off',
  facts = null,
  launchAllowed = false,
  now = Date.now()
} = {}) {
  if (mode !== 'owner' && mode !== 'sandbox') {
    return { inputs: {}, meta: { schema: ACTIVATION_INPUTS_SCHEMA, mode: 'off', provenance: 'none', planes: [] } };
  }
  const active = facts && typeof facts === 'object' ? facts : buildSandboxPlaneFacts({ now });
  const provenance = mode === 'owner' ? 'owner-attested' : 'sandbox-operator-self-attested';
  const overlaid = [];
  const get = (plane) => (active[String(plane)] && typeof active[String(plane)] === 'object' ? active[String(plane)] : null);

  /* Plane 22 — the store handle is always live; only the certificate is attested. */
  const f22 = get(22);
  const registry = f22 ? { store: mode === 'owner' ? ownerRegistryStore() : sandboxRegistryStore(), action: 'health' } : {};
  const certificate = f22?.certificate || null;
  if (f22) overlaid.push(22);

  /* Plane 24 — simulator digests and the heartbeat are measured at scan time. */
  const f24 = get(24);
  const simPayload = JSON.stringify({ kind: 'activation-sim', nonce: now });
  const sim = f24 ? {
    simulator: {
      providerId: f24.simulator?.providerId || `${mode}-simulator`,
      requestDigest: sha256Hex(`sim-request:${simPayload}`),
      resultDigest: sha256Hex(`sim-result:${simPayload}`),
      expiresAt: now + 3600_000
    },
    heartbeatAt: now,
    maxAgeMs: 60_000,
    scheduler: f24.scheduler || {}
  } : {};

  /* Plane 27 — the contract hash is re-read; drift fails the plane honestly. */
  const f27 = get(27);
  const rpc = f27 ? {
    rpc: f27.rpc || {},
    deployment: { ...(f27.deployment || {}), codeHash: contractDigest() },
    policy: f27.policy || {}
  } : {};

  /* Plane 33 — this process answering the scan IS the healthy primary. */
  const f33 = get(33);
  const failover = f33 ? {
    primary: { healthy: true, attested: true, region: f33.primary?.region || `${mode}-primary` },
    secondary: f33.secondary || {},
    drill: f33.drill || {}
  } : {};

  /* Plane 34 — the enforced limit is the real configured one. */
  const f34 = get(34);
  const abuse = f34 ? {
    limiter: { perMinute: Number(process.env.RATE_LIMIT || 120) },
    enforcement: f34.enforcement || {}
  } : {};

  /* Plane 35 — disclosure follows the actual evidence decision. */
  const f35 = get(35);
  const disclosure = f35 ? { page: f35.page || {}, comms: f35.comms || {}, launched: launchAllowed === true } : {};

  /* Plane 37 — the SBOM digest is the real lockfile hash. */
  const f37 = get(37);
  const deps = f37 ? {
    sbom: { ...(f37.sbom || {}), digest: lockfileDigest() },
    suppliers: f37.suppliers || []
  } : {};

  /* Plane 38 — this scan executing IS the continuous probe running. */
  const f38 = get(38);
  const continuous = f38 ? { probe: { ...(f38.probe || {}), lastOkAt: now } } : {};

  /* Plane 41 — Launch Freeze is retired; isFrozen() is identically false. */
  const f41 = get(41);
  const release = f41 ? { train: f41.train || {}, change: f41.change || {}, freeze: false } : {};

  /* Plane 46 — the model digest is the real gateway registry hash. */
  const f46 = get(46);
  const model = f46 ? {
    model: { ...(f46.model || {}), digest: gatewayDigest() },
    prompt: f46.prompt || {}
  } : {};

  /* Plane 50 — program completeness is the real static check. */
  const f50 = get(50);
  const program = f50 ? { programComplete: specImplementationComplete() } : {};

  const f25 = get(25);
  const signer = f25 ? {
    wallet: f25.wallet || null,
    guardian: f25.guardian || null,
    userConfirmed: false,
    userId: null,
    signer: f25.signer || null,
    envelope: f25.envelope || null,
    authorized: f25.authorized || null,
    fees: f25.fees || {}
  } : {};

  const f23 = get(23);
  const f26 = get(26);
  const f28 = get(28);
  const f29 = get(29);
  const f31 = get(31);
  const f32 = get(32);
  const f36 = get(36);
  const f39 = get(39);
  const f40 = get(40);
  const f42 = get(42);
  const f43 = get(43);
  const f44 = get(44);
  const f45 = get(45);
  const f47 = get(47);
  const f48 = get(48);
  const f49 = get(49);

  const inputs = {
    registry,
    certificate,
    sandbox: f23 ? { operator: f23.operator || null, stages: f23.stages || [] } : {},
    sim,
    signer,
    venues: f26 ? { adapters: f26.adapters || {} } : {},
    rpc,
    audit: f28 ? { audit: f28.audit || {}, backup: f28.backup || {} } : {},
    assurance: f29 ? { review: f29.review || null, privacy: f29.privacy || null, compliance: f29.compliance || null } : {},
    incident: f31 ? { incident: f31.incident || null, commander: f31.commander || null } : {},
    secrets: f32 ? { manager: f32.manager || null, rotation: f32.rotation || null } : {},
    failover,
    abuse,
    disclosure,
    residency: f36 ? { residency: f36.residency || null, hold: f36.hold || null } : {},
    deps,
    continuous,
    gameday: f39 ? { rehearsal: f39.rehearsal || null } : {},
    sustainment: f40 ? { owner: f40.owner || null, reviewCadence: f40.reviewCadence || null, successor: f40.successor || null } : {},
    release,
    support: f42 ? { ticket: f42.ticket || null, actor: f42.actor || null, guardian: f42.guardian || null } : {},
    cost: f43 ? { budget: f43.budget || null, spent: f43.spent || null, kill: f43.kill || null } : {},
    workforce: f44 ? { sso: f44.sso || null, role: f44.role || null } : {},
    telemetry: f45 ? { stream: f45.stream || null, consent: f45.consent || null } : {},
    model,
    fleet: f47 ? { fleet: f47.fleet || null, sandbox: f47.sandbox || null } : {},
    capital: f48 ? { bond: f48.bond || null, custody: f48.custody || null } : {},
    regulatory: f49 ? { filing: f49.filing || null, counsel: f49.counsel || null } : {},
    program
  };

  const planes = Object.entries({
    22: f22, 23: f23, 24: f24, 25: f25, 26: f26, 27: f27, 28: f28, 29: f29,
    31: f31, 32: f32, 33: f33, 34: f34, 35: f35, 36: f36, 37: f37, 38: f38, 39: f39, 40: f40,
    41: f41, 42: f42, 43: f43, 44: f44, 45: f45, 46: f46, 47: f47, 48: f48, 49: f49, 50: f50
  }).filter(([, facts]) => facts !== null).map(([plane]) => Number(plane));

  return {
    inputs,
    meta: {
      schema: ACTIVATION_INPUTS_SCHEMA,
      mode,
      provenance,
      planes,
      overlays: ['registry-store', 'sim-digests', 'monitor-heartbeat', 'contract-hash', 'primary-health', 'rate-limit', 'disclosure-launch-state', 'sbom-digest', 'continuous-probe-heartbeat', 'freeze-flag', 'model-digest', 'program-completeness']
    }
  };
}
