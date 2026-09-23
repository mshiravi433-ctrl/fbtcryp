/**
 * SOLANA RPC RELAY — a READ-ONLY JSON-RPC relay on our own origin.
 * ============================================================================
 *
 * WHY THIS EXISTS (report 2026-09-23: «RPC سولانا یا بازار Kamino خوانده نشد»)
 * ---------------------------------------------------------------------------
 * The loan page reads Kamino KLend straight from the browser, so it lives or
 * dies on a public Solana node answering a web page. On the reported network
 * path every candidate answered, and every answer was a refusal:
 *
 *   solana-rpc.publicnode.com  → HTTP 403
 *   api.mainnet-beta.solana.com→ HTTP 403  («Your IP or provider is blocked»)
 *   solana.drpc.org            → HTTP 200 with a body the SDK could not use
 *   solana.api.onfinality.io   → HTTP 429
 *
 * That is not a bug in the client and retrying cannot fix it: 401/403/451 are
 * a decision about WHO IS ASKING, made from the caller's IP, its provider and
 * its region. A phone on an Iranian mobile network and a serverless function
 * in a datacentre are two different callers, and the second one is served.
 *
 * So the app relays. The browser talks to OUR origin — the one origin it has
 * already proven it can reach, because it loaded the page from it — and this
 * module makes the upstream call. It is the same shape as the Jupiter proxy in
 * server/solana.js: the client cannot hold a key and cannot choose its own
 * network path, so the server owns that hop.
 *
 * WHAT IT IS NOT
 *   · NOT an open proxy. There is no `url` parameter. The upstream list lives
 *     here and in the environment; a caller can pick a METHOD, never a host.
 *   · NOT a signer or a broadcaster. `sendTransaction` is not in the allowlist
 *     and never will be: the wallet signs AND broadcasts its own transaction
 *     (§30 — the backend cannot move a user's funds). Reads only.
 *   · NOT a cache in front of stale data. Anything that feeds a signature
 *     (`getLatestBlockhash`, `isBlockhashValid`, `getSignatureStatuses`) is
 *     never cached; only the market-shaped reads are, for a couple of seconds.
 *
 * WHY THE CACHE IS HERE AND NOT OPTIONAL
 * The Kamino market account is GLOBAL: every user reads the same bytes. Free
 * upstreams are metered in single-digit requests per second, so without a
 * short shared cache a busy minute would spend the whole app's upstream budget
 * on identical answers — and the relay would become the outage it exists to
 * prevent. Two-and-a-half seconds of sharing costs a user nothing they could
 * see (the loan page's own poll is 30s) and collapses N users into one call.
 *
 * WHY FAILURES ARE RETURNED WITH THE UPSTREAM'S OWN HTTP STATUS
 * The client classifies a node's refusal STATUS-FIRST (src/lib/solanaRpc.js,
 * `classifyNodeFailure`): 429 → «throttled, retry», 401/403/451 → «refused,
 * another node will not help». Those two have different remedies and the page
 * has a translated sentence for each. Dressing a 403 up as our own 502 would
 * turn a precise, actionable answer back into «the server failed», which is the
 * exact defect PR #398 removed. So when every upstream refused, the refusal is
 * forwarded with its own status and the per-upstream detail in the body.
 */

/* ── configuration ────────────────────────────────────────────────────────── */

/**
 * Every tunable is read AT CALL TIME, not frozen at import.
 *
 * server/solana.js already sets the convention (`apiKey()` and `feeBps()` are
 * functions for the same reason): a value read once at module load is a value
 * that cannot be changed by anything that loads the module first, and it makes a
 * limit impossible to exercise in a test without re-importing the world. These
 * are knobs an operator turns and a suite must be able to prove.
 */
const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Per-upstream ceiling. A node that has not answered in this long has not. */
const upstreamTimeoutMs = () => num('SOLANA_RELAY_TIMEOUT_MS', 12_000);

/** Heavy reads (getProgramAccounts, parsed token accounts) get more room. */
const heavyTimeoutMs = () => num('SOLANA_RELAY_HEAVY_TIMEOUT_MS', 20_000);

/** Vercel's serverless response ceiling is 4.5 MB; we stay under it and say
    so, rather than letting the platform truncate a body mid-JSON. */
const maxResponseBytes = () => num('SOLANA_RELAY_MAX_RESPONSE_BYTES', 4_000_000);

/** Relay is on unless it is explicitly switched off. */
export const relayEnabled = () =>
  String(process.env.SOLANA_RELAY_ENABLED ?? 'true').toLowerCase() !== 'false';

/**
 * Keyless public upstreams, in the order a SERVER should try them.
 *
 * This order is NOT the browser's order (src/lib/solanaRpc.js) and the
 * difference is the whole point: measured from deployed workers, the hosts
 * that answer a datacentre and the hosts that answer a residential browser are
 * not the same list, and several of these refuse specific METHODS rather than
 * callers — `solana-rpc.publicnode.com` serves getBalance and answers
 * `getTokenAccountsByOwner` with -32602 «Request blocked». That is why the
 * refusal memory below is per host AND per method.
 */
const DEFAULT_UPSTREAMS = Object.freeze({
  'mainnet-beta': Object.freeze([
    'https://rpc.ankr.com/solana',
    'https://solana.public-rpc.com',
    'https://rpc.solanatracker.io/public',
    'https://solana-rpc.publicnode.com',
    'https://rpc.magicblock.app/mainnet',
    'https://solana.drpc.org',
    'https://solana.api.onfinality.io/public',
    'https://api.mainnet-beta.solana.com',
    'https://api.mainnet.solana.com'
  ]),
  devnet: Object.freeze([
    'https://api.devnet.solana.com',
    'https://solana-devnet-rpc.publicnode.com',
    'https://solana-devnet.drpc.org'
  ]),
  testnet: Object.freeze([
    'https://api.testnet.solana.com',
    'https://solana-testnet-rpc.publicnode.com'
  ])
});

/**
 * Upstreams for one cluster, credentials redacted for anything we return.
 *
 * `SOLANA_RPC_URL` (the app's own paid/dedicated node, already used by
 * server/futures/adapters/drift.js) goes FIRST when set: a node we pay for is
 * the one that should answer. `SOLANA_RELAY_UPSTREAMS` replaces the public
 * list for mainnet without a code change.
 */
export function relayUpstreams(cluster = 'mainnet-beta') {
  const key = normalizeCluster(cluster);
  const fromEnv = String(process.env.SOLANA_RELAY_UPSTREAMS || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^https:\/\//i.test(u));
  const list = key === 'mainnet-beta' && fromEnv.length ? fromEnv : (DEFAULT_UPSTREAMS[key] || DEFAULT_UPSTREAMS['mainnet-beta']);
  const own = String(process.env.SOLANA_RPC_URL || '').trim();
  const ordered = /^https:\/\//i.test(own) && key === 'mainnet-beta' ? [own, ...list] : [...list];
  return [...new Set(ordered)];
}

/** A URL with its query string removed — an API key must never leave here. */
export const redactUpstream = (url) => {
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return String(url || '').replace(/\?.*$/, '');
  }
};

const normalizeCluster = (value) => {
  const v = String(value || '').toLowerCase();
  if (v === 'devnet') return 'devnet';
  if (v === 'testnet') return 'testnet';
  return 'mainnet-beta';
};

/* ── the method allowlist ─────────────────────────────────────────────────── */

/**
 * Every method this relay will forward, with what it costs us.
 *
 *   weight   — the price of one call against the per-IP budget. A
 *              getProgramAccounts is not a getBalance, and charging them the
 *              same is how a relay gets throttled by its own upstreams.
 *   cacheMs  — how long an IDENTICAL answer may be shared between callers.
 *              0 means never: anything that feeds a signature, a broadcast or
 *              a confirmation must be fresh, because a cached blockhash is a
 *              rejected transaction and a cached signature status is a lie
 *              about somebody's money.
 *   heavy    — counted against a second, tighter budget and given more time.
 *
 * What is deliberately ABSENT: `sendTransaction` (the wallet broadcasts; §30),
 * `requestAirdrop`, `getBlock`/`getBlocks` (megabytes per call), `getSupply`
 * and `getClusterNodes` (whole-network scans with no reader in this app).
 */
export const RELAY_METHODS = Object.freeze({
  /* cluster + slot health */
  getHealth: { weight: 1, cacheMs: 4_000 },
  getVersion: { weight: 1, cacheMs: 30_000 },
  getGenesisHash: { weight: 1, cacheMs: 3_600_000 },
  getSlot: { weight: 1, cacheMs: 800 },
  getBlockHeight: { weight: 1, cacheMs: 800 },
  getBlockTime: { weight: 1, cacheMs: 30_000 },
  getEpochInfo: { weight: 1, cacheMs: 5_000 },
  getEpochSchedule: { weight: 1, cacheMs: 3_600_000 },
  getFirstAvailableBlock: { weight: 1, cacheMs: 120_000 },
  getInflationGovernor: { weight: 1, cacheMs: 3_600_000 },

  /* signing inputs — never cached */
  getLatestBlockhash: { weight: 2, cacheMs: 0 },
  isBlockhashValid: { weight: 1, cacheMs: 0 },
  getFeeForMessage: { weight: 2, cacheMs: 0 },
  getRecentPrioritizationFees: { weight: 3, cacheMs: 1_500 },
  getPriorityFeeEstimate: { weight: 3, cacheMs: 1_500 },
  simulateTransaction: { weight: 6, cacheMs: 0, heavy: true },

  /* account reads — the Kamino market load lives here */
  getBalance: { weight: 1, cacheMs: 1_500 },
  getAccountInfo: { weight: 2, cacheMs: 2_500 },
  /* THE RESERVE AND OBLIGATION BATCH — and the method this relay used to be
     missing (2026-09-23, second report: «رلهٔ خود برنامه — آن گره پاسخ داد، ولی
     پاسخی که نتوانستیم استفاده کنیم»).
     `KaminoMarket.load()` reads the market account first (getAccountInfo, which
     this relay served) and then loads the reserves with
     `connection.getMultipleAccountsInfo(...)` — klend-sdk
     dist/classes/market.js:239, and `getObligationsByReserve` at :468. That
     web3.js call puts `getMultipleAccounts` on the wire. The allowlist below
     used to carry `getMultipleAccountsInfo` — the JS name of the same call, a
     method no Solana node has ever served — so the relay answered the SDK with
     `-32601 … is not relayed`, the market stayed unread, and the page — rightly
     — refused to send any transaction. A relay that serves the first call of a
     read path and refuses the second is worse than no relay: it looks like a
     node failure, so the client reports «the node answered, but we could not use
     the response» and the user is told to go configure an RPC.
     The wire name is what is relayed; the JS name is resolved by
     RELAY_METHOD_ALIASES below, so a caller using either one is served. */
  getMultipleAccounts: { weight: 3, cacheMs: 2_500 },
  getMinimumBalanceForRentExemption: { weight: 1, cacheMs: 300_000 },
  getProgramAccounts: { weight: 8, cacheMs: 2_500, heavy: true },

  /* token reads */
  getTokenAccountBalance: { weight: 2, cacheMs: 1_500 },
  getTokenAccountsByOwner: { weight: 5, cacheMs: 2_000, heavy: true },
  getTokenAccountsByDelegate: { weight: 5, cacheMs: 2_000, heavy: true },
  getTokenSupply: { weight: 2, cacheMs: 5_000 },
  getTokenLargestAccounts: { weight: 4, cacheMs: 10_000, heavy: true },

  /* confirmation + history — never cached */
  getSignatureStatuses: { weight: 3, cacheMs: 0 },
  getSignaturesForAddress: { weight: 4, cacheMs: 0 },
  getTransaction: { weight: 3, cacheMs: 0 },
  getStakeActivation: { weight: 2, cacheMs: 5_000 },
  getInflationReward: { weight: 3, cacheMs: 60_000 }
});

export const relayMethodNames = () => Object.keys(RELAY_METHODS);

/**
 * JS-level names that are NOT JSON-RPC methods, mapped onto the ones that are.
 *
 * WHY THIS TABLE EXISTS
 * --------------------
 * `@solana/web3.js` has methods whose names differ from the request they send:
 *
 *   connection.getMultipleAccountsInfo(pks)  → {"method":"getMultipleAccounts"}
 *   connection.getParsedTokenAccountsByOwner → {"method":"getTokenAccountsByOwner"}
 *
 * An allowlist written from the JS side therefore contains entries no node can
 * serve — which is exactly what happened here: the first version of this file
 * allowed `getMultipleAccountsInfo` and NOT `getMultipleAccounts`, the one call
 * the Kamino reserve load actually makes (klend-sdk market.js:239). The relay
 * answered the SDK `-32601 is not relayed`, so the loan page could not read the
 * market through its own server and reported a node-shaped failure for an
 * app-shaped bug.
 *
 * Resolving an alias SERVES the call instead of refusing it — a superset of the
 * honest fix, and it means a client written against the JS names (or an older
 * build of this app) is answered too. Both spellings now reach the same wire
 * method, the same cache key, the same per-method refusal memory and the same
 * budget.
 */
export const RELAY_METHOD_ALIASES = Object.freeze({
  getMultipleAccountsInfo: 'getMultipleAccounts',
  getParsedTokenAccountsByOwner: 'getTokenAccountsByOwner'
});

/**
 * The wire method for whatever a caller asked for, or null when nothing in this
 * relay serves it.
 *
 * @param {string} method
 * @returns {string|null}
 */
export function resolveRelayMethod(method) {
  if (typeof method !== 'string' || !method) return null;
  if (Object.prototype.hasOwnProperty.call(RELAY_METHODS, method)) return method;
  const alias = RELAY_METHOD_ALIASES[method];
  return alias && Object.prototype.hasOwnProperty.call(RELAY_METHODS, alias) ? alias : null;
}

/* ── per-host refusal memory ──────────────────────────────────────────────── */

/**
 * What each upstream just told us, per host and per host+method.
 *
 * Two different refusals need two different memories:
 *   · an HTTP 401/403/451 is about the CALLER — the whole host is skipped for
 *     a while, for every method;
 *   · a JSON-RPC -32601 / -32602 «Request blocked» is about the METHOD — the
 *     host still serves everything else, so only that pair is skipped.
 *
 * Without the second memory the relay keeps asking a node that answers 200 with
 * an unusable body, which is precisely the «آن گره پاسخ داد، ولی پاسخی که
 * نتوانستیم استفاده کنیم» line in the report: a node that responds is not a
 * node that serves the call.
 */
const hostRefusals = new Map();   // host → { until, status, reason }
const methodRefusals = new Map(); // `${host}|${method}` → { until, code }

const hostRefusalMs = () => num('SOLANA_RELAY_HOST_REFUSAL_MS', 10 * 60 * 1000);
const methodRefusalMs = () => num('SOLANA_RELAY_METHOD_REFUSAL_MS', 10 * 60 * 1000);
const hostThrottleMs = () => num('SOLANA_RELAY_HOST_THROTTLE_MS', 60 * 1000);

const hostOf = (url) => {
  try { return new URL(String(url)).host; } catch { return String(url || '?'); }
};

const prune = (map, now) => {
  for (const [key, row] of map) if (row.until <= now) map.delete(key);
};

const noteHostRefusal = (url, status, now) => {
  const refusal = status === 401 || status === 403 || status === 451;
  const throttled = status === 429;
  if (!refusal && !throttled) return;
  hostRefusals.set(hostOf(url), {
    until: now + (refusal ? hostRefusalMs() : hostThrottleMs()),
    status,
    reason: refusal ? 'BLOCKED' : 'RATE_LIMITED'
  });
};

/** A 200 whose body says «I do not serve that» — remembered per method. */
const METHOD_REFUSAL_RE = /request blocked|not allowed|unsupported|disabled|method not found|forbidden|blocked/i;

const noteMethodRefusal = (url, method, code, now) => {
  methodRefusals.set(`${hostOf(url)}|${method}`, { until: now + methodRefusalMs(), code });
};

/** Reset every memory — tests, and the diagnostics route. */
export function resetRelayMemory() {
  hostRefusals.clear();
  methodRefusals.clear();
  cache.clear();
  buckets.clear();
  heavyBuckets.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.upstreamCalls = 0;
  stats.failures = 0;
}

/** What the status route reports: no credentials, no request bodies. */
export function relayMemorySnapshot(now = Date.now()) {
  prune(hostRefusals, now);
  prune(methodRefusals, now);
  return {
    hosts: [...hostRefusals.entries()].map(([host, row]) => ({
      host, reason: row.reason, status: row.status ?? null, coolingMs: Math.max(0, row.until - now)
    })),
    methods: [...methodRefusals.entries()].map(([key, row]) => {
      const [host, method] = key.split('|');
      return { host, method, code: row.code ?? null, coolingMs: Math.max(0, row.until - now) };
    })
  };
}

/* ── shared answer cache ──────────────────────────────────────────────────── */

const cache = new Map(); // key → { at, expires, body }
const cacheMaxEntries = () => num('SOLANA_RELAY_CACHE_MAX', 400);

const stats = { hits: 0, misses: 0, upstreamCalls: 0, failures: 0 };

/** Stable JSON: key order must not change the cache key. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const cacheKey = (cluster, method, params) => `${cluster}|${method}|${stableStringify(params ?? null)}`;

function readCache(key, now) {
  const row = cache.get(key);
  if (!row) return null;
  if (row.expires <= now) {
    cache.delete(key);
    return null;
  }
  /* Re-insert so the eviction below drops the least-used entry, not the
     oldest-inserted one that everybody keeps asking for. */
  cache.delete(key);
  cache.set(key, row);
  stats.hits += 1;
  return row.body;
}

function writeCache(key, body, ttlMs, now) {
  if (!(ttlMs > 0)) return;
  if (cache.size >= cacheMaxEntries()) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: now, expires: now + ttlMs, body });
}

/* ── per-IP budget ────────────────────────────────────────────────────────── */

const WINDOW_MS = 60_000;
/** Reads are cheap for the caller and metered for us: a weight-based budget. */
const maxWeightPerWindow = () => num('SOLANA_RELAY_BUDGET', 600);
/** Heavy methods get their own, much smaller budget — one getProgramAccounts
    costs an upstream more than fifty getBalance calls. */
const maxHeavyPerWindow = () => num('SOLANA_RELAY_HEAVY_BUDGET', 40);

const buckets = new Map();       // ip → { weight, reset }
const heavyBuckets = new Map();  // ip → { count, reset }

function takeBudget(map, key, cost, limit, now) {
  let rec = map.get(key);
  if (!rec || now > rec.reset) {
    rec = { used: 0, reset: now + WINDOW_MS };
    map.set(key, rec);
  }
  rec.used += cost;
  if (rec.used > limit) return { ok: false, retryAfterMs: Math.max(1000, rec.reset - now) };
  return { ok: true, retryAfterMs: 0 };
}

/* keep the buckets from growing forever (same trick as server/app.js) */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  for (const [k, v] of heavyBuckets) if (now > v.reset) heavyBuckets.delete(k);
  prune(hostRefusals, now);
  prune(methodRefusals, now);
}, WINDOW_MS).unref?.();

/* ── JSON-RPC helpers ─────────────────────────────────────────────────────── */

const rpcError = (id, code, message, data = undefined) => {
  const error = { code, message: String(message).slice(0, 400) };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
};

/* JSON-RPC's own reserved codes, so a caller can tell OUR refusal from an
   upstream's answer without reading English. */
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL = -32603;
/** Our own codes, in the -32000 server-error range. */
const RPC_RELAY_DISABLED = -32001;
const RPC_RELAY_THROTTLED = -32002;
const RPC_RESPONSE_TOO_LARGE = -32003;
const RPC_UPSTREAM_UNAVAILABLE = -32004;

/** An upstream fetch with a hard timeout. Never throws. */
async function upstreamCall(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        /* Descriptive on purpose: an upstream that logs who is asking should
           see the app's name, not a spoofed browser. */
        'user-agent': 'fbt-swap-solana-relay/1.0 (read-only; +https://fbtswap.com)'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, status: res.status, reason: res.status === 429 ? 'RATE_LIMITED' : 'HTTP' };
    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxResponseBytes()) {
      return { ok: false, ms, status: res.status, reason: 'TOO_LARGE', bytes };
    }
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* parsed below as BAD_BODY */ }
    if (!body || typeof body !== 'object') return { ok: false, ms, status: res.status, reason: 'BAD_BODY' };
    return { ok: true, ms, status: res.status, body, bytes };
  } catch (cause) {
    const msg = String(cause?.message || cause || '');
    return { ok: false, ms: Date.now() - started, status: 0, reason: /abort/i.test(msg) ? 'TIMEOUT' : 'UNREACHABLE', detail: msg.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── the relay ────────────────────────────────────────────────────────────── */

/**
 * Relay ONE JSON-RPC request.
 *
 * Returns `{ status, body, meta }` where `body` is always a JSON-RPC 2.0
 * object with the caller's own `id`, so `new Connection(relayUrl)` in
 * @solana/web3.js works against this route exactly as it works against a node.
 *
 * @param {{ body?: any, cluster?: string, ip?: string|null, now?: number }} input
 */
export async function relaySolanaRpc({ body, cluster = 'mainnet-beta', ip = null, now = Date.now() } = {}) {
  const cl = normalizeCluster(cluster);
  const id = body && typeof body === 'object' && !Array.isArray(body) ? (body.id ?? null) : null;

  if (!relayEnabled()) {
    return { status: 503, body: rpcError(id, RPC_RELAY_DISABLED, 'the Solana relay is switched off on this deployment'), meta: { cluster: cl, stage: 'disabled' } };
  }
  if (Array.isArray(body)) {
    /* web3.js sends single requests; a batch would let one caller spend the
       whole per-IP budget in one HTTP call, so batches are refused outright
       rather than half-implemented. */
    return { status: 400, body: rpcError(null, RPC_INVALID_REQUEST, 'batch requests are not accepted; send one JSON-RPC object'), meta: { cluster: cl, stage: 'shape' } };
  }
  if (!body || typeof body !== 'object' || typeof body.method !== 'string') {
    return { status: 400, body: rpcError(id, RPC_INVALID_REQUEST, 'a JSON-RPC 2.0 object with a string `method` is required'), meta: { cluster: cl, stage: 'shape' } };
  }

  const method = body.method;
  const params = body.params;
  if (params !== undefined && !Array.isArray(params) && typeof params !== 'object') {
    return { status: 400, body: rpcError(id, RPC_INVALID_PARAMS, '`params` must be an array or an object'), meta: { cluster: cl, method, stage: 'shape' } };
  }
  /* A JS-level name (`getMultipleAccountsInfo`) is resolved to the method that
     goes on the wire (`getMultipleAccounts`) instead of being refused: see
     RELAY_METHOD_ALIASES. Everything downstream — budget, cache, refusal
     memory, upstream call — speaks the wire name. */
  const wire = resolveRelayMethod(method);
  if (!wire) {
    /* -32601 is what a node itself answers for a method it does not serve, so
       an SDK walking endpoints treats this relay the same way it treats a node
       that lacks the method: it throws, and the client tries the next one.
       The `data` block is MACHINE-readable on purpose: `relay: true` +
       `stage: 'allowlist'` says «this refusal came from the app's own door, not
       from a node» — the loan page must never again present an app-side gap as
       «the node answered but we could not use the response». */
    return {
      status: 200,
      body: rpcError(
        id,
        RPC_METHOD_NOT_FOUND,
        `method ${method} is not relayed: this endpoint is read-only and forwards an allowlist`,
        { relay: true, stage: 'allowlist', method }
      ),
      meta: { cluster: cl, method, stage: 'allowlist' }
    };
  }

  const rule = RELAY_METHODS[wire];
  const budgetKey = String(ip || 'unknown');

  /* Budget BEFORE the cache lookup? No — after. A cached answer costs us
     nothing upstream, and charging a user for it would push a busy page over
     the limit while our own bill stayed flat. */
  const key = cacheKey(cl, wire, params);
  const cached = readCache(key, now);
  if (cached) {
    return { status: 200, body: { ...cached, id }, meta: { cluster: cl, method, cache: 'hit' } };
  }

  const budget = takeBudget(buckets, budgetKey, rule.weight, maxWeightPerWindow(), now);
  if (!budget.ok) {
    stats.failures += 1;
    return {
      /* 429 is returned as a real HTTP status so the client's status-first
         classifier names it correctly («throttled — retry in a moment»)
         instead of reading a refusal where there is only a budget. */
      status: 429,
      body: rpcError(id, RPC_RELAY_THROTTLED, 'the relay budget for this caller is spent for the moment — retry shortly'),
      meta: { cluster: cl, method, stage: 'budget', retryAfterMs: budget.retryAfterMs }
    };
  }
  if (rule.heavy) {
    const heavy = takeBudget(heavyBuckets, budgetKey, 1, maxHeavyPerWindow(), now);
    if (!heavy.ok) {
      stats.failures += 1;
      return {
        status: 429,
        body: rpcError(id, RPC_RELAY_THROTTLED, `${method} is a heavy read and its relay budget is spent for the moment — retry shortly`),
        meta: { cluster: cl, method, stage: 'heavy-budget', retryAfterMs: heavy.retryAfterMs }
      };
    }
  }

  /* Walk the upstreams. Warm hosts first, then the ones that recently refused
     us — never removed, because a refusal is a fact about a moment, not about
     a node, and the last resort must still exist. */
  prune(hostRefusals, now);
  prune(methodRefusals, now);
  const all = relayUpstreams(cl);
  const isWarm = (url) => !hostRefusals.has(hostOf(url)) && !methodRefusals.has(`${hostOf(url)}|${wire}`);
  const candidates = [...all.filter(isWarm), ...all.filter((url) => !isWarm(url))];

  const attempts = [];
  let dominantStatus = 0;
  let sawRefusal = false;
  let sawThrottle = false;

  for (const url of candidates) {
    const host = hostOf(url);
    const timeoutMs = rule.heavy ? heavyTimeoutMs() : upstreamTimeoutMs();
    stats.upstreamCalls += 1;
    const call = await upstreamCall(url, { jsonrpc: '2.0', id: 1, method: wire, params: params ?? [] }, timeoutMs);
    attempts.push({ host, ok: call.ok, ms: call.ms, status: call.status || null, reason: call.ok ? null : call.reason });

    if (!call.ok) {
      if (call.reason === 'TOO_LARGE') {
        /* An honest, specific answer beats another hop: the next upstream will
           return the same megabytes, and a truncated body is worse than a
           named failure. */
        stats.failures += 1;
        return {
          status: 502,
          body: rpcError(id, RPC_RESPONSE_TOO_LARGE, `the answer to ${method} is larger than this relay forwards (${call.bytes} bytes over a ${maxResponseBytes()} byte limit) — narrow the request with filters or dataSlice`),
          meta: { cluster: cl, method, stage: 'size', attempts }
        };
      }
      noteHostRefusal(url, call.status, now);
      if (call.status === 401 || call.status === 403 || call.status === 451) { sawRefusal = true; dominantStatus = dominantStatus || call.status; }
      if (call.status === 429) sawThrottle = true;
      continue;
    }

    const payload = call.body;
    if (payload && payload.error) {
      const code = Number(payload.error?.code);
      const message = String(payload.error?.message || '');
      const refusedMethod = code === -32601 || (code === -32602 && METHOD_REFUSAL_RE.test(message))
        || (code === -32603 && METHOD_REFUSAL_RE.test(message));
      if (refusedMethod) {
        /* The node ANSWERED and said it does not serve this method. Remember it
           per method and keep walking — this host is still useful for reads it
           does serve. */
        noteMethodRefusal(url, wire, code, now);
        continue;
      }
      /* Any other JSON-RPC error is the protocol's own answer to THIS request
         (invalid params, account not found, a simulated revert). Forwarding it
         is the honest thing: it is not our failure to paper over, and the
         caller — the Kamino SDK — has to see exactly what a node would say. */
      writeCache(key, payload, 0, now); // errors are never cached
      stats.misses += 1;
      return { status: 200, body: { ...payload, id }, meta: { cluster: cl, method, upstream: redactUpstream(url), ms: call.ms, cache: 'miss' } };
    }

    stats.misses += 1;
    writeCache(key, payload, rule.cacheMs, now);
    return {
      status: 200,
      body: { ...payload, id },
      meta: { cluster: cl, method, upstream: redactUpstream(url), ms: call.ms, bytes: call.bytes ?? null, cache: rule.cacheMs > 0 ? 'miss-cached' : 'miss' }
    };
  }

  /* Nothing served the call. Report the most informative truth we have, with
     the upstream's OWN status when every one of them refused — see the header
     for why the status is forwarded rather than replaced. */
  stats.failures += 1;
  const status = sawRefusal ? dominantStatus || 403 : sawThrottle ? 429 : 502;
  const message = sawRefusal
    ? `${status}: every Solana node this relay tried refused the request (blocked by the provider, not a rate limit)`
    : sawThrottle
      ? '429: every Solana node this relay tried is rate limiting it — retry in a moment'
      : `no Solana node answered this relay for ${wire}`;
  return {
    status,
    body: rpcError(id, RPC_UPSTREAM_UNAVAILABLE, message, { attempts }),
    meta: { cluster: cl, method, stage: 'upstreams', attempts }
  };
}

/** Diagnostics for GET /api/solana/rpc/status — safe to expose publicly. */
export function relayStatus(now = Date.now()) {
  const snapshot = relayMemorySnapshot(now);
  return {
    enabled: relayEnabled(),
    clusters: Object.keys(DEFAULT_UPSTREAMS),
    methods: relayMethodNames(),
    upstreams: relayUpstreams('mainnet-beta').map(redactUpstream),
    ownUpstreamConfigured: /^https:\/\//i.test(String(process.env.SOLANA_RPC_URL || '').trim()),
    limits: {
      budgetPerMinute: maxWeightPerWindow(),
      heavyPerMinute: maxHeavyPerWindow(),
      upstreamTimeoutMs: upstreamTimeoutMs(),
      heavyTimeoutMs: heavyTimeoutMs(),
      maxResponseBytes: maxResponseBytes()
    },
    cache: { entries: cache.size, maxEntries: cacheMaxEntries(), hits: stats.hits, misses: stats.misses },
    upstreamCalls: stats.upstreamCalls,
    failures: stats.failures,
    cooling: snapshot,
    meta: { schema: 'fbt.solana-rpc-relay.v1', dataStatus: 'live', source: 'server-relay' }
  };
}
