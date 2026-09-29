/**
 * "CAN I TRADE THIS COIN HERE?" — client side.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS CLOSES ────────────────────────────────────────────────────
 *   «بعضی از کویین ها مثل پنگوئن میگه نمیشه سواپ کرد»
 *
 * `coinToSwap.js` answers from the 46-entry curated EVM table in chains.js.
 * That was the right answer when the swap screen only knew those 46 tokens.
 * It has been wrong ever since, because:
 *
 *   • the EVM swap screen loads THOUSANDS of tokens from public token lists
 *     and can import any contract address on top of that;
 *   • the Solana screen exists at all, and takes any mint.
 *
 * So the curated table stopped being "what we can trade" and became "what we
 * happened to type in". PENGU — a Solana token with deep Jupiter liquidity —
 * is the example the owner found, and there are thousands more.
 *
 * ─── THE TWO-LAYER ANSWER, AND WHY BOTH LAYERS EXIST ────────────────────────
 *   1. `swapTargetFor` (curated) answers INSTANTLY and offline. When it hits,
 *      it is the best answer available: a hand-verified contract, on our
 *      cheapest chain, with a stablecoin counter-token already picked.
 *   2. This module is the fallback, and it costs a network round trip. It
 *      resolves the coin's real contract from CoinGecko's own platform map
 *      (server-side; see server/coinVenue.js for why the 20 MB source must
 *      never reach a phone).
 *
 * Curated first is not just speed. A curated entry carries a counter-token and
 * a known-good chain preference; a resolved one carries only an address, and
 * the swap screen has to import it. Preferring the resolved answer would
 * downgrade the good case to serve the bad one.
 *
 * ─── STILL NEVER BY SYMBOL ──────────────────────────────────────────────────
 * The request is keyed by CoinGecko coin id, which is what the market feed
 * gave us and what the price on screen is quoted from. A scam token can copy
 * the ticker PENGU; it cannot occupy the contract address recorded against
 * the coin whose page you are standing on.
 */

import { apiBase } from './apiBase.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

/**
 * Session cache.
 *
 * A coin's contract addresses do not change, and the coin page re-resolves on
 * every mount — going back and forward through the market list would
 * otherwise re-ask on every tap.
 */
const memo = new Map();
const pendingVenueIds = new Map();
const MAX_BATCH_IDS = 100;

const normaliseId = (value) => String(value ?? '').trim().toLowerCase();
const validId = (id) => id.length > 0 && id.length <= 100 && /^[a-z0-9][a-z0-9._-]*$/.test(id);
const normaliseVenue = (data) => ({
  chains: data.chains && typeof data.chains === 'object' ? data.chains : {},
  solana: typeof data.solana === 'string' ? data.solana : null,
  tradeable: Boolean(data.tradeable)
});

function requestVenueBatch(ids, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const params = new URLSearchParams({ ids: ids.join(',') });
  let task;
  task = (async () => {
    try {
      const res = await fetch(`${API_BASE}/coin-venues?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.venues)) throw new Error('BAD_SHAPE');
      for (const row of data.venues) {
        const id = normaliseId(row?.id);
        if (!ids.includes(id) || !validId(id)) continue;
        memo.set(id, normaliseVenue(row));
      }
    } catch {
      /* A failed discovery read is not a "not tradeable" answer. */
    } finally {
      clearTimeout(timer);
      for (const id of ids) {
        if (pendingVenueIds.get(id) === task) pendingVenueIds.delete(id);
      }
    }
  })();
  for (const id of ids) pendingVenueIds.set(id, task);
  return task;
}

/**
 * Resolve many CoinGecko ids with one request against the server's cached
 * platform index. This keeps the Market list fast while still exposing
 * address-backed routes for non-curated rows.
 */
export async function getCoinVenues(coinIds, { timeout = 45000 } = {}) {
  const ids = [...new Set((Array.isArray(coinIds) ? coinIds : [coinIds])
    .map(normaliseId).filter(validId))];
  if (!ids.length) return new Map();

  const pending = new Set();
  const missing = [];
  for (const id of ids) {
    if (memo.has(id)) continue;
    const request = pendingVenueIds.get(id);
    if (request) pending.add(request);
    else missing.push(id);
  }

  for (let start = 0; start < missing.length; start += MAX_BATCH_IDS) {
    const batch = missing.slice(start, start + MAX_BATCH_IDS);
    pending.add(requestVenueBatch(batch, timeout));
  }
  if (pending.size) await Promise.all([...pending]);

  const result = new Map();
  for (const id of ids) {
    if (memo.has(id)) result.set(id, memo.get(id));
  }
  return result;
}

/**
 * Resolve the venues for one coin.
 *
 * @returns {Promise<{chains: object, solana: string|null, tradeable: boolean}|null>}
 *          `null` means "we could not find out", which is NOT the same as
 *          "not tradeable" and the UI must not render it as a refusal —
 *          telling somebody their coin is untradeable because our own request
 *          timed out is the same false negative this module exists to remove.
 */
export async function getCoinVenue(coinId, { timeout = 12000 } = {}) {
  const id = normaliseId(coinId);
  if (!validId(id)) return null;
  if (memo.has(id)) return memo.get(id);
  const batchRequest = pendingVenueIds.get(id);
  if (batchRequest) {
    await batchRequest;
    return memo.get(id) ?? null;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/coin-venue/${encodeURIComponent(id)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object' || data.error) return null;

    const out = normaliseVenue(data);
    /*
     * Only a SUCCESSFUL answer is cached. Caching a failure would mark the
     * coin unresolvable for the rest of the session over one bad request —
     * the same mistake `lib/coinId.js` documents and avoids.
     */
    memo.set(id, out);
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a resolved venue into somewhere to send the user.
 *
 * ─── SOLANA IS PREFERRED WHEN THE COIN IS SOLANA-NATIVE ─────────────────────
 * When a coin exists on Solana AND on an EVM chain it is usually because
 * somebody bridged it, and the bridged copy is the thin side of the market.
 * PENGU is the case in point: the Solana mint is where the liquidity is. So a
 * Solana mint wins unless the coin also has a curated EVM entry, which by
 * definition means we hand-checked that EVM contract as the right one.
 *
 * ─── AND WHY THE EVM LINK CARRIES AN ADDRESS, NOT A SYMBOL ──────────────────
 * The swap screen's `?from=&to=` params match against the CURATED list only,
 * deliberately — a symbol from a URL must never select an arbitrary imported
 * token. A resolved coin is by definition not curated, so it travels as
 * `?chain=<id>&toAddress=0x…` and the screen imports that exact contract.
 *
 * @returns {{kind:'solana'|'evm', href:string, chainId?:number, address:string}|null}
 */
export function venueRoute(venue, { side = 'buy' } = {}) {
  if (!venue) return null;

  const solanaMint = typeof venue.solana === 'string' ? venue.solana.trim() : '';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaMint)) {
    /*
     * The Solana screen takes `?to=<mint>` and restricts it to its CURATED
     * assets, precisely so a crafted link cannot preselect a scam token. A
     * resolved mint is not curated, so it needs its own parameter that the
     * screen treats as "import this, and show it as unverified".
     */
    return {
      kind: 'solana',
      chainId: null,
      address: solanaMint,
      href: `/solana?toMint=${encodeURIComponent(solanaMint)}&side=${side}`
    };
  }

  /* Same preference order as coinToSwap.js: cheapest supported chain first.
     Filter malformed addresses here as a second boundary: a discovery result
     can nominate a token, but an invalid address must never become a route. */
  const PREFERENCE = [56, 8453, 42161, 137, 10, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663, 1];
  const entries = Object.entries(venue.chains ?? {})
    .filter(([cid, address]) => (
      PREFERENCE.includes(Number(cid))
      && typeof address === 'string'
      && /^0x[0-9a-f]{40}$/i.test(address.trim())
    ));
  if (!entries.length) return null;
  entries.sort(
    (a, b) => PREFERENCE.indexOf(Number(a[0])) - PREFERENCE.indexOf(Number(b[0]))
  );
  const [chainId, rawAddress] = entries[0];
  const address = rawAddress.trim();
  if (!chainId || !address) return null;

  return {
    kind: 'evm',
    chainId: Number(chainId),
    address,
    href: `/swap?chain=${Number(chainId)}&toAddress=${encodeURIComponent(address)}&side=${side}`
  };
}

/** Reset, for tests. */
export function _clearVenueCache() {
  memo.clear();
  pendingVenueIds.clear();
}
