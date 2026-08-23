import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';

/**
 * QR SCANNER
 * ---------------------------------------------------------------------------
 * Typing a wallet address by hand is the single most dangerous thing this app
 * asks anyone to do. An address is 42 characters of hex with no checksum a
 * human can verify by eye, and on-chain transfers are irreversible — one wrong
 * character and the money is gone with no recourse. Scanning removes that
 * entire class of loss.
 *
 * WHY THERE IS NO QR LIBRARY HERE
 *
 * Every popular JS QR decoder is 40-90 KB and ships its own WASM or a large
 * lookup table. Android WebView (Chrome 83+) has `BarcodeDetector` built in,
 * natively, already optimised — so on the platform this app actually ships to,
 * a library would be dead weight duplicating an OS feature.
 *
 * Where BarcodeDetector is missing (older WebViews, desktop Firefox/Safari)
 * we do NOT silently fail and we do NOT pretend to scan. We say the device
 * cannot scan and fall back to paste, which is honest and still safe.
 *
 * CAMERA DISCIPLINE
 *  - `facingMode: environment` — the rear camera; the selfie camera cannot
 *    focus close enough to read a QR reliably.
 *  - The stream is stopped in every exit path. A camera light left on after
 *    the sheet closes reads as spyware, and on Android it blocks other apps
 *    from opening the camera at all.
 *  - Detection runs on requestAnimationFrame, not setInterval: rAF pauses when
 *    the tab is backgrounded, so we cannot keep decoding frames in the
 *    background.
 */

/** EIP-681 and the common wallet formats: ethereum:0xABC…@56?value=1 */
export function parseScanned(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  // Plain EVM address
  if (/^0x[a-fA-F0-9]{40}$/.test(text)) return { address: text, chainId: null, amount: null };

  // ethereum:0x…  |  ethereum:0x…@56  |  ethereum:pay-0x…@56?value=1e18
  const m = /^(?:ethereum|bnb|polygon|arbitrum|optimism|base|avalanche):(?:pay-)?(0x[a-fA-F0-9]{40})(?:@(\d+))?/i.exec(text);
  if (m) {
    let amount = null;
    try {
      const q = text.includes('?') ? new URLSearchParams(text.slice(text.indexOf('?') + 1)) : null;
      amount = q?.get('value') ?? q?.get('amount') ?? null;
    } catch {
      /* malformed query — the address is still usable */
    }
    return { address: m[1], chainId: m[2] ? Number(m[2]) : null, amount };
  }

  // Solana (base58, 32-44 chars) and Tron (T + 33 base58)
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(text)) return { address: text, chainId: null, amount: null };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return { address: text, chainId: null, amount: null };

  // A WalletConnect pairing URI is a completely different thing; surface it
  // as such rather than trying to read it as an address.
  if (/^wc:[0-9a-f]{64}@\d/i.test(text)) return { wc: text };

  return null;
}

/**
 * BITCOIN: BIP-21 and bare addresses.
 * ---------------------------------------------------------------------------
 * A SEPARATE parser rather than another branch inside `parseScanned`, and the
 * distinction matters:
 *
 *   • A bech32 bitcoin address contains characters (`0`, `b`) that the base58
 *     branch above excludes, so `parseScanned` correctly returns null for
 *     `bc1q…` today and the scanner says "not an address". Widening the shared
 *     parser would instead make the EVM Send sheet accept a bitcoin address
 *     into an 0x field — a silently wrong destination on an irreversible
 *     transfer, which is the exact failure mode this whole component exists to
 *     prevent.
 *
 *   • So the caller declares which chain it is scanning FOR (see the `parse`
 *     prop below) and gets a parser that can only produce that chain's shape.
 *
 * This is a SHAPE pre-filter, not a validator. The real mainnet checksum is
 * `btcAddressInfo` in lib/btcAddress.js, and the caller runs the result
 * through it exactly as if it had been typed by hand — scanning must not be a
 * way to bypass the validation the keyboard path enforces. Keeping the decoder
 * out of this file also keeps the bitcoin code out of every chunk that only
 * ever scans an 0x address.
 */
const BTC_SHAPE = /^(?:bc1[02-9ac-hj-np-z]{6,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i;

export function parseScannedBtc(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  // BIP-21: bitcoin:bc1q…?amount=0.01&label=…  (the scheme is case-insensitive)
  const uri = /^bitcoin:([^?#\s]+)/i.exec(text);
  const candidate = uri ? uri[1] : text.split('?')[0];
  if (!BTC_SHAPE.test(candidate)) return null;

  let amount = null;
  try {
    const q = text.includes('?') ? new URLSearchParams(text.slice(text.indexOf('?') + 1)) : null;
    const a = q?.get('amount');
    /* BIP-21 amounts are decimal BTC. Anything else is dropped rather than
       guessed at — a misread amount is a wrong payment. */
    if (a && /^\d{1,9}(\.\d{1,8})?$/.test(a)) amount = a;
  } catch {
    /* malformed query — the address is still usable */
  }

  return { address: candidate, amount };
}

/*
 * WHY BarcodeDetector IS NOT REQUIRED HERE ANY MORE.
 *
 * This used to demand `'BarcodeDetector' in window`. Android's WebView does
 * not ship that API, so inside the packaged app the scanner reported
 * UNSUPPORTED and never even reached getUserMedia — no camera prompt was ever
 * shown, and the sheet just sat there. Combined with CAMERA missing from the
 * manifest (now added), there were two independent reasons the scanner could
 * never work on the one platform it is most needed on.
 *
 * So BarcodeDetector is now an optimisation, not a requirement: we use it when
 * present (it is hardware-accelerated) and fall back to decoding frames with
 * jsQR, which is pure JS and runs anywhere a canvas does.
 *
 * The only hard requirement is a camera.
 */
export function scannerSupported() {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * @param {object}   props
 * @param {Function} [props.parse] — which chain's shape to accept. Defaults to
 *   the EVM/Solana/Tron parser, so every existing call site is unchanged; the
 *   bitcoin send sheet passes `parseScannedBtc`. A scanner that accepted every
 *   chain would hand an 0x field a bitcoin address.
 */
export default function QrScanner({ open, onClose, onResult, parse = parseScanned }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const [error, setError] = useState(null);
  /*
   * 'idle' → 'starting' (permission prompt / camera warm-up) → 'live'.
   *
   * Without this the <video> is on screen from the first frame with nothing in
   * it, which paints as a flat grey rectangle. On a fast phone that is 200ms
   * and nobody notices; on a cold camera it is two or three seconds of a grey
   * box with no explanation, which is indistinguishable from a broken scanner.
   */
  const [phase, setPhase] = useState('idle');

  /*
   * ─── THE GREY-CAMERA BUG ──────────────────────────────────────────────────
   * Reported: «گاهی تصویر طوسی نشون میده».
   *
   * The effect below listed `onClose` and `onResult` in its dependency array,
   * and BOTH call sites pass inline arrow functions:
   *
   *     <QrScanner onClose={() => setScanOpen(false)}
   *                onResult={(parsed) => { … }} />
   *
   * A new arrow function is a new object identity on every render. So the
   * effect re-ran on EVERY parent re-render — and its cleanup calls `stop()`,
   * which sets `video.srcObject = null` and stops the camera track. The camera
   * was then reopened from scratch, and during that gap the <video> element
   * has no source and paints its background: a grey rectangle.
   *
   * WHY IT WAS INTERMITTENT — the part that makes this hard to reproduce.
   * WalletContext polls the balance on a `setInterval(…, 30000)`, and each
   * poll sets state that re-renders every consumer, SendSheet included. So the
   * scanner was being torn down and rebuilt roughly every 30 seconds, plus
   * whenever anything else in the tree changed. If you scanned quickly you
   * never saw it. If you fumbled with the code for a moment, the camera died
   * under you.
   *
   * Restarting a camera is also not instant — getUserMedia re-negotiates with
   * the hardware — so each cycle was a visible half-second of grey, and on
   * some Android devices the second getUserMedia fails outright because the
   * first track has not fully released yet. That is the "sometimes it just
   * never comes back" version of the same fault.
   *
   * FIX: the callbacks go in refs. The effect now depends only on `open`, so
   * the camera starts once when the sheet opens and stops once when it closes.
   * A ref is the correct tool here precisely because we want the LATEST
   * callback without treating it as a reason to restart the hardware.
   */
  const onCloseRef = useRef(onClose);
  const parseRef = useRef(parse);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onCloseRef.current = onClose;
    parseRef.current = parse;
    onResultRef.current = onResult;
  });

  /** Release the camera. Safe to call repeatedly. */
  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    setError(null);
    setPhase('starting');

    if (!scannerSupported()) {
      setError('UNSUPPORTED');
      setPhase('idle');
      return undefined;
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        // The sheet may have closed while the permission prompt was open.
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // iOS Safari refuses to play an inline video without these.
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play();

        /*
         * Wait for real pixels before declaring the camera live.
         *
         * `play()` resolves as soon as playback is *scheduled*, not when a
         * frame exists — `videoWidth` is still 0 at that point. Hiding the
         * placeholder here would swap one grey box for another. readyState 2
         * (HAVE_CURRENT_DATA) is the first moment there is something to show.
         */
        if (video.readyState >= 2) {
          if (!cancelled) setPhase('live');
        } else {
          video.addEventListener(
            'loadeddata',
            () => {
              if (!cancelled) setPhase('live');
            },
            { once: true }
          );
        }

        /*
         * Native detector when the platform has one, jsQR otherwise. Chrome on
         * desktop and recent Android system WebViews expose BarcodeDetector and
         * decode on the GPU; the Capacitor WebView generally does not.
         */
        let detect;
        if ('BarcodeDetector' in window) {
          // eslint-disable-next-line no-undef
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          detect = async (video) => (await detector.detect(video))?.[0]?.rawValue;
        } else {
          const jsQR = (await import('jsqr')).default;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          detect = (video) => {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (!w || !h) return undefined; // first frames arrive before metadata
            /*
             * Downscale to at most 640px on the long edge. A full-resolution
             * frame is ~8 MP; scanning that in JS every frame pegs the CPU and
             * makes the preview stutter, which reads as a frozen camera. QR
             * decoding does not benefit from the extra pixels.
             */
            const scale = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return jsQR(img.data, img.width, img.height, {
              inversionAttempts: 'dontInvert'
            })?.data;
          };
        }

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const value = await detect(videoRef.current);
            if (value) {
              const parsed = parseRef.current(value);
              if (parsed) {
                stop();
                onResultRef.current?.(parsed, value);
                onCloseRef.current?.();
                return;
              }
              // Scanned something real, but not an address. Say so instead of
              // appearing frozen.
              setError('NOT_AN_ADDRESS');
            }
          } catch {
            /* a single dropped frame is not an error worth surfacing */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        // Distinguish "you said no" from "there is no camera" — the fixes differ.
        const name = e?.name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') setError('DENIED');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('NO_CAMERA');
        else setError('FAILED');
      }
    })();

    return () => {
      cancelled = true;
      setPhase('idle');
      stop();
    };
    /*
     * DEPENDENCIES: `open` only. `stop` is a useCallback with an empty dep
     * array so it is already stable, and the two callbacks are read through
     * refs above — see the long note at the top of this component for why
     * including them was the bug rather than the correctness fix it looks
     * like.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Belt and braces: also release on unmount, however that happens.
  useEffect(() => stop, [stop]);

  return (
    <Sheet open={open} onClose={onClose} title={t('scan.title')}>
      {error ? (
        <div style={{ padding: '6px 2px' }}>
          <p className="muted" style={{ fontSize: 12.6, lineHeight: 1.8 }}>
            {t(`scan.err.${error}`, { defaultValue: t('scan.err.FAILED') })}
          </p>
        </div>
      ) : (
        <>
          <div className="qr-frame" data-phase={phase}>
            <video ref={videoRef} className="qr-video" playsInline muted />

            {/*
              THE GREY RECTANGLE, EXPLAINED.
              A <video> with no frames yet paints its own background, and a
              flat grey box with a scanning reticle on it looks exactly like a
              broken camera. Until the first frame arrives this covers it with
              a spinner and a sentence, so the wait reads as "starting" rather
              than "failed" — the same reason the app boot screen exists.
            */}
            {phase !== 'live' && (
              <div className="qr-warming">
                <span className="qr-spin" aria-hidden="true" />
                <span>{t('scan.starting')}</span>
              </div>
            )}

            {/* Hidden until there is a picture to aim: brackets floating over
                a blank box imply the camera is running when it is not. */}
            {phase === 'live' && <div className="qr-reticle" aria-hidden="true" />}
          </div>
          <p className="faint" style={{ textAlign: 'center', marginTop: 10, lineHeight: 1.7 }}>
            {t('scan.hint')}
          </p>
        </>
      )}
    </Sheet>
  );
}
