import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';
import { useWallet, shortAddress } from '../context/WalletContext';
import { EVM_CHAINS, getToken, explorerTx } from '../lib/chains';
import { getTokenBalance } from '../lib/swap';
import {
  decodePayPayload, PAY_THEMES, isTrustWallet,
  parseAmountWei, sendPayTransfers, formatWei, splitPayWei
} from '../lib/payLink';
import { IconCheck } from '../components/Icons';
import '../styles/pay-gateway.css';

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ position: 'relative', zIndex: 2, transformBox: 'fill-box', transformOrigin: '50% 50%' }}
      >
        <defs>
          <linearGradient id="payBrandGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="50%" stopColor="#7c4dff" />
            <stop offset="100%" stopColor="#ff2d95" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="9.2" stroke="url(#payBrandGrad)" strokeWidth="2.1" />
        <path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke="url(#payBrandGrad)" />
        <path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke="url(#payBrandGrad)" />
        <path d="M14.6 6.6v2.9h-2.9" stroke="url(#payBrandGrad)" />
        <path d="M9.4 17.4v-2.9h2.9" stroke="url(#payBrandGrad)" />
      </svg>
    </div>
  );
}

export default function PayLanding() {
  const { code } = useParams();
  const { t } = useTranslation();
  const wallet = useWallet();
  const payload = useMemo(() => decodePayPayload(code), [code]);
  const theme = PAY_THEMES[payload?.theme] || PAY_THEMES.mint;
  const chain = payload ? EVM_CHAINS[payload.chainId] : null;
  const token = payload ? getToken(payload.chainId, payload.token) : null;

  const [amount, setAmount] = useState(payload?.amount || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (payload?.lang) setLanguage(payload.lang);
  }, [payload?.lang]);

  useEffect(() => {
    setAmount(payload?.amount || '');
  }, [payload?.amount]);

  const wei = token ? parseAmountWei(amount, token.decimals) : null;
  const split = wei ? splitPayWei(wei) : null;

  const connect = async () => {
    setErr('');
    setBusy(true);
    try {
      const ok = isTrustWallet()
        ? await wallet.connectInjected()
        : await wallet.connectWalletConnect();
      if (ok && payload?.chainId) await wallet.switchChain(payload.chainId);
    } catch {
      setErr(t('pay.landing.failed'));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    setErr('');
    if (!payload || !token || !wei || wei <= 0n) {
      setErr(t('pay.landing.openAmount'));
      return;
    }
    setBusy(true);
    try {
      if (wallet.chainId !== payload.chainId) {
        const switched = await wallet.switchChain(payload.chainId);
        if (!switched) {
          setErr(t('pay.landing.wrongChain', { network: chain?.name || payload.chainId }));
          return;
        }
      }
      const signer = wallet.getSigner();
      if (!signer) throw new Error('NO_SIGNER');
      const provider = signer.provider || await wallet.getReadProvider?.(payload.chainId);
      const bal = provider
        ? await getTokenBalance(provider, token, wallet.address)
        : null;
      if (bal?.raw != null && bal.raw < wei) {
        setErr(t('pay.landing.insufficient', { token: token.symbol }));
        return;
      }
      const result = await sendPayTransfers({
        signer,
        token,
        merchant: payload.to,
        amountWei: wei,
        chainId: payload.chainId
      });
      setDone(result);
    } catch (e) {
      const msg = String(e?.message || e?.code || '');
      if (msg.includes('User rejected') || e?.code === 4001) setErr(t('pay.landing.rejected'));
      else if (msg.includes('INSUFFICIENT') || /insufficient/i.test(msg)) {
        setErr(t('pay.landing.insufficient', { token: token.symbol }));
      } else {
        setErr(t('pay.landing.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const style = {
    '--pay-accent': theme.accent,
    '--pay-bg': theme.bg,
    '--pay-fg': theme.fg
  };

  if (!payload) {
    return (
      <div className="pay-landing" style={style}>
        <div className="pay-landing-brand">
          <BrandMark />
          <strong>FBT Swap</strong>
        </div>
        <div className="pay-landing-card">
          <p>{t('pay.landing.invalid')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pay-landing" style={style}>
      <div className="pay-landing-brand">
        <BrandMark />
        <strong>FBT Swap</strong>
      </div>

      <div className="pay-landing-card">
        {payload.name && <div className="pay-landing-name">{payload.name}</div>}
        <h1 className="pay-landing-title">{t('pay.landing.title')}</h1>

        {done ? (
          <div className="pay-landing-done">
            <IconCheck width={36} height={36} />
            <h2>{t('pay.landing.done')}</h2>
            {done.hash && chain && (
              <a className="pay-landing-hash mono" href={explorerTx(payload.chainId, done.hash)} target="_blank" rel="noreferrer">
                {t('pay.landing.hash')}: {done.hash}
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="pay-landing-meta">
              <div>
                <span>{t('pay.landing.to')}</span>
                <div className="mono">{shortAddress(payload.to)}</div>
              </div>
              <div>
                <span>{t('pay.landing.network')}</span>
                <div>{chain?.name || payload.chainId} · {payload.token}</div>
              </div>
              <div>
                <span>{t('pay.landing.amount')}</span>
                {payload.amount ? (
                  <div className="pay-landing-amount">{payload.amount} {payload.token}</div>
                ) : (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="0.00"
                    aria-label={t('pay.landing.amount')}
                  />
                )}
              </div>
            </div>

            <p className="pay-landing-fee">{t('pay.landing.fee')}</p>

            {wallet.isConnected ? (
              <button
                type="button"
                className="pay-landing-btn"
                disabled={busy || !wei}
                onClick={pay}
              >
                {busy ? t('pay.landing.paying') : t('pay.landing.pay')}
                {split && token ? ` · ${formatWei(wei, token.decimals)} ${token.symbol}` : ''}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="pay-landing-btn"
                  disabled={busy}
                  onClick={connect}
                >
                  {busy ? t('pay.landing.connecting') : t('pay.landing.connect')}
                </button>
                <p className="pay-landing-hint">{t('pay.landing.trustHint')}</p>
              </>
            )}

            {err && <p className="pay-landing-err">{err}</p>}
          </>
        )}
      </div>
    </div>
  );
}
