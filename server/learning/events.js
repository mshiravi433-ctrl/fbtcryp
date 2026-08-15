/**
 * LEARNING CORE — server-resolved telemetry (second generation).
 * ---------------------------------------------------------------------------
 * POST /api/learning/event lands here. The pipeline, and the reason for it:
 *
 *   1. INGEST — the validated event is ENRICHED with the current price from
 *      the server's own in-memory market cache (never from the client) and
 *      queued in a small manifest, `learning/pending.json`, keyed by fireAt.
 *      Two resolution callbacks are registered per event:
 *        · short → 24 hours after the event
 *        · long  → 7 days after the event
 *
 *   2. SWEEP — the daily cron calls sweepPending(). Every due entry gets its
 *      forward return computed from CACHED prices; the bucketed outcome is
 *      appended to buckets.ndjson as a finalized (signal + resolution) pair
 *      the trainer already understands. A price-cache miss means the sample
 *      is DROPPED — never invented — after a 3-day grace window in which
 *      later sweeps may still find a price.
 *
 * The client never sends any resolved return. The server computes it from
 * its own trusted market data, which is what makes poisoning the model by
 * submitting fake outcomes impossible: the worst a hostile client can do is
 * submit a prediction and let reality grade it.
 *
 * If Blob is not configured every function here is a cheap no-op and the
 * server behaves exactly as it did before this feature existed.
 */

import {
  PENDING_CAP,
  PENDING_GRACE_MS,
  bucketReturn,
  recordToLine,
  validateEvent
} from './schema.js';
import { blobIo, learningConfigured, appendBuckets } from './store.js';
import { cachedPriceUSD } from './prices.js';

export const PENDING_KEY = 'learning/pending.json';

const DAY_MS = 24 * 3600 * 1000;
/** Horizon → { resolution delay, buckets.ndjson resolution key }. */
const HORIZON_SPEC = {
  short: { delayMs: DAY_MS, key: '1' },
  long: { delayMs: 7 * DAY_MS, key: '7' }
};

/** Deterministic 8-hex djb2-xor hash of the public coin id — MUST stay in
 *  lock-step with anonCoinId in src/lib/learning.js (tests assert this). */
export function hashCoinId(id) {
  let h = 5381;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------ manifest io ------------------------------ */

export async function readPending(io = blobIo) {
  const text = await io.read(PENDING_KEY);
  if (!text) return { v: 1, items: [] };
  try {
    const m = JSON.parse(text);
    const items = Array.isArray(m?.items) ? m.items.filter((x) => x && typeof x === 'object') : [];
    return { v: 1, items };
  } catch {
    // A corrupt manifest must never take the endpoint down; start fresh.
    return { v: 1, items: [] };
  }
}

export async function writePending(manifest, io = blobIo) {
  return io.write(PENDING_KEY, JSON.stringify(manifest) + '\n');
}

/* Writes to pending.json are serialized per instance so concurrent ingests
   cannot interleave a read→modify→write into a corrupted manifest. */
let chain = Promise.resolve();
const serialize = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
};

/* --------------------------------- ingest -------------------------------- */

/**
 * Validate + enrich + queue one learning event. Returns
 *   { ok:true, queued: 2 }                on success,
 *   { ok:false, error: 'BAD_EVENT' }      on malformed payloads,
 *   { ok:false, error: 'NO_PRICE' }       when the market cache cannot price
 *                                         the coin (sample refused, honest),
 *   { ok:false, error: 'NOT_CONFIGURED' } when Blob is off.
 * Never throws.
 */
export async function ingestEvent(body, { io = blobIo, now = Date.now(), priceStore } = {}) {
  if (!io.configured()) return { ok: false, error: 'NOT_CONFIGURED' };
  const ev = validateEvent(body);
  if (!ev) return { ok: false, error: 'BAD_EVENT' };

  // ENRICH AT THE SERVER: the baseline price comes from our own cache.
  const basePx = cachedPriceUSD(ev.coinId, priceStore ? { store: priceStore, now } : { now });
  if (basePx == null) return { ok: false, error: 'NO_PRICE' };

  const spec = HORIZON_SPEC[ev.horizon];
  const entry = {
    id: `${hashCoinId(ev.coinId)}|${ev.horizon}|${ev.clientTs}`,
    coinId: ev.coinId,
    c: hashCoinId(ev.coinId),
    h: ev.horizon,
    s: ev.predictedStance,
    p: ev.predictedConfidence,
    raw: ev.predictedRaw,
    g: ev.regime,
    w: ev.layersHash,
    ts: ev.clientTs,
    basePx,
    fireAt: now + spec.delayMs
  };

  return serialize(async () => {
    try {
      const manifest = await readPending(io);
      // Dedupe: one pending entry per (coin, horizon, day).
      const day = Math.floor(entry.ts / DAY_MS);
      const dupe = manifest.items.some(
        (x) => x.c === entry.c && x.h === entry.h && Math.floor(Number(x.ts) / DAY_MS) === day
      );
      if (dupe) return { ok: true, queued: 0, deduped: true };
      manifest.items.push(entry);
      // Hard cap: drop the OLDEST entries first — a flood cannot grow the blob.
      if (manifest.items.length > PENDING_CAP) {
        manifest.items.sort((a, b) => Number(a.fireAt) - Number(b.fireAt));
        manifest.items = manifest.items.slice(manifest.items.length - PENDING_CAP);
      }
      const stored = await writePending(manifest, io);
      return stored ? { ok: true, queued: 1 } : { ok: false, error: 'WRITE_FAILED' };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e).slice(0, 120) };
    }
  });
}

/* --------------------------------- sweep ---------------------------------- */

/**
 * Sweep due pending resolutions — called from the daily cron before the
 * trainer. For each entry with fireAt <= now:
 *   · price the coin from the CACHED market data;
 *   · hit  → append a finalized signal+resolution pair to buckets.ndjson;
 *   · miss → keep for up to PENDING_GRACE_MS past fireAt, then DROP.
 * Entries not yet due are kept untouched. Never throws.
 */
export async function sweepPending({ io = blobIo, now = Date.now(), priceStore, append = appendBuckets } = {}) {
  if (!io.configured()) return { swept: 0, resolved: 0, dropped: 0, pending: 0, skipped: 'NO_BLOB' };
  return serialize(async () => {
    try {
      const manifest = await readPending(io);
      const keep = [];
      const finalized = [];
      let dropped = 0;

      for (const entry of manifest.items) {
        const fireAt = Number(entry.fireAt) || 0;
        if (fireAt > now) {
          keep.push(entry);
          continue;
        }
        const basePx = Number(entry.basePx);
        const px = cachedPriceUSD(entry.coinId, priceStore ? { store: priceStore, now } : { now });
        if (px == null || !Number.isFinite(basePx) || basePx <= 0) {
          // Cache miss. Honest rule: never invent a return. Retry on the next
          // sweep inside the grace window, then drop the sample entirely.
          if (now - fireAt < PENDING_GRACE_MS) keep.push(entry);
          else dropped += 1;
          continue;
        }
        const pct = ((px - basePx) / basePx) * 100;
        const spec = HORIZON_SPEC[entry.h] ?? HORIZON_SPEC.short;
        finalized.push(
          // `raw` (the engine's raw score / trail proxy) rides along so the
          // advisor least-squares in trainV2 has its x-axis. Server-written —
          // never accepted from a client through validateSignal.
          { t: 's', c: entry.c, h: entry.h, s: entry.s, p: entry.p, g: entry.g, w: entry.w, ts: entry.ts, raw: entry.raw },
          { t: 'r', c: entry.c, h: entry.h, ts: entry.ts, r: { [spec.key]: bucketReturn(pct) } }
        );
      }

      if (finalized.length) await append(finalized);
      await writePending({ v: 1, items: keep }, io);
      return {
        swept: manifest.items.length - keep.length,
        resolved: finalized.length / 2,
        dropped,
        pending: keep.length
      };
    } catch (e) {
      return { swept: 0, resolved: 0, dropped: 0, pending: 0, error: String(e?.message ?? e).slice(0, 120) };
    }
  });
}

/** For diagnostics: how many callbacks are waiting. Cheap (one Blob read). */
export async function pendingCount(io = blobIo) {
  if (!io.configured()) return 0;
  const m = await readPending(io);
  return m.items.length;
}

export const _internals = { HORIZON_SPEC, recordToLine, learningConfigured };
