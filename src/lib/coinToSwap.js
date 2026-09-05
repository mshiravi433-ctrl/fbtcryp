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
 * `binancecoin`. The swap screen trades ERC-20 contracts on nine EVM chains,
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
import { getTokensSync } from './tokenLists.js';

/**
 * Chain preference when a coin exists on several.
 *
 * BNB Chain first because it is the app's default network and has the lowest
 * fees of the seven — a user tapping Buy on a coin available in three places
 * should land on the cheapest one rather than on whichever chain happened to
 * be first in the object. Ethereum last for the same reason, reversed.
 *
 * The 2026-09 networks sit after Linea/Sonic and before Ethereum: they are
 * newer and their curated lists are thinner, so a coin present on an older
 * chain almost always has better liquidity there. What matters most is that
 * they are HERE AT ALL — a chain absent from this list is a chain whose
 * curated tokens (MNT, BERA, MON) the coin page answers "cannot swap" for.
 */
const CHAIN_PREFERENCE = [56, 8453, 42161, 137, 10, 43114, 59144, 146, 5000, 80094, 130, 143, 1];

/**
 * ─── SOLANA ITSELF IS CURATED, NOT A COIN-VENUE LOOKUP ─────────────────────
 * Reported: «در بازار بعضی از کویین ها میگه هنوز روی این شبکه نداری مثل
 * توکن سولنا». SOL is the native coin of the Solana chain. It appears in
 * every market list, it is not in the EVM `TOKENS` table, and CoinGecko's
 * platform map points it at the wrapped-SOL mint — so the coin page had no
 * curated entry and the market list showed no swap button for the most
 * recognisable token after BTC/ETH.
 *
 * The app HAS a working Solana swap screen (Jupiter routing, see
 * src/lib/solana.js), so SOL deserves a first-class target here, resolved
 * offline and instantly, exactly like the curated EVM entries — not a
 * network round-trip that can fail.
 */
export const SOLANA_TARGET = {
  kind: 'solana',
  chainId: null,
  chainName: 'Solana',
  token: { symbol: 'SOL', name: 'Solana', native: true, coingeckoId: 'solana' }
};

/**
 * Native L1s that are not EVM/Solana but this app already quotes on THORChain
 * (Bridge → Native tab). Bitcoin itself stays on the curated EVM table
 * (BTCB / WBTC) because that is a one-tap wallet swap. BCH and XRP have no
 * curated EVM contract here, so Buy/Sell used to print "cannot swap" while
 * the THOR panel could already quote them.
 *
 * Cardano (ADA) is still refused: THOR has no ADA pool, and we do not open
 * a swap on a wrapped ticker that is a different asset.
 */
export const THOR_NATIVE = {
  'bitcoin-cash': { asset: 'BCH.BCH', symbol: 'BCH', name: 'Bitcoin Cash', coingeckoId: 'bitcoin-cash' },
  ripple: { asset: 'XRP.XRP', symbol: 'XRP', name: 'XRP', coingeckoId: 'ripple' },
  litecoin: { asset: 'LTC.LTC', symbol: 'LTC', name: 'Litecoin', coingeckoId: 'litecoin' },
  dogecoin: { asset: 'DOGE.DOGE', symbol: 'DOGE', name: 'Dogecoin', coingeckoId: 'dogecoin' }
};

const THOR_COUNTER = 'ETH.ETH';

export function thorTargetFor(coingeckoId) {
  const row = THOR_NATIVE[String(coingeckoId || '').trim().toLowerCase()];
  if (!row) return null;
  return {
    kind: 'thor',
    chainId: null,
    chainName: 'THORChain',
    token: row
  };
}

/**
 * Find a real, swappable token for a CoinGecko coin id.
 *
 * @returns {{kind:'evm'|'solana', chainId:number|null, token:object, chainName:string}|null}
 *          null means "we cannot trade this here", which the UI must say
 *          plainly rather than papering over.
 */
export function swapTargetFor(coingeckoId) {
  const id = String(coingeckoId || '').trim().toLowerCase();
  if (!id) return null;

  /* The Solana native coin, handled before the EVM scan for clarity. */
  if (id === 'solana') return SOLANA_TARGET;

  const thor = thorTargetFor(id);
  if (thor) return thor;

  for (const chainId of CHAIN_PREFERENCE) {
    const list = TOKENS[chainId] ?? [];
    const token = list.find((tk) => String(tk.coingeckoId || '').toLowerCase() === id);
    if (token) {
      return { kind: 'evm', chainId, token, chainName: EVM_CHAINS[chainId]?.name ?? String(chainId) };
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

  /* Solana native coin — land on the Solana swap screen directly. The
     screen resolves ?to=SOL against its curated assets, so no mint is ever
     taken from a URL (see src/pages/SolanaSwap.jsx). */
  if (target.kind === 'solana') {
    return `/solana?to=${encodeURIComponent(target.token.symbol)}&side=${side}`;
  }

  if (target.kind === 'thor') {
    const asset = target.token.asset;
    const from = side === 'sell' ? asset : THOR_COUNTER;
    const to = side === 'sell' ? THOR_COUNTER : asset;
    return `/bridge?mode=native&fromAsset=${encodeURIComponent(from)}&toAsset=${encodeURIComponent(to)}`;
  }

  const { chainId, token } = target;
  const list = TOKENS[chainId] ?? [];

  let stable =
    list.find((tk) => tk.symbol === 'USDT') ??
    list.find((tk) => tk.symbol === 'USDC') ??
    null;

  /*
   * The 2026-09 networks ship a deliberately thin curated list (native coin,
   * maybe the wrapped native — see chains.js: unverified addresses are not
   * committed there), so `stable` is null on them and the old code fell back
   * to the NATIVE coin as the counter-token. Buying MNT for MNT is not a
   * pair; the swap screen would open on from === to and the user would type
   * an amount into a trade that can never quote.
   *
   * The stablecoin IS there — in the runtime token universe that the swap
   * screen loads (CoinGecko lists, see lib/tokenLists.js). getTokensSync is
   * synchronous (memory, then a day of localStorage, then the curated floor),
   * so this adds no network call and no new failure mode; on a cold offline
   * launch it simply finds nothing and behaves exactly as before.
   */
  if (!stable) {
    const all = getTokensSync(chainId) ?? [];
    stable =
      all.find((tk) => tk.symbol === 'USDT') ??
      all.find((tk) => tk.symbol === 'USDC') ??
      null;
  }

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
  const fromTok = side === 'sell' ? token : counter;
  const toTok = side === 'sell' ? counter : token;

  /*
   * A leg the CURATED list knows travels by symbol — the swap screen's
   * ?from=/?to= parameters are pinned to curated tokens only, and must stay
   * that way (a symbol from a URL selecting an arbitrary token is a one-tap
   * phishing vector; see the wiring test). A leg only the runtime universe
   * knows — the 2026-09 stablecoins — travels by ADDRESS on the separate
   * ?fromAddress=/?toAddress= import path, the one built for "this contract
   * is not on the curated list". Both legs always name a token the swap
   * screen can select.
   */
  const curated = TOKENS[chainId] ?? [];
  const leg = (tk, key) => {
    const bySymbol = curated.some((x) => x.symbol === tk.symbol && (
      !x.address || (tk.address && x.address.toLowerCase() === tk.address.toLowerCase())
    ));
    return bySymbol
      ? `${key}=${encodeURIComponent(tk.symbol)}`
      : `${key}Address=${encodeURIComponent(tk.address)}`;
  };

  return `/swap?chain=${chainId}&${leg(fromTok, 'from')}&${leg(toTok, 'to')}`;
}
