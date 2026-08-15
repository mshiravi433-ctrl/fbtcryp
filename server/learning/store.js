/**
 * LEARNING CORE — Blob persistence.
 * ---------------------------------------------------------------------------
 * Vercel Blob is the only durable store in the loop (the requirement: no new
 * KV/Redis/DB, zero extra spend). The API surface is intentionally tiny:
 *
 *   read/write/delete by key, list by prefix, the manifest, and the append
 *   path for buckets.ndjson.
 *
 * APPEND WITHOUT AN APPEND API:
 *   Vercel Blob has no append mode, so appending means read → append → put.
 *   To keep that honest for a serverless workload:
 *     · appends are COALESCED in memory — a burst of telemetry submissions
 *       arriving on the same warm instance is written back as ONE read/write;
 *     · the write is serialized per instance (a promise chain), so concurrent
 *       requests cannot interleave into a corrupted file;
 *     · a failed write is retried once, then dropped with a warning. A lost
 *       anonymous outcome is acceptable; a slow telemetry endpoint is not.
 *
 *   The roll (buckets.ndjson → buckets-YYYYMMDD.ndjson at 100K records) also
 *   happens here, checked at append time and re-checked authoritatively
 *   inside the daily training.
 *
 * IO INJECTION: every function takes an optional `io` (defaults to the real
 * Blob adapter) so the training math can be exercised end-to-end in tests
 * against an in-memory fake. The fake only needs five methods:
 *   read(key) → text|null · write(key,text) → bool · list(prefix) → keys[]
 *   del(key) → bool · configured() → bool
 *
 * All failures degrade silently, mirroring server/blobCache.js: the learning
 * loop must never be able to break the app.
 */

import { BUCKET_PRUNE_DAYS, PRUNE_DAYS, ROLL_LIMIT, WINDOW_DAYS } from './schema.js';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'learning/';

export const learningConfigured = () => Boolean(TOKEN);

let blobApi = null;

async function api() {
  if (!TOKEN) return null;
  if (!blobApi) {
    try {
      blobApi = await import('@vercel/blob');
    } catch {
      return null;
    }
  }
  return blobApi;
}

/* ------------------------- low-level read/write -------------------------- */

export async function blobReadText(key) {
  const mod = await api();
  if (!mod) return null;
  try {
    const meta = await mod.head(key, { token: TOKEN }).catch(() => null);
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function blobWriteText(key, text, { allowOverwrite = true } = {}) {
  const mod = await api();
  if (!mod) return false;
  try {
    await mod.put(key, text, {
      token: TOKEN,
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite,
      cacheControlMaxAge: 31536000 // files are immutable by design
    });
    return true;
  } catch (e) {
    console.warn('[learning] write failed:', e?.message);
    return false;
  }
}

export async function blobDelete(key) {
  const mod = await api();
  if (!mod) return false;
  try {
    await mod.del(key, { token: TOKEN });
    return true;
  } catch (e) {
    console.warn('[learning] delete failed:', e?.message);
    return false;
  }
}

/** List keys under a prefix (e.g. 'learning/buckets-'). */
export async function listKeys(prefix) {
  const mod = await api();
  if (!mod) return [];
  try {
    const out = await mod.list({ prefix, token: TOKEN, limit: 1000 });
    return (out?.blobs ?? []).map((b) => b.pathname);
  } catch {
    return [];
  }
}

/** The real adapter — swap in a fake for tests. */
export const blobIo = {
  read: blobReadText,
  write: (k, text) => blobWriteText(k, text),
  list: listKeys,
  del: blobDelete,
  configured: learningConfigured
};

/* ------------------------------- manifest -------------------------------- */

export const MANIFEST_KEY = 'learning/manifest.json';

export async function readManifest(io = blobIo) {
  const text = await io.read(MANIFEST_KEY);
  if (!text) return null;
  try {
    const m = JSON.parse(text);
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

export async function writeManifest(manifest, io = blobIo) {
  return io.write(MANIFEST_KEY, JSON.stringify(manifest, null, 2) + '\n');
}

/* ------------------------------ buckets file ----------------------------- */

export const BUCKETS_KEY = 'learning/buckets.ndjson';

export const yyyymmdd = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
};

export const yyyyMmDd = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

const datedBucketKey = (d = new Date()) => `${PREFIX}buckets-${yyyymmdd(d)}.ndjson`;

/** Coalescing append queue. See the header comment for the why. */
let pending = [];
let writeChain = Promise.resolve();

async function writeAppend(batch) {
  const current = (await blobReadText(BUCKETS_KEY)) ?? '';
  const existingLines = current ? current.split('\n').filter(Boolean).length : 0;
  const newLines = batch.map((rec) => JSON.stringify(rec)).join('\n') + '\n';

  if (existingLines + batch.length >= ROLL_LIMIT) {
    // Roll: archive everything seen so far, start a fresh file with this batch.
    await blobWriteText(datedBucketKey(), current, { allowOverwrite: true });
    await blobWriteText(BUCKETS_KEY, newLines);
    return { rolled: true };
  }
  await blobWriteText(BUCKETS_KEY, current + newLines);
  return { rolled: false };
}

async function flushOnce() {
  const batch = pending.splice(0, pending.length);
  if (!batch.length) return { stored: true, batch: 0, rolled: false };
  try {
    const out = await writeAppend(batch);
    return { stored: true, batch: batch.length, ...out };
  } catch (e) {
    // One retry, then give up silently — telemetry must never fail a request.
    console.warn('[learning] append failed, retrying once:', e?.message);
    try {
      const out = await writeAppend(batch);
      return { stored: true, batch: batch.length, ...out };
    } catch (err) {
      console.warn('[learning] append failed twice; dropping batch:', err?.message);
      return { stored: false, batch: batch.length, rolled: false };
    }
  }
}

/**
 * Append validated records to buckets.ndjson. Fire-and-forget friendly: it
 * never throws. Returns { stored, batch, rolled }.
 */
export function appendBuckets(records) {
  if (!learningConfigured() || !records?.length) {
    return Promise.resolve({ stored: false, batch: records?.length ?? 0, rolled: false });
  }
  pending.push(...records);
  const run = writeChain.then(flushOnce);
  writeChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/**
 * Read the rolling window: buckets.ndjson plus dated rolls from the last
 * `days` days. Returns raw lines (the trainer parses them).
 */
export async function readBucketsWindow(days = WINDOW_DAYS, now = new Date(), io = blobIo) {
  const lines = [];
  const current = await io.read(BUCKETS_KEY);
  if (current) lines.push(...current.split('\n').filter(Boolean));

  const cutoff = now.getTime() - days * 24 * 3600 * 1000;
  const keys = await io.list(`${PREFIX}buckets-`);
  const wanted = keys
    .filter((k) => /buckets-\d{8}\.ndjson$/.test(k))
    .sort()
    .reverse();
  for (const key of wanted) {
    const m = /buckets-(\d{8})\.ndjson$/.exec(key);
    if (!m) continue;
    const t = Date.UTC(
      Number(m[1].slice(0, 4)),
      Number(m[1].slice(4, 6)) - 1,
      Number(m[1].slice(6, 8))
    );
    if (t < cutoff) continue;
    const text = await io.read(key);
    if (text) lines.push(...text.split('\n').filter(Boolean));
  }
  return lines;
}

/**
 * Authoritative roll + prune pass, run inside the daily training:
 *  - archives buckets.ndjson to a dated file when it has ≥ ROLL_LIMIT lines;
 *  - deletes dated bucket files outside the (window + margin) horizon.
 */
export async function rollAndPruneBuckets(now = new Date(), io = blobIo) {
  let rolled = false;
  const current = await io.read(BUCKETS_KEY);
  if (current) {
    const n = current.split('\n').filter(Boolean).length;
    if (n >= ROLL_LIMIT) {
      await io.write(datedBucketKey(now), current);
      await io.write(BUCKETS_KEY, '');
      rolled = true;
    }
  }
  const cutoff = now.getTime() - BUCKET_PRUNE_DAYS * 24 * 3600 * 1000;
  const keys = await io.list(`${PREFIX}buckets-`);
  for (const key of keys) {
    const m = /buckets-(\d{8})\.ndjson$/.exec(key);
    if (!m) continue;
    const t = Date.UTC(
      Number(m[1].slice(0, 4)),
      Number(m[1].slice(4, 6)) - 1,
      Number(m[1].slice(6, 8))
    );
    if (t < cutoff) await io.del(key);
  }
  return { rolled };
}

/* -------------------------------- params -------------------------------- */

export const paramsKeyFor = (d = new Date()) => `${PREFIX}params-${yyyyMmDd(d)}.json`;

export async function readParamsFile(key, io = blobIo) {
  const text = await io.read(key);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writeParamsFile(key, params, io = blobIo) {
  return io.write(key, JSON.stringify(params, null, 2) + '\n');
}

/** Keys of all published params files, newest first. */
export async function listParamsKeys(io = blobIo) {
  const keys = await io.list(`${PREFIX}params-`);
  return keys.filter((k) => /params-\d{4}-\d{2}-\d{2}\.json$/.test(k)).sort().reverse();
}

/** Delete published params files older than `days` days. Returns count. */
export async function pruneParams(days = PRUNE_DAYS, now = new Date(), io = blobIo) {
  const cutoff = now.getTime() - days * 24 * 3600 * 1000;
  let removed = 0;
  for (const key of await listParamsKeys(io)) {
    const m = /params-(\d{4})-(\d{2})-(\d{2})\.json$/.exec(key);
    if (!m) continue;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (t < cutoff) {
      if (await io.del(key)) removed += 1;
    }
  }
  return removed;
}
