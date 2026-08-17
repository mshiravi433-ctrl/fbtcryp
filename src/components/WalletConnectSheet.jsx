import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import {
  createVaultWithSigner,
  generateMnemonic,
  hasVault,
  preloadWalletCrypto,
  passwordStrength,
  validateMnemonic
} from '../lib/localWallet';
import { IconKey, IconLink, IconLock, IconPlus, IconWallet } from './Icons';

/**
 * EIP-6963 multi-provider discovery. Returns an array of {uuid, info, provider}
 * from the page's announced wallets. Subscribe on mount; unsub on unmount.
 */
function useEip6963() {
  const [providers, setProviders] = useState([]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const map = new Map();
    const onAnnounce = (ev) => {
      const { info, provider } = ev.detail || {};
      if (!info?.uuid || !provider) return;
      map.set(info.uuid, { info, provider });
      setProviders(Array.from(map.values()));
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);
  return providers;
}

/** Friendly label for known EIP-6963 reverse-DNS names. */
function providerName(info, t) {
  if (!info) return t('wallet.injected');
  const map = {
    'io.metamask': 'MetaMask',
    'com.trustwallet.app': 'Trust Wallet',
    'me.rainbow': 'Rainbow',
    'com.coinbase.wallet': 'Coinbase Wallet',
    'org.uniswap.web': 'Uniswap',
    'com.ledger': 'Ledger Live'
  };
  return map[info.rdns] || info.name || t('wallet.injected');
}

/**
 * Wallet onboarding. Deliberately ordered so the safest option is first and
 * visually dominant; the in-app wallet is presented with its real trade-offs
 * rather than as the friendly default.
 */
export default function WalletConnectSheet({ open, onClose }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  // Hide the large ethers chunk's fetch/parse time behind reading this sheet.
  useEffect(() => {
    if (open) void preloadWalletCrypto();
  }, [open]);

  const [view, setView] = useState('choose'); // choose | create | backup | confirm | import | unlock
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  /*
   * True while a WalletConnect pairing is in flight.
   *
   * ─── WHY THE SHEET WITHDRAWS DURING PAIRING ─────────────────────────────
   * showQrModal:true makes the SDK open the AppKit/Reown modal on top — with
   * its OWN full-screen blurred backdrop and its OWN scroll lock. Leaving
   * this sheet open underneath meant two competing modals, two backdrops and
   * two scroll locks alive at once, which on the Android WebView composited
   * into the reported "grey box flickering like a fluorescent tube", the
   * half-rendered panel, and taps landing on the wrong layer.
   *
   * So while the wallet flow owns the screen, this sheet is closed ONCE, in a
   * controlled way (exit animation, lock released), and the AppKit modal is
   * the only modal alive. If pairing fails (user cancelled, origin blocked,
   * relay unreachable) the sheet re-opens to NAME the failure; on success it
   * stays closed.
   */
  const [wcFlowActive, setWcFlowActive] = useState(false);

  const injected = useEip6963();

  const strength = passwordStrength(password);

  const reset = () => {
    setView('choose');
    setMnemonic('');
    setImportPhrase('');
    setPassword('');
    setPassword2('');
    setAck(false);
    setErr(null);
  };

  const close = () => {
    setWcFlowActive(false);
    reset();
    onClose?.();
  };

  /*
   * One tap = one pairing attempt. The sheet itself is disabled via
   * `wallet.connecting`, and connectWalletConnect() has its own init
   * single-flight (wcInitingRef) — this state exists to manage VISIBILITY,
   * not to gate the flow.
   */
  const startWalletConnect = () => {
    if (wallet.connecting) return;
    setWcFlowActive(true);
    wallet
      .connectWalletConnect()
      .then((ok) => {
        setWcFlowActive(false);
        if (ok) close();
        /* on failure the sheet re-opens with the named error already set */
      })
      .catch(() => setWcFlowActive(false));
  };

  const startCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const phrase = await generateMnemonic();
      setMnemonic(phrase);
      setView('backup');
    } catch {
      setErr('GENERATE_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const finishCreate = async (phrase) => {
    if (password.length < 8) return setErr('PASSWORD_SHORT');
    if (password !== password2) return setErr('PASSWORD_MISMATCH');
    if (!ack) return setErr('MUST_ACK');
    setBusy(true);
    setErr(null);
    try {
      const { signer } = await createVaultWithSigner(phrase, password);
      const attached = await wallet.attachCreatedLocal(signer);
      if (!attached) throw new Error('ATTACH_FAILED');
      haptic?.('success');
      close();
    } catch {
      setErr('CREATE_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    const phrase = importPhrase.trim().replace(/\s+/g, ' ');
    if (!(await validateMnemonic(phrase))) return setErr('BAD_MNEMONIC');
    return finishCreate(phrase);
  };

  const doUnlock = async () => {
    setBusy(true);
    setErr(null);
    const ok = await wallet.unlockLocal(password);
    setBusy(false);
    if (ok) {
      haptic?.('success');
      close();
    } else {
      setErr('BAD_PASSWORD');
    }
  };

  return (
    /*
     * `open && !wcFlowActive`: exactly one modal is alive at a time. The exit
     * and re-enter animations are handled by AnimatePresence inside Sheet, so
     * a quick close→open cannot produce two panels — React re-keys nothing,
     * and a re-open mid-exit animates the SAME element back instead of
     * mounting a second one.
     */
    <Sheet open={open && !wcFlowActive} onClose={close}>
      {/* ------------------------------ choose ------------------------------ */}
      {view === 'choose' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.connectTitle')}</h2>
          <p className="muted" style={{ marginBottom: 14 }}>{t('wallet.connectSubtitle')}</p>

          <div className="stack" style={{ gap: 9 }}>
            <motion.button
              className="wallet-option"
              data-featured="true"
              whileTap={{ scale: 0.98 }}
              onClick={startWalletConnect}
              disabled={wallet.connecting}
            >
              <span className="wallet-badge">
                <IconLink width={21} height={21} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{t('wallet.wc')}</span>
                <span className="set-row-sub">{t('wallet.wcDesc')}</span>
              </span>
              <span className="pill pill-up" style={{ flexShrink: 0 }}>{t('wallet.recommended')}</span>
            </motion.button>

            {/*
              Injected wallets: render one button per EIP-6963 announced provider,
              falling back to a single window.ethereum button if no announcements
              were made (older browsers / legacy dapp browsers).
            */}
            {injected.length > 0 ? (
              injected.map((p) => (
                <motion.button
                  key={p.info.uuid}
                  className="wallet-option"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => wallet.connectInjected(p.info.rdns).then((ok) => ok && close())}
                  disabled={wallet.connecting}
                >
                  <span className="wallet-badge" style={p.info.icon ? {
                    backgroundImage: `url(${p.info.icon})`,
                    backgroundSize: '22px',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center',
                    fontSize: 0
                  } : undefined}>
                    {!p.info.icon && <IconWallet width={21} height={21} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                      {providerName(p.info, t)}
                    </span>
                    <span className="set-row-sub">{t('wallet.injectedDesc')}</span>
                  </span>
                </motion.button>
              ))
            ) : (typeof window !== 'undefined' && window.ethereum) ? (
              <motion.button
                className="wallet-option"
                whileTap={{ scale: 0.98 }}
                onClick={() => wallet.connectInjected().then((ok) => ok && close())}
                disabled={wallet.connecting}
              >
                <span className="wallet-badge">
                  <IconWallet width={21} height={21} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                    {window.ethereum.isMetaMask
                      ? 'MetaMask'
                      : window.ethereum.isTrust
                        ? 'Trust Wallet'
                        : t('wallet.injected')}
                  </span>
                  <span className="set-row-sub">{t('wallet.injectedDesc')}</span>
                </span>
              </motion.button>
            ) : null}

            {hasVault() ? (
              <motion.button className="wallet-option" whileTap={{ scale: 0.98 }} onClick={() => setView('unlock')}>
                <span className="wallet-badge"><IconLock width={21} height={21} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{t('wallet.unlockLocal')}</span>
                  <span className="set-row-sub">{t('wallet.unlockLocalDesc')}</span>
                </span>
              </motion.button>
            ) : (
              <>
                <motion.button className="wallet-option" whileTap={{ scale: 0.98 }} onClick={startCreate} disabled={busy}>
                  <span className="wallet-badge"><IconPlus width={21} height={21} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{t('wallet.createLocal')}</span>
                    <span className="set-row-sub">{t('wallet.createLocalDesc')}</span>
                  </span>
                </motion.button>

                <motion.button className="wallet-option" whileTap={{ scale: 0.98 }} onClick={() => setView('import')}>
                  <span className="wallet-badge"><IconKey width={21} height={21} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{t('wallet.importLocal')}</span>
                    <span className="set-row-sub">{t('wallet.importLocalDesc')}</span>
                  </span>
                </motion.button>
              </>
            )}
          </div>

          <p className="notice notice-danger" style={{ marginTop: 14 }}>{t('wallet.localRisk')}</p>

          {wallet.error === 'WC_ORIGIN_BLOCKED' && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.wcOriginBlocked')}</p>
          )}
          {wallet.error === 'WC_RELAY_UNREACHABLE' && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.wcRelayUnreachable')}</p>
          )}
          {wallet.error === 'WC_EXPIRED' && (
            <p className="notice" style={{ marginTop: 10 }}>{t('wallet.wcExpired')}</p>
          )}
          {wallet.error === 'CONNECT_FAILED' && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.connectFailed')}</p>
          )}
        </>
      )}

      {/* ------------------------------ backup ------------------------------ */}
      {view === 'backup' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.backupTitle')}</h2>
          <p className="notice notice-danger" style={{ marginBottom: 10 }}>{t('wallet.backupWarning')}</p>
          <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('wallet.lossWarning')}</p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 7,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(255,255,255,.04)',
              border: '1px solid var(--line-strong)'
            }}
          >
            {mnemonic.split(' ').map((w, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="mono"
                style={{ fontSize: 11.5, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,.4)' }}
              >
                <span style={{ color: 'var(--text-3)', marginInlineEnd: 5 }}>{i + 1}</span>
                {w}
              </motion.div>
            ))}
          </div>

          <button
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={() => {
              navigator.clipboard?.writeText(mnemonic);
              haptic?.('success');
            }}
          >
            {t('common.copy')}
          </button>

          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setView('confirm')}>
            {t('wallet.savedIt')}
          </button>
        </>
      )}

      {/* --------------------------- set password --------------------------- */}
      {(view === 'confirm' || view === 'import') && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            {view === 'import' ? t('wallet.importTitle') : t('wallet.setPassword')}
          </h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('wallet.passwordDesc')}</p>

          {view === 'import' && (
            <>
              <label className="field-label">{t('wallet.seedPhrase')}</label>
              <textarea
                value={importPhrase}
                onChange={(e) => setImportPhrase(e.target.value)}
                rows={3}
                placeholder="word1 word2 word3 …"
                style={{
                  width: '100%',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  color: 'var(--text-1)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  padding: 12,
                  resize: 'vertical',
                  marginBottom: 10
                }}
              />
            </>
          )}

          <label className="field-label">{t('wallet.password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />

          <div className="progress" style={{ marginTop: 7 }}>
            <motion.div
              className="progress-fill"
              animate={{ width: `${(strength.score / 5) * 100}%` }}
              style={{
                background:
                  strength.score <= 1
                    ? 'var(--down)'
                    : strength.score <= 3
                      ? 'var(--rgb-5)'
                      : 'linear-gradient(90deg,var(--rgb-4),var(--rgb-1))'
              }}
            />
          </div>
          <div className="faint" style={{ marginTop: 4 }}>{t(`wallet.strength.${strength.label}`)}</div>

          <label className="field-label" style={{ marginTop: 10 }}>{t('wallet.passwordConfirm')}</label>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />

          <label
            className="row"
            style={{ gap: 9, marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              style={{ width: 17, height: 17, marginTop: 2, accentColor: '#00e5ff', flexShrink: 0 }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>{t('wallet.ackText')}</span>
          </label>

          {err && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`wallet.err.${err}`)}</p>}

          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={reset}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => (view === 'import' ? doImport() : finishCreate(mnemonic))}
            >
              {busy ? t('common.loading') : t('wallet.createConfirm')}
            </button>
          </div>
        </>
      )}

      {/* ------------------------------ unlock ------------------------------ */}
      {view === 'unlock' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.unlockTitle')}</h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('wallet.unlockDesc')}</p>

          <label className="field-label">{t('wallet.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doUnlock()}
            autoComplete="current-password"
          />

          {err && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`wallet.err.${err}`)}</p>}

          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={reset}>{t('common.back')}</button>
            <button className="btn btn-primary" disabled={busy || !password} onClick={doUnlock}>
              {busy ? t('common.loading') : t('wallet.unlock')}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
