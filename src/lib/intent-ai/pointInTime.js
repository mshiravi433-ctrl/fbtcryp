/**
 * FBT INTENT OS — POINT-IN-TIME INTEGRITY
 * ---------------------------------------------------------------------------
 * Pattern from TradingAgents v0.4–0.5 (TauricResearch, Apache-2.0): when an
 * analysis is made "as of" a moment, no input may carry information from
 * after that moment. A model that has seen tomorrow's candle will always look
 * brilliant in a replay and useless live — the classic look-ahead leak.
 *
 * `pointInTimeView(context, asOf)` deep-walks any context object and drops:
 *   · array rows whose timestamp field is later than `asOf`
 *     (t, ts, time, timestamp, at, date, publishedAt, createdAt, updatedAt)
 *   · `[timestamp, value]` tuples later than `asOf` (CoinGecko chart shape)
 *   · scalar "live" fields that describe NOW, not asOf (price, change24h,
 *     volume24h, marketCap…) when the view is historical — they are replaced
 *     by the last in-window candle close when one exists, otherwise removed
 *
 * `assertPointInTime(context, asOf)` returns every leak it finds, so a test
 * (or a debug flag) can prove a context is clean instead of trusting it.
 *
 * Pure, synchronous, dependency-free: shared by the server and the browser.
 */

export const POINT_IN_TIME_SCHEMA = 'fbt.point-in-time.v1';

const TIME_KEYS = ['t', 'ts', 'time', 'timestamp', 'at', 'date', 'publishedAt', 'published_at', 'createdAt', 'updatedAt'];
/** Scalars that are "now" by definition and therefore unknowable at asOf. */
const LIVE_SCALARS = new Set([
  'price', 'priceUsd', 'current_price', 'currentPrice', 'change24h', 'price_change_percentage_24h',
  'volume24h', 'total_volume', 'marketCap', 'market_cap', 'high24h', 'low24h', 'lastUpdated', 'last_updated'
]);
const MAX_DEPTH = 8;

/** Parse ms / s / ISO timestamps into ms. Returns null when not a time. */
export function toMs(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    /* seconds (10 digits) vs milliseconds (13 digits) */
    return value < 1e11 ? value * 1000 : value;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const s = String(value).trim();
  if (/^\d{9,13}$/.test(s)) return toMs(Number(s));
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowTime(row) {
  if (Array.isArray(row)) {
    return row.length >= 2 && typeof row[0] === 'number' ? toMs(row[0]) : null;
  }
  if (row && typeof row === 'object') {
    for (const key of TIME_KEYS) {
      if (key in row) {
        const ms = toMs(row[key]);
        if (ms != null) return ms;
      }
    }
  }
  return null;
}

/** Last close at or before asOf from a candle/tuple array, else null. */
function lastCloseBefore(rows, asOfMs) {
  let best = null;
  let bestT = -Infinity;
  for (const row of rows) {
    const t = rowTime(row);
    if (t == null || t > asOfMs || t < bestT) continue;
    const close = Array.isArray(row)
      ? Number(row[row.length === 2 ? 1 : 4] ?? row[1])
      : Number(row.c ?? row.close ?? row.price ?? row.value);
    if (Number.isFinite(close)) { best = close; bestT = t; }
  }
  return best;
}

function walk(node, asOfMs, stats, depth, leaks, path, mutate) {
  if (depth > MAX_DEPTH || node == null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    const out = [];
    for (let i = 0; i < node.length; i += 1) {
      const row = node[i];
      const t = rowTime(row);
      if (t != null && t > asOfMs) {
        stats.droppedRows += 1;
        leaks.push({ path: `${path}[${i}]`, at: t, kind: 'row' });
        continue;
      }
      out.push(walk(row, asOfMs, stats, depth + 1, leaks, `${path}[${i}]`, mutate));
    }
    return mutate ? out : node;
  }

  const out = {};
  /* An object that itself carries a timestamp later than asOf is future
     information (a news item, a snapshot) — drop the whole object's live
     payload, keep only structure. */
  let seriesClose = null;
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) && value.length && rowTime(value[0]) != null) {
      const c = lastCloseBefore(value, asOfMs);
      if (c != null) seriesClose = c;
    }
  }
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    if (LIVE_SCALARS.has(key) && (typeof value === 'number' || typeof value === 'string')) {
      /* A "now" scalar is only allowed when the enclosing object is itself
         stamped at or before asOf (e.g. a candle {t, price}). */
      const stamped = rowTime(node);
      if (stamped != null && stamped <= asOfMs) { out[key] = value; continue; }
      stats.droppedLive += 1;
      leaks.push({ path: here, kind: 'live-scalar' });
      if ((key === 'price' || key === 'priceUsd' || key === 'current_price' || key === 'currentPrice') && seriesClose != null) {
        out[key] = seriesClose;
        stats.replacedWithClose += 1;
      }
      continue;
    }
    out[key] = walk(value, asOfMs, stats, depth + 1, leaks, here, mutate);
  }
  return mutate ? out : node;
}

/**
 * Historical view of `context` as it could have been known at `asOf`.
 * `asOf` omitted / invalid → the context is returned untouched with
 * `historical: false` (live analysis is not a replay).
 */
export function pointInTimeView(context = {}, asOf = null) {
  const asOfMs = toMs(asOf);
  if (asOfMs == null) {
    return { schema: POINT_IN_TIME_SCHEMA, historical: false, asOf: null, context, stats: { droppedRows: 0, droppedLive: 0, replacedWithClose: 0 } };
  }
  const stats = { droppedRows: 0, droppedLive: 0, replacedWithClose: 0 };
  const leaks = [];
  const clean = walk(context || {}, asOfMs, stats, 0, leaks, '', true);
  return {
    schema: POINT_IN_TIME_SCHEMA,
    historical: true,
    asOf: new Date(asOfMs).toISOString(),
    context: clean,
    stats
  };
}

/** Every look-ahead leak in `context` relative to `asOf` (empty = clean). */
export function assertPointInTime(context = {}, asOf = null) {
  const asOfMs = toMs(asOf);
  if (asOfMs == null) return [];
  const leaks = [];
  walk(context || {}, asOfMs, { droppedRows: 0, droppedLive: 0, replacedWithClose: 0 }, 0, leaks, '', false);
  return leaks;
}
