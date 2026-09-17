import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { publicAppUrl } from '../lib/nativeShell';
import {
  createVaultWithSigner,
  generateMnemonic,
  hasVault,
  passwordStrength,
  preloadWalletCrypto,
  validateMnemonic
} from '../lib/localWallet';
import {
  MOBILE_WALLETS,
  handOffChannel,
  openWalletHandoff,
  repairPairingUri,
  walletLinks,
  walletLogo,
  wcEvent
} from '../lib/wc';
import { IconCheck, IconCopy, IconKey, IconLink, IconLock, IconPlus, IconWallet } from './Icons';
import WalletHealthPanel from './WalletHealthPanel';

/**
 * EIP-6963 multi-provider discovery. Subscribe on mount, unsub on unmount.
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

/**
 * QR QUIET ZONE, IN MODULES.
 *
 * ISO/IEC 18004 requires four light modules of margin around the symbol, and
 * `qrcode-generator` does not include it: measured on a real pairing URI,
 * `getModuleCount()` is the symbol alone with dark modules on its outer ring.
 * Rendering that grid edge-to-edge and leaving the margin to CSS padding
 * produced a quiet zone under spec, which is why a scanner that should have
 * read it needed three attempts. The margin belongs in the VIEWBOX, where it
 * scales with the symbol and can never be lost to a CSS change.
 */
const QR_QUIET_MODULES = 4;

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
 * Encode the pairing URI as an SVG path.
 *
 * The encoder is imported LAZILY, on the attempt that needs it: this sheet is
 * in the first-paint graph and a QR encoder for a view most sessions never open
 * does not belong there. A QR is Reed–Solomon plus a masking pass — a subtly
 * wrong encoder still draws a scannable square that decodes to something else,
 * so this is the real library and the repaired URI, never a re-derivation.
 */
async function encodeQr(text) {
  const mod = await import('qrcode-generator');
  const encode = mod?.default ?? mod;
  const qr = encode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { d, count };
}

/**
 * Wallet onboarding.
 *
 * Deliberately ordered so the safest option is first and visually dominant, and
 * the in-app vault is presented with its real trade-offs rather than as the
 * friendly default.
 *
 * THREE SURFACES, NEVER AT ONCE: while an AppKit modal owns the screen — the
 * pairing modal (`wallet.wcModalActive`) or the email/social login
 * (`wallet.emailModalActive`) — this sheet withdraws. Two stacked modals means
 * two blurred backdrops and two body-scroll locks, which on the Android WebView
 * composites into the "grey box flickering like a fluorescent tube" report.
 */
export default function WalletConnectSheet({ open, onClose }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  // Hide the ethers chunk's fetch/parse time behind reading this sheet.
  useEffect(() => {
    if (open) void preloadWalletCrypto();
  }, [open]);

  const [view, setView] = useState('choose'); // choose | pair | backup | confirm | import | unlock
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const [openedWallet, setOpenedWallet] = useState(null);
  /** Which route the last hand-off took — 'intent' | 'native' | 'universal'. */
  const [handoffRoute, setHandoffRoute] = useState(null);
  const [copiedUri, setCopiedUri] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [pairQr, setPairQr] = useState(null);

  const injected = useEip6963();
  const strength = useMemo(() => passwordStrength(password), [password]);

  /* The pairing view is the fallback surface, and the one always in front of
     us: it is what remains when the SDK's own modal cannot be built, and it is
     rendered from the same one string the SDK publishes on `display_uri`. */
  const pairUri = wallet.wcPairUri ? repairPairingUri(wallet.wcPairUri) : null;

  useEffect(() => {
    let alive = true;
    if (!pairUri) {
      setPairQr(null);
      return undefined;
    }
    encodeQr(pairUri).then(
      (qr) => { if (alive) setPairQr(qr); },
      /* The buttons and the copyable text are the authoritative path; a
         rendering problem must never hide the pairing itself. */
      () => { if (alive) setPairQr(null); }
    );
    return () => { alive = false; };
  }, [pairUri]);

  const reset = useCallback(() => {
    setView('choose');
    setMnemonic('');
    setImportPhrase('');
    setPassword('');
    setPassword2('');
    setAck(false);
    setErr(null);
    /* Pairing-view residue: a row still saying "opened — confirm in the wallet"
       and a button still saying "copied" would both be lying about an attempt
       that is over. */
    setOpenedWallet(null);
    setHandoffRoute(null);
    setCopiedUri(false);
    setCopiedUrl(false);
  }, []);

  const close = useCallback(() => {
    /* Closing the sheet mid-pairing IS a cancel: the attempt owns a live pairing
       topic and a pending promise, and leaving it running would keep the
       single-flight guard held, so the next tap would be swallowed. */
    if (view === 'pair' && wallet.connecting) void wallet.cancelWcPairing?.();
    reset();
    onClose?.();
  }, [onClose, reset, view, wallet]);

  /*
   * THE HONEST ORDER OF OPTIONS.
   *
   * On a network where the relay's WebSocket is filtered, WalletConnect pairing
   * is the ONE route here that cannot work — and it used to be the first row
   * wearing a «recommended» pill, with the reason buried behind a tap and a
   * stalled SDK attempt. The measurement is already in hand (the connect flow's
   * own preflight), so the sheet says so before the tap and moves the
   * recommendation to a route that needs no relay.
   */
  const relayBlocked = Boolean(wallet.wcRelayBlocked);

  const startWalletConnect = () => {
    if (wallet.connecting) return;
    setErr(null);
    setOpenedWallet(null);
    setHandoffRoute(null);
    setCopiedUri(false);
    // Do NOT set view='pair' immediately — that caused the flicker of
    // "4 wallets + اتصال then Reown modal". The AppKit modal is the primary
    // surface; our pair view is only the fallback when the modal chunk fails.
    // So we stay on 'choose' until we know the modal didn't appear.
    wallet
      .connectWalletConnect({ force: relayBlocked })
      .then((ok) => {
        if (ok) close();
        else {
          // If we have a pairing URI but no AppKit modal, show our fallback
          if (wallet.wcPairUri && !wallet.wcModalActive) setView('pair');
          else setView('choose');
        }
      })
      .catch(() => setView('choose'));
  };

  // When a pairing URI arrives and the AppKit modal is NOT active, switch to
  // our fallback pair view (QR + wallet buttons). This covers the
  // init_without_modal path where the SDK modal chunk failed to load.
  useEffect(() => {
    if (wallet.wcPairUri && !wallet.wcModalActive && view === 'choose' && wallet.connecting) {
      setView('pair');
    }
  }, [wallet.wcPairUri, wallet.wcModalActive, view, wallet.connecting]);

  /*
   * EMAIL & SOCIAL — the same settle contract as every other row: the sheet
   * stays mounted under AppKit's modal (withdrawing via
   * `wallet.emailModalActive`), a dismissal resolves false and leaves the user
   * back here, and a connection closes the sheet. `wallet.connecting` keeps
   * every other row inert while it is up, so the two AppKit surfaces can never
   * both be open — they physically share the one <w3m-modal> element.
   */
  const startEmailSocial = () => {
    if (wallet.connecting) return;
    setErr(null);
    wallet
      .connectEmailSocial()
      .then((ok) => (ok ? close() : setView('choose')))
      .catch(() => setView('choose'));
  };

  /* Hand-off: native custom schemes are primary on the mobile web; Telegram's
     client can only carry https, so its anchor gets the universal form. */
  const telegramChannel = handOffChannel() === 'telegram';
  const linksForWallet = (walletEntry) => (pairUri ? walletLinks(walletEntry, pairUri) : null);
  const walletHref = (walletEntry) => {
    const links = linksForWallet(walletEntry);
    if (!links) return '';
    return telegramChannel ? links.universal : links.native;
  };

  /*
   * THE TAP THAT LEAVES THE PAGE.
   *
   * `openWalletHandoff` fires the channel's first route SYNCHRONOUSLY — inside
   * the gesture, where a popup blocker cannot refuse it — and only then walks
   * the fallbacks. It also closes the tab Android leaves behind, which is why
   * Back now comes home to fbtswap.ir instead of to a dead `trust://wc?uri=…`
   * page. See src/lib/wc/handoff.js.
   */
  const openWalletApp = (event, walletEntry) => {
    const links = linksForWallet(walletEntry);
    if (!links || !pairUri) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    setOpenedWallet(walletEntry.key);
    haptic?.('light');
    wcEvent('sheet_wallet_tap');

    openWalletHandoff(links.native, {
      wallet: walletEntry,
      walletPackage: walletEntry.androidPackage,
      pairingUri: pairUri,
      fallbackUrl: links.universal
    }).then(
      (result) => {
        setHandoffRoute(result.route);
        if (result.ok) wcEvent('sheet_wallet_opened');
        else {
          wcEvent('sheet_wallet_open_failed');
          setOpenedWallet(null);
        }
      },
      () => {
        wcEvent('sheet_wallet_open_failed');
        setOpenedWallet(null);
      }
    );
  };

  const copyUri = async () => {
    if (!pairUri) return;
    try {
      await navigator.clipboard?.writeText(pairUri);
      setCopiedUri(true);
      haptic?.('success');
      setTimeout(() => setCopiedUri(false), 1800);
    } catch { /* the text is on screen anyway */ }
  };

  /* The deep-link-free path: paste this site into the wallet's own browser tab
     and the injected provider takes over. Copied from `publicAppUrl` rather
     than `window.location` — inside the packaged app the runtime origin is
     `https://localhost`, the one string that must never reach another app. */
  const copySiteUrl = async () => {
    try {
      await navigator.clipboard?.writeText(publicAppUrl('/'));
      setCopiedUrl(true);
      haptic?.('success');
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch { /* the hint above names the site */ }
  };

  const startCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      setMnemonic(await generateMnemonic());
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
      if (!(await wallet.attachCreatedLocal(signer))) throw new Error('ATTACH_FAILED');
      haptic?.('success');
      close();
    } catch {
      setErr('CREATE_FAILED');
    } finally {
      setBusy(false);
    }
    return undefined;
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

  const copyButton = (copied, onClick, label) => (
    <button className="btn btn-ghost" onClick={onClick}>
      {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
      <span style={{ marginInlineStart: 6 }}>{copied ? t('common.copied') : label}</span>
    </button>
  );

  return (
    <Sheet open={open && !wallet.wcModalActive && !wallet.emailModalActive} onClose={close}>
      {/* ------------------------------ choose ------------------------------ */}
      {view === 'choose' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.connectTitle')}</h2>
          <p className="muted" style={{ marginBottom: 14 }}>{t('wallet.connectSubtitle')}</p>

          {relayBlocked && (
            <p className="notice notice-danger" style={{ marginBottom: 10 }}>
              {t('wallet.wcRelayBlockedHint')}
            </p>
          )}

          <div className="stack" style={{ gap: 9 }}>
            <motion.button
              className="wallet-option"
              data-featured={relayBlocked ? undefined : 'true'}
              whileTap={{ scale: 0.98 }}
              onClick={startWalletConnect}
              disabled={wallet.connecting}
            >
              <span className="wallet-badge"><IconLink width={21} height={21} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{t('wallet.wc')}</span>
                <span className="set-row-sub">
                  {relayBlocked ? t('wallet.wcRelayTryAnyway') : t('wallet.wcDesc')}
                </span>
              </span>
              {relayBlocked ? (
                <span className="pill pill-down" style={{ flexShrink: 0 }}>
                  {t('wallet.wcRelayBlockedPill')}
                </span>
              ) : (
                <span className="pill pill-up" style={{ flexShrink: 0 }}>{t('wallet.recommended')}</span>
              )}
            </motion.button>

            {/* Email & social: no wallet app to install, and its transport is
                the secure frame rather than the relay — which is why it carries
                the recommendation the moment the relay is measured blocked. */}
            <motion.button
              className="wallet-option"
              data-featured={relayBlocked ? 'true' : undefined}
              whileTap={{ scale: 0.98 }}
              onClick={startEmailSocial}
              disabled={wallet.connecting}
            >
              <span className="wallet-badge"><IconKey width={21} height={21} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                  {t('wallet.emailSocial')}
                </span>
                <span className="set-row-sub">{t('wallet.emailSocialDesc')}</span>
              </span>
              {relayBlocked && (
                <span className="pill pill-up" style={{ flexShrink: 0 }}>{t('wallet.recommended')}</span>
              )}
            </motion.button>

            {/* Injected wallets: one row per EIP-6963 announcement, falling back
                to a single window.ethereum row for legacy dapp browsers. */}
            {injected.length > 0
              ? injected.map((p) => (
                  <motion.button
                    key={p.info.uuid}
                    className="wallet-option"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => wallet.connectInjected(p.info.rdns).then((ok) => ok && close())}
                    disabled={wallet.connecting}
                  >
                    <span
                      className="wallet-badge"
                      style={p.info.icon
                        ? {
                            backgroundImage: `url(${p.info.icon})`,
                            backgroundSize: '22px',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'center',
                            fontSize: 0
                          }
                        : undefined}
                    >
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
              : typeof window !== 'undefined' && window.ethereum
                ? (
                  <motion.button
                    className="wallet-option"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => wallet.connectInjected().then((ok) => ok && close())}
                    disabled={wallet.connecting}
                  >
                    <span className="wallet-badge"><IconWallet width={21} height={21} /></span>
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
                )
                : null}

            {hasVault() ? (
              <motion.button className="wallet-option" whileTap={{ scale: 0.98 }} onClick={() => setView('unlock')}>
                <span className="wallet-badge"><IconLock width={21} height={21} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                    {t('wallet.unlockLocal')}
                  </span>
                  <span className="set-row-sub">{t('wallet.unlockLocalDesc')}</span>
                </span>
              </motion.button>
            ) : (
              <>
                <motion.button
                  className="wallet-option"
                  whileTap={{ scale: 0.98 }}
                  onClick={startCreate}
                  disabled={busy}
                >
                  <span className="wallet-badge"><IconPlus width={21} height={21} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                      {t('wallet.createLocal')}
                    </span>
                    <span className="set-row-sub">{t('wallet.createLocalDesc')}</span>
                  </span>
                </motion.button>

                <motion.button
                  className="wallet-option"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setView('import')}
                >
                  <span className="wallet-badge"><IconKey width={21} height={21} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                      {t('wallet.importLocal')}
                    </span>
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
            <>
              <p className="notice notice-danger" style={{ marginTop: 10 }}>
                {t('wallet.wcRelayUnreachable')}
              </p>
              {/* Naming the failure is not the same as naming the way out. These
                  are the routes this app offers that touch no relay at all — the
                  same sentence the health panel prints, so the two surfaces can
                  never tell the user two different stories. */}
              <p className="muted" style={{ fontSize: 11.5, margin: '6px 0' }}>
                {t('wallet.healthRelayFreeRoutes')}
              </p>
            </>
          )}
          {wallet.error === 'WC_EXPIRED' && (
            <p className="notice" style={{ marginTop: 10 }}>{t('wallet.wcExpired')}</p>
          )}
          {/* «The relay is unreachable» used to be printed for a timeout, which
              is how a mobile round trip that simply did not finish became a
              network investigation. A timeout is its own sentence now. */}
          {wallet.error === 'WC_TIMEOUT' && (
            <p className="notice" style={{ marginTop: 10 }}>{t('wallet.wcTimeout')}</p>
          )}
          {wallet.error === 'CONNECT_FAILED' && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.connectFailed')}</p>
          )}

          {/* The evidence, one tap away, where the failure happened. */}
          <WalletHealthPanel projectId={wallet.wcProjectId} />
        </>
      )}

      {/* ------------------------------- pair ------------------------------- */}
      {view === 'pair' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.pairTitle')}</h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('wallet.pairSubtitle')}</p>

          {/* One row per promoted wallet, as a REAL LINK: `target="_blank"` keeps
              this document and its relay socket alive, and the href is the
              no-JavaScript fallback for the opener above it. */}
          <div className="stack" style={{ gap: 9 }}>
            {MOBILE_WALLETS.map((entry) => {
              const href = walletHref(entry);
              const logo = walletLogo(entry.imageId, wallet.wcProjectId);
              return (
                <motion.a
                  key={entry.key}
                  className="wallet-option"
                  whileTap={{ scale: 0.98 }}
                  href={href || undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-disabled={!pairUri}
                  data-route={openedWallet === entry.key ? handoffRoute || 'pending' : undefined}
                  onClick={(event) => openWalletApp(event, entry)}
                  style={!pairUri ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
                >
                  <span className="wallet-badge">
                    <IconLink width={20} height={20} />
                    {logo ? (
                      <img
                        src={logo}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : null}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{entry.name}</span>
                    <span className="set-row-sub">
                      {openedWallet === entry.key ? t('wallet.pairOpened') : t('wallet.pairOpenIn')}
                    </span>
                  </span>
                </motion.a>
              );
            })}
          </div>

          {openedWallet && pairUri && (
            /* Two sentences the tap needs, in the order they become true:
               what we are waiting for, and what to do when nothing opened. */
            <div className="notice" style={{ marginTop: 10 }}>
              <p style={{ fontSize: 12, marginBottom: 4 }}>{t('wallet.pairWaiting')}</p>
              <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
                {t('wallet.pairNoOpen')}
              </p>
            </div>
          )}

          {!pairUri && (
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.pairPreparing')}</p>
          )}

          {pairUri && (
            <>
              <p className="muted" style={{ marginTop: 14, marginBottom: 8 }}>{t('wallet.pairScanHint')}</p>
              {pairQr ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: 12,
                    borderRadius: 14,
                    background: '#fff'
                  }}
                >
                  <svg
                    viewBox={`${-QR_QUIET_MODULES} ${-QR_QUIET_MODULES} ${pairQr.count + QR_QUIET_MODULES * 2} ${pairQr.count + QR_QUIET_MODULES * 2}`}
                    shapeRendering="crispEdges"
                    style={{ width: 'min(62vw, 220px)', height: 'min(62vw, 220px)' }}
                    role="img"
                    aria-label={t('wallet.pairTitle')}
                  >
                    <path d={pairQr.d} fill="#000" />
                  </svg>
                </div>
              ) : null}

              {/* The manual path, folded away but ONE TAP from the surface: when
                  the deep links are the thing that is failing, this is the only
                  control on screen that still works. */}
              <details className="notice" style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>
                  {t('wallet.pairManualTitle')}
                </summary>
                <p
                  className="mono"
                  style={{
                    marginTop: 10,
                    fontSize: 10.5,
                    lineHeight: 1.5,
                    wordBreak: 'break-all',
                    color: 'var(--text-3)'
                  }}
                >
                  {pairUri}
                </p>
                <div style={{ marginTop: 8 }}>
                  {copyButton(copiedUri, copyUri, t('wallet.pairCopyUri'))}
                </div>
              </details>

              {/* The alternative that needs no deep link at all. */}
              <div className="notice" style={{ marginTop: 10 }}>
                <p style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>
                  {t('wallet.pairAltTitle')}
                </p>
                <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                  {t('wallet.pairAltBrowserHint')}
                </p>
                {copyButton(copiedUrl, copySiteUrl, t('wallet.pairAltBrowser'))}
              </div>
            </>
          )}

          <button
            className="btn btn-ghost"
            style={{ marginTop: 14, width: '100%' }}
            disabled={wallet.connecting === false}
            onClick={() => {
              void wallet.cancelWcPairing?.();
              setView('choose');
            }}
          >
            {t('common.cancel')}
          </button>
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
            {mnemonic.split(' ').map((word, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="mono"
                style={{ fontSize: 11.5, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,.4)' }}
              >
                <span style={{ color: 'var(--text-3)', marginInlineEnd: 5 }}>{i + 1}</span>
                {word}
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

          <label className="row" style={{ gap: 9, marginTop: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
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
