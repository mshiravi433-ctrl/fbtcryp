import { lazy } from 'react';

/**
 * A LAZY IMPORT THAT SURVIVES ONE BAD MOMENT ON THE NETWORK.
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «باگ صفحه بازار وقتی میزنی روی یک کوین کرش میکنه و ارور میزنه، وقتی
 *    بازنشانی میکنی میره داخل و دیگه کرش نمیزنه»
 *
 * Tap a coin from the market list — crash. Reload the page, tap the same coin
 * — works, and keeps working. That "reload fixes it permanently" shape is the
 * entire diagnosis, because it rules out bad data and bad code: the coin, the
 * component and the API response are identical before and after.
 *
 * ─── WHAT IS ACTUALLY HAPPENING, PER THE HTML SPEC ──────────────────────────
 * Vite's own troubleshooting page states it plainly:
 *
 *   "Note that you cannot retry the dynamic import due to browser
 *    limitations (whatwg/html#6768)."
 *
 * The browser keeps a MODULE MAP, and it caches the RESULT of every dynamic
 * import — including a failure. Once `import('./pages/CoinDetail')` has
 * rejected once, every later call to that exact specifier returns the SAME
 * cached rejection, instantly, without touching the network. The module is
 * poisoned for the lifetime of the document.
 *
 * A reload builds a fresh module map, which is why reloading fixes it and why
 * it then never comes back.
 *
 * ─── AND WHY IT POISONS ITSELF WITHOUT THE USER DOING ANYTHING ──────────────
 * This is the uncomfortable part: our own prefetch is the most likely trigger.
 *
 * `prefetchLikelyRoutes()` in App.jsx warms five chunks during idle time,
 * CoinDetail among them, and swallows failures with `.catch(next)` so the
 * chain continues. That swallow is correct for the prefetch — a warm-up that
 * fails should be silent. But the failure is not silent in its effect: it
 * writes a rejection into the module map.
 *
 * So on a connection where the idle prefetch times out — which on an Iranian
 * mobile network is routine rather than exotic — an optimisation intended to
 * make the coin page FASTER instead makes it permanently BROKEN until reload.
 * The user never sees the prefetch fail. They only see the crash three
 * minutes later when they tap a coin.
 *
 * ─── THE FIX: A NEW SPECIFIER, WHICH IS A NEW MODULE-MAP ENTRY ──────────────
 * The map is keyed by resolved URL. Appending a unique query string produces a
 * key the map has never seen, so the browser is obliged to make a real request
 * instead of replaying the cached failure. This is the workaround the Vite
 * community converged on and the only one that works without a reload.
 *
 * ─── WHY RouteBoundary IS NOT ENOUGH ON ITS OWN ─────────────────────────────
 * It already catches this and reloads once, and it stays — it is the safety
 * net for the case where the chunk genuinely no longer exists after a deploy.
 * But a reload is a whole page: the market list refetches, scroll position is
 * lost, and the user watches the app restart. For a single dropped request
 * that is a sledgehammer. Retrying costs one silent request and the user sees
 * nothing but a slightly slower page open.
 *
 * Order matters: retry here first, reload only if retrying also fails.
 */

/** Delay between attempts. Short, because a person is waiting on this. */
const RETRY_DELAY_MS = 350;

/**
 * Is this the "module did not load" family, as opposed to a genuine crash
 * inside the module once it ran?
 *
 * The distinction is the whole safety property. Retrying a module that threw
 * a real TypeError during evaluation would run its side effects a second time
 * and still fail — burning a request and delaying the honest error screen.
 * Only transport failures are retried.
 */
function isLoadFailure(error) {
  const msg = String(error?.message ?? error ?? '');
  const name = String(error?.name ?? '');
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk/i.test(msg) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(msg)
  );
}

/**
 * Pull the failing URL out of the error message.
 *
 * Browsers put it there — "Failed to fetch dynamically imported module:
 * https://host/assets/CoinDetail-abc.js" — and it is the only handle we get on
 * the resolved URL from outside the import.
 *
 * Returns null when the message has no URL (Safari's wording sometimes
 * omits it), and the caller then falls back to re-running the original
 * importer. That second attempt will hit the poisoned cache entry and fail
 * fast, which is not useless: it hands a clean rejection to RouteBoundary
 * rather than hanging.
 */
function urlFromError(error) {
  const m = /https?:\/\/[^\s)'"]+/.exec(String(error?.message ?? ''));
  if (!m) return null;
  try {
    return new URL(m[0]);
  } catch {
    return null;
  }
}

/**
 * `React.lazy`, with one cache-busting retry.
 *
 * @param {() => Promise<{default: any}>} importer
 * @param {object} [opts]
 * @param {(u: string) => Promise<any>} [opts.load]  injected for tests —
 *        a bare `import(variable)` cannot be stubbed, and leaving the single
 *        most important line here unverifiable is not acceptable for code
 *        whose whole job is recovering from a failure.
 * @param {number} [opts.delay]
 */
export function retryImport(importer, opts = {}) {
  const { load = (u) => import(/* @vite-ignore */ u), delay = RETRY_DELAY_MS } = opts;

  return async () => {
    try {
      return await importer();
    } catch (error) {
      /*
       * A real error inside the module is rethrown immediately. Retrying it
       * would be slower AND wrong — the user waits an extra second to see the
       * same failure, and any top-level side effect in the module runs twice.
       */
      if (!isLoadFailure(error)) throw error;

      const url = urlFromError(error);
      if (!url) {
        await new Promise((r) => setTimeout(r, delay));
        return importer();
      }

      /*
       * A timestamp, not a fixed marker. A fixed `?retry=1` would itself be
       * cached after its first failure, so the second incident in the same
       * session would replay a cached rejection again — reintroducing the
       * exact bug one layer down.
       */
      url.searchParams.set('t', String(Date.now()));

      await new Promise((r) => setTimeout(r, delay));
      return load(url.href);
    }
  };
}

/**
 * Drop-in replacement for `React.lazy`.
 *
 * Deliberately the same shape, so converting a route is a one-word change and
 * nobody has to think about it. Routes that are NOT converted keep the old
 * behaviour, which is the reason a wiring check asserts every route uses this.
 */
export default function lazyRetry(importer, opts) {
  return lazy(retryImport(importer, opts));
}
