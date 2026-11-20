/**
 * BUY / SELL — THE LANDING DESK (2026-11-20, polished)
 * ---------------------------------------------------------------------------
 * A full-screen, headerless landing surface for fiat on/off-ramp — modelled
 * on the reference screenshot the owner sent (a MetaMask-style buy desk) and
 * refined to be minimal and non-scrollable:
 *
 *   · no app header, no bottom nav, no menu — the page IS the screen;
 *   · the TOP bar carries a bare back icon, the step COUNTER, an on-chain
 *     report icon (NEXT TO the Iran flag) and a bare Iran icon — no boxes;
 *   · the numeric KEYBOARD is glassy and sits at the bottom; the
 *     payment-methods button is a KEY of the keyboard, not a separate row;
 *   · the buy/sell toggle lives on STEP ONE (not only step two);
 *   · the Iran icon opens a FULL-SCREEN popup, only for Iranians, only in
 *     Persian; the on-chain report icon opens the WalletWatchReport card;
 *   · the page never scrolls: top bar + content + keyboard fit the viewport.
 *
 * The rail underneath is the same honest one the wizard used: the user's
 * answers are pre-filled into the destination provider's OWN public page,
 * the user confirms and pays there, and the only post-handoff signal is the
 * public blockchain — reported by WalletWatchReport, never as a payment
 * status.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Sheet from './Sheet';
import FullScreenSheet from './FullScreenSheet';
import AssetIcon from './AssetIcon';
import WalletWatchReport from './WalletWatchReport';
import IranianBuyPanel from './IranianBuyPanel';
import { useWallet } from '../context/WalletContext';
import { emitEvent } from '../lib/intent-ai/os/eventBus';
import { openUrl } from '../lib/browser';
import { rampOptions } from '../lib/rampDirectory';
import {
  GUIDED_CATALOG,
  GUIDED_NETWORKS,
  buildGuidedCheckoutUrl,
  isEvmAddress,
  normalizeDigits
} from '../lib/guidedCheckout';
import {
  IconActivity, IconArrowDown, IconArrowUpRight, IconBuilding, IconChevronLeft,
  IconChevronRight, IconIran
} from './Icons';

/* The keypad: 1-9, then . 0 ⌫. Three columns, four rows. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

/* Persian/Arabic digits the keypad never produces, but pasted text might. */
function toAsciiDigits(text) {
  return normalizeDigits(String(text ?? ''));
}

function errorKey(error) {
  return error?.code || error?.message || 'REQUEST_FAILED';
}

export default function BuySellLanding({ initialOrderId = null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();

  const [step, setStep] = useState(1);
  const [side, setSide] = useState('BUY');
  const [amount, setAmount] = useState('');
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  const [network, setNetwork] = useState('arbitrum');
  const [asset, setAsset] = useState('USDT');
  const [walletAddress, setWalletAddress] = useState('');

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [iranOpen, setIranOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [loading, setLoading] = useState('');
  const [error, setError] = useState(null);
  const [watchKick, setWatchKick] = useState(0);
  const [reportKick, setReportKick] = useState(0);

  const rtl = i18n.dir ? i18n.dir() === 'rtl' : false;
  const sell = side === 'SELL';

  /* The Iranian popup is Persian-only and only for Iranians: it renders the
     Iranian rail with dir=rtl lang=fa regardless of the app language. */
  const iranLanguageAllowed = String(i18n.resolvedLanguage || i18n.language || '').split(/[-_]/)[0] === 'fa';

  const catalog = useMemo(() => GUIDED_CATALOG, []);
  const assetSymbols = useMemo(() => [...new Set(catalog.map((row) => row.asset))], [catalog]);
  const assetNetworks = useMemo(() => catalog.filter((row) => row.asset === asset).map((row) => row.network), [catalog, asset]);
  const networkChainById = useMemo(() => {
    const map = {};
    Object.entries(GUIDED_NETWORKS).forEach(([slug, row]) => { map[slug] = row.chainId; });
    return map;
  }, []);
  const networkLabel = useCallback(
    (code) => GUIDED_NETWORKS[code]?.label || String(code || '').replace(/^./, (c) => c.toUpperCase()),
    []
  );

  useEffect(() => {
    if (wallet.address && !walletAddress) setWalletAddress(wallet.address);
  }, [wallet.address, walletAddress]);

  const chooseAsset = (nextAsset) => {
    const rows = catalog.filter((row) => row.asset === nextAsset);
    setAsset(nextAsset);
    if (rows.length && !rows.some((row) => row.network === network)) setNetwork(rows[0].network);
  };

  /* ── the keypad ─────────────────────────────────────────────────────── */
  const pressKey = (key) => {
    setError(null);
    if (key === 'del') {
      setAmount((value) => value.slice(0, -1));
      return;
    }
    setAmount((value) => {
      const ascii = toAsciiDigits(value);
      if (key === '.') {
        if (ascii.includes('.')) return ascii;
        return ascii === '' ? '0.' : `${ascii}.`;
      }
      /* no leading zeros beyond "0." — "0" then "5" is "5", not "05" */
      if (ascii === '0' && key !== '.') return key;
      if (ascii === '0.' && key !== '.') return `0${key}`;
      /* cap the fraction at 8 digits */
      const [whole, frac = ''] = ascii.split('.');
      if (frac.length >= 8) return ascii;
      return `${whole}${frac}${key}`;
    });
  };

  const amountValid = Number(amount) > 0;
  const walletValid = isEvmAddress(walletAddress);
  const stepValid = [amountValid, Boolean(network) && Boolean(asset), true];

  const go = (next) => {
    if (next === step) return;
    setStep(Math.max(1, Math.min(2, next)));
  };
  const nextStep = () => { if (stepValid[step - 1]) go(step + 1); };
  const prevStep = () => go(step - 1);

  /* ── the hand-off: compose the destination's OWN public checkout ────── */
  const continueToProvider = useCallback(async () => {
    setLoading('guided'); setError(null);
    try {
      let finalUrl;
      try { finalUrl = `${window.location.origin}/buy`; } catch { finalUrl = undefined; }
      const built = buildGuidedCheckoutUrl({
        side, asset, network, walletAddress, fiatCurrency,
        fiatAmount: sell ? undefined : amount,
        cryptoAmount: sell ? amount : undefined,
        finalUrl
      });
      const opened = await openUrl(built.url);
      if (!opened) throw Object.assign(new Error('CHECKOUT_OPEN_FAILED'), { code: 'CHECKOUT_OPEN_FAILED' });
      setWatchKick((n) => n + 1);
      emitEvent('buySell.guidedHandoff', { provider: built.provider, asset, network, side }, 'buy-sell');
    } catch (requestError) {
      setError(errorKey(requestError));
    } finally {
      setLoading('');
    }
  }, [amount, asset, fiatCurrency, network, side, walletAddress]);

  /* The payment-method popup's directory rail: the same doors the wizard
     offered, ranked, with the on-chain follow-up stated honestly. */
  const paymentResult = useMemo(
    () => rampOptions({
      country: null, side, asset, network, walletAddress,
      fiatCurrency, fiatAmount: sell ? undefined : amount, cryptoAmount: sell ? amount : undefined
    }),
    [amount, asset, fiatCurrency, network, side, walletAddress]
  );

  const openProvider = useCallback(async (option) => {
    setLoading(option.id); setError(null);
    try {
      const opened = await openUrl(option.url);
      if (!opened) { setError('CHECKOUT_OPEN_FAILED'); return; }
      setWatchKick((n) => n + 1);
      setPaymentOpen(false);
      emitEvent('buySell.guidedHandoff', { provider: option.id, asset, network, side }, 'buy-sell');
    } finally {
      setLoading('');
    }
  }, [asset, network, side]);

  const changeSide = (next) => { setSide(next); setError(null); };

  const blockReason = useMemo(() => {
    if (step === 1 && !amountValid) return t('buySell.landing.needAmount');
    if (step === 2 && (!network || !asset)) return t('buySell.landing.needNetwork');
    return '';
  }, [amountValid, asset, network, step, t]);

  const counter = t('buySell.landing.counter', { current: step, total: 2 });

  return (
    <div className={`buy-sell-landing ${sell ? 'is-sell' : 'is-buy'}`} dir={rtl ? 'rtl' : 'ltr'}>
      {/* ── TOP BAR: back · counter · report · Iran (bare icons, no box) ── */}
      <header className="bsland-top">
        <button
          type="button"
          className="bsland-icon bsland-back"
          onClick={() => (step > 1 ? prevStep() : navigate(-1))}
          aria-label={t('common.back')}
          data-testid="bsland-back"
        >
          <IconChevronLeft width={22} height={22} />
        </button>
        <span className="bsland-counter" aria-live="polite">{counter}</span>
        <span className="bsland-top-actions">
          {/* the on-chain deposit report, as an icon NEXT TO the Iran flag */}
          <button
            type="button"
            className="bsland-icon bsland-report"
            onClick={() => { setReportOpen(true); setReportKick((n) => n + 1); }}
            aria-label={t('buySell.landing.report')}
            data-testid="bsland-report"
          >
            <IconActivity width={20} height={20} />
          </button>
          <button
            type="button"
            className="bsland-icon bsland-iran"
            onClick={() => setIranOpen(true)}
            aria-label={t('buySell.landing.iran')}
            data-testid="bsland-iran"
          >
            <IconIran width={22} height={22} />
          </button>
        </span>
      </header>

      {/* ── STEP CONTENT ─────────────────────────────────────────────── */}
      <main className="bsland-content">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.section
              key="amount"
              className="bsland-step"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="bsland-kicker">{t('buySell.title')}</p>
              <h1 className="bsland-amount-title">{t('buySell.landing.amountTitle')}</h1>

              <div className="bsland-amount" dir="ltr">
                <span className="bsland-amount-value">{amount || '۰'}</span>
                <span className="bsland-amount-unit">{sell ? asset : fiatCurrency}</span>
              </div>
              <p className="bsland-hint">{t('buySell.landing.amountHint')}</p>

              {error && <div className="notice notice-danger bsland-error" role="alert">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}
            </motion.section>
          )}

          {step === 2 && (
            <motion.section
              key="asset"
              className="bsland-step"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="bsland-kicker">{t('buySell.title')}</p>
              <h2 className="bsland-section-title">{t('buySell.landing.networkTitle')}</h2>
              <div className="bsland-chips bsland-networks" role="group" aria-label={t('buySell.landing.networkTitle')} data-testid="bsland-networks">
                {(assetNetworks.length ? assetNetworks : [network]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`bsland-chip ${code === network ? 'is-active' : ''}`}
                    onClick={() => setNetwork(code)}
                  >
                    <AssetIcon chain={networkChainById[code] ?? code} size={18} />
                    <span dir="ltr">{networkLabel(code)}</span>
                  </button>
                ))}
              </div>

              <h2 className="bsland-section-title">{t('buySell.landing.tokenTitle')}</h2>
              <div className="bsland-chips bsland-tokens" role="group" aria-label={t('buySell.landing.tokenTitle')} data-testid="bsland-tokens">
                {assetSymbols.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    className={`bsland-chip ${symbol === asset ? 'is-active' : ''}`}
                    onClick={() => chooseAsset(symbol)}
                  >
                    <AssetIcon symbol={symbol} size={18} />
                    <span dir="ltr">{symbol}</span>
                  </button>
                ))}
              </div>

              {error && <div className="notice notice-danger bsland-error" role="alert">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* ── BOTTOM: glassy keyboard (step 1) · confirm (step 2) ─────── */}
      <footer className="bsland-bottom">
        {step === 1 ? (
          <>
            {/* the payment-methods button IS a key of the keyboard */}
            <div className="bsland-keypad" role="group" aria-label={t('buySell.landing.amountTitle')}>
              {KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`bsland-key ${key === 'del' ? 'is-del' : ''}`}
                  onClick={() => pressKey(key)}
                  aria-label={key === 'del' ? t('buySell.landing.amountTitle') : key}
                >
                  {key === 'del' ? '⌫' : key}
                </button>
              ))}
              <button
                type="button"
                className="bsland-pay-key"
                onClick={() => setPaymentOpen(true)}
                data-testid="bsland-payment-methods"
              >
                <IconBuilding width={15} height={15} />
                <span>{t('buySell.landing.paymentMethods')}</span>
              </button>
            </div>
            <div className="bsland-actions">
              {blockReason && <p className="bsland-blocked" role="status">{blockReason}</p>}
              <div className="bsland-step1-actions">
                {/* the buy/sell toggle lives on STEP ONE */}
                <div className="bsland-side-toggle" role="group" aria-label={t('buySell.landing.sideTitle')} data-testid="bsland-side">
                  <button
                    type="button"
                    className={`bsland-side-seg ${!sell ? 'is-active' : ''}`}
                    onClick={() => changeSide('BUY')}
                    aria-pressed={!sell}
                  >
                    <IconArrowDown width={14} height={14} />
                    <span>{t('buySell.buy')}</span>
                  </button>
                  <button
                    type="button"
                    className={`bsland-side-seg ${sell ? 'is-active' : ''}`}
                    onClick={() => changeSide('SELL')}
                    aria-pressed={sell}
                  >
                    <IconArrowUpRight width={14} height={14} />
                    <span>{t('buySell.sell')}</span>
                  </button>
                </div>
                <button
                  type="button"
                  className={`btn btn-primary bsland-next${stepValid[0] ? ' is-ready' : ''}`}
                  disabled={!stepValid[0]}
                  onClick={nextStep}
                >
                  {t('buySell.landing.next')}
                  <IconChevronRight width={16} height={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="bsland-actions bsland-confirm-bar">
            {blockReason && <p className="bsland-blocked" role="status">{blockReason}</p>}
            <button
              type="button"
              className="btn btn-primary bsland-confirm"
              disabled={Boolean(loading) || !amountValid || !walletValid}
              onClick={continueToProvider}
            >
              {loading === 'guided' ? t('buySell.preparingCheckout') : t('buySell.landing.confirm')}
              <IconChevronRight width={16} height={16} />
            </button>
          </div>
        )}
      </footer>

      {/* ── THE POPUPS ───────────────────────────────────────────────── */}

      {/* On-chain report: the deposit receipt, as a card. */}
      <Sheet open={reportOpen} onClose={() => setReportOpen(false)} title={t('buySell.landing.reportTitle')} size="lg" testId="bsland-report-sheet">
        <WalletWatchReport
          side={side}
          walletAddress={walletAddress}
          asset={asset}
          network={network}
          autoStart={reportKick}
        />
      </Sheet>

      {/* Iran: ONLY for Iranians, ONLY in Persian — FULL SCREEN. */}
      <FullScreenSheet
        open={iranOpen && iranLanguageAllowed}
        onClose={() => setIranOpen(false)}
        kicker={t('buySell.landing.iranKicker')}
        title={t('buySell.landing.iranTitle')}
        subtitle={t('buySell.landing.iranSub')}
        icon={<IconIran width={20} height={20} />}
        className="bsland-iran-full"
        testId="bsland-iran-sheet"
        closeLabel={t('common.close')}
      >
        {iranLanguageAllowed ? (
          <div dir="rtl" lang="fa">
            <IranianBuyPanel capability={null} />
          </div>
        ) : null}
      </FullScreenSheet>

      {/* Payment methods: the same pistnaadi sites + the follow-up note. */}
      <Sheet open={paymentOpen} onClose={() => setPaymentOpen(false)} title={t('buySell.landing.paymentTitle')} size="lg" testId="bsland-payment-sheet">
        <p className="bsland-sheet-note">{t('buySell.landing.paymentBody')}</p>
        {paymentResult.options.length > 0 ? (
          <div className="bsland-pay-list" role="list">
            {paymentResult.options.map((option) => (
              <div className="bsland-pay-row" role="listitem" key={option.id}>
                <div className="bsland-pay-copy">
                  <b>{option.name}</b>
                  <span className="mono" dir="ltr">{new URL(option.url).hostname}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={Boolean(loading)}
                  onClick={() => openProvider(option)}
                >
                  {t('buySell.landing.open', { name: option.name })}
                  <IconChevronRight width={14} height={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="bsland-sheet-note">{t('buySell.ramp.noneBody')}</p>
        )}
        <div className="bsland-pay-p2p">
          <p className="section-label" style={{ margin: '0 0 6px' }}>{t('buySell.ramp.p2pTitle')}</p>
          <div className="bsland-pay-p2p-rows">
            {paymentResult.p2p.map((rail) => (
              <button
                key={rail.id}
                type="button"
                className="bsland-pay-p2p-row"
                disabled={Boolean(loading)}
                onClick={() => {
                  if (rail.internal) { navigate(rail.url); setPaymentOpen(false); return; }
                  openProvider({ id: rail.id, name: rail.name, url: rail.url });
                }}
              >
                <span>{rail.name}</span>
                <IconChevronRight width={14} height={14} />
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
