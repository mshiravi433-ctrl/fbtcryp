import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';
import { useWallet, shortAddress } from '../context/WalletContext';
import { EVM_CHAINS, getToken, explorerTx } from '../lib/chains';
import { getTokenBalance } from '../lib/swap';
import {
  decodePayPayload, PAY_THEMES, isTrustWallet,
  parseAmountWei, sendPayTransfers, formatWei, splitPayWei
} from '../lib/payLink';
import { IconCheck, IconSwap } from '../components/Icons';
import AssetIcon from '../components/AssetIcon';
import { publicAppUrl } from '../lib/nativeShell';
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

/**
 * THE LOGO IS A LINK TO OUR SITE.
 *
 * «لوگو ما وقتی روش میزنی وارد سایت ما شود.» It used to be a decorative
 * `<div>`: the one thing on a payment page that looks tappable did nothing,
 * which on a page a stranger opened from a QR code is also the one place a
 * payer checks that the merchant is a real business before signing.
 *
 * It points at `publicAppUrl('/')` — the canonical https://fbtswap.ir in
 * production, the preview host when this is running in a sandbox — and NOT at
 * `window.location`, because inside the Android APK that is `https://localhost`
 * and a logo that "enters our site" must not open the user's own phone.
 */
function BrandLink({ t }) {
  return (
    <a
      className="pay-landing-brand"
      href={publicAppUrl('/')}
      aria-label={t('pay.landing.brandLink')}
      data-testid="pay-landing-brand-link"
    >
      <BrandMark />
      <span className="pay-landing-brand-text">
        <strong>FBT Swap</strong>
        <span className="pay-landing-brand-sub">{t('pay.landing.brandSub')}</span>
      </span>
      <span className="pay-landing-brand-go" aria-hidden="true">↗</span>
    </a>
  );
}

export default function PayLanding() {
  const { code } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const payload = useMemo(() => decodePayPayload(code), [code]);
  const theme = PAY_THEMES[payload?.theme] || PAY_THEMES.mint;
  const chain = payload ? EVM_CHAINS[payload.chainId] : null;
  const token = payload ? getToken(payload.chainId, payload.token) : null;

  const [amount, setAmount] = useState(payload?.amount || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  /*
   * ─── THE BALANCE READ, AND THE SHORTFALL IT MAKES ACTIONABLE ────────────
   * Phase 2 of the gateway: before this, a payer whose wallet held ETH or
   * USDC — but not the USDT the merchant asked for — got one dead end:
   * "Not enough USDT". They then had to find the swap screen themselves,
   * remember the network, and come back. The balance is now read once per
   * wallet/token/network (not per keystroke: the REQUIRED amount changes as
   * they type, the HELD amount does not), and a shortfall renders a
   * pre-filled route into our own internal swap.
   *
   * The read is strictly optional. `getReadProvider` is a function only the
   * real WalletContext provides, and where it is missing — a mocked
   * context, a headless render — no box appears, no error appears, the
   * page behaves exactly as it did. A payment page must not fail because
   * OUR balance probe failed; the wallet's own simulation remains the
   * authority that rejects an underfunded signature.
   */
  const [held, setHeld] = useState(null);
  /*
   * The wallet OBJECT must not join the dependency array: a context value
   * that is recomputed on any state change (prices tick, mode flips) would
   * re-run the read, whose setState re-renders the page, which re-runs the
   * read if the identity moved again — the exact setState-in-effect loop this
   * repo has been bitten by before. The LATEST wallet lives in a ref; the
   * dependencies are primitives that actually change the answer: which chain,
   * which token, which address, connected or not.
   */
  const walletRef = useRef(null);
  walletRef.current = wallet;
  useEffect(() => {
    setHeld(null);
    const w = walletRef.current;
    if (!payload || !token || !w?.isConnected || !w?.address) return undefined;
    if (typeof w.getReadProvider !== 'function') return undefined;
    let alive = true;
    Promise.resolve()
      .then(async () => {
        const provider = await w.getReadProvider(payload.chainId);
        if (!provider) return null;
        return getTokenBalance(provider, token, w.address);
      })
      .then((b) => { if (alive && b?.raw != null) setHeld(b); })
      .catch(() => { /* stay silent — the box simply does not show */ });
    return () => { alive = false; };
  }, [payload?.chainId, token?.symbol, wallet?.isConnected, wallet?.address]);

  const wei = token ? parseAmountWei(amount, token.decimals) : null;
  const split = wei ? splitPayWei(wei) : null;
  const shortBy = held?.raw != null && wei != null && BigInt(held.raw) < wei
    ? { raw: BigInt(wei) - BigInt(held.raw) }
    : null;

  /*
   * Swap & Pay: hand the payer to /swap with the merchant's network and
   * token pre-selected. Deliberately NOT pre-filled with an amount: the
   * `amount=` query on /swap sizes the INPUT token, and we only know the
   * shortfall in the OUTPUT token. A wrong-direction prefill is worse than
   * no prefill — the same rule `shopCatalogTools` follows for its shortfall
   * planner.
   */
  const goSwapAndPay = () => {
    if (!payload) return;
    const params = new URLSearchParams();
    params.set('chain', String(payload.chainId));
    if (token) params.set('to', token.symbol);
    navigate(`/swap?${params.toString()}`);
  };

  useEffect(() => {
    if (payload?.lang) setLanguage(payload.lang);
  }, [payload?.lang]);

  useEffect(() => {
    setAmount(payload?.amount || '');
  }, [payload?.amount]);

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
      <div className="pay-landing pay-landing-modern" style={style}>
        <div className="pay-landing-aurora" aria-hidden="true" />
        <BrandLink t={t} />
        <div className="pay-landing-card">
          <p>{t('pay.landing.invalid')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pay-landing pay-landing-modern" style={style}>
      {/*
        A soft accent wash behind the card. Purely decorative (aria-hidden, and
        the reduced-motion block at the bottom of the stylesheet drops it), but
        it is what separates "a page someone generated" from "the payment page
        of a business" — which on a QR-code landing is the whole first
        impression the payer has of the merchant.
      */}
      <div className="pay-landing-aurora" aria-hidden="true" />
      <BrandLink t={t} />

      <div className="pay-landing-card">
        {payload.name && (
          <div className="pay-landing-merchant">
            <span className="pay-landing-merchant-mark" aria-hidden="true">
              {(payload.name.trim()[0] || '?').toUpperCase()}
            </span>
            <span className="pay-landing-name">{payload.name}</span>
          </div>
        )}
        <h1 className="pay-landing-title">{t('pay.landing.title')}</h1>

        {done ? (
          <div className="pay-landing-done">
            <span className="pay-landing-done-ring" aria-hidden="true"><IconCheck width={36} height={36} /></span>
            <h2>{t('pay.landing.done')}</h2>
            {done.hash && chain && (
              <a className="pay-landing-hash mono" href={explorerTx(payload.chainId, done.hash)} target="_blank" rel="noreferrer">
                {t('pay.landing.hash')}: {done.hash}
              </a>
            )}
            {/* The payer's next step after paying: where this page came from. */}
            <a className="pay-landing-btn pay-landing-btn-ghost" href={publicAppUrl('/')}>
              {t('pay.landing.brandLink')}
            </a>
          </div>
        ) : (
          <>
            {/*
              THE AMOUNT IS THE HERO. A payer opens this page to answer one
              question — "how much am I about to send, in what, on which
              network?" — so that answer is the biggest thing on the page,
              with the network and token marked with their own artwork rather
              than described in words a first-time payer has to trust.
            */}
            <div className="pay-landing-hero">
              {payload.amount ? (
                <div className="pay-landing-amount">
                  {payload.amount}
                  <span className="pay-landing-amount-sym" dir="ltr">{payload.token}</span>
                </div>
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
              <div className="pay-landing-marks">
                <span className="pay-landing-mark">
                  <AssetIcon symbol={payload.token} chain={String(payload.chainId)} size={20} />
                  <span dir="ltr">{payload.token}</span>
                </span>
                <span className="pay-landing-mark">
                  <AssetIcon chain={String(payload.chainId)} size={20} />
                  <span>{chain?.name || payload.chainId}</span>
                </span>
              </div>
            </div>

            <div className="pay-landing-meta">
              <div>
                <span>{t('pay.landing.to')}</span>
                <div className="mono">{shortAddress(payload.to)}</div>
              </div>
              <div>
                <span>{t('pay.landing.network')}</span>
                <div>{chain?.name || payload.chainId} · {payload.token}</div>
              </div>
              {!payload.amount && (
                <div>
                  <span>{t('pay.landing.amount')}</span>
                  <div className="mono">{amount || '—'}</div>
                </div>
              )}
            </div>

            {/*
              THE MERCHANT'S NOTE (invoice number, order ref) — Phase 2. It
              travels inside the link itself, so it cannot desync: what the
              merchant typed when the link was minted is what the payer reads
              before signing. `dir="auto"` because order refs mix scripts —
              «فاکتور ۱۴۸» and "Order-148" share this line.
            */}
            {payload.note && (
              <div className="pay-landing-note" dir="auto" data-testid="pay-landing-note">
                <span className="pay-landing-note-label">{t('pay.landing.note')}</span>
                <span className="pay-landing-note-text">{payload.note}</span>
              </div>
            )}

            <p className="pay-landing-fee">{t('pay.landing.fee')}</p>

            {wallet.isConnected ? (
              <>
                <button
                  type="button"
                  className="pay-landing-btn"
                  disabled={busy || !wei}
                  onClick={pay}
                >
                  {busy ? t('pay.landing.paying') : t('pay.landing.pay')}
                  {split && token ? ` · ${formatWei(wei, token.decimals)} ${token.symbol}` : ''}
                </button>

                {/*
                  ─── SWAP & PAY — THE SHORTFALL IS A ROUTE, NOT A DEAD END ──
                  The payer is connected and simply holds the wrong asset:
                  very often they HAVE the money, in ETH or USDC, on the
                  right network. Sending them to a public exchange to buy
                  USDT costs them a KYC, a withdrawal, and this invoice.
                  Sending them to our own /swap costs them one signature.
                  The route pre-selects the merchant's network and token;
                  the fee sentence is explicit about both legs (swap fee +
                  gateway fee) because an informed double fee is honest and
                  a discovered one is not.
                */}
                {shortBy && token && (
                  <div className="pay-landing-swap" data-testid="pay-swap-pay-box">
                    <div className="pay-landing-swap-title">{t('pay.landing.swapPay.title')}</div>
                    <p className="pay-landing-swap-body">
                      {t('pay.landing.swapPay.body', {
                        token: token.symbol,
                        have: formatWei(held.raw, token.decimals),
                        need: formatWei(wei, token.decimals),
                        short: formatWei(shortBy.raw, token.decimals)
                      })}
                    </p>
                    <button
                      type="button"
                      className="pay-landing-btn pay-landing-swap-btn"
                      onClick={goSwapAndPay}
                    >
                      <IconSwap width={16} height={16} />
                      <span>{t('pay.landing.swapPay.cta', { token: token.symbol })}</span>
                    </button>
                    <p className="pay-landing-swap-fees">{t('pay.landing.swapPay.fees')}</p>
                  </div>
                )}
              </>
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
