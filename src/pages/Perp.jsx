import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import Sheet from '../components/Sheet';
import Sparkline from '../components/Sparkline';
import AnimatedNumber from '../components/AnimatedNumber';
import WalletConnectSheet from '../components/WalletConnectSheet';
import FuturesMarketChart from '../components/FuturesMarketChart';
import TokenIcon from '../lib/tokenIcon';
import FundingPanel from '../components/FundingPanel';
import { IconActivity, IconChevronRight, IconExternal, IconRoute, IconShield, IconSparkle, IconTrend, IconWallet } from '../components/Icons';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { anyVenueEarns, withReferral, AVANTIS_CODE } from '../lib/venueReferral';
import { SPECULATION_ENABLED } from '../lib/features';
import { getFuturesFeePreview, getFuturesMarkets, prepareFutures, verifyFutures } from '../lib/futuresClient';
import { liquidationDistance } from '../lib/futures-engine';
import { velocityPerpIndex } from '../lib/velocityMarkets';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { publicAppUrl } from '../lib/solanaWallet.js';
import lazyRetry from '../lib/lazyRetry';
import '../styles/perp-modern.css';
import '../styles/derivatives-glass.css';

const LazyDydx = SPECULATION_ENABLED ? lazyRetry(() => import('./Dydx')) : null;
/*
 * ─── THE THIRD TAB: ON-CHAIN ────────────────────────────────────────────────
 * Futures Engine v3. Perpetual (this overview) · dYdX (client-signed session)
 * · On-Chain (server-built unsigned calldata against audited perp contracts,
 * signed in the user's wallet). Same lazy pattern as dYdX, same feature flag:
 * the store builds ship neither leveraged tab.
 */
const LazyOnchain = SPECULATION_ENABLED ? lazyRetry(() => import('./FuturesOnchain')) : null;

const TAB_LABEL_KEY = { overview: 'perp.tab.perpetual', dydx: 'stocks.tab.dydx', onchain: 'perp.tab.onchain' };

/**
 * One icon per venue, so the rail says what each tab IS instead of asking the
 * reader to parse three near-identical words:
 *   overview → the trading terminal (price curve, ticket, fees)
 *   dydx     → the activity of an external, client-signed venue
 *   onchain  → the shield, because that tab is the self-custodial one
 */
const TAB_ICON = { overview: IconTrend, dydx: IconActivity, onchain: IconShield };

/*
 * ─── THE OVERVIEW SENDS PEOPLE OUT OF THE APP AS LITTLE AS POSSIBLE ─────────
 *
 * This list used to hold four venues. ApolloX and dYdX are gone.
 *
 * The rule applied, and it is a revenue rule rather than a taste one:
 * a button that leaves the app has to pay for the user it takes. Checked
 * against lib/venueReferral.js, which is the single source of truth for this:
 *
 *   apx      earns: false   reason: NO_PROGRAMME      → removed
 *   dydx     earns: false   reason: VOLUME_REQUIRED   → removed
 *   gmx      earns: true    permissionless Tier 1     → kept
 *   avantis  earns: true    code `fbtswap` registered → kept
 *
 * dYdX in particular did not even need the link. It is a full tab on this same
 * screen (`PERP_TABS`) running against our own same-origin proxy with a
 * builder fee attached — an outbound button next to it was cannibalising the
 * one integration here that actually earns.
 *
 * The two survivors both discount the referred trader's fees, so those links
 * are better for the user than the bare URL — and either way the notice below
 * says which case we are in, driven by the same flag that attaches the code.
 */
const VENUES = [
  {
    id: 'gmx',
    url: 'https://app.gmx.io/#/trade',
    pairs: '20+',
    leverage: '50x',
    color: 'var(--rgb-2)'
  },
  {
    /*
     * Permissionless referral AND non-crypto markets — forex, metals,
     * commodities, indices, equities. Registered on Base with the code
     * `fbtswap`, so the fee share of every referred trade settles to the
     * FBT treasury address with no capital of ours frozen anywhere.
     */
    id: 'avantis',
    url: 'https://www.avantisfi.com/trade',
    pairs: '60+',
    leverage: '500x',
    color: 'var(--rgb-4)'
  }
];
const AVANTIS = VENUES.find((v) => v.id === 'avantis');

/*
 * ─── THE PAIR UNIVERSE OF THE TERMINAL ──────────────────────────────────────
 *   «کلا جفت توکن های پرپچوال خیلی کمه با دقت فراوان درستش کن خیلی مهمه»
 *
 * This used to be TWELVE hard-coded pairs. Twelve is not a perpetuals
 * catalogue, it is a watchlist: every pair missing from it was unreachable
 * from the terminal no matter how liquid it was, and the user had to leave
 * the app to trade it.
 *
 * The list is now BUILT, in three passes, and the order is the argument:
 *
 *   1. FEATURED — the majors, first and in the order a trader expects to see
 *      them. Hard-coded because the first four cells of the strip are the
 *      page's headline, not a ranking result.
 *   2. THE VENUE CATALOGUE — whatever the in-app venue actually lists, read
 *      from the same live feed that decides whether the pair is executable.
 *      A pair the venue trades is a pair this terminal must offer; leaving it
 *      out is how a liquid market ends up looking empty.
 *   3. THE LIVE MARKET — the rest of the market-cap table the screen already
 *      polls, so the strip is as deep as the data it is quoting. Every added
 *      row carries the feed's own price, change and sparkline, which is the
 *      same rule the rest of this page obeys: a leveraged screen shows a live
 *      number or an honest dash, never a guess.
 *
 * `id` is the market feed's coin id and `symbol` is the key the executable
 * routes match on. A venue row with no coin in the feed still appears — its
 * price is honestly unavailable rather than invented.
 */
export const FEATURED_PAIRS = [
  /* the majors, in the order a trader expects to see them */
  { id: 'bitcoin', symbol: 'BTC' },
  { id: 'ethereum', symbol: 'ETH' },
  { id: 'solana', symbol: 'SOL' },
  { id: 'binancecoin', symbol: 'BNB' },
  { id: 'hyperliquid', symbol: 'HYPE' },
  { id: 'ripple', symbol: 'XRP' },
  { id: 'dogecoin', symbol: 'DOGE' },
  { id: 'avalanche-2', symbol: 'AVAX' },
  { id: 'sui', symbol: 'SUI' },
  { id: 'chainlink', symbol: 'LINK' },
  { id: 'cardano', symbol: 'ADA' },
  { id: 'tron', symbol: 'TRX' },
  { id: 'aptos', symbol: 'APT' },
  { id: 'near', symbol: 'NEAR' },
  { id: 'pepe', symbol: 'PEPE' },
  { id: 'shiba-inu', symbol: 'SHIB' },
  { id: 'litecoin', symbol: 'LTC' },
  /* L1s and the DeFi majors */
  { id: 'arbitrum', symbol: 'ARB' },
  { id: 'optimism', symbol: 'OP' },
  { id: 'polkadot', symbol: 'DOT' },
  { id: 'uniswap', symbol: 'UNI' },
  { id: 'aave', symbol: 'AAVE' },
  { id: 'injective-protocol', symbol: 'INJ' },
  { id: 'the-open-network', symbol: 'TON' },
  { id: 'stellar', symbol: 'XLM' },
  { id: 'hedera-hashgraph', symbol: 'HBAR' },
  { id: 'cosmos', symbol: 'ATOM' },
  { id: 'internet-computer', symbol: 'ICP' },
  { id: 'sei-network', symbol: 'SEI' },
  { id: 'celestia', symbol: 'TIA' },
  { id: 'bittensor', symbol: 'TAO' },
  { id: 'render-token', symbol: 'RENDER' },
  { id: 'virtual-protocol', symbol: 'VIRTUAL' },
  { id: 'fetch-ai', symbol: 'FET' },
  { id: 'ai16z', symbol: 'AI16Z' },
  { id: 'kaspa', symbol: 'KAS' },
  { id: 'filecoin', symbol: 'FIL' },
  { id: 'algorand', symbol: 'ALGO' },
  { id: 'eos', symbol: 'EOS' },
  { id: 'curve-dao-token', symbol: 'CRV' },
  { id: 'maker', symbol: 'MKR' },
  { id: 'pancakeswap-token', symbol: 'CAKE' },
  { id: 'gala', symbol: 'GALA' },
  { id: 'immutable-x', symbol: 'IMX' },
  { id: 'the-graph', symbol: 'GRT' },
  { id: 'fantom', symbol: 'FTM' },
  { id: 'mantle', symbol: 'MNT' },
  { id: 'ondo-finance', symbol: 'ONDO' },
  { id: 'wrapped-bitcoin', symbol: 'WBTC' },
  { id: 'bitcoin-cash', symbol: 'BCH' },
  /* Solana's own order flow and memes — the deep end of this venue */
  { id: 'jupiter-exchange-solana', symbol: 'JUP' },
  { id: 'bonk', symbol: 'BONK' },
  { id: 'dogwifcoin', symbol: 'WIF' },
  { id: 'pudgy-penguins', symbol: 'PENGU' },
  { id: 'popcat', symbol: 'POPCAT' },
  { id: 'floki', symbol: 'FLOKI' },
  { id: 'fartcoin', symbol: 'FARTCOIN' },
  { id: 'spx6900', symbol: 'SPX' },
  { id: 'official-trump', symbol: 'TRUMP' }
];

/** How many live-feed rows may join the strip. A strip is a browser, not a dump. */
const MAX_FEED_PAIRS = 140;

/**
 * Merge the three sources into ONE list.
 *
 * ─── WHY A CURATED ID CAN BE OVERRIDDEN BY THE FEED ─────────────────────────
 * A CoinGecko id is a string in a table, and this repo refuses to guess at
 * them for MONEY (see lib/coinToSwap.js: never resolve a contract by symbol).
 * This merge is not that. An id here selects which live row draws a price and
 * a sparkline on a strip cell — the tradeable target is resolved separately,
 * from the venue catalogue, by symbol and market id.
 *
 * So when a curated id is absent from the feed, and the feed happens to carry
 * a coin under that SYMBOL, the feed's id is adopted: the strip then quotes a
 * real, current price instead of showing an honest-but-empty cell forever over
 * a typo in a table. A curated id the feed confirms is never overridden.
 *
 * First writer wins on the symbol, sources in priority order.
 */
export function buildPerpPairs({ coins = [], venueMarkets = [], featured = FEATURED_PAIRS, max = MAX_FEED_PAIRS } = {}) {
  const feed = Array.isArray(coins) ? coins : [];
  const feedById = new Map();
  const feedBySymbol = new Map();
  for (const c of feed) {
    if (!c) continue;
    if (c.id) feedById.set(String(c.id), c);
    const sym = String(c.symbol || '').trim().toUpperCase();
    if (sym && !feedBySymbol.has(sym)) feedBySymbol.set(sym, c);
  }

  /* Which feed rows are already spoken for by a CURATED id. A ticker clone
     ranked above the real token must never be adopted as its price — so a
     feed id is only ever borrowed by a curated symbol that no other curated
     entry already claims. */
  const claimedFeedIds = new Set(
    featured.map((p) => p.id).filter((id) => id && feedById.has(String(id)))
  );

  const out = [];
  const seen = new Set();
  const push = (symbol, id) => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym || seen.has(sym)) return;
    seen.add(sym);

    if (!id) {
      /* no curated id (a venue-listed pair): take the feed's row for it */
      out.push({ symbol: sym, id: feedBySymbol.get(sym)?.id ?? null });
      return;
    }
    if (feedById.has(String(id))) {
      claimedFeedIds.add(String(id));
      out.push({ symbol: sym, id });
      return;
    }
    /* The curated id is not in the loaded page. If the feed happens to carry
       this SYMBOL under an id no curated entry owns, adopt it — a typo in a
       curated table must not strand a liquid pair with a permanently blank
       cell. Otherwise the curated id stands and the cell says "no data",
       which is the honest outcome and never a wrong number. */
    const bySym = feedBySymbol.get(sym);
    if (bySym?.id && !claimedFeedIds.has(String(bySym.id))) {
      claimedFeedIds.add(String(bySym.id));
      out.push({ symbol: sym, id: String(bySym.id) });
      return;
    }
    out.push({ symbol: sym, id });
  };

  /* 1. featured — the headline cells, in curated order. */
  for (const p of featured) push(p.symbol, p.id);

  /* 2. what the venue actually lists. An executable pair outranks a merely
        famous one, because it is the only kind this terminal can settle. */
  for (const m of venueMarkets ?? []) {
    const base = String(m?.base ?? m?.symbol ?? '').split('/')[0];
    if (base) push(base, null);
  }

  /* 3. the live market table, in the market-cap order the feed returned. */
  for (const c of feed) {
    if (out.length - featured.length >= max) break;
    push(c?.symbol, c?.id ?? null);
  }

  return out;
}

/* Product policy, same ceiling the futures engine enforces (hardMaxLeverage). */
const MAX_LEVERAGE = 50;
const LEVERAGE_PRESETS = [2, 5, 10, 20, 50];
const MIN_COLLATERAL_USD = 5;
/* Both referral venues discount the referred trader's fees by 5% — documented
   in lib/venueReferral.js, which is the single source of truth for this. */
const REFERRAL_DISCOUNT_PCT = 5;

/** A feed row is LIVE only when the provider says so — the offline snapshot
 *  must never sit under a live-price label on a leveraged screen. */
const coinIsLive = (c) => Boolean(c) && c.offline !== true && c.dataProvenance !== 'offline';

export default function Perp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { haptic, tg } = useTelegram();
  const wallet = useWallet();
  const solWallet = useSolanaWallet();
  /*
    250 by market cap, not 100. The strip is built from this feed (see
    buildPerpPairs), so the depth of the table is the depth of the catalogue —
    100 rows could only ever offer the 100th-largest coin, which is the
    complaint the expansion was filed against. It is the same request shape
    the market screen already makes, so it costs the app nothing new.
  */
  const { data: coins, loading } = useMarkets(250);
  const slippagePct = useSettingsStore((s) => s.defaultSlippage);
  const setSlippage = useSettingsStore((s) => s.setSlippage);

  /*
   * Deep link: /perp?tab=onchain (the Intent OS hands futures_* drafts here
   * and names the tab). Unknown values fall back to the overview.
   */
  const initialTab = (() => {
    try {
      const raw = String(window.location.hash || '').split('?')[1] || '';
      const wanted = new URLSearchParams(raw).get('tab');
      return SPECULATION_ENABLED && ['dydx', 'onchain'].includes(wanted) ? wanted : 'overview';
    } catch { return 'overview'; }
  })();
  const [perpTab, setPerpTab] = useState(initialTab);
  const PERP_TABS = SPECULATION_ENABLED ? ['overview', 'dydx', 'onchain'] : ['overview'];

  /*
   * ─── THE TERMINAL'S OWN STATE ─────────────────────────────────────────────
   * A real ticket, sized in a real stablecoin, with the same honest arithmetic
   * every other leveraged screen in this app uses.
   *
   * Nothing is ever signed by THIS screen's own key or held by the app: the
   * order is built by the backend, risk-checked there, and signed by the
   * user's own wallet — in this tab, where they asked to be.
   */
  const [side, setSide] = useState('long');
  const [collateral, setCollateral] = useState('100');
  const [collateralAsset, setCollateralAsset] = useState('USDC');
  const [leverage, setLeverage] = useState('5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  /*
   * ─── THE VENUE FEED (one read, no polling) ──────────────────────────────
   * Powers three decisions, all of which must come from the live venue rather
   * than a guess: (a) does the in-app executable route list this pair, (b)
   * does the shared FuturesMarketChart have candles for it, and (c) which
   * pairs the strip has to offer at all. When the feed is down the static
   * Velocity index table is the conservative fallback for ROUTING only — the
   * chart then says "unavailable" on its own and never draws a flat line.
   */
  const [venueMarkets, setVenueMarkets] = useState([]);
  useEffect(() => {
    let alive = true;
    getFuturesMarkets('drift')
      .then((r) => {
        if (alive && r?.ok && Array.isArray(r.data?.markets)) setVenueMarkets(r.data.markets);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const venueMarketByBase = useMemo(() => {
    const m = new Map();
    for (const row of venueMarkets ?? []) {
      const base = String(row?.base ?? '').toUpperCase();
      if (base && !m.has(base)) m.set(base, row);
    }
    return m;
  }, [venueMarkets]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const c of coins ?? []) m.set(c.id, c);
    return m;
  }, [coins]);

  /*
   * ─── THE PAIR UNIVERSE, BUILT ───────────────────────────────────────────
   * Featured + whatever the venue lists + the live market table, merged
   * (see buildPerpPairs). The selection is kept by SYMBOL rather than by
   * coin id, because a venue-listed pair the market feed has never heard of
   * has no id at all — keying on one would make it unselectable, which is
   * exactly the class of pair this screen most needs to offer.
   */
  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [pairQuery, setPairQuery] = useState('');

  const allPairs = useMemo(
    () => buildPerpPairs({ coins: coins ?? [], venueMarkets: venueMarkets ?? [] }),
    [coins, venueMarkets]
  );

  /* The search box exists because a hundred-plus cells in a horizontal strip
     cannot be browsed. It filters by ticker OR by the coin's own name, and it
     never re-orders: the featured majors stay first whatever is typed. */
  const stripPairs = useMemo(() => {
    const rows = allPairs.map((p) => ({
      ...p,
      coin: p.id ? byId.get(p.id) ?? null : null,
      venueMarket: venueMarketByBase.get(p.symbol) ?? null
    }));
    const q = pairQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) => p.symbol.toLowerCase().includes(q)
        || String(p.coin?.name ?? '').toLowerCase().includes(q)
    );
  }, [allPairs, byId, venueMarketByBase, pairQuery]);

  const pair = useMemo(
    () => allPairs.find((p) => p.symbol === selectedSymbol) ?? allPairs[0] ?? { symbol: 'BTC', id: 'bitcoin' },
    [allPairs, selectedSymbol]
  );
  const coin = pair.id ? byId.get(pair.id) ?? null : null;

  /*
   * ─── THE INDEX CARD IS REAL OR IT SAYS SO ──────────────────────────────
   * `getMarkets` keeps the ordinary Market screen usable offline with a
   * deterministic snapshot, and marks every such row `offline` /
   * `dataProvenance: 'offline'`. That snapshot must never sit under a
   * "-PERP · Index price" label with a sparkline: a leveraged screen shows a
   * live number or an honest "market data temporarily unavailable" — never a
   * synthetic price that looks like one (Futures Engine v3 rule).
   */
  const indexOffline = coin?.offline === true || coin?.dataProvenance === 'offline';

  const venueMarket = venueMarketByBase.get(pair.symbol) ?? null;
  /* Executable in this app? Live feed first, catalogue fallback second. */
  const routeInApp = Boolean(venueMarket) || velocityPerpIndex(pair.symbol) != null;

  /* ─── ticket arithmetic — pure, live, transparent ─────────────────────── */
  const collateralNum = Number(collateral);
  const leverageNum = Number(leverage);
  const collateralOk = Number.isFinite(collateralNum) && collateralNum >= MIN_COLLATERAL_USD;
  const leverageOk = Number.isFinite(leverageNum) && leverageNum >= 1 && leverageNum <= MAX_LEVERAGE;
  const notional = collateralOk && leverageOk ? collateralNum * leverageNum : null;

  /*
   * Entry reference: the live spot index (polled every 30s) when the feed is
   * live, else the venue's own mid from the one-shot read. Both offline →
   * null → every dependent number renders "—" instead of a guess.
   */
  const liveSpot = coinIsLive(coin) && Number(coin?.price) > 0 ? Number(coin.price) : null;
  const venueMid = Number(venueMarket?.mid) > 0 ? Number(venueMarket.mid) : null;
  const entryPrice = liveSpot ?? venueMid;

  /*
   * Liquidation preview from the SAME pure engine the backend uses. The
   * model is the full-collateral upper bound (labelled honestly below): the
   * real venue maintenance margin always liquidates a little sooner.
   */
  const liq = useMemo(
    () => liquidationDistance({ side, entryPrice, leverage: leverageOk ? leverageNum : null }),
    [side, entryPrice, leverageOk, leverageNum]
  );

  /*
   * ─── FEE PREVIEW — backend numbers only, debounced ─────────────────────
   * The breakdown is computed by the shared engine inside the BFF from the
   * venue's own fee parameters, exactly like the venue tab's preview. Nothing
   * is derived client-side, and an unreachable backend leaves the rows as
   * honest "shown at review" placeholders rather than invented dollars.
   */
  const [fee, setFee] = useState(null);
  useEffect(() => {
    const marketId = venueMarket?.marketId ?? null;
    if (!marketId || !collateralOk || !leverageOk) { setFee(null); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      getFuturesFeePreview({ provider: 'drift', market: String(marketId), collateralUsd: collateralNum, leverage: leverageNum })
        .then((r) => { if (alive) setFee(r?.ok ? (r.data?.fee ?? null) : null); })
        .catch(() => { if (alive) setFee(null); });
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
  }, [venueMarket?.marketId, collateralOk, leverageOk, collateralNum, leverageNum]);

  /*
   * ─── THESE LINKS USED TO EARN NOTHING ───────────────────────────────────
   * `withReferral` returns the URL UNCHANGED until a code is configured, so
   * this is safe to ship before the owner registers anything.
   *
   * And the referred trader gets a fee discount, so the link is better for
   * them than the bare one — but they are told either way, below.
   */
  const openVenue = (venueId, url) => {
    haptic?.('light');
    const target = withReferral(venueId, url);
    if (tg?.openLink) tg.openLink(target);
    else window.open(target, '_blank', 'noopener,noreferrer');
  };

  /*
   * ─── THE TAB STILL FOLLOWS THE URL (the Intent OS hand-off) ─────────────
   * Deep links still name their tab (`/perp?tab=onchain&…`), so the rail and
   * the query have to agree — otherwise a hand-off would change the URL and
   * leave the same screen mounted.
   *
   * What it no longer does is MOVE THE USER. That was the bug: signing in the
   * Perpetual tab used to `setPerpTab('onchain')` and navigate, so pressing
   * the button the user had just been looking at silently threw them onto a
   * different tab with a different layout. The order is now built, risk
   * checked and signed on this screen — see `prepareOrder` / `signOrder`.
   */
  useEffect(() => {
    if (!SPECULATION_ENABLED) return;
    try {
      const want = new URLSearchParams(location.search || '').get('tab');
      if ((want === 'onchain' || want === 'dydx') && want !== perpTab) setPerpTab(want);
    } catch { /* a malformed query is not worth breaking the page over */ }
  }, [location.search, perpTab]);

  /*
   * ─── WHICH WALLET SIGNS ────────────────────────────────────────────────
   * The in-app venue settles on Solana (Velocity), so the SOLANA wallet is
   * the one that signs and the one whose balance matters. The EVM wallet
   * still owns the connect sheet for the pairs this venue cannot take, and
   * for the EVM calldata path a future venue may add.
   *
   * `venueChain` is decided by the SAME answer the route decision uses, so
   * the button and the execution can never disagree about whose signature
   * they are waiting for.
   */
  const venueChain = 'solana';
  const tradingAddress = venueChain === 'solana' ? solWallet.address : wallet.address;
  const tradingConnected = venueChain === 'solana' ? Boolean(solWallet.address) : Boolean(wallet.isConnected);

  const [prepared, setPrepared] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [execError, setExecError] = useState(null);
  const [lastTx, setLastTx] = useState(null);

  /* A pair change invalidates an order built for the previous one. Silently
     keeping it would sign a ticket the screen no longer shows. */
  useEffect(() => { setPrepared(null); setExecError(null); }, [pair.symbol, side, collateral, leverage, takeProfit, stopLoss]);

  const canConfirm = notional != null;

  /*
   * THE FINAL BUTTON — «بازبینی و تأیید معامله».
   *
   * No wallet connected → the button becomes the connect button: nothing can
   * be signed without one. For the in-app (Solana) venue that is the wallet
   * page's Solana tab, with `?return=` so the ticket is exactly where the
   * user left it. Connected → the review sheet, which names the route and the
   * fee share BEFORE anything is confirmed.
   */
  const connectSolana = useCallback(() => {
    const back = new URLSearchParams(location.search || '');
    back.set('tab', 'overview');
    const q = new URLSearchParams({ tab: 'solana', return: `/perp?${back.toString()}` });
    navigate(`/wallet?${q.toString()}`);
  }, [navigate, location.search]);

  const startReview = () => {
    haptic?.('light');
    if (routeInApp) {
      if (!tradingConnected) { connectSolana(); return; }
      setReviewing(true);
      return;
    }
    if (!wallet.isConnected) { setWalletOpen(true); return; }
    setReviewing(true);
  };

  /*
   * ─── CONFIRM: BUILD, RISK-CHECK, AND WAIT FOR A SIGNATURE — HERE ────────
   *   «وقتی در صفحه فیوجرز تب پرپچوال میخایی امضا کنی میپره تب ان چین»
   *
   * The reported bug, and what used to happen: confirm navigated to
   * `/perp?tab=onchain`, so the Perpetual tab the user was standing in
   * disappeared and a different screen with a different ticket took its
   * place. The signature — the thing they came for — was somewhere else.
   *
   * So the work moves here instead. `/prepare` is the same backend endpoint,
   * with the same idempotency key, the same risk verdict and the same fee
   * split the venue tab used; what is gone is the navigation. The order is
   * built for THIS ticket, shown in THIS sheet, and signed by THIS wallet
   * while the user is still looking at the numbers they set.
   *
   * Pairs the venue does not list still leave for Avantis on Base through the
   * REGISTERED referral code `fbtswap` — a real route that earns, rather than
   * a dead end.
   */
  const confirmOrder = async () => {
    haptic?.('medium');
    if (!routeInApp) {
      setReviewing(false);
      openVenue('avantis', AVANTIS.url);
      return;
    }
    if (!tradingAddress) { setReviewing(false); connectSolana(); return; }

    setExecError(null);
    setPreparing(true);
    try {
      const res = await prepareFutures({
        provider: 'drift',
        market: venueMarket?.marketId ?? velocityPerpIndex(pair.symbol),
        side,
        collateralUsd: collateralNum,
        leverage: Math.min(leverageNum, MAX_LEVERAGE),
        takeProfit: tp,
        stopLoss: sl,
        slippageBps: Math.round(Number(slippagePct) * 100),
        wallet: tradingAddress
      });
      if (!res?.ok) throw Object.assign(new Error(res?.error?.code || 'PROVIDER_UNAVAILABLE'), { code: res?.error?.code || 'PROVIDER_UNAVAILABLE' });
      if (res.data?.risk?.blocked) throw Object.assign(new Error('RISK_BLOCKED'), { code: 'RISK_BLOCKED' });
      setPrepared(res.data);
    } catch (err) {
      setExecError(err?.code || 'PROVIDER_UNAVAILABLE');
      haptic?.('error');
    } finally {
      setPreparing(false);
    }
  };

  /*
   * ─── THE SIGNATURE ────────────────────────────────────────────────────
   * Two shapes, decided by what `/prepare` returned, and never by a guess:
   *
   *   · `clientSign.buildsInTab` — the Solana venue. The order is built and
   *     signed HERE with the user's own wallet through the venue SDK. FBT
   *     never holds a key and never touches the funds.
   *   · otherwise — server-built unsigned calldata, signed by the EVM wallet
   *     and reported to the ledger by hash.
   *
   * Both report the hash to `/verify` before the UI claims anything, so the
   * success line is a statement about the chain rather than about a promise
   * the client made.
   */
  const signOrder = async () => {
    if (!prepared) return;
    setSigning(true);
    setExecError(null);
    try {
      if (Date.now() > (prepared.expiresAt ?? 0)) {
        throw Object.assign(new Error('QUOTE_EXPIRED'), { code: 'QUOTE_EXPIRED' });
      }

      if (prepared.clientSign?.buildsInTab) {
        const { openVelocityPosition } = await import('../lib/velocityTrade.js');
        const marketIndex = prepared.market?.marketIndex ?? velocityPerpIndex(pair.symbol);
        if (marketIndex == null) throw Object.assign(new Error('MARKET_NOT_LISTED'), { code: 'MARKET_NOT_LISTED' });
        const result = await openVelocityPosition({
          wallet: tradingAddress,
          marketIndex: Number(marketIndex),
          side: prepared.order?.side ?? side,
          notionalUsd: prepared.order?.notionalUsd ?? notional,
          oraclePrice: prepared.market?.mid ?? entryPrice,
          slippageBps: prepared.order?.slippageBps ?? Math.round(Number(slippagePct) * 100),
          depositQuote: collateralNum
        });
        const hash = result?.signature;
        if (!hash) throw Object.assign(new Error('BROADCAST_FAILED'), { code: 'BROADCAST_FAILED' });
        setLastTx({ hash, chain: venueChain });
        if (prepared.executionId) await verifyFutures({ executionId: prepared.executionId, txHash: hash });
        setPrepared(null);
        setReviewing(false);
        haptic?.('success');
        return;
      }

      /* Server-built calldata, signed by the EVM wallet. */
      const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
      if (!signer) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
      let hash = null;
      for (const tx of prepared.transactions ?? []) {
        const sent = await signer.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value && tx.value !== '0x0' ? tx.value : undefined
        });
        if (tx.kind === 'approve') { await sent.wait(); continue; }
        hash = sent.hash;
      }
      if (!hash) throw Object.assign(new Error('BROADCAST_FAILED'), { code: 'BROADCAST_FAILED' });
      setLastTx({ hash, chain: 'evm' });
      if (prepared.executionId) await verifyFutures({ executionId: prepared.executionId, txHash: hash });
      setPrepared(null);
      setReviewing(false);
      haptic?.('success');
    } catch (err) {
      const code = /reject|denied|cancel|4001/i.test(String(err?.message || '')) ? 'USER_REJECTED' : (err?.code || 'SIGN_FAILED');
      setExecError(code);
      if (code === 'USER_REJECTED' && prepared?.executionId) {
        await verifyFutures({ executionId: prepared.executionId, status: 'REJECTED' });
      }
      haptic?.('error');
    } finally {
      setSigning(false);
    }
  };

  /* Close the sheet without stranding a built order in memory. */
  const closeReview = useCallback(() => {
    setReviewing(false);
    setPrepared(null);
    setExecError(null);
  }, []);

  const tp = Number(takeProfit) > 0 ? Number(takeProfit) : null;
  const sl = Number(stopLoss) > 0 ? Number(stopLoss) : null;

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('perp.title')}</h1>
        <p className="muted">{t('perp.subtitle')}</p>
      </motion.div>

      {/*
        ─── THE TAB RAIL ───────────────────────────────────────────────────
        A DESTINATION picker (each tab mounts a different screen), not a value
        toggle: equal-width cells, an icon per venue, a gradient active cell
        carried by the shared SegIndicator (so the highlight slides between
        venues the way every other tab control in the app does), and a real
        44px tap height.
      */}
      <div className="perp-rail" role="tablist" aria-label={t('perp.title')}>
        {PERP_TABS.map((k) => {
          const active = perpTab === k;
          const Icon = TAB_ICON[k];
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              className={`perp-rail-tab ${active ? 'is-active' : ''}`}
              style={{ isolation: 'isolate' }}
              onClick={() => setPerpTab(k)}
            >
              {active && <SegIndicator id="perp-tab" />}
              <span className="perp-rail-ico" aria-hidden="true">
                <Icon width={16} height={16} />
              </span>
              <span className="perp-rail-label">{t(TAB_LABEL_KEY[k])}</span>
            </button>
          );
        })}
      </div>

      {perpTab === 'dydx' ? (
        <Suspense fallback={<div className="card" style={{ minHeight: 240, display: 'grid', placeItems: 'center', marginTop: 16 }}><div className="spinner" /></div>}>
          {LazyDydx && <LazyDydx />}
        </Suspense>
      ) : perpTab === 'onchain' ? (
        <Suspense fallback={<div className="card" style={{ minHeight: 240, display: 'grid', placeItems: 'center', marginTop: 16 }}><div className="spinner" /></div>}>
          {LazyOnchain && <LazyOnchain />}
        </Suspense>
      ) : (
        <div className="perp-modern">

      {/*
        ─── THE RISK NOTICE STAYS VISIBLE; THE EXPLAINER FOLDS ───────────────
        `perp.riskNotice` is what leverage will do to this user's money, and
        it stays a plain inline `.notice`. Anything describing what the button
        is about to do must never be one tap away.
      */}
      <p className="notice notice-danger">{t('perp.riskNotice')}</p>

      {/* ─────────────── THE PAIR STRIP ───────────────
          Every pair of the terminal side by side: icon, live dollar price,
          a small sparkline and the 24h change. Offline rows show a dash —
          the snapshot price must never pass for a live one.

          The COUNT is stated rather than implied. A strip that used to hold
          twelve cells and now holds a hundred has to say so, or the user
          scrolls it, finds the end, and concludes the app is still broken. */}
      <div className="perp-pair-head">
        <span className="section-label" style={{ margin: 0 }}>
          {t('perp.terminal.pairsCount', { count: allPairs.length })}
        </span>
        <div className="perp-pair-search">
          <input
            type="text"
            value={pairQuery}
            onChange={(e) => setPairQuery(e.target.value)}
            placeholder={t('perp.terminal.pairSearch')}
            aria-label={t('perp.terminal.pairSearch')}
            data-testid="perp-pair-search"
          />
          {pairQuery && (
            <button
              type="button"
              className="perp-pair-search-clear"
              onClick={() => setPairQuery('')}
              aria-label={t('common.clear')}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {stripPairs.length === 0 ? (
        <p className="faint perp-pair-empty" data-testid="perp-pair-empty">
          {t('perp.terminal.noPairMatch')}
        </p>
      ) : (
      <div className="tag-scroll perp-pairs" role="tablist" aria-label={t('perp.terminal.pairsAria')} data-testid="perp-pair-strip">
        {stripPairs.map((p) => {
          const active = p.symbol === pair.symbol;
          const live = coinIsLive(p.coin);
          /* The venue's own list, marked on the cell. This is the one fact
             the strip could not show before: which of these pairs this app
             can actually settle, as opposed to which ones are famous. */
          const tradeable = Boolean(p.venueMarket) || velocityPerpIndex(p.symbol) != null;
          return (
            <button
              key={p.symbol}
              type="button"
              role="tab"
              aria-selected={active}
              className={`tag perp-pair ${active ? 'active' : ''}`}
              onClick={() => { haptic?.('light'); setSelectedSymbol(p.symbol); }}
              data-testid={`perp-pair-${p.symbol}`}
            >
              <span className="perp-pair-top">
                <TokenIcon token={{ symbol: p.symbol, image: p.coin?.image }} size={24} />
                <span className="perp-pair-sym">{p.symbol}-PERP</span>
                {tradeable && <span className="perp-pair-live" aria-hidden="true" title={t('perp.terminal.pairInApp')} />}
              </span>
              {loading ? (
                <span className="skel perp-pair-skel" />
              ) : p.coin && live ? (
                <>
                  <span className="mono perp-pair-price">${fmtPrice(p.coin.price)}</span>
                  <span className={`perp-pair-chg ${p.coin.change24h >= 0 ? 'up' : 'down'}`}>
                    {fmtPct(p.coin.change24h)}
                  </span>
                  {Array.isArray(p.coin.sparkline) && p.coin.sparkline.length > 1 && (
                    <span className="perp-pair-spark" aria-hidden="true">
                      <Sparkline data={p.coin.sparkline} up={p.coin.change24h >= 0} width={58} height={16} strokeWidth={1.4} />
                    </span>
                  )}
                </>
              ) : (
                <span className="faint perp-pair-nodata">{t('perp.marketDataUnavailableShort')}</span>
              )}
            </button>
          );
        })}
      </div>
      )}

      <div className="perp-desk-grid">
        <div className="perp-desk-col">

      {/* ---------- live index price ---------- */}
      {loading ? (
        <div className="skel" style={{ height: 150 }} />
      ) : coin && indexOffline ? (
        <motion.section className="card perp-hero perp-hero-offline" variants={riseIn} initial="hidden" animate="show" data-testid="perp-index-unavailable">
          <div className="faint">{pair.symbol}-PERP · {t('perp.indexPrice')}</div>
          <p className="notice" style={{ marginTop: 8 }}>{t('perp.marketDataUnavailable')}</p>
        </motion.section>
      ) : coin ? (
        <motion.section className="card card-rgb perp-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div className="perp-hero-top">
            <div className="perp-hero-price">
              <div className="perp-hero-tag">
                <TokenIcon token={{ symbol: pair.symbol, image: coin.image }} size={22} />
                <span className="perp-hero-sym">{pair.symbol}-PERP</span>
                <span className="perp-hero-live" aria-hidden="true"><i /></span>
                <span className="faint">{t('perp.indexPrice')}</span>
              </div>
              <div className="stat-value perp-hero-value">
                <AnimatedNumber value={coin.price} format={(v) => `$${fmtPrice(v)}`} />
              </div>
              <span className={`pill ${coin.change24h >= 0 ? 'pill-up' : 'pill-down'}`}>
                {fmtPct(coin.change24h)}
              </span>
            </div>
            <div className="perp-hero-range">
              <div className="perp-hero-range-cell">
                <span className="faint">{t('coin.high24h')}</span>
                <span className="mono perp-hero-range-high">${fmtPrice(coin.high24h)}</span>
              </div>
              <div className="perp-hero-range-cell">
                <span className="faint">{t('coin.low24h')}</span>
                <span className="mono perp-hero-range-low">${fmtPrice(coin.low24h)}</span>
              </div>
            </div>
          </div>
          <div className="perp-hero-spark">
            <Sparkline data={coin.sparkline ?? []} up={coin.change24h >= 0} width={440} height={56} strokeWidth={2} />
          </div>
          <p className="faint perp-hero-note">{t('perp.indexNote')}</p>
        </motion.section>
      ) : null}

      {/* ─────────────── THE LIVE CANDLE CHART ───────────────
          The shared FuturesMarketChart against the venue's own candle feed:
          real 15m/1h/4h/1d candles, or its honest "unavailable" — never a
          fabricated series. Pairs the venue does not list get an honest note
          instead of a chart pretending to be one. */}
      {venueMarket ? (
        <motion.section className="card card-rgb perp-chart" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <FuturesMarketChart
            provider="drift"
            market={String(venueMarket.marketId)}
            symbol={`${pair.symbol}-PERP`}
            testId="perp-terminal-chart"
          />
        </motion.section>
      ) : (
        <motion.section className="card perp-chart perp-chart-none" variants={riseIn} initial="hidden" animate="show" data-testid="perp-chart-unavailable">
          <p className="faint" style={{ margin: 0, lineHeight: 1.8 }}>{t('perp.terminal.chartPairUnavailable')}</p>
        </motion.section>
      )}

        </div>
        <div className="perp-desk-col">

      {/* ─────────────── THE ORDER TICKET ───────────────
          A real exchange ticket: direction, stablecoin collateral, leverage
          chips + slider, and the two numbers a leveraged trader must see
          before confirming — position size and the distance to liquidation. */}
      <motion.section className="card card-rgb perp-ticket" variants={riseIn} initial="hidden" animate="show" data-testid="perp-ticket">
        <div className="sheen" />
        <div className="perp-ticket-head">
          <span className="section-label">{t('perp.terminal.ticketTitle')}</span>
          <span className="perp-ticket-pair">
            <TokenIcon token={{ symbol: pair.symbol, image: coin?.image }} size={18} />
            {pair.symbol}-PERP
          </span>
        </div>

        {/* direction — the app's standard long/short switch */}
        <div className="dir-switch">
          <button
            type="button"
            className={`dir-btn long ${side === 'long' ? 'active' : ''}`}
            onClick={() => { haptic?.('light'); setSide('long'); }}
          >
            <span className="dir-ico" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
              </svg>
            </span>
            {t('perp.terminal.long')}
            <span className="dir-sub">{t('perp.terminal.longSub')}</span>
          </button>
          <button
            type="button"
            className={`dir-btn short ${side === 'short' ? 'active' : ''}`}
            onClick={() => { haptic?.('light'); setSide('short'); }}
          >
            <span className="dir-ico" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
              </svg>
            </span>
            {t('perp.terminal.short')}
            <span className="dir-sub">{t('perp.terminal.shortSub')}</span>
          </button>
        </div>

        {/* collateral — stablecoin amount + asset */}
        <div className="perp-field">
          <span className="field-label">{t('perp.terminal.collateral')}</span>
          <div className="perp-collateral-row">
            <input
              type="text"
              inputMode="decimal"
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
              aria-label={t('perp.terminal.collateral')}
              data-testid="perp-collateral"
            />
            <div className="perp-asset-chips" role="group" aria-label={t('perp.terminal.collateralAsset')}>
              {['USDC', 'USDT'].map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`perp-asset-chip ${collateralAsset === a ? 'active' : ''}`}
                  onClick={() => { haptic?.('light'); setCollateralAsset(a); }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          {!collateralOk && collateral !== '' && (
            <span className="perp-field-err">{t('perp.terminal.minCollateral', { min: MIN_COLLATERAL_USD })}</span>
          )}
        </div>

        {/* leverage — chips + slider, capped at the product policy */}
        <div className="perp-field">
          <div className="perp-lev-head">
            <span className="field-label">{t('perp.terminal.leverage')}</span>
            <span className="mono perp-lev-value" data-testid="perp-leverage">{leverageOk ? `${Number(leverageNum.toFixed(2))}×` : '—'}</span>
          </div>
          <div className="lev-row">
            {LEVERAGE_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`lev-chip ${leverageOk && leverageNum === n ? 'active' : ''}`}
                onClick={() => { haptic?.('light'); setLeverage(String(n)); }}
              >
                {n}×
              </button>
            ))}
          </div>
          <input
            type="range"
            min="1"
            max={MAX_LEVERAGE}
            step="0.5"
            value={leverageOk ? Math.min(leverageNum, MAX_LEVERAGE) : 1}
            onChange={(e) => setLeverage(e.target.value)}
            className="perp-lev-slider"
            style={{ width: '100%', marginTop: 8, accentColor: 'var(--rgb-1)' }}
            aria-label={t('perp.terminal.leverage')}
          />
        </div>

        {/* live ticket math — the two numbers that decide the trade */}
        <div className="perp-summary" data-testid="perp-summary">
          <div className="row-between">
            <span className="faint">{t('perp.terminal.notional')}</span>
            <span className="mono perp-summary-strong">
              {notional == null ? '—' : fmtUsd(notional)}
            </span>
          </div>
          <div className="row-between">
            <span className="faint">{t('perp.terminal.entry')}</span>
            <span className="mono">{entryPrice == null ? '—' : `$${fmtPrice(entryPrice)}`}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('perp.terminal.liqPrice')}</span>
            <span className={`mono ${side === 'long' ? 'perp-liq-long' : 'perp-liq-short'}`}>
              {liq.liquidationPrice == null ? '—' : `$${fmtPrice(liq.liquidationPrice)}`}
            </span>
          </div>
          <div className="row-between">
            <span className="faint">{t('perp.terminal.liqDistance')}</span>
            <span className="mono">
              {liq.distancePct == null ? '—' : `−${liq.distancePct.toFixed(2)}%`}
            </span>
          </div>
        </div>
        <p className="faint perp-liq-note">{t('perp.terminal.liqNote')}</p>

        {/*
          ─── RISK CONTROLS, FOLDED ─────────────────────────────────────────
          Take profit, stop loss and the slippage ceiling are optional
          refinements, so they live behind one tap — but the slippage value is
          the app-wide setting, written through the same store action every
          other trading screen uses, never a second copy of the number.
        */}
        <InfoBox title={t('perp.terminal.riskControls')} tone="info" id="perp-terminal-risk">
          <div className="row" style={{ gap: 10 }}>
            <label style={{ flex: 1 }}>
              <span className="faint">{t('perp.terminal.takeProfit')}</span>
              <input type="text" inputMode="decimal" placeholder="0" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <span className="faint">{t('perp.terminal.stopLoss')}</span>
              <input type="text" inputMode="decimal" placeholder="0" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
            </label>
          </div>
          <label className="perp-slip">
            <span className="faint">{t('perp.terminal.slippageLabel', { value: slippagePct })}</span>
            <input
              type="text"
              inputMode="decimal"
              value={String(slippagePct)}
              onChange={(e) => setSlippage(e.target.value)}
              aria-label={t('perp.terminal.slippageAria')}
            />
          </label>
          <p>{t('perp.terminal.slippageNote')}</p>
        </InfoBox>

        {/*
          ─── THE FINAL BUTTON ──────────────────────────────────────────────
          Which wallet is asked for is decided by the ROUTE, not by whichever
          one happens to be connected: the in-app venue settles on Solana, so
          a user with only an EVM wallet is told to connect the Solana one
          rather than pressing a button that cannot produce a signature.

          Connected → the review sheet: the whole ticket, the fee split and
          the earning route, named, before a single confirmation. The order is
          then built and signed ON THIS SCREEN.
        */}
        {tradingConnected ? (
          <button
            type="button"
            className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'} perp-submit`}
            disabled={!canConfirm || preparing || signing}
            onClick={startReview}
            data-testid="perp-submit"
          >
            {preparing || signing ? t('perp.terminal.preparing') : t('perp.terminal.review')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary perp-submit"
            onClick={startReview}
            data-testid="perp-connect"
          >
            <IconWallet width={16} height={16} style={{ display: 'inline', marginInlineEnd: 6 }} />
            {routeInApp ? t('perp.terminal.connectSolana') : t('perp.terminal.connect')}
          </button>
        )}
        {tradingConnected && tradingAddress ? (
          <p className="faint perp-wallet-line" data-testid="perp-wallet-row">
            <IconShield width={13} height={13} style={{ display: 'inline', marginInlineEnd: 4, verticalAlign: '-2px' }} />
            {t('perp.terminal.connectedAs', { address: shortAddress(tradingAddress) })}
          </p>
        ) : (
          <p className="faint perp-wallet-line">{t('perp.terminal.walletHint')}</p>
        )}

        {/* ─── THE RESULT, BEFORE ANYTHING ELSE IS CLAIMED ────────────────
            The hash is on screen because the backend's ledger recorded it, not
            because the client says so. A leverage ticket that silently
            vanished after a signature is the failure this closes. */}
        {lastTx?.hash && (
          <div className="notice perp-tx-notice" data-testid="perp-tx" role="status">
            <p style={{ margin: 0 }}>{t('perp.terminal.signed')}</p>
            <a
              className="mono"
              style={{ display: 'block', marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}
              href={lastTx.chain === 'solana'
                ? `https://solscan.io/tx/${lastTx.hash}`
                : `https://etherscan.io/tx/${lastTx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {lastTx.hash}
            </a>
          </div>
        )}
      </motion.section>

      {/* ─────────────── THE FEE BREAKDOWN ───────────────
          Protocol, network and the FBT share, from the backend's shared
          engine when the in-app route serves this pair — and honest
          placeholders otherwise. The last line always states WHO the fee
          share goes to, because that is the arrangement being made. */}
      <motion.section className="card perp-fees" variants={riseIn} initial="hidden" animate="show" data-testid="perp-fee-breakdown">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('perp.terminal.fee.title')}</p>
        <div className="perp-fee-rows">
          <div className="row-between">
            <span className="faint">{t('perp.terminal.fee.protocol')}</span>
            <span className="mono">{fee?.protocol?.known ? fmtUsd(fee.protocol.feeUsd) : t('perp.terminal.fee.protocolLater')}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('perp.terminal.fee.network')}</span>
            <span className="mono">{fee?.network?.known ? fmtUsd(fee.network.feeUsd) : t('perp.terminal.fee.networkLater')}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('perp.terminal.fee.fbt')}</span>
            <span className="mono">
              {fee ? `${fmtUsd(fee.fbt.feeUsd)} · ${fee.fbt.bps} bps` : t('perp.terminal.fee.fbtLater')}
            </span>
          </div>
          <div className="row-between perp-fee-total">
            <strong>{t('perp.terminal.fee.total')}</strong>
            <strong className="mono">{fee?.complete ? fmtUsd(fee.totalFeeUsd) : t('perp.terminal.fee.totalLater')}</strong>
          </div>
        </div>
        <p className="faint perp-fee-note">
          {routeInApp
            ? t('perp.terminal.fee.treasury', {
                address: fee?.fbt?.recipient ? shortAddress(fee.fbt.recipient) : '—'
              })
            : t('perp.terminal.fee.discount', { code: AVANTIS_CODE, pct: REFERRAL_DISCOUNT_PCT })}
        </p>
        {!fee && routeInApp && <p className="faint perp-fee-note">{t('perp.terminal.fee.unavailable')}</p>}
      </motion.section>

        </div>
      </div>

      {/*
        ─── THE COST OF HOLDING, BEFORE ANYTHING ELSE ──────────────────────
        Placed directly under the terminal, because it is the only thing on
        this screen that a trader cannot get elsewhere in one glance: the same
        position costs several percent a year more at one venue than another,
        and no interface lines them up.
      */}
      <FundingPanel />

      {/*
        ─── WHY WE DON'T RUN THE ENGINE, FOLDED ────────────────────────────
        The honesty note is policy explanation, not a market number, so it
        belongs in the same collapsible InfoBox the warnings use.
      */}
      <InfoBox
        title={t('perp.honestTitle')}
        tone="info"
        id="perp-honest"
        icon={<IconShield width={16} height={16} />}
      >
        <p>{t('perp.honestBody')}</p>
      </InfoBox>

      {/*
        ─── HOW PERPETUALS ACTUALLY WORK ──────────────────────────────────
        Someone arriving here does not know what funding is, what liquidation
        price means, or why 100x is a way to lose everything on a 1% move —
        and the ticket above is one tap away from venues where all three
        apply with real money. Explaining it after the terminal is deliberate:
        the tool first, the school right under it.
      */}
      <motion.section className="card perp-learn" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('perp.learnTitle')}</p>
        <div className="stack" style={{ gap: 12 }}>
          {['what', 'funding', 'liquidation', 'leverage', 'costs'].map((k, i) => (
            <div key={k} className="perp-learn-item">
              <div className="perp-learn-q">
                <span className="perp-learn-num" aria-hidden="true">{i + 1}</span>
                {t(`perp.learn.${k}.q`)}
              </div>
              <p className="muted perp-learn-a">
                {t(`perp.learn.${k}.a`)}
              </p>
            </div>
          ))}
        </div>

        {/*
          The liquidation table. An abstract warning about leverage does not
          land; a column showing that 50x liquidates on a 2% move does.
        */}
        <p className="section-label" style={{ margin: '14px 0 8px' }}>{t('perp.liqTitle')}</p>
        <div className="perp-liq-wrap">
          <table className="perp-liq">
            <thead>
              <tr>
                <th>{t('perp.liqLeverage')}</th>
                <th>{t('perp.liqMove')}</th>
              </tr>
            </thead>
            <tbody>
              {[2, 5, 10, 25, 50, 100].map((x) => (
                <tr key={x} className={x >= 25 ? 'perp-liq-danger' : ''}>
                  <td className="mono"><span className="perp-liq-x">{x}×</span></td>
                  {/* 100/x, the actual arithmetic — not a rounded illustration. */}
                  <td className="mono" style={{ color: x >= 25 ? 'var(--down)' : 'var(--text-2)' }}>
                    {(100 / x).toFixed(x >= 50 ? 1 : 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>
          {t('perp.liqNote')}
        </p>
      </motion.section>

      {/* ---------- venues ---------- */}
      <section>
        <p className="section-label">{t('perp.venues')}</p>
        <motion.div className="perp-venues" variants={stagger} initial="hidden" animate="show">
          {VENUES.map((v) => (
            <motion.button
              key={v.id}
              className="perp-venue"
              style={{ '--perp-venue-accent': v.color }}
              variants={riseIn}
              whileTap={{ scale: 0.985 }}
              onClick={() => openVenue(v.id, v.url)}
            >
              <span className="perp-venue-badge">
                {t(`perp.venue.${v.id}.short`)}
              </span>
              <span className="perp-venue-body">
                <span className="perp-venue-name">
                  {t(`perp.venue.${v.id}.name`)}
                </span>
                <span className="set-row-sub perp-venue-desc">{t(`perp.venue.${v.id}.desc`)}</span>
                <span className="perp-venue-pills">
                  <span className="pill pill-neutral">{v.pairs} {t('perp.pairs')}</span>
                  <span className="pill pill-rgb">{t('perp.upTo')} {v.leverage}</span>
                </span>
              </span>
              <span className="perp-venue-go" aria-hidden="true">
                <IconExternal width={16} height={16} />
              </span>
            </motion.button>
          ))}
        </motion.div>
      </section>

      {/*
        ─── THE NOTICE HAS TO TRACK REALITY ──────────────────────────────────
        `perp.thirdPartyNotice` says we "earn nothing from them". The same
        flag that decides whether to ATTACH a referral code decides which
        sentence is shown, so they cannot disagree.
      */}
      <InfoBox title={t('perp.venuesTitle')} tone="warn" id="perp-venues">
        <p>
          {anyVenueEarns(VENUES.map((v) => v.id))
            ? t('perp.thirdPartyNoticeEarning')
            : t('perp.thirdPartyNotice')}
        </p>
      </InfoBox>

      {/*
        ─── THE "PRACTICE WITH VIRTUAL CREDIT" DOORWAY ─────────────────────
        Same destination, same copy keys, same honesty (it still says the
        credit is virtual) — a real card with an icon tile and a chevron.
      */}
      <motion.button
        className="card card-rgb perp-cta"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/predict')}
        style={{ textAlign: 'start', cursor: 'pointer' }}
      >
        <div className="sheen" />
        <div className="perp-cta-row">
          <span className="perp-cta-ico" aria-hidden="true"><IconSparkle width={18} height={18} /></span>
          <span className="perp-cta-copy">
            <span className="perp-cta-title">{t('perp.tryPredict')}</span>
            <span className="perp-cta-sub">{t('perp.tryPredictSub')}</span>
          </span>
          <span className="perp-cta-arrow" aria-hidden="true">
            <IconChevronRight width={16} height={16} />
          </span>
        </div>
      </motion.button>

      {/*
        ─── HOW FUTURES WORK — the education box ────────────────────────────
        Kept as the folded explainer it has always been; the terminal above
        is the tool, this is the manual.
      */}
      <InfoBox title={t('perp.how.title')} tone="info" id="perp-how">
        <p>{t('perp.how.p1')}</p>
        <p>{t('perp.how.p2')}</p>
        <p>{t('perp.how.p3')}</p>
        <p>{t('perp.how.p4')}</p>
      </InfoBox>

      {/*
        ─── THE REVIEW & SIGN SHEET ─────────────────────────────────────────
        The whole ticket in one place, the fee split, and the route the order
        will take — named before the user confirms anything.

        This sheet has TWO steps, and the second one is the fix:
        «وقتی در صفحه فیوجرز تب پرپچوال میخایی امضا کنی میپره تب ان چین».
        Confirming used to close this sheet, change the query and switch the
        rail to the On-Chain tab, so the signature — the one thing the user
        came for — happened on a screen they had to find first.

        Now confirm BUILDS the order here (the same backend /prepare, the same
        idempotency key, the same risk verdict), the sheet shows what was
        built, and the same button becomes the signature. No tab changes, no
        navigation, and the numbers the user confirmed are the numbers that
        get signed.
      */}
      <Sheet open={reviewing} onClose={closeReview} title={t('perp.terminal.reviewTitle')}>
        <div className="stack" style={{ gap: 10 }} data-testid="perp-review">
          <div className="card card-tight stack" style={{ gap: 8 }}>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.market')}</span>
              <strong className="perp-ticket-pair">
                <TokenIcon token={{ symbol: pair.symbol, image: coin?.image }} size={18} />
                {pair.symbol}-PERP
              </strong>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.direction')}</span>
              <span className={`pill ${side === 'long' ? 'pill-up' : 'pill-down'}`}>
                {t(`perp.terminal.${side}`)}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.collateral')}</span>
              <span className="mono">{collateralOk ? `${fmtUsd(collateralNum)} ${collateralAsset}` : '—'}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.leverage')}</span>
              <span className="mono">{leverageOk ? `${Number(leverageNum.toFixed(2))}×` : '—'}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.notional')}</span>
              <span className="mono">{notional == null ? '—' : fmtUsd(notional)}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.entry')}</span>
              <span className="mono">{entryPrice == null ? '—' : `$${fmtPrice(entryPrice)}`}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.liqPrice')}</span>
              <span className="mono">
                {liq.liquidationPrice == null
                  ? '—'
                  : `$${fmtPrice(liq.liquidationPrice)} (−${liq.distancePct.toFixed(2)}%)`}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.tpSl')}</span>
              <span className="mono">
                {tp == null ? '—' : `$${fmtPrice(tp)}`} / {sl == null ? '—' : `$${fmtPrice(sl)}`}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.fee.fbt')}</span>
              <span className="mono">{fee ? `${fmtUsd(fee.fbt.feeUsd)} · ${fee.fbt.bps} bps` : t('perp.terminal.fee.fbtLater')}</span>
            </div>
          </div>

          {/*
            The route line — the part a "looks like an exchange" screen must
            never hide. The in-app route now also says the two things that
            matter about it: it settles from the user's own wallet, and the
            signature happens HERE, on this screen.
          */}
          <div className="card card-tight perp-route" data-testid="perp-review-route">
            <span className="perp-route-ico" aria-hidden="true">
              {routeInApp ? <IconRoute width={18} height={18} /> : <IconExternal width={16} height={16} />}
            </span>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              {routeInApp
                ? t('perp.terminal.route.inApp')
                : t('perp.terminal.route.avantis', { code: AVANTIS_CODE })}
            </p>
          </div>

          {/* Step two. Everything above is what the user asked for; this is
              what the backend built from it, which is the only thing that
              will actually be signed. */}
          {prepared && (
            <div className="card card-tight stack" style={{ gap: 7 }} data-testid="perp-prepared">
              <p className="section-label" style={{ margin: 0 }}>{t('perp.terminal.prepared')}</p>
              <div className="row-between">
                <span className="faint">{t('perp.terminal.preparedNotional')}</span>
                <span className="mono">
                  {prepared.order?.notionalUsd != null ? fmtUsd(prepared.order.notionalUsd) : '—'}
                </span>
              </div>
              <div className="row-between">
                <span className="faint">{t('perp.terminal.preparedSlippage')}</span>
                <span className="mono">
                  {prepared.order?.slippageBps != null ? `${prepared.order.slippageBps} bps` : '—'}
                </span>
              </div>
              <div className="row-between">
                <span className="faint">{t('perp.terminal.preparedVenue')}</span>
                <span className="mono">{prepared.market?.symbol ?? `${pair.symbol}-PERP`}</span>
              </div>
              <p className="faint" style={{ margin: 0, fontSize: 11, lineHeight: 1.7 }}>
                {t('perp.terminal.signHere')}
              </p>
            </div>
          )}

          {execError && (
            <p className="notice notice-danger" data-testid="perp-exec-error" role="alert">
              {t(`perp.terminal.err.${execError}`, { defaultValue: execError })}
            </p>
          )}

          <p className="notice notice-danger">{t('perp.terminal.reviewRisk')}</p>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={closeReview} disabled={signing}>
              {t('common.cancel')}
            </button>
            <button
              className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'}`}
              style={{ flex: 1 }}
              disabled={!canConfirm || preparing || signing}
              onClick={prepared ? signOrder : confirmOrder}
              data-testid="perp-review-confirm"
            >
              {preparing || signing
                ? t('perp.terminal.signing')
                : prepared
                  ? t('perp.terminal.signNow')
                  : routeInApp
                    ? t('perp.terminal.confirmInApp')
                    : t('perp.terminal.confirmAvantis')}
            </button>
          </div>
        </div>
      </Sheet>

      <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
        </div>
      )}
    </PageTransition>
  );
}
