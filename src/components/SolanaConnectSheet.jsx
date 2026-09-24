/**
 * SOLANA CONNECT SHEET — the approval screen that was missing.
 * ---------------------------------------------------------------------------
 * The report, verbatim: «وقتی میزنی روی اتصال کیف پول فقط وارد کیف پول فانتوم
 * میشه و هیچ صفحه تاییدی برای اتصال به کیف پول ما انجام نمیشود».
 *
 * That is a description of a connect button that had no step of its own: it
 * handed the user to a wallet and hoped. What was asked for is the opposite
 * order — OUR screen first, saying what is being requested and what the wallet
 * is about to show, and only then the wallet's own prompt.
 *
 * ─── WHAT THIS SHEET IS, AND WHAT IT IS NOT ─────────────────────────────────
 * It is not a fake approval dialog. Nothing here can connect anything: a
 * Solana wallet grants access in ITS OWN UI, and any app that claims otherwise
 * is lying about who holds the key. This sheet is the REVIEW step — the same
 * role BridgeSigningReview plays before a bridge signature:
 *
 *   1. WHAT IS BEING ASKED — the public address, and permission to ASK for
 *      signatures later. Never the seed phrase, never a private key.
 *   2. WHICH ROUTE — the wallet already in this browser (extension), the
 *      phone's own wallet (Android Chrome via MWA), or a deeplink request to
 *      Phantom / Solflare / Backpack. The deeplink request is the one that
 *      produces the native approval screen the report was missing.
 *   3. WAITING — the wallet is in front and we are owed an answer. The old
 *      flow had no such state, which is why a user who came back without
 *      approving could not tell whether anything had been asked at all.
 *   4. CONNECTED — the address the wallet returned, named, so the user sees
 *      the thing they approved land in the app they started from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import InfoBox from './InfoBox';
import { useTelegram } from '../context/TelegramContext';
import { shortAddress } from '../context/WalletContext';
import {
  canInjectSolana,
  canUseMwa,
  connectSolana,
  solanaWalletAvailable,
  solanaWalletName
} from '../lib/solanaWallet';
import {
  cancelDeeplinkRequest,
  consumeDeeplinkResult,
  deeplinkInstallLink,
  deeplinkRouteFor,
  deeplinkSession,
  deeplinkState,
  deeplinkWalletOptions,
  installDeeplinkReturnListeners,
  openDeeplinkBrowse,
  pendingDeeplinkRequest,
  reopenDeeplinkRequest,
  startDeeplinkConnect,
  startDeeplinkConnectSync,
  subscribeDeeplink,
  warmDeeplinkRequest
} from '../lib/solana/deeplink.js';
import { IconCheck, IconExternal, IconShield, IconWallet } from './Icons';
import '../styles/solana-connect.css';

/** The three things the user does inside the wallet, in order. */
const WAITING_STEPS = ['open', 'approve', 'return'];

export default function SolanaConnectSheet({ open, onClose, initialWallet = null, onConnected }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();

  const [phase, setPhase] = useState('choose');
  const [walletId, setWalletId] = useState(initialWallet);
  const [error, setError] = useState(null);
  /* The wallet's own errorCode/errorMessage, when it sent one — shown under
     the named failure so «رد میشود» can be told apart from «could not parse». */
  const [walletSaid, setWalletSaid] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(null);
  /*
   * WHICH channel carried the request. `universal` is the one that sends the
   * browser to the wallet's URL (iOS and the like): the answer then comes
   * back in the phone's DEFAULT browser, and the waiting card must say that
   * out loud instead of implying «you come straight back here».
   */
  const [route, setRoute] = useState(null);
  /* iPhone detection for the note above; the iPad web UA says iPhone too. */
  const [isIOS] = useState(() =>
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
  /*
   * «I tapped and nothing happened.» Set by the flow module when a hand-off was
   * fired, the grace period passed, and this page is still the visible one —
   * i.e. the wallet never came to the front. Without it the waiting card was
   * the same screen for «approve it in Phantom» and for «nothing opened», and
   * the user had no way to tell which one they were looking at.
   */
  const [stuck, setStuck] = useState(false);

  /* Read the device's capabilities once per open: they cannot change while
     the sheet is up, and re-reading on every render would re-run provider
     detection (which touches window globals owned by the wallet). */
  const [caps] = useState(() => ({
    injected: solanaWalletAvailable(),
    injectedName: solanaWalletName(),
    mwa: canUseMwa(),
    canInject: canInjectSolana()
  }));

  const deeplinkWallets = useMemo(() => deeplinkWalletOptions(), []);

  /* Follow the flow the module owns. The answer never arrives through this
     component's own call stack: it comes from a page load, from native code,
     or from another tab — all of which the module funnels into one event. */
  useEffect(() => {
    if (!open) return undefined;
    installDeeplinkReturnListeners();
    const unsubscribe = subscribeDeeplink((state) => {
      if (state.status === 'waiting') {
        setPhase('waiting');
        setRequestId(state.requestId ?? null);
        setWalletId((cur) => state.walletId ?? cur);
        setError(null);
        setStuck(state.stuck === true);
        setRoute(state.route ?? null);
      } else if (state.status === 'connected') {
        setPhase('connected');
        setResult({ ok: true, address: state.address, walletId: state.walletId });
        setBusy(false);
        setStuck(false);
        setRoute(null);
        haptic?.('success');
        onConnected?.(state.address);
      } else if (state.status === 'error') {
        setPhase('error');
        setError(state.code || 'WALLET_ERROR');
        setWalletSaid(state.wallet?.message || state.wallet?.code ? state.wallet : null);
        setBusy(false);
        setStuck(false);
        setRoute(null);
      }
    });

    /*
     * Reopen in the state that is actually true:
     *
     *   • an answer that arrived while the sheet was closed (the wallet
     *     reloaded the page — the normal browser case) opens on CONNECTED,
     *     which is the confirmation the report asked for;
     *   • a request still waiting (the user dismissed the sheet, or the page
     *     reloaded mid-approval) resumes as WAITING, with the same request —
     *     never a silent drop of a connection the user may already have
     *     approved;
     *   • otherwise the ask.
     */
    const latest = consumeDeeplinkResult();
    const pending = pendingDeeplinkRequest();
    if (latest?.op === 'connect') {
      setResult(latest);
      setPhase(latest.ok ? 'connected' : 'error');
      setError(latest.ok ? null : latest.code || 'WALLET_ERROR');
      setWalletSaid(!latest.ok && (latest.wallet?.message || latest.wallet?.code) ? latest.wallet : null);
      if (latest.walletId) setWalletId(latest.walletId);
    } else if (pending) {
      setPhase('waiting');
      setRequestId(pending.id);
      setWalletId(pending.walletId);
      setRoute(deeplinkRouteFor(pending.walletId));
    } else if (deeplinkState().status === 'connected') {
      setPhase('connected');
      setResult({ ok: true, address: deeplinkSession()?.address ?? null });
    }
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && initialWallet) setWalletId(initialWallet);
  }, [open, initialWallet]);

  /*
   * ARM THE REQUEST BEFORE THE TAP.
   *
   * A connect request needs a fresh key pair, and building one costs a dynamic
   * import of `tweetnacl`. Doing that at tap time is what made the wallet open
   * seconds late — and, because Chrome only launches an app for an `intent://`
   * produced by a user gesture, why it often did not open at all. The pair is
   * therefore made here, while the user is still reading the sheet, and again
   * on `pointerdown` over a wallet row (which fires before the click).
   */
  useEffect(() => {
    if (open) warmDeeplinkRequest();
  }, [open]);

  const finish = useCallback((value) => {
    setError(null);
    setPhase('choose');
    setRequestId(null);
    onClose?.(value);
  }, [onClose]);

  /** The wallet that is already here: extension, or our page inside its browser. */
  const connectInPage = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const address = await connectSolana();
      haptic?.('success');
      setResult({ ok: true, address });
      setPhase('connected');
      onConnected?.(address);
    } catch (err) {
      haptic?.('error');
      setError(String(err?.message || 'CONNECT_FAILED'));
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }, [haptic, onConnected]);

  /**
   * Ask the wallet app itself — the request that produces its approval screen.
   *
   * ─── WHY THIS HANDLER IS SYNCHRONOUS ────────────────────────────────────────
   * `startDeeplinkConnectSync` does no awaiting: it takes a pre-armed key pair,
   * builds the URL, stores the request and fires the hand-off inside this very
   * click. That is the difference between the wallet opening and Chrome's rule
   * refusing to launch it («a JavaScript timer tried to open an application
   * without a user gesture»), and between an instant approval screen and one
   * that arrives seconds after the tap. The only case it cannot serve is a tap
   * that arrives before the key pair was armed — then the awaited version runs,
   * which is slower but never fails for that reason.
   */
  const connectByDeeplink = useCallback((id) => {
    setBusy(true);
    setError(null);
    setStuck(false);
    setWalletId(id);
    setRoute(deeplinkRouteFor(id));
    haptic?.('light');

    const started = startDeeplinkConnectSync(id);
    if (started.ok) {
      setRequestId(started.id);
      setPhase('waiting');
      setRoute(started.route ?? deeplinkRouteFor(id));
      setBusy(false);
      return;
    }
    if (started.code !== 'NOT_ARMED') {
      setError(started.code || 'OPEN_FAILED');
      setPhase('error');
      setBusy(false);
      return;
    }

    /* Cold tap: no key pair was ready. Warm up once more and go. */
    startDeeplinkConnect(id).then((res) => {
      if (!res.ok) {
        setError(res.code || 'OPEN_FAILED');
        setPhase('error');
      } else {
        setRequestId(res.id);
        setPhase('waiting');
        setRoute(res.route ?? deeplinkRouteFor(id));
      }
      setBusy(false);
    });
  }, [haptic]);

  const reopen = useCallback(() => {
    haptic?.('light');
    setStuck(false);
    const res = reopenDeeplinkRequest(requestId);
    if (!res.ok) {
      setError(res.code || 'OPEN_FAILED');
      setPhase('error');
    }
  }, [haptic, requestId]);

  /**
   * The recovery route: our page, inside the wallet's own browser.
   *
   * Kept as an explicit button and explained on the card, because the
   * connection it produces lives in that browser — it is a way to connect, not
   * a way to be connected HERE, and pretending otherwise is how a user ends up
   * approving something that never shows up.
   */
  const openInWalletBrowser = useCallback(() => {
    haptic?.('light');
    openDeeplinkBrowse(walletId || 'phantom');
  }, [haptic, walletId]);

  const check = useCallback(() => {
    /*
     * The answer can already be here. On a phone the wallet sometimes returns
     * without the page reloading (the back button, the app switcher, a deep
     * link that arrives while we are visible) — and the user must not have to
     * guess whether they are connected, or reload to find out.
     */
    installDeeplinkReturnListeners();
    const session = deeplinkSession();
    if (session?.address) {
      setResult({ ok: true, address: session.address, walletId: session.walletId });
      setPhase('connected');
      haptic?.('success');
      onConnected?.(session.address);
      return;
    }
    haptic?.('warning');
  }, [haptic, onConnected]);

  const cancel = useCallback(() => {
    cancelDeeplinkRequest(requestId);
    finish(null);
  }, [finish, requestId]);

  const walletLabel =
    deeplinkWallets.find((w) => w.id === walletId)?.label
    ?? caps.injectedName
    ?? t('solana.connect.walletFallback');

  return (
    <Sheet
      open={open}
      onClose={phase === 'waiting' ? cancel : () => finish(null)}
      title={t('solana.connect.title')}
      size="md"
    >
      <div className="stack" style={{ gap: 12 }}>
        {/* ─── 1. the ask ─────────────────────────────────────────────── */}
        {phase === 'choose' && (
          <>
            <p className="muted" style={{ fontSize: 12.8, lineHeight: 1.85, margin: 0 }}>
              {t('solana.connect.intro')}
            </p>

            <div className="card card-tight" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="wallet-badge sol-connect-shield" aria-hidden="true">
                  <IconShield width={15} height={15} />
                </span>
                <span style={{ fontWeight: 700, fontSize: 12.8 }}>{t('solana.connect.askTitle')}</span>
              </div>
              <ul className="p2p-steps" style={{ marginTop: 8 }}>
                <li>{t('solana.connect.askAddress')}</li>
                <li>{t('solana.connect.askSign')}</li>
                <li>{t('solana.connect.neverSeed')}</li>
              </ul>
            </div>

            {/* Already here: a desktop extension, or this page opened inside
                the wallet's own browser. */}
            {caps.injected && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', minHeight: 46 }}
                disabled={busy}
                onClick={connectInPage}
                data-testid="sol-connect-injected"
              >
                <IconWallet width={17} height={17} aria-hidden />
                {busy
                  ? t('wallet.connecting')
                  : t('solana.connect.inPage', { name: caps.injectedName || 'Solana' })}
              </button>
            )}

            {/* The phone's own wallets, over Android's own channel (Chrome on
                Android): the wallet opens and asks for approval there. */}
            {!caps.injected && caps.mwa && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', minHeight: 46 }}
                disabled={busy}
                onClick={connectInPage}
                data-testid="sol-connect-mwa"
              >
                {busy ? t('wallet.connecting') : t('solana.connect.onDevice')}
              </button>
            )}

            {/* The deeplink request: the wallet's OWN approval screen, and the
                only route that works from our APK or from a phone browser
                without an extension. */}
            <div>
              <p className="field-label" style={{ marginBottom: 7 }}>{t('solana.connect.pickWallet')}</p>
              <div className="stack" style={{ gap: 8 }}>
                {deeplinkWallets.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="wallet-option"
                    disabled={busy}
                    /* `pointerdown` fires before `click`: by the time the click
                       handler runs, the key pair the hand-off needs is already
                       in memory (see warmDeeplinkRequest). */
                    onPointerDown={() => warmDeeplinkRequest()}
                    onTouchStart={() => warmDeeplinkRequest()}
                    onClick={() => connectByDeeplink(w.id)}
                    data-testid={`sol-connect-${w.id}`}
                  >
                    <span className="wallet-badge" aria-hidden="true">{w.label.slice(0, 2).toUpperCase()}</span>
                    <span className="sol-connect-text">
                      <span className="sol-connect-name">{w.label}</span>
                      <span className="sol-connect-sub">{t('solana.connect.rowSub')}</span>
                    </span>
                    <IconExternal width={14} height={14} aria-hidden />
                  </button>
                ))}
              </div>
              <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.75 }}>
                {t('solana.connect.deeplinkHint')}
              </p>
            </div>

            {!caps.canInject && !caps.mwa && !caps.injected && (
              <InfoBox title={t('solana.connect.whyTitle')} tone="info" id="solana-connect-why">
                <p>{t('solana.connect.whyBody')}</p>
              </InfoBox>
            )}
          </>
        )}

        {/* ─── 2. waiting for the wallet's own confirmation ───────────── */}
        {phase === 'waiting' && (
          <>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span className="dot" aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>
                  {t('solana.connect.waitingTitle', { name: walletLabel })}
                </div>
                <p className="faint" style={{ fontSize: 11.5, margin: '3px 0 0' }}>
                  {t('solana.connect.waitingSub')}
                </p>
              </div>
            </div>

            {/*
              * THE iOS RETURN PATH, SAID OUT LOUD.
              *
              * On iPhone the universal (HTTPS) hand-off answers in the
              * phone's DEFAULT browser — not in the browser this sheet was
              * opened from (started in Chrome, back in Safari is the report's
              * exact case). The user is told now, before approving, that the
              * connection completes in that other browser; and the return
              * blob on the redirect (`fbt=`) makes it TRUE that the
              * connection completes there — session and signature land in
              * the browser the user returns to, instead of in a dead end.
              */}
            {isIOS && route === 'universal' && (
              <div className="card card-tight" data-testid="sol-connect-ios-return" style={{ marginTop: 10 }}>
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <span className="wallet-badge" aria-hidden="true">
                    <IconExternal width={15} height={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.8 }}>{t('solana.connect.iosReturnTitle')}</div>
                    <p className="faint" style={{ fontSize: 11, margin: '4px 0 0', lineHeight: 1.75 }}>
                      {t('solana.connect.iosReturnBody', { name: walletLabel })}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <ol className="p2p-steps">
              {WAITING_STEPS.map((step) => (
                <li key={step}>{t(`solana.connect.step.${step}`, { name: walletLabel })}</li>
              ))}
            </ol>

            {/* `.btn-row`, not `.row` + inline flex: it gives BOTH buttons an
                equal basis (`flex: 1 1 0`) and `width: auto`, which is the only
                combination that survives a long label in fa/ar — mixing an
                inline `flex: 1` with a full-width `.btn` squeezes the primary. */}
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={reopen} data-testid="sol-connect-reopen">
                {t('solana.connect.reopen', { name: walletLabel })}
              </button>
              <button type="button" className="btn btn-ghost" onClick={check} data-testid="sol-connect-check">
                {t('solana.connect.check')}
              </button>
            </div>

            {/*
              * «اتفاقی نمیافتد» — said out loud instead of left as a spinner.
              *
              * The flow module knows the difference between "the wallet is in
              * front of you, waiting to be approved" and "the hand-off went
              * nowhere and this page never lost focus", because the second one
              * keeps this document visible through the whole grace period. When
              * it is the second one, the user gets the three routes that are
              * still left — try again, open our page inside the wallet's own
              * browser, or install the wallet.
              */}
            {stuck && (
              <div className="card card-tight" data-testid="sol-connect-stuck">
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="wallet-badge" aria-hidden="true">
                    <IconExternal width={15} height={15} />
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 12.8 }}>
                    {t('solana.connect.stuckTitle', { name: walletLabel })}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', lineHeight: 1.8 }}>
                  {t('solana.connect.stuckBody', { name: walletLabel })}
                </p>
                <div className="btn-row" style={{ marginTop: 9 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={reopen}
                    data-testid="sol-connect-stuck-reopen"
                  >
                    {t('solana.connect.stuckReopen', { name: walletLabel })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={openInWalletBrowser}
                    data-testid="sol-connect-stuck-browse"
                  >
                    {t('solana.connect.stuckBrowse', { name: walletLabel })}
                  </button>
                </div>
                <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.75 }}>
                  {t('solana.connect.stuckBrowseNote', { name: walletLabel })}
                </p>
                {deeplinkInstallLink(walletId || 'phantom') && (
                  <a
                    className="faint"
                    style={{ fontSize: 11 }}
                    href={deeplinkInstallLink(walletId || 'phantom')}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="sol-connect-stuck-install"
                  >
                    {t('solana.connect.stuckInstall', { name: walletLabel })}
                  </a>
                )}
              </div>
            )}

            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
              {t('solana.connect.cancel')}
            </button>
            <p className="notice">{t('solana.connect.waitingNote')}</p>
          </>
        )}

        {/* ─── 3. the address the wallet returned ─────────────────────── */}
        {phase === 'connected' && (
          <>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span className="wallet-badge sol-connect-ok" aria-hidden="true">
                <IconCheck width={16} height={16} />
              </span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t('solana.connect.doneTitle')}</div>
                <p className="faint" style={{ fontSize: 11.5, margin: '3px 0 0' }}>{t('solana.connect.doneSub')}</p>
              </div>
            </div>

            <InfoBox title={t('solana.connect.doneCard')} tone="success" id="solana-connect-done">
              <div className="row-between">
                <span className="faint">{t('solana.connect.walletName')}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{walletLabel}</span>
              </div>
              <div className="row-between" style={{ marginTop: 7 }}>
                <span className="faint">{t('solana.connect.address')}</span>
                <span className="mono" style={{ fontSize: 12 }}>{shortAddress(result?.address ?? '')}</span>
              </div>
              <p className="faint" style={{ fontSize: 11.5, marginTop: 9, lineHeight: 1.8 }}>
                {t('solana.connect.doneNote')}
              </p>
            </InfoBox>

            <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => finish('connected')}>
              {t('solana.connect.done')}
            </button>
          </>
        )}

        {/* ─── 4. a named failure ─────────────────────────────────────── */}
        {phase === 'error' && (
          <>
            <p className="notice notice-danger" data-testid="sol-connect-error">
              {t(`solana.connect.err.${error}`, t('solana.connect.err.WALLET_ERROR'))}
            </p>
            {walletSaid && (
              <p className="faint" style={{ fontSize: 11, lineHeight: 1.8 }} data-testid="sol-connect-wallet-said" dir="auto">
                {t('solana.connect.walletSaid', {
                  message: walletSaid.message || '—',
                  code: walletSaid.code || '—'
                })}
              </p>
            )}
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { setPhase('choose'); setError(null); setWalletSaid(null); }}
              >
                {t('solana.connect.retry')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => finish(null)}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}

        {(phase === 'choose' || phase === 'waiting') && (
          <p className="faint" style={{ fontSize: 11, lineHeight: 1.8 }}>
            {t('settings.walletPrivacyLine')}
          </p>
        )}
      </div>
    </Sheet>
  );
}
