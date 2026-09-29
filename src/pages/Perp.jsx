import { useEffect, useMemo, useState, Suspense } from 'react';
import { createPortal } from 'react-dom';
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
import { IconActivity, IconChevronLeft, IconChevronRight, IconExternal, IconRoute, IconShield, IconSparkle, IconTrend, IconWallet } from '../components/Icons';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { anyVenueEarns, withReferral, AVANTIS_CODE } from '../lib/venueReferral';
import { SPECULATION_ENABLED } from '../lib/features';
import { getFuturesFeePreview, getFuturesMarkets } from '../lib/futuresClient';
import { liquidationDistance } from '../lib/futures-engine';
import { velocityPerpIndex } from '../lib/velocityMarkets';
import { getDydxMarkets } from '../lib/dydx';
import { lockBodyScroll } from '../lib/scrollLock';
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
 * Requested explicitly: the majors first (BTC/ETH/SOL/BNB/XRP/DOGE), then the
 * popular DeFi and L1 names (AVAX/LINK/NEAR/PEPE/SUI/APT). `id` is the market
 * feed's coin id, `symbol` is both the strip label and the key the executable
 * routes match on (the venue tab resolves `BTC-PERP` by base symbol).
 */
const PERP_PAIRS = [
  { id: 'bitcoin', symbol: 'BTC' },
  { id: 'ethereum', symbol: 'ETH' },
  { id: 'solana', symbol: 'SOL' },
  { id: 'binancecoin', symbol: 'BNB' },
  { id: 'ripple', symbol: 'XRP' },
  { id: 'dogecoin', symbol: 'DOGE' },
  { id: 'avalanche-2', symbol: 'AVAX' },
  { id: 'chainlink', symbol: 'LINK' },
  { id: 'near', symbol: 'NEAR' },
  { id: 'pepe', symbol: 'PEPE' },
  { id: 'sui', symbol: 'SUI' },
  { id: 'aptos', symbol: 'APT' }
];

/* Product policy, same ceiling the futures engine enforces (hardMaxLeverage). */
const MAX_LEVERAGE = 50;
const LEVERAGE_PRESETS = [2, 5, 10, 20, 50];
const MIN_COLLATERAL_USD = 5;

/** A Perpetual hand-off stays on the Perpetual route and opens execution in a
 *  modal. Keep the draft in the URL so Wallet → connect → return restores the
 *  exact ticket without changing the selected tab. */
function readEmbeddedExecution(search) {
  try {
    const params = new URLSearchParams(search || '');
    if (params.get('execution') !== 'onchain') return null;
    const market = String(params.get('market') || '').toUpperCase().replace(/[^A-Z0-9/-]/g, '').slice(0, 16);
    if (!market) return null;
    const rawCollateral = Number(params.get('collateral'));
    const rawLeverage = Number(params.get('leverage'));
    const side = String(params.get('side') || '').toLowerCase();
    return {
      market,
      side: side === 'long' || side === 'short' ? side : 'long',
      collateral: Number.isFinite(rawCollateral) && rawCollateral >= MIN_COLLATERAL_USD ? String(rawCollateral) : '100',
      leverage: Number.isFinite(rawLeverage) && rawLeverage >= 1 ? String(Math.min(rawLeverage, MAX_LEVERAGE)) : '5'
    };
  } catch { return null; }
}

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
  /* Top 100 by market cap comfortably contains every pair in PERP_PAIRS. */
  const { data: coins, loading } = useMarkets(100);
  const slippagePct = useSettingsStore((s) => s.defaultSlippage);
  const setSlippage = useSettingsStore((s) => s.setSlippage);

  /* Deep links from the Intent OS and in-app handoffs share one URL contract. */
  const initialTab = (() => {
    try {
      const wanted = new URLSearchParams(location.search || '').get('tab');
      return SPECULATION_ENABLED && ['dydx', 'onchain'].includes(wanted) ? wanted : 'overview';
    } catch { return 'overview'; }
  })();
  const [perpTab, setPerpTab] = useState(initialTab);
  const embeddedExecution = useMemo(() => readEmbeddedExecution(location.search), [location.search]);
  const [dydxMarkets, setDydxMarkets] = useState([]);
  const [dydxMarketsLoading, setDydxMarketsLoading] = useState(true);
  const [dydxSearch, setDydxSearch] = useState('');
  const [dydxVisibleCount, setDydxVisibleCount] = useState(18);
  const PERP_TABS = SPECULATION_ENABLED ? ['overview', 'dydx', 'onchain'] : ['overview'];

  /*
   * ─── THE TERMINAL'S OWN STATE ─────────────────────────────────────────────
   * A real ticket, sized in a real stablecoin, with the same honest arithmetic
   * every other leveraged screen in this app uses. Nothing here signs
   * anything: the confirm button routes the order to an EXECUTABLE path — an
   * in-place venue execution panel for pairs it lists, or Avantis on Base with
   * the registered `fbtswap` referral code for the rest.
   */
  const [selected, setSelected] = useState('bitcoin');
  const [side, setSide] = useState('long');
  const [collateral, setCollateral] = useState('100');
  const [collateralAsset, setCollateralAsset] = useState('USDC');
  const [leverage, setLeverage] = useState('5');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const byId = useMemo(() => {
    const m = new Map();
    for (const c of coins ?? []) m.set(c.id, c);
    return m;
  }, [coins]);
  const pair = PERP_PAIRS.find((p) => p.id === selected) ?? PERP_PAIRS[0];
  const coin = byId.get(pair.id) ?? null;
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
   * ─── THE VENUE FEED (one read, no polling) ──────────────────────────────
   * Powers two decisions, both of which must come from the live venue rather
   * than a guess: (a) does the in-app executable route list this pair, and
   * (b) does the shared FuturesMarketChart have candles for it. When the feed
   * is down the static Velocity index table is the conservative fallback for
   * ROUTING only — the chart then says "unavailable" on its own and never
   * draws a flat line.
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

  /*
   * The original overview ticket covers 12 selected assets. Keep its order
   * path intact, and surface dYdX's separate live, ACTIVE instrument catalogue
   * as a discovery directory. A click opens the dYdX tab with that exact venue
   * ticker; it never makes the market executable through another venue.
   */
  useEffect(() => {
    if (!SPECULATION_ENABLED) {
      setDydxMarketsLoading(false);
      return undefined;
    }
    let alive = true;
    getDydxMarkets()
      .then((result) => {
        if (!alive) return;
        setDydxMarkets(Array.isArray(result?.markets) ? result.markets : []);
        setDydxMarketsLoading(false);
      })
      .catch(() => {
        if (alive) {
          setDydxMarkets([]);
          setDydxMarketsLoading(false);
        }
      });
    return () => { alive = false; };
  }, []);

  const activeDydxMarkets = useMemo(() => dydxMarkets
    .filter((market) => (
      market?.status === 'ACTIVE'
      && /^[A-Z0-9]+-[A-Z0-9]+$/.test(String(market.ticker || ''))
      && Number.isFinite(Number(market.oraclePrice))
      && Number(market.oraclePrice) > 0
    ))
    .sort((a, b) => Number(b.volume24H || 0) - Number(a.volume24H || 0)), [dydxMarkets]);
  const filteredDydxMarkets = useMemo(() => {
    const query = dydxSearch.trim().toUpperCase();
    return query
      ? activeDydxMarkets.filter((market) => String(market.ticker).includes(query))
      : activeDydxMarkets;
  }, [activeDydxMarkets, dydxSearch]);
  const visibleDydxMarkets = useMemo(
    () => filteredDydxMarkets.slice(0, dydxVisibleCount),
    [filteredDydxMarkets, dydxVisibleCount]
  );

  const venueMarket = useMemo(
    () => venueMarkets.find((m) => String(m.base || '').toUpperCase() === pair.symbol) || null,
    [venueMarkets, pair.symbol]
  );
  /* Executable in this app? Live feed first, catalogue fallback second. */
  const routeInApp = SPECULATION_ENABLED && (Boolean(venueMarket) || velocityPerpIndex(pair.symbol) != null);

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
   * venue's own fee parameters, exactly like the execution panel's preview. Nothing
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

  useEffect(() => {
    if (!embeddedExecution) return undefined;
    return lockBodyScroll();
  }, [embeddedExecution]);

  /*
   * URL -> tab synchronization is navigation-only. Manual tab clicks write the
   * matching URL below; depending on `perpTab` here would replay a stale
   * `?tab=onchain` after the user intentionally chooses the overview.
   */
  useEffect(() => {
    if (!SPECULATION_ENABLED) return;
    try {
      const want = new URLSearchParams(location.search || '').get('tab');
      const next = ['onchain', 'dydx'].includes(want) ? want : 'overview';
      setPerpTab((current) => (current === next ? current : next));
    } catch { /* malformed search strings should not break the terminal */ }
  }, [location.search]);

  const selectPerpTab = (nextTab) => {
    setPerpTab(nextTab);
    const params = new URLSearchParams(location.search || '');
    if (nextTab === 'overview') params.delete('tab');
    else params.set('tab', nextTab);
    const query = params.toString();
    const search = query ? `?${query}` : '';
    if (search !== (location.search || '')) {
      navigate({ pathname: location.pathname || '/perp', search }, { replace: true });
    }
  };

  const openDydxMarket = (ticker) => {
    const params = new URLSearchParams(location.search || '');
    params.set('tab', 'dydx');
    params.set('ticker', ticker);
    setPerpTab('dydx');
    navigate({ pathname: location.pathname || '/perp', search: `?${params.toString()}` });
  };

  const closeEmbeddedExecution = () => {
    const params = new URLSearchParams(location.search || '');
    ['execution', 'market', 'side', 'collateral', 'leverage'].forEach((key) => params.delete(key));
    if (params.get('tab') === 'overview') params.delete('tab');
    const query = params.toString();
    navigate({ pathname: location.pathname || '/perp', search: query ? `?${query}` : '' }, { replace: true });
  };

  const canConfirm = notional != null;

  /*
   * THE FINAL BUTTON — «بازبینی و تأیید معامله».
   *
   * No wallet connected → the button becomes the connect button: nothing can
   * be signed without one, and the sheet is our standard wallet connection
   * flow, not a new one. Connected → the review sheet, which names the route
   * and the fee share BEFORE anything is confirmed.
   */
  const startReview = () => {
    haptic?.('light');
    /* The in-app perpetual venue signs through its own Solana wallet flow;
       do not divert that order through the EVM wallet sheet. */
    if (!wallet.isConnected && !routeInApp) { setWalletOpen(true); return; }
    setReviewing(true);
  };

  /*
   * Confirm routes the order to an executable, earning path — never a dead
   * end and never a free exit:
   *
   *   · pairs the in-app venue lists → an in-place execution panel over the
   *     Perpetual tab, prefilled with the exact ticket. There the backend
   *     rebuilds the order, shows its own fee breakdown and risk verdict, and
   *     the user signs in the venue's wallet. The Perpetual tab stays selected.
   *
   *   · every other pair → Avantis on Base through the REGISTERED referral
   *     code `fbtswap` (withReferral rewrites to the /referral attribution
   *     page that Avantis actually reads). No FBT capital is frozen anywhere
   *     and the fee share settles straight to the registered treasury.
   */
  const confirmOrder = () => {
    haptic?.('medium');
    setReviewing(false);
    if (routeInApp) {
      const params = new URLSearchParams({
        tab: 'overview',
        execution: 'onchain',
        market: `${pair.symbol}-PERP`,
        side,
        collateral: String(collateralNum),
        leverage: String(Math.min(leverageNum, MAX_LEVERAGE))
      });
      setPerpTab('overview');
      navigate({ pathname: location.pathname || '/perp', search: `?${params.toString()}` });
    } else {
      openVenue('avantis', AVANTIS.url);
    }
  };

  const tp = Number(takeProfit) > 0 ? Number(takeProfit) : null;
  const sl = Number(stopLoss) > 0 ? Number(stopLoss) : null;

  /* ── the strip: every pair, its live dollar price, a sparkline, 24h ── */
  const stripPairs = PERP_PAIRS.map((p) => ({ ...p, coin: byId.get(p.id) ?? null }));

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
              onClick={() => selectPerpTab(k)}
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

      {SPECULATION_ENABLED && (
        <section className="perp-live-catalogue card card-tight" aria-labelledby="perp-live-catalogue-title">
          <div className="perp-live-catalogue-head">
            <div>
              <div className="eyebrow" id="perp-live-catalogue-title">{t('perp.terminal.liveMarkets')}</div>
              <div className="perp-live-catalogue-subtitle">
                {t('perp.terminal.liveMarketsSubtitle', { count: activeDydxMarkets.length })}
              </div>
            </div>
            <label className="perp-live-search">
              <span className="sr-only">{t('perp.terminal.liveMarketsSearch')}</span>
              <input
                type="search"
                value={dydxSearch}
                onChange={(event) => { setDydxSearch(event.target.value); setDydxVisibleCount(18); }}
                placeholder={t('perp.terminal.liveMarketsSearch')}
                aria-label={t('perp.terminal.liveMarketsSearch')}
              />
            </label>
          </div>
          {dydxMarketsLoading ? (
            <div className="perp-live-catalogue-grid" aria-label={t('perp.terminal.liveMarketsLoading')}>
              {Array.from({ length: 6 }, (_, index) => <span className="skel perp-live-catalogue-skeleton" key={index} />)}
            </div>
          ) : visibleDydxMarkets.length ? (
            <div className="perp-live-catalogue-grid">
              {visibleDydxMarkets.map((market) => {
                const [base, quote] = market.ticker.split('-');
                const change = Number(market.priceChange24H) / Number(market.oraclePrice) * 100;
                return (
                  <button
                    type="button"
                    className="perp-live-market"
                    key={market.ticker}
                    onClick={() => openDydxMarket(market.ticker)}
                    aria-label={`${t('perp.terminal.liveMarketsOpen')} ${market.ticker}`}
                  >
                    <span className="perp-live-market-main">
                      <span className="perp-live-market-badge">{base.slice(0, 1)}</span>
                      <span className="perp-live-market-names">
                        <strong>{market.ticker}</strong>
                        <small>{t('perp.terminal.liveMarketVolume', { value: fmtUsd(market.volume24H) })}</small>
                      </span>
                    </span>
                    <span className="perp-live-market-data">
                      <strong className="mono">${fmtPrice(market.oraclePrice)}</strong>
                      <small className={Number.isFinite(change) && change >= 0 ? 'up' : 'down'}>
                        {Number.isFinite(change) ? fmtPct(change) : '—'} · {quote}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="perp-live-catalogue-empty">
              {activeDydxMarkets.length
                ? t('perp.terminal.liveMarketsEmpty')
                : t('perp.terminal.liveMarketsUnavailable')}
            </p>
          )}
          {!dydxMarketsLoading && visibleDydxMarkets.length < filteredDydxMarkets.length && (
            <button
              type="button"
              className="perp-live-more"
              onClick={() => setDydxVisibleCount((count) => count + 18)}
            >
              {t('perp.terminal.liveMarketsMore', { count: filteredDydxMarkets.length - visibleDydxMarkets.length })}
            </button>
          )}
        </section>
      )}

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
          the snapshot price must never pass for a live one. */}
      <div className="tag-scroll perp-pairs" role="tablist" aria-label={t('perp.terminal.pairsAria')} data-testid="perp-pair-strip">
        {stripPairs.map((p) => {
          const active = p.id === pair.id;
          const live = coinIsLive(p.coin);
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`tag perp-pair ${active ? 'active' : ''}`}
              onClick={() => { haptic?.('light'); setSelected(p.id); }}
            >
              <span className="perp-pair-top">
                <TokenIcon token={{ symbol: p.symbol, image: p.coin?.image }} size={24} />
                <span className="perp-pair-sym">{p.symbol}-PERP</span>
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
          External route + no EVM wallet → connect first. In-app Solana pairs
          use the venue's own wallet flow in the execution panel, so they can
          reach review without an unrelated EVM connection. Every route and fee
          is named before the user confirms.
        */}
        {wallet.isConnected || routeInApp ? (
          <button
            type="button"
            className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'} perp-submit`}
            disabled={!canConfirm}
            onClick={startReview}
            data-testid="perp-submit"
          >
            {t('perp.terminal.review')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary perp-submit"
            onClick={startReview}
            data-testid="perp-connect"
          >
            <IconWallet width={16} height={16} style={{ display: 'inline', marginInlineEnd: 6 }} />
            {t('perp.terminal.connect')}
          </button>
        )}
        {!routeInApp && wallet.isConnected && wallet.address ? (
          <p className="faint perp-wallet-line" data-testid="perp-wallet-row">
            <IconShield width={13} height={13} style={{ display: 'inline', marginInlineEnd: 4, verticalAlign: '-2px' }} />
            {t('perp.terminal.connectedAs', { address: shortAddress(wallet.address) })}
          </p>
        ) : (
          <p className="faint perp-wallet-line">
            {t(routeInApp ? 'perp.terminal.venueWalletHint' : 'perp.terminal.walletHint')}
          </p>
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
        ─── THE REVIEW & CONFIRM SHEET ──────────────────────────────────────
        The whole ticket in one place, the fee split, and the route the order
        will take — named before the user confirms anything. Confirm either
        opens an in-place venue execution panel (which rebuilds and re-checks
        everything server-side before any signature) or opens
        Avantis with the registered referral code attached. No route out of
        this sheet is unmonetised.
      */}
      <Sheet open={reviewing} onClose={() => setReviewing(false)} title={t('perp.terminal.reviewTitle')}>
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
            never hide. Either the order is executed by the in-app panel
            (rebuilt and risk-checked by the backend before any signature),
            or it goes to Avantis on Base with the `fbtswap` code attached.
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

          <p className="notice notice-danger">{t('perp.terminal.reviewRisk')}</p>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setReviewing(false)}>
              {t('common.cancel')}
            </button>
            <button
              className={`btn ${side === 'long' ? 'btn-success' : 'btn-danger'}`}
              style={{ flex: 1 }}
              disabled={!canConfirm}
              onClick={confirmOrder}
              data-testid="perp-review-confirm"
            >
              {routeInApp ? t('perp.terminal.confirmInApp') : t('perp.terminal.confirmAvantis')}
            </button>
          </div>
        </div>
      </Sheet>

      <WalletConnectSheet open={walletOpen} onClose={() => setWalletOpen(false)} />
        </div>
      )}
      {embeddedExecution && typeof document !== 'undefined' && createPortal(
        <div className="perp-execution-overlay" role="dialog" aria-modal="true" aria-labelledby="perp-execution-title" data-testid="perp-execution-overlay">
          <div className="perp-execution-panel">
            <div className="perp-execution-toolbar">
              <button
                type="button"
                className="perp-execution-back"
                onClick={() => { haptic?.('light'); closeEmbeddedExecution(); }}
                data-testid="perp-execution-close"
              >
                <IconChevronLeft width={16} height={16} />
                {t('common.back')}
              </button>
              <span id="perp-execution-title">{t('perp.tab.perpetual')}</span>
            </div>
            <Suspense fallback={<div className="card" style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><div className="spinner" /></div>}>
              {LazyOnchain && <LazyOnchain embedded initialPrefill={embeddedExecution} />}
            </Suspense>
          </div>
        </div>,
        document.body
      )}
    </PageTransition>
  );
}
