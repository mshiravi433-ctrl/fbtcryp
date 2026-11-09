import { Suspense, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import { IconInfo } from '../components/Icons';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { fmtPrice, fmtUsd } from '../lib/format';
import '../styles/derivatives-glass.css';
import {
  DYDX_BUILDER_ADDRESS,
  DYDX_BUILDER_FEE_PPM,
  DYDX_LIMIT_GOOD_TIL_SECONDS,
  classifyDydxError,
  connectDydx,
  disconnectDydx,
  dydxFeeUsd,
  getDydxMarkets,
  getDydxSubaccount,
  placeDydxOrder
} from '../lib/dydx';
import FuturesMarketChart from '../components/FuturesMarketChart';
import DydxTokenDesk from '../components/futures/DydxTokenDesk';
import { dydxOrderSize } from '../lib/perpRoutes';
import { liquidationDistance } from '../lib/futures-engine';
import lazyRetry from '../lib/lazyRetry';
import { DYDX_TPSL_ENABLED, FUTURES_HISTORY_ENABLED } from '../lib/features';
import ModernSelect from '../components/ModernSelect';

/* The TP/SL card loads only when DYDX_TPSL_ENABLED is on. */
const LazyDydxTpSlCard = DYDX_TPSL_ENABLED
  ? lazyRetry(() => import('../components/futures/DydxTpSlCard'))
  : null;

/*
 * ─── THE dYdX HISTORY LIVES ON THE dYdX SCREEN ──────────────────────────────
 *   «هر تاریخچه را در صفحه مربوط به خودش، زیر صفحه، در باکس باز‌شونده بگذار»
 *
 * This table used to be a fourth tab on the Perpetual rail, where it mixed
 * one venue's real fills with two venues' «not available» notes — a tab that
 * belonged to no screen the reader was on. It is dYdX data, read through the
 * dYdX session this very page establishes, so it now sits at the BOTTOM of
 * this page inside a folded box: closed by default (it is the least urgent
 * thing on a trading screen), one tap to open, and nothing about the panel
 * itself changed.
 */
const LazyFuturesHistory = FUTURES_HISTORY_ENABLED
  ? lazyRetry(() => import('../components/futures/FuturesHistory'))
  : null;

/*
 * ─── LEVERAGE, WHICH THIS TAB DID NOT HAVE ──────────────────────────────────
 *   «در فیوجرز تب dydx اهرم و امکانات دیگر را اضافه کن»
 *
 * dYdX v4 has no "set leverage" call: leverage is a CONSEQUENCE — a position's
 * notional divided by the equity backing it, hard-capped by the market's own
 * initial margin fraction (1 / IMF, published per market and already carried
 * on every row as `maxLeverage`). So the control below does the only honest
 * thing a leverage control can do here: it SIZES THE ORDER from the account's
 * real equity, and it reports the leverage the resulting order actually has.
 *
 * Two consequences are deliberate:
 *   · the ladder is CLIPPED to the market's own cap. A 20× button on a market
 *     whose IMF is 0.1 (10× max) is a button the venue will reject;
 *   · with no connected account there is no equity to size from, so the ladder
 *     still sets the target leverage (the risk engine and the AI both read it)
 *     but says out loud that the size has to be typed until the account is
 *     read. Silently doing nothing on a tap is how a control gets reported as
 *     broken.
 */
const LEVERAGE_LADDER = [1, 2, 5, 10, 20];

/**
 * Lifetimes offered for a resting limit order. dYdX measures a LONG_TERM
 * order's life in absolute seconds from the block it lands in, so these are
 * the numbers that become `goodTilTimeInSeconds` — not a UI preference, a
 * protocol field. The 28-day default is unchanged from before this existed.
 */
const GOOD_TIL = Object.freeze([
  { id: '1h', seconds: 3600 },
  { id: '1d', seconds: 86_400 },
  { id: '7d', seconds: 604_800 },
  { id: '28d', seconds: DYDX_LIMIT_GOOD_TIL_SECONDS }
]);

/**
 * `embedded` — hosted by the Perpetual page, which has already drawn the one
 * `.page` box (16px of side padding) and animated the screen. Without it this
 * tab built a SECOND `.page` inside the first: 32px in from each edge of a
 * phone, which is exactly the «صفحه انگار از چپ و راست جمع شده» the board was
 * reported for. `.derivatives-hall` cancels ONE page's padding, not two.
 * The standalone route (/dydx) still renders its own page.
 */

export default function Dydx({ embedded = false } = {}) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const { haptic } = useTelegram();
  /*
   * ─── THE "FUND YOUR ACCOUNT" BUTTON TO THE dYdX WEBSITE IS GONE ──────────
   * It was the only outbound link on this page, and it paid nothing: dYdX's
   * affiliate programme needs $10k of our own trading volume before it pays a
   * cent, so the button handed a funded, ready-to-trade user straight to
   * somebody else for free.
   *
   * Worse than merely unpaid, it competed with this very screen. Everything
   * below runs against our own same-origin proxy with a builder fee attached
   * (see `DYDX_BUILDER_FEE_PPM` / `DYDX_BUILDER_ADDRESS`), so every tap on
   * that button was revenue walking out of an integration that earns.
   *
   * The EXPLANATION stays. Someone does still need to know how a dYdX
   * subaccount gets funded, and the deposit flow is reachable from the
   * connected wallet — what is removed is us doing the marketing for it.
   */
  const [connectOpen, setConnectOpen] = useState(false);
  const [markets, setMarkets] = useState([]);
  const [live, setLive] = useState(false);
  const [ticker, setTicker] = useState('BTC-USD');
  const [side, setSide] = useState('buy');
  const [size, setSize] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [dydxAddress, setDydxAddress] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountLive, setAccountLive] = useState(true);
  /* The leverage this ticket is aiming at, and the two limit-order options
     that were previously impossible to express from this screen. */
  const [leverage, setLeverage] = useState(2);
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [goodTil, setGoodTil] = useState('28d');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => getDydxMarkets().then((r) => {
      if (!alive) return;
      setMarkets(r.markets);
      setLive(r.live);
    });
    load();
    const id = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const market = markets.find((m) => m.ticker === ticker) || markets[0];
  useEffect(() => {
    if (market && !markets.some((m) => m.ticker === ticker)) setTicker(market.ticker);
  }, [market, markets, ticker]);

  /*
   * ─── THE NUMBERS BEHIND THE LEVERAGE CONTROL ────────────────────────────
   * Every one of them is derived, never stored, so none can drift from the
   * inputs it was computed from:
   *   entryPrice        the limit price when one is set, otherwise the oracle.
   *                     Everything below uses the SAME price, so the fee, the
   *                     notional on the review sheet and the liquidation
   *                     distance can never disagree by a limit price — the
   *                     three used to be computed from two different prices.
   *   equityUsd         the subaccount's own equity (cross margin: on dYdX the
   *                     whole account backs every position). null when the
   *                     account has not been read — never 0, because 0 would
   *                     print an infinite leverage instead of an honest dash.
   *   effectiveLeverage notional / equity: what the order ACTUALLY is, which
   *                     is the number the venue uses, not the one on the chip.
   *   marginRequired    notional × the market's own initial margin fraction.
   */
  const limitPriceNum = Number(limitPrice);
  const entryPrice = orderType === 'limit' && limitPriceNum > 0
    ? limitPriceNum
    : (Number(market?.oraclePrice) || null);
  const notional = (Number(size) || 0) * (entryPrice || 0);
  const fee = dydxFeeUsd(notional);
  const equityUsd = (() => {
    const eq = Number(account?.subaccount?.equity);
    return Number.isFinite(eq) && eq > 0 ? eq : null;
  })();
  /*
   * Free collateral is what a NEW position can actually be opened with —
   * equity minus the margin already committed to the open ones. Sizing from
   * equity would hand the user an order the venue rejects the moment they
   * already hold a position, so the free figure wins and equity is the
   * fallback when the indexer did not send it.
   */
  const freeCollateralUsd = (() => {
    const fc = Number(account?.subaccount?.freeCollateral);
    return Number.isFinite(fc) && fc > 0 ? fc : null;
  })();
  const sizeableUsd = freeCollateralUsd ?? equityUsd;
  const maxLeverage = Number.isFinite(Number(market?.maxLeverage)) ? Number(market.maxLeverage) : null;
  const effectiveLeverage = notional > 0 && equityUsd ? notional / equityUsd : null;
  const marginRequired = (() => {
    const imf = Number(market?.initialMarginFraction);
    return Number.isFinite(imf) && imf > 0 && notional > 0 ? notional * imf : null;
  })();
  const liq = useMemo(() => liquidationDistance({
    providerId: 'dydx',
    side: side === 'sell' ? 'short' : 'long',
    entryPrice,
    leverage: effectiveLeverage ?? leverage,
    maxLeverage,
    maintenanceMarginFraction: market?.maintenanceMarginFraction ?? null,
    takerFeeRate: DYDX_BUILDER_FEE_PPM / 1_000_000
  }), [side, entryPrice, effectiveLeverage, leverage, maxLeverage, market?.maintenanceMarginFraction]);

  /* The ladder the ticket offers: the house rungs, clipped to the venue's own
     cap for THIS market, with the cap itself always reachable. */
  const leverageOptions = useMemo(() => {
    const list = LEVERAGE_LADDER.filter((n) => (maxLeverage == null ? true : n <= maxLeverage));
    if (maxLeverage != null && maxLeverage > 0 && !list.includes(maxLeverage)) list.push(maxLeverage);
    if (!list.length) list.push(1);
    return [...new Set(list)].sort((a, b) => a - b);
  }, [maxLeverage]);

  /**
   * Tap a rung → size the order from the account's real equity.
   *
   * The size goes through `dydxOrderSize`, the same function the venue routes
   * use, so it is rounded to the market's own step and cannot come back as a
   * rejected order for carrying more precision than the pair accepts. With no
   * equity read there is nothing to size from: the target leverage is still
   * recorded (the risk engine and the AI desk both read it) and the page says
   * why the size did not move.
   */
  const applyLeverage = (n) => {
    haptic?.('light');
    setLeverage(n);
    if (!sizeableUsd || !entryPrice) return;
    const qty = dydxOrderSize({ notionalUsd: sizeableUsd * n, price: entryPrice, market });
    if (qty) setSize(String(qty));
  };
  const positions = account?.subaccount?.openPerpetualPositions
    ? Object.values(account.subaccount.openPerpetualPositions)
    : [];

  const refreshAccount = async (address = dydxAddress) => {
    if (!address) return;
    const r = await getDydxSubaccount(address);
    setAccount(r.account);
    setAccountLive(r.live);
  };

  /* Which step of the connect is on screen: switching the wallet to
     Ethereum, waiting for the signature, or deriving the dYdX key. */
  const [connectStage, setConnectStage] = useState(null);

  const connect = async () => {
    if (!wallet.isConnected) return setConnectOpen(true);
    setBusy(true);
    setError(null);
    setConnectStage(null);
    try {
      /*
       * The onboarding typed data is bound to Ethereum mainnet (domain
       * chainId 1). A wallet sitting on BNB Chain — this app's default —
       * refuses or silently drops it, which is the reported
       * WALLET_RETURNED_UNSIGNED. connectDydx moves the wallet to Ethereum
       * first, exactly like dydx.trade does. The in-app vault signs locally
       * and has no active chain to disagree with, so it is not switched.
       */
      const isLocal = wallet.mode === 'local';
      const connected = await connectDydx({
        getProvider: () => wallet.getEip1193Provider?.() || null,
        address: wallet.address,
        switchChain: wallet.switchChain,
        requireChain: !isLocal,
        restoreChain: wallet.mode === 'wc',
        onStage: setConnectStage
      });
      setDydxAddress(connected.address);
      await refreshAccount(connected.address);
      haptic?.('success');
    } catch (e) {
      setError(classifyDydxError(e));
      haptic?.('error');
    } finally {
      setBusy(false);
      setConnectStage(null);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await placeDydxOrder({
        market,
        side,
        size,
        slippagePct: slippage,
        orderType,
        limitPrice,
        reduceOnly,
        /* Post-only is a LIMIT+GTT flag; for a market order the SDK's own
           helper rejects the combination, so it is not sent. */
        postOnly: orderType === 'limit' ? postOnly : false,
        goodTilSeconds: (GOOD_TIL.find((g) => g.id === goodTil) || GOOD_TIL[3]).seconds
      });
      setResult(order);
      setReviewing(false);
      await refreshAccount();
      haptic?.('success');
    } catch (e) {
      const msg = String(e?.message || 'ORDER_FAILED');
      setError(/insufficient|does not exist|not found/i.test(msg) ? 'NO_COLLATERAL' : msg.slice(0, 160));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  /*
   * ─── AN EXIT, WHICH THIS TAB DID NOT HAVE ──────────────────────────────────
   * Reported across all three futures tabs: «هیچ جا نشون نمیده پوزیشن باز
   * داره، نفروشه، ببندش، یا خارج بشه.» This tab listed positions and stopped
   * there — a user could read that they were long BTC and had no button to do
   * anything about it, in the same app, on the same connection that opened it.
   *
   * A dYdX close is the SAME order as an open with one difference that is not
   * cosmetic: `reduceOnly: true`, and the side is the OPPOSITE of the position.
   * Reduce-only is enforced by the venue, not by us, so this call can shrink a
   * position and can never flip it into one on the other side — which is the
   * exact accident a hand-built "close" gets wrong.
   *
   * The market is resolved from the live list by ticker rather than read off
   * the position row: closing needs the venue's own decimals and oracle price,
   * and a row carried over from an earlier read can be a funding tick stale.
   */
  const [closingMarket, setClosingMarket] = useState(null);
  const closePosition = async (pos) => {
    const live = markets.find((m) => m.ticker === pos.market);
    if (!live || !Number.isFinite(Math.abs(Number(pos.size))) || Math.abs(Number(pos.size)) === 0) {
      /* The market list has not answered yet, or the position is a zero-size
         ghost. Both are retryable, and both say so with a code that already
         has copy — an invented code would render raw. */
      setError('ORDER_FAILED');
      return;
    }
    setBusy(true);
    setClosingMarket(pos.market);
    setError(null);
    setResult(null);
    try {
      /* `size` off a dYdX subaccount is signed (negative = short); the SDK
         wants a positive quantity plus an explicit side. */
      const sizeAbs = Math.abs(Number(pos.size));
      const order = await placeDydxOrder({
        market: live,
        side: pos.side === 'LONG' ? 'sell' : 'buy',
        size: sizeAbs,
        reduceOnly: true
      });
      setResult(order);
      await refreshAccount();
      haptic?.('success');
    } catch (e) {
      const msg = String(e?.message || 'ORDER_FAILED');
      setError(/insufficient|does not exist|not found/i.test(msg) ? 'NO_COLLATERAL' : msg.slice(0, 160));
      haptic?.('error');
    } finally {
      setBusy(false);
      setClosingMarket(null);
    }
  };

  const canReview = dydxAddress && market?.status === 'ACTIVE' && Number(size) > 0 && notional > 0 && (orderType === 'market' || (orderType === 'limit' && Number(limitPrice) > 0));

  return (
    <PageTransition embedded={embedded}>
      <div className="derivatives-hall">
        <div className="derivatives-aurora" aria-hidden="true" />
        <motion.section className="derivatives-hero" variants={riseIn} initial="hidden" animate="show">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="derivatives-title">
                <span className="derivatives-title-glow">{t('dydx.title')}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 1 }}>• dYdX</span>
              </div>
              <p className="derivatives-subtitle">{t('dydx.subtitle')}</p>
            </div>
            <span className={`pill ${live ? 'pill-up' : 'pill-down'}`} style={{ alignSelf: 'flex-start' }}>{live ? t('dydx.live') : t('dydx.offline')}</span>
          </div>
        </motion.section>

        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <div className="glass-notice" style={{ borderColor: 'rgba(255,59,107,0.16)', background: 'rgba(255,59,107,0.08)' }}>{t('dydx.risk')}</div>
        </motion.div>

        {/* Dismissible workflow guidance that reflects connection state. */}
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <InfoBox title={t('dydx.steps.title')} tone="info" id="dydx-steps">
            <ol style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 7, fontSize: 12.5, lineHeight: 1.9 }}>
              {['connect', 'marketSize', 'review', 'confirm', 'afterSubmit'].map((step) => (
                <li key={step}>{t(`dydx.steps.${step}`)}</li>
              ))}
            </ol>
            {dydxAddress && !canReview && (
              <p className="notice" style={{ marginTop: 10 }}>
                {t('dydx.steps.enterSize')}
              </p>
            )}
            {!dydxAddress && (
              <p className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>
                {t('dydx.steps.notConnected')}
              </p>
            )}
          </InfoBox>
        </motion.div>

      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18 }}>
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div className="faint">{t('dydx.tradingAccount')}</div>
            <strong>{dydxAddress ? shortAddress(dydxAddress, 7) : t('dydx.notConnected')}</strong>
          </div>
          {dydxAddress ? (
            <button className="btn btn-ghost btn-sm" onClick={() => { disconnectDydx(); setDydxAddress(null); setAccount(null); }}>{t('wallet.disconnect')}</button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={connect}>{busy ? (connectStage ? t(`dydx.stage.${connectStage}`, { defaultValue: t('common.loading') }) : t('common.loading')) : t('dydx.connect')}</button>
          )}
        </div>
        {dydxAddress && (
          <div className="row-between" style={{ marginTop: 10 }}>
            <span className="faint">{t('dydx.equity')}</span>
            <span className="mono">{account?.subaccount?.equity ? fmtUsd(account.subaccount.equity) : '0 USDC'}</span>
          </div>
        )}
        <p className="faint" style={{ marginTop: 9 }}>{t('dydx.connectNote')}</p>
      </motion.section>

      {!markets.length ? <p className="notice" style={{ marginTop: 16 }}>{t('dydx.marketUnavailable')}</p> : (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, width: '100%', boxSizing: 'border-box' }}>
          {!live && <p className="notice" style={{ marginBottom: 12 }}>{t('dydx.marketUnavailable')}</p>}
          <div className="field-label">{t('dydx.market')}</div>
          <ModernSelect
            value={market?.ticker || ''}
            onChange={setTicker}
            options={markets.filter((m) => m.status === 'ACTIVE').map((m) => {
              const [base, quote] = m.ticker.split('-');
              return {
                value: m.ticker,
                label: m.ticker,
                sublabel: quote ? `${base} / ${quote}` : '',
                base,
                quote: quote || 'USD',
                meta: m.oraclePrice > 0 ? `$${fmtPrice(m.oraclePrice)}` : undefined,
                change: Number.isFinite(m.priceChange24H) && m.oraclePrice > 0 ? (m.priceChange24H / m.oraclePrice) * 100 : undefined,
              };
            })}
            title={t('dydx.market')}
            placeholder={market?.ticker || 'BTC-USD'}
            searchable
            testId="dydx-market-select"
          />

          {/*
            ─── CANDLES + ON-DEVICE AI ──────────────────────────────────────
            The line chart is gone. The dYdX tab now runs the same TradingChart
            candlestick engine as the rest of the futures desk — pinch-zoom,
            crosshair OHLC, venue candles straight from the indexer — with the
            on-device AI forecast toggle (Kronos) wired into it: one tap and
            the model projects the next bars in violet, computed locally, nothing
            leaves the device until the user decides to download the model.
          */}
          <div data-testid="dydx-chart" style={{ marginTop: 12 }}>
            <FuturesMarketChart
              key={ticker}
              provider="dydx"
              market={ticker}
              symbol={ticker}
              height={230}
              testId="dydx-candles"
            />
          </div>

          {market && (
            <div className="deriv-kpi-strip">
              <div className="deriv-kpi-pod">
                <div className="faint" style={{ fontSize: 11 }}>{t('dydx.oraclePrice')}</div>
                <div className="stat-mini mono">${fmtPrice(market.oraclePrice)}</div>
              </div>
              <div className="deriv-kpi-pod">
                <div className="faint" style={{ fontSize: 11 }}>{t('dydx.openInterest')}</div>
                <div className="stat-mini mono">{fmtUsd(market.openInterest * market.oraclePrice)}</div>
              </div>
            </div>
          )}

          {/*
            ─── THE DESK FOR THE TOKEN ON THE CHART ABOVE ────────────────────
            «برای هر توکن انتخابی، باکس هوش مصنوعی، موتور ریسک و موتور فرصت
             را در یک باکس بازشونده زیر آن بگذار و از هوش مصنوعی هم بپرس اضافه
             کن»

            Keyed by ticker: switching the market gives the new token its own
            box and its own candle read, so a panel cannot keep the previous
            pair's numbers under a new name. It is collapsed by default — a
            folded box with a verdict on its title line is read; an open wall
            of metrics is scrolled past — and it fetches nothing until opened.
          */}
          <DydxTokenDesk
            key={ticker}
            ticker={ticker}
            market={market}
            side={side}
            notionalUsd={notional}
            collateralUsd={equityUsd}
            availableBalanceUsd={freeCollateralUsd}
            leverage={effectiveLeverage ?? leverage}
            entryPrice={entryPrice}
            onApplyLeverage={applyLeverage}
            testId="dydx-token-desk"
          />

          <div className="dir-switch">
            <button
              type="button"
              className={`dir-btn long ${side === 'buy' ? 'active' : ''}`}
              onClick={() => setSide('buy')}
            >
              <span className="dir-ico">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7" /><path d="M8 7h9v9" />
                </svg>
              </span>
              {t('dydx.buy')}
              <span className="dir-sub">{t('dydx.longSub')}</span>
            </button>
            <button
              type="button"
              className={`dir-btn short ${side === 'sell' ? 'active' : ''}`}
              onClick={() => setSide('sell')}
            >
              <span className="dir-ico">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 7l10 10" /><path d="M17 8v9H8" />
                </svg>
              </span>
              {t('dydx.sell')}
              <span className="dir-sub">{t('dydx.shortSub')}</span>
            </button>
          </div>

          <div className="deriv-field-card">
            <div className="segmented">
              {[
                { id: 'market', label: t('dydx.order.market') },
                { id: 'limit', label: t('dydx.order.limit') }
              ].map((o) => (
                <button key={o.id} type="button" className={orderType === o.id ? 'active' : ''} onClick={() => setOrderType(o.id)} style={{ isolation: 'isolate' }}>
                  {orderType === o.id && <SegIndicator id="dydx-otype" />}
                  {o.label}
                </button>
              ))}
            </div>

            {orderType === 'limit' && (
              <div style={{ marginTop: 6 }}>
                <label className="field-label">{t('dydx.order.limitPrice')}</label>
                <input type="number" inputMode="decimal" min="0" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={market ? `$${market.oraclePrice.toFixed(2)}` : '0.00'} />
                <p className="faint" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.7 }}>{t('dydx.order.limitHint')}</p>
              </div>
            )}
          </div>

          <div className="deriv-field-card">
            <label className="field-label">{t('dydx.size', { asset: market?.ticker?.split('-')[0] || '' })}</label>
            <input type="number" inputMode="decimal" min="0" value={size} onChange={(e) => setSize(e.target.value)} placeholder="0.00" />
            <label className="field-label" style={{ marginTop: 6 }}>{t('dydx.slippage')}</label>
            <div className="lev-row">
              {[0.1, 0.5, 1].map((n) => (
                <button type="button" className={`lev-chip ${Number(slippage) === n ? 'active' : ''}`} key={n} onClick={() => setSlippage(String(n))}>{n}%</button>
              ))}
            </div>
          </div>

          {/* ─── LEVERAGE: the rung sizes the order, the rows report it ──── */}
          <div className="deriv-field-card">
            <div className="row-between">
              <label className="field-label" style={{ marginBottom: 0 }}>{t('dydx.leverage.title')}</label>
              <span className="faint" style={{ fontSize: 11 }}>
                {maxLeverage ? t('dydx.leverage.max', { max: maxLeverage }) : '—'}
              </span>
            </div>
            <div className="lev-row">
              {leverageOptions.map((n) => (
                <button
                  type="button"
                  className={`lev-chip ${Number(leverage) === n ? 'active' : ''}`}
                  key={n}
                  onClick={() => applyLeverage(n)}
                  data-testid={`dydx-leverage-${n}`}
                >
                  {n}×
                </button>
              ))}
            </div>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="faint">{t('dydx.leverage.effective')}</span>
              <span className="mono">{effectiveLeverage ? `${effectiveLeverage.toFixed(2)}×` : '—'}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('dydx.leverage.margin')}</span>
              <span className="mono">{marginRequired != null ? fmtUsd(marginRequired) : '—'}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('dydx.leverage.liq')}</span>
              <span className="mono" style={liq.distancePct != null && liq.distancePct < 5 ? { color: 'var(--down, #ff3b6b)' } : undefined}>
                {liq.distancePct == null ? '—' : `${Number(liq.distancePct).toFixed(2)}%`}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('dydx.leverage.liqPrice')}</span>
              <span className="mono">{liq.liquidationPrice == null ? '—' : `$${fmtPrice(liq.liquidationPrice)}`}</span>
            </div>
            {!sizeableUsd && (
              <p className="faint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.7 }}>{t('dydx.leverage.needEquity')}</p>
            )}
            <p className="faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7 }}>{t('dydx.leverage.hint')}</p>
          </div>

          {/* ─── THE ORDER OPTIONS dYdX ACTUALLY ACCEPTS ────────────────── */}
          <div className="deriv-field-card">
            {orderType === 'limit' && (
              <>
                <label className="field-label">{t('dydx.order.goodTil')}</label>
                <div className="lev-row">
                  {GOOD_TIL.map((g) => (
                    <button
                      type="button"
                      className={`lev-chip ${goodTil === g.id ? 'active' : ''}`}
                      key={g.id}
                      onClick={() => { haptic?.('light'); setGoodTil(g.id); }}
                      data-testid={`dydx-goodtil-${g.id}`}
                    >
                      {t(`dydx.order.goodTilOptions.${g.id}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`dydx-toggle ${postOnly ? 'is-on' : ''}`}
                  onClick={() => { haptic?.('light'); setPostOnly((v) => !v); }}
                  aria-pressed={postOnly}
                  data-testid="dydx-post-only"
                >
                  <span className="dydx-toggle-dot" aria-hidden="true" />
                  <span>
                    <strong>{t('dydx.order.postOnly')}</strong>
                    <span className="faint" style={{ display: 'block', fontSize: 10.5, lineHeight: 1.7 }}>{t('dydx.order.postOnlyHint')}</span>
                  </span>
                </button>
              </>
            )}
            <button
              type="button"
              className={`dydx-toggle ${reduceOnly ? 'is-on' : ''}`}
              onClick={() => { haptic?.('light'); setReduceOnly((v) => !v); }}
              aria-pressed={reduceOnly}
              data-testid="dydx-reduce-only"
            >
              <span className="dydx-toggle-dot" aria-hidden="true" />
              <span>
                <strong>{t('dydx.order.reduceOnly')}</strong>
                <span className="faint" style={{ display: 'block', fontSize: 10.5, lineHeight: 1.7 }}>{t('dydx.order.reduceOnlyHint')}</span>
              </span>
            </button>
          </div>

          <div className="brg-quote deriv-telemetry-card" style={{ marginTop: 12 }}>
            <div className="row-between"><span className="faint">{t('dydx.notional')}</span><span className="mono">{fmtUsd(notional)}</span></div>
            <div className="row-between"><span className="faint">{t('dydx.builderFee')}</span><span className="mono">{fmtUsd(fee)}</span></div>
            <div className="row-between"><span className="faint">{t('dydx.funding')}</span><span className="mono">{Number(market?.nextFundingRate || 0).toFixed(6)}%</span></div>
          </div>

          {error && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`dydx.err.${error}`, { defaultValue: error })}</p>}
          <button className={`btn ${side === 'buy' ? 'btn-success' : 'btn-danger'}`} disabled={!canReview || busy} onClick={() => setReviewing(true)} style={{ width: '100%', minHeight: 48, marginTop: 12, borderRadius: 14, fontWeight: 800 }}>
            {dydxAddress ? t('dydx.review') : t('dydx.connect')}
          </button>
        </motion.section>
      )}

      {result && <div className="notice" style={{ marginTop: 16 }}><strong>{result.reduceOnly ? t('dydx.closeSent') : t('dydx.submitted')}</strong>{result.hash && <div className="mono faint" style={{ marginTop: 5, wordBreak: 'break-all' }}>{result.hash}</div>}</div>}

      {dydxAddress && <section style={{ marginTop: 18 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('dydx.positions')}</p>
        {!accountLive ? <p className="notice">{t('dydx.accountUnavailable')}</p> : positions.length === 0 ? <div className="empty">{t('dydx.noPositions')}</div> : (
          <div className="stack" style={{ gap: 8 }}>{positions.map((p) => <div className="card card-tight" key={p.market}>
            <div className="row-between"><strong>{p.market}</strong><span className={`pill ${p.side === 'LONG' ? 'pill-up' : 'pill-down'}`}>{p.side}</span></div>
            <div className="row-between" style={{ marginTop: 7 }}><span className="faint">{t('dydx.sizeLabel')}</span><span className="mono">{p.size}</span></div>
            <div className="row-between"><span className="faint">{t('dydx.entryPrice')}</span><span className="mono">${fmtPrice(Number(p.entryPrice))}</span></div>
            {/* One tap, reduce-only, signed with the same session that opened
                it. Before this the row was a read-only statement. */}
            <button
              type="button"
              className="btn btn-danger btn-sm"
              style={{ width: '100%', marginTop: 9 }}
              disabled={busy || !dydxAddress}
              onClick={() => closePosition(p)}
              data-testid={`dydx-close-${p.market}`}
            >
              {closingMarket === p.market ? t('dydx.closing') : t('dydx.close')}
            </button>
            {/* Take-profit / stop-loss for this position. Off unless DYDX_TPSL_ENABLED
                is set at build time; every order it sends is signed from its own click. */}
            {DYDX_TPSL_ENABLED && LazyDydxTpSlCard && (
              <Suspense fallback={null}>
                <LazyDydxTpSlCard
                  position={p}
                  market={markets.find((m) => m.ticker === p.market) || null}
                  address={dydxAddress}
                  onChanged={() => refreshAccount()}
                />
              </Suspense>
            )}
          </div>)}</div>
        )}
      </section>}

      <div style={{ marginTop: 18 }}><InfoBox title={t('dydx.builderTitle')} tone="info" id="dydx-builder">
        <p>{t('dydx.builderBody', { fee: DYDX_BUILDER_FEE_PPM, address: DYDX_BUILDER_ADDRESS })}</p>
      </InfoBox></div>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18, width: '100%', boxSizing: 'border-box', borderColor: 'rgba(0,229,255,0.14)', background: 'linear-gradient(145deg, rgba(0,229,255,0.06), rgba(255,255,255,0.02))' }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 9, background: 'rgba(0,229,255,0.12)', border: '1px solid rgba(0,229,255,0.18)', color: 'var(--rgb-1)' }}><IconInfo width={15} height={15} /></span>
          {t('dydx.fundingHelp.title')}
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.9, margin: 0 }}>
          {t('dydx.fundingHelp.body')}
        </p>
      </motion.section>

      {/* The folded trade history — this venue's fills, on this venue's page. */}
      {LazyFuturesHistory && (
        <div style={{ marginTop: 18 }}>
          <InfoBox title={t('futures.history.title')} tone="info" id="dydx-history-box">
            <Suspense fallback={<div className="spinner" />}>
              <LazyFuturesHistory />
            </Suspense>
          </InfoBox>
        </div>
      )}

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <Sheet open={reviewing} onClose={() => !busy && setReviewing(false)} title={t('dydx.confirmTitle')}>
        <div className="card card-tight stack" style={{ gap: 8 }}>
          <div className="row-between"><span className="faint">{t('dydx.market')}</span><strong>{market?.ticker}</strong></div>
          <div className="row-between"><span className="faint">{t('dydx.order.type')}</span><strong>{orderType === 'limit' ? t('dydx.order.limitAt', { price: limitPrice }) : t('dydx.order.market')}</strong></div>
          <div className="row-between"><span className="faint">{t('dydx.direction')}</span><strong>{t(`dydx.${side}`)}</strong></div>
          <div className="row-between"><span className="faint">{t('dydx.notional')}</span><span className="mono">{fmtUsd(notional)}</span></div>
          <div className="row-between"><span className="faint">{t('dydx.leverage.effective')}</span><span className="mono">{effectiveLeverage ? `${effectiveLeverage.toFixed(2)}×` : (leverage ? `${leverage}×` : '—')}</span></div>
          <div className="row-between"><span className="faint">{t('dydx.leverage.margin')}</span><span className="mono">{marginRequired != null ? fmtUsd(marginRequired) : '—'}</span></div>
          <div className="row-between"><span className="faint">{t('dydx.leverage.liqPrice')}</span><span className="mono">{liq.liquidationPrice == null ? '—' : `$${fmtPrice(liq.liquidationPrice)}`}</span></div>
          <div className="row-between"><span className="faint">{t('dydx.builderFee')}</span><span className="mono">{fmtUsd(fee)}</span></div>
          {/* What is actually being signed: the same three flags the venue
              will enforce. A review sheet that hides them is a sheet that
              asks someone to sign something it did not describe. */}
          <div className="row-between"><span className="faint">{t('dydx.order.options')}</span><span className="mono" style={{ fontSize: 11 }}>
            {[
              orderType === 'limit' ? t(`dydx.order.goodTilOptions.${goodTil}`) : t('dydx.order.market'),
              postOnly && orderType === 'limit' ? t('dydx.order.postOnly') : null,
              reduceOnly ? t('dydx.order.reduceOnly') : null
            ].filter(Boolean).join(' · ')}
          </span></div>
        </div>
        <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('dydx.confirmRisk')}</p>
        <div className="row" style={{ gap: 10, marginTop: 12 }}><button className="btn btn-ghost" onClick={() => setReviewing(false)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? t('common.loading') : t('common.confirm')}</button></div>
      </Sheet>
      </div>
    </PageTransition>
  );
}
