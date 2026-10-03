/**
 * WHO GETS THE WELCOME FLOW, AND WHO GETS THE SEO PAGE.
 * ---------------------------------------------------------------------------
 *   «صفحهٔ خوش‌آمد فقط در اپ اندروید و در حالت «اپ» وب بماند. کاربری که با
 *    مرورگر دسکتاپ یا موبایل می‌آید نباید صفحهٔ خوش‌آمد را ببیند — باید برود
 *    به https://fbtswap.ir/decentralized-crypto-exchange تا گوگل آن را ایندکس
 *    کند.»
 *
 * ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
 * The bare web app opened with Splash → Welcome → Onboarding → Guide. To a
 * visitor who typed the domain, sent the link in a chat, or arrived from a
 * search result, that is a product asking them to set it up before it will say
 * what it is — and the guide is a HARD GATE, so a search engine's renderer sat
 * on an onboarding form instead of a page with a heading, a description and
 * internal links. Everything the site is good at (the landing library, the
 * thirteen programmatic pages, the bilingual super-landing) was reachable only
 * if the visitor first guessed that they should skip.
 *
 * ─── THE RULE, IN THE ORDER IT IS APPLIED ──────────────────────────────────
 *   1. NATIVE wins always. Inside the packaged app the welcome flow is the
 *      product: a fresh install has no context, and the four-part guide is a
 *      safety gate before real money moves. It is never redirected.
 *   2. An explicit `?app=1` (or `?welcome=1`) is honoured everywhere. This is
 *      the escape hatch the landing page's own CTAs and any future app-store
 *      link use, and it is what makes rule 4 safe: someone who WANTS the app
 *      front door always has one link that gives it to them.
 *   3. A RETURNING user is never redirected. `onboarded` is in the persisted
 *      settings store, so anyone who has already been through the flow lands
 *      in the app exactly as before. The app experience is not being removed;
 *      it is being reserved for people who asked for it.
 *   4. A DEEP LINK is never redirected. `#/swap`, `#/orders`, `#/intent`,
 *      `#/pay/…` are deliberate addresses — most of them written by the
 *      landing page itself. Only the bare front door (`/`, `/#`, `/#/`) is
 *      handed to the SEO page.
 *
 * Everything above is a pure function of (url, native, onboarded) so it can be
 * tested without a browser — because the failure mode of getting this wrong is
 * either "crawlers see an onboarding form" or "the mobile app opened on the
 * website", and neither shows up in a build.
 */

/** The page a first-time browser visitor is sent to instead of the app. */
export const SEO_LANDING_URL = 'https://fbtswap.ir/decentralized-crypto-exchange';

/** Both spellings force the app: `?app=1` for links, `?welcome=1` for reading. */
const FORCE_APP = /(?:^|[?&])(app|welcome)=1(?:&|$)/;

/** A hash route that is NOT the front door. `#/` and `#` are the front door. */
const ROOT_HASHES = new Set(['', '#', '#/', '#/?', '/']);

/**
 * Does this visit belong to the app, or to the SEO landing page?
 *
 * @param {object}  o
 * @param {string}  o.href      full `location.href`
 * @param {boolean} o.native    running inside the packaged Android app
 * @param {boolean} o.onboarded the persisted settings flag
 * @returns {string|null} the URL to replace this page with, or null to stay
 */
export function seoEntryRedirect({ href = '', native = false, onboarded = false } = {}) {
  if (native) return null;

  let url;
  try {
    url = new URL(href || 'https://fbtswap.ir/', 'https://fbtswap.ir/');
  } catch {
    return null;
  }

  const search = url.search || '';
  if (FORCE_APP.test(search)) return null;
  /* The hash can also carry it, for a link written as `/#/swap?app=1`. */
  if (FORCE_APP.test(url.hash || '')) return null;

  if (onboarded) return null;

  /*
   * The front door only. A hash of `#/swap` or `#/pay/CODE` is somebody's
   * destination, and the landing page's own buttons are written that way —
   * redirecting those back to the landing page would be a loop.
   */
  const hash = (url.hash || '').split('?')[0];
  if (!ROOT_HASHES.has(hash)) return null;

  return SEO_LANDING_URL;
}

/**
 * Read the persisted `onboarded` flag without importing the store.
 *
 * The store is a zustand `persist` instance over `fbt-settings-v1`; its blob is
 * `{ state: {...}, version }`. Reading the raw key here keeps this module free
 * of React and the whole settings graph, which matters because it runs BEFORE
 * the app's first commit — pulling the store in would put the entire settings
 * slice on the critical path of every cold start, including the native one
 * where the answer is ignored.
 *
 * Any failure (private mode, corrupted JSON, a renamed key) answers `false`,
 * which redirects. That is the deliberate direction: the cost of a wrong
 * redirect is one tap on a landing page that has a working «ورود به اپ» CTA,
 * and the cost of not redirecting is the search-visibility problem this whole
 * module exists to fix.
 */
export function isOnboardedFromStorage(storage) {
  try {
    const raw = storage?.getItem?.('fbt-settings-v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.state?.onboarded === true;
  } catch {
    return false;
  }
}

/**
 * The boot gate itself: decide, and (browser only) leave for the SEO page.
 *
 * Called ONCE, from a lazy `useState` initialiser in App, before <HashRouter>
 * exists — the same place and the same reason `normalizeColdStartRoute` runs
 * there: a route read after mount would flash the thing we are trying to stop
 * showing. Returns true when the document is already navigating away, so the
 * caller can render nothing instead of a splash nobody will see.
 */
export function seoEntryHandoff({ native, storage, location } = {}) {
  const win = typeof window !== 'undefined' ? window : null;
  const loc = location || win?.location;
  if (!loc) return false;
  const nativeShell = native ?? Boolean(win?.Capacitor?.isNativePlatform?.());
  const target = seoEntryRedirect({
    href: loc.href,
    native: nativeShell,
    onboarded: isOnboardedFromStorage(storage ?? win?.localStorage)
  });
  if (!target) return false;
  try {
    /* replace, not assign: the app root must not become a history entry the
       Back button walks into and gets redirected out of again. */
    loc.replace(target);
  } catch {
    /* A browser that refuses still renders the app, which is the old
       behaviour — never worse than it. */
    return false;
  }
  return true;
}
