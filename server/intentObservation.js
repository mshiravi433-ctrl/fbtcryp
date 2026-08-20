/**
 * INTENT EXECUTION OBSERVATION — server half.
 * ---------------------------------------------------------------------------
 * Ingest for `fbt.intent-execution-observation.v1`: the bounded, aggregate-only
 * record of how an intent actually executed.
 *
 * ─── WHAT THIS ENDPOINT REFUSES ─────────────────────────────────────────────
 * Unknown fields · arbitrary strings · anything hex-shaped (address, tx hash,
 * calldata) · anything base64-shaped · any value the schema does not enumerate.
 * The validator is an ALLOWLIST, not a sanitiser: a payload that does not match
 * exactly is rejected, never trimmed into acceptance.
 *
 * ─── FAIL CLOSED ────────────────────────────────────────────────────────────
 * With no durable store configured the endpoint answers NOT_CONFIGURED instead
 * of accepting data it cannot keep. An in-memory ring buffer exists ONLY so a
 * single instance can report a count for diagnostics; it is never presented as
 * storage and never survives a cold start.
 *
 * ─── MODEL LIVES ELSEWHERE ──────────────────────────────────────────────────
 * This module only collects. Training is server/learning/execObservation.js,
 * which consumes the day-bucket dataset and publishes an empirical description
 * (`fbt.intent-execution-model.v1`). `modelTrained` is reported from that
 * serving snapshot — never assumed true here. It is not a classifier, not an
 * LLM, and it claims no MEV / atomicity / escrow / route optimisation.
 */

import { blobConfigured, blobGet, blobSet } from './blobCache.js';

export const OBSERVATION_SCHEMA = 'fbt.intent-execution-observation.v1';
export const OBSERVATION_STORE_KEY = 'intent-observations';

/** Same device-local consent token the learning telemetry uses. */
export const OBSERVATION_CONSENT_RE = /^ct1:[0-9a-f]{32}$/;

const KINDS = new Set(['swap', 'outcome', 'automation', 'workflow']);
const CHAINS = new Set([1, 10, 56, 137, 146, 8453, 42161, 43114, 59144]);
const POLICIES = new Set([
  'MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1',
  'MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2'
]);
const SOLVERS = new Set(['kyberswap', 'openocean', 'velora', 'direct-router', 'unknown']);
const SIMULATION_STATUSES = new Set([
  'passed',
  'approval-required',
  'insufficient-balance',
  'reverted',
  'rpc-unavailable',
  'rpc-disagreement',
  'quote-expired',
  'chain-mismatch',
  'account-mismatch',
  'not-run'
]);
const GAS_BUCKETS = new Set(['lt100k', '100k-250k', '250k-500k', '500k-1m', 'gt1m', 'unknown']);
const BPS_BUCKETS = new Set(['lte10', '10-50', '50-200', '200-1000', 'gt1000', 'unknown']);
const LATENCY_BUCKETS = new Set(['lt5s', '5-15s', '15-60s', '60-300s', 'gt300s', 'unknown']);
const OUTCOMES = new Set(['completed', 'failed', 'cancelled']);
const FAILURE_CODES = new Set([
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

const FIELDS = new Set([
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

const POLICY_VERSION_RE = /^[A-Za-z0-9._-]{1,48}$/;
const DAY_MS = 24 * 3600 * 1000;
const MAX_MEMORY_ROWS = 200;
const MAX_STORED_ROWS = 5000;

/** Refuse anything shaped like an identifier, wherever it appears. */
export function looksSensitive(value) {
  if (typeof value !== 'string') return false;
  if (/0x[0-9a-fA-F]{8,}/.test(value)) return true;
  if (/[A-Za-z0-9+/=]{40,}/.test(value)) return true;
  /* Every legal value is a single token. Whitespace means prose, and prose is
     where a note, an address label or a user id would arrive. */
  if (/\s/.test(value)) return true;
  return value.length > 48;
}

/**
 * Strict validation.
 * @returns {{ok:true, value:object}|{ok:false, code:string}}
 */
export function validateObservation(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'BAD_BODY' };
  const keys = Object.keys(body);
  if (keys.length !== FIELDS.size) return { ok: false, code: 'BAD_FIELDS' };
  for (const key of keys) {
    if (!FIELDS.has(key)) return { ok: false, code: 'UNKNOWN_FIELD' };
    if (looksSensitive(body[key])) return { ok: false, code: 'SENSITIVE_VALUE' };
  }
  if (body.schema !== OBSERVATION_SCHEMA) return { ok: false, code: 'BAD_SCHEMA' };
  if (!KINDS.has(body.intentKind)) return { ok: false, code: 'BAD_KIND' };
  if (!Number.isInteger(body.chainId) || !CHAINS.has(body.chainId)) return { ok: false, code: 'BAD_CHAIN' };
  if (!POLICIES.has(body.routePolicy)) return { ok: false, code: 'BAD_POLICY' };
  if (!SOLVERS.has(body.solver)) return { ok: false, code: 'BAD_SOLVER' };
  if (!Number.isInteger(body.quoteCount) || body.quoteCount < 0 || body.quoteCount > 8) {
    return { ok: false, code: 'BAD_QUOTE_COUNT' };
  }
  if (!Number.isInteger(body.hopCount) || body.hopCount < 0 || body.hopCount > 8) {
    return { ok: false, code: 'BAD_HOP_COUNT' };
  }
  if (!SIMULATION_STATUSES.has(body.simulationStatus)) return { ok: false, code: 'BAD_SIMULATION_STATUS' };
  if (!GAS_BUCKETS.has(body.gasEstimateBucket)) return { ok: false, code: 'BAD_GAS_BUCKET' };
  if (!BPS_BUCKETS.has(body.gasErrorBpsBucket)) return { ok: false, code: 'BAD_GAS_ERROR_BUCKET' };
  if (!BPS_BUCKETS.has(body.outputErrorBpsBucket)) return { ok: false, code: 'BAD_OUTPUT_ERROR_BUCKET' };
  if (!LATENCY_BUCKETS.has(body.confirmationLatencyBucket)) return { ok: false, code: 'BAD_LATENCY_BUCKET' };
  if (!FAILURE_CODES.has(body.failureCode)) return { ok: false, code: 'BAD_FAILURE_CODE' };
  if (!OUTCOMES.has(body.outcome)) return { ok: false, code: 'BAD_OUTCOME' };
  if (typeof body.policyVersion !== 'string' || !POLICY_VERSION_RE.test(body.policyVersion)) {
    return { ok: false, code: 'BAD_POLICY_VERSION' };
  }

  const today = Math.floor(now / DAY_MS);
  if (!Number.isInteger(body.dayBucket) || body.dayBucket > today + 1 || body.dayBucket < today - 30) {
    return { ok: false, code: 'BAD_DAY_BUCKET' };
  }

  /* Rebuild the object field by field so nothing from the request body — not
     even a non-enumerable property — can travel further into the server. */
  return {
    ok: true,
    value: {
      schema: OBSERVATION_SCHEMA,
      intentKind: body.intentKind,
      chainId: body.chainId,
      routePolicy: body.routePolicy,
      solver: body.solver,
      quoteCount: body.quoteCount,
      hopCount: body.hopCount,
      simulationStatus: body.simulationStatus,
      gasEstimateBucket: body.gasEstimateBucket,
      gasErrorBpsBucket: body.gasErrorBpsBucket,
      outputErrorBpsBucket: body.outputErrorBpsBucket,
      confirmationLatencyBucket: body.confirmationLatencyBucket,
      failureCode: body.failureCode,
      outcome: body.outcome,
      policyVersion: body.policyVersion,
      dayBucket: body.dayBucket
    }
  };
}

/* --------------------------------- storage -------------------------------- */

/** Per-instance diagnostics only; explicitly NOT durable storage. */
const recent = [];

export const observationStorageConfigured = () => blobConfigured();

const dayKey = (dayBucket) => `${OBSERVATION_STORE_KEY}:${dayBucket}`;

/**
 * Append one observation to the day's bucket.
 * Fails CLOSED: with no durable store the caller gets NOT_CONFIGURED and the
 * client is told the sample was not taken.
 */
export async function storeObservation(value, { io = null } = {}) {
  const store = io ?? {
    configured: blobConfigured,
    get: (key) => blobGet(key),
    set: (key, rows) => blobSet(key, rows, 90 * DAY_MS)
  };
  if (!store.configured()) return { ok: false, code: 'NOT_CONFIGURED' };
  const key = dayKey(value.dayBucket);
  try {
    const existing = await store.get(key);
    const rows = Array.isArray(existing) ? existing : [];
    if (rows.length >= MAX_STORED_ROWS) return { ok: false, code: 'DAY_BUCKET_FULL' };
    rows.push(value);
    const written = await store.set(key, rows);
    if (written === false) return { ok: false, code: 'WRITE_FAILED' };
    recent.push({ at: Date.now(), outcome: value.outcome });
    if (recent.length > MAX_MEMORY_ROWS) recent.splice(0, recent.length - MAX_MEMORY_ROWS);
    return { ok: true, code: 'STORED', stored: rows.length };
  } catch {
    return { ok: false, code: 'WRITE_FAILED' };
  }
}

/** Honest capability/status block for /api/intents/v1/capabilities. */
export function observationProtocolStatus({ modelTrained = false } = {}) {
  return {
    schema: OBSERVATION_SCHEMA,
    endpoint: '/api/intents/v1/observations',
    modelEndpoint: '/api/intents/v1/execution-observation-model',
    modelSchema: 'fbt.intent-execution-model.v1',
    optInRequired: true,
    durableStorageConfigured: observationStorageConfigured(),
    /* True only when the empirical trainer has enough real observations.
       Never a claim that we optimise routes with ML. */
    modelTrained: Boolean(modelTrained),
    mlOptimizationClaimed: false,
    acceptsWalletAddress: false,
    acceptsTxHash: false,
    acceptsCalldata: false,
    acceptsFreeText: false,
    fields: [...FIELDS].sort(),
    instanceObservations: recent.length
  };
}
