/**
 * FBT STRATEGY BRAIN — ECOSYSTEM STATE (layer 2 of 4).
 * ---------------------------------------------------------------------------
 * The gap this file closes: the assistant could answer about ONE module at a
 * time (swap quote, best farm, portfolio snapshot) but never looked at the
 * whole ecosystem at once, so it could never decide BETWEEN modules. A
 * «۱۰ هزار دلار، ۱۵٪ در ۴ ماه، ریسک متوسط» answer needs twenty-one reads —
 * wallet, portfolio, crypto, RWA, stocks, forex, commodities, lending, farming,
 * liquidity, futures, dYdX, bridge, smart money, whales, news, macro, risk,
 * fees, gas, correlation — and needs them at the same moment, or the
 * comparison between them is a comparison between two different worlds.
 *
 * ─── HOST BUDGET (the app runs on a small host — this is a hard constraint) ─
 *   · bounded concurrency: at most `concurrency` reads in flight (default 4),
 *     never twenty-one sockets open at once;
 *   · per-domain timeout: a slow provider is reported as `timeout` and the
 *     plan is built without it, it does not hold the turn hostage;
 *   · TTL cache: the same domain is not re-fetched inside `cacheTtlMs`
 *     (default 45 s) — a user poking the strategy card twice costs one read;
 *   · row cap: each domain keeps at most `maxRows` rows (default 40); the
 *     strategy engine ranks, it does not need the whole universe;
 *   · no persistence: the cache is a bounded Map in this tab's memory and is
 *     dropped when the tab closes. Nothing is written to disk or to a server.
 *
 * ─── HONESTY ────────────────────────────────────────────────────────────────
 * Every domain reports its own `status`: live / empty / timeout / error /
 * skipped. A domain that answered with nothing is `empty`, NOT live, and the
 * coverage number the strategy shows is computed from these statuses — so
 * "I read 17 of 21 domains" is a fact about this turn, not a decoration.
 */

export const ECOSYSTEM_STATE_SCHEMA = 'fbt.strategy-ecosystem-state.v1';

/** The default host budget. Small on purpose; see the header. */
export const ECOSYSTEM_BUDGET = Object.freeze({
  concurrency: 4,
  timeoutMs: 6_000,
  cacheTtlMs: 45_000,
  maxRows: 40,
  /** A single strategy turn never reads more domains than this. */
  maxDomains: 24
});

/**
 * The twenty-one domains a cross-module decision needs, in the order a reader
 * would want them. `critical: true` means the strategy REFUSES to be built
 * without it — capital and the user's own positions are the two facts a plan
 * cannot be invented around. Everything else degrades honestly.
 */
export const ECOSYSTEM_DOMAINS = Object.freeze([
  { id: 'wallet', label: 'Wallet', group: 'position', critical: true },
  { id: 'portfolio', label: 'Portfolio', group: 'position', critical: true },
  { id: 'crypto', label: 'Crypto markets', group: 'markets' },
  { id: 'rwa', label: 'RWA / tokenised', group: 'markets' },
  { id: 'stocks', label: 'Stocks', group: 'markets' },
  { id: 'forex', label: 'Forex', group: 'markets' },
  { id: 'commodities', label: 'Commodities', group: 'markets' },
  { id: 'lending', label: 'Lending', group: 'yield' },
  { id: 'farming', label: 'Farming', group: 'yield' },
  { id: 'liquidity', label: 'Liquidity pools', group: 'yield' },
  { id: 'futures', label: 'Futures / perps', group: 'derivatives' },
  { id: 'dydx', label: 'dYdX', group: 'derivatives' },
  { id: 'bridge', label: 'Bridge routes', group: 'execution' },
  { id: 'smartMoney', label: 'Smart money', group: 'intelligence' },
  { id: 'whales', label: 'Whale activity', group: 'intelligence' },
  { id: 'news', label: 'News', group: 'intelligence' },
  { id: 'macro', label: 'Macro / regime', group: 'intelligence' },
  { id: 'risk', label: 'Risk', group: 'guardrails' },
  { id: 'fees', label: 'Fees', group: 'cost' },
  { id: 'gas', label: 'Gas', group: 'cost' },
  { id: 'correlation', label: 'Correlation', group: 'guardrails' }
]);

export const DOMAIN_IDS = Object.freeze(ECOSYSTEM_DOMAINS.map((d) => d.id));

const domainById = new Map(ECOSYSTEM_DOMAINS.map((d) => [d.id, d]));

const rowsOf = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.markets)) return value.markets;
  if (Array.isArray(value?.pools)) return value.pools;
  return null;
};

const rowCount = (value) => {
  const rows = rowsOf(value);
  return rows ? rows.length : (value && typeof value === 'object' ? 1 : 0);
};

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`TIMEOUT ${label}`), { code: 'TIMEOUT' })), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * A tiny bounded pool. `concurrency` workers pull from a shared index, so the
 * number of in-flight reads never exceeds the budget no matter how many
 * domains are requested.
 */
async function runBounded(items, worker, concurrency) {
  const out = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

/**
 * Create a reader bound to a set of domain readers.
 *
 * @param {object} opts
 * @param {Record<string,Function>} opts.readers  domainId → async () => data
 * @param {number} [opts.concurrency]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.cacheTtlMs]
 * @param {number} [opts.maxRows]
 * @param {Function} [opts.now]
 */
export function createEcosystemReader({
  readers = {},
  concurrency = ECOSYSTEM_BUDGET.concurrency,
  timeoutMs = ECOSYSTEM_BUDGET.timeoutMs,
  cacheTtlMs = ECOSYSTEM_BUDGET.cacheTtlMs,
  maxRows = ECOSYSTEM_BUDGET.maxRows,
  now = () => Date.now()
} = {}) {
  /** domainId → { at, result } — bounded by the domain list, never grows. */
  const cache = new Map();
  let inflight = 0;
  let peakInflight = 0;

  async function readDomain(domain, { force = false } = {}) {
    const meta = domainById.get(domain) || { id: domain, label: domain, group: 'other' };
    const cached = cache.get(meta.id);
    if (!force && cached && now() - cached.at < cacheTtlMs) {
      return { ...cached.result, cached: true };
    }
    const reader = readers[meta.id];
    if (typeof reader !== 'function') {
      const result = { domain: meta.id, label: meta.label, group: meta.group, status: 'skipped', data: null, rowCount: 0, tookMs: 0, reason: 'NO_READER_BOUND' };
      cache.set(meta.id, { at: now(), result });
      return result;
    }
    const started = now();
    inflight += 1;
    peakInflight = Math.max(peakInflight, inflight);
    try {
      const value = await withTimeout(reader(), timeoutMs, meta.id);
      const rows = rowsOf(value);
      const trimmed = rows ? (rows.length > maxRows ? { ...(typeof value === 'object' && !Array.isArray(value) ? value : {}), rows: rows.slice(0, maxRows), truncated: true } : value) : value;
      const status = rowCount(trimmed) > 0 ? 'live' : 'empty';
      const result = {
        domain: meta.id,
        label: meta.label,
        group: meta.group,
        status,
        data: trimmed,
        rowCount: rowCount(trimmed),
        tookMs: now() - started,
        reason: status === 'empty' ? (value?.reason || 'NO_ROWS') : null,
        fetchedAt: now()
      };
      cache.set(meta.id, { at: result.fetchedAt, result });
      return result;
    } catch (err) {
      const isTimeout = err?.code === 'TIMEOUT';
      const result = {
        domain: meta.id,
        label: meta.label,
        group: meta.group,
        status: isTimeout ? 'timeout' : 'error',
        data: null,
        rowCount: 0,
        tookMs: now() - started,
        reason: String(err?.message || err).slice(0, 140),
        fetchedAt: now()
      };
      /* A failure is cached too — briefly — so a dead provider is not
         hammered once per card render. */
      cache.set(meta.id, { at: result.fetchedAt, result });
      return result;
    } finally {
      inflight -= 1;
    }
  }

  /**
   * Read every domain (or a subset) under the host budget.
   * @param {{only?:string[], force?:boolean}} [opts]
   */
  async function read({ only = null, force = false } = {}) {
    const wanted = (only && only.length ? only : DOMAIN_IDS)
      .filter((id) => domainById.has(id) || readers[id])
      .slice(0, ECOSYSTEM_BUDGET.maxDomains);
    const started = now();
    const results = await runBounded(wanted, (id) => readDomain(id, { force }), concurrency);
    const domains = Object.fromEntries(results.map((r) => [r.domain, r]));
    return summarise({ domains, startedAt: started, requested: wanted });
  }

  function clearCache() { cache.clear(); }
  function cacheSize() { return cache.size; }
  function peakConcurrency() { return peakInflight; }

  return { read, readDomain, clearCache, cacheSize, peakConcurrency, budget: { concurrency, timeoutMs, cacheTtlMs, maxRows } };
}

/** Coverage + gaps, computed from the statuses above. */
export function summarise({ domains = {}, startedAt = null, requested = [] } = {}) {
  const rows = Object.values(domains);
  const live = rows.filter((r) => r.status === 'live');
  const empty = rows.filter((r) => r.status === 'empty');
  const failed = rows.filter((r) => r.status === 'timeout' || r.status === 'error');
  const skipped = rows.filter((r) => r.status === 'skipped');
  const missingCritical = ECOSYSTEM_DOMAINS
    .filter((d) => d.critical)
    .filter((d) => domains[d.id]?.status !== 'live')
    .map((d) => d.id);

  const usable = live.length + empty.length; /* a domain that answered is not a gap in coverage */
  return {
    schema: ECOSYSTEM_STATE_SCHEMA,
    domains,
    requested: requested.length ? requested : rows.map((r) => r.domain),
    coverage: {
      requested: rows.length,
      live: live.length,
      empty: empty.length,
      failed: failed.length,
      skipped: skipped.length,
      /** Fraction of requested domains that actually answered. */
      pct: rows.length ? Math.round((usable / rows.length) * 100) : 0
    },
    liveDomains: live.map((r) => r.domain),
    gaps: [
      ...failed.map((r) => ({ domain: r.domain, reason: r.reason, kind: r.status })),
      ...skipped.map((r) => ({ domain: r.domain, reason: r.reason || 'NO_READER_BOUND', kind: 'skipped' }))
    ],
    emptyDomains: empty.map((r) => r.domain),
    missingCritical,
    ok: missingCritical.length === 0 && live.length > 0,
    slowestMs: rows.reduce((max, r) => Math.max(max, r.tookMs || 0), 0),
    readAt: startedAt ?? Date.now()
  };
}

/** Convenience for the strategy engine: the data of one domain, or null. */
export function domainData(state, id) {
  const entry = state?.domains?.[id];
  return entry && entry.status === 'live' ? entry.data : null;
}

/** Was this domain read live this turn? */
export function isLive(state, id) {
  return state?.domains?.[id]?.status === 'live';
}
