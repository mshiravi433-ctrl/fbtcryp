import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
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
import { IconActivity, IconRoute, IconShield, IconSparkle, IconTrend } from '../components/Icons';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { SPECULATION_ENABLED } from '../lib/features';
import { getFuturesFeePreview, getFuturesMarkets, prepareFutures, verifyFutures } from '../lib/futuresClient';
import { liquidationDistance } from '../lib/futures-engine';
import {
  ROUTE, ROUTE_META, PERP_OWN_ERRORS, indexVenueMarkets, pickRoute, leverageCeiling,
  dydxOrderSize, classifyDydxOrderError
} from '../lib/perpRoutes';
import { FUTURES_ERRORS, mapFuturesError } from '../lib/futures-engine/errors';
import {
  classifyDydxError, connectDydx, disconnectDydx, dydxFeeUsd, dydxSessionAddress, getDydxMarkets, getDydxSubaccount,
  placeDydxOrder, DYDX_BUILDER_ADDRESS, DYDX_BUILDER_FEE_PPM
} from '../lib/dydx';
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
 * ─── THERE IS NO EXTERNAL VENUE ON THIS PAGE ANY MORE ─────────────────────
 *   «بخش لینک معامله در فیوجرز خارجی را حذف کن»
 *
 * This table used to hold four outbound venues, and every button on it left
 * the app: the user read a price here, and was handed to somebody else's
 * order book to act on it. That is a worse product than not offering the
 * pair, because the quote and the fill belong to different books — the
 * number on this screen is not the number they get.
 *
 * So the table is gone, along with the code that opened it. What replaces it
 * is not a redirect: it is the in-app route, which builds, risk-checks and
 * signs the order against the same venue feed this list is priced from. A
 * pair the in-app venue does not list is now SAYS SO on its own row instead
 * of being a promise made by a link.
 */

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

/* Product policy: the 50× ceiling the futures engine enforces lives in
   lib/perpRoutes.js (HARD_MAX_LEVERAGE) and is lowered per venue market. */
const LEVERAGE_PRESETS = [2, 5, 10, 20, 50];
const MIN_COLLATERAL_USD = 5;
/* Both referral venues discount the referred trader's fees by 5% — documented
   in lib/venueReferral.js, which is the single source of truth for this. */
const REFERRAL_DISCOUNT_PCT = 5;

/** Any thrown thing → a code the ticket has a sentence for. The engine's own
 *  codes and the flow's own codes pass through; everything else is mapped
 *  (never shown raw, never a hex revert string). */
const errorCode = (err) => {
  const raw = String(err?.code ?? '');
  if (FUTURES_ERRORS[raw] || PERP_OWN_ERRORS.includes(raw)) return raw;
  return mapFuturesError(err).code;
};

/** A feed row is LIVE only when the provider says so — the offline snapshot
 *  must never sit under a live-price label on a leveraged screen. */
const coinIsLive = (c) => Boolean(c) && c.offline !== true && c.dataProvenance !== 'offline';

export default function Perp() {
  const { t } = useTranslation();
  const location = useLocation();
  const { haptic } = useTelegram();
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
   * order is built by the backend (or, for dYdX, by the client session), risk
   * -checked, and signed by the user's own wallet — in this tab, where they
   * asked to be.
   */
  const [side, setSide] = useState('long');
  const [collateral, setCollateral] = useState('100');
  const [leverage, setLeverage] = useState('5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  /*
   * ─── THE VENUE FEEDS (three reads, refreshed every 30s) ──────────────────
   *   «بیشتر جفت توکن ها اصلا نمیشه معامله کرد … باید داخل اپ خودمون انجام شود»
   *
   * This used to read ONE venue — Velocity, four markets — and call every other
   * pair «not listed». The app already settles orders inside itself on three
   * venues (Velocity on Solana, Ostium on Arbitrum, dYdX), and together they
   * list every pair in this catalogue. So the page reads all three, merges
   * them by base symbol (lib/perpRoutes.js), and each pair is routed to a venue
   * whose wallet the user actually has.
   *
   * A venue that is down keeps its LAST good list rather than emptying the
   * page: a flaky read must not make a tradable pair vanish mid-ticket. The
   * static Velocity index stays as the conservative ROUTING fallback only —
   * the chart says «unavailable» on its own and never draws a flat line.
   */
  const [venues, setVenues] = useState({ velocity: [], ostium: [], dydx: [], dydxLoaded: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [v, o, d] = await Promise.allSettled([
        getFuturesMarkets('drift'),
        getFuturesMarkets('ostium'),
        getDydxMarkets()
      ]);
      if (!alive) return;
      const bff = (r) => (r.status === 'fulfilled' && r.value?.ok && Array.isArray(r.value.data?.markets) ? r.value.data.markets : null);
      const dydxRows = d.status === 'fulfilled' && Array.isArray(d.value?.markets) && d.value.markets.length ? d.value.markets : null;
      setVenues((cur) => ({
        velocity: bff(v) ?? cur.velocity,
        ostium: bff(o) ?? cur.ostium,
        dydx: dydxRows ?? cur.dydx,
        dydxLoaded: cur.dydxLoaded || Boolean(dydxRows)
      }));
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  /** base symbol → { velocity?, ostium?, dydx? } */
  const routeIndex = useMemo(() => indexVenueMarkets(venues), [venues]);
  const venueBases = useMemo(() => [...routeIndex.keys()].map((base) => ({ base })), [routeIndex]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const c of coins ?? []) m.set(c.id, c);
    return m;
  }, [coins]);

  /*
   * ─── THE PAIR UNIVERSE, BUILT ───────────────────────────────────────────
   * Featured + whatever the venues list + the live market table, merged
   * (see buildPerpPairs). The selection is kept by SYMBOL rather than by
   * coin id, because a venue-listed pair the market feed has never heard of
   * has no id at all — keying on one would make it unselectable, which is
   * exactly the class of pair this screen most needs to offer.
   */
  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [pairQuery, setPairQuery] = useState('');
  /*
   * ─── THE TRADE SHEET IS WHERE THE TICKET LIVES NOW ───────────────────────
   *   «وقتی روی [توکن] زدی یک پاپ‌آپ که کل صفحه را بگیرد … نباید صفحه شلوغ
   *    شود»
   *
   * The page was a terminal: a hundred-pair strip, a hero, a chart, a ticket, a
   * fee table and a liquidation table, all at once, on one scroll. Every one of
   * those is real, and together they meant the user could not see the LIST —
   * which is the only thing this screen is for. So the list is the page, and
   * everything else moved into a full-height sheet that one tap opens on the
   * pair that was actually tapped.
   *
   * The ticket's state was NOT reset on close. Amount, leverage, side and the
   * take-profit/stop-loss a user typed are theirs; reopening the sheet to find
   * a cleared form is how a ticket gets abandoned half-filled.
   */
  const [tradeOpen, setTradeOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const openTrade = useCallback((symbol) => {
    if (symbol) setSelectedSymbol(symbol);
    setTradeOpen(true);
  }, []);
  const closeTrade = useCallback(() => setTradeOpen(false), []);

  const allPairs = useMemo(
    () => buildPerpPairs({ coins: coins ?? [], venueMarkets: venueBases }),
    [coins, venueBases]
  );

  /*
   * Once the broad catalogue (dYdX) has answered, the list offers ONLY pairs a
   * venue settles. A row whose trade button could only ever say «not open» is
   * not a pair, it is a promise — and this screen was full of them. Until the
   * catalogue answers (first paint, or every feed down) nothing is hidden, so
   * a slow network never shows an empty page.
   */
  const listPairs = useMemo(
    () => (venues.dydxLoaded ? allPairs.filter((p) => routeIndex.has(p.symbol)) : allPairs),
    [allPairs, routeIndex, venues.dydxLoaded]
  );

  /* The search box exists because a hundred-plus cells cannot be browsed. It
     filters by ticker OR by the coin's own name, and it never re-orders: the
     featured majors stay first whatever is typed. */
  const stripPairs = useMemo(() => {
    const rows = listPairs.map((p) => ({
      ...p,
      coin: p.id ? byId.get(p.id) ?? null : null,
      routes: routeIndex.get(p.symbol) ?? null
    }));
    const q = pairQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) => p.symbol.toLowerCase().includes(q)
        || String(p.coin?.name ?? '').toLowerCase().includes(q)
    );
  }, [listPairs, byId, routeIndex, pairQuery]);

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

  /*
   * ─── WHICH WALLET SIGNS — AND WHICH ROUTE FITS IT ────────────────────────
   *   «با وجود کیف پول داخلی وصل شده میگه کیف پول وصل کن»
   *
   * The reported bug, exactly: the ticket took whichever address existed
   * (Solana first, else the EVM one) and sent it to the Solana-only venue. The
   * in-app wallet is an EVM wallet, so a perfectly connected user was handed an
   * order that could only be signed on Solana, and the signer answered «wallet
   * not connected» — true of the WRONG chain, and untrue to the person reading.
   *
   * So the route is chosen FROM the wallets the user has (pickRoute): an
   * EVM-only user trading BTC lands on Ostium or dYdX, a Solana-only user on
   * Velocity. When the only venue for a pair needs a wallet family the user
   * does not have, the button says WHICH one — it never says «connect a
   * wallet» to somebody who has one.
   *
   * "Connected" is read from the ADDRESS rather than from whatever boolean the
   * context exposes: the address is what gets signed and what the fee is
   * charged against. `isConnected` is still honoured when present, because the
   * real context sets it false while a session is LOCKED — an address with a
   * locked session cannot sign, and pretending otherwise moves the failure from
   * the button that starts it into the signing dialog.
   */
  const evmReady = Boolean(wallet.address) && wallet.isConnected !== false;
  const solReady = Boolean(solWallet.address);
  const pairRoutes = routeIndex.get(pair.symbol) ?? null;
  const pick = useMemo(() => pickRoute(pairRoutes, { solana: solReady, evm: evmReady }), [pairRoutes, solReady, evmReady]);
  const route = pick.route;
  const routeEntry = route ? pairRoutes[route] : null;
  const meta = route ? ROUTE_META[route] : null;
  /* «needs a X wallet» is only said to someone who HAS a wallet (of the wrong
     family). With none at all the button just says «connect wallet». */
  const needsFamily = pick.reason === 'NEEDS_WALLET' && (evmReady || solReady) ? pick.needs : null;
  const tradingAddress = !meta ? null : meta.family === 'solana' ? (solWallet.address ?? null) : (evmReady ? wallet.address : null);
  const tradingConnected = Boolean(tradingAddress);
  const routeInApp = Boolean(route);
  const supportsTpSl = route === ROUTE.OSTIUM;
  /* The candles come from the venue that settles the pair, so the chart and the
     fill are the same book. No route → the market feed's own OHLC, if it has
     an id for the coin. */
  const chartCfg = route === ROUTE.VELOCITY ? { provider: 'drift', market: routeEntry.marketId }
    : route === ROUTE.OSTIUM ? { provider: 'ostium', market: routeEntry.marketId }
    : route === ROUTE.DYDX ? { provider: 'dydx', market: routeEntry.marketId }
    : pair.id ? { provider: 'spot', market: pair.id } : null;

  /* ─── ticket arithmetic — pure, live, transparent ─────────────────────── */
  const maxLeverage = leverageCeiling(routeEntry);
  const minCollateral = meta?.minCollateralUsd ?? MIN_COLLATERAL_USD;
  const collateralNum = Number(collateral);
  const leverageNum = Number(leverage);
  const collateralOk = Number.isFinite(collateralNum) && collateralNum >= minCollateral;
  const leverageOk = Number.isFinite(leverageNum) && leverageNum >= 1 && leverageNum <= maxLeverage;
  const notional = collateralOk && leverageOk ? collateralNum * leverageNum : null;

  /* The venue's own cap: a leverage it would refuse is clamped here, not
     discovered as LEVERAGE_TOO_HIGH after the user has read the review. */
  useEffect(() => {
    if (Number(leverage) > maxLeverage) setLeverage(String(maxLeverage));
  }, [maxLeverage, leverage]);
  const leveragePresets = useMemo(() => {
    const base = LEVERAGE_PRESETS.filter((n) => n <= maxLeverage);
    if (maxLeverage < LEVERAGE_PRESETS[LEVERAGE_PRESETS.length - 1] && !base.includes(maxLeverage)) base.push(maxLeverage);
    return base;
  }, [maxLeverage]);

  /*
   * Entry reference: the live spot index (polled every 30s) when the feed is
   * live, else the venue's own mid from the venue read. Both offline → null →
   * every dependent number renders "—" instead of a guess.
   */
  const liveSpot = coinIsLive(coin) && Number(coin?.price) > 0 ? Number(coin.price) : null;
  const venueMid = Number(routeEntry?.mid) > 0 ? Number(routeEntry.mid) : null;
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
   * Velocity and Ostium: computed by the shared engine inside the BFF from the
   * venue's own fee parameters. dYdX is client-signed, so its one number that
   * is known exactly — our builder fee, which is INSIDE the signed order — is
   * stated from the same constant the order carries; its protocol fee stays an
   * honest placeholder. An unreachable backend leaves the rows as «shown at
   * review» instead of invented dollars.
   */
  const [fee, setFee] = useState(null);
  useEffect(() => {
    if (!route || !routeEntry || !collateralOk || !leverageOk) { setFee(null); return undefined; }
    if (route === ROUTE.DYDX) {
      const feeUsd = dydxFeeUsd(notional);
      setFee(feeUsd == null ? null : {
        notionalUsd: notional,
        protocol: { known: false },
        network: { known: false },
        fbt: { bps: DYDX_BUILDER_FEE_PPM / 100, feeUsd, recipient: DYDX_BUILDER_ADDRESS },
        totalFeeUsd: null,
        complete: false
      });
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      getFuturesFeePreview({ provider: meta.providerId, market: String(routeEntry.marketId), collateralUsd: collateralNum, leverage: leverageNum })
        .then((r) => { if (alive) setFee(r?.ok ? (r.data?.fee ?? null) : null); })
        .catch(() => { if (alive) setFee(null); });
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
  }, [route, routeEntry?.marketId, meta?.providerId, collateralOk, leverageOk, collateralNum, leverageNum, notional]);

  /*
   * ─── THE TAB STILL FOLLOWS THE URL (the Intent OS hand-off) ─────────────
   * Deep links still name their tab (`/perp?tab=onchain&…`), so the rail and
   * the query have to agree — otherwise a hand-off would change the URL and
   * leave the same screen mounted.
   *
   * What it no longer does is MOVE THE USER. That was the bug: signing in
   * the Perpetual tab used to `setPerpTab('onchain')` and navigate, so pressing
   * the button the user had just been looking at silently threw them onto a
   * different tab with a different layout. The order is now built, risk
   * checked and signed on this screen — see `confirmOrder` / `signOrder`.
   */
  useEffect(() => {
    if (!SPECULATION_ENABLED) return;
    try {
      const want = new URLSearchParams(location.search || '').get('tab');
      if ((want === 'onchain' || want === 'dydx') && want !== perpTab) setPerpTab(want);
    } catch { /* a malformed query is not worth breaking the page over */ }
  }, [location.search, perpTab]);

  /*
   * The two venue tabs are BOARDS (five measured columns, a depth chart, an
   * order book), so while one is on screen the app column gets the same ~48px
   * of extra width the derivatives hall asks for — and gives it back after.
   * See `body.hall-wide` in styles/derivatives-glass.css.
   */
  useEffect(() => {
    if (perpTab === 'overview') return undefined;
    document.body.classList.add('hall-wide');
    return () => { document.body.classList.remove('hall-wide'); };
  }, [perpTab]);

  const [prepared, setPrepared] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [execError, setExecError] = useState(null);
  const [lastTx, setLastTx] = useState(null);

  /* ─── the dYdX session ─────────────────────────────────────────────────
     dYdX has no server-built order: the key is derived IN MEMORY from one
     EIP-712 signature of the user's EVM wallet (connectDydx), and the order is
     signed by that session. «Activate» is that one signature. */
  const [dydxAddress, setDydxAddress] = useState(() => dydxSessionAddress());
  const [dydxEquity, setDydxEquity] = useState(null);
  const [dydxStage, setDydxStage] = useState(null);
  const [activating, setActivating] = useState(false);

  /* A session belongs to ONE wallet: switching the EVM account must not leave
     the previous account's dYdX key signing for the new one. */
  const lastEvm = useRef(wallet.address ?? null);
  useEffect(() => {
    const now = wallet.address ?? null;
    if (lastEvm.current && now !== lastEvm.current) { disconnectDydx(); setDydxAddress(null); setDydxEquity(null); }
    lastEvm.current = now;
  }, [wallet.address]);

  useEffect(() => {
    if (!dydxAddress || route !== ROUTE.DYDX || !tradeOpen) return undefined;
    let alive = true;
    getDydxSubaccount(dydxAddress)
      .then((r) => {
        if (!alive) return;
        const eq = Number(r?.account?.subaccount?.equity);
        setDydxEquity({ live: Boolean(r?.live), usd: Number.isFinite(eq) ? eq : 0 });
      })
      .catch(() => { if (alive) setDydxEquity(null); });
    return () => { alive = false; };
  }, [dydxAddress, route, tradeOpen]);

  /* A pair change invalidates an order built for the previous one. Silently
     keeping it would sign a ticket the screen no longer shows. */
  useEffect(() => { setPrepared(null); setExecError(null); }, [pair.symbol, side, collateral, leverage, takeProfit, stopLoss]);

  const canConfirm = notional != null;

  /** One sentence for every code the flow can produce — never a raw code. */
  const errText = useCallback((code) => {
    const c = String(code || 'UNKNOWN');
    if (c.startsWith('dydx:')) {
      return t(`dydx.err.${c.slice(5)}`, { defaultValue: t('perp.terminal.err.UNKNOWN') });
    }
    /* Solana's balance / gas sentences name USDT and SOL, not «collateral» and ETH. */
    const key = route === ROUTE.VELOCITY && (c === 'INSUFFICIENT_BALANCE' || c === 'NO_GAS') ? `${c}_SOLANA` : c;
    return t(`perp.terminal.err.${key}`, {
      defaultValue: t(`futures.err.${key}`, { defaultValue: t('perp.terminal.err.UNKNOWN') })
    });
  }, [t, route]);

  /*
   * THE CONNECT BUTTON — by the family the route needs.
   *
   * An EVM route opens the wallet sheet IN PLACE, on top of the ticket (it used
   * to navigate to the wallet page, which cost the user the amount they had
   * typed and the pair they had chosen). A Solana route asks the Solana wallet
   * directly; its failure comes back as a named code, not as silence.
   */
  const connectSolana = useCallback(async () => {
    setExecError(null);
    try {
      const res = await solWallet.connect?.();
      if (res && typeof res === 'object' && res.ok === false) setExecError('SOLANA_CONNECT_FAILED');
    } catch { setExecError('SOLANA_CONNECT_FAILED'); }
  }, [solWallet]);
  const connectFor = useCallback((family) => {
    if (family === 'solana') connectSolana();
    else setWalletOpen(true);
  }, [connectSolana]);

  const activateDydx = async () => {
    haptic?.('light');
    if (!evmReady) { setWalletOpen(true); return; }
    setActivating(true);
    setExecError(null);
    try {
      /* The onboarding typed data is bound to Ethereum mainnet (domain chainId
         1); connectDydx moves a wallet-connected wallet there first. The in-app
         vault signs locally and has no active chain to disagree with. */
      const isLocal = wallet.mode === 'local';
      const connected = await connectDydx({
        getProvider: () => wallet.getEip1193Provider?.() || null,
        address: wallet.address,
        switchChain: wallet.switchChain,
        requireChain: !isLocal,
        restoreChain: wallet.mode === 'wc',
        onStage: setDydxStage
      });
      setDydxAddress(connected.address);
      haptic?.('success');
    } catch (err) {
      setExecError(`dydx:${classifyDydxError(err)}`);
      haptic?.('error');
    } finally {
      setActivating(false);
      setDydxStage(null);
    }
  };

  /*
   * THE FINAL BUTTON — «بازبینی و تأیید معامله».
   *
   * Connected to the wallet the ROUTE needs → the review sheet, which names the
   * route and the fee share BEFORE anything is confirmed. Not connected → the
   * connect button for that family, in place.
   */
  const startReview = () => {
    haptic?.('light');
    if (!route) return;
    if (!tradingConnected) { connectFor(meta.family); return; }
    setReviewing(true);
  };

  /*
   * ─── dYdX: THE ORDER IS BUILT AND SIGNED IN THE CLIENT SESSION ───────────
   * Size = notional ÷ oracle, rounded DOWN to the market's step (an order the
   * venue has to round is an order the user did not review). The account's own
   * equity is read first: an unfunded dYdX account is the one failure this
   * route has that nothing else can explain, so it is named, not discovered as
   * a rejected transaction.
   */
  const placeOnDydx = async () => {
    const market = routeEntry?.row;
    if (!market?.raw) throw Object.assign(new Error('MARKET_NOT_LISTED'), { code: 'MARKET_NOT_LISTED' });
    if (!dydxSessionAddress()) {
      setDydxAddress(null);
      throw Object.assign(new Error('NOT_CONNECTED'), { code: 'dydx:NOT_CONNECTED' });
    }
    const acct = await getDydxSubaccount(dydxSessionAddress());
    const equity = Number(acct?.account?.subaccount?.equity);
    if (acct?.live && !(equity >= collateralNum)) {
      throw Object.assign(new Error('NO_COLLATERAL'), { code: 'dydx:NO_COLLATERAL' });
    }
    const size = dydxOrderSize({ notionalUsd: notional, price: market.oraclePrice, market });
    if (!size) throw Object.assign(new Error('BELOW_MIN'), { code: 'BELOW_MIN' });
    const slip = Math.min(10, Math.max(0.1, Number(slippagePct) || 0.5));
    const order = await placeDydxOrder({ market, side: side === 'long' ? 'buy' : 'sell', size, slippagePct: slip });
    setLastTx({ hash: order?.hash || String(order?.clientId ?? ''), chain: 'dydx' });
    setPrepared(null);
    setReviewing(false);
    haptic?.('success');
  };

  /*
   * ─── CONFIRM: BUILD, RISK-CHECK, AND WAIT FOR A SIGNATURE — HERE ────────
   *   «وقتی در صفحه فیوجرز تب پرپچوال میخایی امضا کنی میپره تب ان چین»
   *
   * `/prepare` is the backend endpoint every venue tab uses, with the same
   * idempotency key, the same risk verdict and the same fee split; what is gone
   * is the navigation. The order is built for THIS ticket, shown in THIS sheet,
   * and signed by THIS wallet while the user is still looking at the numbers
   * they set. dYdX skips the build step — there is nothing server-side to
   * build — and places the order on the confirming tap.
   *
   * A pair no venue lists says so, in this app. There is no second venue to
   * fall back to: handing a position the user had sized and levered to a
   * different order book was a worse promise than not offering the pair.
   */
  const confirmOrder = async () => {
    haptic?.('medium');
    if (!routeInApp) {
      setExecError('MARKET_NOT_LISTED');
      haptic?.('error');
      return;
    }
    if (!tradingAddress) { setReviewing(false); connectFor(meta.family); return; }

    setExecError(null);
    setPreparing(true);
    try {
      if (route === ROUTE.DYDX) {
        await placeOnDydx();
        return;
      }
      const res = await prepareFutures({
        provider: meta.providerId,
        market: routeEntry.marketId,
        side,
        collateralUsd: collateralNum,
        leverage: Math.min(leverageNum, maxLeverage),
        takeProfit: supportsTpSl ? tp : null,
        stopLoss: supportsTpSl ? sl : null,
        slippageBps: Math.round(Number(slippagePct) * 100),
        wallet: tradingAddress
      });
      if (!res?.ok) throw Object.assign(new Error(res?.error?.code || 'PROVIDER_UNAVAILABLE'), { code: res?.error?.code || 'PROVIDER_UNAVAILABLE' });
      if (res.data?.risk?.blocked) throw Object.assign(new Error('RISK_BLOCKED'), { code: 'RISK_BLOCKED' });
      setPrepared(res.data);
    } catch (err) {
      setExecError(route === ROUTE.DYDX ? classifyDydxOrderError(err) : errorCode(err));
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
   *     signed HERE with the user's own Solana wallet through the venue SDK.
   *     FBT never holds a key and never touches the funds.
   *   · otherwise — server-built unsigned calldata, signed by the EVM wallet
   *     ON THE VENUE'S OWN CHAIN (the wallet is moved there first) and
   *     reported to the ledger by hash.
   *
   * Both report the hash to `/verify` before the UI claims anything, so the
   * success line is a statement about the chain rather than about a promise
   * the client made.
   */
  const signOrder = async () => {
    if (!prepared) return;
    /* Which chain the hash belongs to, decided by the route that produced it. */
    const signChain = route === ROUTE.VELOCITY ? 'solana' : 'evm';
    setSigning(true);
    setExecError(null);
    try {
      if (Date.now() > (prepared.expiresAt ?? 0)) {
        throw Object.assign(new Error('QUOTE_EXPIRED'), { code: 'QUOTE_EXPIRED' });
      }

      if (prepared.clientSign?.buildsInTab) {
        const { openVelocityPosition } = await import('../lib/velocityTrade.js');
        const marketIndex = prepared.market?.marketIndex ?? routeEntry?.marketId;
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
        setLastTx({ hash, chain: signChain });
        if (prepared.executionId) await verifyFutures({ executionId: prepared.executionId, txHash: hash });
        setPrepared(null);
        setReviewing(false);
        haptic?.('success');
        return;
      }

      /* Server-built calldata, signed by the EVM wallet on the venue's chain. */
      const txs = prepared.transactions ?? [];
      const want = Number(txs[0]?.chainId ?? meta?.chainId);
      if (Number.isFinite(want) && want > 0 && wallet.chainId !== want) {
        const moved = await wallet.switchChain?.(want);
        if (!moved) throw Object.assign(new Error('WRONG_NETWORK'), { code: 'WRONG_NETWORK' });
      }
      const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
      if (!signer) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
      let hash = null;
      for (const tx of txs) {
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
      const code = /reject|denied|cancel|4001/i.test(String(err?.message || '')) ? 'USER_REJECTED' : errorCode(err);
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
          {LazyDydx && <LazyDydx embedded />}
        </Suspense>
      ) : perpTab === 'onchain' ? (
        <Suspense fallback={<div className="card" style={{ minHeight: 240, display: 'grid', placeItems: 'center', marginTop: 16 }}><div className="spinner" /></div>}>
          {LazyOnchain && <LazyOnchain embedded />}
        </Suspense>
      ) : (
        <div className="perp-modern">

      {/*
        ─── THE PAGE IS A LIST. THAT IS THE WHOLE REDESIGN ──────────────────
        «الان باید فقط توکن را نشان دهد و نمودار را با دکمه معامله، وقتی روی آن
        زدی یک پاپ‌آپ که کل صفحه را بگیرد … صفحه را شلوغ نکن»

        This tab was a terminal. A hundred-pair strip, a price hero, a chart, a
        ticket, a fee table and a liquidation table all sat on one scroll, so the
        thing the screen exists to do — let you FIND a pair — was the one thing
        you could not do. Worse, the fee table and the venue list are the least
        actionable pixels on the page: they answer questions nobody had yet.

        So: the list is the page, and one tap on a row takes the whole ticket
        over the whole screen. Nothing was thrown away — the same state, the
        same arithmetic, the same backend prepare/sign path — it just stopped
        competing with the list for attention.
      */}

      {/* ---------- the explainer, folded ---------- */}
      <button
        type="button"
        className={`perp-how ${howOpen ? 'is-open' : ''}`}
        onClick={() => { haptic?.('light'); setHowOpen((v) => !v); }}
        aria-expanded={howOpen}
        data-testid="perp-how-toggle"
      >
        <span className="perp-how-ico" aria-hidden="true"><IconSparkle width={16} height={16} /></span>
        <span className="perp-how-text">
          <span className="perp-how-title">{t('perp.how.title')}</span>
          {!howOpen && <span className="perp-how-sub">{t('perp.how.sub')}</span>}
        </span>
        <span className="perp-how-chev" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {howOpen && (
        <div className="perp-how-body" data-testid="perp-how-body">
          {['what', 'liquidate', 'funding', 'fees'].map((k) => (
            <div className="perp-how-row" key={k}>
              <span className="perp-how-row-t">{t(`perp.how.${k}.t`)}</span>
              <span className="perp-how-row-d">{t(`perp.how.${k}.d`)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---------- the search, and the count ---------- */}
      <div className="perp-pair-head">
        <span className="section-label" style={{ margin: 0 }}>
          {t('perp.terminal.pairsCount', { count: listPairs.length })}
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
        /* ---------- THE LIST ---------- */
        <div className="perp-rows" role="list" aria-label={t('perp.terminal.pairsAria')} data-testid="perp-pair-strip">
          {stripPairs.map((p) => {
            const live = coinIsLive(p.coin);
            const tradeable = Boolean(p.routes);
            return (
              <div className="perp-row" role="listitem" key={p.symbol} data-testid={`perp-row-${p.symbol}`}>
                <TokenIcon token={{ symbol: p.symbol, image: p.coin?.image }} size={34} />
                <div className="perp-row-id">
                  <span className="perp-row-sym">
                    {p.symbol}
                    <span className="perp-row-quote">/USDC</span>
                    {tradeable && <span className="perp-pair-live" aria-hidden="true" />}
                  </span>
                  <span className="perp-row-name">{p.coin?.name ?? t('perp.terminal.pairPerp')}</span>
                </div>
                <span className="perp-row-spark" aria-hidden="true">
                  {loading ? (
                    <span className="skel" style={{ width: 58, height: 22 }} />
                  ) : Array.isArray(p.coin?.sparkline) && p.coin.sparkline.length > 1 ? (
                    <Sparkline data={p.coin.sparkline} up={p.coin.change24h >= 0} width={58} height={22} strokeWidth={1.5} />
                  ) : null}
                </span>
                <div className="perp-row-nums">
                  {loading ? (
                    <span className="skel" style={{ width: 66, height: 13 }} />
                  ) : p.coin && live ? (
                    <>
                      <span className="mono perp-row-price">${fmtPrice(p.coin.price)}</span>
                      <span className={`perp-row-chg ${p.coin.change24h >= 0 ? 'up' : 'down'}`}>
                        {fmtPct(p.coin.change24h)}
                      </span>
                    </>
                  ) : (
                    /* honest, and it is honest HERE rather than in a second
                       line under the price — one number per row, or the list
                       becomes a wall. */
                    <span className="faint perp-row-nodata">—</span>
                  )}
                </div>
                <button
                  type="button"
                  className="perp-row-go"
                  onClick={() => { haptic?.('light'); openTrade(p.symbol); }}
                  aria-label={t('perp.terminal.trade', { symbol: p.symbol })}
                  data-testid={`perp-row-open-${p.symbol}`}
                >
                  <IconTrend width={13} height={13} aria-hidden="true" />
                  <span>{t('perp.terminal.trade')}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/*
        ─── THE COST OF HOLDING — IN A BOX THAT OPENS ──────────────────────
        «هزینهٔ نگه‌داشتن پوزیشن، در هر صرافی — این باید داخل باکس بازشونده
        باشد»

        It is the only thing on this screen a trader cannot get elsewhere in one
        glance — the same position costs several percent a year more at one
        venue than another — but it is a TABLE, and a table the size of a phone
        screen sat between the pair list and the end of the page whether or not
        anyone had asked the question. Its title is the question; one tap
        answers it. It is also only mounted once opened, so the rate feed is not
        polled for a box nobody looked inside.

        It lives in the Perpetual tab only: it used to sit below the tab switch,
        so it was printed under the dYdX and On-Chain boards too.
      */}
      <InfoBox
        title={t('perp.fundingTitle')}
        tone="info"
        id="perp-funding"
        icon={<IconActivity width={16} height={16} />}
      >
        <div className="perp-funding-box" data-testid="perp-funding-box">
          <FundingPanel />
        </div>
      </InfoBox>

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

        </div>
      )}

      {/*
        ─── THE TRADE SHEET ─────────────────────────────────────────────────
        The whole terminal, over the whole screen, for one pair.

        Why full-height and not a dialog: a leveraged ticket has a chart, a
        price, a number to change, a leverage control and a button that costs
        money. A dialog that has to scroll three times to show the liquidation
        distance is a dialog that gets confirmed without reading it — and this
        is the one place in the app where reading is the safety mechanism. The
        sheet is sized to the viewport and the button sits within reach of
        everything it acts on.

        The button is the wallet's truth, not a preference. A user with no
        wallet gets «اتصال کیف پول» and nothing that looks like a trade; a
        user with one gets the trade. Showing «خرید» to someone with no wallet
        only moves the surprise one tap later, into the signing flow.
      */}
      {/* No `title`: the ticket draws its own header, and a sheet title bar
          above it would print the pair name twice. */}
      <Sheet
        open={tradeOpen}
        onClose={closeTrade}
        size="lg"
        className="perp-sheet-full"
        testId="perp-trade-sheet"
      >
        <div className="perp-sheet" data-testid="perp-trade-body">
          {/* ---- header: price and change, live ---- */}
          <div className="perp-sheet-head">
            <div className="perp-sheet-id">
              <TokenIcon token={{ symbol: pair.symbol, image: coin?.image }} size={40} />
              <div>
                <div className="perp-sheet-sym">
                  {pair.symbol}-PERP
                  {route && <span className="perp-sheet-tag" data-testid="perp-sheet-tag">{meta.chain}</span>}
                </div>
                <div className="perp-sheet-venue">
                  {coin?.name ?? t('perp.terminal.pairPerp')}
                  {tradingConnected && tradingAddress && (
                    <span className="perp-sheet-wallet" data-testid="perp-sheet-wallet">
                      {shortAddress(tradingAddress)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="perp-sheet-price" data-testid="perp-sheet-price">
              {entryPrice == null ? '—' : `$${fmtPrice(entryPrice)}`}
              {coin && coinIsLive(coin) && (
                <span className={`perp-row-chg ${coin.change24h >= 0 ? 'up' : 'down'}`}>
                  {fmtPct(coin.change24h)}
                </span>
              )}
            </div>
            {/* The sheet fills the screen, so the way out has to be IN it — a
                full-bleed overlay with no visible dismiss is a trap on mobile,
                where there is no back gesture to fall back on. */}
            <button
              type="button"
              className="perp-sheet-close"
              onClick={closeTrade}
              aria-label={t('common.close')}
              data-testid="perp-sheet-close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {indexOffline && (
            <p className="notice" data-testid="perp-index-unavailable">
              {t('perp.marketDataUnavailable')}
            </p>
          )}

          {/* ---- the chart ---- */}
          {/*
            The box used to be a fixed 216px with `overflow: hidden`, and the
            chart inside it (resolution bar + 250px canvas + footer) is ~340px —
            so the bottom third was cut off. «نمودار شمعی کامل نیست … نصفش
            پیداست». The wrapper now takes the chart's own height.

            Every pair has a chart: the venue's own candles first (Velocity and
            Ostium through the BFF, dYdX through its indexer), and — only if the
            venue never answers — the market feed's OHLC, labelled as an index
            chart. A pair with no venue and no feed id is the one honest blank.
          */}
          {chartCfg ? (
            <div className="perp-sheet-chart" data-testid="perp-sheet-chart">
              <FuturesMarketChart
                key={`${chartCfg.provider}:${chartCfg.market}`}
                provider={chartCfg.provider}
                market={String(chartCfg.market)}
                symbol={`${pair.symbol}-PERP`}
                spotId={pair.id || null}
                testId="perp-terminal-chart"
              />
            </div>
          ) : (
            <div className="perp-sheet-chart perp-chart-none" data-testid="perp-chart-unavailable">
              <p className="faint" style={{ margin: 0, lineHeight: 1.8 }}>
                {t('perp.terminal.chartPairUnavailable')}
              </p>
            </div>
          )}

          {/* ---- where it settles, and with which wallet ---- */}
          {route ? (
            <p className="perp-route-note" data-testid="perp-route-note">
              {t('perp.terminal.routeNote', {
                chain: meta.chain,
                asset: meta.collateral,
                wallet: t(`perp.terminal.family.${meta.family}`)
              })}
            </p>
          ) : (
            <p className="notice" data-testid="perp-no-route">{t('perp.terminal.route.notListed')}</p>
          )}
          {needsFamily && (
            <p className="notice" data-testid="perp-needs-wallet">
              {t('perp.terminal.needsWallet', {
                chain: meta.chain,
                wallet: t(`perp.terminal.family.${needsFamily}`)
              })}
            </p>
          )}

          {/* ---- direction ---- */}
          <div className="dir-switch">
            <button
              type="button"
              className={`dir-btn long ${side === 'long' ? 'active' : ''}`}
              onClick={() => { haptic?.('light'); setSide('long'); }}
              data-testid="perp-sheet-long"
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
              data-testid="perp-sheet-short"
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

          {/* ---- the amount ---- */}
          <div className="perp-field">
            <span className="field-label">{t('perp.terminal.collateral')}</span>
            <div className="perp-collateral-row">
              <input
                type="text"
                inputMode="decimal"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                aria-label={t('perp.terminal.collateral')}
                data-testid="perp-sheet-amount"
              />
              {/* The asset the order ACTUALLY spends on this route. It used to be a
                  USDC/USDT toggle that changed a label and nothing else. */}
              <div className="perp-asset-chips" role="group" aria-label={t('perp.terminal.collateralAsset')}>
                <span className="perp-asset-chip active" data-testid="perp-sheet-asset">{meta?.collateral ?? 'USDC'}</span>
              </div>
            </div>
            {!collateralOk && collateral !== '' && (
              <span className="perp-field-err">{t('perp.terminal.minCollateral', { min: minCollateral })}</span>
            )}
          </div>

          {/* ---- leverage ---- */}
          <div className="perp-field">
            <div className="perp-lev-head">
              <span className="field-label">{t('perp.terminal.leverage')}</span>
              <span className="mono perp-lev-value" data-testid="perp-leverage">
                {leverageOk ? `${Number(leverageNum.toFixed(2))}×` : '—'}
              </span>
            </div>
            <div className="lev-row">
              {leveragePresets.map((n) => (
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
              max={maxLeverage}
              step="0.5"
              value={leverageOk ? Math.min(leverageNum, maxLeverage) : 1}
              onChange={(e) => setLeverage(e.target.value)}
              className="perp-lev-slider"
              style={{ width: '100%', marginTop: 8, accentColor: 'var(--rgb-1)' }}
              aria-label={t('perp.terminal.leverage')}
            />
          </div>

          {/* ---- the numbers that decide it ---- */}
          <div className="perp-summary" data-testid="perp-summary">
            <div className="row-between">
              <span className="faint">{t('perp.terminal.notional')}</span>
              <span className="mono perp-summary-strong" data-testid="perp-sheet-size">
                {notional == null ? '—' : fmtUsd(notional)}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.liqPrice')}</span>
              <span className={`mono ${side === 'long' ? 'perp-liq-long' : 'perp-liq-short'}`}>
                {liq.liquidationPrice == null ? '—' : `$${fmtPrice(liq.liquidationPrice)}`}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.liqDistance')}</span>
              {/*
                The distance is a MAGNITUDE — 20% either way — but it is
                signed by direction, because a long is closed by a fall and
                a short by a rise. Printing an unsigned «20%» for both sides
                would be the most dangerous single number on this screen:
                it would read as "safe" to a short who needs a 20% rally to
                survive, and as a loss to a long who needs a 20% drop.
              */}
              <span className="mono" data-testid="perp-sheet-liq">
                {liq.distancePct == null
                  ? '—'
                  : `${side === 'long' ? '▼' : '▲'} ${side === 'long' ? '−' : '+'}${liq.distancePct.toFixed(2)}%`}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.fee.title')}</span>
              <span className="mono">
                {fee?.protocol?.known ? fmtUsd(fee.protocol.feeUsd) : t('perp.terminal.fee.protocolLater')}
              </span>
            </div>
            {route === ROUTE.DYDX && dydxAddress && (
              <div className="row-between">
                <span className="faint">{t('perp.terminal.dydxEquity')}</span>
                <span className="mono" data-testid="perp-dydx-equity">
                  {dydxEquity ? fmtUsd(dydxEquity.usd) : '—'}
                </span>
              </div>
            )}
          </div>
          {route === ROUTE.DYDX && dydxAddress && dydxEquity?.live && collateralOk && dydxEquity.usd < collateralNum && (
            <p className="notice" data-testid="perp-dydx-unfunded">
              {t('perp.terminal.dydxUnfunded', { address: shortAddress(dydxAddress) })}
            </p>
          )}
          <p className="faint perp-liq-note">{t('perp.terminal.liqNote')}</p>

          {/* ---- risk controls, folded ---- */}
          {/* Take-profit / stop-loss are written INTO the order only on the venue
              whose calldata carries them. On the others the fields are shown
              inert with the reason — an input that is silently ignored is a
              stop-loss the user thinks they have and do not. */}
          <InfoBox title={t('perp.terminal.riskControls')} tone="info" id="perp-terminal-risk">
            <div className="row" style={{ gap: 10 }}>
              <label style={{ flex: 1 }}>
                <span className="faint">{t('perp.terminal.takeProfit')}</span>
                <input type="text" inputMode="decimal" placeholder="0" value={supportsTpSl ? takeProfit : ''} disabled={!supportsTpSl} onChange={(e) => setTakeProfit(e.target.value)} />
              </label>
              <label style={{ flex: 1 }}>
                <span className="faint">{t('perp.terminal.stopLoss')}</span>
                <input type="text" inputMode="decimal" placeholder="0" value={supportsTpSl ? stopLoss : ''} disabled={!supportsTpSl} onChange={(e) => setStopLoss(e.target.value)} />
              </label>
            </div>
            {!supportsTpSl && (
              <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.8 }} data-testid="perp-tpsl-note">
                {t('perp.terminal.tpSlUnsupported')}
              </p>
            )}
          </InfoBox>

          {/*
            ─── THE RISK NOTICE, AT THE POINT OF THE BUTTON ───────────────────
            It used to sit above a hundred pairs, where it was one more thing
            between the user and the list. Here it is one thing above the thing
            it is about — which is the only place a warning can do any work.
          */}
          <p className="notice notice-danger" data-testid="perp-risk-note">{t('perp.riskNotice')}</p>

          {lastTx?.hash && (
            <div className="notice perp-tx-notice" data-testid="perp-tx" role="status">
              <p style={{ margin: 0 }}>{t('perp.terminal.signed')}</p>
              <span className="mono" style={{ display: 'block', marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
                {lastTx.hash}
              </span>
            </div>
          )}

          {execError && !reviewing && (
            <p className="notice notice-danger" data-testid="perp-exec-error" role="alert">
              {errText(execError)}
            </p>
          )}

          {/*
            ─── THE ONE BUTTON — STICKY, AND IT SAYS WHAT IT DOES ──────────────
            «دکمه صعودی یا نزولی پایین پاپ اپ که نشان دهنده امضا هست را درست
            کن»

            It was the last thing in a long scroll, a flat green/red bar with one
            word on it, and nothing on it said that pressing it leads to a
            SIGNATURE. It is now pinned to the bottom of the sheet (so it is
            always within reach of the numbers it acts on), carries the
            direction as an arrow, and names what happens next and with whose
            wallet. The wallet glyph that used to sit beside «connect wallet» is
            gone: the words are the button.

            Which button it is is still the wallet's truth — never «trade» for a
            user who cannot sign, and never «connect a wallet» for one who has a
            wallet of the wrong family (the sentence above names the right one).
          */}
          <div className="perp-sheet-foot">
            {!route ? (
              <button type="button" className="btn perp-sheet-go is-off" disabled data-testid="perp-sheet-unavailable">
                {t('perp.terminal.noRouteBtn')}
              </button>
            ) : !tradingConnected ? (
              <button
                type="button"
                className="btn btn-primary perp-sheet-go"
                onClick={() => { haptic?.('light'); connectFor(meta.family); }}
                data-testid="perp-sheet-connect"
              >
                {meta.family === 'solana' ? t('perp.terminal.connectSolana') : t('perp.terminal.connect')}
              </button>
            ) : route === ROUTE.DYDX && !dydxAddress ? (
              <button
                type="button"
                className="btn btn-primary perp-sheet-go"
                onClick={activateDydx}
                disabled={activating}
                data-testid="perp-sheet-activate"
              >
                {activating
                  ? (dydxStage ? t(`dydx.stage.${dydxStage}`, { defaultValue: t('common.loading') }) : t('common.loading'))
                  : t('perp.terminal.activateDydx')}
              </button>
            ) : (
              <button
                type="button"
                className={`btn perp-sheet-go ${side}`}
                disabled={!canConfirm || preparing || signing}
                onClick={startReview}
                data-testid="perp-sheet-confirm"
              >
                <span className="perp-go-ico" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    {side === 'long'
                      ? <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>
                      : <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>}
                  </svg>
                </span>
                <span className="perp-go-text">
                  <span className="perp-go-main">
                    {preparing || signing
                      ? t('perp.terminal.preparing')
                      : `${side === 'long' ? t('perp.terminal.long') : t('perp.terminal.short')} · ${pair.symbol}`}
                  </span>
                  <span className="perp-go-sub">
                    {t('perp.terminal.goSub', { wallet: shortAddress(tradingAddress) })}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </Sheet>

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
              <span className="mono">{collateralOk ? `${fmtUsd(collateralNum)} ${meta?.collateral ?? 'USDC'}` : '—'}</span>
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
                  : `$${fmtPrice(liq.liquidationPrice)} (${side === 'long' ? '−' : '+'}${liq.distancePct.toFixed(2)}%)`}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.tpSl')}</span>
              <span className="mono">
                {tp == null ? '—' : `$${fmtPrice(tp)}`} / {sl == null ? '—' : `$${fmtPrice(sl)}`}
              </span>
            </div>
            {/*
              The whole fee split, here, in the one place the user reads
              before they sign. It used to sit on the page as its own table,
              which meant it was visible while browsing and gone by the time
              the money was actually being spent — the exact inverse of what
              a fee disclosure is for.

              Each leg reads defensively: a preview the backend did not
              complete shows the placeholder sentence, never a zero. A zero
              here would read as "this trade is free".
            */}
            <div className="row-between">
              <span className="faint">{t('perp.terminal.fee.protocol')}</span>
              <span className="mono">
                {fee?.protocol?.known ? fmtUsd(fee.protocol.feeUsd) : t('perp.terminal.fee.protocolLater')}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.fee.network')}</span>
              <span className="mono">
                {fee?.network?.known ? fmtUsd(fee.network.feeUsd) : t('perp.terminal.fee.networkLater')}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.fee.fbt')}</span>
              <span className="mono">
                {Number.isFinite(Number(fee?.fbt?.feeUsd))
                  ? `${fmtUsd(fee.fbt.feeUsd)} · ${fee.fbt.bps} bps`
                  : t('perp.terminal.fee.fbtLater')}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('perp.terminal.fee.total')}</span>
              <span className="mono">
                {fee?.complete ? fmtUsd(fee.totalFeeUsd) : t('perp.terminal.fee.totalLater')}
              </span>
            </div>
            {/*
              And WHO the share goes to. This is an arrangement, not an
              implementation detail, and the line that discloses it belongs
              next to the number rather than in a table nobody opens.
            */}
            {routeInApp && (
              <p className="faint" style={{ margin: 0, fontSize: 11, lineHeight: 1.7 }}>
                {t('perp.terminal.fee.treasury', {
                  address: fee?.fbt?.recipient ? shortAddress(fee.fbt.recipient) : '—'
                })}
              </p>
            )}
          </div>

          {/*
            The route line — the part a "looks like an exchange" screen must
            never hide. Every route is settled inside this app: built here,
            risk-checked here, signed here, from the user's own wallet — and the
            line names WHICH chain and WHICH wallet, because those are what the
            user has to have funds and a connection on. A pair this app cannot
            execute says so on the ticket instead of being routed somewhere
            else.
          */}
          <div className="card card-tight perp-route" data-testid="perp-review-route">
            <span className="perp-route-ico" aria-hidden="true">
              <IconRoute width={18} height={18} />
            </span>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              {route
                ? t(`perp.terminal.route.${route}`, { chain: meta.chain, asset: meta.collateral })
                : t('perp.terminal.route.notListed')}
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
              {errText(execError)}
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
                  : route === ROUTE.DYDX
                    ? t('perp.terminal.confirmDydx')
                    : t('perp.terminal.confirmInApp')}
            </button>
          </div>
        </div>
      </Sheet>

      <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
    </PageTransition>
  );
}
