import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import { IconExternal } from '../components/Icons';
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
  getDydxMarkets,
  getDydxSubaccount,
  placeDydxOrder
} from '../lib/dydx';

export default function Dydx() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const { haptic, tg } = useTelegram();
  const openDydx = () => {
    haptic?.('light');
    const url = 'https://dydx.trade';
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
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

        {/* راهنمای مراحل — داخل باکس بسته‌شونده، بعد از اتصال هم درست کنترل می‌کند */}
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <InfoBox title="مراحل کار — چطور پیش می‌رود؟" tone="info" id="dydx-steps">
            <ol style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 7, fontSize: 12.5, lineHeight: 1.9 }}>
              <li><strong>اتصال کیف پول</strong> — کیف پول EVM را وصل کن و پیام آنبوردینگ dYdX را امضا کن. کلید dYdX فقط در حافظه می‌ماند.</li>
              <li><strong>انتخاب بازار و اندازه</strong> — بازار (مثلاً BTC-USD)، جهت (لانگ/شورت) و اندازه را وارد کن. تا اندازه ننویسی دکمهٔ ادامه فعال نمی‌شود — این طبیعی است.</li>
              <li><strong>بررسی</strong> — نوشنال و کارمزد (۰٫۱۰٪) را ببین و روی «بررسی سفارش» بزن.</li>
              <li><strong>تأیید نهایی</strong> — در شیت تأیید، ریسک را بخوان و «تأیید» را بزن تا سفارش واقعی روی dYdX Chain برود.</li>
              <li>بعد از ارسال، هش تراکنش و پوزیشن‌های باز پایین صفحه می‌آید. اگر موجودی کافی نباشد، پیام «وثیقه کافی نیست» می‌بینی — یعنی باید حساب dYdX را شارژ کنی.</li>
            </ol>
            {dydxAddress && !canReview && (
              <p className="notice" style={{ marginTop: 10 }}>
                کیف پول وصل است. برای ادامه، <strong>اندازه</strong> را وارد کن (مثلاً ۰٫۰۱ BTC). دکمه تا وقتی اندازه صفر است غیرفعال می‌ماند تا سفارش خالی نفرستی.
              </p>
            )}
            {!dydxAddress && (
              <p className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>
                هنوز وصل نیستی — اول «اتصال dYdX» را بزن. اگر کیف پول وصل نیست، اول کیف پول را وصل کن.
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

      {!live ? <p className="notice" style={{ marginTop: 16 }}>{t('dydx.marketUnavailable')}</p> : (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16, width: '100%', boxSizing: 'border-box' }}>
          <label className="field-label">{t('dydx.market')}</label>
          <select value={market?.ticker || ''} onChange={(e) => setTicker(e.target.value)}>
            {markets.filter((m) => m.status === 'ACTIVE').map((m) => <option value={m.ticker} key={m.ticker}>{m.ticker}</option>)}
          </select>

          {market && <div className="row-between" style={{ margin: '12px 0' }}>
            <div><div className="faint">{t('dydx.oraclePrice')}</div><div className="stat-mini mono">${fmtPrice(market.oraclePrice)}</div></div>
            <div style={{ textAlign: 'end' }}><div className="faint">{t('dydx.openInterest')}</div><div className="mono">{fmtUsd(market.openInterest * market.oraclePrice)}</div></div>
          </div>}

          <div className="segmented" style={{ marginBottom: 12 }}>
            {['buy', 'sell'].map((s) => <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)} style={{ isolation: 'isolate' }}>
              {side === s && <SegIndicator id="dydx-side" />}{t(`dydx.${s}`)}
            </button>)}
          </div>

          <div className="segmented" style={{ marginBottom: 12 }}>
            {[
              { id: 'market', label: 'مارکت' },
              { id: 'limit', label: 'لیمیت' }
            ].map((o) => (
              <button key={o.id} className={orderType === o.id ? 'active' : ''} onClick={() => setOrderType(o.id)} style={{ isolation: 'isolate' }}>
                {orderType === o.id && <SegIndicator id="dydx-otype" />}
                {o.label}
              </button>
            ))}
          </div>

          {orderType === 'limit' && (
            <>
              <label className="field-label">قیمت لیمیت (USD)</label>
              <input type="number" inputMode="decimal" min="0" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={market ? `$${market.oraclePrice.toFixed(2)}` : '0.00'} />
              <p className="faint" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.7 }}>سفارش لیمیت فقط وقتی اجرا می‌شود که قیمت به این عدد برسد — کارمزد ۰٫۱۰٪ همچنان روی نوشنال گرفته می‌شود.</p>
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
          <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 9, background: 'rgba(0,229,255,0.12)', border: '1px solid rgba(0,229,255,0.18)', color: 'var(--rgb-1)' }}><IconExternal width={15} height={15} /></span>
          شارژ حساب کجاست؟
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.9, margin: 0 }}>
          شارژ و واریز وثیقهٔ dYdX <strong style={{ color: 'var(--text-1)' }}>داخل اپ انجام نمی‌شود</strong> — نه در اپ، نه در وب خودمان. واریز USDC، برداشت و مدیریت حساب فقط در <strong style={{ color: 'var(--text-1)' }}>سایت مبدا dydx.trade</strong> با همان کیف پولی که وصل کردی انجام می‌شود. اپ فقط سفارش را می‌سازد و برای امضا به کیف پولت می‌فرستد؛ هیچ پولی دست ما نمی‌ماند.
        </p>
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 12, gap: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} onClick={openDydx}>
          <IconExternal width={15} height={15} />
          {t('dydx.fundAccount')}
        </button>
        <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7, textAlign: 'center' }}>
          باز شدن در تب جدید — سایت مبدا
        </p>
      </motion.section>

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <Sheet open={reviewing} onClose={() => !busy && setReviewing(false)} title={t('dydx.confirmTitle')}>
        <div className="card card-tight stack" style={{ gap: 8 }}>
          <div className="row-between"><span className="faint">{t('dydx.market')}</span><strong>{market?.ticker}</strong></div>
          <div className="row-between"><span className="faint">نوع سفارش</span><strong>{orderType === 'limit' ? `لیمیت @ $${limitPrice}` : 'مارکت'}</strong></div>
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
