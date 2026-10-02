/**
 * CLIENT ACCESS TO THE CAPITAL-FLOW / REPORTED-PROFIT READ.
 * ---------------------------------------------------------------------------
 * One endpoint (`GET /api/insights/flows`) answers the three cards on the
 * News → هوشمندی tab that used to be permanent gaps, plus the fallback the
 * News → هوش جهانی leaders use:
 *
 *   tokenFlows     CoinGecko `market_cap_change_24h` — which asset attracted
 *                  the most capital in 24h, and which lost the most
 *   chainFlows     DefiLlama stablecoin supply deltas — real money entering or
 *                  leaving each chain (mint = arrival, burn = departure)
 *   profitLeaders  SEC EDGAR XBRL frames — reported, audited quarterly net
 *                  income, with the filing each number came from
 *
 * ─── WHY THIS IS A MODULE AND NOT A fetch() IN THE COMPONENT ────────────────
 * Two surfaces read it (the insights panel and the global-intelligence
 * leaders), the payload is a few hundred kilobytes of upstream aggregation,
 * and the phone is on a metered connection. One cached, single-flighted read
 * per five minutes beats two panels racing for the same numbers.
 *
 * ─── NO OFFLINE FALLBACK, DELIBERATELY ──────────────────────────────────────
 * Like `solanaAssetsClient.js`: a flow number that is quietly invented is
 * worse than an honest gap, because it looks like evidence. When the backend
 * cannot be reached this returns `ok:false` with a reason, and the cards keep
 * showing exactly what they showed before — «no verified source» — instead of
 * a plausible number.
 */

import { apiBase } from './apiBase.js';

export const FLOW_SCHEMA = 'fbt.capital-flows.v1';

const TIMEOUT_MS = 20_000;
/** The server caches this for 15 minutes; the client re-asks every 5 so a
 *  pull-to-refresh can still surface a newer server read. */
const CACHE_TTL_MS = 5 * 60_000;

let cache = null; // { value, at }
let inflight = null;

const section = (raw, fallbackReason) => (
  raw && typeof raw === 'object' && raw.status === 'OK'
    ? raw
    : { status: 'UNAVAILABLE', reason: String(raw?.reason || fallbackReason).slice(0, 64) }
);

function normalize(body, { stale = false } = {}) {
  return {
    ok: body?.ok !== false && (
      body?.tokenFlows?.status === 'OK'
      || body?.chainFlows?.status === 'OK'
      || body?.profitLeaders?.status === 'OK'
    ),
    schema: String(body?.schema || FLOW_SCHEMA),
    at: Number(body?.at) || 0,
    stale: stale === true || body?.stale === true,
    cached: body?.cached === true,
    tokenFlows: section(body?.tokenFlows, 'TOKEN_FLOW_SOURCE_UNAVAILABLE'),
    chainFlows: section(body?.chainFlows, 'CHAIN_FLOW_SOURCE_UNAVAILABLE'),
    profitLeaders: section(body?.profitLeaders, 'PROFIT_SOURCE_UNAVAILABLE'),
    readOnly: true,
    executes: false,
    error: body?.error || null
  };
}

const EMPTY = Object.freeze(normalize(null));

/**
 * Read the flows payload. `force:true` bypasses the client cache (pull to
 * refresh) but still shares one in-flight request between callers.
 */
export async function getCapitalFlows({ force = false, timeout = TIMEOUT_MS } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  inflight = (async () => {
    try {
      const res = await fetch(`${apiBase()}/insights/flows`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
        cache: 'default'
      });
      const body = await res.json().catch(() => null);
      if (!body) {
        /* A 503 with our own schema is still an answer: it names the sections
           that are dark. Anything else (proxy error page, empty body) is not. */
        return { ...EMPTY, ok: false, error: res.ok ? 'EMPTY_RESPONSE' : `HTTP_${res.status}` };
      }
      const value = normalize(body, { stale: res.headers?.get?.('x-data-stale') === '1' });
      cache = { value, at: Date.now() };
      return value;
    } catch (err) {
      return { ...EMPTY, ok: false, error: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE' };
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();

  return inflight;
}

/** Test-only: drop the client cache and any in-flight read. */
export function _resetCapitalFlowsForTests() {
  cache = null;
  inflight = null;
}

export { EMPTY as EMPTY_CAPITAL_FLOWS };
export default getCapitalFlows;
