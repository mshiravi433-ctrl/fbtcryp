import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import BuySellScreen from './BuySellScreen';
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
  IconArrowDown, IconArrowUpRight, IconBuilding, IconChevronLeft,
  IconChevronRight, IconCheck
} from './Icons';

/* The keypad: 1-9, then . 0 ⌫. Three columns, four rows. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

function IranFlag() {
  return <img className="bsland-iran-flag" src="/images/ramp/ir.svg" width={28} height={21} alt="" />;
}

function TransferPulse() {
  return (
    <svg className="bsland-transfer-pulse" viewBox="0 0 28 24" width="28" height="24" fill="none" aria-hidden="true">
      <path d="M2 12h24" stroke="currentColor" strokeOpacity=".22" />
      <path d="M2 12h5l3-5 4 12 4-14 3 7h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="26" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

// Checked-in marks for curated guided assets not in the shared SVG catalogue.
const DESK_LOGOS = { stETH: 'png', wstETH: 'png', weETH: 'png', rETH: 'svg', cbETH: 'svg' };

function DeskAssetLogo({ symbol, chain, size }) {
  const ext = DESK_LOGOS[symbol];
  return ext ? (
    <img className="bsland-asset-logo" src={`/images/ramp/${symbol}.${ext}`} alt="" width={size} height={size} />
  ) : <AssetIcon symbol={symbol} chain={chain} size={size} />;
}

/* Persian/Arabic digits the keypad never produces, but pasted text might. */
function toAsciiDigits(text) {
  return normalizeDigits(String(text ?? ''));
}

function errorKey(error) {
  return error?.code || error?.message || 'REQUEST_FAILED';
}

export default function BuySellLanding() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();

  const [step, setStep] = useState(1);
  const [side, setSide] = useState('BUY');
  const [amount, setAmount] = useState('');
  const fiatCurrency = 'USD';
  const [network, setNetwork] = useState('arbitrum');
  const [asset, setAsset] = useState('USDT');
  const [walletOverride, setWalletAddress] = useState(null);
  const walletAddress = (walletOverride ?? wallet.address ?? '').trim();

  const [picker, setPicker] = useState(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [iranOpen, setIranOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [loading, setLoading] = useState('');
  const [error, setError] = useState(null);
  const [reportKick, setReportKick] = useState(0);

  const rtl = i18n.dir ? i18n.dir() === 'rtl' : false;
  const sell = side === 'SELL';

  /* The Iranian popup is Persian-only and only for Iranians. */
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
      if (ascii === '0') return key;
      const [whole, fraction] = ascii.split('.');
      if (fraction === undefined ? whole.length >= 12 : fraction.length >= 8) return ascii;
      return `${ascii}${key}`;
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
      emitEvent('buySell.guidedHandoff', { provider: built.provider, asset, network, side }, 'buy-sell');
    } catch (requestError) {
      setError(errorKey(requestError));
    } finally {
      setLoading('');
    }
  }, [amount, asset, fiatCurrency, network, side, walletAddress]);

  /* The payment-method popup's directory rail. */
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

  const screenProps = { dir: rtl ? 'rtl' : 'ltr', closeLabel: t('common.close'), sell };

  return (
    <div className={`buy-sell-landing ${sell ? 'is-sell' : 'is-buy'}`} dir={rtl ? 'rtl' : 'ltr'}>
      {/* ── TOP BAR: three bare icons — back · tracking · Iran (no box) ── */}
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
        <span className="bsland-top-actions">
          <button
            type="button"
            className="bsland-icon bsland-report"
            onClick={() => { setReportOpen(true); setReportKick((n) => n + 1); }}
            aria-label={t('buySell.landing.report')}
            data-testid="bsland-report"
          >
            <TransferPulse />
          </button>
          {iranLanguageAllowed && <button
            type="button"
            className="bsland-icon bsland-iran"
            onClick={() => setIranOpen(true)}
            aria-label={t('buySell.landing.iran')}
            data-testid="bsland-iran"
          >
            <IranFlag />
          </button>}
        </span>
      </header>

      {/* ── STEP CONTENT ─────────────────────────────────────────────── */}
      <div className="bsland-content">
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
                <span className="bsland-amount-value" aria-live="polite">{amount || '0'}</span>
                <span className="bsland-amount-unit"><DeskAssetLogo symbol={sell ? asset : fiatCurrency} size={19} />{sell ? asset : fiatCurrency}</span>
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

              <h1 className="bsland-amount-title">{t('buySell.landing.tokenTitle')}</h1>
              <p className="bsland-summary" dir="ltr">{amount} {sell ? asset : fiatCurrency}</p>
              {[['token', asset, <DeskAssetLogo symbol={asset} size={36} />],
                ['network', networkLabel(network), <DeskAssetLogo chain={networkChainById[network]} size={36} />]
              ].map(([kind, label, logo]) => (
                <button key={kind} type="button" className="bsland-picker bsland-picker-head"
                  data-testid={kind === 'token' ? 'bsland-tokens-picker' : 'bsland-networks-picker'}
                  aria-haspopup="dialog" onClick={() => setPicker(kind)}>
                  {logo}
                  <span className="bsland-picker-label">
                    <small>{t(`buySell.landing.${kind}Title`)}</small>
                    <strong dir="ltr">{label}</strong>
                  </span>
                  <IconChevronRight className="bsland-picker-chev" width={20} height={20} />
                </button>
              ))}
              <label className="bsland-wallet">
                {t('buySell.destinationWallet')}
                <input dir="ltr" value={walletOverride ?? wallet.address ?? ''} placeholder="0x…"
                  spellCheck={false} autoCapitalize="none" autoComplete="off"
                  aria-invalid={Boolean(walletAddress) && !walletValid}
                  onChange={(event) => setWalletAddress(event.target.value)} />
              </label>

              {error && <div className="notice notice-danger bsland-error" role="alert">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* ── BOTTOM: glassy keyboard (step 1) · confirm (step 2) ─────── */}
      <footer className="bsland-bottom">
        {step === 1 ? (
          <>
            <div className="bsland-keypad" dir="ltr" role="group" aria-label={t('buySell.landing.amountTitle')}>
              {KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`bsland-key ${key === 'del' ? 'is-del' : ''}`}
                  onClick={() => pressKey(key)}
                  aria-label={key === 'del' ? t('buySell.landing.backspace', { defaultValue: rtl ? 'پاک کردن رقم آخر' : 'Delete last digit' }) : key}
                >
                  {key === 'del' ? '⌫' : key}
                </button>
              ))}
              <button
                type="button"
                className="bsland-pay-key" dir={screenProps.dir}
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

      <BuySellScreen {...screenProps} open={Boolean(picker)} onClose={() => setPicker(null)}
        title={t(`buySell.landing.${picker === 'network' ? 'network' : 'token'}Title`)} testId="bsland-asset-sheet">
        <div className="bsland-choice-list">
          {(picker === 'network' ? assetNetworks : assetSymbols).map((code) => {
            const isNetwork = picker === 'network';
            const selected = code === (isNetwork ? network : asset);
            return (
              <button type="button" key={code} className="bsland-choice" aria-pressed={selected}
                onClick={() => { if (isNetwork) setNetwork(code); else chooseAsset(code); setPicker(null); }}>
                <DeskAssetLogo chain={isNetwork ? networkChainById[code] : undefined} symbol={isNetwork ? undefined : code} size={36} />
                <strong dir="ltr">{isNetwork ? networkLabel(code) : code}</strong>
                {selected && <IconCheck width={20} height={20} />}
              </button>
            );
          })}
        </div>
      </BuySellScreen>

      {/* ── THE POPUPS ───────────────────────────────────────────────── */}

      {/* On-chain tracking report: the deposit receipt, as a card. */}
      <BuySellScreen {...screenProps} open={reportOpen} onClose={() => setReportOpen(false)} title={t('buySell.landing.reportTitle')} icon={<TransferPulse />} testId="bsland-report-sheet">
        <WalletWatchReport
          flat
          side={side}
          walletAddress={walletAddress}
          asset={asset}
          network={network}
          autoStart={reportKick}
        />
      </BuySellScreen>

      {/* Iran: ONLY for Iranians, ONLY in Persian — FULL SCREEN, de-boxed. */}
      <BuySellScreen
        {...screenProps}
        open={iranOpen && iranLanguageAllowed}
        onClose={() => setIranOpen(false)}
        title={t('buySell.landing.iranTitle')}
        icon={<IranFlag />}
        testId="bsland-iran-sheet"
      >
        {iranLanguageAllowed ? (
          <div dir="rtl" lang="fa">
            <IranianBuyPanel capability={null} flat />
          </div>
        ) : null}
      </BuySellScreen>

      {/* Payment methods: the same pistnaadi sites + the follow-up note. */}
      <BuySellScreen {...screenProps} open={paymentOpen} onClose={() => setPaymentOpen(false)} title={t('buySell.landing.paymentTitle')} icon={<IconBuilding width={22} height={22} />} testId="bsland-payment-sheet">
        <p className="bsland-sheet-note">{t('buySell.landing.paymentBody')}</p>
        {error && <div className="notice notice-danger bsland-error" role="alert">{t(`buySell.errors.${error}`, { defaultValue: t('buySell.errors.REQUEST_FAILED') })}</div>}
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
      </BuySellScreen>
    </div>
  );
}
