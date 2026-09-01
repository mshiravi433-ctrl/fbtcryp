/**
 * SOLANA WALLET TAB — the wallet page's Solana connection surface.
 * ---------------------------------------------------------------------------
 * The connection previously lived inside the Solana swap screen; the swap is
 * for quotes/orders, so its connection card crowded the workflow that belongs
 * there. On instruction the Solana wallet connection moves to the Wallet page
 * and the swap keeps only pair selection, quote and execution.
 *
 * This component is entirely read-only with respect to the EVM wallet: it uses
 * `useWallet()` only to show which wallet is connected on which namespace. The
 * EVM and Solana flows never share state beyond that display; connecting one
 * never disconnects the other.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InfoBox from './InfoBox';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import {
  registerMobileWalletAdapter,
  connectSolana,
  disconnectSolana,
  getSolanaBalance,
  solanaAddress,
  solanaWalletAvailable,
  solanaWalletName,
  canInjectSolana,
  phantomBrowseLink,
  solflareBrowseLink,
  backpackBrowseLink,
  publicAppUrl
} from '../lib/solanaWallet';

export default function SolanaWalletTab() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const evm = useWallet();

  const [address, setAddress] = useState(() => solanaAddress());
  const [connecting, setConnecting] = useState(false);
  const [walletErr, setWalletErr] = useState(null);
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [mwaReady, setMwaReady] = useState(false);

  /* Register the official mobile adapter where it can work (Android Chrome).
     A failure here is deliberately quiet: injected providers already work. */
  useEffect(() => {
    let alive = true;
    registerMobileWalletAdapter(publicAppUrl('/')).then((ok) => {
      if (alive && ok) setMwaReady(true);
    });
    return () => { alive = false; };
  }, []);

  const refreshBalance = useCallback(async (addr = address) => {
    if (!addr) { setBalance(null); return; }
    setBalanceLoading(true);
    try {
      setBalance(await getSolanaBalance(addr));
    } catch {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [address]);

  /* Follow the Solana provider even after the page has mounted, so a connect
     from the swap or from a wallet extension always reflects here. */
  useEffect(() => {
    const onWalletChange = (event) => {
      const next = event?.detail?.address || solanaAddress() || null;
      setAddress(next);
    };
    window.addEventListener('solana:wallet-change', onWalletChange);
    return () => window.removeEventListener('solana:wallet-change', onWalletChange);
  }, []);

  useEffect(() => {
    refreshBalance(address);
  }, [address, refreshBalance]);

  const connect = useCallback(async () => {
    setWalletErr(null);
    setConnecting(true);
    try {
      const addr = await connectSolana();
      setAddress(addr);
      haptic?.('success');
    } catch (err) {
      setWalletErr(err?.message || 'CONNECT_FAILED');
      haptic?.('error');
    } finally {
      setConnecting(false);
    }
  }, [haptic]);

  const disconnect = useCallback(async () => {
    await disconnectSolana();
    setAddress(null);
    setBalance(null);
    setWalletErr(null);
  }, []);

  const openExternal = (url) => {
    if (!url) return;
    haptic?.('light');
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const hasWallet = solanaWalletAvailable();
  const canInject = canInjectSolana();
  const walletName = solanaWalletName();

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* ─── connection card ─────────────────────────────────────────── */}
      <section className="card card-rgb">
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div className="faint">{t('solana.title')}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>
              {address ? shortAddress(address) : t('solana.notConnected')}
            </div>
          </div>
          {address ? (
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>
              {t('wallet.disconnect')}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={connect}
              disabled={connecting || (!hasWallet && !mwaReady)}
            >
              {connecting ? t('wallet.connecting') : t('wallet.connect')}
            </button>
          )}
        </div>

        {address && (
          <div className="row-between" style={{ marginTop: 9 }}>
            <span className="faint">{t('solana.balance')}</span>
            <span className="mono faint" style={{ fontSize: 12.5 }}>
              {balanceLoading ? t('common.loading') : `${balance ?? '0'} SOL`}
            </span>
          </div>
        )}

        {!hasWallet && !mwaReady && (
          <p className="notice" style={{ marginTop: 11 }}>
            {canInject ? t('solana.noWallet') : t('solana.openInWallet')}
          </p>
        )}

        {/* The three real ways a Solana wallet connects here. */}
        <div style={{ marginTop: 12 }}>
          <p className="field-label">{t('solana.walletLinksTitle')}</p>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => openExternal(phantomBrowseLink(publicAppUrl('/#/wallet?tab=solana')))}>
              Phantom
            </button>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => openExternal(solflareBrowseLink(publicAppUrl('/#/wallet?tab=solana')))}>
              Solflare
            </button>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => openExternal(backpackBrowseLink(publicAppUrl('/#/wallet?tab=solana')))}>
              Backpack
            </button>
          </div>
          <p className="faint" style={{ fontSize: 11, marginTop: 7, lineHeight: 1.7 }}>
            {t('solana.openInWalletHint')}
          </p>
        </div>

        {walletErr && (
          <p className="notice notice-danger" style={{ marginTop: 11 }}>
            {t(`solana.err.${walletErr}`, t('solana.err.CONNECT_FAILED'))}
          </p>
        )}
        {hasWallet && !address && (
          <p className="faint" style={{ marginTop: 9, fontSize: 12 }}>
            {t('solana.detected', { name: walletName })}
          </p>
        )}
      </section>

      {/* ─── which wallet is connected right now ───────────────────────── */}
      <section className="card">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('solana.twoWalletsTitle')}</p>
        <p className="muted" style={{ fontSize: 12.3, marginBottom: 11, lineHeight: 1.8 }}>
          {t('solana.twoWalletsBody')}
        </p>
        <div className="stack" style={{ gap: 9 }}>
          <div className="row-between">
            <span className="row" style={{ gap: 7 }}>
              <span className="dot" style={{ background: evm?.address ? 'var(--up)' : 'var(--text-3)' }} />
              <span style={{ fontSize: 12.5 }}>{t('solana.evmSide')}</span>
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {evm?.address ? shortAddress(evm.address) : t('solana.notConnected')}
            </span>
          </div>
          <div className="row-between">
            <span className="row" style={{ gap: 7 }}>
              <span className="dot" style={{ background: address ? 'var(--up)' : 'var(--text-3)' }} />
              <span style={{ fontSize: 12.5 }}>{t('solana.solSide')}</span>
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {address ? shortAddress(address) : t('solana.notConnected')}
            </span>
          </div>
        </div>
        <p className="prose-sm" style={{ marginTop: 12 }}>{t('solana.noNeedToDisconnect')}</p>
      </section>

      {/* ─── the three connection paths ─────────────────────────────────── */}
      <InfoBox title={t('solana.whichTitle')} tone="info" id="solana-wallet-which">
        <p>{t('solana.whichIntro')}</p>
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          {['phantom', 'solflare', 'backpack'].map((w) => (
            <div key={w} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
              <span className="wallet-badge" style={{ width: 26, height: 26, fontSize: 11, flexShrink: 0 }} aria-hidden="true">
                {t(`solana.wallets.${w}.short`)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t(`solana.wallets.${w}.name`)}</div>
                <p className="prose-sm" style={{ marginTop: 2 }}>{t(`solana.wallets.${w}.desc`)}</p>
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 12, fontWeight: 700, fontSize: 12.5 }}>{t('solana.howTitle')}</p>
        <ol className="p2p-steps">
          {['desktop', 'android', 'ios', 'app'].map((k) => (
            <li key={k}>{t(`solana.how.${k}`)}</li>
          ))}
        </ol>
        <p className="notice notice-danger" style={{ marginTop: 10 }}>
          {t('solana.notSolana')}
        </p>
      </InfoBox>
    </div>
  );
}
