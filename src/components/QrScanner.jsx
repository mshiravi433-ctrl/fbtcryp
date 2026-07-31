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

export default function QrScanner({ open, onClose, onResult }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const [error, setError] = useState(null);

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

    if (!scannerSupported()) {
      setError('UNSUPPORTED');
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
              const parsed = parseScanned(value);
              if (parsed) {
                stop();
                onResult?.(parsed, value);
                onClose?.();
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
      stop();
    };
  }, [open, onClose, onResult, stop]);

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
          <div className="qr-frame">
            <video ref={videoRef} className="qr-video" playsInline muted />
            <div className="qr-reticle" aria-hidden="true" />
          </div>
          <p className="faint" style={{ textAlign: 'center', marginTop: 10, lineHeight: 1.7 }}>
            {t('scan.hint')}
          </p>
        </>
      )}
    </Sheet>
  );
}
