/**
 * OBSERVED REPUTATION — aggregate-only, derived, never submitted.
 *
 * WHY THERE IS NO WRITE ENDPOINT
 * ---------------------------------------------------------------------------
 * Reputation you can POST is marketing. This module computes reputation from
 * data the platform already collects and already publishes the rules for: the
 * opt-in, bucketed `fbt.intent-execution-observation.v1` records in
 * server/intentObservation.js. Nobody can raise their own score, because
 * nothing accepts a score.
 *
 * WHAT IS AND IS NOT IN A RECORD
 * ---------------------------------------------------------------------------
 * In: a subject id that is already public infrastructure (the solver name that
 * appears in the observation schema's enum), a decided-sample count, a success
 * rate and a confidence label. Out: wallet addresses, tx hashes, user ids,
 * timestamps of individual events, or anything else that could re-identify a
 * person. The observation records themselves are bucketed for exactly this
 * reason, and this layer only ever counts them.
 *
 * SMALL SAMPLES SAY NOTHING
 * ---------------------------------------------------------------------------
 * `reputationRelationship()` (server/phase2Schemas.js) gates the whole thing:
 * under five decided observations the status is `insufficient_data` and BOTH
 * the count and the rate are null. A "100% success (1 sample)" badge is worse
 * than no badge, so the number does not exist rather than being hidden in the
 * UI where the next refactor can reveal it.
 */

import { blobConfigured, blobGet } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
import { SCHEMAS, reputationRelationship } from './phase2Schemas.js';
import { OBSERVATION_STORE_KEY } from './intentObservation.js';

export const REPUTATION_STORE_KEY = 'ecosystem-reputation:v1';
export const REPUTATION_WINDOW_DAYS = 30;
export const REPUTATION_LIMITATIONS = Object.freeze([
  'Derived from opt-in, bucketed execution observations; not a rating and not a guarantee.',
  'Under five decided observations no count and no success rate are published.',
  'No wallet address, transaction hash or user identity is stored or exposed.'
]);

const DAY_MS = 24 * 3600_000;
const SNAPSHOT_TTL_MS = 6 * 3600_000;
const SUBJECT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const DECIDED = new Set(['completed', 'failed']);
const MAX_SUBJECTS = 100;

const durableStore = Object.freeze({ durable: blobConfigured, get: storeGet, set: storeSet });
const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Aggregate raw observation rows into per-subject summaries.
 *
 * `cancelled` observations are counted but excluded from the denominator: a
 * user changing their mind is not a solver failure, and folding it in would
 * quietly punish whoever gets used for exploratory quotes.
 */
export function buildReputationSnapshot(rows, { now = Date.now(), windowDays = REPUTATION_WINDOW_DAYS } = {}) {
  const tally = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const subjectId = typeof row?.solver === 'string' ? row.solver.trim().toLowerCase() : '';
    /* Defence in depth: the observation schema only ever contains enumerated
       solver names, so anything address- or hash-shaped is a poisoned row. */
    if (!SUBJECT_ID.test(subjectId) || subjectId === 'unknown' || /^0x/.test(subjectId) || /^[a-f0-9]{32,}$/.test(subjectId)) continue;
    const current = tally.get(subjectId) || { completed: 0, failed: 0, cancelled: 0 };
    if (row.outcome === 'completed') current.completed += 1;
    else if (row.outcome === 'failed') current.failed += 1;
    else if (row.outcome === 'cancelled') current.cancelled += 1;
    else continue;
    tally.set(subjectId, current);
  }

  const subjects = {};
  for (const [subjectId, counts] of [...tally.entries()].slice(0, MAX_SUBJECTS)) {
    const decided = counts.completed + counts.failed;
    const relationship = reputationRelationship({
      schema: SCHEMAS.reputation,
      subjectId,
      sampleSize: decided,
      confidence: decided >= 50 ? 'medium' : 'low'
    });
    subjects[subjectId] = relationship.status === 'observed'
      ? {
        schema: SCHEMAS.reputation,
        subjectId,
        status: 'observed',
        sampleSize: decided,
        successRate: round(counts.completed / decided),
        confidence: relationship.confidence,
        cancelledSamples: counts.cancelled,
        windowDays,
        source: 'opt-in execution observations'
      }
      : {
        schema: SCHEMAS.reputation,
        subjectId,
        status: 'insufficient_data',
        sampleSize: null,
        successRate: null,
        confidence: 'none',
        windowDays,
        source: 'opt-in execution observations'
      };
  }
  return { schema: SCHEMAS.reputation, generatedAt: now, windowDays, subjectCount: Object.keys(subjects).length, subjects };
}

/** Read the observation day buckets the ingest endpoint writes. */
async function readObservationRows({ now = Date.now(), windowDays = REPUTATION_WINDOW_DAYS, read = blobGet } = {}) {
  const today = Math.floor(now / DAY_MS);
  const rows = [];
  for (let day = 0; day < windowDays; day += 1) {
    try {
      const bucket = await read(`${OBSERVATION_STORE_KEY}:${today - day}`);
      if (Array.isArray(bucket)) rows.push(...bucket);
    } catch {
      /* a missing or unreadable day is not a failure — it is fewer samples */
    }
  }
  return rows;
}

/*
 * Single-flight rebuild. Reputation is read from the catalog page, so without
 * this a burst of visitors would each walk thirty day-buckets.
 */
let rebuilding = null;

export async function getReputationSnapshot({ now = Date.now(), maxAgeMs = SNAPSHOT_TTL_MS, store = durableStore, read = blobGet, force = false } = {}) {
  if (!store.durable()) return { ok: true, dataStatus: 'unavailable', snapshot: null };
  const cached = await store.get(REPUTATION_STORE_KEY, null);
  if (!force && cached?.generatedAt && now - cached.generatedAt < maxAgeMs) {
    return { ok: true, dataStatus: 'live', snapshot: cached };
  }
  if (!rebuilding) {
    rebuilding = (async () => {
      const rows = await readObservationRows({ now, read });
      const snapshot = buildReputationSnapshot(rows, { now });
      await store.set(REPUTATION_STORE_KEY, snapshot);
      return snapshot;
    })().finally(() => { rebuilding = null; });
  }
  try {
    return { ok: true, dataStatus: 'live', snapshot: await rebuilding };
  } catch {
    /* A failed rebuild reports the honest unavailable rather than a zeroed
       snapshot that would read as "observed nothing bad". */
    return { ok: true, dataStatus: 'unavailable', snapshot: cached || null };
  }
}

/** One subject. Unknown subjects are `insufficient_data`, never zero-rated. */
export async function getReputation(subjectId, options = {}) {
  const id = String(subjectId || '').toLowerCase();
  if (!SUBJECT_ID.test(id)) return { ok: false, code: 'INVALID_SUBJECT' };
  const { dataStatus, snapshot } = await getReputationSnapshot(options);
  if (dataStatus !== 'live' || !snapshot) return { ok: true, dataStatus: 'unavailable', data: null };
  const found = snapshot.subjects?.[id] || null;
  return {
    ok: true,
    dataStatus: 'live',
    data: found || {
      schema: SCHEMAS.reputation,
      subjectId: id,
      status: 'insufficient_data',
      sampleSize: null,
      successRate: null,
      confidence: 'none',
      windowDays: snapshot.windowDays,
      source: 'opt-in execution observations'
    },
    generatedAt: snapshot.generatedAt
  };
}

/** Map of subjectId → summary, for attaching to a catalog page in one read. */
export async function observedReputations(options = {}) {
  const { dataStatus, snapshot } = await getReputationSnapshot(options);
  if (dataStatus !== 'live' || !snapshot) return new Map();
  return new Map(Object.entries(snapshot.subjects || {}).filter(([, value]) => value?.status === 'observed'));
}
