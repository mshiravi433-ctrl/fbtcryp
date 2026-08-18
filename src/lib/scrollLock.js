/**
 * Lock body scroll WITHOUT shifting the layout, and WITHOUT the nesting bug.
 *
 * ─── WHY IT COMPENSATES FOR THE SCROLLBAR ──────────────────────────────────
 * `overflow: hidden` alone removes the scrollbar, and on desktop/Android
 * WebViews with a classic (non-overlay) scrollbar that reclaims ~15px of
 * width. Everything reflows sideways for the duration of the modal, which
 * reads as the whole UI twitching when you open the menu. Padding of exactly
 * the scrollbar width keeps the content box identical. Overlay scrollbars
 * report 0, so this is a no-op on iOS and most phones.
 *
 * ─── WHY IT COUNTS INSTEAD OF SAVING/RESTORING ─────────────────────────────
 * The previous version snapshotted `body.style.overflow` on lock and restored
 * that snapshot on unlock. With two overlapping modals — SendSheet opening
 * QrScanner, which really happens — the inner lock snapshots `'hidden'`
 * (the outer lock's value). If the unlocks then run in any order other than
 * strict reverse, the last one restores `'hidden'` and THE PAGE CAN NEVER
 * SCROLL AGAIN until reload.
 *
 * React does not guarantee unmount order between siblings, and an unmount
 * during an exit animation makes it less predictable still, so "just unlock in
 * the right order" is not something the callers can be relied on to do.
 *
 * A reference count removes the ordering requirement entirely: the lock is
 * applied when the count goes 0 → 1 and released when it returns to 0,
 * whatever sequence the unlocks arrive in. Each returned unlock is idempotent,
 * so a double-call (StrictMode double-invokes effects in development) cannot
 * drive the count negative.
 */

let locks = 0;
let restore = null;

function apply() {
  const { body, documentElement: html } = document;
  const prevOverflow = body.style.overflow;
  const prevPadding = body.style.paddingRight;

  const scrollbar = window.innerWidth - html.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

  restore = () => {
    body.style.overflow = prevOverflow;
    body.style.paddingRight = prevPadding;
  };
}

export function lockBodyScroll() {
  if (typeof document === 'undefined') return () => {};

  locks += 1;
  if (locks === 1) apply();

  let released = false;
  return () => {
    // Idempotent: StrictMode runs effect cleanups twice in development, and a
    // second call must not decrement the count a second time.
    if (released) return;
    released = true;

    locks = Math.max(0, locks - 1);
    if (locks === 0 && restore) {
      restore();
      restore = null;
    }
  };
}

/**
 * Force-release every lock.
 *
 * An escape hatch for the case a component unmounts without its cleanup
 * running (an error boundary catching a throw mid-render, for example). A
 * permanently unscrollable page is a much worse failure than an early
 * release, so the app calls this when an error boundary trips.
 */
export function releaseAllScrollLocks() {
  locks = 0;
  if (restore) {
    restore();
    restore = null;
  }
}

/**
 * Is ANY sheet/modal currently holding the body-scroll lock?
 *
 * Pull-to-refresh reads this so a downward drag that starts while a sheet
 * (WalletConnect's own included) is open cannot ALSO trigger a refresh
 * cycle underneath it — two competing gestures on top of each other is
 * exactly the kind of double-motion this whole audit was about removing.
 */
export function isScrollLocked() {
  return locks > 0;
}
