/**
 * FBT FINANCIAL INTELLIGENCE OS — provenance envelopes (§5).
 * ---------------------------------------------------------------------------
 * THE RULE: every financial value travels with
 *
 *   { value, source, at, freshnessMs, freshness, ttlMs, confidence, status }
 *
 * A number without a source and a timestamp is not a fact, it is a guess, and
 * this module makes the guess unrepresentable: the only way to build an
 * envelope is `value()` (which demands a source) or `unavailable()` (which
 * demands a reason). There is no `valueOrDefault()`.
 *
 * Confidence is DERIVED from freshness and status — never chosen by a caller:
 *   LIVE    0.95   the source answered inside its budget
 *   PARTIAL 0.70   the source answered but admits gaps
 *   STALE   0.55 → 0.10, decaying linearly to zero at 10× the budget
 *   UNAVAILABLE 0  nothing was read; the field must render as a gap
 */
import { round } from '../../src/lib/central/schema.js';

export const PROVENANCE_SCHEMA = 'fbt.fi.provenance.v1';

export const FRESHNESS = Object.freeze({
  LIVE: 'LIVE', PARTIAL: 'PARTIAL', STALE: 'STALE', UNAVAILABLE: 'UNAVAILABLE'
});

const MAX_CONFIDENCE = 0.95;
const STALE_DECAY_MULTIPLE = 10;

export function confidenceFor(freshness, { ageMs = 0, ttlMs = 0 } = {}) {
  switch (freshness) {
    case FRESHNESS.LIVE: return MAX_CONFIDENCE;
    case FRESHNESS.PARTIAL: return 0.7;
    case FRESHNESS.STALE: {
      const budget = Number(ttlMs) > 0 ? Number(ttlMs) : 60_000;
      const over = Math.max(0, Number(ageMs) - budget);
      const decay = Math.max(0, 1 - over / (budget * STALE_DECAY_MULTIPLE));
      return round(Math.max(0, 0.55 * decay), 3);
    }
    default: return 0;
  }
}

/** A real, sourced value. `source` is mandatory — that is the whole point. */
export function value(v, { source, at = Date.now(), ttlMs = 60_000, status = 'OK', note = null } = {}) {
  if (v === null || v === undefined) return unavailable('VALUE_NULL', { source, at, ttlMs });
  const freshness = status === 'PARTIAL' ? FRESHNESS.PARTIAL
    : status === 'STALE' ? FRESHNESS.STALE
      : FRESHNESS.LIVE;
  const ageMs = Math.max(0, Date.now() - Number(at || 0));
  const stale = freshness === FRESHNESS.LIVE && Number(ttlMs) > 0 && ageMs > Number(ttlMs);
  const f = stale ? FRESHNESS.STALE : freshness;
  return {
    schema: PROVENANCE_SCHEMA,
    status: f === FRESHNESS.UNAVAILABLE ? 'unavailable' : 'ok',
    value: v,
    source: String(source || 'unknown').slice(0, 80),
    at: Number(at) || 0,
    freshnessMs: ageMs,
    freshness: f,
    ttlMs: Number(ttlMs) || 0,
    confidence: confidenceFor(f, { ageMs, ttlMs }),
    note
  };
}

/** An explicit gap. Carries the reason so the UI can name what is missing. */
export function unavailable(reason, { source = null, at = Date.now(), ttlMs = 0 } = {}) {
  return {
    schema: PROVENANCE_SCHEMA,
    status: 'unavailable',
    value: null,
    reason: String(reason || 'UNAVAILABLE').slice(0, 160),
    source: source ? String(source).slice(0, 80) : null,
    at: Number(at) || 0,
    freshnessMs: 0,
    freshness: FRESHNESS.UNAVAILABLE,
    ttlMs: Number(ttlMs) || 0,
    confidence: 0,
    note: null
  };
}

export const isEnvelope = (x) => Boolean(x && typeof x === 'object' && x.schema === PROVENANCE_SCHEMA);
export const isUsable = (env) => isEnvelope(env) && env.status === 'ok' && env.value !== null && env.value !== undefined;
export const readValue = (env, fallback = null) => (isUsable(env) ? env.value : fallback);

/** Convert a `/api/brain` state section into an envelope (no re-reading). */
export function fromSection(section, { now = Date.now(), pick = null } = {}) {
  if (!section || section.data === null || section.data === undefined) {
    return unavailable(section?.reason || (section?.status === 'MISSING' ? 'NEVER_READ' : 'SECTION_UNAVAILABLE'), {
      source: section?.source || section?.key || null, at: section?.updatedAt || now
    });
  }
  const data = typeof pick === 'function' ? pick(section.data) : section.data;
  if (data === null || data === undefined) return unavailable('FIELD_NOT_PRESENT', { source: section.source, at: section.updatedAt });
  const ageMs = Math.max(0, now - Number(section.updatedAt || 0));
  const budget = Number(section.ttlMs) || 60_000;
  const status = section.status === 'PARTIAL' ? 'PARTIAL'
    : section.status === 'STALE' || ageMs > budget ? 'STALE' : 'OK';
  return value(data, { source: section.source || section.key || 'state', at: section.updatedAt || now, ttlMs: budget, status });
}

/** Derived value: computed by us from sourced inputs. Says so, and carries
 *  the WORST provenance of its inputs — a computed number is never more
 *  trustworthy than the least trustworthy thing it was built from. */
export function derived(v, inputs = [], { source = 'derived', at = Date.now(), note = null } = {}) {
  const envs = (Array.isArray(inputs) ? inputs : []).filter(isEnvelope);
  if (!envs.length) return unavailable('NO_SOURCED_INPUTS', { source, at });
  if (!envs.every(isUsable)) {
    const bad = envs.find((e) => !isUsable(e));
    return unavailable(bad.reason || 'INPUT_UNAVAILABLE', { source, at });
  }
  const worst = envs.reduce((a, b) => (a.confidence <= b.confidence ? a : b));
  const oldest = envs.reduce((a, b) => (a.at <= b.at ? a : b));
  const env = value(v, { source, at: oldest.at, ttlMs: worst.ttlMs, status: worst.freshness === FRESHNESS.PARTIAL ? 'PARTIAL' : 'OK', note });
  return { ...env, confidence: round(Math.min(env.confidence, worst.confidence), 3), inputs: envs.map((e) => e.source) };
}

/** One line of provenance for a whole object of envelopes. */
export function provenanceSummary(obj = {}, { now = Date.now() } = {}) {
  const rows = Object.values(obj).filter(isEnvelope);
  if (!rows.length) return { count: 0, usable: 0, coverage: 0, minConfidence: 0, meanConfidence: 0, stale: [], unavailable: [], oldestAt: null, now };
  const usable = rows.filter(isUsable);
  const stale = rows.filter((e) => e.freshness === FRESHNESS.STALE).map((e) => e.source);
  const unavailableRows = rows.filter((e) => e.freshness === FRESHNESS.UNAVAILABLE).map((e) => e.source);
  return {
    count: rows.length,
    usable: usable.length,
    coverage: round(usable.length / rows.length, 3),
    minConfidence: round(Math.min(...rows.map((e) => e.confidence)), 3),
    meanConfidence: round(rows.reduce((a, e) => a + e.confidence, 0) / rows.length, 3),
    stale,
    unavailable: unavailableRows,
    oldestAt: Math.min(...rows.map((e) => e.at || now)),
    now
  };
}
