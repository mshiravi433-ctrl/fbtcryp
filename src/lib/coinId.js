/**
 * COIN-ID RESOLUTION — client side.
 * ---------------------------------------------------------------------------
 * Thin, like lib/yields.js and lib/perp.js. The heavy part (the whole
 * CoinGecko coin list, roughly 20 MB) lives in `server/coinIndex.js` and must
 * never reach a phone.
 *
 * ─── WHAT THIS UNLOCKS ──────────────────────────────────────────────────────
 * The automatic-order screen offered 36 hand-curated token entries — 17 unique
 * symbols — because an order needs a price feed and only curated tokens
 * carried a `coingeckoId`. The swap screen has always offered thousands. This
 * closes that gap: pick any token the swap screen knows, and if a price feed
 * exists for it, an order can be set on it.
 *
 * ─── WHY A MISS IS RETURNED AS null AND NEVER GUESSED ───────────────────────
 * Symbol matching would be the obvious shortcut and it is exactly the wrong
 * one. Dozens of tokens share the ticker "BTC" and hundreds of scam tokens
 * deliberately copy real symbols. An order watching the wrong coin's price
 * fires at a price with no relationship to the asset being sold — worse than
 * having no order at all, because the user believes they are protected.
 *
 * So resolution is by CONTRACT ADDRESS only, and an unresolved token is
 * reported as unorderable with the reason shown on screen.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Session cache. A contract's coin id does not change, so re-asking within a
 * session is pure waste — and the order form resolves on every token change.
 */
const memo = new Map();

const key = (chainId, address) => `${Number(chainId)}:${String(address).toLowerCase()}`;

/**
 * Resolve coin ids for tokens on one chain.
 *
 * @param  {number} chainId
 * @param  {Array}  tokens   token objects from the swap token list
 * @return {Promise<Map<string,string|null>>} lower-cased address → id or null
 *
 * Native coins (address === null) are skipped: they already carry a curated
 * `coingeckoId` in chains.js, and they have no contract to look up.
 */
export async function resolveCoinIds(chainId, tokens, { timeout = 15000 } = {}) {
  const out = new Map();
  const need = [];

  for (const t of tokens ?? []) {
    if (!t || t.native || !t.address) continue;
    const k = key(chainId, t.address);
    if (memo.has(k)) {
      out.set(String(t.address).toLowerCase(), memo.get(k));
    } else {
      need.push(String(t.address).toLowerCase());
    }
  }

  if (!need.length) return out;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    /*
     * Batched, and capped at the same 25 the server enforces. Two round trips
     * on a slow mobile connection is the difference between the form enabling
     * instantly and looking broken.
     */
    const res = await fetch(
      `${API_BASE}/coin-id/${Number(chainId)}?addresses=${need.slice(0, 25).join(',')}`,
      { signal: ctrl.signal, headers: { accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const [addr, id] of Object.entries(data?.ids ?? {})) {
      const norm = String(addr).toLowerCase();
      memo.set(key(chainId, norm), id);
      out.set(norm, id);
    }
  } catch {
    /*
     * A failure here must NOT be cached. Caching a null on a network error
     * would permanently mark a perfectly good token as unorderable for the
     * rest of the session, and the user would have no way to understand why.
     */
  } finally {
    clearTimeout(timer);
  }

  return out;
}

/**
 * Attach a `coingeckoId` to a token, if one can be found.
 *
 * Returns the token unchanged when it already has one — the curated ids in
 * chains.js are hand-verified and must win over a lookup, because a few of
 * them intentionally differ from the naive mapping (WBTC and BTCB both track
 * `bitcoin`, WETH tracks `ethereum`).
 */
export function withCoinId(token, resolved) {
  if (!token || token.coingeckoId) return token;
  if (token.native || !token.address) return token;
  const id = resolved?.get(String(token.address).toLowerCase());
  return id ? { ...token, coingeckoId: id } : token;
}

/** Can an automatic order be placed on this token at all? */
export const isOrderable = (token) => Boolean(token?.coingeckoId);

/** Reset, for tests. */
export function _clearCoinIdCache() {
  memo.clear();
}
