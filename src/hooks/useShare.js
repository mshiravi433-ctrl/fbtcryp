import { useCallback, useState } from 'react';
import { shareLink } from '../lib/share';

/**
 * One hook for every "share this" button in the app.
 *
 * Returns `[share, sheetProps]`. Call `share({url, text})` from a click
 * handler; spread `sheetProps` onto a <ShareSheet>. The sheet only ever opens
 * when the operating system declined to handle it, so on a phone the user gets
 * the native sheet and never sees ours.
 *
 * ─── WHY THE CALL MUST STAY INSIDE THE CLICK HANDLER ────────────────────────
 * `navigator.share()` requires transient user activation. Awaiting anything
 * before it — a fetch, a state update that yields — spends that activation and
 * the browser rejects with NotAllowedError. So `shareLink` is invoked
 * synchronously from the gesture and only the RESULT is awaited.
 */
export function useShare() {
  const [pending, setPending] = useState(null);

  const share = useCallback(({ url, text = '', title = 'FBT Swap' }) => {
    // Not awaited here on purpose: see the note above about user activation.
    const p = shareLink({ url, text, title });
    p.then((res) => {
      // Only fall back to our own list when nothing native handled it.
      // A dismissed OS sheet means the user said no, and popping a second
      // dialog after that is the behaviour people call "spammy".
      if (!res.ok && res.reason === 'NO_NATIVE') setPending({ url, text, title });
    }).catch(() => setPending({ url, text, title }));
    return p;
  }, []);

  const sheetProps = {
    open: Boolean(pending),
    onClose: () => setPending(null),
    url: pending?.url ?? '',
    text: pending?.text ?? '',
    title: pending?.title
  };

  return [share, sheetProps];
}
