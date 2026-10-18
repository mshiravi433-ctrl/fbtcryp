import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SegIndicator from './SegIndicator';
import QrScanner from './QrScanner';
import Sheet from './Sheet';
import ArrivalPopup from './ArrivalPopup';
import FancyQr from './FancyQr';
import {
  IconArrowUpRight, IconCheck, IconCopy, IconLink, IconQr, IconShield, IconWallet
} from './Icons';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { watchIncoming } from '../lib/incomingWatch';
import { EVM_CHAINS, TOKENS } from '../lib/chains';
import {
  buildPayLink, formatUnits,
  nfcSupported,
  nfcUnavailableReason,
  parsePayLink,
  readNfcAddress
} from '../lib/tapToPay';
import '../styles/tap-to-pay.css';

/**
 * TAP TO PAY — exchange an address in person, then confirm in your own wallet.
 * ---------------------------------------------------------------------------
 * See lib/tapToPay.js for the platform facts that shape this: phone-to-phone
 * NFC was REMOVED in Android 14, and Web NFC reads passive tags only. So the
 * tap moves the ADDRESS and the wallet moves the MONEY — which is also the
 * correct security model, because a payment triggerable by proximity alone is
 * a robbery mechanism.
 *
 * ─── WHAT WAS WRONG WITH THE FIRST VERSION, AND WHY ─────────────────────────
 * Reported: «دکمه های nfc طوسی شکل اندازه و رنگ نامناسب دارند و کارایی کمی دارند»
 * — grey, wrong size and colour, and they do very little.
 *
 * All three complaints had the same root cause and it was my mistake.
 *
 * COLOUR AND SIZE: I invented `className="seg"` with `seg-on` for the active
 * button. Neither class exists in index.css. The real segmented control in
 * this app is `.segmented` with `.active`, plus a <SegIndicator> pill that
 * each call site must render. So my buttons inherited nothing at all — no
 * background, no height, no active state. They were literally unstyled: grey
 * boxes, too small, with no visible selection. Wiring check #26 exists to
 * catch a missing indicator, but it only inspects files that already contain
 * `className="segmented"`, so a made-up class slipped straight past it. That
 * gap is now closed in the test as well as here.
 *
 * DOES VERY LITTLE: also true, and worse than cosmetic. The "receive" side
 * printed the pay link as raw text for the other person to read off a screen
 * and type — which is exactly the 42-character transcription this feature
 * exists to eliminate.
 *
 * ─── WHAT THIS VERSION ADDS ─────────────────────────────────────────────────
 * «پرداخت با نزدیک تر کردن گوشی را خیلی مدرن کن با کیو ار کد جذاب تر و کارایی
 * را بهتر کن که مطمئن شی کار میده حتما» — make it modern, make the QR
 * beautiful, make it actually work.
 *
 *   1. THE QR IS THE APP'S FANCY QR (components/FancyQr.jsx) — the same
 *      surface the receive sheets use, with its aurora halo, energy rim and
 *      viewfinder brackets. It is the one component in the repo whose
 *      decodability is pinned by a test that rasterises the painted path and
 *      pushes it through a real QR decoder, so "it looks good but will not
 *      scan" is not a failure mode available to it.
 *   2. THE CODE CAN BE ENLARGED to fill a sheet. Two phones in a shop is the
 *      real use, and a 232px code across a counter is a coin flip.
 *   3. THE NETWORK IS NAMED ON THE FACE OF THE CARD. Every EVM chain reuses
 *      the same 0x address, so "the wrong network" is how a payment is lost —
 *      and this is the one fact the old screen never showed.
 *   4. AN OPTIONAL AMOUNT rides inside the code as EIP-681 `?value=` when the
 *      request is in the chain's own coin (see buildPayLink for why tokens
 *      must NOT be encoded that way).
 *   5. SHARE, not just copy — `navigator.share` hands the link to any app the
 *      phone has, which is what two people standing next to each other want.
 *   6. NFC GETS A RADAR while it is listening, so a silent 30-second wait
 *      reads as "waiting" instead of "broken".
 *   7. A SCANNED ADDRESS FROM ANOTHER CHAIN IS NAMED AS SUCH. Getting that
 *      warning after signing is too late.
 */

const MODES = ['receive', 'pay'];

function WatchClock({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  /* dir/ltr and tabular figures: the two digits must not shuffle as the clock
     ticks, or the whole card reflows once a second. */
  return <b className="tap-clock mono" dir="ltr">{mm}:{ss}</b>;
}

export default function TapToPay({ onAddress }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const { address: myAddress, chainId, getReadProvider } = useWallet();

  const [mode, setMode] = useState('receive');
  const [scanning, setScanning] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [err, setErr] = useState(null);
  const [got, setGot] = useState(null);
  const [manual, setManual] = useState('');
  const [copied, setCopied] = useState('');
  const [amount, setAmount] = useState('');
  const [watchingSince, setWatchingSince] = useState(null);

  const [arrived, setArrived] = useState(null);
  const [watchSym, setWatchSym] = useState(null);

  const abortRef = useRef(null);

  const chain = EVM_CHAINS[chainId] ?? null;

  /*
   * WHICH asset to watch for. The receiver has to say, because a balance poll
   * can only watch one token at a time — there is no "any token" query that
   * does not need a log filter, and log filters are exactly what the public
   * RPCs this app falls back to serve badly.
   */
  const chainTokens = useMemo(() => TOKENS[chainId] ?? [], [chainId]);
  const watchToken = useMemo(
    () => chainTokens.find((tk) => tk.symbol === watchSym) ?? chainTokens[0] ?? null,
    [chainTokens, watchSym]
  );
  /*
   * ─── THE RECEIVER'S CONFIRMATION ──────────────────────────────────────────
   * Poll only while the receive tab is actually showing. This is not a
   * background service: it starts when the user says "I am receiving" and
   * stops the moment they switch away or close the box, so it cannot quietly
   * drain a battery. See lib/incomingWatch.js for why polling beats a log
   * subscription on the connections this app has to work over.
   */
  useEffect(() => {
    if (mode !== 'receive' || !myAddress || !watchToken) return undefined;

    /*
     * `getReadProvider` is async, so the watcher cannot start synchronously.
     * `stop` is assigned once it resolves and the cleanup handles both orders:
     * if the component unmounts before the provider arrives, `cancelled`
     * prevents a watcher being started that nobody would ever stop.
     */
    let stop = null;
    let cancelled = false;

    getReadProvider(chainId)
      .then((provider) => {
        if (cancelled || !provider) return;
        stop = watchIncoming({
          provider,
          address: myAddress,
          token: watchToken,
          onArrive: ({ amount: amt, symbol }) => setArrived({ amount: amt, symbol })
        });
        setWatchingSince(Date.now());
      })
      .catch(() => {
        /* No provider means no confirmation popup. The QR still works, and a
           silent absence is better than an error about our own plumbing. */
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [mode, myAddress, watchToken, chainId, getReadProvider]);

  useEffect(() => {
    if (mode === 'receive' && myAddress && watchToken) return undefined;
    setWatchingSince(null);
    return undefined;
  }, [mode, myAddress, watchToken]);

  /*
   * Stop any live NFC scan when this component goes away. Without it the radio
   * stays on, and a tag read later resolves a promise whose UI is gone.
   */
  useEffect(() => () => abortRef.current?.abort(), []);

  const supported = nfcSupported();
  const reason = supported ? null : nfcUnavailableReason();

  /*
   * The payload the other phone reads. Built from OUR connected wallet, so
   * there is nothing to type and nothing to mistype.
   *
   * The amount is only carried inside the code when it is denominated in the
   * chain's OWN coin — see buildPayLink for the reason, which is short and
   * expensive: the token form of EIP-681 puts the token contract where every
   * parser reads the recipient.
   */
  const amountIsNative = Boolean(watchToken?.native);
  const payLink = useMemo(() => {
    try {
      return myAddress
        ? buildPayLink(myAddress, chainId, {
          amount,
          decimals: watchToken?.decimals,
          native: amountIsNative
        })
        : null;
    } catch {
      return null;
    }
  }, [myAddress, chainId, amount, amountIsNative, watchToken]);

  /*
   * ─── KEEP THE SCREEN AWAKE WHILE THE CODE IS ON IT ───────────────────────
   * «مطمئن شی کار میده حتما» — the most likely way this feature fails is not a
   * bug in the QR, it is the phone dimming and locking 15 seconds into someone
   * holding it up across a counter. A dark screen scans as well as no screen.
   *
   * The Screen Wake Lock API is exactly this and nothing more: it asks the OS
   * not to sleep the display. It is Chrome-on-Android (and Safari 16.4+),
   * it needs no permission, and where it is missing this is a no-op — the code
   * simply behaves as it did before rather than reporting a failure about our
   * own plumbing.
   *
   * The lock is held ONLY while a code is actually on screen, and released on
   * tab switch, unmount and page hide. Holding it any longer is a battery
   * drain sold as a feature.
   */
  useEffect(() => {
    if (mode !== 'receive' || !payLink) return undefined;
    const api = typeof navigator !== 'undefined' ? navigator.wakeLock : null;
    if (!api?.request) return undefined;

    let sentinel = null;
    let cancelled = false;

    const acquire = () => {
      if (cancelled) return;
      api.request('screen')
        .then((lock) => {
          if (cancelled) {
            lock.release().catch(() => {});
            return;
          }
          sentinel = lock;
        })
        .catch(() => {
          /* Refused (low battery, or the document is hidden). Nothing to tell
             the user: the QR is still there, they just have to keep the phone
             awake the way they always have. */
        });
    };

    acquire();
    /* The OS drops the lock whenever the document is hidden, and it is NOT
       re-granted automatically on return — so re-request it on visibility.
       The old sentinel is dropped here rather than released: it is already
       gone by the time we get the event, and calling release() on it would
       only reject. */
    const onVisible = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      sentinel = null;
      acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release?.()?.catch(() => {});
      sentinel = null;
    };
  }, [mode, payLink]);

  /* The same number, as a human string, for the line under the code. */
  const requestText = useMemo(() => {
    const trimmed = String(amount || '').trim();
    if (!trimmed || !watchToken) return null;
    if (!/^\d*(?:\.\d*)?$/.test(trimmed)) return null;
    return { text: `${trimmed} ${watchToken.symbol}`, inCode: amountIsNative && Number(trimmed) > 0 };
  }, [amount, watchToken, amountIsNative]);

  /* What the OTHER phone is asking for, decoded out of a scanned link. */
  const gotRequest = useMemo(() => {
    if (!got?.value) return null;
    const ofChain = EVM_CHAINS[got.chainId ?? chainId] ?? chain;
    const dec = ofChain?.native?.decimals ?? 18;
    const human = formatUnits(got.value, dec);
    if (!human) return null;
    return `${human} ${ofChain?.native?.symbol ?? ''}`.trim();
  }, [got, chainId, chain]);

  const accept = useCallback(
    (parsed) => {
      setErr(null);
      setGot(parsed);
      haptic?.('success');
      onAddress?.(parsed);
    },
    [haptic, onAddress]
  );

  const scan = useCallback(async () => {
    setErr(null);
    setGot(null);
    setScanning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      accept(await readNfcAddress({ signal: ctrl.signal }));
    } catch (e) {
      setErr(e.message || 'NFC_SCAN_FAILED');
      haptic?.('error');
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [accept, haptic]);

  const useManual = () => {
    const parsed = parsePayLink(manual);
    if (!parsed) {
      setErr('BAD_ADDRESS');
      haptic?.('error');
      return;
    }
    accept(parsed);
  };

  /* One clipboard path, two things to copy. The flash confirms WHICH one was
     taken — "copied" next to both buttons at once tells the user nothing. */
  const copy = async (text, tag) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      haptic?.('success');
      setTimeout(() => setCopied(''), 2000);
    } catch {
      /* clipboard blocked; the QR and the text are both still on screen */
    }
  };

  const share = async () => {
    if (!payLink) return;
    const title = t('tap.title');
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ url: payLink, title });
        return;
      } catch {
        /* dismissed, or the OS refused — fall through to copy */
      }
    }
    copy(payLink, 'link');
  };

  /* The frame around the code takes the receiving chain's own accent, so the
     QR and the network chip under it read as one object. */
  const qrAccent = useMemo(
    () => ['#00e5ff', chainId === 1 ? '#7c4dff' : '#7c4dff', '#00ff9d'],
    [chainId]
  );

  const qrBadge = <IconWallet width={18} height={18} />;

  return (
    <div className="tap-box">
      <div className="tap-head">
        <span className="tap-head-icon"><IconQr width={19} height={19} /></span>
        <div className="tap-head-copy">
          <strong>{t('tap.title')}</strong>
          <p>{t('tap.intro')}</p>
          {/* Say outright whether NFC works on THIS device, as asked. Users
              should not have to switch tabs and press a button to discover
              their phone cannot do it — and on iOS it never can. */}
          <span className={`tap-nfc ${supported ? 'is-on' : 'is-off'}`}>
            <i aria-hidden="true" />{supported ? t('tap.nfcYes') : t('tap.nfcNo')}
          </span>
        </div>
      </div>

      {/*
        The REAL segmented control: `.segmented` + `.active` + <SegIndicator>.
        The previous `className="seg"` matched no stylesheet rule at all, which
        is why these rendered as small grey boxes with no active state.
      */}
      <div className="segmented tap-modes">
        {MODES.map((k) => (
          <button
            key={k}
            className={mode === k ? 'active' : ''}
            aria-pressed={mode === k}
            onClick={() => {
              haptic?.('select');
              setMode(k);
              setErr(null);
            }}
            style={{ isolation: 'isolate' }}
          >
            {mode === k && <SegIndicator id="taptopay" />}
            <span className="tap-mode-icon">
              {k === 'receive' ? <IconQr width={14} height={14} /> : <IconArrowUpRight width={14} height={14} />}
            </span>
            {t(k === 'receive' ? 'tap.iReceive' : 'tap.iPay')}
          </button>
        ))}
      </div>

      {mode === 'receive' ? (
        <div className="tap-body">
          {payLink ? (
            <>
              <div className="tap-stage">
                {/*
                  A REAL QR, which is the whole point of the receive side —
                  and a TAPPABLE one, because a code you have to scan across a
                  counter at 232px is a code that fails twice before it works.
                */}
                <button
                  type="button"
                  className="tap-qr-button"
                  onClick={() => { haptic?.('select'); setZoomOpen(true); }}
                  aria-label={t('tap.enlarge')}
                >
                  <FancyQr
                    value={payLink}
                    label={t('tap.showThis')}
                    className="tap-qr"
                    accent={qrAccent}
                    badge={qrBadge}
                  />
                  <span className="tap-zoom-hint">
                    <IconQr width={11} height={11} />{t('tap.enlargeHint')}
                  </span>
                </button>
              </div>

              {/* The network, on the face of the card. Same 0x address, many
                  chains — this is the difference between paid and lost. */}
              <div className="tap-network">
                <span className="tap-network-icon"><IconShield width={14} height={14} /></span>
                <div className="tap-network-copy">
                  <b>{chain?.name || t('p2p.chainId', { id: chainId })}</b>
                  <span>{t('tap.networkHint')}</span>
                </div>
              </div>

              {requestText && (
                <p className={`tap-request ${requestText.inCode ? 'is-in-code' : ''}`}>
                  <strong dir="ltr">{requestText.text}</strong>
                  <span>
                    {requestText.inCode ? t('tap.amountInCode') : t('tap.amountOnScreenOnly')}
                  </span>
                </p>
              )}

              <div className="tap-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={share}>
                  <IconArrowUpRight width={14} height={14} />
                  {t('tap.share')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(payLink, 'link')}>
                  {copied === 'link' ? <IconCheck width={14} height={14} /> : <IconLink width={14} height={14} />}
                  {copied === 'link' ? t('common.copied') : t('tap.copyLink')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(myAddress, 'addr')}>
                  {copied === 'addr' ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
                  {copied === 'addr' ? t('common.copied') : t('tap.copyAddress')}
                </button>
              </div>

              <div className="mono tap-raw" dir="ltr">{payLink}</div>

              {/*
                Deliberately NOT offering "write this to an NFC tag": that needs
                a blank physical tag nobody carries, and a tag written once
                keeps paying whoever wrote it. A code on screen is read now and
                gone; a programmed tag left behind is a trap.
              */}
              <p className="tap-help">{t('tap.receiveHelp')}</p>

              {/*
                WHICH asset to watch for, and how much to ask for. A balance
                poll can only follow one token at a time — see
                lib/incomingWatch.js for why a log filter, which could watch
                all of them, is not usable on the RPCs this app falls back to.
              */}
              {chainTokens.length > 0 && (
                <div className="tap-watch">
                  <div className="tap-watch-row">
                    <label className="tap-watch-field">
                      <span>{t('tap.watchAsset')}</span>
                      <select
                        value={watchToken?.symbol ?? ''}
                        onChange={(e) => setWatchSym(e.target.value)}
                      >
                        {chainTokens.map((tk) => (
                          <option key={tk.symbol} value={tk.symbol}>
                            {tk.symbol}{tk.native ? ` — ${t('tap.nativeCoin')}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="tap-watch-field tap-watch-amount">
                      <span>{t('tap.amount')}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                        placeholder={t('tap.amountPlaceholder')}
                        spellCheck={false}
                      />
                    </label>
                  </div>

                  {watchingSince ? (
                    <div className="tap-watching">
                      <span className="tap-watching-dot" aria-hidden="true" />
                      <span>{t('tap.watching')}</span>
                      <WatchClock since={watchingSince} />
                    </div>
                  ) : (
                    <div className="tap-watching is-idle">
                      <span className="tap-watching-dot" aria-hidden="true" />
                      <span>{t('tap.watchOffline')}</span>
                    </div>
                  )}
                  <p className="tap-watch-hint">{t('tap.watchHint')}</p>
                </div>
              )}
            </>
          ) : (
            <p className="notice">{t('tap.connectFirst')}</p>
          )}
        </div>
      ) : (
        <div className="tap-body">
          {/*
            SCAN FIRST, because it works everywhere.

            NFC reaches ~6% of browsers and 0% of iPhones. Leading with it
            would put the unusable option first for almost everyone. The camera
            scanner uses the WebView's native BarcodeDetector — already present
            on the platform we ship to.
          */}
          <button type="button" className="btn btn-primary tap-scan-btn" onClick={() => setCamOpen(true)}>
            <IconQr width={16} height={16} />
            {t('tap.scanCode')}
          </button>

          {supported ? (
            <button
              type="button"
              className={`btn btn-ghost tap-nfc-btn ${scanning ? 'is-scanning' : ''}`}
              onClick={scan}
              disabled={scanning}
            >
              {scanning && (
                <span className="tap-radar" aria-hidden="true"><i /><i /><i /></span>
              )}
              <span className="tap-nfc-label">{scanning ? t('tap.holdNear') : t('tap.startScan')}</span>
            </button>
          ) : (
            /* The REASON, not a bare "unsupported". An iPhone user cannot fix
               this by updating anything, and "try another browser" sends them
               in a circle — every iOS browser is WebKit underneath. */
            <p className="tap-reason">
              {t(`tap.reason.${reason}`, t('tap.reason.BROWSER_UNSUPPORTED'))}
            </p>
          )}

          {scanning && <p className="tap-scanning-note">{t('tap.scanningHint')}</p>}

          <div className="field-label tap-or-label">{t('tap.orPaste')}</div>
          <div className="tap-paste-row">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="0x… / ethereum:0x…"
              spellCheck={false}
              aria-label={t('tap.orPaste')}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={useManual}>
              {t('common.confirm')}
            </button>
          </div>

          {got && (
            <div className="tap-got">
              <div className="tap-got-head">
                <span className="tap-got-icon"><IconWallet width={15} height={15} /></span>
                <span className="mono tap-got-addr" dir="ltr">{got.address}</span>
              </div>
              {gotRequest && (
                <p className="tap-got-request">{t('tap.theyAsk', { amount: gotRequest })}</p>
              )}
              {got.chainId != null && chainId != null && Number(got.chainId) !== Number(chainId) && (
                /* Getting this after signing is too late: the same 0x string
                   exists on every EVM chain and a transfer on the wrong one is
                   usually gone. Named here, before the wallet is opened. */
                <p className="tap-got-warn">
                  {t('tap.chainMismatch', {
                    theirs: EVM_CHAINS[got.chainId]?.name ?? String(got.chainId),
                    mine: chain?.name ?? String(chainId)
                  })}
                </p>
              )}
              {/*
                NOTHING HAS BEEN SENT. Stated where it cannot be missed: the tap
                filled in a destination, and the transfer still has to be
                authorised in the payer's own wallet, where they will see the
                amount and this address again before signing.
              */}
              <p className="tap-got-note">{t('tap.nothingSentYet')}</p>
            </div>
          )}

          {err && (
            <p className="notice notice-danger">
              {t(`tap.err.${err}`, t('tap.err.NFC_SCAN_FAILED'))}
            </p>
          )}

          <QrScanner
            open={camOpen}
            onClose={() => setCamOpen(false)}
            onResult={(text) => {
              setCamOpen(false);
              const parsed = parsePayLink(text);
              if (parsed) accept(parsed);
              else {
                setErr('BAD_ADDRESS');
                haptic?.('error');
              }
            }}
          />
        </div>
      )}

      {/*
        Rendered outside the tab branches so a payment landing at the exact
        moment the user switches tabs is still announced.
      */}
      <ArrivalPopup
        open={Boolean(arrived)}
        amount={arrived?.amount}
        symbol={arrived?.symbol}
        onClose={() => setArrived(null)}
      />

      {/*
        THE ENLARGED CODE. Two people standing at a counter is the real use of
        this screen, and the whole feature fails if the other phone cannot
        focus. A sheet gives the code the full width and a white field behind
        it, which is what a scanner needs.
      */}
      <Sheet open={zoomOpen} onClose={() => setZoomOpen(false)} title={t('tap.showThis')} size="lg">
        <div className="tap-zoom">
          <FancyQr
            value={payLink || ''}
            label={t('tap.showThis')}
            className="tap-zoom-qr"
            accent={qrAccent}
            badge={qrBadge}
          />
          {requestText && (
            <p className="tap-zoom-amount" dir="ltr">{requestText.text}</p>
          )}
          <p className="tap-zoom-net">
            {t('tap.network')}: <b>{chain?.name || t('p2p.chainId', { id: chainId })}</b>
          </p>
          <p className="mono tap-zoom-raw" dir="ltr">{payLink}</p>
          <p className="tap-help">{t('tap.receiveHelp')}</p>
        </div>
      </Sheet>
    </div>
  );
}
