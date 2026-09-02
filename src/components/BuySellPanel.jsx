import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import SegIndicator from './SegIndicator';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { emitEvent } from '../lib/intent-ai/os/eventBus';
import { requestSoftRefresh } from '../lib/refresh';
import { openUrl } from '../lib/browser';
import {
  createBuySellCheckout,
  createBuySellOrder,
  getBuySellAssets,
  getBuySellOrder,
  getBuySellProviders,
  getBuySellQuote
} from '../lib/buySell';
import { IconCheck, IconChevronRight, IconClock, IconRefresh, IconShield, IconWallet } from './Icons';

const POLL_MS = 15_000;

function money(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

function amount(value, symbol) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(Number(value))} ${symbol}`;
}

function feeAmount(fee) {
  if (!fee || fee.amount == null || !Number.isFinite(Number(fee.amount))) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(Number(fee.amount))}${fee.currency ? ` ${fee.currency}` : ''}`;
}

function errorKey(error) {
  return error?.code || error?.message || 'REQUEST_FAILED';
}

function statusStep(status) {
  const map = {
    AWAITING_CONFIRMATION: 'review', CHECKOUT_CREATED: 'checkout', PAYMENT_PENDING: 'payment',
    PAYMENT_CONFIRMED: 'settlement', SETTLEMENT_PENDING: 'settlement', TX_DETECTED: 'detected',
    TX_CONFIRMING: 'confirming', VERIFYING: 'verifying', VERIFICATION_PENDING: 'verifying', COMPLETED: 'completed'
  };
  return map[status] || 'review';
}

function OrderProgress({ order, t }) {
  const current = statusStep(order?.status);
  const steps = ['checkout', 'payment', 'settlement', 'detected', 'confirming', 'verifying', 'completed'];
  const active = Math.max(0, steps.indexOf(current));
  const failure = /FAILED|REJECTED|EXPIRED|REVIEW|UNAVAILABLE|CANCELLED/.test(String(order?.status || ''));
  return (
    <section className={`buy-sell-progress ${failure ? 'is-error' : ''}`} aria-live="polite">
      <div className="row" style={{ gap: 8 }}>
        <span className="buy-sell-progress-icon"><IconClock width={16} height={16} /></span>
        <div>
          <p className="section-label" style={{ margin: 0 }}>{t(`buySell.status.${failure ? 'attention' : current}`)}</p>
          <p className="faint" style={{ marginTop: 3, fontSize: 11.5 }}>{t(`buySell.status.detail.${failure ? 'attention' : current}`)}</p>
        </div>
      </div>
      <ol className="buy-sell-timeline" aria-label={t('buySell.progressLabel')}>
        {steps.map((step, index) => (
          <li key={step} className={index < active || current === 'completed' ? 'done' : index === active ? 'active' : ''}>
            <span>{index < active || current === 'completed' ? <IconCheck width={12} height={12} /> : index + 1}</span>
            <small>{t(`buySell.status.${step}`)}</small>
          </li>
        ))}
      </ol>
      {order?.txHash && (
        <a className="buy-sell-tx-link" href={`https://bscscan.com/tx/${order.txHash}`} target="_blank" rel="noreferrer">
          {t('buySell.viewTransaction')} <IconChevronRight width={14} height={14} />
        </a>
      )}
    </section>
  );
}

function QuoteRows({ quote, t }) {
  if (!quote) return null;
  return (
    <div className="buy-sell-summary" aria-live="polite">
      {quote.assetPrice != null && (
        <div className="trade-summary-row"><span>{t('buySell.assetPrice')}</span><strong>{amount(quote.assetPrice, `${quote.asset}/${quote.fiatCurrency}`)}</strong></div>
      )}
      <div className="trade-summary-row"><span>{t('buySell.youReceive')}</span><strong>{amount(quote.cryptoAmount, quote.asset)}</strong></div>
      {(quote.providerFees || []).map((fee, index) => (
        <div className="trade-summary-row" key={`${fee.name || 'provider'}-${index}`}><span>{fee.name || t('buySell.providerFee')}</span><strong>{feeAmount(fee)}</strong></div>
      ))}
      {quote.paymentFee != null && <div className="trade-summary-row"><span>{t('buySell.paymentFee')}</span><strong>{money(quote.paymentFee, quote.fiatCurrency)}</strong></div>}
      {quote.networkFee?.amount != null && <div className="trade-summary-row"><span>{t('buySell.networkFee')}</span><strong>{feeAmount(quote.networkFee)}</strong></div>}
      <div className="trade-summary-row"><span>{t('buySell.spread')}</span><strong>{quote.spread == null ? t('buySell.notReported') : money(quote.spread, quote.fiatCurrency)}</strong></div>
      <div className="trade-summary-row buy-sell-zero"><span>{t('buySell.fbtFee')}</span><strong>{money(quote.fbtFee, quote.fiatCurrency)}</strong></div>
      <div className="trade-summary-row buy-sell-total"><span>{t('buySell.total')}</span><strong>{money(quote.totalPayable, quote.fiatCurrency)}</strong></div>
    </div>
  );
}

function RecentOrders({ t }) {
  const orders = useAppStore((state) => state.buySellOrders || []);
  const [expanded, setExpanded] = useState(null);
  if (!orders.length) return null;
  return (
    <section className="lab-card buy-sell-recent">
      <p className="section-label" style={{ marginBottom: 9 }}>{t('buySell.recentTitle')}</p>
      <div className="stack" style={{ gap: 7 }}>
        {orders.slice(0, 8).map((order) => (
          <div className="buy-sell-order-row" key={order.orderId}>
            <button type="button" onClick={() => setExpanded(expanded === order.orderId ? null : order.orderId)}>
              <span><b>{order.side} {order.asset}</b><small>{order.network}</small></span>
              <span className="buy-sell-order-amount">{amount(order.cryptoAmount, order.asset)}<small>{t(`buySell.orderState.${order.status}`, { defaultValue: order.status })}</small></span>
            </button>
            {expanded === order.orderId && (
              <dl className="buy-sell-order-details">
                <div><dt>{t('buySell.orderId')}</dt><dd className="mono">{order.orderId}</dd></div>
                <div><dt>{t('buySell.provider')}</dt><dd>{order.provider}</dd></div>
                <div><dt>{t('buySell.paymentStatus')}</dt><dd>{order.paymentStatus}</dd></div>
                <div><dt>{t('buySell.settlementStatus')}</dt><dd>{order.settlementStatus}</dd></div>
                <div><dt>{t('buySell.blockchainStatus')}</dt><dd>{order.verificationStatus}</dd></div>
                <div><dt>{t('buySell.destinationWallet')}</dt><dd className="mono">{shortAddress(order.walletAddress)}</dd></div>
              </dl>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function BuySellPanel() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const upsertOrder = useAppStore((state) => state.upsertBuySellOrder);
  const notify = useAppStore((state) => state.notify);
  const [side, setSide] = useState('BUY');
  const [providers, setProviders] = useState(null);
  const [assets, setAssets] = useState([]);
  const [asset, setAsset] = useState('USDT');
  const [network, setNetwork] = useState('bsc');
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  const [paymentMethod, setPaymentMethod] = useState('VISA_MC1');
  const [country, setCountry] = useState('');
  const [fiatAmount, setFiatAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteExpiry, setQuoteExpiry] = useState(false);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState(null);
  const closed = useRef(false);

  const provider = providers?.providers?.[0] || null;
  const buyAvailable = Boolean(providers?.buyAvailable && provider?.available);
  const sellAvailable = Boolean(providers?.sellAvailable);
  const activeAsset = useMemo(() => assets.find((row) => row.asset === asset && row.network === network) || assets[0] || null, [assets, asset, network]);
  const fiatOptions = useMemo(() => {
    const rails = [
      { code: 'USD', paymentMethod: 'VISA_MC1', label: t('buySell.card') },
      { code: 'EUR', paymentMethod: 'SEPA_1', label: t('buySell.bankTransfer') },
      { code: 'GBP', paymentMethod: 'VISA_MC1', label: t('buySell.card') },
      { code: 'TRY', paymentMethod: 'VISA_MC1', label: t('buySell.card') },
      { code: 'AED', paymentMethod: 'VISA_MC1', label: t('buySell.card') }
    ];
    const allowed = new Set(provider?.paymentMethods || []);
    return rails.filter((row) => !allowed.size || allowed.has(row.paymentMethod));
  }, [provider?.paymentMethods, t]);

  const resetQuote = useCallback(() => {
    setQuote(null); setQuoteExpiry(false); setOrder(null); setError(null);
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([getBuySellProviders(), getBuySellAssets('BUY')])
      .then(([providerData, assetData]) => {
        if (!live) return;
        setProviders(providerData);
        const nextAssets = assetData.assets || [];
        setAssets(nextAssets);
        if (nextAssets.length && !nextAssets.some((row) => row.asset === asset && row.network === network)) {
          setAsset(nextAssets[0].asset); setNetwork(nextAssets[0].network);
        }
      })
      .catch((requestError) => live && setError(errorKey(requestError)));
    return () => { live = false; };
    // Initial discovery is intentionally one request. Asset changes do not
    // need to re-fetch a static, provider-approved catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wallet.address && !walletAddress) setWalletAddress(wallet.address);
  }, [wallet.address, walletAddress]);

  useEffect(() => {
    if (!quote?.expiresAt) return undefined;
    const tick = () => setQuoteExpiry(Date.now() >= Date.parse(quote.expiresAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote?.expiresAt]);

  const loadQuote = useCallback(async () => {
    if (side !== 'BUY') return;
    setLoading('quote'); setError(null); setOrder(null);
    try {
      const response = await getBuySellQuote({
        side, asset, network, fiatCurrency, fiatAmount: Number(fiatAmount),
        walletAddress, country, paymentMethod
      });
      setQuote(response.quote); setQuoteExpiry(false);
      emitEvent('buySell.quoteReady', { quoteId: response.quote.quoteId, asset, network }, 'buy-sell');
    } catch (requestError) {
      setQuote(null); setError(errorKey(requestError));
    } finally { setLoading(''); }
  }, [asset, country, fiatAmount, fiatCurrency, network, paymentMethod, side, walletAddress]);

  const prepareOrder = useCallback(async () => {
    if (!quote || quoteExpiry) return;
    setLoading('order'); setError(null);
    try {
      const response = await createBuySellOrder({ quote, walletAddress });
      setOrder(response.order); upsertOrder(response.order);
      emitEvent('buySell.created', { orderId: response.order.orderId, asset: response.order.asset, network: response.order.network }, 'buy-sell');
    } catch (requestError) { setError(errorKey(requestError)); }
    finally { setLoading(''); }
  }, [quote, quoteExpiry, upsertOrder, walletAddress]);

  const continueToCheckout = useCallback(async () => {
    if (!order || closed.current) return;
    closed.current = true;
    setLoading('checkout'); setError(null);
    try {
      const response = await createBuySellCheckout(order.orderId, { confirmed: true });
      setOrder(response.order); upsertOrder(response.order);
      const opened = await openUrl(response.checkoutUrl);
      if (!opened) throw Object.assign(new Error('CHECKOUT_OPEN_FAILED'), { code: 'CHECKOUT_OPEN_FAILED' });
      emitEvent('buySell.checkoutStarted', { orderId: response.order.orderId }, 'buy-sell');
    } catch (requestError) { setError(errorKey(requestError)); }
    finally { closed.current = false; setLoading(''); }
  }, [order, upsertOrder]);

  const refreshOrder = useCallback(async () => {
    if (!order?.orderId) return;
    setLoading('status');
    try {
      const response = await getBuySellOrder(order.orderId, { verify: true });
      const next = response.order;
      setOrder(next); upsertOrder(next);
      if (next.status === 'COMPLETED') {
        notify('buySellCompleted', 'success');
        const eventPayload = { orderId: next.orderId, txHash: next.txHash, asset: next.asset, network: next.network };
        emitEvent('buySell.completed', eventPayload, 'buy-sell');
        /* One verified event fans out through the existing shared app bus. No
           component credits a fake balance; wallet and portfolio re-read their
           real chain state after this signal. */
        ['wallet.updated', 'portfolio.updated', 'transactions.updated', 'risk.updated', 'goals.updated', 'notifications.received', 'intent.updated'].forEach((type) => emitEvent(type, eventPayload, 'buy-sell'));
        await Promise.allSettled([wallet.refreshBalance?.(), requestSoftRefresh()]);
      }
    } catch (requestError) { setError(errorKey(requestError)); }
    finally { setLoading(''); }
  }, [notify, order?.orderId, upsertOrder, wallet]);

  useEffect(() => {
    if (!order || order.status === 'COMPLETED' || /FAILED|CANCELLED|MANUAL_REVIEW/.test(order.status)) return undefined;
    const timer = setInterval(() => { refreshOrder(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [order, refreshOrder]);

  const changeSide = (next) => {
    if (next === 'SELL' && !sellAvailable) { setSide('SELL'); resetQuote(); return; }
    setSide(next); resetQuote();
  };
  const chooseAsset = (nextAsset) => {
    const next = assets.find((row) => row.asset === nextAsset) || assets[0];
    setAsset(next?.asset || nextAsset); setNetwork(next?.network || 'bsc'); resetQuote();
  };
  const inputChanged = (setter) => (event) => { setter(event.target.value); resetQuote(); };
  const canQuote = buyAvailable && Boolean(country) && Boolean(walletAddress.trim()) && Number(fiatAmount) > 0 && !loading;

  return (
    <div className="buy-sell-panel">
      <div className="segmented buy-sell-switch" role="tablist" aria-label={t('buySell.directionLabel')}>
        <button type="button" role="tab" aria-selected={side === 'BUY'} className={side === 'BUY' ? 'active' : ''} onClick={() => changeSide('BUY')} style={{ isolation: 'isolate' }}>{side === 'BUY' && <SegIndicator id="buy-sell-direction" />}{t('buySell.buy')}</button>
        <button type="button" role="tab" aria-selected={side === 'SELL'} className={side === 'SELL' ? 'active' : ''} onClick={() => changeSide('SELL')} disabled={false} style={{ isolation: 'isolate' }}>{side === 'SELL' && <SegIndicator id="buy-sell-direction" />}{t('buySell.sell')}{!sellAvailable && <small>{t('buySell.unavailableShort')}</small>}</button>
      </div>

      {side === 'SELL' ? (
        <motion.section className="lab-card buy-sell-unavailable" variants={riseIn} initial="hidden" animate="show">
          <span className="buy-sell-progress-icon"><IconShield width={18} height={18} /></span>
          <div>
            <p className="section-label" style={{ margin: 0 }}>{t('buySell.sellUnavailableTitle')}</p>
            <p className="prose-sm" style={{ marginTop: 6 }}>{t('buySell.sellUnavailableBody')}</p>
          </div>
        </motion.section>
      ) : (
        <>
          {providers === null && !error && <section className="lab-card buy-sell-loading"><span className="spinner" />{t('buySell.checkingAvailability')}</section>}
          {providers && !buyAvailable && (
            <motion.section className="lab-card buy-sell-unavailable" variants={riseIn} initial="hidden" animate="show">
              <span className="buy-sell-progress-icon"><IconShield width={18} height={18} /></span>
              <div>
                <p className="section-label" style={{ margin: 0 }}>{t('buySell.providerUnavailableTitle')}</p>
                <p className="prose-sm" style={{ marginTop: 6 }}>{t('buySell.providerUnavailableBody')}</p>
                <p className="buy-sell-zero-fee">{t('buySell.fbtFeeUnavailable')}</p>
              </div>
            </motion.section>
          )}

          {buyAvailable && <motion.section className="lab-card buy-sell-ticket" variants={riseIn} initial="hidden" animate="show">
            <div className="buy-sell-ticket-head"><div><p className="section-label">{t('buySell.buyCrypto')}</p><p className="faint">{t('buySell.directSettlement')}</p></div><span className="buy-sell-secure"><IconShield width={15} height={15} /> {t('buySell.nonCustodial')}</span></div>
            <div className="buy-sell-fields">
              <label className="ord-field"><span>{t('buySell.asset')}</span><select value={asset} onChange={(event) => chooseAsset(event.target.value)} disabled={!assets.length}>{assets.map((row) => <option key={`${row.asset}-${row.network}`} value={row.asset}>{row.asset}</option>)}</select></label>
              <label className="ord-field"><span>{t('buySell.network')}</span><select value={network} onChange={inputChanged(setNetwork)} disabled={!activeAsset}><option value={activeAsset?.network || 'bsc'}>{activeAsset?.network?.toUpperCase() || '—'}</option></select></label>
              <label className="ord-field"><span>{t('buySell.youPay')}</span><div className="buy-sell-amount-input"><input type="number" min="0" inputMode="decimal" value={fiatAmount} onChange={inputChanged(setFiatAmount)} placeholder="0.00" /><select value={fiatCurrency} onChange={(event) => { const option = fiatOptions.find((row) => row.code === event.target.value); setFiatCurrency(event.target.value); setPaymentMethod(option?.paymentMethod || 'VISA_MC1'); resetQuote(); }}>{fiatOptions.map((row) => <option key={row.code} value={row.code}>{row.code}</option>)}</select></div></label>
              <label className="ord-field"><span>{t('buySell.paymentMethod')}</span><div className="buy-sell-readonly">{fiatOptions.find((row) => row.code === fiatCurrency)?.label || '—'}</div></label>
              <label className="ord-field"><span>{t('buySell.country')}</span>{provider?.supportedCountries?.length ? <select value={country} onChange={inputChanged(setCountry)}><option value="">{t('buySell.selectCountry')}</option>{provider.supportedCountries.map((code) => <option key={code} value={code}>{code}</option>)}</select> : <input value={country} maxLength="2" onChange={inputChanged(setCountry)} placeholder="US" autoCapitalize="characters" />}</label>
              <label className="ord-field buy-sell-wallet-field"><span>{t('buySell.destinationWallet')} {wallet.address && <em>{t('buySell.connected')}</em>}</span><input value={walletAddress} onChange={inputChanged(setWalletAddress)} placeholder="0x…" spellCheck={false} autoCapitalize="none" autoCorrect="off" dir="ltr" /></label>
            </div>
            {wallet.address ? <button type="button" className="btn btn-ghost btn-sm buy-sell-use-wallet" onClick={() => { setWalletAddress(wallet.address); resetQuote(); }}><IconWallet width={15} height={15} />{t('buySell.useConnectedWallet', { address: shortAddress(wallet.address) })}</button> : <p className="notice" style={{ marginTop: 11 }}>{t('buySell.manualWalletNote')}</p>}
            <p className="buy-sell-wallet-note">{t('buySell.walletNetworkNote', { network: activeAsset?.network?.toUpperCase() || '—' })}</p>

            {quote && <QuoteRows quote={quote} t={t} />}
            {quote && <div className={`buy-sell-expiry ${quoteExpiry ? 'expired' : ''}`}><IconClock width={14} height={14} />{quoteExpiry ? t('buySell.quoteExpired') : t('buySell.quoteExpires', { seconds: Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 1000)) })}</div>}
            {error && <div className="notice notice-danger buy-sell-error">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}

            {!quote || quoteExpiry ? <button type="button" className="btn btn-primary buy-sell-cta" disabled={!canQuote} onClick={loadQuote}>{loading === 'quote' ? t('buySell.fetchingQuote') : quoteExpiry ? t('buySell.refreshQuote') : t('buySell.getQuote')}<IconRefresh width={17} height={17} /></button>
              : !order ? <button type="button" className="btn btn-primary buy-sell-cta" disabled={Boolean(loading)} onClick={prepareOrder}>{loading === 'order' ? t('buySell.preparingOrder') : t('buySell.continueToPayment')}<IconChevronRight width={17} height={17} /></button>
                : <div className="buy-sell-confirm"><p><b>{t('buySell.reviewTitle')}</b>{t('buySell.reviewBody', { asset: order.asset, amount: amount(order.cryptoAmount, order.asset), wallet: shortAddress(order.walletAddress) })}</p><button type="button" className="btn btn-primary buy-sell-cta" disabled={Boolean(loading)} onClick={continueToCheckout}>{loading === 'checkout' ? t('buySell.preparingCheckout') : t('buySell.confirmAndPay')}<IconChevronRight width={17} height={17} /></button></div>}
            <p className="buy-sell-hosted-note">{t('buySell.hostedCheckoutNote')}</p>
          </motion.section>}

          {order && <><OrderProgress order={order} t={t} /><button type="button" className="btn btn-ghost btn-sm buy-sell-refresh-status" disabled={loading === 'status'} onClick={refreshOrder}><IconRefresh width={15} height={15} />{loading === 'status' ? t('buySell.verifying') : t('buySell.refreshStatus')}</button></>}
        </>
      )}
      <RecentOrders t={t} />
    </div>
  );
}
