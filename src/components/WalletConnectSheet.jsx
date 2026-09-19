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
  closeHandoffTabs,
  handOffChannel,
  openWalletHandoff,
  repairPairingUri,
  walletLinks,
  walletLogo,
  wcEvent
} from '../lib/wc';
import {
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconKey,
  IconLink,
  IconLock,
  IconPlus,
  IconShield,
  IconWallet
} from './Icons';
import WalletHealthPanel from './WalletHealthPanel';
import '../styles/wallet-connect.css';

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
 * TWO SURFACES, NEVER AT ONCE: while the AppKit pairing modal owns the screen
 * (`wallet.wcModalActive`) this sheet withdraws. Two stacked modals means two
 * blurred backdrops and two body-scroll locks, which on the Android WebView
 * composites into the "grey box flickering like a fluorescent tube" report.
 *
 * The row that used to sit between WalletConnect and the injected wallets —
 * «ایمیل و ورود با سوشال», the AppKit embedded wallet — was removed on
 * 2026-09-18 at the owner's request. It needed a SECOND AppKit instance sharing
 * the controllers and the one `<w3m-modal>` with WalletConnect, so an email tap
 * could open the wallet grid instead of the login form and a WalletConnect
 * cycle could leave the shared state describing a dead wallet. One surface, one
 * instance: WalletConnect, the injected wallets, and the in-app vault.
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
  /**
   * Has the user come BACK to this document since a hand-off?
   *
   * This is the «وارد لینک trust://wc?uri=… میشه» report from the other side.
   * A mobile hand-off is a trip: the wallet opens, the user decides, and the
   * phone returns — to our tab if we kept it in front, to a tab Chrome left
   * behind if we did not. Either way, coming back with a pairing still pending
   * is the one moment the app can act: the pairing the wallet needs is STILL
   * THIS ONE, so the honest offer is «باز کردن دوباره» — the same URI, no new
   * pairing, no second approval from scratch.
   */
  const [returned, setReturned] = useState(false);
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
    setReturned(false);
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
   * own preflight), so the sheet says so before the tap: the row wears the
   * measurement instead of the recommendation, and the two routes that need no
   * relay at all — an injected wallet and the in-app vault — sit right below it.
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

  /**
   * Open the wallet AGAIN — on the pairing that is already on screen.
   *
   * Not a retry in the sense of «start over»: `pairUri` is the live pairing the
   * SDK published and is still waiting for. Re-firing the same URI costs the
   * user one more trip into an app that is about to say «already connected» —
   * or, if the first approval never landed, one approval instead of two.
   */
  const reopenWalletApp = (event) => {
    const entry = MOBILE_WALLETS.find((w) => w.key === openedWallet) ?? null;
    if (!entry || !pairUri) {
      event?.preventDefault?.();
      return;
    }
    event?.preventDefault?.();
    haptic?.('light');
    setReturned(false);
    wcEvent('sheet_wallet_reopen');
    const links = walletLinks(entry, pairUri);
    openWalletHandoff(links.native, {
      wallet: entry,
      walletPackage: entry.androidPackage,
      pairingUri: pairUri,
      fallbackUrl: links.universal
    }).then(
      (result) => {
        setHandoffRoute(result.route);
        wcEvent(result.ok ? 'sheet_wallet_reopened' : 'sheet_wallet_reopen_failed');
      },
      () => wcEvent('sheet_wallet_reopen_failed')
    );
  };

  /* ── coming back ──────────────────────────────────────────────────────────
   * Two jobs the moment this document is visible again with a pairing pending:
   * remember it (so the sheet can offer the way back into the wallet), and
   * sweep away any tab a previous hand-off left behind — that tab is what the
   * user was standing on when they concluded «it never comes back».
   */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      closeHandoffTabs();
      if (pairUri) setReturned(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pairUri]);

  /* A settled pairing no longer has a «come back» state to describe. */
  useEffect(() => {
    if (!pairUri) setReturned(false);
  }, [pairUri]);

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
    <Sheet open={open && !wallet.wcModalActive} onClose={close} className="wc-sheet">
      {/* ------------------------------ choose ------------------------------ */}
      {view === 'choose' && (
        /*
         * THE SURFACE THIS ROUND REBUILT.
         *
         * Everything here is presentation; the behaviour is unchanged and the
         * logic above is untouched. The three things that actually changed:
         *
         *   1. GROUPED OPTIONS with a heading each — «کیف پول بیرونی» and
         *      «کیف پول درون‌برنامه‌ای» — because a flat list of six rows with
         *      the same shape gave no clue that the last three are a different
         *      kind of thing (a wallet this app holds, not one you already own).
         *   2. A REAL ICON PER ROW. An injected wallet announces its own brand
         *      icon through EIP-6963 and that is what is drawn; nothing here
         *      guesses a logo from a flag, so a wallet that announces is
         *      recognised and one that does not gets a deliberate tile instead
         *      of a wrong brand.
         *   3. THE RESUME STATE, ON SCREEN. While a lease is being re-attached
         *      (lib/wc/lease.js) this sheet says «در حال اتصال مجدد…» instead
         *      of offering a Connect button for a wallet that is already on its
         *      way back — which is how a working resume used to become a second
         *      approval screen.
         *
         * Every offset in the new classes is logical (padding-inline,
         * margin-inline-start) and every colour is a token, so the layout is
         * correct in Persian (RTL) and in both themes by construction.
         */
        <>
          <div className="wc-head">
            <span className="wc-head-mark" aria-hidden="true"><IconWallet width={22} height={22} /></span>
            <div className="wc-head-text">
              <h2 className="wc-title">{t('wallet.connectTitle')}</h2>
              <p className="wc-sub">{t('wallet.connectSubtitle')}</p>
            </div>
          </div>

          {wallet.restoring && (
            <div className="wc-restoring" role="status">
              <span className="wc-spinner" aria-hidden="true" />
              <span>{t('wallet.reconnectingShort')}</span>
            </div>
          )}

          {relayBlocked && (
            <p className="notice notice-danger" style={{ marginTop: 12 }}>
              {t('wallet.wcRelayBlockedHint')}
            </p>
          )}

          {/* ------------------- what you already have ------------------- */}
          <div className="wc-group">
            <div className="wc-group-head">
              <span className="wc-group-label">{t('wallet.connectSectionExternal')}</span>
              <span className="wc-group-note">{t('wallet.connectExternalNote')}</span>
            </div>
            <div className="wc-list">
              <motion.button
                className="wc-card"
                data-featured={relayBlocked ? undefined : 'true'}
                whileTap={{ scale: 0.985 }}
                onClick={startWalletConnect}
                disabled={wallet.connecting}
              >
                <span className="wc-mark" aria-hidden="true"><IconLink width={21} height={21} /></span>
                <span className="wc-card-body">
                  <span className="wc-card-title">
                    {t('wallet.wc')}
                    {relayBlocked
                      ? <span className="wc-tag wc-tag-blocked">{t('wallet.wcRelayBlockedPill')}</span>
                      : <span className="wc-tag">{t('wallet.recommended')}</span>}
                  </span>
                  <span className="wc-card-sub">
                    {relayBlocked ? t('wallet.wcRelayTryAnyway') : t('wallet.wcDesc')}
                  </span>
                </span>
                <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
              </motion.button>

              {/* Injected wallets: one row per EIP-6963 announcement, with the
                  wallet's OWN icon, falling back to a single window.ethereum row
                  for legacy dapp browsers. */}
              {injected.length > 0
                ? injected.map((p) => (
                    <motion.button
                      key={p.info.uuid}
                      className="wc-card"
                      whileTap={{ scale: 0.985 }}
                      onClick={() => wallet.connectInjected(p.info.rdns).then((ok) => ok && close())}
                      disabled={wallet.connecting}
                    >
                      <span className="wc-mark" aria-hidden="true">
                        {p.info.icon
                          ? <img src={p.info.icon} alt="" loading="lazy" />
                          : <IconWallet width={21} height={21} />}
                      </span>
                      <span className="wc-card-body">
                        <span className="wc-card-title">
                          {providerName(p.info, t)}
                          <span className="wc-tag">{t('wallet.injectedTag')}</span>
                        </span>
                        <span className="wc-card-sub">{t('wallet.injectedDesc')}</span>
                      </span>
                      <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
                    </motion.button>
                  ))
                : typeof window !== 'undefined' && window.ethereum
                  ? (
                    <motion.button
                      className="wc-card"
                      whileTap={{ scale: 0.985 }}
                      onClick={() => wallet.connectInjected().then((ok) => ok && close())}
                      disabled={wallet.connecting}
                    >
                      <span className="wc-mark" aria-hidden="true"><IconWallet width={21} height={21} /></span>
                      <span className="wc-card-body">
                        <span className="wc-card-title">
                          {window.ethereum.isMetaMask
                            ? 'MetaMask'
                            : window.ethereum.isTrust
                              ? 'Trust Wallet'
                              : t('wallet.injected')}
                          <span className="wc-tag">{t('wallet.injectedTag')}</span>
                        </span>
                        <span className="wc-card-sub">{t('wallet.injectedDesc')}</span>
                      </span>
                      <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
                    </motion.button>
                  )
                  : null}
            </div>
          </div>

          {/* -------------- or a wallet this app holds for you ------------- */}
          <div className="wc-group">
            <div className="wc-group-head">
              <span className="wc-group-label">{t('wallet.connectSectionLocal')}</span>
              <span className="wc-group-note">{t('wallet.connectLocalNote')}</span>
            </div>
            <div className="wc-list">
              {hasVault() ? (
                <motion.button className="wc-card" whileTap={{ scale: 0.985 }} onClick={() => setView('unlock')}>
                  <span className="wc-mark" aria-hidden="true"><IconLock width={21} height={21} /></span>
                  <span className="wc-card-body">
                    <span className="wc-card-title">{t('wallet.unlockLocal')}</span>
                    <span className="wc-card-sub">{t('wallet.unlockLocalDesc')}</span>
                  </span>
                  <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
                </motion.button>
              ) : (
                <>
                  <motion.button
                    className="wc-card"
                    whileTap={{ scale: 0.985 }}
                    onClick={startCreate}
                    disabled={busy}
                  >
                    <span className="wc-mark" aria-hidden="true"><IconPlus width={21} height={21} /></span>
                    <span className="wc-card-body">
                      <span className="wc-card-title">{t('wallet.createLocal')}</span>
                      <span className="wc-card-sub">{t('wallet.createLocalDesc')}</span>
                    </span>
                    <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
                  </motion.button>

                  <motion.button
                    className="wc-card"
                    whileTap={{ scale: 0.985 }}
                    onClick={() => setView('import')}
                  >
                    <span className="wc-mark" aria-hidden="true"><IconKey width={21} height={21} /></span>
                    <span className="wc-card-body">
                      <span className="wc-card-title">{t('wallet.importLocal')}</span>
                      <span className="wc-card-sub">{t('wallet.importLocalDesc')}</span>
                    </span>
                    <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
                  </motion.button>
                </>
              )}
            </div>
          </div>

          {/* ---------------------------- failures ---------------------------- */}
          {wallet.error === 'WC_ORIGIN_BLOCKED' && (
            <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('wallet.wcOriginBlocked')}</p>
          )}
          {wallet.error === 'WC_RELAY_UNREACHABLE' && (
            <>
              <p className="notice notice-danger" style={{ marginTop: 12 }}>
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
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.wcExpired')}</p>
          )}
          {/* «The relay is unreachable» used to be printed for a timeout, which
              is how a mobile round trip that simply did not finish became a
              network investigation. A timeout is its own sentence now. */}
          {wallet.error === 'WC_TIMEOUT' && (
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.wcTimeout')}</p>
          )}
          {wallet.error === 'CONNECT_FAILED' && (
            <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('wallet.connectFailed')}</p>
          )}
          {/* The lease lapsed: the app stopped re-attaching by itself, and this
              is the sentence that says so — with the one action that fixes it. */}
          {wallet.error === 'SESSION_EXPIRED' && (
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.sessionLapsed')}</p>
          )}
          {/* The session the wallet signed is gone from this device — a fresh
              connect is the only way forward, and saying so beats a spinner. */}
          {wallet.error === 'SESSION_MISSING' && (
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.sessionGone')}</p>
          )}

          {/* The custody promise and the one honest trade-off of the vault,
              in the same shape, so neither reads as fine print. */}
          <div className="wc-foot">
            <IconShield width={14} height={14} aria-hidden="true" />
            <span>{t('wallet.custodyNotice')}</span>
          </div>
          <p className="wc-foot wc-foot-risk">{t('wallet.localRisk')}</p>

          {/* The evidence, one tap away, where the failure happened. */}
          <WalletHealthPanel projectId={wallet.wcProjectId} />
        </>
      )}

      {/* ------------------------------- pair ------------------------------- */}
      {view === 'pair' && (
        <>
          <div className="wc-head">
            <span className="wc-head-mark" aria-hidden="true"><IconLink width={22} height={22} /></span>
            <div className="wc-head-text">
              <h2 className="wc-title">{t('wallet.pairTitle')}</h2>
              <p className="wc-sub">{t('wallet.pairSubtitle')}</p>
            </div>
          </div>

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
                  className="wc-card"
                  whileTap={{ scale: 0.985 }}
                  href={href || undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-disabled={!pairUri}
                  data-route={openedWallet === entry.key ? handoffRoute || 'pending' : undefined}
                  onClick={(event) => openWalletApp(event, entry)}
                  style={!pairUri ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
                >
                  {/*
                    ONE TILE, ONE MEANING. This used to draw a generic link glyph
                    and then layer the wallet's real logo ON TOP of it, so a
                    loaded logo covered a shape it had nothing to do with and a
                    slow one showed a link icon for MetaMask. The brand logo (from
                    the same Explorer CDN AppKit reads) is now the tile's only
                    content, and the link glyph is the fallback for the case the
                    image never arrives.
                  */}
                  <span className="wc-mark" aria-hidden="true">
                    {logo ? (
                      <img
                        src={logo}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <IconLink width={20} height={20} />
                    )}
                  </span>
                  <span className="wc-card-body">
                    <span className="wc-card-title">{entry.name}</span>
                    <span className="wc-card-sub">
                      {openedWallet === entry.key ? t('wallet.pairOpened') : t('wallet.pairOpenIn')}
                    </span>
                  </span>
                  <IconChevronRight width={16} height={16} className="wc-chev" aria-hidden="true" />
                </motion.a>
              );
            })}
          </div>

          {openedWallet && pairUri && (
            /*
             * THE WAITING CARD.
             *
             * Two sentences used to live here («در انتظار…», «اگر باز نشد…»)
             * and neither was an action. The report they failed to answer is
             * the one this replaces: the user approves in the wallet, comes
             * back — to us, or to the tab Chrome left behind — and there is
             * nothing on screen that puts them back in front of the wallet on
             * the pairing that is still waiting. So they press the wallet's own
             * «Continue» instead, approve a second time, and only then does the
             * connection land.
             *
             * The card now carries the way back: ONE button, the same pairing
             * URI, named as what it is (a re-open, not a fresh pairing).
             */
            <div className="wc-wait" role="status">
              <span className="wc-wait-dot" aria-hidden="true" />
              <div className="wc-wait-body">
                <p className="wc-wait-title">
                  {t('wallet.pairWaitingIn', { wallet: MOBILE_WALLETS.find((w) => w.key === openedWallet)?.name ?? '' })}
                </p>
                <p className="wc-wait-sub">
                  {returned
                    ? t('wallet.pairBackHint')
                    : t('wallet.pairWaiting')}
                </p>
              </div>
              <button
                type="button"
                className="wc-wait-btn"
                onClick={reopenWalletApp}
                data-route={handoffRoute || undefined}
              >
                {t('wallet.pairReopen', { wallet: MOBILE_WALLETS.find((w) => w.key === openedWallet)?.name ?? '' })}
              </button>
              <p className="wc-wait-foot">{t('wallet.pairNoOpen')}</p>
            </div>
          )}

          {!pairUri && (
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.pairPreparing')}</p>
          )}

          {pairUri && (
            <>
              <p className="muted" style={{ marginTop: 14, marginBottom: 8 }}>{t('wallet.pairScanHint')}</p>
              {pairQr ? (
                <div className="wc-qr">
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
          <div className="wc-head">
            <span className="wc-head-mark" aria-hidden="true"><IconShield width={22} height={22} /></span>
            <div className="wc-head-text">
              <h2 className="wc-title">{t('wallet.backupTitle')}</h2>
              {/* The two warnings keep their own sentences instead of being
                  folded into a subtitle: this is the one screen where nobody
                  should have to read twice. */}
              <p className="wc-sub">{t('wallet.backupWarning')}</p>
            </div>
          </div>
          <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('wallet.lossWarning')}</p>

          {/*
            A literal `rgba(255,255,255,.04)` for the group and `rgba(0,0,0,.4)`
            for each word is invisible-as-a-group and muddy-as-a-chip on a light
            page. Both are tokens now, so the seed grid reads the same way in
            either theme — which matters more here than anywhere else in the app,
            because these are the twelve words.
          */}
          <div className="wc-seed-grid">
            {mnemonic.split(' ').map((word, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="mono wc-seed-word"
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
          <div className="wc-head">
            <span className="wc-head-mark" aria-hidden="true">
              {view === 'import' ? <IconKey width={22} height={22} /> : <IconLock width={22} height={22} />}
            </span>
            <div className="wc-head-text">
              <h2 className="wc-title">
                {view === 'import' ? t('wallet.importTitle') : t('wallet.setPassword')}
              </h2>
              <p className="wc-sub">{t('wallet.passwordDesc')}</p>
            </div>
          </div>

          {view === 'import' && (
            <>
              <label className="field-label">{t('wallet.seedPhrase')}</label>
              <textarea
                value={importPhrase}
                onChange={(e) => setImportPhrase(e.target.value)}
                rows={3}
                placeholder="word1 word2 word3 …"
                className="wc-phrase"
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
          <div className="wc-head">
            <span className="wc-head-mark" aria-hidden="true"><IconLock width={22} height={22} /></span>
            <div className="wc-head-text">
              <h2 className="wc-title">{t('wallet.unlockTitle')}</h2>
              <p className="wc-sub">{t('wallet.unlockDesc')}</p>
            </div>
          </div>

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
