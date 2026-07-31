import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useWallet } from '../context/WalletContext';
import { openUrl } from '../lib/browser';
import {
  buildOnrampUrl,
  onrampProviders,
  onrampSupportsChain
} from '../lib/onramp';
import { IconChevronLeft, IconExternal, IconWallet } from '../components/Icons';

/**
 * BUY — fiat on-ramp.
 *
 * See lib/onramp.js for why this exists commercially. The short version: a
 * swap-only app can only earn from people who already hold crypto. This is the
 * step where someone with none becomes someone with a funded wallet, and every
 * future swap fee depends on it.
 *
 * The screen's job is narrow and mostly about honesty:
 *
 *   - show the user the exact address the coins will land in, because it is
 *     theirs and a wrong one is unrecoverable;
 *   - state plainly that a third party runs the purchase and that we cannot
 *     refund, cancel or chase it;
 *   - hand off to the provider in a Custom Tab, where the real domain is
 *     visible — a payment page inside a WebView we draw is indistinguishable
 *     from a phishing page.
 */

const AMOUNTS = [50, 100, 250, 500];
const COINS = ['USDT', 'USDC', 'ETH', 'BNB', 'BTC'];

export default function Buy() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();

  const [amount, setAmount] = useState(100);
  const [coin, setCoin] = useState('USDT');

  const address = wallet?.address ?? null;
  const chainOk = onrampSupportsChain(wallet?.chainId);
  const providers = useMemo(() => onrampProviders(), []);

  const go = (providerId) => {
    const url = buildOnrampUrl({
      provider: providerId,
      address,
      coin,
      amount,
      chainId: wallet?.chainId
    });
    /*
     * buildOnrampUrl returns null when the address is missing or not EVM.
     * Refusing here is the point: a widget opened without a destination lets
     * the provider choose one, and the user would buy into an address they do
     * not control.
     */
    if (!url) return;
    openUrl(url);
  };

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('buy.title')}</h1>
      </motion.div>

      <p className="muted">{t('buy.subtitle')}</p>

      {/* No wallet, nothing to deliver to. Say so before anything else. */}
      {!address && (
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <IconWallet width={18} height={18} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{t('buy.needWallet')}</div>
              <p className="muted" style={{ fontSize: 12.3, margin: '4px 0 10px' }}>
                {t('buy.needWalletBody')}
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/wallet')}>
                {t('buy.openWallet')}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {address && (
        <>
          {/*
            The destination, shown before any amount is chosen. This is the
            single most important thing on the screen: coins go here and
            cannot be recalled.
          */}
          <motion.div className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="faint">{t('buy.deliverTo')}</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 3 }}>{address.slice(0, 6)}…{address.slice(-4)}</div>
            <p className="faint" style={{ margin: '7px 0 0', lineHeight: 1.65 }}>
              {t('buy.deliverToNote')}
            </p>
          </motion.div>

          {!chainOk && <p className="notice">{t('buy.chainUnsupported')}</p>}

          <p className="section-label">{t('buy.amount')}</p>
          <motion.div className="row" style={{ gap: 7, flexWrap: 'wrap' }} variants={riseIn} initial="hidden" animate="show">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                className={`chip ${amount === a ? 'chip-on' : ''}`}
                onClick={() => setAmount(a)}
              >
                ${a}
              </button>
            ))}
          </motion.div>

          <p className="section-label">{t('buy.coin')}</p>
          <motion.div className="row" style={{ gap: 7, flexWrap: 'wrap' }} variants={riseIn} initial="hidden" animate="show">
            {COINS.map((c) => (
              <button
                key={c}
                className={`chip ${coin === c ? 'chip-on' : ''}`}
                onClick={() => setCoin(c)}
              >
                {c}
              </button>
            ))}
          </motion.div>

          <p className="section-label">{t('buy.provider')}</p>
          <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
            {providers.map((p) => (
              <motion.button
                key={p.id}
                className="buy-provider"
                variants={riseIn}
                whileTap={{ scale: 0.98 }}
                onClick={() => go(p.id)}
                disabled={!chainOk}
              >
                <span className="buy-provider-name">{t(`buy.p.${p.id}.name`)}</span>
                <span className="faint buy-provider-desc">{t(`buy.p.${p.id}.desc`)}</span>
                <IconExternal width={13} height={13} />
              </motion.button>
            ))}
          </motion.div>

          {/*
            The disclosure. Deliberately before the user leaves, not buried in
            terms: we are an introducer, and if the payment goes wrong we are
            not the ones who can fix it.
          */}
          <p className="notice">{t('buy.disclosure')}</p>
        </>
      )}
    </PageTransition>
  );
}
