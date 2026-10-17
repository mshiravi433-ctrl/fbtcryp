/**
 * REAL-YIELD PRODUCT LIST — the single source of truth for "things to do with
 * money" inside FBT Swap.
 *
 * Moved out of pages/Earn.jsx so the new /rewards page can render the same
 * audited list without importing the whole Earn module. The rules that govern
 * this array live in its comments and are unchanged:
 *
 *   1. THERE IS NO `url` KEY. Not one row carries an outbound address, so
 *      there is nothing for a future edit to accidentally open. Every row
 *      navigates to one of our own screens.
 *   2. NO INVENTED NUMBERS. Not one row carries an `apr` string. A rate
 *      written into a source file is stale the day it is committed.
 */
import { IconShield, IconTrend, IconPools, IconSwap } from '../components/Icons';
import { SPECULATION_ENABLED } from './features';
import { vaultIsLive } from './vault';

export const YIELD = [
  {
    /*
     * GOLD. Listed first because it is the one asset here with no yield at
     * all and the one most people come to this screen for — and because
     * pretending otherwise is the exact failure the rest of this file avoids.
     *
     * `buys` renders two buttons that pre-fill our own swap with the token
     * address from lib/chains.js. Never a symbol: PAXG has clones.
     */
    id: 'gold',
    Icon: IconShield,
    risk: 'low',
    color: 'var(--rgb-5)',
    internal: '/farm?tab=inapp&focus=gold',
    buys: ['PAXG', 'XAUt']
  },
  {
    /*
     * ETHEREUM STAKING. Buying stETH or rETH IS the deposit — there is no
     * separate stake step and no lock-up, and the token grows against ETH by
     * itself. That is why this is one of our own products rather than a link
     * to Lido: the same outcome runs through our swap at the normal fee.
     */
    id: 'ethStake',
    Icon: IconTrend,
    risk: 'medium',
    color: 'var(--rgb-8)',
    internal: '/farm?tab=inapp&focus=eth',
    buys: ['stETH', 'rETH']
  },
  {
    /*
     * SOLANA STAKING. Same shape as above, on the other chain: the LST is
     * bought through our Solana swap and stays tradable. The live APY per
     * token is on the Farm screen, which measures it — not guessed here.
     */
    id: 'solStake',
    Icon: IconTrend,
    risk: 'low',
    color: 'var(--rgb-2)',
    internal: '/farm?tab=inapp&focus=sol'
  },
  {
    /*
     * TOKENIZED STOCKS. Our own aggregator quotes Backed's xStocks and the
     * issuer's key is re-verified server-side on every fetch, so the clones
     * cannot reach the list. Settles in USDT and is not a share — the Stocks
     * screen says both, above the list rather than in a footnote.
     */
    id: 'stocks',
    Icon: IconPools,
    risk: 'medium',
    color: 'var(--rgb-1)',
    internal: '/stocks'
  },
  /*
   * FOREX / METALS / INDICES.
   *
   * Gated on the SAME flag that gates Ostium in App.jsx. The live surface is
   * the Ostium tab on /stocks (افق جهانی) — not /invest (virtual NX) and not
   * a standalone /ostium URL.
   */
  ...(SPECULATION_ENABLED
    ? [{
      id: 'forex',
      Icon: IconTrend,
      risk: 'high',
      color: 'var(--rgb-3)',
      internal: '/stocks'
    }]
    : []),
  /*
   * OUR OWN LOAN PRODUCT — lending & borrowing via protocol smart contracts.
   * FBT earns a % of the yield generated; the depositor's principal stays
   * in the protocol contract, never in FBT's accounts.
   */
  {
    id: 'loan',
    Icon: IconShield,
    risk: 'medium',
    color: 'var(--rgb-2)',
    internal: '/loan'
  },
  /*
   * OUR OWN VAULT — the only row that recurs instead of paying once.
   *
   * Rendered from the live config, not a static entry: `vaultIsLive()` is
   * false on every deployment until a real Morpho vault address AND chain are
   * set, and a card for a vault nobody can deposit into is worse than no card.
   * The same condition already governs <VaultCard /> above this list.
   */
  ...(vaultIsLive()
    ? [{
      id: 'vault',
      Icon: IconShield,
      risk: 'medium',
      color: 'var(--rgb-4)',
      internal: '/vault'
    }]
    : []),
  {
    /*
     * BRIDGE. Moves the user's own assets between chains and collects our
     * bridge fee on the way. Not yield in the strict sense, but it is ours,
     * it works, and it belongs on a list of things to do with money in this
     * app far more than a link to a protocol we cannot pay for.
     */
    id: 'bridge',
    Icon: IconSwap,
    risk: 'low',
    color: 'var(--rgb-4)',
    internal: '/bridge'
  }
];
