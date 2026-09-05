/**
 * CONTRACT ADDRESS → COINGECKO ID
 * ---------------------------------------------------------------------------
 * ─── THE CEILING THIS REMOVES ───────────────────────────────────────────────
 * The automatic-order screen offered 36 token entries across nine EVM chains —
 * 17 unique symbols. Not because the app cannot swap more: `tokenLists.js`
 * already loads thousands per chain from the public token lists, and the swap
 * screen uses all of them. The order screen was stuck on the hard-coded
 * `TOKENS` table in `chains.js`.
 *
 * The reason was specific and worth stating, because it is the thing this
 * module fixes rather than papers over: an order needs a PRICE FEED, not just
 * a contract address. Watching "sell when 1 X is worth 700 Y" requires asking
 * a price API about X and Y every few minutes, and our price source
 * (CoinGecko) is keyed by its own coin id — `binancecoin`, not
 * `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`. Any token in the curated table
 * has a hand-written `coingeckoId`. Every other token has none, so an order on
 * it could never be evaluated.
 *
 * Hand-writing thousands of ids is not an option, and GUESSING one is worse
 * than not offering the token: an order watching the wrong coin's price fires
 * at a price that has nothing to do with the asset being sold.
 *
 * So this module resolves them from the source of truth. CoinGecko publishes
 * `/coins/list?include_platform=true`, which maps every coin id to its
 * contract address on every chain it exists on. Free, keyless, and exactly the
 * lookup direction we need.
 *
 * ─── WHY THIS IS A SERVER ROUTE ─────────────────────────────────────────────
 * Same reason as server/yields.js. That endpoint is the entire CoinGecko
 * universe — roughly 20 MB of JSON and hundreds of thousands of entries.
 * Downloading it onto a phone on an Iranian mobile connection so the user can
 * look up two tokens would be indefensible. The server fetches it once every
 * six hours, keeps a compact address→id map, and answers lookups in bytes.
 *
 * ─── WHY IT FAILS CLOSED ────────────────────────────────────────────────────
 * An address with no match returns null, and the UI refuses to create an order
 * on it, saying why. That is the honest outcome: we cannot watch a price we
 * cannot fetch. The alternative — letting the order be created and silently
 * never evaluating it — is the "wired to nothing" failure this repo has
 * already shipped twice.
 */

const CG_BASE = process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const CG_KEY = process.env.COINGECKO_API_KEY || '';
const CG_IS_PRO = process.env.COINGECKO_PLAN === 'pro';

/* This response is large; it needs a longer timeout than an ordinary call. */
const TIMEOUT_MS = Number(process.env.COIN_INDEX_TIMEOUT_MS || 45000);

/**
 * CoinGecko's platform slug for each chain we support.
 *
 * ─── THESE ARE LOOKED UP, NOT GUESSED ───────────────────────────────────────
 * The slugs do not match the chain names and several are actively
 * counter-intuitive. Verified against a live `/coins/list?include_platform=true`
 * response rather than written from memory:
 *
 *   BNB Chain  → `binance-smart-chain`   (not `bsc`, not `bnb`)
 *   Optimism   → `optimistic-ethereum`   (not `optimism`)
 *   Arbitrum   → `arbitrum-one`          (not `arbitrum`)
 *   Polygon    → `polygon-pos`           (not `polygon`, not `matic`)
 *
 * A wrong slug here does not error. It silently matches nothing, so every
 * token on that chain looks unsupported and the feature quietly stays as
 * small as it was — the same class of silent failure as the LI.FI integrator
 * id and the dYdX venue key. The unit tests pin each literal for that reason.
 */
export const PLATFORM_SLUGS = {
  1: 'ethereum',
  10: 'optimistic-ethereum',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  8453: 'base',
  42161: 'arbitrum-one',
  43114: 'avalanche',
  59144: 'linea',
  146: 'sonic',
  /*
   * 2026-09 additions — must mirror EVM_CHAINS in src/lib/chains.js. A chain
   * missing here means the coin page's venue resolver can never see a
   * contract on it, so coins that only live on a new network print
   * "not swappable" on their own page even though the swap screen trades
   * the chain fine. The values are CoinGecko's own platform ids.
   */
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad'
};

/** Six hours. New listings are not urgent; hammering a free API is rude. */
const TTL_MS = 6 * 3600_000;

let cache = { at: 0, byChain: new Map(), coins: 0 };
let inflight = null;

function cgUrl(path, params = {}) {
  const base = CG_IS_PRO ? CG_PRO_BASE : CG_BASE;
  const qs = new URLSearchParams(params);
  if (CG_KEY) qs.set(CG_IS_PRO ? 'x_cg_pro_api_key' : 'x_cg_demo_api_key', CG_KEY);
  const q = qs.toString();
  return `${base}${path}${q ? `?${q}` : ''}`;
}

/**
 * Build the address→id map, one Map per chain.
 *
 * Addresses are lower-cased on both sides. EVM addresses are case-insensitive
 * but token lists disagree wildly about checksum casing, and a case-sensitive
 * comparison would miss most of them while appearing to work for whichever
 * list happened to match.
 */
export function buildIndex(rows, slugs = PLATFORM_SLUGS) {
  const wanted = new Map(Object.entries(slugs).map(([cid, slug]) => [slug, Number(cid)]));
  const byChain = new Map();
  for (const cid of Object.values(slugs)) byChain.set(cid, new Map());
  /* Keyed by chain id, not slug — the callers speak chain ids. */
  const out = new Map();
  for (const cid of Object.keys(slugs)) out.set(Number(cid), new Map());

  let coins = 0;
  for (const row of rows ?? []) {
    const id = row?.id;
    const platforms = row?.platforms;
    if (typeof id !== 'string' || !platforms || typeof platforms !== 'object') continue;
    coins += 1;

    for (const [slug, addr] of Object.entries(platforms)) {
      const chainId = wanted.get(slug);
      if (!chainId) continue;
      if (typeof addr !== 'string' || !addr) continue;
      const key = addr.trim().toLowerCase();
      /* Only EVM-shaped addresses; a malformed entry must not shadow a good one. */
      if (!/^0x[0-9a-f]{40}$/.test(key)) continue;
      const m = out.get(chainId);
      /*
       * First writer wins. CoinGecko occasionally lists the same contract
       * under a duplicate/ghost coin id; the canonical entry sorts earlier,
       * and overwriting would swap a real feed for a dead one.
       */
      if (!m.has(key)) m.set(key, id);
    }
  }

  return { byChain: out, coins };
}

async function fetchIndex() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cgUrl('/coins/list', { include_platform: 'true', status: 'active' }), {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('BAD_SHAPE');
    return buildIndex(rows);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The index, refreshed at most every six hours.
 *
 * On a refresh failure the PREVIOUS index is kept and served. That is correct
 * here in a way it is not for prices: a coin id is a near-permanent
 * identifier, so a six-hour-old mapping is not stale in any meaningful sense,
 * while dropping the map would make every non-curated token abruptly
 * unorderable.
 */
export async function getIndex(now = Date.now()) {
  if (cache.at && now - cache.at < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const built = await fetchIndex();
      cache = { at: Date.now(), byChain: built.byChain, coins: built.coins };
      return cache;
    } catch (err) {
      if (cache.at) return cache;
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * GET /api/coin-id/:chainId?addresses=0x..,0x..
 *
 * Batched deliberately: an order form needs two lookups at once, and two
 * round trips on a slow connection is the difference between the button
 * enabling instantly and appearing broken.
 */
export async function resolveIds(chainId, addresses) {
  const cid = Number(chainId);
  if (!PLATFORM_SLUGS[cid]) return { error: 'UNSUPPORTED_CHAIN' };

  const list = (Array.isArray(addresses) ? addresses : String(addresses ?? '').split(','))
    .map((a) => String(a || '').trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    /* Cap the batch so one caller cannot turn this into a bulk scraper. */
    .slice(0, 25);

  if (!list.length) return { error: 'NO_ADDRESSES' };

  const idx = await getIndex();
  const m = idx.byChain.get(cid) ?? new Map();

  const ids = {};
  for (const addr of list) ids[addr] = m.get(addr) ?? null;

  return {
    chainId: cid,
    ids,
    /* So the UI can say how big the universe actually is. */
    indexedOnChain: m.size,
    coins: idx.coins,
    updatedAt: new Date(idx.at).toISOString()
  };
}

/** Reset, for tests. */
export function _resetIndex() {
  cache = { at: 0, byChain: new Map(), coins: 0 };
  inflight = null;
}
