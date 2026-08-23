import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useWallet, shortAddress } from '../context/WalletContext';
import WalletConnectSheet from './WalletConnectSheet';
import { IconLink, IconShield, IconWallet } from './Icons';
import '../styles/external-wallet-purchase.css';

const FIAT_OPTIONS = ['USD', 'EUR'];
const ASSET_OPTIONS = ['ETH', 'USDT', 'BTC', 'SOL'];
const PAYMENT_OPTIONS = ['card', 'walletPay', 'bank'];

/*
 * This is intentionally a preference form, not a payment form. AppKit owns
 * provider selection, KYC and checkout; no card or personal data belongs here.
 * The project currently ships WalletConnect's Ethereum provider/modal rather
 * than the Reown AppKit On-Ramp SDK. The guarded global keeps this screen safe
 * for a future official AppKit integration without pretending an on-ramp exists.
 */
function openOfficialOnRamp() {
  const appKit = typeof window === 'undefined' ? null : (window.reownAppKit || window.appKit);
  if (typeof appKit?.open !== 'function') return false;
  appKit.open({ view: 'OnRampProviders' });
  return true;
}

export default function ExternalWalletPurchase() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [connectOpen, setConnectOpen] = useState(false);
  const [amount, setAmount] = useState('100');
  const [fiat, setFiat] = useState('USD');
  const [asset, setAsset] = useState('ETH');
  const [payment, setPayment] = useState('card');
  const [unavailable, setUnavailable] = useState(false);

  const continuePurchase = () => {
    if (!openOfficialOnRamp()) setUnavailable(true);
  };

  if (!wallet.isConnected) {
    return (
      <>
        <motion.section className="external-wallet-card external-wallet-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <span className="external-wallet-icon"><IconWallet width={23} height={23} /></span>
          <div>
            <h2>{t('buy.external.title')}</h2>
            <p>{t('buy.external.connectMessage')}</p>
          </div>
          <button className="btn btn-primary external-wallet-connect" onClick={() => setConnectOpen(true)}>
            <IconLink width={16} height={16} /> {t('buy.external.connect')}
          </button>
        </motion.section>
        <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    );
  }

  return (
    <>
      <motion.section className="external-wallet-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="external-wallet-head">
          <div className="external-wallet-icon"><IconWallet width={23} height={23} /></div>
          <div>
            <h2>{t('buy.external.title')}</h2>
            <p>{t('buy.external.connected')}</p>
          </div>
          <span className="external-wallet-status"><i />{t('buy.external.status')}</span>
        </div>
        <div className="external-wallet-identity">
          <div>
            <span>{t('buy.external.address')}</span>
            <strong className="mono" dir="ltr">{shortAddress(wallet.address)}</strong>
          </div>
          <div>
            <span>{t('buy.external.network')}</span>
            <strong>{wallet.chain?.name || t('buy.external.networkUnavailable')}</strong>
          </div>
        </div>
      </motion.section>

      <motion.section className="external-wallet-card external-wallet-form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
        <div className="external-wallet-form-title">
          <h2>{t('buy.external.prepareTitle')}</h2>
          <p>{t('buy.external.preferenceNote')}</p>
        </div>
        <div className="external-wallet-grid">
          <label>{t('buy.external.amount')}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label={t('buy.external.amount')} /></label>
          <label>{t('buy.external.fiat')}<select value={fiat} onChange={(event) => setFiat(event.target.value)}>{FIAT_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label>{t('buy.external.asset')}<select value={asset} onChange={(event) => setAsset(event.target.value)}>{ASSET_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label>{t('buy.external.network')}<div className="external-wallet-readonly">{wallet.chain?.name || t('buy.external.networkUnavailable')}</div></label>
        </div>
        <fieldset className="external-wallet-methods">
          <legend>{t('buy.external.payment')}</legend>
          {PAYMENT_OPTIONS.map((option) => <label key={option}><input type="radio" name="external-payment" checked={payment === option} onChange={() => setPayment(option)} /><span>{t(`buy.external.paymentOptions.${option}`)}</span></label>)}
        </fieldset>
        <button className="btn btn-primary external-wallet-continue" onClick={continuePurchase}>{t('buy.external.continue')}</button>
        {unavailable && <p className="external-wallet-unavailable" role="status">{t('buy.external.unavailable')}</p>}
      </motion.section>

      <aside className="external-wallet-disclosure"><IconShield width={17} height={17} /><p>{t('buy.external.disclosure')}</p></aside>
      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}
