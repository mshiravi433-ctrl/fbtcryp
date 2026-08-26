/**
 * FBT INTENT AI — Phase 14: Intent Genome and local-first memory.
 *
 * Genome matching is an explanation aid, not a probability of success. Memory
 * is structured, bounded and local-first. The default path never uploads; even
 * with learning opt-in, only redacted aggregate feedback may be exported.
 * Execution permissions are not a genome field and cannot be evolved here.
 */

import {
  bounded,
  containsRawSecret,
  finite,
  fail,
  noExecutionPermission,
  safeId,
  safeList,
  safeString
} from './phaseBoundary.js';

export const INTENT_GENOME_SCHEMA = 'fbt.intent-genome.v1';
export const GENOME_MATCH_SCHEMA = 'fbt.intent-genome-match.v1';
export const GENOME_EVOLUTION_SCHEMA = 'fbt.intent-genome-evolution.v1';
export const LOCAL_MEMORY_SCHEMA = 'fbt.local-first-memory.v1';
export const MEMORY_EVENT_SCHEMA = 'fbt.local-memory-event.v1';
export const LEARNING_BATCH_SCHEMA = 'fbt.local-learning-batch.v1';

export const GENOME_DIMENSIONS = Object.freeze([
  'riskTolerance',
  'timeHorizon',
  'lossAversion',
  'liquidityPreference',
  'feeSensitivity',
  'explainabilityNeed',
  'automationPreference'
]);

const MAX_MEMORY_ENTRIES = 200;
const MEMORY_KEY = 'fbt-intent-memory-v1';
const SAFE_EVENT_TYPES = new Set(['intent.created', 'strategy.selected', 'strategy.declined', 'execution.observed', 'feedback.received', 'policy.reviewed']);
const SECRET_FIELD = /secret|seed|mnemonic|private|password|credential|signer|calldata|rawkey|token/i;

const dimension = (value) => bounded(value, 0, 100);
const normalizeDimension = (value, fallback = 50) => dimension(value) ?? fallback;

function cleanDimensions(input = {}) {
  const preferences = input.preferences || input.preference || {};
  const risk = input.risk || input.riskVector || {};
  const out = {};
  for (const name of GENOME_DIMENSIONS) {
    const value = preferences[name] ?? risk[name] ?? input[name];
    out[name] = normalizeDimension(value);
  }
  return out;
}

export function rejectSecretGenomeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, schema: INTENT_GENOME_SCHEMA, code: 'GENOME_INPUT_INVALID' };
  return containsRawSecret(input)
    ? { ok: false, schema: INTENT_GENOME_SCHEMA, code: 'RAW_CREDENTIAL_FORBIDDEN' }
    : { ok: true, schema: INTENT_GENOME_SCHEMA };
}

export function createIntentGenome(input = {}, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('GENOME_INPUT_INVALID');
  const safe = rejectSecretGenomeInput(input);
  if (!safe.ok) return safe;
  const dimensions = cleanDimensions(input);
  const id = safeId(input.id || `genome-${Math.floor(now / 1000)}`);
  if (!id) return fail('GENOME_ID_REQUIRED');
  return noExecutionPermission({
    schema: INTENT_GENOME_SCHEMA,
    id,
    dimensions,
    evidence: safeList(input.evidence, (item) => safeString(item, 100), 8),
    sampleSize: Number.isInteger(Number(input.sampleSize)) && Number(input.sampleSize) >= 0 ? Number(input.sampleSize) : 0,
    consent: input.learningOptIn === true,
    createdAt: now,
    updatedAt: now,
    executionPermission: false,
    source: 'user-preference-and-bounded-feedback'
  });
}

/** Explainable similarity only. It never sets success probability. */
export function matchIntentGenome(genome, target = {}) {
  if (!genome || genome.schema !== INTENT_GENOME_SCHEMA || !genome.dimensions || typeof genome.dimensions !== 'object') return fail('GENOME_REQUIRED');
  if (!GENOME_DIMENSIONS.every((name) => dimension(genome.dimensions[name]) !== null)) return fail('GENOME_INVALID');
  if (!target || typeof target !== 'object' || Array.isArray(target)) return fail('GENOME_TARGET_INVALID');
  if (containsRawSecret(target)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const targetDimensions = cleanDimensions(target);
  const differences = GENOME_DIMENSIONS.map((dimensionName) => ({
    dimension: dimensionName,
    genome: genome.dimensions[dimensionName],
    target: targetDimensions[dimensionName],
    difference: Math.abs(genome.dimensions[dimensionName] - targetDimensions[dimensionName])
  }));
  const similarity = Math.round((differences.reduce((sum, row) => sum + (100 - row.difference), 0) / GENOME_DIMENSIONS.length) * 100) / 100;
  return noExecutionPermission({
    ok: true,
    schema: GENOME_MATCH_SCHEMA,
    similarity,
    match: similarity >= 80 ? 'strong' : similarity >= 60 ? 'moderate' : 'weak',
    dimensions: differences,
    successProbability: null,
    evidenceQuality: genome.sampleSize >= 5 ? 'observed-preference-sample' : 'preference-only',
    disclaimer: 'DNA similarity is not a probability of financial success.',
    executionPermissionChanged: false
  });
}

/** Evolve only preference/risk dimensions after explicit learning opt-in. */
export function evolveIntentGenome(genome, feedback = {}, { now = Date.now() } = {}) {
  if (!genome || genome.schema !== INTENT_GENOME_SCHEMA || !genome.dimensions || typeof genome.dimensions !== 'object') return fail('GENOME_REQUIRED');
  if (!GENOME_DIMENSIONS.every((name) => dimension(genome.dimensions[name]) !== null)) return fail('GENOME_INVALID');
  if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) return fail('FEEDBACK_INVALID');
  if (containsRawSecret(feedback)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (feedback.learningOptIn !== true && genome.consent !== true) {
    return { ok: false, schema: GENOME_EVOLUTION_SCHEMA, code: 'LEARNING_OPT_IN_REQUIRED', genome: { ...genome } };
  }
  const signal = feedback.signal === 'positive' ? 1 : feedback.signal === 'negative' ? -1 : 0;
  const magnitude = bounded(feedback.magnitude, 0, 20) ?? 0;
  const updates = {};
  for (const name of GENOME_DIMENSIONS) {
    const delta = finite(feedback.adjustments?.[name]);
    if (delta !== null && delta >= -20 && delta <= 20) updates[name] = delta;
    else if (signal !== 0 && ['riskTolerance', 'automationPreference'].includes(name)) updates[name] = signal * magnitude;
  }
  const dimensions = { ...genome.dimensions };
  for (const [name, delta] of Object.entries(updates)) dimensions[name] = Math.max(0, Math.min(100, dimensions[name] + delta));
  return noExecutionPermission({
    ok: true,
    schema: GENOME_EVOLUTION_SCHEMA,
    genome: { ...genome, dimensions, consent: true, sampleSize: Number(genome.sampleSize || 0) + 1, updatedAt: now, executionPermission: false },
    updates,
    learningOptIn: true,
    executionPermissionChanged: false,
    guardianPolicyChanged: false
  });
}

function redact(value, seen = new Set(), depth = 0, key = '') {
  if (depth > 6) return '[TRUNCATED]';
  if (SECRET_FIELD.test(key)) return '[REDACTED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/seed phrase|recovery phrase|mnemonic|private key|master password|raw secret/i.test(value)) return '[REDACTED]';
    return value.slice(0, 240);
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => redact(item, seen, depth + 1, key)).filter((item) => item !== undefined);
  return Object.fromEntries(Object.entries(value).slice(0, 24).filter(([childKey]) => !SECRET_FIELD.test(childKey)).map(([childKey, child]) => [childKey, redact(child, seen, depth + 1, childKey)]).filter(([, child]) => child !== undefined));
}

export function redactMemoryEvent(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || containsRawSecret(event)) return null;
  const type = SAFE_EVENT_TYPES.has(event.type) ? event.type : null;
  if (!type) return null;
  const at = finite(event.at) ?? Date.now();
  return {
    schema: MEMORY_EVENT_SCHEMA,
    type,
    at,
    payload: redact(event.payload || event.data || {}, new Set(), 0),
    redacted: true,
    uploaded: false
  };
}

function readStorage(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(MEMORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeStorage(storage, rows) {
  try { storage?.setItem?.(MEMORY_KEY, JSON.stringify(rows)); return true; } catch { return false; }
}

/**
 * A local-first store. Passing a storage adapter in tests does not make it a
 * server or durable production memory; the caller must provide the real
 * encrypted device store before making a production claim.
 */
export function createLocalFirstMemory({ storage = globalThis.localStorage, maxEntries = MAX_MEMORY_ENTRIES, learningOptIn = false } = {}) {
  const rows = readStorage(storage).slice(-Math.min(MAX_MEMORY_ENTRIES, Math.max(1, Number(maxEntries) || MAX_MEMORY_ENTRIES)));
  const limit = Math.min(MAX_MEMORY_ENTRIES, Math.max(1, Number(maxEntries) || MAX_MEMORY_ENTRIES));
  const api = {
    schema: LOCAL_MEMORY_SCHEMA,
    storage: 'local-first',
    encryptedAtRest: false,
    productionReady: false,
    learningOptIn: learningOptIn === true,
    entries: rows,
    append(type, payload, { at = Date.now() } = {}) {
      const event = redactMemoryEvent({ type, payload, at });
      if (!event) return { ok: false, code: 'MEMORY_EVENT_REJECTED' };
      api.entries = [...api.entries, event].slice(-limit);
      writeStorage(storage, api.entries);
      return { ok: true, event: { ...event } };
    },
    clear() {
      api.entries = [];
      try { storage?.removeItem?.(MEMORY_KEY); } catch { /* local clear is best effort */ }
      return { ok: true, cleared: true };
    },
    export({ optIn = api.learningOptIn, upload = false } = {}) {
      return buildLearningBatch(api, { optIn, upload });
    },
    status() {
      return { schema: LOCAL_MEMORY_SCHEMA, storage: 'local-first', entries: api.entries.length, learningOptIn: api.learningOptIn, uploadDefault: 'disabled', encryptedAtRest: false, productionReady: false, secretsStored: false };
    }
  };
  return api;
}

/** Aggregate learning export; upload remains disabled unless both flags opt in. */
export function buildLearningBatch(memory, { optIn = false, upload = false } = {}) {
  const entries = Array.isArray(memory?.entries) ? memory.entries : [];
  if (optIn !== true) return { ok: false, schema: LEARNING_BATCH_SCHEMA, code: 'LEARNING_OPT_IN_REQUIRED', upload: 'disabled', entries: [] };
  const counts = {};
  for (const entry of entries) counts[entry.type] = (counts[entry.type] || 0) + 1;
  return noExecutionPermission({
    ok: true,
    schema: LEARNING_BATCH_SCHEMA,
    entries: [],
    aggregate: { eventCounts: counts, sampleSize: entries.length },
    upload: upload === true ? 'explicit-opt-in-required-at-transport' : 'disabled',
    transportAllowed: upload === true,
    pii: false,
    secrets: false
  });
}

export const localMemoryCapabilities = () => ({
  schema: LOCAL_MEMORY_SCHEMA,
  localFirst: true,
  externalUploadDefault: false,
  learningOptInRequired: true,
  storesSecrets: false,
  executionPermissionInfluenced: false
});
