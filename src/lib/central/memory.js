/**
 * FBT FINANCIAL OS — Memory OS (Upgrade 10 §22, §23, §24, §25).
 * ---------------------------------------------------------------------------
 * A memory system with three properties the ad-hoc "last turn" memory did not
 * have:
 *
 * 1. TYPED. Conversation, intent, goal, preference, decision, strategy, outcome
 *    and event memories are different kinds with different retention. A price
 *    the user asked about is worth ten minutes; a decision they approved is
 *    worth months. One bucket cannot serve both.
 *
 * 2. CONFIDENCE-BEARING (§24). Every record carries `origin` and `confidence`.
 *    An AI-inferred preference is MEDIUM and can be contradicted; a user-stated
 *    one is HIGH. `promote()` is the only path from inferred to stated, and it
 *    requires an explicit user confirmation token.
 *
 * 3. RETRIEVED, NOT DUMPED (§23). `retrieve()` scores records against the
 *    current turn and returns a BOUNDED, budgeted set. Pouring the whole store
 *    into a prompt is how a memory system becomes a latency and a leak problem
 *    at the same time.
 *
 * NOTHING SENSITIVE IS STORABLE. `sanitize()` runs on every write and drops
 * key-shaped material outright — §59 is only real if it is one function that
 * every path must cross.
 */
import { CI_SCHEMA, hashString, round, usableNumber } from './schema.js';

export const MEMORY_SCHEMA = 'fbt.memory-os.v1';

export const MEMORY_KINDS = Object.freeze({
  CONVERSATION: { id: 'CONVERSATION', ttlMs: 60 * 60_000, max: 40, weight: 0.6 },
  INTENT: { id: 'INTENT', ttlMs: 24 * 3600_000, max: 30, weight: 0.8 },
  GOAL: { id: 'GOAL', ttlMs: 365 * 24 * 3600_000, max: 20, weight: 1.0 },
  PREFERENCE: { id: 'PREFERENCE', ttlMs: 365 * 24 * 3600_000, max: 30, weight: 1.0 },
  DECISION: { id: 'DECISION', ttlMs: 180 * 24 * 3600_000, max: 60, weight: 0.95 },
  STRATEGY: { id: 'STRATEGY', ttlMs: 180 * 24 * 3600_000, max: 30, weight: 0.9 },
  OUTCOME: { id: 'OUTCOME', ttlMs: 365 * 24 * 3600_000, max: 60, weight: 1.0 },
  EVENT: { id: 'EVENT', ttlMs: 7 * 24 * 3600_000, max: 60, weight: 0.5 }
});
export const MEMORY_KIND_IDS = Object.freeze(Object.keys(MEMORY_KINDS));

export const MEMORY_ORIGINS = Object.freeze(['stated', 'observed', 'inferred']);
const CONFIDENCE_BY_ORIGIN = { stated: 'HIGH', observed: 'HIGH', inferred: 'MEDIUM' };

/** Anything matching this never enters the store, in a key OR in a value. */
const FORBIDDEN = /(private[ _-]?key|seed[ _-]?phrase|recovery[ _-]?phrase|mnemonic|passphrase|xprv|signing[ _-]?secret|encryption[ _-]?key|kms)/i;
/** A bare 64-hex blob is a key until proven otherwise. */
const KEYLIKE = /^(0x)?[0-9a-fA-F]{64}$/;

export function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (FORBIDDEN.test(value) || KEYLIKE.test(value.trim())) return '[REDACTED]';
    return value.slice(0, 600);
  }
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 25).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) {
      if (FORBIDDEN.test(k)) { out[k] = '[REDACTED]'; continue; }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return null;
}

export function createMemoryStore({ now = () => Date.now() } = {}) {
  /** kind -> array of records, newest last. */
  const buckets = new Map(MEMORY_KIND_IDS.map((k) => [k, []]));

  function write({ kind, key = null, value, origin = 'observed', tags = [], confidence = null, sourceIntentId = null } = {}) {
    const k = String(kind || '').toUpperCase();
    const meta = MEMORY_KINDS[k];
    if (!meta) return { ok: false, code: 'UNKNOWN_MEMORY_KIND', allowed: MEMORY_KIND_IDS };
    if (!MEMORY_ORIGINS.includes(origin)) return { ok: false, code: 'BAD_ORIGIN', allowed: MEMORY_ORIGINS };
    const clean = sanitize(value);
    if (clean === null || clean === '[REDACTED]') return { ok: false, code: 'NOTHING_STORABLE', detail: 'the value was empty or matched the secret filter' };
    const at = now();
    const record = {
      schema: MEMORY_SCHEMA,
      id: `mem_${hashString(`${k}|${key || ''}|${JSON.stringify(clean)}|${at}`)}`,
      kind: k,
      key: key ? String(key).slice(0, 60) : null,
      value: clean,
      origin,
      confidence: confidence && ['HIGH', 'MEDIUM', 'LOW'].includes(confidence) ? confidence : CONFIDENCE_BY_ORIGIN[origin],
      tags: (Array.isArray(tags) ? tags : []).map((t) => String(t).toUpperCase().slice(0, 24)).slice(0, 8),
      sourceIntentId: sourceIntentId ? String(sourceIntentId).slice(0, 64) : null,
      at,
      expiresAt: at + meta.ttlMs,
      hits: 0,
      supersedes: null
    };
    const bucket = buckets.get(k);
    /* A keyed write REPLACES its predecessor rather than stacking: two answers
       to "what is your risk tolerance" in the store is not memory, it is a bug
       that surfaces as an AI that contradicts itself. An inferred write may not
       replace a stated one (§24). */
    if (record.key) {
      const idx = bucket.findIndex((r) => r.key === record.key);
      if (idx >= 0) {
        const prev = bucket[idx];
        if (prev.origin === 'stated' && origin === 'inferred') {
          return { ok: false, code: 'WOULD_OVERWRITE_STATED', existing: prev, detail: 'the user stated this; an inference cannot replace it without confirmation' };
        }
        record.supersedes = prev.id;
        bucket.splice(idx, 1);
      }
    }
    bucket.push(record);
    while (bucket.length > meta.max) bucket.shift();
    return { ok: true, record };
  }

  function prune(at = now()) {
    let removed = 0;
    for (const [k, bucket] of buckets) {
      const kept = bucket.filter((r) => r.expiresAt > at);
      removed += bucket.length - kept.length;
      buckets.set(k, kept);
    }
    return removed;
  }

  /**
   * §23: relevance-scored retrieval under a hard budget.
   *
   * Score = kind weight × recency decay × tag/keyword overlap × confidence.
   * Records that score below the floor are NOT returned at any budget, because
   * an irrelevant memory in a prompt is worse than no memory: it invents
   * continuity that never existed.
   */
  function retrieve({ text = '', tags = [], kinds = MEMORY_KIND_IDS, limit = 8, floor = 0.12, at = now() } = {}) {
    prune(at);
    const words = String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
    const wantTags = new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).toUpperCase()));
    const scored = [];
    for (const kind of kinds) {
      const meta = MEMORY_KINDS[kind];
      if (!meta) continue;
      for (const r of buckets.get(kind) || []) {
        const ageRatio = Math.min(1, (at - r.at) / meta.ttlMs);
        const recency = 1 - ageRatio * 0.7;
        const blob = `${r.key || ''} ${JSON.stringify(r.value)} ${r.tags.join(' ')}`.toLowerCase();
        const hits = words.filter((w) => blob.includes(w)).length;
        const tagHit = r.tags.some((t) => wantTags.has(t)) ? 0.35 : 0;
        const keyword = words.length ? Math.min(0.5, hits / words.length) : 0;
        const confBoost = r.confidence === 'HIGH' ? 0.15 : r.confidence === 'MEDIUM' ? 0.05 : 0;
        /* Goals and preferences are ALWAYS somewhat relevant to a financial
           question — that is the point of a profile — so they carry a base term
           that the keyword score adds to rather than replaces. */
        const base = (kind === 'GOAL' || kind === 'PREFERENCE') ? 0.22 : 0;
        const score = round(meta.weight * recency * (base + keyword + tagHit + confBoost), 4);
        if (score >= floor) scored.push({ ...r, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, Math.max(1, Math.min(30, limit)));
    for (const r of kept) {
      const bucket = buckets.get(r.kind);
      const live = bucket.find((x) => x.id === r.id);
      if (live) live.hits += 1;
    }
    return {
      schema: MEMORY_SCHEMA, brain: CI_SCHEMA,
      status: 'OK',
      considered: scored.length,
      returned: kept.length,
      floor,
      records: kept.map(({ hits, expiresAt, ...rest }) => { void hits; void expiresAt; return rest; }),
      omitted: Math.max(0, scored.length - kept.length),
      note: scored.length > kept.length ? `${scored.length - kept.length} lower-scoring memories were withheld from the context on purpose` : null
    };
  }

  /** §24: the ONLY path from inferred to stated, and it needs the user. */
  function promote(recordId, { confirmedByUser = false, at = now() } = {}) {
    if (!confirmedByUser) return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', detail: 'an inference becomes a fact only when the user says so' };
    for (const bucket of buckets.values()) {
      const r = bucket.find((x) => x.id === recordId);
      if (r) {
        r.origin = 'stated';
        r.confidence = 'HIGH';
        r.at = at;
        return { ok: true, record: r };
      }
    }
    return { ok: false, code: 'MEMORY_NOT_FOUND' };
  }

  function forget({ id = null, kind = null, key = null } = {}) {
    let removed = 0;
    for (const [k, bucket] of buckets) {
      if (kind && k !== String(kind).toUpperCase()) continue;
      const kept = bucket.filter((r) => !((id && r.id === id) || (key && r.key === key) || (!id && !key)));
      removed += bucket.length - kept.length;
      buckets.set(k, kept);
    }
    return { ok: true, removed };
  }

  function stats(at = now()) {
    prune(at);
    const byKind = {};
    let total = 0;
    for (const [k, bucket] of buckets) { byKind[k] = bucket.length; total += bucket.length; }
    return { schema: MEMORY_SCHEMA, total, byKind, kinds: MEMORY_KIND_IDS };
  }

  function exportAll(at = now()) {
    prune(at);
    const out = [];
    for (const bucket of buckets.values()) out.push(...bucket);
    return out.sort((a, b) => b.at - a.at);
  }

  function importAll(records = []) {
    let loaded = 0;
    for (const r of Array.isArray(records) ? records : []) {
      const meta = MEMORY_KINDS[String(r?.kind || '').toUpperCase()];
      if (!meta) continue;
      const clean = sanitize(r.value);
      if (clean === null) continue;
      buckets.get(meta.id).push({ ...r, value: clean, kind: meta.id });
      loaded += 1;
    }
    for (const [k, bucket] of buckets) {
      bucket.sort((a, b) => a.at - b.at);
      while (bucket.length > MEMORY_KINDS[k].max) bucket.shift();
    }
    return { ok: true, loaded };
  }

  return { schema: MEMORY_SCHEMA, write, retrieve, promote, forget, prune, stats, exportAll, importAll };
}

/* ── §25 Outcome learning ──────────────────────────────────────────────── */

/**
 * Compare what a decision PROMISED with what actually happened, and produce a
 * lesson that is specific enough to change a later decision.
 *
 * The deliberate restraint here: a single outcome never rewrites a model. It
 * produces a `lesson` with a sample size, and the calibration layer aggregates.
 */
export function evaluateOutcome({ decision = null, actual = {}, now = Date.now() } = {}) {
  const expected = usableNumber(decision?.expectedReturnPct ?? decision?.score?.components?.expectedReturn);
  const realised = usableNumber(actual.realisedReturnPct);
  if (expected === null || realised === null) {
    return { schema: MEMORY_SCHEMA, status: 'UNAVAILABLE', reason: 'OUTCOME_INPUTS_INCOMPLETE', needed: [expected === null ? 'the decision\'s expected return' : null, realised === null ? 'a measured realised return' : null].filter(Boolean) };
  }
  const gap = round(realised - expected, 2);
  const ratio = expected !== 0 ? round(realised / expected, 3) : null;
  const verdict = Math.abs(gap) <= Math.max(1, Math.abs(expected) * 0.2) ? 'AS_EXPECTED' : gap > 0 ? 'BETTER' : 'WORSE';
  const causes = [];
  if (usableNumber(actual.feesPaidUsd) && usableNumber(actual.capitalUsd)) {
    const dragPct = round((actual.feesPaidUsd / actual.capitalUsd) * 100, 2);
    if (dragPct > 0.25) causes.push({ code: 'FEE_DRAG', detail: `fees and slippage cost ${dragPct}% of deployed capital`, contributionPct: dragPct });
  }
  if (usableNumber(actual.aprAtEntryPct) && usableNumber(actual.aprRealisedPct)) {
    const decay = round(actual.aprRealisedPct - actual.aprAtEntryPct, 2);
    if (decay < -1) causes.push({ code: 'APR_DECAY', detail: `the pool rate fell ${Math.abs(decay)} points after entry`, contributionPct: decay });
  }
  if (usableNumber(actual.marketMovePct) && Math.abs(actual.marketMovePct) > 10) {
    causes.push({ code: 'MARKET_MOVE', detail: `the market moved ${actual.marketMovePct}% over the holding period`, contributionPct: actual.marketMovePct });
  }
  return {
    schema: MEMORY_SCHEMA, brain: CI_SCHEMA, status: 'OK', at: now,
    decisionId: decision?.id || null,
    expectedReturnPct: expected,
    realisedReturnPct: realised,
    gapPct: gap,
    ratio,
    verdict,
    causes,
    unexplainedGapPct: causes.length ? round(gap - causes.reduce((a, c) => a + (usableNumber(c.contributionPct) ?? 0), 0), 2) : gap,
    lesson: verdict === 'AS_EXPECTED'
      ? `the estimate for ${decision?.type || 'this decision type'} held within tolerance on this sample`
      : `${decision?.type || 'this decision type'} came in ${gap > 0 ? 'above' : 'below'} estimate by ${Math.abs(gap)} points${causes.length ? ` — attributed to ${causes.map((c) => c.code).join(', ')}` : ' with no attributable cause in the recorded data'}`,
    sampleSize: 1,
    note: 'one outcome is an observation, not a model change; calibration aggregates these'
  };
}

/**
 * §35 Confidence calibration: are our 80% claims right 80% of the time?
 * Bucketed reliability, with an explicit refusal to report calibration on a
 * sample too small to mean anything.
 */
export const MIN_CALIBRATION_SAMPLES = 10;

export function calibrate(predictions = []) {
  const rows = predictions
    .map((p) => ({ confidence: usableNumber(p?.confidence), correct: p?.correct === true }))
    .filter((p) => p.confidence !== null && p.confidence >= 0 && p.confidence <= 1);
  if (rows.length < MIN_CALIBRATION_SAMPLES) {
    return {
      schema: MEMORY_SCHEMA, status: 'UNAVAILABLE', reason: 'SAMPLE_TOO_SMALL',
      have: rows.length, need: MIN_CALIBRATION_SAMPLES,
      detail: 'reporting calibration on a handful of predictions would itself be a miscalibrated claim'
    };
  }
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const buckets = [];
  let brier = 0;
  for (const r of rows) brier += (r.confidence - (r.correct ? 1 : 0)) ** 2;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const inBucket = rows.filter((r) => r.confidence >= edges[i] && r.confidence < edges[i + 1]);
    if (!inBucket.length) continue;
    const claimed = inBucket.reduce((a, r) => a + r.confidence, 0) / inBucket.length;
    const actual = inBucket.filter((r) => r.correct).length / inBucket.length;
    buckets.push({
      range: `${Math.round(edges[i] * 100)}–${Math.round(Math.min(1, edges[i + 1]) * 100)}%`,
      n: inBucket.length,
      claimedPct: round(claimed * 100, 1),
      actualPct: round(actual * 100, 1),
      gapPct: round((actual - claimed) * 100, 1)
    });
  }
  const overall = round((rows.filter((r) => r.correct).length / rows.length) * 100, 1);
  const claimedOverall = round((rows.reduce((a, r) => a + r.confidence, 0) / rows.length) * 100, 1);
  return {
    schema: MEMORY_SCHEMA, brain: CI_SCHEMA, status: 'OK',
    samples: rows.length,
    brierScore: round(brier / rows.length, 4),
    claimedAccuracyPct: claimedOverall,
    actualAccuracyPct: overall,
    calibrationGapPct: round(overall - claimedOverall, 1),
    verdict: Math.abs(overall - claimedOverall) <= 7 ? 'CALIBRATED' : overall < claimedOverall ? 'OVERCONFIDENT' : 'UNDERCONFIDENT',
    buckets
  };
}
