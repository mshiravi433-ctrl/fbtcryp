/**
 * A narrow, Persian-only USDT purchase surface.
 *
 * BuySellPanel decides whether this tab exists at all (active i18n language
 * must be exactly `fa`). The server decides whether it can take money: the
 * capability from `GET /api/iran/buy/config` reports `enabled` plus a coarse
 * readiness summary, and this component renders the *whole* journey either
 * way — live rate, Toman calculator, destination wallet, the four settlement
 * steps and the terms — so the tab is a complete, honest surface instead of a
 * dead end while the paid rail is being switched on.
 *
 * It intentionally does not share the general Ramp wizard state, asset picker,
 * network picker, or manually-entered destination field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import SegIndicator from './SegIndicator';
import WalletConnectSheet from './WalletConnectSheet';
import { IconCheck, IconChevronRight, IconClock, IconCopy, IconExternal, IconLock, IconRefresh, IconShield, IconWallet } from './Icons';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { emitEvent } from '../lib/intent-ai/os/eventBus';
import { requestSoftRefresh } from '../lib/refresh';
import { hasTelegramSession } from '../lib/telegramSession';
import {
  authorizeIranBuySettlement,
  cancelIranBuyOrder,
  clearIranBuyPendingPayment,
  createIranBuyOrder,
  createIranBuyPreview,
  ensureIranBuyWalletBinding,
  getIranBuyOrder,
  getIranBuyRate,
  openIranBuyCheckout,
  readIranBuyGatewayReturn,
  storedIranBuyPendingPayment,
  verifyIranBuyPayment
} from '../lib/iranBuy';
import { riseIn } from './PageTransition';

const POLL_MS = 15_000;
const RATE_POLL_MS = 60_000;
const QUICK_AMOUNTS = ['500000', '1000000', '2000000', '5000000'];

function normalizeTomanInput(value) {
  const digits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return String(value || '')
    .replace(/[۰-۹]/g, (char) => String(digits.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String(arabicDigits.indexOf(char)))
    .replace(/[٬,\s]/g, '')
    .replace(/[^0-9]/g, '');
}

function formatToman(value) {
  if (value == null || value === '') return '—';
  try { return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(BigInt(String(value))); }
  catch { return String(value); }
}

/* Provider quantities are decimal strings. Do not turn them into a JS Number
   (which can round an 18-decimal amount) merely to make a Persian display. */
function formatUsdt(value) {
  if (value == null || value === '') return '—';
  const raw = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  try {
    const whole = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(BigInt(match[1]));
    const fraction = match[2]?.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    return fraction == null ? whole : `${whole}٫${fraction}`;
  } catch { return raw; }
}

/**
 * Local, clearly-labelled estimate for the calculator only.
 *
 * This never prices an order: an order is priced server-side from an
 * authenticated provider quote, and the UI shows the executed amount only
 * after the provider reports a fill.
 */
function estimateUsdt(amountToman, price) {
  const amount = Number(amountToman);
  const unit = Number(price);
  if (!Number.isFinite(amount) || !Number.isFinite(unit) || amount <= 0 || unit <= 0) return null;
  const estimate = amount / unit;
  if (!Number.isFinite(estimate) || estimate <= 0) return null;
  return estimate.toFixed(estimate < 10 ? 4 : 2);
}

function errorCode(error) {
  return error?.code || error?.message || 'REQUEST_FAILED';
}

function walletModeKey(mode) {
  if (mode === 'local') return 'walletLocal';
  if (mode === 'wc') return 'walletConnect';
  return 'walletExternal';
}

function orderIsFinal(order) {
  return ['CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(String(order?.status || ''));
}

function statusLabel(t, value) {
  const status = String(value || 'UNKNOWN');
  return t(`iranBuy.status.${status}`, { defaultValue: t('iranBuy.status.UNKNOWN') });
}

function awaitingPayment(order) {
  return Boolean(order?.paymentCheckoutUrl)
    && ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(String(order?.status || ''))
    && order?.paymentStatus !== 'CONFIRMED';
}

/** The parent intentionally delegates the country-specific copy here so the
    general Buy/Sell surface remains locale-neutral. */
export function IranianBuyTabButton({ active, onClick }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? 'active' : ''}
      onClick={onClick}
      style={{ isolation: 'isolate' }}
      data-testid="iran-buy-top-tab"
    >
      {active && <SegIndicator id="iran-buy-surface" />}
      {t('iranBuy.tab')}
    </button>
  );
}

/** Public market reference rate — cached and rate-limited on the server. */
function useIranBuyRate() {
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getIranBuyRate();
      if (live.current) setRate(payload?.available ? payload : null);
    } catch {
      if (live.current) setRate(null);
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    load();
    const timer = setInterval(load, RATE_POLL_MS);
    return () => { live.current = false; clearInterval(timer); };
  }, [load]);

  return { rate, loading, refresh: load };
}

function RateStrip({ rate, loading, onRefresh, t }) {
  return (
    <section className="iran-buy-rate" data-testid="iran-buy-rate" aria-live="polite">
      <div className="iran-buy-rate-main">
        <span>{t('iranBuy.rateLabel')}</span>
        <strong>{rate?.buyPrice ? `${formatToman(String(rate.buyPrice).split('.')[0])} ${t('iranBuy.toman')}` : t('iranBuy.rateUnavailable')}</strong>
      </div>
      <div className="iran-buy-rate-meta">
        {rate?.change24h != null && (
          <em className={Number(rate.change24h) < 0 ? 'is-down' : 'is-up'}>
            {`${Number(rate.change24h) < 0 ? '−' : '+'}${formatUsdt(Math.abs(Number(rate.change24h)).toFixed(2))}٪`}
          </em>
        )}
        <small>{t('iranBuy.rateSource')}</small>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label={t('iranBuy.rateRefresh')} disabled={loading}>
          <IconRefresh width={14} height={14} />
        </button>
      </div>
    </section>
  );
}

function DestinationCard({ capability, onConnect, onSwitch, t, wallet }) {
  const targetChain = Number(capability?.network?.chainId);
  const connected = Boolean(wallet?.isConnected && wallet?.address);
  const compatible = connected
    && capability?.network?.walletFamily === 'EVM'
    && Number(wallet?.chainId) === targetChain;
  return (
    <section className={`iran-buy-destination ${compatible ? 'is-valid' : ''}`} aria-live="polite">
      <div className="iran-buy-destination-icon"><IconWallet width={18} height={18} /></div>
      <div className="iran-buy-destination-copy">
        <span>{t('iranBuy.destination')}</span>
        {compatible ? (
          <>
            <strong dir="ltr">{shortAddress(wallet.address)}</strong>
            <small>{t(`iranBuy.${walletModeKey(wallet.mode)}`)} · {t('iranBuy.walletVerified')}</small>
          </>
        ) : !connected ? (
          <small>{t('iranBuy.walletNeeded')}</small>
        ) : (
          <small>{t('iranBuy.walletNetworkMismatch', { network: capability?.network?.label || '—' })}</small>
        )}
      </div>
      {compatible ? (
        <span className="iran-buy-valid-mark" aria-label={t('iranBuy.walletVerified')}><IconCheck width={14} height={14} /></span>
      ) : !connected ? (
        <button type="button" className="btn btn-ghost btn-sm iran-buy-wallet-action" onClick={onConnect}>{t('iranBuy.connectWallet')}</button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm iran-buy-wallet-action" onClick={onSwitch}>{t('iranBuy.switchWalletNetwork')}</button>
      )}
    </section>
  );
}

/** Amount entry + the estimate. Shared by the live and the preview surface. */
function AmountField({ amountToman, capability, disabled, estimate, onChange, t }) {
  return (
    <>
      <label className="iran-buy-amount">
        <span>{t('iranBuy.amountLabel')}</span>
        <div>
          <input
            value={amountToman}
            onChange={(event) => onChange(normalizeTomanInput(event.target.value))}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('iranBuy.amountPlaceholder')}
            aria-label={t('iranBuy.amountLabel')}
            disabled={disabled}
          />
          <b>{t('iranBuy.toman')}</b>
        </div>
      </label>
      <div className="iran-buy-chips" role="group" aria-label={t('iranBuy.quickAmounts')}>
        {QUICK_AMOUNTS.map((value) => (
          <button key={value} type="button" className={amountToman === value ? 'is-active' : ''} onClick={() => onChange(value)} disabled={disabled}>
            {formatToman(value)}
          </button>
        ))}
      </div>
      <p className="iran-buy-estimate" data-testid="iran-buy-estimate">
        {estimate
          ? <>{t('iranBuy.estimateLabel')} <strong>{formatUsdt(estimate)} USDT</strong> <small>{t('iranBuy.estimateNote')}</small></>
          : <small>{t('iranBuy.estimateEmpty')}</small>}
      </p>
      {capability?.limits?.minToman && capability?.limits?.maxToman && (
        <p className="iran-buy-limit">{t('iranBuy.limit', { min: formatToman(capability.limits.minToman), max: formatToman(capability.limits.maxToman) })}</p>
      )}
    </>
  );
}

/** The four steps, always visible so the flow is understood before paying. */
function FlowGuide({ t }) {
  return (
    <ol className="iran-buy-guide" aria-label={t('iranBuy.guideTitle')}>
      {['amount', 'wallet', 'gateway', 'delivery'].map((step, index) => (
        <li key={step}>
          <span>{index + 1}</span>
          <div><b>{t(`iranBuy.guide.${step}.title`)}</b><small>{t(`iranBuy.guide.${step}.body`)}</small></div>
        </li>
      ))}
    </ol>
  );
}

function ReceiptRows({ order, t }) {
  const copy = useCallback(async () => {
    if (!order?.txHash || !globalThis.navigator?.clipboard?.writeText) return;
    try { await globalThis.navigator.clipboard.writeText(order.txHash); } catch { /* clipboard access is optional */ }
  }, [order?.txHash]);
  return (
    <dl className="iran-buy-receipt" data-testid="iran-buy-receipt">
      <div><dt>{t('iranBuy.receiptOrder')}</dt><dd className="mono" dir="ltr">{order.orderId}</dd></div>
      <div><dt>{t('iranBuy.receiptPaid')}</dt><dd>{formatToman(order.amountToman)} {t('iranBuy.toman')}</dd></div>
      <div><dt>{t('iranBuy.receiptAsset')}</dt><dd>{order.actualUsdtAmount ? `${formatUsdt(order.actualUsdtAmount)} USDT` : t('iranBuy.pendingActualAmount')}</dd></div>
      <div><dt>{t('iranBuy.receiptNetwork')}</dt><dd>{order.networkLabel || order.network}</dd></div>
      <div><dt>{t('iranBuy.receiptWallet')}</dt><dd className="mono" dir="ltr">{shortAddress(order.destinationAddress)}</dd></div>
      {order.paymentReference && (
        <div><dt>{t('iranBuy.receiptPaymentRef')}</dt><dd className="mono" dir="ltr">{order.paymentReference}</dd></div>
      )}
      <div><dt>{t('iranBuy.receiptFee')}</dt><dd>{order.withdrawalFee != null ? `${formatUsdt(order.withdrawalFee)} USDT` : t('iranBuy.pendingFee')}</dd></div>
      {order.txHash && (
        <div className="iran-buy-receipt-tx"><dt>{t('iranBuy.receiptTx')}</dt><dd><code dir="ltr">{shortAddress(order.txHash)}</code><button type="button" className="icon-btn" onClick={copy} aria-label={t('iranBuy.copyTx')}><IconCopy width={14} height={14} /></button>{order.explorerTxUrl && <a href={order.explorerTxUrl} target="_blank" rel="noreferrer" aria-label={t('iranBuy.viewTx')}><IconExternal width={14} height={14} /></a>}</dd></div>
      )}
    </dl>
  );
}

function OrderProgress({ order, t }) {
  const status = String(order?.status || 'CREATED');
  const steps = [
    { id: 'payment', active: ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(status), done: ['PAYMENT_CONFIRMED', 'PROCESSING', 'SETTLEMENT_PENDING', 'SENT', 'CONFIRMED'].includes(status) },
    { id: 'purchase', active: status === 'PROCESSING', done: ['SETTLEMENT_PENDING', 'SENT', 'CONFIRMED'].includes(status) },
    { id: 'settlement', active: ['PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING', 'SENT'].includes(status), done: status === 'CONFIRMED' },
    { id: 'confirmed', active: status === 'CONFIRMED', done: status === 'CONFIRMED' }
  ];
  const failed = ['FAILED', 'CANCELLED', 'EXPIRED'].includes(status);
  return (
    <section className={`iran-buy-progress ${failed ? 'is-error' : ''}`} aria-live="polite">
      <div className="iran-buy-progress-head">
        <span className="iran-buy-progress-icon"><IconClock width={16} height={16} /></span>
        <div><p>{statusLabel(t, status)}</p><small>{t(`iranBuy.statusDetail.${status}`, { defaultValue: t('iranBuy.statusDetail.UNKNOWN') })}</small></div>
      </div>
      <ol className="iran-buy-timeline" aria-label={t('iranBuy.progressLabel')}>
        {steps.map((step, index) => (
          <li key={step.id} className={step.done ? 'done' : step.active ? 'active' : ''}>
            <span>{step.done ? <IconCheck width={11} height={11} /> : index + 1}</span><small>{t(`iranBuy.progress.${step.id}`)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function IranianBuyPanel({ capability }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const notify = useAppStore((state) => state.notify);
  const { rate, loading: rateLoading, refresh: refreshRate } = useIranBuyRate();
  const [amountToman, setAmountToman] = useState('');
  const [preview, setPreview] = useState(null);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  const notified = useRef(new Set());
  const orderRequestId = useRef(null);
  const gatewayHandled = useRef(false);

  const enabled = Boolean(capability?.enabled && capability.asset === 'USDT' && capability.network?.walletFamily === 'EVM');
  const targetChain = Number(capability?.network?.chainId);
  const walletCompatible = Boolean(wallet?.isConnected && wallet?.address
    && capability?.asset === 'USDT'
    && capability?.network?.walletFamily === 'EVM'
    && Number(wallet?.chainId) === targetChain);
  const telegramReady = hasTelegramSession();
  const amountValid = /^[1-9]\d*$/.test(amountToman);
  const estimate = estimateUsdt(amountToman, rate?.buyPrice);
  const orderDestinationMatchesWallet = !order || (
    String(order.destinationAddress || '').toLowerCase() === String(wallet?.address || '').toLowerCase()
    && Number(order.chainId) === Number(wallet?.chainId)
  );

  useEffect(() => {
    if (!preview?.expiresAt) return undefined;
    const tick = () => setExpired(Date.now() >= Date.parse(preview.expiresAt));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [preview?.expiresAt]);

  const showError = useCallback((reason) => setError(errorCode(reason)), []);
  const clearFlow = useCallback(() => {
    setPreview(null); setOrder(null); setExpired(false); setError(''); orderRequestId.current = null;
    clearIranBuyPendingPayment();
  }, []);

  const switchNetwork = useCallback(async () => {
    setError('');
    const ok = await wallet.switchChain?.(targetChain);
    if (!ok) setError('WALLET_NETWORK_INCOMPATIBLE');
  }, [targetChain, wallet]);

  const preparePreview = useCallback(async () => {
    if (!telegramReady) { setError('AUTH_REQUIRED'); return; }
    if (!amountValid) { setError('AMOUNT_INVALID'); return; }
    if (!walletCompatible) { setError('WALLET_NETWORK_INCOMPATIBLE'); return; }
    setLoading('preview'); setError('');
    try {
      const walletBindingToken = await ensureIranBuyWalletBinding({ wallet, capability });
      const result = await createIranBuyPreview({ amountToman, walletBindingToken });
      setPreview(result.preview); setExpired(false); orderRequestId.current = null;
    } catch (requestError) { showError(requestError); }
    finally { setLoading(''); }
  }, [amountToman, amountValid, capability, showError, telegramReady, wallet, walletCompatible]);

  const createOrder = useCallback(async () => {
    if (!preview || expired || !walletCompatible
      || String(preview.destinationAddress || '').toLowerCase() !== String(wallet.address || '').toLowerCase()) {
      setError(expired ? 'QUOTE_EXPIRED' : 'WALLET_DESTINATION_CHANGED');
      return;
    }
    setLoading('order'); setError('');
    try {
      const walletBindingToken = await ensureIranBuyWalletBinding({ wallet, capability });
      orderRequestId.current ||= `iran-order_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`}`;
      const result = await createIranBuyOrder({ preview, walletBindingToken, idempotencyKey: orderRequestId.current });
      setOrder(result.order);
      /* The checkout URL is created and host-checked by the server. The browser
         only follows it; it never composes a payment link from a string. */
    } catch (requestError) { showError(requestError); }
    finally { setLoading(''); }
  }, [capability, expired, preview, showError, wallet, walletCompatible]);

  const goToCheckout = useCallback(() => {
    if (!order?.paymentCheckoutUrl) { setError('PAYMENT_NOT_STARTED'); return; }
    setError('');
    try { openIranBuyCheckout(order.paymentCheckoutUrl); }
    catch (requestError) { showError(requestError); }
  }, [order?.paymentCheckoutUrl, showError]);

  const refreshOrder = useCallback(async () => {
    if (!order?.orderId) return;
    setLoading('status'); setError('');
    try {
      const result = await getIranBuyOrder(order.orderId);
      setOrder(result.order);
    } catch (requestError) { showError(requestError); }
    finally { setLoading(''); }
  }, [order?.orderId, showError]);

  const authorizeSettlement = useCallback(async () => {
    if (!order || !orderDestinationMatchesWallet) { setError('WALLET_DESTINATION_CHANGED'); return; }
    setLoading('settlement'); setError('');
    try {
      const result = await authorizeIranBuySettlement({ order, wallet });
      setOrder(result.order);
    } catch (requestError) { showError(requestError); }
    finally { setLoading(''); }
  }, [order, orderDestinationMatchesWallet, showError, wallet]);

  const cancelOrder = useCallback(async () => {
    if (!order?.orderId) return;
    setLoading('cancel'); setError('');
    try {
      const result = await cancelIranBuyOrder(order.orderId);
      setOrder(result.order);
      clearIranBuyPendingPayment();
    } catch (requestError) { showError(requestError); }
    finally { setLoading(''); }
  }, [order?.orderId, showError]);

  /*
   * Return from the hosted checkout. The gateway's `Status=OK` is only a hint:
   * the server re-verifies the payment with the provider before this order can
   * move a single step forward. The query string is removed afterwards so a
   * reload cannot replay a stale return.
   */
  useEffect(() => {
    if (!enabled || gatewayHandled.current) return;
    const gatewayReturn = readIranBuyGatewayReturn();
    const pendingOrderId = storedIranBuyPendingPayment();
    if (!gatewayReturn || !pendingOrderId) return;
    gatewayHandled.current = true;
    setLoading('payment');
    verifyIranBuyPayment({ orderId: pendingOrderId, authority: gatewayReturn.authority, status: gatewayReturn.status })
      .then((result) => { setOrder(result.order); setError(''); })
      .catch((requestError) => { showError(requestError); })
      .finally(() => {
        setLoading('');
        try {
          const url = new URL(globalThis.location.href);
          url.search = '';
          globalThis.history?.replaceState?.(null, '', url.toString());
        } catch { /* history rewriting is cosmetic */ }
      });
  }, [enabled, showError]);

  useEffect(() => {
    if (!order || orderIsFinal(order)) return undefined;
    const timer = setInterval(() => { refreshOrder(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [order, refreshOrder]);

  useEffect(() => {
    if (order?.status !== 'CONFIRMED' || notified.current.has(order.orderId)) return;
    notified.current.add(order.orderId);
    clearIranBuyPendingPayment();
    notify('iranBuyConfirmed', 'success');
    const event = { orderId: order.orderId, asset: 'USDT', network: order.network, txHash: order.txHash || null };
    emitEvent('iranBuy.confirmed', event, 'iran-buy');
    ['wallet.updated', 'portfolio.updated', 'transactions.updated', 'notifications.received', 'intent.updated'].forEach((type) => emitEvent(type, event, 'iran-buy'));
    Promise.allSettled([wallet.refreshBalance?.(), requestSoftRefresh()]);
  }, [notify, order, wallet]);

  const errorText = error ? t(`iranBuy.errors.${error}`, { defaultValue: t('iranBuy.errors.REQUEST_FAILED') }) : '';
  const canPreview = telegramReady && amountValid && walletCompatible && !loading;
  const canCreateOrder = preview && !expired && walletCompatible && orderDestinationMatchesWallet && !loading;
  const showSettlementAuthorize = order?.status === 'PAYMENT_CONFIRMED' && order?.requiresWalletSettlementAuthorization;
  const showCancel = order && ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(order.status);
  const paymentPending = awaitingPayment(order);
  const introRows = useMemo(() => [
    { label: t('iranBuy.asset'), value: 'USDT' },
    { label: t('iranBuy.network'), value: capability?.network?.label || capability?.network?.id || 'ERC20' }
  ], [capability?.network?.id, capability?.network?.label, t]);
  const readiness = useMemo(() => {
    const groups = Array.isArray(capability?.readiness) ? capability.readiness : [];
    return (groups.length ? groups : ['ACTIVATION']).slice(0, 5);
  }, [capability?.readiness]);

  const header = (
    <div className="iran-buy-ticket-head">
      <div>
        <p className="section-label">{t('iranBuy.heading')}</p>
        <p className="faint">{enabled ? t('iranBuy.subheading') : t('iranBuy.unavailableBody')}</p>
      </div>
      <span className="iran-buy-secure"><IconShield width={15} height={15} /> {t('iranBuy.serverOnly')}</span>
    </div>
  );

  const subTabs = (
    <div className="segmented iran-buy-subtab" role="tablist" aria-label={t('iranBuy.subtabLabel')}>
      <button type="button" role="tab" aria-selected="true" className="active" style={{ isolation: 'isolate' }}>
        <SegIndicator id="iran-buy-subtab" />{t('iranBuy.buy')}
      </button>
    </div>
  );

  const lockedRows = (
    <div className="iran-buy-locked-rows">
      {introRows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong><IconLock width={13} height={13} /></div>)}
    </div>
  );

  const terms = (
    <details className="iran-buy-terms">
      <summary><IconShield width={15} height={15} /> {t('iranBuy.termsTitle')} <span aria-hidden="true">▾</span></summary>
      <ul>
        <li>{t('iranBuy.termsWallet')}</li>
        <li>{t('iranBuy.termsPayment')}</li>
        <li>{t('iranBuy.termsSettlement')}</li>
        <li>{t('iranBuy.termsSecurity')}</li>
      </ul>
    </details>
  );

  /*
   * Not live yet. The tab still shows the real market rate, a working
   * calculator, the destination wallet check and the exact journey, and it says
   * plainly what is missing — but no amount can be submitted and no payment can
   * be started, because the server refuses every mutating route.
   */
  if (!enabled) {
    return (
      <section className="iran-buy-panel" dir="rtl" lang="fa" data-testid="iran-buy-panel">
        <motion.section className="lab-card iran-buy-ticket" variants={riseIn} initial="hidden" animate="show">
          {header}
          {subTabs}
          <RateStrip rate={rate} loading={rateLoading} onRefresh={refreshRate} t={t} />
          <div className="iran-buy-entry">
            {lockedRows}
            <AmountField
              amountToman={amountToman}
              capability={capability}
              disabled={false}
              estimate={estimate}
              onChange={(value) => { setAmountToman(value); setError(''); }}
              t={t}
            />
            <DestinationCard capability={capability} wallet={wallet} t={t} onConnect={() => setConnectOpen(true)} onSwitch={switchNetwork} />
            <div className="notice iran-buy-error" role="status" data-testid="iran-buy-unavailable">
              {t('iranBuy.errors.IRAN_BUY_DISABLED')}
            </div>
            <ul className="iran-buy-readiness" aria-label={t('iranBuy.readinessTitle')}>
              {readiness.map((group) => (
                <li key={group}>
                  <IconClock width={13} height={13} />
                  {t(`iranBuy.readiness.${group}`, { defaultValue: t('iranBuy.readiness.ACTIVATION') })}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-primary iran-buy-cta" disabled data-testid="iran-buy-disabled-cta">
              {t('iranBuy.disabledCta')}
            </button>
            <p className="iran-buy-inline-note">{t('iranBuy.disabledNote')}</p>
          </div>
          <FlowGuide t={t} />
          {terms}
        </motion.section>
        <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      </section>
    );
  }

  return (
    <section className="iran-buy-panel" dir="rtl" lang="fa" data-testid="iran-buy-panel">
      <motion.section className="lab-card iran-buy-ticket" variants={riseIn} initial="hidden" animate="show">
        {header}
        {subTabs}
        <RateStrip rate={rate} loading={rateLoading} onRefresh={refreshRate} t={t} />

        {!order && !preview && (
          <div className="iran-buy-entry">
            {lockedRows}
            <AmountField
              amountToman={amountToman}
              capability={capability}
              disabled={false}
              estimate={estimate}
              onChange={(value) => { setAmountToman(value); setError(''); }}
              t={t}
            />
            {!telegramReady && <p className="iran-buy-inline-warning"><IconLock width={13} height={13} />{t('iranBuy.telegramRequired')}</p>}
            <DestinationCard capability={capability} wallet={wallet} t={t} onConnect={() => setConnectOpen(true)} onSwitch={switchNetwork} />
            {error && <div className="notice notice-danger iran-buy-error" role="alert">{errorText}</div>}
            <button type="button" className="btn btn-primary iran-buy-cta" disabled={!canPreview} onClick={preparePreview}>
              {loading === 'preview' ? t('iranBuy.preparingPreview') : t('iranBuy.continue')} <IconChevronRight width={16} height={16} />
            </button>
          </div>
        )}

        {!order && preview && (
          <div className="iran-buy-review" data-testid="iran-buy-preview">
            <p className="iran-buy-review-title">{t('iranBuy.previewTitle')}</p>
            <dl className="iran-buy-summary">
              <div><dt>{t('iranBuy.receiptPaid')}</dt><dd>{formatToman(preview.amountToman)} {t('iranBuy.toman')}</dd></div>
              <div><dt>{t('iranBuy.receiptAsset')}</dt><dd>USDT</dd></div>
              <div><dt>{t('iranBuy.receiptNetwork')}</dt><dd>{preview.network?.label || preview.network?.id}</dd></div>
              <div><dt>{t('iranBuy.receiptWallet')}</dt><dd className="mono" dir="ltr">{shortAddress(preview.destinationAddress)}</dd></div>
              <div><dt>{t('iranBuy.receiptFee')}</dt><dd>{t('iranBuy.pendingFee')}</dd></div>
              <div><dt>{t('iranBuy.finalAmount')}</dt><dd>{t('iranBuy.pendingActualAmount')}</dd></div>
            </dl>
            <p className={`iran-buy-expiry ${expired ? 'is-expired' : ''}`}><IconClock width={14} height={14} />{expired ? t('iranBuy.previewExpired') : t('iranBuy.previewExpiry', { seconds: Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - Date.now()) / 1_000)) })}</p>
            {!orderDestinationMatchesWallet && <p className="notice notice-danger iran-buy-error">{t('iranBuy.errors.WALLET_DESTINATION_CHANGED')}</p>}
            {error && <div className="notice notice-danger iran-buy-error" role="alert">{errorText}</div>}
            <div className="iran-buy-actions">
              <button type="button" className="btn btn-ghost" disabled={Boolean(loading)} onClick={clearFlow}>{t('iranBuy.back')}</button>
              <button type="button" className="btn btn-primary" disabled={!canCreateOrder} onClick={createOrder}>{loading === 'order' ? t('iranBuy.creatingOrder') : t('iranBuy.createOrder')} <IconChevronRight width={16} height={16} /></button>
            </div>
          </div>
        )}

        {order && (
          <div className="iran-buy-order" data-testid="iran-buy-order">
            <OrderProgress order={order} t={t} />
            {paymentPending && (
              <div className="iran-buy-checkout" data-testid="iran-buy-checkout">
                <div>
                  <b>{t('iranBuy.checkoutTitle')}</b>
                  <p>{t('iranBuy.checkoutBody', { amount: formatToman(order.amountToman) })}</p>
                  {order.paymentStatus === 'CANCELLED_AT_GATEWAY' && <small className="is-warning">{t('iranBuy.checkoutCancelled')}</small>}
                  {order.paymentStatus === 'VERIFICATION_UNAVAILABLE' && <small className="is-warning">{t('iranBuy.checkoutVerifyLater')}</small>}
                </div>
                <button type="button" className="btn btn-primary" onClick={goToCheckout} disabled={loading === 'payment'} data-testid="iran-buy-pay">
                  {loading === 'payment' ? t('iranBuy.verifyingPayment') : t('iranBuy.payNow')} <IconExternal width={15} height={15} />
                </button>
              </div>
            )}
            {showSettlementAuthorize && (
              <div className="iran-buy-authorization">
                <IconWallet width={18} height={18} />
                <div><b>{t('iranBuy.reauthorizeTitle')}</b><p>{t('iranBuy.reauthorizeBody')}</p></div>
              </div>
            )}
            {!orderDestinationMatchesWallet && <div className="notice notice-danger iran-buy-error" role="alert">{t('iranBuy.errors.WALLET_DESTINATION_CHANGED')}</div>}
            {error && <div className="notice notice-danger iran-buy-error" role="alert">{errorText}</div>}
            <ReceiptRows order={order} t={t} />
            <div className="iran-buy-actions iran-buy-order-actions">
              <button type="button" className="btn btn-ghost" disabled={Boolean(loading)} onClick={refreshOrder}><IconRefresh width={15} height={15} /> {loading === 'status' ? t('iranBuy.refreshing') : t('iranBuy.refresh')}</button>
              {showCancel && <button type="button" className="btn btn-ghost iran-buy-cancel" disabled={Boolean(loading)} onClick={cancelOrder}>{t('iranBuy.cancel')}</button>}
              {orderIsFinal(order) && <button type="button" className="btn btn-ghost" disabled={Boolean(loading)} onClick={clearFlow}>{t('iranBuy.newOrder')}</button>}
              {showSettlementAuthorize && <button type="button" className="btn btn-primary" disabled={Boolean(loading) || !orderDestinationMatchesWallet} onClick={authorizeSettlement}>{loading === 'settlement' ? t('iranBuy.authorizing') : t('iranBuy.authorizeSettlement')} <IconChevronRight width={16} height={16} /></button>}
            </div>
          </div>
        )}

        {!order && <FlowGuide t={t} />}
        {terms}
      </motion.section>
      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
    </section>
  );
}
