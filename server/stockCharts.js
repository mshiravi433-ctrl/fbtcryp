/** Seven-day TOKEN price history for the Robinhood stock-contract board.
 *
 * CoinGecko's /coins/markets sparkline carries real sampled token prices for
 * seven days. Resolve its id ONLY through the Robinhood contract index; a
 * symbol or a company's share chart is not a substitute for this history.
 * A missing/invalid series is null, never an invented line from a 24h change.
 */
import { getIndex } from './coinIndex.js';
import { chunk, normalizeAddresses } from './stockPrices.js';
import { fetchStockSparklines } from './providers.js';

const CHAIN_ID = 4663;
export const CHART_BATCH = 40;
const CHART_TTL_MS = 10 * 60_000;
const EMPTY_TTL_MS = 30_000;
const MAX_POINTS = 168;

const cache = new Map(); // CoinGecko id -> { points: number[] | null, at }
const inflight = new Map(); // a batch of ids -> promise

/** Only positive, finite observations; don't join across corrupt samples. */
export function readStockSparkline(row) {
  const raw = row?.sparkline_in_7d?.price;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const points = raw.slice(-MAX_POINTS).map((value) =>
    value == null || value === '' ? NaN : Number(value)
  );
  return points.length >= 3 && points.every((n) => Number.isFinite(n) && n > 0)
    ? points
    : null;
}

const fresh = (entry, now) => entry && now - entry.at < (entry.points ? CHART_TTL_MS : EMPTY_TTL_MS);

export function _resetStockChartCache() {
  cache.clear();
  inflight.clear();
}

/** All requested addresses appear, even if there is no chart for their token. */
export async function chartTokensByAddress(chainId, addresses, { now = Date.now() } = {}) {
  if (Number(chainId) !== CHAIN_ID) return { error: 'UNSUPPORTED_CHAIN' };
  const list = normalizeAddresses(addresses);
  if (!list.length) return { error: 'NO_ADDRESSES' };

  const { byChain } = await getIndex();
  const index = byChain.get(CHAIN_ID) ?? new Map();
  const ids = new Map(list.map((addr) => [addr, index.get(addr) ?? null]));
  const need = [...new Set(ids.values())].filter((id) => id && !fresh(cache.get(id), now));
  let upstreamError = false;

  for (const group of chunk(need, CHART_BATCH)) {
    const key = group.slice().sort().join(',');
    let job = inflight.get(key);
    if (!job) {
      job = fetchStockSparklines(group);
      inflight.set(key, job);
    }
    try {
      const rows = await job;
      if (!Array.isArray(rows)) throw new Error('BAD_SHAPE');
      // Trust the returned id, not the row order, name or ticker. Never accept
      // an unrequested id even if it has a plausible-looking series.
      const wanted = new Set(group);
      const byId = new Map(rows.filter((r) => wanted.has(r?.id)).map((r) => [r.id, r]));
      for (const id of group) cache.set(id, { points: readStockSparkline(byId.get(id)), at: now });
    } catch {
      upstreamError = true;
      // A failed feed must not return an expired line as though it were live.
      // It must also be retryable immediately, not negative-cached for 10 min.
    } finally {
      if (inflight.get(key) === job) inflight.delete(key);
    }
  }

  const charts = {};
  for (const [addr, id] of ids) {
    const entry = id ? cache.get(id) : null;
    charts[addr] = fresh(entry, now) ? entry.points : null;
  }
  return { chainId: CHAIN_ID, days: 7, charts, charted: Object.values(charts).filter(Boolean).length, upstreamError };
}
