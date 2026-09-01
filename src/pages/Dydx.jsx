import { useEffect, useMemo, useState } from 'react';
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
  connectDydx,
  disconnectDydx,
  dydxFeeUsd,
  getDydxCandles,
  getDydxMarkets,
  getDydxSubaccount,
  placeDydxOrder
} from '../lib/dydx';
import TrendChart from '../components/TrendChart';

export default function Dydx() {
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
  const [marketsOffline, setMarketsOffline] = useState(false);
  const [ticker, setTicker] = useState('BTC-USD');
  const [side, setSide] = useState('buy');
  const [size, setSize] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [dydxAddress, setDydxAddress] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountLive, setAccountLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState(null);

  /* Candles for the selected market — see the chart block below for why. */
  const [resolution, setResolution] = useState('4HOURS');
  const [candles, setCandles] = useState([]);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [candlesOffline, setCandlesOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    setCandlesLoading(true);
    const limit = resolution === '1DAY' ? 30 : resolution === '15MINS' ? 60 : 24;
    getDydxCandles(ticker, resolution, limit)
      .then((r) => {
        if (!alive) return;
        setCandles(r?.candles || []);
        setCandlesOffline(r?.offline === true);
        setCandlesLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setCandles([]);
        setCandlesOffline(false);
        setCandlesLoading(false);
      });
    return () => { alive = false; };
  }, [ticker, resolution]);

  const candlePoints = useMemo(
    () => candles.map((c) => ({ x: c.startedAt, y: c.close })),
    [candles]
  );
  const candleChange = useMemo(() => {
    if (candles.length < 2) return 0;
    const first = Number(candles[0].close);
    const last = Number(candles[candles.length - 1].close);
    return first > 0 ? ((last - first) / first) * 100 : 0;
  }, [candles]);

  useEffect(() => {
    let alive = true;
    const load = () => getDydxMarkets().then((r) => {
      if (!alive) return;
      setMarkets(r.markets);
      setLive(r.live);
      setMarketsOffline(r.offline === true);
    });
    load();
    const id = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const market = markets.find((m) => m.ticker === ticker) || markets[0];
  useEffect(() => {
    if (market && !markets.some((m) => m.ticker === ticker)) setTicker(market.ticker);
  }, [market, markets, ticker]);

  const notional = Number(size || 0) * Number(market?.oraclePrice || 0);
  const fee = dydxFeeUsd(notional);
  const positions = account?.subaccount?.openPerpetualPositions
    ? Object.values(account.subaccount.openPerpetualPositions)
    : [];

  const refreshAccount = async (address = dydxAddress) => {
    if (!address) return;
    const r = await getDydxSubaccount(address);
    setAccount(r.account);
    setAccountLive(r.live);
  };

  const connect = async () => {
    if (!wallet.isConnected) return setConnectOpen(true);
    setBusy(true);
    setError(null);
    try {
      const signer = wallet.getSigner?.();
      const connected = await connectDydx(signer);
      setDydxAddress(connected.address);
      await refreshAccount(connected.address);
      haptic?.('success');
    } catch (e) {
      setError(/reject|denied|cancel/i.test(String(e?.message)) ? 'REJECTED' : (e?.message || 'CONNECT_FAILED'));
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await placeDydxOrder({ market, side, size, slippagePct: slippage, orderType, limitPrice });
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

  const canReview = dydxAddress && market?.status === 'ACTIVE' && Number(size) > 0 && notional > 0 && (orderType === 'market' || (orderType === 'limit' && Number(limitPrice) > 0));

  return (
    <PageTransition>
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
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={connect}>{busy ? t('common.loading') : t('dydx.connect')}</button>
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
          {!live && marketsOffline && (
            <div className="feed-offline-note" style={{ marginBottom: 12 }}>
              <span className="pulse-dot" aria-hidden="true" />
              {t('dydx.offlineNotice')}
            </div>
          )}
          {!live && !marketsOffline && <p className="notice" style={{ marginBottom: 12 }}>{t('dydx.marketUnavailable')}</p>}
          <label className="field-label">{t('dydx.market')}</label>
          <select value={market?.ticker || ''} onChange={(e) => setTicker(e.target.value)}>
            {markets.filter((m) => m.status === 'ACTIVE').map((m) => <option value={m.ticker} key={m.ticker}>{m.ticker}</option>)}
          </select>

          {/*
            ─── THE MARKET HAD NO HISTORY AT ALL ──────────────────────────────
            Reported as: "does the dYdX market not need a chart?" It did not
            have one. A leveraged position was being sized from a single oracle
            price and an open-interest figure — the two numbers that say least
            about whether the market has been trending or chopping sideways.

            The candles come from the same read-only indexer the rest of this
            screen uses. When it is unreachable the chart says so; it never
            draws a flat line at zero, because a flat line reads as "price has
            not moved" and that is a claim about the market, not about us.

            The chart is placed first so the price shape is the first thing a
            user reads after choosing a market.
          */}
          <div className="dydx-chart" data-testid="dydx-chart">
            <div className="dydx-chart-head">
              <span className="faint">
                {candlesOffline
                  ? t('dydx.chartDemo')
                  : t('dydx.chartTitle', { defaultValue: 'Price · last 4 days' })}
              </span>
              <div className="dydx-chart-res">
                {[
                  ['15MINS', t('dydx.res.15m', { defaultValue: '15m' })],
                  ['1HOUR', t('dydx.res.1h', { defaultValue: '1h' })],
                  ['4HOURS', t('dydx.res.4h', { defaultValue: '4h' })],
                  ['1DAY', t('dydx.res.1d', { defaultValue: '1d' })]
                ].map(([res, label]) => (
                  <button
                    key={res}
                    type="button"
                    className={resolution === res ? 'active' : ''}
                    onClick={() => setResolution(res)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart
              points={candlePoints}
              height={132}
              up={candleChange >= 0}
              loading={candlesLoading}
              emptyLabel={candlesLoading ? '' : t('dydx.chartUnavailable', { defaultValue: 'The dYdX indexer did not return candles for this market.' })}
              formatValue={(v) => `$${fmtPrice(v)}`}
              testId="dydx-trend"
            />
            {candles.length > 1 && (
              <div className="dydx-chart-foot">
                <span className={`mono ${candleChange >= 0 ? 'up' : 'down'}`}>
                  {candleChange >= 0 ? '+' : ''}{candleChange.toFixed(2)}%
                </span>
                <span className="faint">
                  {candlesOffline
                    ? t('dydx.chartDemoSource')
                    : t('dydx.chartSource', { defaultValue: 'dYdX indexer candles' })}
                </span>
              </div>
            )}
          </div>

          {market && <div className="row-between" style={{ margin: '12px 0' }}>
            <div><div className="faint">{t('dydx.oraclePrice')}</div><div className="stat-mini mono">${fmtPrice(market.oraclePrice)}</div></div>
            <div style={{ textAlign: 'end' }}><div className="faint">{t('dydx.openInterest')}</div><div className="mono">{fmtUsd(market.openInterest * market.oraclePrice)}</div></div>
          </div>}

          <div className="dir-switch">
            <button
              type="button"
              className={`dir-btn long ${side === 'buy' ? 'active' : ''}`}
              onClick={() => setSide('buy')}
            >
              <span className="dir-ico">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
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
                  <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
                </svg>
              </span>
              {t('dydx.sell')}
              <span className="dir-sub">{t('dydx.shortSub')}</span>
            </button>
          </div>

          <div className="segmented" style={{ marginBottom: 12 }}>
            {[
              { id: 'market', label: t('dydx.order.market') },
              { id: 'limit', label: t('dydx.order.limit') }
            ].map((o) => (
              <button key={o.id} className={orderType === o.id ? 'active' : ''} onClick={() => setOrderType(o.id)} style={{ isolation: 'isolate' }}>
                {orderType === o.id && <SegIndicator id="dydx-otype" />}
                {o.label}
              </button>
            ))}
          </div>

          {orderType === 'limit' && (
            <>
              <label className="field-label">{t('dydx.order.limitPrice')}</label>
              <input type="number" inputMode="decimal" min="0" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={market ? `$${market.oraclePrice.toFixed(2)}` : '0.00'} />
              <p className="faint" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.7 }}>{t('dydx.order.limitHint')}</p>
            </>
          )}

          <label className="field-label">{t('dydx.size', { asset: market?.ticker?.split('-')[0] || '' })}</label>
          <input type="number" inputMode="decimal" min="0" value={size} onChange={(e) => setSize(e.target.value)} placeholder="0.00" />
          <label className="field-label" style={{ marginTop: 10 }}>{t('dydx.slippage')}</label>
          <div className="row" style={{ gap: 6 }}>
            {[0.1, 0.5, 1].map((n) => <button className={`tag ${Number(slippage) === n ? 'active' : ''}`} key={n} onClick={() => setSlippage(String(n))}>{n}%</button>)}
          </div>

          <div className="brg-quote" style={{ marginTop: 12 }}>
            <div className="row-between"><span className="faint">{t('dydx.notional')}</span><span className="mono">{fmtUsd(notional)}</span></div>
            <div className="row-between"><span className="faint">{t('dydx.builderFee')}</span><span className="mono">{fmtUsd(fee)}</span></div>
            <div className="row-between"><span className="faint">{t('dydx.funding')}</span><span className="mono">{Number(market?.nextFundingRate || 0).toFixed(6)}%</span></div>
          </div>

          {error && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`dydx.err.${error}`, { defaultValue: error })}</p>}
          <button className={`btn ${side === 'buy' ? 'btn-success' : 'btn-danger'}`} disabled={!canReview || busy} onClick={() => setReviewing(true)} style={{ width: '100%', marginTop: 12 }}>
            {dydxAddress ? t('dydx.review') : t('dydx.connect')}
          </button>
        </motion.section>
      )}

      {result && <div className="notice" style={{ marginTop: 16 }}><strong>{t('dydx.submitted')}</strong>{result.hash && <div className="mono faint" style={{ marginTop: 5, wordBreak: 'break-all' }}>{result.hash}</div>}</div>}

      {dydxAddress && <section style={{ marginTop: 18 }}>
        <p className="section-label" style={{ marginBottom: 10 }}>{t('dydx.positions')}</p>
        {!accountLive ? <p className="notice">{t('dydx.accountUnavailable')}</p> : positions.length === 0 ? <div className="empty">{t('dydx.noPositions')}</div> : (
          <div className="stack" style={{ gap: 8 }}>{positions.map((p) => <div className="card card-tight" key={p.market}>
            <div className="row-between"><strong>{p.market}</strong><span className={`pill ${p.side === 'LONG' ? 'pill-up' : 'pill-down'}`}>{p.side}</span></div>
            <div className="row-between" style={{ marginTop: 7 }}><span className="faint">{t('dydx.sizeLabel')}</span><span className="mono">{p.size}</span></div>
            <div className="row-between"><span className="faint">{t('dydx.entryPrice')}</span><span className="mono">${fmtPrice(Number(p.entryPrice))}</span></div>
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

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <Sheet open={reviewing} onClose={() => !busy && setReviewing(false)} title={t('dydx.confirmTitle')}>
        <div className="card card-tight stack" style={{ gap: 8 }}>
          <div className="row-between"><span className="faint">{t('dydx.market')}</span><strong>{market?.ticker}</strong></div>
          <div className="row-between"><span className="faint">{t('dydx.order.type')}</span><strong>{orderType === 'limit' ? t('dydx.order.limitAt', { price: limitPrice }) : t('dydx.order.market')}</strong></div>
          <div className="row-between"><span className="faint">{t('dydx.direction')}</span><strong>{t(`dydx.${side}`)}</strong></div>
          <div className="row-between"><span className="faint">{t('dydx.notional')}</span><span className="mono">{fmtUsd(notional)}</span></div>
          <div className="row-between"><span className="faint">{t('dydx.builderFee')}</span><span className="mono">{fmtUsd(fee)}</span></div>
        </div>
        <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('dydx.confirmRisk')}</p>
        <div className="row" style={{ gap: 10, marginTop: 12 }}><button className="btn btn-ghost" onClick={() => setReviewing(false)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? t('common.loading') : t('common.confirm')}</button></div>
      </Sheet>
      </div>
    </PageTransition>
  );
}
