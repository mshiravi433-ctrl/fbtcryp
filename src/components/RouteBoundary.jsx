import React from 'react';
import { releaseAllScrollLocks } from '../lib/scrollLock';

/**
 * ROUTE-LEVEL CRASH GUARD, and specifically the STALE-CHUNK recovery.
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «بعضی اوقات در هر کویین پایین صفحه که نوشته دیدن نمودار میزنم روش سایت
 *    کرش میکنه و میزنه مشکلی پیش اومده»
 *
 * Tapping "view chart" SOMETIMES lands on the unexpected-error screen. The
 * word doing the work is "sometimes".
 *
 * ─── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * It is not bad data. `test/coindetail-probe.jsx` mounts CoinDetail against
 * sixteen data shapes — flat series, one point, empty, nulls, zero prices, a
 * 429 rate-limit OBJECT where an array belongs, an HTML error string, rows
 * that are bare numbers, string-typed coin fields — in both chart modes, and
 * the page survives every one. That probe was sabotage-verified: introducing
 * a real throw produces 38 failures, so its silence means something.
 *
 * ─── WHAT IT ACTUALLY IS ────────────────────────────────────────────────────
 * Every route is `lazy()`, so opening /coin/:id triggers a NETWORK REQUEST for
 * `CoinDetail-<hash>.js`. If that request fails, the dynamic import rejects,
 * and a rejected lazy import throws during render — past `<Suspense>`, which
 * only handles pending, never failed — all the way up to BootBoundary. Which
 * is exactly the screen being reported.
 *
 * Three things make that request fail intermittently, and all three are live
 * here:
 *
 *   1. A DEPLOY WHILE THE TAB IS OPEN. Chunk filenames carry a content hash,
 *      so every deploy renames them. A tab opened before the deploy is still
 *      running the OLD index bundle, which asks for the OLD chunk name — now
 *      404. The user did nothing wrong and the app looks broken.
 *
 *      This got MORE likely with the cache fix in the previous commit, not
 *      less: index.html is now revalidated on every load while /assets is
 *      cached for a year, so a long-lived tab holds a stale module graph.
 *      That is still the right trade — the alternative pins people to old
 *      builds — but it needs this recovery to be safe.
 *
 *   2. THE SERVICE WORKER. `public/sw.js` serves `/index.html` from cache when
 *      the network fails. A user on a flaky connection can therefore be handed
 *      a cached HTML that names chunks the network cannot currently supply.
 *
 *   3. A DROPPED CONNECTION MID-FETCH, which on an Iranian mobile network is
 *      routine rather than exotic.
 *
 * ─── WHY RELOADING IS THE CORRECT FIX, ONCE ─────────────────────────────────
 * For a stale chunk the recovery is exact: reload, get the current
 * index.html (uncached), get the current chunk names, and the page works. The
 * user sees a flicker instead of an error.
 *
 * It is guarded by a sessionStorage flag so it happens AT MOST ONCE. Without
 * that, a genuine bug in a page would reload → throw → reload forever, which
 * is far worse than an error screen: the user cannot even read what went
 * wrong or navigate away. On the second failure we stop and show a real
 * message with a way out.
 *
 * ─── AND WHY THE FALLBACK IS NOT THE FULL-SCREEN BOOT ERROR ─────────────────
 * BootBoundary replaces the ENTIRE app, including the nav. One broken screen
 * should not take the header and bottom bar with it — the user should be able
 * to tap somewhere else and carry on. This boundary keeps the shell alive and
 * confines the failure to the routed area.
 */

/**
 * How the boundary reloads. Injectable so it can be observed in a test.
 *
 * jsdom refuses to redefine `window.location.reload` — it throws "Cannot
 * redefine property" — so a test literally cannot spy on a direct call. Rather
 * than leave the single most important behaviour here unverified, the action
 * is a prop with a real default. Production passes nothing and gets a genuine
 * reload; the probe passes a counter and can assert it fires exactly once.
 */
const defaultReload = () => {
  try {
    window.location.reload();
  } catch {
    /* nothing further we can do */
  }
};

/** Recognise the "chunk did not load" family across browsers. */
function isChunkLoadError(error) {
  const msg = String(error?.message ?? error ?? '');
  const name = String(error?.name ?? '');
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(msg)
  );
}

const RELOAD_FLAG = 'fbt:chunk-reload';

/**
 * sessionStorage, read defensively and via `window`.
 *
 * Two reasons this is not a bare `sessionStorage.x` call:
 *
 *   • Safari private mode throws on ACCESS, not just on write.
 *   • In the jsdom test harness `sessionStorage` exists on `window` but is
 *     not installed as a bare global, so an unqualified reference throws
 *     ReferenceError — which the catch below would then read as "already
 *     reloaded", silently disabling the one behaviour this class exists for.
 *     That is a fault that hides itself, which is the worst kind.
 *
 * Both helpers fail closed in the direction that CANNOT loop: if the flag
 * cannot be read we assume it is set, so we do not auto-reload. Refusing to
 * reload costs a visible error screen; reloading in a loop costs the user any
 * way out at all.
 */
function flagIsSet() {
  try {
    return window.sessionStorage?.getItem(RELOAD_FLAG) === '1';
  } catch {
    return true;
  }
}

function setFlag(on) {
  try {
    if (on) window.sessionStorage?.setItem(RELOAD_FLAG, '1');
    else window.sessionStorage?.removeItem(RELOAD_FLAG);
  } catch {
    /* ignore */
  }
}

export default class RouteBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    /*
     * Whether THIS instance has just scheduled a reload. Deliberately not
     * derived from the sessionStorage flag: the flag means "a reload already
     * happened at some point this session", which is a different question.
     *
     * Reading the flag to decide what to render was a real bug. On the SECOND
     * chunk failure the flag is still set, so the fallback rendered the quiet
     * spinner while no reload was coming — leaving the user staring at a
     * spinner forever, which is worse than the crash screen it replaced.
     */
    this.reloading = false;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    /*
     * A component that throws never runs its effect cleanups, so a sheet that
     * held a body-scroll lock would leave the page unscrollable — including
     * this fallback. Cheap to release, and prevents "frozen" on top of
     * "broken".
     */
    releaseAllScrollLocks();

    if (!isChunkLoadError(error)) return;

    if (flagIsSet()) return;
    setFlag(true);
    this.reloading = true;

    /*
     * Drop the service worker's cached shell before reloading. Case 2 above:
     * if sw.js is holding an index.html that names chunks the server no
     * longer has, reloading straight into it reproduces the same failure.
     */
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
      }
    } catch {
      /* not available everywhere; the reload is still worth doing */
    }

    /*
     * A short delay so the cache deletion has a chance to start and so a
     * reload storm is impossible even if something re-mounts us immediately.
     */
    const reload = this.props.reload ?? defaultReload;
    setTimeout(reload, 120);
  }

  /**
   * Clear the one-shot flag once a route has rendered successfully.
   *
   * Without this the guard is spent for the whole session: a chunk failure in
   * the morning would leave a genuine stale-chunk failure in the afternoon
   * with no automatic recovery. Resetting on success means "once per
   * incident" rather than "once per session".
   */
  componentDidMount() {
    if (!this.state.error) setFlag(false);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    /*
     * A chunk error on the first failure is about to reload. Showing an error
     * for the ~120ms before that would be a flash of alarming text for a
     * problem that is already fixing itself, so render the same quiet spinner
     * the route was showing anyway.
     */
    if (this.reloading) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '55vh' }}>
          <div className="spinner" />
        </div>
      );
    }

    const chunk = isChunkLoadError(error);
    const { t } = this.props;

    return (
      <div style={{ minHeight: '55vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 8 }}>
            {t(chunk ? 'crash.updateTitle' : 'crash.title')}
          </div>
          <p className="prose-sm" style={{ textAlign: 'center' }}>
            {t(chunk ? 'crash.updateBody' : 'crash.body')}
          </p>

          {/*
            The error text, small and selectable. On a phone there is no
            devtools console, so without this a bug report can only ever be
            "it broke" — which is unactionable.
          */}
          {!chunk && (
            <code
              style={{
                display: 'block',
                direction: 'ltr',
                fontSize: 10.5,
                color: 'var(--text-3)',
                margin: '12px 0',
                wordBreak: 'break-all'
              }}
            >
              {String(error?.message || error).slice(0, 200)}
            </code>
          )}

          <div className="row" style={{ gap: 9, marginTop: 14 }}>
            {/*
              "Try again" clears the boundary WITHOUT a reload, so a transient
              failure costs nothing. It is first because it is the cheapest
              recovery.
            */}
            <button className="btn btn-ghost" onClick={() => this.setState({ error: null })}>
              {t('common.retry')}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                /*
                 * Reload to the HOME route, not the current one. The app is a
                 * HashRouter, so reloading on #/coin/xyz goes straight back
                 * to the screen that just threw — the exact loop that made
                 * the old boot error unrecoverable.
                 */
                setFlag(false);
                window.location.hash = '#/';
                window.location.reload();
              }}
            >
              {t('crash.goHome')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
