/**
 * COIN → REAL SWAP, or an honest "not here".
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * Every coin page had "Buy" and "Sell" buttons that went to `/trade` — the
 * PRACTICE screen, which trades virtual credits. Someone tapping Buy on the
 * Bitcoin page, from a wallet-connected app, reasonably believes they are
 * about to buy Bitcoin. They were not. They were opening a simulator.
 *
 * That is the worst class of bug in this app: not a crash, not a wrong number,
 * but a user who thinks they hold a position they do not hold. Reported as
 * «دکمه خرید و فروش داره که بزنی میبره به ازمایشی».
 *
 * ─── WHY THIS NEEDS A MODULE AND NOT A ONE-LINE URL CHANGE ──────────────────
 * The market list is CoinGecko's — thousands of coins, keyed by ids like
 * `binancecoin`. The swap screen trades ERC-20 contracts on seven EVM chains,
 * keyed by address. Most CoinGecko coins are not swappable here at all:
 *
 *   • some live on chains we do not support (Cardano, Tron, Ton)
 *   • some are the chain's own native coin on a chain we do not have
 *   • some are wrapped/bridged variants where picking the wrong contract
 *     sends money to a token nobody can sell
 *
 * So "send them to the swap screen" is only right when a real, curated
 * contract exists. When it does not, the honest outcome is to say so — not to
 * open the swap screen on some arbitrary token, and not to quietly fall back
 * to the practice simulator, which is what created this bug in the first place.
 *
 * ─── THE RULE ───────────────────────────────────────────────────────────────
 * Resolution is against the CURATED token table only (`TOKENS` in chains.js),
 * matched by `coingeckoId`. Never by symbol: dozens of tokens share the ticker
 * "BTC" and scam tokens copy real symbols deliberately. A symbol match here
 * would put a user one tap from buying a fake.
 */

import { EVM_CHAINS, TOKENS } from './chains.js';

/**
 * Chain preference when a coin exists on several.
 *
 * BNB Chain first because it is the app's default network and has the lowest
 * fees of the seven — a user tapping Buy on a coin available in three places
 * should land on the cheapest one rather than on whichever chain happened to
 * be first in the object. Ethereum last for the same reason, reversed.
 */
const CHAIN_PREFERENCE = [56, 8453, 42161, 137, 10, 43114, 59144, 146, 1];

/**
 * Find a real, swappable token for a CoinGecko coin id.
 *
 * @returns {{chainId:number, token:object, chainName:string}|null}
 *          null means "we cannot trade this here", which the UI must say
 *          plainly rather than papering over.
 */
export function swapTargetFor(coingeckoId) {
  const id = String(coingeckoId || '').trim().toLowerCase();
  if (!id) return null;

  for (const chainId of CHAIN_PREFERENCE) {
    const list = TOKENS[chainId] ?? [];
    const token = list.find((tk) => String(tk.coingeckoId || '').toLowerCase() === id);
    if (token) {
      return { chainId, token, chainName: EVM_CHAINS[chainId]?.name ?? String(chainId) };
    }
  }
  return null;
}

/** Can this coin be bought or sold for real, in this app, right now? */
export const isSwappable = (coingeckoId) => swapTargetFor(coingeckoId) !== null;

/**
 * Build the swap-screen URL for a real trade.
 *
 * ─── WHY THE STABLE SIDE IS CHOSEN, NOT ASSUMED ─────────────────────────────
 * Buying BNB means paying with something. The pair has to be completed or the
 * swap screen opens half-configured and the user has to guess. USDT is the
 * default counter-token because it is present on every chain we support and
 * is what people actually hold.
 *
 * When the coin IS the stablecoin (buying USDT), the counter-token would be
 * itself, which the swap screen rejects as SAME_TOKEN. So the native coin is
 * used instead — the one asset guaranteed to exist on every chain.
 */
export function swapUrlFor(coingeckoId, side = 'buy') {
  const target = swapTargetFor(coingeckoId);
  if (!target) return null;

  const { chainId, token } = target;
  const list = TOKENS[chainId] ?? [];

  const stable =
    list.find((tk) => tk.symbol === 'USDT') ??
    list.find((tk) => tk.symbol === 'USDC') ??
    null;

  /* Pairing a token with itself is rejected downstream; fall back to native. */
  const counter =
    stable && stable.symbol !== token.symbol
      ? stable
      : list.find((tk) => tk.native) ?? null;

  if (!counter) return null;

  /*
   * `from` is what leaves the wallet. Buying the coin means SPENDING the
   * stable side; selling means spending the coin. Getting this backwards
   * would preload the exact opposite trade — the same class of mistake the
   * order-form `direction` field guards against.
   */
  const from = side === 'sell' ? token.symbol : counter.symbol;
  const to = side === 'sell' ? counter.symbol : token.symbol;

  return `/swap?chain=${chainId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
