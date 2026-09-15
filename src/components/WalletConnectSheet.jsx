import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { openWalletLink, walletHandOffChannel } from '../lib/browser';
import { MOBILE_WALLETS, repairPairingUri, walletDeepLinks, walletLogo } from '../lib/wcWallets';
import { publicAppUrl } from '../lib/nativeShell';
import {
  createVaultWithSigner,
  generateMnemonic,
  hasVault,
  preloadWalletCrypto,
  passwordStrength,
  validateMnemonic
} from '../lib/localWallet';
import { IconCheck, IconCopy, IconKey, IconLink, IconLock, IconPlus, IconWallet } from './Icons';

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

/**
 * QR QUIET ZONE, IN MODULES.
 *
 * ISO/IEC 18004 requires four light modules of margin around the symbol, and
 * `qrcode-generator` does NOT include it: measured on a real v8 pairing URI,
 * `getModuleCount()` is 49 (= 17 + 4×8, the symbol alone) and 119 modules on
 * its outer ring are dark. Rendering that grid edge-to-edge and leaving the
 * margin to CSS padding produced a quiet zone of ~2.7 modules at 220px — under
 * spec, and the reason a scanner that should have read it needed three
 * attempts. The margin therefore belongs in the VIEWBOX, where it scales with
 * the symbol at any size and can never be lost to a CSS change.
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
   * THE PAIRING VIEW IS THE FALLBACK SURFACE — AND THE ONE THAT IS ALWAYS
   * RIGHT IN FRONT OF US.
   *
   * The SDK's own AppKit modal is the primary screen for a WalletConnect
   * pairing again (that is the surface users recognise: wallet logos, a QR,
   * "Open" per wallet), and while it is up this sheet withdraws —
   * `wallet.wcModalActive`. Two stacked modals means two blurred backdrops and
   * two scroll locks, which on the Android WebView composited into the
   * reported "grey box flickering like a fluorescent tube".
   *
   * The pairing view below is what remains when that modal cannot be built
   * (WalletContext retries init() without it and traces
   * `appkit_modal_unavailable`), and it is built from the same one string the
   * SDK publishes on `display_uri` (`wallet.wcPairUri`): a real QR of exactly
   * those bytes, one deep link per promoted wallet, and the URI itself in
   * copyable text. Nothing here is fetched from `api.web3modal.org`, so this
   * path works on a network that filters it.
   *
   * Both surfaces deliver through the same rule, and it is the rule that
   * actually fixes the standing report: a wallet hand-off NEVER navigates this
   * page away. `window.open(url, '_self')` — what the SDK does on the open web
   * (`ConnectionControllerUtil.onConnectMobile`, appkit-controllers@1.8.19:
   * `const target = isIframe() ? '_top' : '_self'`) — replaces the document
   * and destroys the pairing mid-flight. So every wallet row here is a real
   * `<a target="_blank">`: not pop-up blockable, and this page is still alive
   * to receive the approval.
   */
  const [openedWallet, setOpenedWallet] = useState(null);
  const [copiedUri, setCopiedUri] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [pairQr, setPairQr] = useState(null);

  const injected = useEip6963();

  /*
   * The QR of the pairing URI, encoded with the same library the receive
   * screen uses. A QR is Reed-Solomon plus a masking pass; a subtly wrong
   * encoder still draws a scannable square that decodes to something else —
   * for a pairing URI that is a wallet that says "invalid" and never
   * connects. So: the real library, and the URI is repaired (`&amp;` → `&`)
   * before it is encoded, because an escaped URI cannot pair at all.
   *
   * The encoder is imported LAZILY, on the attempt that needs it. This sheet
   * is in the first-paint graph, and pulling a QR encoder into the entry
   * chunk for a view most sessions never open is exactly the "one eager
   * import at a time" drift the bundle budget guards against.
   */
  const pairUri = wallet.wcPairUri ? repairPairingUri(wallet.wcPairUri) : null;
  useEffect(() => {
    let alive = true;
    if (!pairUri) {
      setPairQr(null);
      return undefined;
    }
    import('qrcode-generator')
      .then((mod) => {
        if (!alive) return;
        const encode = mod?.default ?? mod;
        const q = encode(0, 'M');
        q.addData(pairUri);
        q.make();
        const count = q.getModuleCount();
        let d = '';
        for (let r = 0; r < count; r += 1) {
          for (let c = 0; c < count; c += 1) {
            if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
          }
        }
        setPairQr({ d, count });
      })
      .catch(() => {
        /* The buttons and the copyable text below are the authoritative
           path; a rendering problem must never hide the pairing itself. */
        if (alive) setPairQr(null);
      });
    return () => { alive = false; };
  }, [pairUri]);

  const strength = passwordStrength(password);

  const reset = () => {
    setView('choose');
    setMnemonic('');
    setImportPhrase('');
    setPassword('');
    setPassword2('');
    setAck(false);
    setErr(null);
    /* Pairing-view residue: a row still saying "opened — confirm in the
       wallet" and a button still saying "copied" would both be lying about an
       attempt that is over. */
    setOpenedWallet(null);
    setCopiedUri(false);
    setCopiedUrl(false);
  };

  const close = () => {
    /*
     * Closing the sheet mid-pairing IS a cancel: the attempt owns a live
     * pairing topic and a pending promise, and leaving it running would keep
     * the single-flight guard held, so the next tap would be swallowed. The
     * context settles the promise and tears the provider down.
     */
    if (view === 'pair' && wallet.connecting) void wallet.cancelWcPairing?.();
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
    setErr(null);
    setOpenedWallet(null);
    setCopiedUri(false);
    setView('pair');
    wallet
      .connectWalletConnect()
      .then((ok) => {
        if (ok) close();
        else setView('choose');
        /* on failure the choose view names the error (origin blocked, relay
           unreachable, expired, cancelled) — never a silent dead end */
      })
      .catch(() => setView('choose'));
  };

  /*
   * The https universal link for a wallet — the href the anchor carries.
   *
   * The link itself comes from lib/wcWallets.js: the https universal link
   * (`https://link.trustwallet.com/wc?uri=…`, `https://metamask.app.link/wc?…`)
   * that each wallet's own docs prescribe, because a custom scheme
   * (`trust://…`) is navigable from a system browser and from nothing else —
   * a WebView answers it with the «invalid deep link» error page.
   *
   * It is an HREF, not something built inside a click handler, for two
   * reasons: an anchor with a real href is never pop-up blocked (the blocker
   * only applies to scripted windows), and if this sheet's JavaScript dies the
   * link is still a link. Trust Wallet's own developer docs prescribe exactly
   * this URL, and their example even opens it with `_blank` — the target this
   * sheet now uses everywhere, because `_self` replaces this document and
   * takes the pending pairing down with it.
   */
  const walletHref = (key) => (pairUri ? walletDeepLinks(key, pairUri)?.universal || '' : '');

  /**
   * Hand the pairing to a wallet app.
   *
   * On the open web this does almost nothing — and that is the point. The
   * anchor does the navigating: a new tab, our page untouched, and the OS
   * resolving Android App Links / iOS Universal Links to the installed wallet.
   * Only in the two contexts where an anchor cannot do the job does this take
   * over: inside Telegram (the Mini App iframe must be left through Telegram's
   * own opener or the app underneath is unloaded) and in the packaged app
   * (the WebView must not navigate at all — Android Custom Tabs takes the URL
   * instead).
   */
  const openWalletApp = (e, key) => {
    const href = walletHref(key);
    if (!href) {
      e.preventDefault();
      return;
    }
    setOpenedWallet(key);
    haptic?.('light');
    const channel = walletHandOffChannel();
    if (channel === 'web') return; /* let the anchor open its own tab */
    e.preventDefault();
    void openWalletLink(href, { target: '_blank' }).then((ok) => {
      if (!ok) setOpenedWallet(null);
    }, () => setOpenedWallet(null));
  };

  const copyUri = async () => {
    if (!pairUri) return;
    try {
      await navigator.clipboard?.writeText(pairUri);
      setCopiedUri(true);
      haptic?.('success');
      setTimeout(() => setCopiedUri(false), 1800);
    } catch { /* clipboard is a convenience, the text is on screen anyway */ }
  };

  /*
   * The address of THIS site, for the deep-link-free path: paste it into the
   * wallet's own browser tab and the injected provider takes over. Copied from
   * `publicAppUrl` rather than `window.location` so the address a user gets is
   * the canonical https one — inside the packaged app the runtime origin is
   * `https://localhost`, which is exactly the string that must never be
   * handed to another app.
   */
  const copySiteUrl = async () => {
    try {
      await navigator.clipboard?.writeText(publicAppUrl('/'));
      setCopiedUrl(true);
      haptic?.('success');
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch { /* nothing else to hand over; the hint above names the site */ }
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
     * TWO SURFACES, NEVER AT ONCE.
     *
     * While the SDK's AppKit modal owns the pairing (`wallet.wcModalActive`)
     * this sheet withdraws: two stacked modals means two blurred backdrops and
     * two body-scroll locks, which on the Android WebView composited into the
     * reported "grey box flickering like a fluorescent tube". The moment the
     * attempt settles the context clears the flag and the sheet is back — with
     * the choose view naming the outcome, never a silent dead end.
     *
     * The exit and re-enter animations are handled by AnimatePresence inside
     * Sheet, so a quick close→open cannot produce two panels — React re-keys
     * nothing, and a re-open mid-exit animates the SAME element back instead
     * of mounting a second one.
     */
    <Sheet open={open && !wallet.wcModalActive} onClose={close}>
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

      {/* ------------------------------- pair ------------------------------- */}
      {view === 'pair' && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>{t('wallet.pairTitle')}</h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('wallet.pairSubtitle')}</p>

          {/*
            One row per promoted wallet, as a REAL LINK.

            • `href` is the wallet's documented https universal link, so the
              browser — not our JavaScript — performs the hand-off, in a new
              tab. This page stays connected and is still holding the pending
              pairing when the wallet answers.
            • `target="_blank"` is not a preference: `_self`/`_top` replace
              this document, and a WalletConnect pairing whose dApp has
              navigated away can never complete. (The SDK's own mobile
              hand-off used `_self` — that single argument is what the
              «deep-link error / never connects» report was.)
            • The brand logo comes from the same explorer CDN AppKit renders
              in its modal, with the generic glyph underneath it as the
              fallback if the image cannot be fetched.
            • Enabled the moment the SDK has issued a URI — before that there
              is nothing to hand over and a tap would open a wallet with an
              empty payload, which is exactly the «invalid deep link» screen.
          */}
          <div className="stack" style={{ gap: 9 }}>
            {MOBILE_WALLETS.map((w) => {
              const href = walletHref(w.key);
              const logo = walletLogo(w.imageId, wallet.wcProjectId);
              return (
                <motion.a
                  key={w.key}
                  className="wallet-option"
                  whileTap={{ scale: 0.98 }}
                  href={href || undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-disabled={!pairUri}
                  onClick={(e) => openWalletApp(e, w.key)}
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
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{w.name}</span>
                    <span className="set-row-sub">
                      {openedWallet === w.key ? t('wallet.pairOpened') : t('wallet.pairOpenIn')}
                    </span>
                  </span>
                </motion.a>
              );
            })}
          </div>

          {!pairUri && (
            <p className="notice" style={{ marginTop: 12 }}>{t('wallet.pairPreparing')}</p>
          )}

          {pairUri && (
            <>
              <p className="muted" style={{ marginTop: 14, marginBottom: 8 }}>
                {t('wallet.pairScanHint')}
              </p>
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
                  {/* viewBox = the module grid PLUS the spec's 4-module quiet
                      zone (the encoder emits none — see QR_QUIET_MODULES);
                      crisp at any size, and the path is the encoder's own
                      output — no re-derivation. */}
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

              {/*
                THE MANUAL PATH, folded away.

                Every automatic path can fail (a blocked relay, a wallet that
                will not open, a WebView that refuses a scheme) and this is the
                one that still works: copy the URI, paste it into the wallet's
                own WalletConnect scanner. It is inside a <details> because a
                200-character hex string across the middle of the sheet is what
                made the surface read as broken — but it must stay ONE TAP
                away, not behind a menu: when the deep links are the thing
                that is failing, this is the only control on screen that works.
              */}
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
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={copyUri}>
                  {copiedUri ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
                  <span style={{ marginInlineStart: 6 }}>
                    {copiedUri ? t('common.copied') : t('wallet.pairCopyUri')}
                  </span>
                </button>
              </details>

              {/*
                THE ALTERNATIVE THAT NEEDS NO DEEP LINK AT ALL.

                Asked for explicitly («الترناتیو که مثل تراست والت باشه»), and
                worth more than another wallet button: opening THIS SITE inside
                the wallet's own browser uses the injected provider (EIP-6963 /
                window.ethereum). No deep link, no universal link, no relay —
                the three things this whole report has been about — so it is
                the path that still works when every one of them is blocked.
                It is a button rather than a paragraph of instructions because
                it copies the address for the user; the only step left is
                paste-and-go inside the wallet.
              */}
              <div className="notice" style={{ marginTop: 10 }}>
                <p style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>
                  {t('wallet.pairAltTitle')}
                </p>
                <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                  {t('wallet.pairAltBrowserHint')}
                </p>
                <button className="btn btn-ghost" onClick={copySiteUrl}>
                  {copiedUrl ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
                  <span style={{ marginInlineStart: 6 }}>
                    {copiedUrl ? t('common.copied') : t('wallet.pairAltBrowser')}
                  </span>
                </button>
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
