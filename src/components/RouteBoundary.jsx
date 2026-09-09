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
 * It is guarded so it happens AT MOST ONCE per incident. Without that, a
 * genuine bug in a page would reload → throw → reload forever, which is far
 * worse than an error screen: the user cannot even read what went wrong or
 * navigate away. On the second failure we stop and show a real message with a
 * way out.
 *
 * ─── AND THE GUARD ITSELF USED TO BE THE BUG ────────────────────────────────
 *   «صفحه کیف پول قاطی زده. میزنه «نسخه جدید منتشر شد»، رفرش میشه، دوباره
 *    همین پیام — همش پشت سرهم»
 *
 * The guard used to be a boolean flag: set before reloading, and CLEARED IN
 * `componentDidMount` when "the route rendered successfully". For a lazy route
 * that read is wrong, and the wrongness is the loop:
 *
 *     boundary mounts → the chunk is still PENDING, so no error yet
 *                     → componentDidMount clears the flag
 *                     → the import rejects a moment later
 *                     → flag is clear, so this looks like a FIRST failure
 *                     → reload → same route (HashRouter keeps the hash)
 *                     → mount clears the flag again → …
 *
 * Mounting the box around a route is not the route having painted. Whenever the
 * thing that failed is still failed after the reload — a CDN still serving the
 * previous index.html, an offline device whose service worker hands back the
 * cached shell — every document load refreshed once, forever, with a screen
 * that promised "a new version shipped, one refresh fixes it". The promise was
 * the loop.
 *
 * So the record is now (a) keyed by ROUTE, (b) time-boxed, and (c) cleared by
 * the one thing that actually proves the route painted: an effect in a
 * component that cannot mount until the lazy subtree resolves, because it sits
 * INSIDE the Suspense boundary (App.jsx, `RoutePaintProbe`).
 *
 * `test/stale-chunk-loop-probe.jsx` reproduces this by simulating whole
 * DOCUMENT loads against one sessionStorage — the existing coindetail case
 * could not: it throws during the boundary's first render, so the boundary
 * never commits, `componentDidMount` never runs, and the flaw hid.
 *
 * ─── AND WHY THE FALLBACK IS NOT THE FULL-SCREEN BOOT ERROR ────────────────
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

/**
 * Recognise the "chunk did not load" family across browsers.
 *
 * The `Unable to preload CSS` case is the same deploy renamed the files under a
 * live tab, one asset over: Vite gives a lazy route its stylesheet as a
 * separate chunk, and a 404 on that link rejects the import too. It belongs
 * here — a reload is the exact fix — and deliberately NOT in
 * `lib/lazyRetry.js`'s matcher, because the only handle retryImport gets on the
 * failing file is the URL inside the message, and re-`import()`ing a .css URL
 * as a module cannot ever succeed. One layer, one kind of retry.
 */
function isChunkLoadError(error) {
  const msg = String(error?.message ?? error ?? '');
  const name = String(error?.name ?? '');
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Unable to preload CSS/i.test(msg) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(msg)
  );
}

/* --------------------------- the one-shot record -------------------------- */

/**
 * Per-route record of "this route was auto-reloaded because its chunk
 * would not load", as JSON `{ "/wallet": 1717000000000 }`.
 *
 * A BOOLEAN IS NOT A LOOP GUARD. That is the whole lesson of the wallet-page
 * refresh cycle, documented above: a single bit cannot express "we already
 * spent the automatic reload ON THIS ROUTE", so either it is cleared too
 * eagerly (a loop) or too late (a screen the user cannot get past for the rest
 * of the session). Keying it by route fixes both at once, and lets one broken
 * page keep its reload budget without spending every other page's.
 */
const RELOAD_RECORD = 'fbt:chunk-reload';

/**
 * How long a reload record keeps disarming the automatic reload for the SAME
 * route.
 *
 * Two minutes is longer than any reload round trip and shorter than a user
 * giving up on the app. It is a debounce on the failure, not a sentence: a
 * route that works and then breaks an hour later is a new incident and gets a
 * new automatic reload. Clearing on paint (see RoutePaintProbe in App.jsx) is
 * what ends an incident early; this window is only the backstop for
 * environments where nothing ever paints.
 */
const INCIDENT_WINDOW_MS = 120_000;

/**
 * The map `{ "/wallet": 1717000000000 }`, or null when storage cannot be read.
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
 * Unreadable storage fails CLOSED in the direction that CANNOT loop: null means
 * "assume a reload just happened", which costs a visible error screen; the
 * alternative costs the user any way out at all.
 *
 * Anything that does not parse as an object — including the bare "1" a build
 * from before this format wrote — reads as an empty record, i.e. "no route has
 * spent its reload". That is safe rather than merely convenient: the first
 * failure WRITES a proper record before it reloads, so a legacy value cannot
 * survive into the second document, and the worst a stale "1" can cost is the
 * one automatic reload this file exists to grant.
 */
function readRecord() {
  try {
    const parsed = JSON.parse(window.sessionStorage?.getItem(RELOAD_RECORD) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
}

/*
 * Written back whole, one JSON blob, a dozen bytes per route visited. No
 * pruning and no cap: the record cannot outgrow the number of routes the app
 * has, it lives in sessionStorage so a new tab starts clean, and the lines
 * either would cost more shipped bytes than they save.
 */
function writeRecord(record) {
  try {
    if (Object.keys(record).length) window.sessionStorage?.setItem(RELOAD_RECORD, JSON.stringify(record));
    else window.sessionStorage?.removeItem(RELOAD_RECORD);
  } catch {
    /* private mode: the time window still bounds this load, which is the loop */
  }
}

/**
 * Did an automatic reload already happen for this route, recently enough that
 * doing it again would be the refresh cycle rather than the fix?
 */
function reloadAlreadySpent(route) {
  const record = readRecord();
  /*
   * No record we can read means no record we can WRITE (private mode refuses
   * both), which means nothing would survive the reload — so this is the one
   * case where failing open is the dangerous direction: an unspendable budget
   * is an infinite one. Refuse, and let the user press the button instead.
   */
  if (!record) return true;
  const at = record[route];
  return typeof at === 'number' && Date.now() - at < INCIDENT_WINDOW_MS;
}

function markReloadSpent(route) {
  writeRecord({ ...(readRecord() ?? {}), [route]: Date.now() });
}

/**
 * The route painted. Its reload budget is live again.
 *
 * This is the signal that replaces `componentDidMount`, and the difference
 * between the two IS the bug: `componentDidMount` on this boundary fires while
 * the chunk is still in flight, which disarmed the guard milliseconds before
 * the failure that needed catching. App.jsx calls this from an effect that
 * cannot run until the lazy subtree has actually rendered.
 *
 * Exported because the caller lives in App.jsx (it has to sit inside the
 * Suspense boundary), and covered by test/stale-chunk-loop-probe.jsx §3.
 */
export function noteRoutePainted(route) {
  const record = readRecord();
  if (!record || !(route in record)) return;
  const next = { ...record };
  delete next[route];
  writeRecord(next);
}

/**
 * Which route the guard is talking about, for a caller that did not thread a
 * `route` prop through. The app is a HashRouter, so the hash IS the route, and
 * a reload preserves it — which is exactly why the record keys on it: a reload
 * lands back on the route that just failed.
 */
function currentRoute() {
  try {
    return String(window.location?.hash || '#/').slice(1).split('?')[0] || '/';
  } catch {
    return '/';
  }
}

/* ---------------------------- the cache eviction --------------------------- */

/**
 * Drop the cached app shell before the reload, so the next document cannot be
 * handed the same stale index.html.
 *
 * Nothing here unregisters or updates the service worker, and that is a
 * decision rather than an omission: a PushSubscription is owned by the
 * registration, so `unregister()` would silently cost push to a user who
 * turned it on, in exchange for a page load. And `update()` is redundant — a
 * reload IS a navigation, which is when the browser byte-compares `/sw.js` by
 * itself, and `public/sw.js` calls skipWaiting() + clients.claim(), so the new
 * worker takes over on the load we are about to make. Deleting the cache is the
 * only lever the shell actually needs, so it is the only one pulled.
 *
 * Fire-and-forget: a reload is already on its way and this must not delay it.
 */
function evictStaleShell() {
  try {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
  } catch {
    /* no Cache Storage (older WebKit, some WebViews); the reload is still worth doing */
  }
}

export default class RouteBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    /*
     * See `planFor`: one decision per error object, shared by the screen and
     * by the reload, because the record it reads expires on purpose.
     */
    this.reloadPlan = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  /** The route this instance guards: the prop App passes, else the hash. */
  get route() {
    return this.props.route ?? currentRoute();
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

    /*
     * ONE automatic reload per route per incident, answered by the SAME
     * `planFor` call that drew the screen — two answers would mean the commit
     * and the paint could disagree, and both of this file's shipped failures
     * were exactly that disagreement: alarming text for a problem that was
     * fixing itself, or a spinner for one that was not.
     *
     * The line used to read `if (flagIsSet()) return;` against a boolean that
     * this class's own componentDidMount kept clearing — see the header note
     * for why that is a refresh loop and not a guard.
     */
    if (!this.planFor(error).coming) return;
    markReloadSpent(this.route);

    evictStaleShell();

    /*
     * A short delay so the cache deletion has a chance to start and so a
     * reload storm is impossible even if something re-mounts us immediately.
     */
    const reload = this.props.reload ?? defaultReload;
    setTimeout(reload, 120);
  }

  /*
   * Deliberately NO componentDidMount here.
   *
   * There used to be one, clearing the one-shot flag "once a route has rendered
   * successfully". Mounting this boundary does not mean the route rendered —
   * with a lazy child the mount commit happens while the chunk is still
   * pending, so that effect fired milliseconds BEFORE the failure it was meant
   * to follow, and disarmed the guard for the reload it was meant to prevent.
   *
   * The success signal lives where it can only mean what it says:
   * `noteRoutePainted`, called from inside the Suspense subtree (App.jsx).
   */

  reloadNow = () => {
    /*
     * A reload the user asked for outranks the automatic loop guard, because it
     * cannot fire on its own: freeing THIS route's budget is what lets the
     * attempt behave like a first failure. It stays bounded — a human has to
     * press it again — and `noteRoutePainted` is the same call the successful
     * paint makes, so there is no second clear-path to get wrong.
     */
    noteRoutePainted(this.route);
    evictStaleShell();
    const reload = this.props.reload ?? defaultReload;
    reload();
  };

  /**
   * The one answer this error gets: reload, or explain. Computed the first
   * time the error is seen and reused for every later render of it, so render
   * and componentDidCatch cannot diverge.
   *
   * ASKED DURING RENDER, on purpose. It used to be a `this.reloading` field
   * written inside `componentDidCatch` — and React commits, PAINTS, and only
   * then calls componentDidCatch, so the first paint after a stale chunk carried
   * `reloading === false` and drew the full-screen «نسخه جدید منتشر شد» for the
   * ~120ms before the reload. That flash is the «پیام میاد و بعد رفرش میشه»
   * from the report, on a problem that was already fixing itself.
   *
   * Memoised per error rather than re-derived, because the record this reads
   * EXPIRES on purpose: re-deriving it would let two idle minutes plus a theme
   * toggle turn the readable screen into a spinner waiting on a reload nobody
   * scheduled — or schedule one behind the user's back. A new error object IS a
   * new incident and gets a fresh look, which is what the budget is for.
   */
  planFor(error) {
    if (this.reloadPlan?.error !== error) {
      this.reloadPlan = {
        error,
        coming: isChunkLoadError(error) && !reloadAlreadySpent(this.route)
      };
    }
    return this.reloadPlan;
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    /* A reload is on its way: say nothing, and let the reload say the rest. */
    if (this.planFor(error).coming) {
      return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '55vh' }}>
          <div className="spinner" />
        </div>
      );
    }

    /*
     * Reaching here with a CHUNK error means the automatic reload has already
     * been spent. The copy used to be part of the harm: «نسخه جدید منتشر شد…
     * یک‌بار تازه‌سازی نسخه جدید را می‌آورد» reads as "one refresh fixes this",
     * which is true exactly the first time. Saying it while NOT refreshing is a
     * lie, and a user who has just watched three refreshes does not believe it.
     * So this screen says what already happened instead of promising it again.
     */
    const chunk = isChunkLoadError(error);

    const { t } = this.props;

    return (
      <div style={{ minHeight: '55vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div style={{ maxWidth: 340, textAlign: 'center' }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 8 }}>
            {t(chunk ? 'crash.stillBrokenTitle' : 'crash.title')}
          </div>
          <p className="prose-sm" style={{ textAlign: 'center' }}>
            {t(chunk ? 'crash.stillBrokenBody' : 'crash.body')}
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
            {chunk ? (
              /*
               * A chunk that will not load CANNOT be fixed by re-rendering.
               * React.lazy remembers that its import rejected and replays the
               * rejection for the life of the document, so the old
               * `setState({ error: null })` here did not retry anything: it
               * re-rendered the same poisoned lazy component, threw again, and
               * put this screen back — one more step in the "same message over
               * and over" the user reported. Reloading is the only retry that
               * exists, and `lib/lazyRetry.js` already spent the in-document
               * one (a cache-busted URL) before the error ever reached here.
               */
              <button className="btn btn-ghost" onClick={this.reloadNow}>
                {t('common.retry')}
              </button>
            ) : (
              /*
                "Try again" clears the boundary WITHOUT a reload, so a transient
                failure costs nothing. It is first because it is the cheapest
                recovery.
              */
              <button className="btn btn-ghost" onClick={() => this.setState({ error: null })}>
                {t('common.retry')}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                /*
                 * Reload to the HOME route, not the current one. The app is a
                 * HashRouter, so reloading on #/coin/xyz goes straight back
                 * to the screen that just threw — the exact loop that made
                 * the old boot error unrecoverable.
                 */
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
