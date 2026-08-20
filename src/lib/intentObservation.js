/**
 * PRIVACY-SAFE INTENT EXECUTION OBSERVATION — fbt.intent-execution-observation.v1
 * ---------------------------------------------------------------------------
 * What actually happened to an intent, recorded in a shape that could never
 * identify the wallet it happened to. This is the DATA COLLECTION half of a
 * future self-tuning execution layer — there is no model here, and this phase
 * makes no ML claim whatsoever.
 *
 * ─── WHAT IS DELIBERATELY IMPOSSIBLE TO SEND ────────────────────────────────
 * wallet address · tx hash · calldata · token contract address · IP · seed ·
 * key · signature · exact balance · recipient · user id · WalletConnect topic
 * or session · the user's free-text note.
 *
 * The payload is a fixed set of enums, small integers and buckets. There is no
 * free-string field at all except a regex-bounded policy version, so there is
 * nowhere for a caller to smuggle an identifier even by accident. Both this
 * module and server/intentObservation.js reject unknown fields.
 *
 * ─── OPT-IN ─────────────────────────────────────────────────────────────────
 * Nothing is sent unless the existing telemetry consent is on and its
 * device-local token is present. A failed submission is swallowed: telemetry
 * is never allowed to affect an execution.
 */

export const INTENT_OBSERVATION_SCHEMA = 'fbt.intent-execution-observation.v1';
export const OBSERVATION_ENDPOINT = '/api/intents/v1/observations';

export const OBSERVATION_KINDS = Object.freeze(['swap', 'outcome', 'automation', 'workflow']);
export const OBSERVATION_CHAINS = Object.freeze([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
export const OBSERVATION_SOLVERS = Object.freeze([
  'kyberswap',
  'openocean',
  'velora',
  'direct-router',
  'unknown'
]);
export const OBSERVATION_POLICIES = Object.freeze([
  'MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1',
  'MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2'
]);
export const OBSERVATION_SIMULATION_STATUSES = Object.freeze([
  'passed',
  'approval-required',
  'insufficient-balance',
  'reverted',
  'rpc-unavailable',
  'quote-expired',
  'chain-mismatch',
  'account-mismatch',
  'not-run'
]);
export const OBSERVATION_OUTCOMES = Object.freeze(['completed', 'failed', 'cancelled']);
export const GAS_BUCKETS = Object.freeze(['lt100k', '100k-250k', '250k-500k', '500k-1m', 'gt1m', 'unknown']);
export const BPS_BUCKETS = Object.freeze(['lte10', '10-50', '50-200', '200-1000', 'gt1000', 'unknown']);
export const LATENCY_BUCKETS = Object.freeze(['lt5s', '5-15s', '15-60s', '60-300s', 'gt300s', 'unknown']);
export const OBSERVATION_FAILURE_CODES = Object.freeze([
  'NONE',
  'QUOTE_EXPIRED',
  'ROUTE_CHANGED',
  'RPC_UNAVAILABLE',
  'RPC_DISAGREEMENT',
  'APPROVAL_REQUIRED',
  'APPROVAL_REJECTED',
  'ALLOWANCE_CHANGED',
  'INSUFFICIENT_BALANCE',
  'GAS_ESTIMATE_CHANGED',
  'CHAIN_CHANGED',
  'ACCOUNT_CHANGED',
  'SIMULATION_REVERTED',
  'TRANSACTION_REJECTED',
  'TRANSACTION_DROPPED',
  'TRANSACTION_REPLACED',
  'RECEIPT_FAILED',
  'CONFIRMATION_TIMEOUT',
  'MIN_OUTPUT_AT_RISK',
  'UNKNOWN_FAILURE'
]);

const POLICY_VERSION_RE = /^[A-Za-z0-9._-]{1,48}$/;
const DAY_MS = 24 * 3600 * 1000;

/** Exact field list. Anything else is rejected on both client and server. */
export const OBSERVATION_FIELDS = Object.freeze([
  'schema',
  'intentKind',
  'chainId',
  'routePolicy',
  'solver',
  'quoteCount',
  'hopCount',
  'simulationStatus',
  'gasEstimateBucket',
  'gasErrorBpsBucket',
  'outputErrorBpsBucket',
  'confirmationLatencyBucket',
  'failureCode',
  'outcome',
  'policyVersion',
  'dayBucket'
]);

export function gasBucket(gas) {
  const n = Number(gas);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  if (n < 100_000) return 'lt100k';
  if (n < 250_000) return '100k-250k';
  if (n < 500_000) return '250k-500k';
  if (n <= 1_000_000) return '500k-1m';
  return 'gt1m';
}

export function bpsBucket(bps) {
  const n = Math.abs(Number(bps));
  if (!Number.isFinite(n)) return 'unknown';
  if (n <= 10) return 'lte10';
  if (n <= 50) return '10-50';
  if (n <= 200) return '50-200';
  if (n <= 1000) return '200-1000';
  return 'gt1000';
}

export function latencyBucket(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 5_000) return 'lt5s';
  if (n < 15_000) return '5-15s';
  if (n < 60_000) return '15-60s';
  if (n <= 300_000) return '60-300s';
  return 'gt300s';
}

/** Error in basis points between a predicted and an actual quantity. */
export function errorBps(predicted, actual) {
  const p = Number(predicted);
  const a = Number(actual);
  if (!Number.isFinite(p) || !Number.isFinite(a) || p === 0) return null;
  return Math.round(((a - p) / p) * 10_000);
}

/** Day bucket, never an exact timestamp: whole days since the epoch, UTC. */
export const dayBucketOf = (now = Date.now()) => Math.floor(Number(now) / DAY_MS);

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * Build a bounded observation from raw execution facts.
 * Returns null when the input cannot produce a valid record — never a partial
 * or "best effort" payload.
 */
export function buildIntentObservation(input = {}, { now = Date.now() } = {}) {
  const chainId = Number(input.chainId);
  if (!OBSERVATION_CHAINS.includes(chainId)) return null;
  const intentKind = pick(input.intentKind, OBSERVATION_KINDS, null);
  if (!intentKind) return null;
  const outcome = pick(input.outcome, OBSERVATION_OUTCOMES, null);
  if (!outcome) return null;

  const policyVersion = POLICY_VERSION_RE.test(String(input.policyVersion ?? ''))
    ? String(input.policyVersion)
    : 'unversioned';

  const observation = {
    schema: INTENT_OBSERVATION_SCHEMA,
    intentKind,
    chainId,
    routePolicy: pick(input.routePolicy, OBSERVATION_POLICIES, OBSERVATION_POLICIES[1]),
    solver: pick(String(input.solver || '').toLowerCase(), OBSERVATION_SOLVERS, 'unknown'),
    quoteCount: Math.max(0, Math.min(8, Math.round(Number(input.quoteCount) || 0))),
    hopCount: Math.max(0, Math.min(8, Math.round(Number(input.hopCount) || 0))),
    simulationStatus: pick(input.simulationStatus, OBSERVATION_SIMULATION_STATUSES, 'not-run'),
    gasEstimateBucket: pick(input.gasEstimateBucket, GAS_BUCKETS, gasBucket(input.gasEstimate)),
    gasErrorBpsBucket: pick(
      input.gasErrorBpsBucket,
      BPS_BUCKETS,
      input.gasErrorBps == null ? 'unknown' : bpsBucket(input.gasErrorBps)
    ),
    outputErrorBpsBucket: pick(
      input.outputErrorBpsBucket,
      BPS_BUCKETS,
      input.outputErrorBps == null ? 'unknown' : bpsBucket(input.outputErrorBps)
    ),
    confirmationLatencyBucket: pick(
      input.confirmationLatencyBucket,
      LATENCY_BUCKETS,
      latencyBucket(input.confirmationLatencyMs)
    ),
    failureCode: pick(String(input.failureCode || 'NONE').toUpperCase(), OBSERVATION_FAILURE_CODES, 'UNKNOWN_FAILURE'),
    outcome,
    policyVersion,
    dayBucket: dayBucketOf(now)
  };

  return containsSensitiveValue(observation) ? null : observation;
}

/**
 * Belt and braces: refuse anything that LOOKS like an identifier even if a
 * future caller manages to get it past the enum checks.
 */
export function containsSensitiveValue(payload) {
  const seen = new Set();
  const walk = (value) => {
    if (value == null) return false;
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (typeof value === 'string') {
      if (/0x[0-9a-fA-F]{8,}/.test(value)) return true;       // address / hash / calldata
      if (/[A-Za-z0-9+/=]{40,}/.test(value)) return true;      // base64-ish blob
      if (/\s/.test(value)) return true;                       // every allowed value is a token, never a sentence
      if (value.length > 48) return true;                      // no free text at all
      return false;
    }
    if (typeof value !== 'object') return true;
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some(walk);
  };
  return walk(payload);
}

/** Strict local validation mirroring the server. */
export function validateObservationShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, code: 'BAD_BODY' };
  const keys = Object.keys(payload);
  if (keys.some((key) => !OBSERVATION_FIELDS.includes(key))) return { ok: false, code: 'UNKNOWN_FIELD' };
  if (payload.schema !== INTENT_OBSERVATION_SCHEMA) return { ok: false, code: 'BAD_SCHEMA' };
  if (containsSensitiveValue(payload)) return { ok: false, code: 'SENSITIVE_VALUE' };
  return { ok: true, code: 'VALID' };
}

/**
 * POST one observation. Pure in its dependencies so tests never touch fetch.
 * Returns a code; it never throws and never rejects.
 */
export async function submitIntentObservation(observation, {
  consentToken = '',
  fetchImpl = null,
  endpoint = OBSERVATION_ENDPOINT
} = {}) {
  const valid = validateObservationShape(observation);
  if (!valid.ok) return { ok: false, code: valid.code };
  if (!/^ct1:[0-9a-f]{32}$/.test(String(consentToken || ''))) return { ok: false, code: 'OPT_IN_REQUIRED' };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, code: 'NO_TRANSPORT' };
  try {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telemetry-consent': String(consentToken) },
      body: JSON.stringify(observation),
      keepalive: true
    });
    return { ok: res.ok === true, code: res.ok ? 'ACCEPTED' : `HTTP_${res.status}` };
  } catch {
    /* A telemetry failure must never surface to the execution path. */
    return { ok: false, code: 'TRANSPORT_FAILED' };
  }
}

/**
 * Fire-and-forget entry point used by the swap flow. Reads consent from the
 * settings store through a dynamic import so this module stays usable in a
 * plain Node probe with no React store present.
 */
export function reportIntentObservation(input) {
  try {
    const observation = buildIntentObservation(input);
    if (!observation) return;
    import('../store/useSettingsStore.js')
      .then(({ useSettingsStore }) => {
        const state = useSettingsStore.getState();
        if (!state?.contributeTelemetry || !state?.telemetryToken) return;
        submitIntentObservation(observation, { consentToken: state.telemetryToken }).catch(() => {});
      })
      .catch(() => {});
  } catch {
    /* never let observation touch the execution path */
  }
}
