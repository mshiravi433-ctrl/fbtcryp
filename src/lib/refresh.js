/**
 * SAFE REFRESH — one contract, two levels.
 * ---------------------------------------------------------------------------
 * Before this module there was no way to refresh the app on Android: the
 * Capacitor WebView has no pull-down, no F5, and no reload button, and any
 * scattered `location.reload()` would have been a scatter of hazards — a
 * reload during WalletConnect pairing drops the pairing, a reload mid-signature
 * leaves the user unsure whether they signed, and an unguarded reload can loop
 * (the stale-chunk loop is documented in RouteBoundary.jsx).
 *
 * ─── SOFT REFRESH (the default, what the header button does) ───────────────
 * Re-fetches the app's DATA without reloading the WebView. Subscribers are:
 *
 *   • every `usePoll` hook (markets, global stats, prices…)
 *   • the News screen (headlines)
 *   • the Calm panel (music)
 *   • the wallet layer (native balance)
 *
 * Along the way the in-memory API memo (lib/api.js) is invalidated so caches
 * that pinned a failure — an empty coin list fetched during a rate-limit
 * burst, an aborted Calm payload — are forced to retry against the network.
 *
 * A soft refresh therefore CANNOT:
 *   • disconnect WalletConnect (no reload, no new SignClient)
 *   • remount WalletProvider (React tree untouched)
 *   • touch localStorage/sessionStorage
 *   • lose the route, language, theme or scroll position of the page shell
 *
 * ─── HARD REFRESH (export kept for recovery paths, not wired to a button) ──
 * `hardReload()` is the guarded variant of `window.location.reload()`:
 * refused outright while a guard is held (connecting, signing, submitting),
 * one-shot per incident via a sessionStorage flag, and never clearing any
 * storage — the WalletConnect session, the encrypted local wallet, language
 * and theme all live there and survive a reload intact. The route survives
 * through location.hash (the app is a HashRouter), which is exactly why the
 * flag and the hash are handled BEFORE `reload()` is called.
 *
 * ─── GUARDS ────────────────────────────────────────────────────────────────
 * `holdRefreshGuard(name)` / `releaseRefreshGuard(token)` bracket a sensitive
 * operation. While any guard is held, `requestSoftRefresh()` is a no-op that
 * resolves `false` and `hardReload()` refuses. The header button disables
 * itself on the same signal, so the user sees *why* nothing happened rather
 * than a button that swallowed their tap.
 *
 * The wallet connect flow holds a guard, and Swap holds one across the
 * 'preparing…pending' transaction stages. A refresh that cannot start cannot
 * strand a session or a signature.
 */

const listeners = new Set();
const changeListeners = new Set();

/* Single-flight: N taps on a spinning button must still mean ONE cycle. */
let inFlight = null;
let version = 0;

/* Named guards (connect / sign / submit). Names exist only for debugging. */
const guards = new Map();
let guardSeq = 0;

function emitChange() {
  version += 1;
  for (const fn of [...changeListeners]) {
    try { fn(version); } catch { /* a dead listener must not break refresh */ }
  }
}

/** Subscribe to busy state. Returns unsubscribe. */
export function onRefreshStateChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function refreshStateVersion() {
  return version;
}

export function isRefreshing() {
  return inFlight != null;
}

/** True while ANY sensitive action (connect, sign, submit) is in flight. */
export function refreshBlocked() {
  return guards.size > 0;
}

/** Names of the guards currently held — diagnostics only. */
export function refreshGuardNames() {
  return [...guards.values()];
}

/**
 * Hold a guard. Returns a token for releaseRefreshGuard(). While the request
 * app is being signed or a wallet is pairing, refresh must not fire.
 */
export function holdRefreshGuard(name = 'action') {
  const token = `g${++guardSeq}`;
  guards.set(token, String(name).slice(0, 32));
  emitChange();
  let released = false;
  return {
    token,
    release() {
      if (released) return;
      released = true;
      if (guards.delete(token)) emitChange();
    }
  };
}

/**
 * Register a soft-refresh participant. `fn` may be async; all participants
 * are awaited with allSettled so one failed panel cannot veto the rest.
 * Returns the unsubscribe function.
 */
export function onSoftRefresh(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Run one soft-refresh cycle.
 *
 *  - resolves `false` immediately when a guard is held (and the caller —
 *    typically the header button — is disabled in that state anyway, so this
 *    is the belt to its braces)
 *  - single-flight: concurrent calls share the one in-flight cycle
 *  - resolves `true` when the cycle finished, however many subscribers failed
 *
 * `invalidateApiMemo` is injected by the caller (Header → lib/api) so this
 * module stays dependency-free and testable in a bare Node process.
 */
export async function requestSoftRefresh({ invalidate } = {}) {
  if (guards.size > 0) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    emitChange();
    try { invalidate?.(); } catch { /* cache invalidation must not veto */ }
    const fns = [...listeners];
    await Promise.allSettled(fns.map((fn) => Promise.resolve().then(fn)));
    return true;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
    emitChange();
  }
}

/* --------------------------- hard refresh (guarded) ---------------------- */

const HARD_RELOAD_FLAG = 'fbt:hard-reload';

function sessionFlagGet() {
  try { return window.sessionStorage?.getItem(HARD_RELOAD_FLAG) === '1'; } catch { return true; }
}
function sessionFlagSet(on) {
  try {
    if (on) window.sessionStorage?.setItem(HARD_RELOAD_FLAG, '1');
    else window.sessionStorage?.removeItem(HARD_RELOAD_FLAG);
  } catch { /* private mode — the loop guard above already failed closed */ }
}

/**
 * Guarded full reload. Exported for REAL recovery flows (a wedged WebView),
 * not bound to a user-visible button: soft refresh is the product feature.
 *
 *  - Refuses while a guard is held or a refresh is running → returns 'blocked'.
 *  - One shot per incident: if the flag is already set we refuse → 'refused'.
 *  - Clears the flag after the reload only once the app has painted again
 *    (main.jsx clears it on boot; see BOOT there).
 *  - Never touches localStorage or sessionStorage beyond the flag: the WC
 *    session, the encrypted vault and the theme/language all must survive.
 *  - The current route is in location.hash (HashRouter), and a reload keeps
 *    the URL — so nothing needs to be copied anywhere.
 */
export function hardReload() {
  if (guards.size > 0 || inFlight) return 'blocked';
  if (sessionFlagGet()) return 'refused';
  sessionFlagSet(true);
  try {
    window.location.reload();
  } catch {
    /* nothing further we can do */
  }
  return 'reloading';
}

/**
 * Called once the app has mounted after a reload — the loop guard has done
 * its job, so the next hard reload is legal again. Invoked from main.jsx.
 */
export function clearHardReloadFlag() {
  sessionFlagSet(false);
}
