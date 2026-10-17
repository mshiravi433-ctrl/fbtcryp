/** Real seven-day TOKEN sparklines for the Robinhood Chain board.
 *
 * The server binds CoinGecko ids to exact chain + contract addresses, batches
 * the market read, and returns null for a token without history. No symbol
 * search, no share-reference chart, no synthetic path between two quotes.
 */
import { apiBase } from './apiBase.js';
import { addressesOf } from './stockPrices.js';

const TTL_MS = 10 * 60_000;
const EMPTY_TTL_MS = 30_000;
const BATCH_SIZE = 40;
const MAX_PARALLEL = 2;
const MAX_POINTS = 168;
const memo = new Map(); // chain:address -> { points: number[] | null, at }
const inflight = new Map();
const keyOf = (cid, addr) => `${cid}:${addr}`;

/** Reject corrupt/too-short history rather than drawing a misleading line. */
export function readStockChart(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const points = raw.slice(-MAX_POINTS);
  return points.every((p) => typeof p === 'number' && Number.isFinite(p) && p > 0)
    ? points
    : null;
}

async function fetchBatch(chainId, addresses) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `${apiBase()}/stock-charts?chainId=${chainId}&addresses=${addresses.join(',')}`,
      { signal: ctrl.signal, headers: { accept: 'application/json' } }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    for (const addr of addresses) {
      const raw = data?.charts?.[addr];
      const points = readStockChart(raw);
      if (points) out[addr] = points;
    }
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** Returns only real charts, keyed by lower-case contract. Missing is omitted. */
export async function loadStockTokenCharts(tokens, { chainId = 4663 } = {}) {
  const cid = Number(chainId);
  if (cid !== 4663) return {};
  const addresses = addressesOf(tokens);
  const out = {};
  const need = [];
  const now = Date.now();
  for (const addr of addresses) {
    const hit = memo.get(keyOf(cid, addr));
    if (hit && now - hit.at < (hit.points ? TTL_MS : EMPTY_TTL_MS)) {
      if (hit.points) out[addr] = hit.points;
    } else {
      need.push(addr);
    }
  }
  const batches = [];
  for (let i = 0; i < need.length; i += BATCH_SIZE) batches.push(need.slice(i, i + BATCH_SIZE));
  const workers = [];
  for (let worker = 0; worker < Math.min(MAX_PARALLEL, batches.length); worker += 1) {
    workers.push((async () => {
      for (let i = worker; i < batches.length; i += MAX_PARALLEL) {
        const group = batches[i];
        const key = `${cid}:${group.join(',')}`;
        let job = inflight.get(key);
        if (!job) {
          job = fetchBatch(cid, group);
          inflight.set(key, job);
        }
        let found = {};
        try { found = await job; } finally { if (inflight.get(key) === job) inflight.delete(key); }
        const at = Date.now();
        for (const addr of group) {
          const points = found[addr] ?? null;
          memo.set(keyOf(cid, addr), { points, at });
          if (points) out[addr] = points;
        }
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

export function clearStockTokenCharts() {
  memo.clear();
  inflight.clear();
}
