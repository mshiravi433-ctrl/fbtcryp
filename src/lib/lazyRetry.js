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

/**
 * Delay between attempts. Short, because a person is waiting on this.
 *
 * It MULTIPLIES by the attempt number, so the second retry waits 700ms rather
 * than 350: a chunk that failed twice in a row is not failing for a reason a
 * third immediate request can beat, and two attempts 350ms apart are close
 * enough together to sit inside the same five-second hole in a mobile link.
 */
const RETRY_DELAY_MS = 350;

/**
 * How many times the import is attempted IN TOTAL, for one route.
 *
 * This used to be two (the import, then one cache-busted retry), and the report
 * that ended that is «فقط صفحهٔ هوش مصنوعی ارور میده… برنامه خودش یک‌بار رفرش
 * شد تا نسخهٔ جدید را بگیرد، ولی فایل‌های این صفحه دوباره دانلود نشد». /intent is
 * the heaviest route chunk in the build (≈1.4 MB of JS plus its own stylesheet),
 * which makes it the first page to lose a download to a link that drops for a
 * second — and the FIRST failure of a document is what RouteBoundary answers
 * with a whole-document reload. One more attempt inside the document is far
 * cheaper than that reload, and it is the only attempt a tab with no
 * connectivity can make without losing its state.
 */
const ATTEMPTS = 3;

/**
 * Attempts, unthrottled. On `saveData` the page is opened over a link the user
 * has already told us to be careful with, and re-downloading a megabyte three
 * times is somebody's data bundle; two attempts still covers the single drop
 * that causes most of these.
 */
function attemptsFor() {
  try {
    return navigator?.connection?.saveData ? 2 : ATTEMPTS;
  } catch {
    return ATTEMPTS;
  }
}

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
  const {
    load = (u) => import(/* @vite-ignore */ u),
    delay = RETRY_DELAY_MS,
    attempts = attemptsFor()
  } = opts;

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

      /*
       * Every attempt gets a DIFFERENT specifier, for the reason in the header:
       * the module map replays a rejection per URL, so a retry that reuses the
       * last attempt's URL is a guaranteed instant failure. That includes a
       * retry whose own URL carries an older timestamp — hence a fresh
       * `Date.now()` per attempt rather than once before the loop.
       *
       * A timestamp, not a fixed marker: `?retry=1` would itself be cached
       * after its first failure, so the second incident in the same session
       * would replay a cached rejection again — the exact bug, one layer down.
       */
      const total = Math.max(1, Number(attempts) || 1);
      let lastError = error;

      for (let attempt = 1; attempt < total; attempt += 1) {
        await new Promise((r) => setTimeout(r, delay * attempt));
        try {
          /*
           * Safari's wording sometimes has no URL to rewrite, and then the only
           * thing left to try is the original importer. It will usually hit the
           * poisoned entry and reject fast, which is not useless: the loop
           * still gives RouteBoundary a clean rejection instead of hanging.
           */
          if (!url) return await importer();
          const busted = new URL(url.href);
          busted.searchParams.set('t', String(Date.now()));
          return await load(busted.href);
        } catch (next) {
          /* A real crash stays a real crash, on the first attempt or the third. */
          if (!isLoadFailure(next)) throw next;
          lastError = next;
        }
      }

      throw lastError;
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
