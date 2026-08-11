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

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Session cache.
 *
 * A coin's contract addresses do not change, and the coin page re-resolves on
 * every mount — going back and forward through the market list would
 * otherwise re-ask on every tap.
 */
const memo = new Map();

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
  const id = String(coinId ?? '').trim().toLowerCase();
  if (!id) return null;
  if (memo.has(id)) return memo.get(id);

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

    const out = {
      chains: data.chains && typeof data.chains === 'object' ? data.chains : {},
      solana: typeof data.solana === 'string' ? data.solana : null,
      tradeable: Boolean(data.tradeable)
    };
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

  if (venue.solana) {
    /*
     * The Solana screen takes `?to=<mint>` and restricts it to its CURATED
     * assets, precisely so a crafted link cannot preselect a scam token. A
     * resolved mint is not curated, so it needs its own parameter that the
     * screen treats as "import this, and show it as unverified".
     */
    return {
      kind: 'solana',
      chainId: null,
      address: venue.solana,
      href: `/solana?toMint=${encodeURIComponent(venue.solana)}&side=${side}`
    };
  }

  const entries = Object.entries(venue.chains ?? {});
  if (!entries.length) return null;

  /* Same preference order as coinToSwap.js: cheapest chain first. */
  const PREFERENCE = [56, 8453, 42161, 137, 10, 43114, 59144, 146, 1];
  entries.sort(
    (a, b) => PREFERENCE.indexOf(Number(a[0])) - PREFERENCE.indexOf(Number(b[0]))
  );
  const [chainId, address] = entries.find(([cid]) => PREFERENCE.includes(Number(cid))) ?? [];
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
}
