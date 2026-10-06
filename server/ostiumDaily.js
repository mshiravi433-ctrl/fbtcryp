/**
 * FBT — Ostium daily changes (the missing «۲۴ ساعته» of the tokenised markets).
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): the global console showed gold, the dollar, oil, bonds
 * and every stock-index as «خوانده نشد» even though the page had their PRICES.
 *
 * The cause was not a missing price. Ostium's `/v1/prices` answers with a
 * level only — no previous close, no 24h move — so every Ostium row carried
 * `change24hPct: null`, and a level on its own cannot say whether a market is
 * up or down. The same keyless builder API also serves daily candles
 * (`POST /v1/ohlc`, resolution `1D` — the request shape the futures adapter
 * already uses), and two daily closes are exactly what a change needs.
 *
 * HONESTY
 *   · the change is last-close vs previous-close of the venue's OWN daily
 *     candles: «today so far versus the previous session», labelled as such;
 *   · a pair that cannot be read stays null — never a carried or guessed move;
 *   · reads are cached per pair (30 min on success, 5 min on failure) and
 *     bounded by a deadline, so this can never lengthen a page load or turn a
 *     quiet pass into a request storm.
 *
 * This module reads; it never writes, never signs, never holds a key.
 */
import { fetchOstiumOhlc } from './ostium.js';

const DAY_S = 86_400;
const LOOKBACK_DAYS = 12;
const OK_TTL_MS = 30 * 60_000;
const FAIL_TTL_MS = 5 * 60_000;
const DEFAULT_DEADLINE_MS = 3_500;
const MAX_PAIRS_PER_CALL = 24;

const cache = new Map(); // pair → { value|null, at, ttl }
const inflight = new Map(); // pair → Promise

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

/** `data` rows → ascending [{ ts, close }]; `time` may be seconds or ms. */
export function parseOstiumCandles(body) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const out = [];
  for (const row of rows) {
    const t = num(row?.time ?? row?.timestamp ?? row?.t);
    const close = num(row?.close ?? row?.c);
    if (t === null || close === null || close <= 0) continue;
    out.push({ ts: t > 1e12 ? t : t * 1000, close });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** last close, previous close and the 1d / 7d percentage moves. */
export function changesFromCandles(candles) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  const target = last.ts - 7 * DAY_S * 1000;
  let ref = null;
  for (let i = rows.length - 2; i >= 0; i -= 1) {
    if (rows[i].ts <= target) { ref = rows[i]; break; }
  }
  return {
    close: last.close,
    prevClose: prev.close,
    change1dPct: round2(pct(last.close, prev.close)),
    change7dPct: ref ? round2(pct(last.close, ref.close)) : null,
    at: last.ts,
    points: rows.length
  };
}

const validPair = (pair) => /^[A-Z0-9]{1,12}-[A-Z0-9]{1,12}$/.test(String(pair || ''));

async function readOne(pair, now) {
  const hit = cache.get(pair);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  if (inflight.has(pair)) return inflight.get(pair);
  const job = (async () => {
    try {
      const to = Math.floor(now / 1000);
      const body = await fetchOstiumOhlc({
        pair,
        fromTimestampSeconds: to - LOOKBACK_DAYS * DAY_S,
        toTimestampSeconds: to,
        resolution: '1D'
      });
      const value = changesFromCandles(parseOstiumCandles(body));
      cache.set(pair, { value, at: Date.now(), ttl: value ? OK_TTL_MS : FAIL_TTL_MS });
      return value;
    } catch {
      cache.set(pair, { value: null, at: Date.now(), ttl: FAIL_TTL_MS });
      return null;
    } finally {
      inflight.delete(pair);
    }
  })();
  inflight.set(pair, job);
  return job;
}

/**
 * Daily changes for a set of Ostium pairs (`XAU-USD`, `US500-USD`, …).
 * Resolves with a Map of the pairs that were read inside the deadline; the
 * rest are simply absent. Never throws.
 */
export async function readOstiumDailyChanges(pairs, { deadlineMs = DEFAULT_DEADLINE_MS, now = Date.now() } = {}) {
  const wanted = [...new Set((pairs || []).map((p) => String(p || '').toUpperCase()).filter(validPair))].slice(0, MAX_PAIRS_PER_CALL);
  const out = new Map();
  if (!wanted.length) return out;
  const jobs = wanted.map(async (pair) => {
    const value = await readOne(pair, now);
    if (value) out.set(pair, value);
  });
  let timer = null;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(200, deadlineMs)); });
  try {
    await Promise.race([Promise.allSettled(jobs), deadline]);
  } finally {
    clearTimeout(timer);
  }
  /* A read that finished after the deadline still lands in the cache for the
     next pass; only what is in `out` right now is returned. */
  return new Map(out);
}

/** Test-only. */
export function _resetOstiumDailyForTests() {
  cache.clear();
  inflight.clear();
}

export default readOstiumDailyChanges;
