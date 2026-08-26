/**
 * FBT INTENT AI — Intent Genome, DNA matching and safe evolution.
 *
 * Genome values are an explainable preference/risk vector, not an identity
 * profile and not permission to execute. No secret, raw credential or private
 * key is accepted here.
 */

export const GENOME_SCHEMA = 'fbt.intent-genome.v1';
export const GENOME_DIMENSIONS = Object.freeze([
  'riskTolerance',
  'timeHorizon',
  'liquidityNeed',
  'feeSensitivity',
  'drawdownTolerance',
  'automationPreference',
  'privacyPreference'
]);

const NUMBER_FIELDS = new Set(GENOME_DIMENSIONS);
const clamp = (value, fallback = 50) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
};
const cleanText = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const SECRET_FIELD = /(seed|mnemonic|private.?key|master.?password|raw.?secret|secret.?key|credential)/i;

export function createIntentGenome(input = {}) {
  const secretCheck = rejectSecretGenomeInput(input);
  const record = secretCheck.ok && input && typeof input === 'object' ? input : {};
  const valueSource = record.values && typeof record.values === 'object' && !Array.isArray(record.values)
    ? record.values
    : record;
  const values = Object.fromEntries(GENOME_DIMENSIONS.map((key) => [key, clamp(valueSource[key])]));
  return {
    schema: GENOME_SCHEMA,
    version: 1,
    values,
    source: cleanText(secretCheck.ok ? (record.source || 'user-explicit-or-session-signal') : 'secret-input-rejected', 100),
    evidence: secretCheck.ok && Array.isArray(record.evidence) ? record.evidence.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 20) : [],
    updatedAt: new Date().toISOString(),
    executionPermission: false,
    containsSecrets: false
  };
}

export function rejectSecretGenomeInput(input) {
  let serialized;
  try { serialized = JSON.stringify(input ?? {}); }
  catch { return { ok: false, code: 'UNSERIALIZABLE_INPUT_REJECTED' }; }
  const containsSecret = SECRET_FIELD.test(serialized) || /\b(?:0x)?[a-f0-9]{64}\b/i.test(serialized);
  return { ok: !containsSecret, code: containsSecret ? 'SECRET_INPUT_REJECTED' : null };
}

function genomeValues(genome) {
  return genome?.values || genome || {};
}

/** Similarity is a 0–100 explainable score; it is not a success probability. */
export function matchIntentDNA(userGenome, candidateGenome) {
  const left = genomeValues(userGenome);
  const right = genomeValues(candidateGenome);
  const dimensions = GENOME_DIMENSIONS.map((dimension) => {
    const a = clamp(left[dimension]);
    const b = clamp(right[dimension]);
    return { dimension, user: a, candidate: b, difference: Math.abs(a - b), matchPct: Math.max(0, 100 - Math.abs(a - b)) };
  });
  const score = Math.round(dimensions.reduce((sum, item) => sum + item.matchPct, 0) / dimensions.length);
  return {
    ok: true,
    schema: GENOME_SCHEMA,
    score,
    interpretation: score >= 80 ? 'strong-fit' : score >= 60 ? 'mixed-fit' : 'weak-fit',
    dimensions,
    neverGuaranteesOutcome: true,
    requiresRiskReview: true
  };
}

/** Evolve only from explicit, bounded feedback; a decline never grants access. */
export function evolveIntentGenome(genome, feedback = {}) {
  const check = rejectSecretGenomeInput(feedback);
  if (!check.ok) return { ok: false, code: check.code };
  const current = genomeValues(genome);
  const delta = Number(feedback.delta);
  const step = Number.isFinite(delta) ? Math.max(-10, Math.min(10, delta)) : 0;
  const direction = feedback.accepted === true ? 1 : feedback.accepted === false ? -1 : 0;
  const dimension = GENOME_DIMENSIONS.includes(feedback.dimension) ? feedback.dimension : null;
  const next = { ...current };
  if (dimension && direction) next[dimension] = clamp(Number(current[dimension]) + (step || 5) * direction);
  return {
    ok: true,
    genome: createIntentGenome({
      ...next,
      source: 'bounded-user-feedback',
      evidence: [...(genome?.evidence || []), cleanText(feedback.reason || `feedback:${feedback.accepted}`, 120)]
    }),
    changedDimension: dimension,
    accessChanged: false,
    executionPermissionChanged: false
  };
}
