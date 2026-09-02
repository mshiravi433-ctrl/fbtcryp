import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import SegIndicator from './SegIndicator';
import WalletWatchReport from './WalletWatchReport';
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
  getBuySellQuote,
  storedOrderAccessToken
} from '../lib/buySell';
import {
  GUIDED_CATALOG,
  GUIDED_FIAT,
  GUIDED_PROVIDER,
  buildGuidedCheckoutUrl,
  isEvmAddress
} from '../lib/guidedCheckout';
import { IconCheck, IconChevronRight, IconClock, IconRefresh, IconShield, IconWallet } from './Icons';

const POLL_MS = 15_000;

/* Fiat currencies commonly supported by the hosted checkout. The final
   currency/payment-method eligibility decision is always the provider's. */
const FIAT_CURRENCIES = GUIDED_FIAT;

/* The wizard: exactly the order that was asked for — amount first, then the
   wallet, then the asset, then one review screen. One decision per screen. */
const STEPS = ['amount', 'wallet', 'asset', 'review'];

const QUICK_FIAT = [50, 100, 250, 500];

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
      {order?.explorerTxUrl && (
        <a className="buy-sell-tx-link" href={order.explorerTxUrl} target="_blank" rel="noreferrer">
          {t('buySell.viewTransaction')} <IconChevronRight width={14} height={14} />
        </a>
      )}
    </section>
  );
}

function QuoteRows({ quote, t }) {
  if (!quote) return null;
  const sell = quote.side === 'SELL';
  return (
    <div className="buy-sell-summary" aria-live="polite">
      {quote.assetPrice != null && (
        <div className="trade-summary-row"><span>{t('buySell.assetPrice')}</span><strong>{amount(quote.assetPrice, `${quote.fiatCurrency}/${quote.asset}`)}</strong></div>
      )}
      {sell
        ? <div className="trade-summary-row"><span>{t('buySell.youReceiveFiat')}</span><strong>{money(quote.fiatPayout, quote.fiatCurrency)}</strong></div>
        : <div className="trade-summary-row"><span>{t('buySell.youReceive')}</span><strong>{amount(quote.cryptoAmount, quote.asset)}</strong></div>}
      {(quote.providerFees || []).map((fee, index) => (
        <div className="trade-summary-row" key={`${fee.name || 'provider'}-${index}`}><span>{fee.name || t('buySell.providerFee')}</span><strong>{feeAmount(fee)}</strong></div>
      ))}
      {quote.paymentFee != null && <div className="trade-summary-row"><span>{t('buySell.paymentFee')}</span><strong>{money(quote.paymentFee, quote.fiatCurrency)}</strong></div>}
      {quote.networkFee?.amount != null && <div className="trade-summary-row"><span>{t('buySell.networkFee')}</span><strong>{feeAmount(quote.networkFee)}</strong></div>}
      <div className="trade-summary-row buy-sell-zero"><span>{t('buySell.fbtFee')}</span><strong>{money(quote.fbtFee, quote.fiatCurrency)}</strong></div>
      {!sell && <div className="trade-summary-row buy-sell-total"><span>{t('buySell.total')}</span><strong>{money(quote.totalPayable, quote.fiatCurrency)}</strong></div>}
      {quote.paymentMethodFallback && <p className="buy-sell-method-note">{t('buySell.methodFallback', { method: t(`buySell.pm.${quote.paymentMethod}`, { defaultValue: quote.paymentMethod }) })}</p>}
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
                <div><dt>{t('buySell.provider')}</dt><dd>{t(`buySell.providerNames.${order.provider}`, { defaultValue: order.provider })}</dd></div>
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

/* Step slide: forwards enters from the end side, backwards from the start
   side; multiplied by the writing direction so fa/ar mirror naturally. */
const stepVariants = {
  enter: (custom) => ({ opacity: 0, x: 26 * custom }),
  center: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 0.8, 0.3, 1] } },
  exit: (custom) => ({ opacity: 0, x: -26 * custom, transition: { duration: 0.16 } })
};

export default function BuySellPanel({ initialOrderId = null }) {
  const { t, i18n } = useTranslation();
  const wallet = useWallet();
  const upsertOrder = useAppStore((state) => state.upsertBuySellOrder);
  const notify = useAppStore((state) => state.notify);
  const [side, setSide] = useState('BUY');
  const [step, setStep] = useState(0);
  const [stepDir, setStepDir] = useState(1);
  const [providers, setProviders] = useState(null);
  const [assets, setAssets] = useState([]);
  const [asset, setAsset] = useState('USDT');
  const [network, setNetwork] = useState('arbitrum');
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  const [paymentMethod, setPaymentMethod] = useState('CARD_PAYMENT');
  const [country, setCountry] = useState('');
  const [fiatAmount, setFiatAmount] = useState('');
  const [cryptoAmount, setCryptoAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteExpiry, setQuoteExpiry] = useState(false);
  const [order, setOrder] = useState(null);
  const [guidedOpened, setGuidedOpened] = useState(false);
  const [watchKick, setWatchKick] = useState(0);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState(null);
  const closed = useRef(false);

  const rtl = i18n.dir ? i18n.dir() === 'rtl' : false;
  const slideDir = stepDir * (rtl ? -1 : 1);

  const provider = providers?.providers?.[0] || null;
  const providerName = provider ? t(`buySell.providerNames.${provider.id}`, { defaultValue: provider.name || provider.id }) : '';
  const configurationRequired = provider?.status === 'CONFIGURATION_REQUIRED';
  const buyAvailable = Boolean(providers?.buyAvailable && provider?.onRamp);
  const sellAvailable = Boolean(providers?.sellAvailable && provider?.offRamp);
  /* The verified, order-tracked flow (server credential + webhook). */
  const trackedAvailable = side === 'SELL' ? sellAvailable : buyAvailable;
  /* The no-registration flow: prefill the official public checkout and let
     the user confirm there. Always composable — it is only a public URL. */
  const guidedAvailable = GUIDED_PROVIDER.enabled;
  const sideAvailable = trackedAvailable || guidedAvailable;

  /* One uniform catalog for the asset step: the server-approved list when
     the tracked flow is live, the curated public catalog otherwise. */
  const catalog = useMemo(
    () => (trackedAvailable && assets.length ? assets : GUIDED_CATALOG),
    [assets, trackedAvailable]
  );
  const assetSymbols = useMemo(() => [...new Set(catalog.map((row) => row.asset))], [catalog]);
  const assetNetworks = useMemo(() => catalog.filter((row) => row.asset === asset).map((row) => row.network), [catalog, asset]);
  const activeAsset = useMemo(() => catalog.find((row) => row.asset === asset && row.network === network) || null, [catalog, asset, network]);
  const paymentMethods = useMemo(() => (provider?.paymentMethods?.length ? provider.paymentMethods : ['CARD_PAYMENT']), [provider?.paymentMethods]);

  const resetQuote = useCallback(() => {
    setQuote(null); setQuoteExpiry(false); setOrder(null); setError(null); setGuidedOpened(false);
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([getBuySellProviders(), getBuySellAssets('BUY')])
      .then(([providerData, assetData]) => {
        if (!live) return;
        setProviders(providerData);
        setAssets(assetData.assets || []);
      })
      .catch(() => { /* tracked flow unavailable — the guided rail still works */ });
    return () => { live = false; };
  }, []);

  /* Keep the chosen pair valid whenever the effective catalog changes. */
  useEffect(() => {
    if (catalog.length && !catalog.some((row) => row.asset === asset && row.network === network)) {
      setAsset(catalog[0].asset); setNetwork(catalog[0].network);
    }
  }, [catalog, asset, network]);

  /* Return-to-FBT (finalUrl → /order/result/:orderId): re-attach to the
     existing order. Returning is never treated as payment success — the
     order continues from whatever the verified server state says. */
  useEffect(() => {
    if (!initialOrderId) return;
    if (!storedOrderAccessToken(initialOrderId)) { setError('ORDER_ACCESS_UNAVAILABLE'); return; }
    let live = true;
    getBuySellOrder(initialOrderId, { verify: true })
      .then((response) => {
        if (!live || !response?.order) return;
        setSide(response.order.side || 'BUY');
        setOrder(response.order);
        upsertOrder(response.order);
      })
      .catch((requestError) => live && setError(errorKey(requestError)));
    return () => { live = false; };
  }, [initialOrderId, upsertOrder]);

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
    setLoading('quote'); setError(null); setOrder(null);
    try {
      const response = await getBuySellQuote({
        side, asset, network, fiatCurrency, paymentMethod, country, walletAddress,
        ...(side === 'SELL' ? { cryptoAmount: String(cryptoAmount) } : { fiatAmount: Number(fiatAmount) })
      });
      setQuote(response.quote); setQuoteExpiry(false);
      emitEvent('buySell.quoteReady', { quoteId: response.quote.quoteId, asset, network }, 'buy-sell');
    } catch (requestError) {
      setQuote(null); setError(errorKey(requestError));
    } finally { setLoading(''); }
  }, [asset, country, cryptoAmount, fiatAmount, fiatCurrency, network, paymentMethod, side, walletAddress]);

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

  /* The no-registration handoff: compose the official public checkout URL
     with everything the wizard collected already filled in, open it, and
     start the on-chain report below. No credential, no webhook — which is
     exactly why the report only ever claims what the blockchain shows. */
  const continueToProvider = useCallback(async () => {
    setLoading('guided'); setError(null);
    try {
      let finalUrl;
      try { finalUrl = `${window.location.origin}/buy`; } catch { finalUrl = undefined; }
      const built = buildGuidedCheckoutUrl({
        side, asset, network, walletAddress, fiatCurrency, fiatAmount, cryptoAmount, finalUrl
      });
      const opened = await openUrl(built.url);
      if (!opened) throw Object.assign(new Error('CHECKOUT_OPEN_FAILED'), { code: 'CHECKOUT_OPEN_FAILED' });
      setGuidedOpened(true);
      setWatchKick((n) => n + 1);
      emitEvent('buySell.guidedHandoff', { provider: built.provider, asset, network, side }, 'buy-sell');
    } catch (requestError) { setError(errorKey(requestError)); }
    finally { setLoading(''); }
  }, [asset, cryptoAmount, fiatAmount, fiatCurrency, network, side, walletAddress]);

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

  const changeSide = (next) => { setSide(next); resetQuote(); };
  const inputChanged = (setter) => (event) => { setter(event.target.value); resetQuote(); };
  const chooseAsset = (nextAsset) => {
    const rows = catalog.filter((row) => row.asset === nextAsset);
    setAsset(nextAsset);
    if (rows.length && !rows.some((row) => row.network === network)) setNetwork(rows[0].network);
    resetQuote();
  };

  const amountValid = side === 'SELL' ? Number(cryptoAmount) > 0 : Number(fiatAmount) > 0;
  const walletValid = isEvmAddress(walletAddress);
  const assetValid = Boolean(activeAsset) || catalog.some((row) => row.asset === asset && row.network === network);
  const stepValid = [amountValid, walletValid, assetValid, true];
  const canQuote = trackedAvailable && Boolean(country) && walletValid && amountValid && !loading;

  const go = (next) => {
    if (next === step) return;
    setStepDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };
  const nextStep = () => { if (stepValid[step]) go(step + 1); };
  const prevStep = () => go(step - 1);

  const sell = side === 'SELL';

  const summaryRows = [
    { key: 'amount', label: t('buySell.wizard.summaryAmount'), value: sell ? amount(Number(cryptoAmount), asset) : money(fiatAmount, fiatCurrency), step: 0 },
    { key: 'wallet', label: t('buySell.wizard.summaryWallet'), value: shortAddress(walletAddress), step: 1 },
    { key: 'asset', label: t('buySell.wizard.summaryAsset'), value: `${asset} · ${String(network).toUpperCase()}`, step: 2 }
  ];

  /* The wizard stays on screen through the tracked flow's explicit confirm
     (AWAITING_CONFIRMATION renders the confirm-and-pay block in review);
     any later verified state hands over to the order progress card. */
  const showWizard = sideAvailable && !initialOrderId && (!order || order.status === 'AWAITING_CONFIRMATION');

  return (
    <div className="buy-sell-panel">
      <div className="segmented buy-sell-switch" role="tablist" aria-label={t('buySell.directionLabel')}>
        <button type="button" role="tab" aria-selected={side === 'BUY'} className={side === 'BUY' ? 'active' : ''} onClick={() => changeSide('BUY')} style={{ isolation: 'isolate' }}>{side === 'BUY' && <SegIndicator id="buy-sell-direction" />}{t('buySell.buy')}</button>
        <button type="button" role="tab" aria-selected={side === 'SELL'} className={side === 'SELL' ? 'active' : ''} onClick={() => changeSide('SELL')} style={{ isolation: 'isolate' }}>{side === 'SELL' && <SegIndicator id="buy-sell-direction" />}{t('buySell.sell')}</button>
      </div>

      {sell && !sellAvailable && !guidedAvailable ? (
        <motion.section className="lab-card buy-sell-unavailable" variants={riseIn} initial="hidden" animate="show">
          <span className="buy-sell-progress-icon"><IconShield width={18} height={18} /></span>
          <div>
            <p className="section-label" style={{ margin: 0 }}>{t('buySell.sellUnavailableTitle')}</p>
            <p className="prose-sm" style={{ marginTop: 6 }}>{t('buySell.sellUnavailableBody')}</p>
          </div>
        </motion.section>
      ) : (
        <>
          {providers && !sideAvailable && (
            <motion.section className="lab-card buy-sell-unavailable" variants={riseIn} initial="hidden" animate="show">
              <span className="buy-sell-progress-icon"><IconShield width={18} height={18} /></span>
              <div>
                <p className="section-label" style={{ margin: 0 }}>{configurationRequired ? t('buySell.configurationRequiredTitle') : t('buySell.providerUnavailableTitle')}</p>
                <p className="prose-sm" style={{ marginTop: 6 }}>{configurationRequired ? t('buySell.configurationRequiredBody', { provider: providerName }) : t('buySell.providerUnavailableBody')}</p>
                {configurationRequired && <p className="buy-sell-config-status mono">{t('buySell.providerStatusLabel')}: CONFIGURATION_REQUIRED</p>}
                <p className="buy-sell-zero-fee">{t('buySell.fbtFeeUnavailable')}</p>
              </div>
            </motion.section>
          )}

          {showWizard && (
            <motion.section className="lab-card buy-sell-ticket buy-sell-wizard" variants={riseIn} initial="hidden" animate="show">
              <div className="buy-sell-ticket-head">
                <div>
                  <p className="section-label">{sell ? t('buySell.sellCrypto') : t('buySell.buyCrypto')}</p>
                  <p className="faint">{trackedAvailable ? (sell ? t('buySell.fiatPayout') : t('buySell.directSettlement')) : t('buySell.wizard.noRegistration')}</p>
                </div>
                <span className="buy-sell-secure"><IconShield width={15} height={15} /> {t('buySell.nonCustodial')}</span>
              </div>

              {/* stepper — numbered, labelled, clickable backwards */}
              <ol className="bsw-stepper" aria-label={t('buySell.wizard.stepOf', { current: step + 1, total: STEPS.length })}>
                {STEPS.map((name, index) => (
                  <li key={name} className={index < step ? 'done' : index === step ? 'active' : ''}>
                    <button
                      type="button"
                      disabled={index > step}
                      onClick={() => index < step && go(index)}
                      aria-current={index === step ? 'step' : undefined}
                    >
                      <span>{index < step ? <IconCheck width={11} height={11} /> : index + 1}</span>
                      <small>{t(`buySell.wizard.steps.${name}`)}</small>
                    </button>
                  </li>
                ))}
              </ol>

              <div className="bsw-viewport">
                <AnimatePresence mode="wait" custom={slideDir} initial={false}>
                  {step === 0 && (
                    <motion.div key="amount" className="bsw-step" custom={slideDir} variants={stepVariants} initial="enter" animate="center" exit="exit">
                      <p className="bsw-title">{sell ? t('buySell.wizard.amountTitleSell') : t('buySell.wizard.amountTitleBuy')}</p>
                      <div className="bsw-amount" dir="ltr">
                        <input
                          type="number" min="0" inputMode="decimal" placeholder="0.00" autoComplete="off"
                          value={sell ? cryptoAmount : fiatAmount}
                          onChange={inputChanged(sell ? setCryptoAmount : setFiatAmount)}
                          aria-label={sell ? t('buySell.youSell') : t('buySell.youPay')}
                        />
                        {sell
                          ? <span className="bsw-amount-unit">{asset}</span>
                          : <select value={fiatCurrency} onChange={inputChanged(setFiatCurrency)} aria-label={t('buySell.wizard.currencyLabel')}>{FIAT_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select>}
                      </div>
                      {!sell && (
                        <div className="bsw-chips" role="group" aria-label={t('buySell.wizard.quickAmounts')}>
                          {QUICK_FIAT.map((value) => (
                            <button key={value} type="button" className={Number(fiatAmount) === value ? 'active' : ''} onClick={() => { setFiatAmount(String(value)); resetQuote(); }}>
                              {money(value, fiatCurrency)}
                            </button>
                          ))}
                        </div>
                      )}
                      {sell && <label className="ord-field bsw-payout"><span>{t('buySell.payoutCurrency')}</span><select value={fiatCurrency} onChange={inputChanged(setFiatCurrency)}>{FIAT_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>}
                      <p className="bsw-hint">{sell ? t('buySell.wizard.amountHintSell') : t('buySell.wizard.amountHintBuy')}</p>
                    </motion.div>
                  )}

                  {step === 1 && (
                    <motion.div key="wallet" className="bsw-step" custom={slideDir} variants={stepVariants} initial="enter" animate="center" exit="exit">
                      <p className="bsw-title">{sell ? t('buySell.wizard.walletTitleSell') : t('buySell.wizard.walletTitleBuy')}</p>
                      <div className={`bsw-wallet ${walletAddress ? (walletValid ? 'valid' : 'invalid') : ''}`}>
                        <input
                          value={walletAddress}
                          onChange={inputChanged(setWalletAddress)}
                          placeholder="0x…" spellCheck={false} autoCapitalize="none" autoCorrect="off" dir="ltr"
                          aria-label={sell ? t('buySell.sourceWallet') : t('buySell.destinationWallet')}
                        />
                        {walletValid && <span className="bsw-wallet-check" aria-hidden="true"><IconCheck width={14} height={14} /></span>}
                      </div>
                      {walletAddress && !walletValid && <p className="bsw-hint bsw-invalid">{t('buySell.wizard.walletInvalid')}</p>}
                      {walletValid && <p className="bsw-hint bsw-valid">{t('buySell.wizard.walletValid')}</p>}
                      {wallet.address && (
                        <button type="button" className="btn btn-ghost btn-sm buy-sell-use-wallet" onClick={() => { setWalletAddress(wallet.address); resetQuote(); }}>
                          <IconWallet width={15} height={15} />{t('buySell.useConnectedWallet', { address: shortAddress(wallet.address) })}
                        </button>
                      )}
                      {!wallet.address && <p className="bsw-hint">{t('buySell.manualWalletNote')}</p>}
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div key="asset" className="bsw-step" custom={slideDir} variants={stepVariants} initial="enter" animate="center" exit="exit">
                      <p className="bsw-title">{t('buySell.wizard.assetTitle')}</p>
                      <div className="bsw-assets" role="group" aria-label={t('buySell.asset')}>
                        {assetSymbols.map((symbol) => (
                          <button key={symbol} type="button" className={symbol === asset ? 'active' : ''} onClick={() => chooseAsset(symbol)}>
                            <b>{symbol}</b>
                          </button>
                        ))}
                      </div>
                      <p className="bsw-subtitle">{t('buySell.network')}</p>
                      <div className="bsw-chips" role="group" aria-label={t('buySell.network')}>
                        {(assetNetworks.length ? assetNetworks : [network]).map((code) => (
                          <button key={code} type="button" className={code === network ? 'active' : ''} onClick={() => { setNetwork(code); resetQuote(); }}>
                            {String(code).toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <p className="bsw-hint">{t('buySell.walletNetworkNote', { network: String(network).toUpperCase() })}</p>
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div key="review" className="bsw-step" custom={slideDir} variants={stepVariants} initial="enter" animate="center" exit="exit">
                      <p className="bsw-title">{t('buySell.wizard.reviewTitle')}</p>
                      <div className="bsw-summary">
                        {summaryRows.map((row) => (
                          <div className="bsw-summary-row" key={row.key}>
                            <span>{row.label}</span>
                            <strong dir="ltr">{row.value}</strong>
                            <button type="button" onClick={() => go(row.step)}>{t('buySell.wizard.edit')}</button>
                          </div>
                        ))}
                      </div>

                      {trackedAvailable ? (
                        <>
                          <div className="buy-sell-fields" style={{ marginTop: 12 }}>
                            <label className="ord-field"><span>{t('buySell.paymentMethod')}</span><select value={paymentMethod} onChange={inputChanged(setPaymentMethod)}>{paymentMethods.map((method) => <option key={method} value={method}>{t(`buySell.pm.${method}`, { defaultValue: method })}</option>)}</select></label>
                            <label className="ord-field"><span>{t('buySell.country')}</span><input value={country} maxLength="2" onChange={inputChanged(setCountry)} placeholder="DE" autoCapitalize="characters" dir="ltr" /></label>
                          </div>
                          {quote && <QuoteRows quote={quote} t={t} />}
                          {quote && <div className={`buy-sell-expiry ${quoteExpiry ? 'expired' : ''}`}><IconClock width={14} height={14} />{quoteExpiry ? t('buySell.quoteExpired') : t('buySell.quoteExpires', { seconds: Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 1000)) })}</div>}
                          {error && <div className="notice notice-danger buy-sell-error">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}
                          {!quote || quoteExpiry ? <button type="button" className="btn btn-primary buy-sell-cta" disabled={!canQuote} onClick={loadQuote}>{loading === 'quote' ? t('buySell.fetchingQuote') : quoteExpiry ? t('buySell.refreshQuote') : t('buySell.getQuote')}<IconRefresh width={17} height={17} /></button>
                            : !order ? <button type="button" className="btn btn-primary buy-sell-cta" disabled={Boolean(loading)} onClick={prepareOrder}>{loading === 'order' ? t('buySell.preparingOrder') : t('buySell.continueToPayment')}<IconChevronRight width={17} height={17} /></button>
                              : <div className="buy-sell-confirm"><p><b>{t('buySell.reviewTitle')}</b>{t('buySell.reviewBody', { asset: order.asset, amount: amount(order.cryptoAmount, order.asset), wallet: shortAddress(order.walletAddress) })}</p><button type="button" className="btn btn-primary buy-sell-cta" disabled={Boolean(loading)} onClick={continueToCheckout}>{loading === 'checkout' ? t('buySell.preparingCheckout') : t('buySell.confirmAndPay')}<IconChevronRight width={17} height={17} /></button></div>}
                          <p className="buy-sell-hosted-note">{t('buySell.hostedCheckoutNote', { provider: providerName || GUIDED_PROVIDER.name })}</p>
                        </>
                      ) : (
                        <>
                          <div className="bsw-guided-badge"><IconShield width={13} height={13} /> {t('buySell.wizard.noRegistration')}</div>
                          <p className="bsw-hint">{t('buySell.wizard.guidedNote', { provider: GUIDED_PROVIDER.name })}</p>
                          {configurationRequired && <p className="bsw-hint">{t('buySell.wizard.trackedUnavailable')}</p>}
                          {error && <div className="notice notice-danger buy-sell-error">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}
                          {guidedOpened ? (
                            <div className="buy-sell-confirm">
                              <p><b>{t('buySell.wizard.guidedOpenedTitle')}</b>{t('buySell.wizard.guidedOpenedBody', { provider: GUIDED_PROVIDER.name })}</p>
                              <button type="button" className="btn btn-ghost btn-sm buy-sell-use-wallet" onClick={continueToProvider}>{t('buySell.wizard.reopenProvider', { provider: GUIDED_PROVIDER.name })}</button>
                            </div>
                          ) : (
                            <button type="button" className="btn btn-primary buy-sell-cta" disabled={Boolean(loading) || !amountValid || !walletValid} onClick={continueToProvider}>
                              {loading === 'guided' ? t('buySell.preparingCheckout') : t('buySell.wizard.guidedCta', { provider: GUIDED_PROVIDER.name })}
                              <IconChevronRight width={17} height={17} />
                            </button>
                          )}
                          <p className="buy-sell-hosted-note">{t('buySell.wizard.guidedPrefillNote', { provider: GUIDED_PROVIDER.name })}</p>
                        </>
                      )}
                      <p className="buy-sell-powered-by">{t('buySell.poweredBy', { provider: providerName || GUIDED_PROVIDER.name })}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* wizard navigation — Back is always safe; Next gates on the
                  single decision this screen asked for */}
              {step < STEPS.length - 1 && (
                <div className="bsw-nav">
                  <button type="button" className="btn btn-ghost bsw-back" disabled={step === 0} onClick={prevStep}>{t('buySell.wizard.back')}</button>
                  <button type="button" className="btn btn-primary bsw-next" disabled={!stepValid[step]} onClick={nextStep}>
                    {t('buySell.wizard.next')} <IconChevronRight width={16} height={16} />
                  </button>
                </div>
              )}
              {step === 3 && (
                <div className="bsw-nav">
                  <button type="button" className="btn btn-ghost bsw-back" onClick={prevStep}>{t('buySell.wizard.back')}</button>
                </div>
              )}
            </motion.section>
          )}

          {initialOrderId && !order && !error && <section className="lab-card buy-sell-loading"><span className="spinner" />{t('buySell.loadingOrder')}</section>}
          {initialOrderId && error === 'ORDER_ACCESS_UNAVAILABLE' && (
            <section className="lab-card buy-sell-unavailable">
              <span className="buy-sell-progress-icon"><IconShield width={18} height={18} /></span>
              <div>
                <p className="section-label" style={{ margin: 0 }}>{t('buySell.orderAccessLostTitle')}</p>
                <p className="prose-sm" style={{ marginTop: 6 }}>{t('buySell.orderAccessLostBody')}</p>
              </div>
            </section>
          )}

          {order && (
            <>
              <OrderProgress order={order} t={t} />
              <button type="button" className="btn btn-ghost btn-sm buy-sell-refresh-status" disabled={loading === 'status'} onClick={refreshOrder}>
                <IconRefresh width={15} height={15} />{loading === 'status' ? t('buySell.verifying') : t('buySell.refreshStatus')}
              </button>
            </>
          )}
        </>
      )}

      {/* THE REAL REPORT — under BOTH tabs. It reads the public blockchain
          for the exact wallet + token above and reports arrivals (buy) or
          withdrawals (sell). It needs no provider API and no account. */}
      <WalletWatchReport
        side={side}
        walletAddress={order?.walletAddress || walletAddress}
        asset={order?.asset || asset}
        network={order?.network || network}
        autoStart={watchKick}
      />

      <RecentOrders t={t} />
    </div>
  );
}
