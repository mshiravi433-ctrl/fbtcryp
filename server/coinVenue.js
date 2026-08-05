/**
 * WHERE CAN THIS COIN ACTUALLY BE TRADED, IN THIS APP?
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «بعضی از کویین ها مثل پنگوئن میگه نمیشه سواپ کرد»
 *
 * Open Pudgy Penguins (PENGU) from the market list and the coin page says
 * "cannot be swapped here". That is a LIE, and an expensive one: PENGU is a
 * Solana SPL token, this app has a working Solana swap screen with a
 * paste-any-mint field, and Jupiter routes PENGU with deep liquidity. The user
 * is being turned away from a trade we can execute and earn a fee on.
 *
 * ─── WHY THE OLD ANSWER WAS WRONG ───────────────────────────────────────────
 * `src/lib/coinToSwap.js` answers the question by scanning `TOKENS` in
 * chains.js — 46 hand-written EVM entries. Anything outside that table is
 * reported as untradeable. So the app said "no" to:
 *
 *   • every Solana token, including the ones our own /solana screen trades
 *   • the ~thousands of EVM tokens the swap screen already loads from public
 *     token lists but that nobody hand-copied into chains.js
 *
 * That is not a small gap. It is the majority of the market list.
 *
 * ─── WHY THE FIX IS SERVER-SIDE, AND WHY IT IS SAFE ─────────────────────────
 * The authoritative answer to "what contract is this coin" is CoinGecko's own
 * `platforms` map, which we ALREADY download for `coinIndex.js` — the exact
 * same 20 MB response, the same six-hour cache, no new upstream cost. That
 * module builds the map address→id. This one builds it id→address, which is
 * the direction the coin page needs.
 *
 * Resolving through the coin id is the safety property, and it is worth being
 * explicit because this repo has a rule about it: the lookup is NEVER by
 * symbol. A scam token can call itself PENGU; it cannot occupy the contract
 * address CoinGecko has recorded for the coin whose page the user is standing
 * on. The id came from the market feed, so the address that comes back is the
 * one that coin's price is quoted from.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 * It does not promise liquidity. "There is a contract on a chain we support"
 * is not "there is a route" — the swap screen still asks the aggregator for a
 * real quote and will still say no if none exists. Claiming tradeable and then
 * failing at quote time would just move the dead end one screen later.
 */

import { PLATFORM_SLUGS } from './coinIndex.js';

const CG_BASE = process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const CG_KEY = process.env.COINGECKO_API_KEY || '';
const CG_IS_PRO = process.env.COINGECKO_PLAN === 'pro';

const TIMEOUT_MS = Number(process.env.COIN_INDEX_TIMEOUT_MS || 45000);
const TTL_MS = 6 * 3600_000;

/**
 * CoinGecko's slug for Solana.
 *
 * Kept OUT of `PLATFORM_SLUGS` on purpose. That object is keyed by EVM chain
 * id and every consumer does `Number(key)`; adding a non-EVM entry would give
 * `NaN` a chain and quietly corrupt the order-form resolver, which is a
 * different feature with a different failure mode. Solana is a separate
 * concept here — a different screen, a different wallet, a different address
 * format — so it gets a separate constant.
 */
export const SOLANA_SLUG = 'solana';

/** base58, 32-44 chars. Rejects an EVM address pasted into a Solana field. */
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

let cache = { at: 0, byCoin: new Map() };
let inflight = null;

function cgUrl(path, params = {}) {
  const base = CG_IS_PRO ? CG_PRO_BASE : CG_BASE;
  const qs = new URLSearchParams(params);
  if (CG_KEY) qs.set(CG_IS_PRO ? 'x_cg_pro_api_key' : 'x_cg_demo_api_key', CG_KEY);
  const q = qs.toString();
  return `${base}${path}${q ? `?${q}` : ''}`;
}

/**
 * coin id → the venues we can actually reach.
 *
 * Coins with NO platform on any supported chain are omitted entirely rather
 * than stored with an empty object. There are roughly 17,000 of those (every
 * Cardano, Tron, TON and Bitcoin-family asset) and keeping them would triple
 * the map for zero information — "absent" and "present but empty" mean the
 * same thing to the caller.
 */
export function buildVenueIndex(rows, slugs = PLATFORM_SLUGS) {
  const evm = new Map(Object.entries(slugs).map(([cid, slug]) => [slug, Number(cid)]));
  const byCoin = new Map();

  for (const row of rows ?? []) {
    const id = row?.id;
    const platforms = row?.platforms;
    if (typeof id !== 'string' || !platforms || typeof platforms !== 'object') continue;

    const chains = {};
    let solana = null;

    for (const [slug, addr] of Object.entries(platforms)) {
      if (typeof addr !== 'string') continue;
      const value = addr.trim();
      if (!value) continue;

      if (slug === SOLANA_SLUG) {
        /*
         * Validated, not trusted. A malformed mint reaching the client would
         * become a `?toMint=` link the Solana screen cannot resolve, and the
         * user would get a broken picker instead of the honest "not here" the
         * old code at least managed.
         */
        if (SOL_ADDR.test(value)) solana = value;
        continue;
      }

      const chainId = evm.get(slug);
      if (!chainId) continue;
      const lower = value.toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(lower)) continue;
      /* First writer wins, same rule as coinIndex.js. */
      if (chains[chainId] == null) chains[chainId] = lower;
    }

    if (solana || Object.keys(chains).length) {
      byCoin.set(id, solana ? { chains, solana } : { chains });
    }
  }

  return byCoin;
}

async function fetchVenueIndex() {
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
    return buildVenueIndex(rows);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The index, refreshed at most every six hours, keeping the previous copy on
 * failure — a contract address is a near-permanent fact, so six-hour-old data
 * is not stale in any way that matters, while dropping the map would make the
 * whole market list abruptly untradeable again.
 */
export async function getVenueIndex(now = Date.now()) {
  if (cache.at && now - cache.at < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const byCoin = await fetchVenueIndex();
      cache = { at: Date.now(), byCoin };
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
 * GET /api/coin-venue/:id
 *
 * @returns {{id, chains: {[chainId]: address}, solana: string|null, tradeable: boolean}}
 *
 * `tradeable: false` with an explicit empty result is a real answer, not an
 * error — most of CoinGecko genuinely is not reachable from here, and the coin
 * page needs to be able to say so without treating it as a failure.
 */
export async function resolveVenue(coinId) {
  const id = String(coinId ?? '').trim().toLowerCase();
  if (!id || id.length > 100 || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    return { error: 'BAD_ID' };
  }

  const idx = await getVenueIndex();
  const hit = idx.byCoin.get(id);

  return {
    id,
    chains: hit?.chains ?? {},
    solana: hit?.solana ?? null,
    tradeable: Boolean(hit),
    updatedAt: new Date(idx.at).toISOString()
  };
}

/** Reset, for tests. */
export function _resetVenueIndex() {
  cache = { at: 0, byCoin: new Map() };
  inflight = null;
}
