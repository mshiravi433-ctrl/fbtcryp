/**
 * FBT AI Collective — public activation status.
 *
 * WHY THIS EXISTS
 * The Collective needs two different things before it can move real value:
 *
 *   1. a code path that is built, tested and rehearsed end-to-end, and
 *   2. a deployment on the live chain (which costs gas from the deploying
 *      wallet and therefore cannot be done without one).
 *
 * The repository keeps (1) completely keyless and gas-free in GitHub Actions;
 * (2) is a deliberate, explicit owner action. This module turns both into one
 * public, read-only payload so the `/collective` page never has to guess and
 * never shows a green light it did not observe.
 *
 * The GitHub Actions source is the PUBLIC API of a public repository: no token,
 * no secret and no key is involved in reading it. When the API is rate-limited
 * or unreachable, the committed snapshot written by the workflow is used
 * instead, and the payload says so (`source`).
 *
 * This module never reads a private key. It only knows whether one *could*
 * have been configured, by name, as a repository secret.
 */
import {
  COLLECTIVE_CHAINS,
  readCollectiveConfig,
  snapshotDeploymentForChain
} from './config.js';
import { ACTIVATION_SNAPSHOT } from './activation.snapshot.js';

export const COLLECTIVE_ACTIVATION_SCHEMA = 'fbt.collective.activation.v1';
export const COLLECTIVE_ACTIVATION_REPO = 'mshiravi433-ctrl/fbtcryp';
export const COLLECTIVE_ACTIVATION_WORKFLOW = 'collective-activation.yml';
export const COLLECTIVE_ACTIVATION_CACHE_MS = 5 * 60 * 1000;
export const COLLECTIVE_ACTIVATION_TIMEOUT_MS = 4_500;

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_RE = /^[A-Za-z0-9_.-]+\.ya?ml$/;

/** Run conclusion → the vocabulary the UI translates. */
const PIPELINE_STATE = Object.freeze({
  success: 'passed',
  failure: 'failed',
  timed_out: 'failed',
  cancelled: 'cancelled',
  action_required: 'blocked',
  neutral: 'unknown',
  skipped: 'skipped',
  stale: 'unknown'
});

/**
 * Stable step ids. The workflow's step names are the source of truth; matching
 * here keeps the public payload independent of exact wording, so renaming a
 * step does not break the dashboard (it degrades to `other`).
 */
const STEP_MATCHERS = Object.freeze([
  { id: 'compile', re: /compil/i },
  { id: 'contract', re: /contract probe|contract-probe/i },
  { id: 'api', re: /\bapi\b|activation test/i },
  { id: 'rehearsal', re: /rehearsal/i },
  { id: 'live', re: /live deploy|deploy on|activate on|phase deploy|phase activate|chain verification|read-only preflight/i },
  { id: 'evidence', re: /evidence|snapshot/i }
]);

const REQUIRED_SECRETS = Object.freeze(['COLLECTIVE_DEPLOYER_PRIVATE_KEY']);
const OPTIONAL_VARIABLES = Object.freeze([
  'COLLECTIVE_ASSET_ADDRESS',
  'COLLECTIVE_GUARDIAN_ADDRESS',
  'COLLECTIVE_DEPLOYER_ADDRESS',
  'COLLECTIVE_TESTNET_RPC_URL',
  'COLLECTIVE_POLICY_DELAY_SECONDS'
]);

const shortSha = (value) => {
  const text = String(value ?? '');
  return /^[0-9a-f]{7,40}$/i.test(text) ? text.slice(0, 7) : null;
};

const stepId = (name) => {
  const label = String(name ?? '');
  return STEP_MATCHERS.find((row) => row.re.test(label))?.id ?? 'other';
};

const stepState = (step) => {
  if (step?.status && step.status !== 'completed') {
    return step.status === 'in_progress' ? 'running' : 'queued';
  }
  return PIPELINE_STATE[String(step?.conclusion ?? '')] ?? 'unknown';
};

function publicSteps(jobs) {
  const rows = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || job.name === 'live' || /live deployment/i.test(String(job.name ?? ''))) continue;
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      rows.push({
        id: stepId(step?.name),
        name: String(step?.name ?? '').slice(0, 120),
        number: Number(step?.number) || rows.length + 1,
        status: stepState(step)
      });
    }
  }
  return rows;
}

function secondsBetween(start, end) {
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null;
}

function runToPipeline(run, { source, jobs = [], repo }) {
  if (!run) return null;
  const steps = publicSteps(jobs);
  return {
    provider: 'github-actions',
    source,
    evidenceSource: 'github-actions',
    repo,
    workflow: COLLECTIVE_ACTIVATION_WORKFLOW,
    runId: Number(run.id) || null,
    runNumber: Number(run.run_number) || null,
    url: typeof run.html_url === 'string' ? run.html_url : null,
    state: PIPELINE_STATE[String(run.conclusion ?? '')] ?? (run.status === 'in_progress' ? 'running' : run.status === 'queued' ? 'queued' : 'unknown'),
    event: String(run.event ?? ''),
    headSha: typeof run.head_sha === 'string' ? run.head_sha : null,
    headShaShort: shortSha(run.head_sha),
    createdAt: run.created_at ?? null,
    updatedAt: run.updated_at ?? null,
    durationSeconds: secondsBetween(run.created_at, run.updated_at),
    steps
  };
}

function snapshotRun(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const run = snapshot.run && typeof snapshot.run === 'object' ? snapshot.run : null;
  const checks = Array.isArray(snapshot.checks) ? snapshot.checks : [];
  if (!run) {
    return {
      provider: 'github-actions',
      source: 'uninitialized',
      evidenceSource: 'uninitialized',
      repo: COLLECTIVE_ACTIVATION_REPO,
      workflow: COLLECTIVE_ACTIVATION_WORKFLOW,
      runId: null,
      runNumber: null,
      url: null,
      state: 'never-run',
      event: '',
      headSha: null,
      headShaShort: null,
      createdAt: null,
      updatedAt: null,
      durationSeconds: null,
      steps: checks.map((check, index) => ({
        id: String(check?.id ?? 'other'),
        name: String(check?.label ?? check?.id ?? ''),
        number: index + 1,
        status: check?.ok === true ? 'passed' : check?.ok === false ? 'failed' : 'unknown'
      }))
    };
  }
  return {
    provider: 'github-actions',
    source: 'snapshot',
    evidenceSource: String(snapshot.source ?? 'unknown'),
    repo: String(snapshot.repo ?? COLLECTIVE_ACTIVATION_REPO),
    workflow: COLLECTIVE_ACTIVATION_WORKFLOW,
    runId: Number(run.id) || null,
    runNumber: Number(run.number) || null,
    url: typeof run.url === 'string' ? run.url : null,
    state: PIPELINE_STATE[String(run.conclusion ?? '')] ?? 'unknown',
    event: String(run.event ?? 'push'),
    headSha: typeof run.headSha === 'string' ? run.headSha : null,
    headShaShort: shortSha(run.headSha),
    createdAt: run.createdAt ?? snapshot.generatedAt ?? null,
    updatedAt: run.updatedAt ?? snapshot.generatedAt ?? null,
    durationSeconds: Number.isFinite(Number(run.durationSeconds)) ? Number(run.durationSeconds) : null,
    steps: checks.map((check, index) => ({
      id: String(check?.id ?? 'other'),
      name: String(check?.label ?? check?.id ?? ''),
      number: index + 1,
      status: check?.ok === true ? 'passed' : check?.ok === false ? 'failed' : 'unknown'
    }))
  };
}

function deploymentNextStep({ config, snapshot }) {
  const live = snapshotDeploymentForChain(snapshot, config.chainId);
  if (config.configured) return 'live';
  if (live && String(live.status) === 'queued') return 'run-activation';
  if (live && String(live.status) === 'activated' && live.verified !== true) return 'run-check';
  return 'run-deployment';
}

function requiredAction(nextStep, chain) {
  if (nextStep === 'live' || nextStep === 'none' || chain?.supported === false) return null;
  const prefix = chain?.testnet === true ? 'testnet-' : '';
  if (nextStep === 'run-check') {
    return `gh workflow run ${COLLECTIVE_ACTIVATION_WORKFLOW} -f phase=${prefix}check`;
  }
  if (nextStep === 'run-activation') {
    return `gh workflow run ${COLLECTIVE_ACTIVATION_WORKFLOW} -f phase=${prefix}activate -f acknowledge_gas=yes`;
  }
  return `gh workflow run ${COLLECTIVE_ACTIVATION_WORKFLOW} -f phase=${prefix}deploy -f acknowledge_gas=yes`;
}

/**
 * Build the public activation payload. Pure: no network, no clock surprises.
 */
export function buildCollectiveActivationPayload({
  config = readCollectiveConfig(),
  pipeline = null,
  snapshot = ACTIVATION_SNAPSHOT,
  repo = COLLECTIVE_ACTIVATION_REPO,
  now = () => new Date().toISOString()
} = {}) {
  const nextStep = deploymentNextStep({ config, snapshot });
  const chain = COLLECTIVE_CHAINS[config.chainId] ?? {
    id: config.chainId,
    name: config.chainName || 'Unsupported network',
    explorer: config.explorer || '',
    testnet: false,
    supported: false
  };
  const record = snapshotDeploymentForChain(snapshot, config.chainId);
  const liveDeployment = record
    ? {
      status: String(record.status ?? 'unknown'),
      chainId: Number(record.chainId),
      testnet: record.testnet === true,
      verified: record.verified === true,
      verifiedAt: record.verifiedAt ?? null,
      timelockReadyAt: record.timelockReadyAt ?? null,
      vaultAddress: record.vaultAddress ?? null
    }
    : null;

  return {
    schema: COLLECTIVE_ACTIVATION_SCHEMA,
    generatedAt: now(),
    chain: {
      id: chain.id,
      name: chain.name,
      explorer: chain.explorer,
      testnet: chain.testnet === true,
      supported: chain.supported !== false
    },
    policy: {
      // What is actually free: the whole build/verification pipeline.
      pipelineKeyless: true,
      pipelineGasFree: true,
      // What is not free: putting contracts on a live chain, ever.
      onChainDeploymentRequiresGas: true,
      deploymentGasPayer: 'operator-wallet',
      userGasPayer: 'user-wallet',
      gasSponsorshipEnabled: false,
      relayerEnabled: false,
      serverSigning: false,
      privateKeysStoredByApi: false
    },
    pipeline: pipeline ?? snapshotRun(snapshot),
    deployment: {
      status: config.status,
      configured: config.configured,
      issues: [...config.issues],
      nextStep,
      command: requiredAction(nextStep, chain),
      workflowUrl: `https://github.com/${repo}/actions/workflows/${COLLECTIVE_ACTIVATION_WORKFLOW}`,
      installUrl: `https://github.com/${repo}/new/main?filename=.github/workflows/${COLLECTIVE_ACTIVATION_WORKFLOW}`,
      sourceUrl: `https://github.com/${repo}/blob/main/ci/${COLLECTIVE_ACTIVATION_WORKFLOW}`,
      requiredSecrets: [...REQUIRED_SECRETS],
      requiredVariables: [],
      optionalVariables: [...OPTIONAL_VARIABLES],
      acknowledgeInput: 'acknowledge_gas=yes',
      liveDeployment,
      notes: [
        'The rehearsal job needs no secret, no key and no gas: it runs on an in-process Ganache chain.',
        'A real deployment signs with a wallet that only exists as a repository secret; the key is never printed, stored or committed.',
        'Anyone can read the public run log; nobody can read the secret.'
      ]
    }
  };
}

/**
 * Live GitHub Actions reader with a five-minute in-memory cache and a
 * committed-snapshot fallback. Failure is never fatal: the endpoint always
 * answers with the last state it can prove.
 */
export function createCollectiveActivationStatus({
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  repo = process.env.COLLECTIVE_GITHUB_REPO || COLLECTIVE_ACTIVATION_REPO,
  workflow = COLLECTIVE_ACTIVATION_WORKFLOW,
  snapshot = ACTIVATION_SNAPSHOT,
  now = () => Date.now(),
  cacheMs = COLLECTIVE_ACTIVATION_CACHE_MS,
  timeoutMs = COLLECTIVE_ACTIVATION_TIMEOUT_MS
} = {}) {
  const safeRepo = REPO_RE.test(String(repo)) ? String(repo) : COLLECTIVE_ACTIVATION_REPO;
  const safeWorkflow = WORKFLOW_RE.test(String(workflow)) ? String(workflow) : COLLECTIVE_ACTIVATION_WORKFLOW;
  let cached = null;
  let cachedAt = 0;

  async function readJson(url) {
    if (typeof fetchImpl !== 'function') throw new Error('NO_FETCH');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'fbt-collective-activation'
        },
        signal: controller.signal
      });
      if (!response || !response.ok) {
        const failure = new Error(`HTTP_${response?.status ?? 0}`);
        failure.status = Number(response?.status) || 0;
        throw failure;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function readPipeline() {
    const runs = await readJson(`https://api.github.com/repos/${safeRepo}/actions/workflows/${safeWorkflow}/runs?branch=main&per_page=1`);
    const run = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs[0] : null;
    if (!run?.id) return null;
    let jobs = [];
    try {
      const payload = await readJson(`https://api.github.com/repos/${safeRepo}/actions/runs/${Number(run.id)}/jobs?per_page=20`);
      jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    } catch {
      jobs = [];
    }
    return runToPipeline(run, { source: 'github-api', jobs, repo: safeRepo });
  }

  return {
    /** @param {{config?: object, refresh?: boolean}} options */
    async get({ config = readCollectiveConfig(), refresh = false } = {}) {
      const current = now();
      let pipeline = null;
      // null = unknown (snapshot only), true/false = observed from the API.
      let installed = null;
      if (!refresh && cached && current - cachedAt < cacheMs) {
        pipeline = cached;
        installed = true;
      } else {
        try {
          pipeline = await readPipeline();
          if (pipeline) {
            cached = pipeline;
            cachedAt = current;
          }
          installed = true;
        } catch (cause) {
          pipeline = null;
          if (Number(cause?.status) === 404) installed = false;
        }
      }
      const payload = buildCollectiveActivationPayload({
        config,
        pipeline: pipeline ?? snapshotRun(snapshot),
        snapshot,
        repo: safeRepo,
        now: () => new Date(current).toISOString()
      });
      payload.pipeline = { ...payload.pipeline, installed };
      return payload;
    }
  };
}

export const defaultCollectiveActivationStatus = createCollectiveActivationStatus();
