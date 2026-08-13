import { useCallback, useEffect, useRef, useState } from 'react';
import { shareLink } from '../lib/share';

/**
 * One hook for every "share this" button in the app.
 *
 * Returns `[share, sheetProps]`. Call `share({url, text})` directly from the
 * click handler and await its result. The promise resolves with `ok:true` only
 * after the OS accepts the share, or after the user performs a concrete action
 * in the fallback sheet. Merely opening either sheet is never success.
 *
 * ─── WHY shareLink IS CALLED BEFORE ANY await ───────────────────────────────
 * `navigator.share()` requires transient user activation. Awaiting anything
 * before it spends that activation and Safari rejects with NotAllowedError.
 */
export function useShare() {
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);

  const openFallback = useCallback(({ url, text, title }) => new Promise((resolve) => {
    const next = { url, text, title, resolve };
    pendingRef.current = next;
    setPending(next);
  }), []);

  const finishFallback = useCallback((result) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(result);
  }, []);

  const share = useCallback(({ url, text = '', title = 'FBT Swap' }) => {
    const args = { url, text, title };
    // Not awaited here on purpose: preserve the click's user activation.
    const nativeResult = shareLink(args);
    return nativeResult
      .then((result) => {
        if (!result.ok && result.reason === 'NO_NATIVE') return openFallback(args);
        return result;
      })
      .catch(() => openFallback(args));
  }, [openFallback]);

  /* Do not leave an awaiting caller hanging if its screen is unmounted. */
  useEffect(() => () => {
    const current = pendingRef.current;
    pendingRef.current = null;
    current?.resolve?.({ ok: false, via: 'none', reason: 'DISMISSED' });
  }, []);

  const sheetProps = {
    open: Boolean(pending),
    onClose: () => finishFallback({ ok: false, via: 'none', reason: 'DISMISSED' }),
    onShared: (result) => finishFallback(result),
    url: pending?.url ?? '',
    text: pending?.text ?? '',
    title: pending?.title
  };

  return [share, sheetProps];
}
