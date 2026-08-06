import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import qrcode from 'qrcode-generator';
import SegIndicator from './SegIndicator';
import QrScanner from './QrScanner';
import ArrivalPopup from './ArrivalPopup';
import { IconCheck, IconCopy, IconQr, IconWallet } from './Icons';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import { watchIncoming } from '../lib/incomingWatch';
import { TOKENS } from '../lib/chains';
import {
  buildPayLink,
  nfcSupported,
  nfcUnavailableReason,
  parsePayLink,
  readNfcAddress
} from '../lib/tapToPay';

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
 * exists to eliminate. Meanwhile this repo already ships a QR GENERATOR
 * (ReceiveSheet) and a QR SCANNER (QrScanner, using the WebView's native
 * BarcodeDetector). Both were sitting unused while I told iPhone users, who
 * cannot use NFC at all, to "use the code" — a code I never rendered.
 *
 * Now: the receiving side shows a real scannable QR, and the paying side can
 * open the real camera scanner. NFC becomes what it always should have been —
 * a shortcut on the ~6% of browsers that have it, never the only route.
 */
export default function TapToPay({ onAddress }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const { address: myAddress, chainId, getReadProvider } = useWallet();

  const [mode, setMode] = useState('receive');
  const [scanning, setScanning] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [err, setErr] = useState(null);
  const [got, setGot] = useState(null);
  const [manual, setManual] = useState('');
  const [copied, setCopied] = useState(false);

  const [arrived, setArrived] = useState(null);
  const [watchSym, setWatchSym] = useState(null);

  const abortRef = useRef(null);

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
          onArrive: ({ amount, symbol }) => setArrived({ amount, symbol })
        });
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
   */
  const payLink = useMemo(() => {
    try {
      return myAddress ? buildPayLink(myAddress, chainId) : null;
    } catch {
      return null;
    }
  }, [myAddress, chainId]);

  /*
   * An SVG path, not a canvas — the same approach ReceiveSheet uses. It scales
   * to any size without blurring, and a blurry QR is a QR that does not scan
   * on the first try, which is the only try anyone gives it in a shop.
   */
  const qr = useMemo(() => {
    if (!payLink) return null;
    try {
      const q = qrcode(0, 'M');
      q.addData(payLink);
      q.make();
      const count = q.getModuleCount();
      let d = '';
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        }
      }
      return { d, count };
    } catch {
      // Never let a rendering failure hide the address text below it.
      return null;
    }
  }, [payLink]);

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

  const copy = async () => {
    if (!payLink) return;
    try {
      await navigator.clipboard.writeText(payLink);
      setCopied(true);
      haptic?.('success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the QR and the text are both still on screen */
    }
  };

  return (
    <div className="card card-soft">
      <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--rgb-2)', flexShrink: 0, marginTop: 1 }}>
          <IconQr width={19} height={19} />
        </span>
        <div>
          <strong style={{ fontSize: 14 }}>{t('tap.title')}</strong>
          <p className="muted" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.8 }}>
            {t('tap.intro')}
          </p>
          {/*
            Say outright whether NFC works on THIS device, as asked. Users
            should not have to switch to the pay tab and press a button to
            discover their phone cannot do it — and on iOS it never can.
          */}
          <p
            className="faint"
            style={{ fontSize: 11, marginTop: 6, lineHeight: 1.7 }}
          >
            {supported ? t('tap.nfcYes') : t('tap.nfcNo')}
          </p>
        </div>
      </div>

      {/*
        The REAL segmented control: `.segmented` + `.active` + <SegIndicator>.
        The previous `className="seg"` matched no stylesheet rule at all, which
        is why these rendered as small grey boxes with no active state.
      */}
      <div className="segmented" style={{ marginTop: 13 }}>
        {['receive', 'pay'].map((k) => (
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
            {t(k === 'receive' ? 'tap.iReceive' : 'tap.iPay')}
          </button>
        ))}
      </div>

      {mode === 'receive' ? (
        <div style={{ marginTop: 13 }}>
          {payLink ? (
            <>
              <div className="faint" style={{ textAlign: 'center' }}>{t('tap.showThis')}</div>

              {/*
                A REAL QR, which is the whole point of the receive side.

                It previously printed the link as text and asked the other
                person to read 42 characters off a screen — the exact
                transcription error this feature exists to prevent, and the
                thing an on-chain transfer cannot undo.

                White plate under the code on purpose: scanners need light
                modules on dark, and our dark theme would invert that and make
                it unreadable on many cameras.
              */}
              {qr && (
                <div
                  style={{
                    background: '#fff',
                    borderRadius: 14,
                    padding: 12,
                    width: 'fit-content',
                    margin: '11px auto 0'
                  }}
                >
                  <svg
                    viewBox={`0 0 ${qr.count} ${qr.count}`}
                    width={168}
                    height={168}
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label={t('tap.showThis')}
                  >
                    <path d={qr.d} fill="#000" />
                  </svg>
                </div>
              )}

              <div
                className="mono"
                style={{
                  fontSize: 11,
                  wordBreak: 'break-all',
                  marginTop: 10,
                  lineHeight: 1.7,
                  textAlign: 'center'
                }}
              >
                {payLink}
              </div>

              <button className="btn btn-ghost btn-sm" style={{ marginTop: 9 }} onClick={copy}>
                <span className="row" style={{ gap: 6, justifyContent: 'center' }}>
                  {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
                  {copied ? t('common.copied') : t('common.copy')}
                </span>
              </button>

              {/*
                Deliberately NOT offering "write this to an NFC tag": that needs
                a blank physical tag nobody carries, and a tag written once
                keeps paying whoever wrote it. A code on screen is read now and
                gone; a programmed tag left behind is a trap.
              */}
              <p className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.8 }}>
                {t('tap.receiveHelp')}
              </p>

              {/*
                WHICH asset to watch for. A balance poll can only follow one
                token at a time — see lib/incomingWatch.js for why a log
                filter, which could watch all of them, is not usable on the
                RPCs this app has to fall back to.
              */}
              {chainTokens.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="faint">{t('tap.watchAsset')}</div>
                  <select
                    value={watchToken?.symbol ?? ''}
                    onChange={(e) => setWatchSym(e.target.value)}
                    style={{ width: '100%', marginTop: 6 }}
                  >
                    {chainTokens.map((tk) => (
                      <option key={tk.symbol} value={tk.symbol}>
                        {tk.symbol} — {tk.name}
                      </option>
                    ))}
                  </select>
                  <div className="faint" style={{ fontSize: 11, marginTop: 7, lineHeight: 1.7 }}>
                    ● {t('tap.watching')} {t('tap.watchHint')}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="notice" style={{ marginTop: 4 }}>{t('tap.connectFirst')}</p>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 13 }}>
          {/*
            SCAN FIRST, because it works everywhere.

            NFC reaches ~6% of browsers and 0% of iPhones. Leading with it
            would put the unusable option first for almost everyone. The camera
            scanner uses the WebView's native BarcodeDetector — already present
            on the platform we ship to.
          */}
          <button className="btn btn-primary" onClick={() => setCamOpen(true)}>
            <span className="row" style={{ gap: 7, justifyContent: 'center' }}>
              <IconQr width={16} height={16} />
              {t('tap.scanCode')}
            </span>
          </button>

          {supported ? (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              onClick={scan}
              disabled={scanning}
            >
              {scanning ? t('tap.holdNear') : t('tap.startScan')}
            </button>
          ) : (
            /*
              The REASON, not a bare "unsupported". An iPhone user cannot fix
              this by updating anything, and "try another browser" sends them
              in a circle — every iOS browser is WebKit underneath. They need
              to be pointed at the scanner, which works perfectly.
            */
            <p className="muted" style={{ fontSize: 11, marginTop: 9, lineHeight: 1.8 }}>
              {t(`tap.reason.${reason}`, t('tap.reason.BROWSER_UNSUPPORTED'))}
            </p>
          )}

          <div className="field-label" style={{ marginTop: 13 }}>{t('tap.orPaste')}</div>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="0x… / ethereum:0x…"
              spellCheck={false}
              style={{ flex: 1 }}
            />
            <button className="btn btn-ghost btn-sm" onClick={useManual}>
              {t('common.confirm')}
            </button>
          </div>

          {got && (
            <div className="notice" style={{ marginTop: 11 }}>
              <span className="row" style={{ gap: 7 }}>
                <IconWallet width={15} height={15} />
                {t('tap.gotAddress', { addr: shortAddress(got.address) })}
              </span>
              {/*
                NOTHING HAS BEEN SENT. Stated where it cannot be missed: the tap
                filled in a destination, and the transfer still has to be
                authorised in the payer's own wallet, where they will see the
                amount and this address again before signing.
              */}
              <p className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.8 }}>
                {t('tap.nothingSentYet')}
              </p>
            </div>
          )}

          {err && (
            <p className="notice notice-danger" style={{ marginTop: 11 }}>
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
    </div>
  );
}
