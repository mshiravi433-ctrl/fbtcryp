/**
 * FBT — POLLING WHILE THE TAB IS VISIBLE.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * A hidden tab is not a user. Every screen that polls the API used to keep
 * polling after the user switched away — a phone in a pocket, a desktop tab
 * behind an editor — and on a serverless host each tick is a function
 * invocation, i.e. a chance to pay a cold start plus the real CPU of the
 * handler. Measured on this app: one open Futures tab polled positions every
 * 10 s (8,640 calls/day), the AI control center every 30 s, the world console
 * every 60 s × seven endpoints. None of those answers were being read.
 *
 * WHAT IT DOES
 * `pollWhileVisible(callback, ms)` returns a cleanup function and behaves like
 * `setInterval(callback, ms)` with two differences:
 *
 *   · a tick whose tab is HIDDEN does nothing (and is not queued: the next
 *     tick happens at the normal cadence);
 *   · the moment the tab becomes VISIBLE again the callback runs immediately —
 *     so a user who comes back sees fresh data at once instead of waiting out
 *     the interval.
 *
 * THE VISIBILITY TEST IS DELIBERATELY `=== 'hidden'`
 * Background tabs in real browsers report exactly `'hidden'`. A test
 * environment (jsdom) reports `'prerender'` with `hidden === true`, and a
 * `document.hidden` check would silently stop every poll inside the vitest
 * suites — tests must observe the same behaviour as a user looking at the
 * screen. `'hidden'` is the one value that means "nobody is looking" in both
 * worlds.
 *
 * THE DOCUMENT IS READ ONCE, AT CREATION
 * `document` is captured when the poller is created rather than looked up on
 * every tick, so cleanup can never throw after the page is torn down and a
 * tick can never be judged against a different document than the listener
 * that woke it. In a browser the document is stable per window, so this is
 * exactly equivalent — and it makes the helper testable with a stand-in.
 *
 * This helper reads NO data and holds no state: it is a timer, nothing else.
 */

/** The document to judge against, or null outside a DOM. */
export function visibilityDocument() {
  return typeof document === 'undefined' ? null : document;
}

/** True only for the state a real browser calls "the user cannot see this". */
export function isPollHidden(doc = visibilityDocument()) {
  return Boolean(doc && doc.visibilityState === 'hidden');
}

/**
 * @param {() => void} callback runs on every visible tick, and immediately
 *        when the tab returns to the foreground.
 * @param {number} ms interval in milliseconds (unchanged while visible).
 * @returns {() => void} cleanup — clears the timer and the listener.
 */
export function pollWhileVisible(callback, ms) {
  const doc = visibilityDocument();
  const tick = () => {
    if (isPollHidden(doc)) return;
    try { callback(); } catch { /* a poll must never take the screen down */ }
  };
  const timer = setInterval(tick, ms);
  let onVisible = null;
  if (doc && typeof doc.addEventListener === 'function') {
    onVisible = () => {
      if (doc.visibilityState === 'visible') tick();
    };
    doc.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    clearInterval(timer);
    if (onVisible && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisible);
    }
  };
}

export default pollWhileVisible;
