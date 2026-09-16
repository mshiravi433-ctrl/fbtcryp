/* eslint-env serviceworker */
/**
 * Service worker: push delivery + a minimal offline shell.
 *
 * Kept deliberately small. An over-eager cache in a market app is a bug
 * factory — showing yesterday's price as if it were live is worse than showing
 * nothing — so API responses are never cached here. Only the static shell is,
 * and even that is network-first so a deploy takes effect immediately.
 */

/*
 * ─── THE VERSION SUFFIX IS LOAD-BEARING ─────────────────────────────────────
 * Bumped v3 -> v4 alongside the theme/header fixes. A v3 cache on an existing
 * install can be holding the previous deploy's index.html — and with it the
 * CSS that broke the black theme and oversized the header logo. Renaming the
 * cache is what evicts that stale HTML from every device already carrying it,
 * without waiting for each asset's own cache entry to expire. (This is the
 * same v2 -> v3 pattern: stale shell HTML names chunk files the server no
 * longer has, which lands the user on the crash screen.)
 *
 * Bump this whenever the shell caching strategy changes OR the shell itself
 * needs to be force-refreshed on every existing install. v4 -> v5: the
 * On-Chain futures chart fix shipped but installs that had cached a pre-fix
 * shell still drew the old "unavailable" chart — renaming the cache evicts
 * that shell on every existing device.
 *
 * v5 -> v6: the notification surface was rebuilt (monochrome brand badge,
 * colour icon, RTL-aware lang/dir, hash-route-aware click targets). The push
 * handler lives in THIS script, so every installed device keeps running the
 * OLD handler — old icon paths, old click routing — until the sw file itself
 * is refetched; renaming the shell cache is what forces that refresh on
 * next navigation, exactly like the stale-HTML evictions above.
 *
 * v6 -> v7: the WalletConnect deep-link fix (lib/wcDeepLink.js +
 * lib/wcAppKitPatch.js). Navigations are network-first here, but the cache
 * fallback above still serves a previously stored index.html — and that
 * document names the OLD hashed chunk, i.e. the code without the fix. A
 * device installed before this deploy can therefore keep reproducing «ارور
 * دیپ‌لینک» on a flaky connection until the cached shell is evicted; renaming
 * the cache is what evicts it, on the PWA and on an in-place APK update alike.
 *
 * v7 -> v8: the WalletConnect pairing surface moved INTO the app
 * (`showQrModal: false` + our own QR/deep-link sheet). Navigations are
 * network-first here, but the cache fallback still serves a previously stored
 * index.html — and that document names the OLD hashed chunk, i.e. the code
 * that still handed the last metre to the SDK's modal. An install from before
 * this deploy would keep reproducing «invalid deep link» / «the QR does
 * nothing» until its cached shell is evicted; renaming the cache evicts it on
 * the PWA and on an in-place APK update alike.
 *
 * v8 -> v9: the wallet hand-off stopped navigating this page away
 * (`window.open(url, '_self')` → a real `<a target="_blank">`, and
 * `openWalletLink()` refusing `_self`/`_top` outright), the SDK modal is the
 * pairing surface again, and the QR gained the spec's 4-module quiet zone.
 * `_self` is the exact mechanism behind «ارور دیپ‌لینک / وصل نمی‌شود»: it
 * replaced the dApp document mid-pairing, so the wallet's approval reached a
 * relay nobody was listening to. An install still holding the v8 shell keeps
 * that behaviour byte for byte until its cached shell is evicted — renaming
 * the cache is what evicts it, on the PWA and on an in-place APK update alike.
 *
 * v9 -> v10: wallet hand-off is now native-first. Trust/Uniswap universal
 * redirectors could open the app after dropping `uri=wc:…`, so users saw the
 * wallet home screen with no proposal. The web now uses native schemes and the
 * APK uses a package-scoped ACTION_VIEW bridge with the raw pairing URI.
 *
 * v10 -> v11: link.trustwallet.com stopped auto-redirecting into the app
 * (it is now a manual download page), so inside Telegram the wallet's own
 * scheme is delivered through a user-gesture window.open() — the delivery
 * Telegram clients actually hand to the OS — with the pairing URI
 * double-encoded on Android, and HTTPS openLink kept only as the last
 * fallback. (Shipped together with the email/social login bundle change.)
 *
 * v10 -> v11 (parallel branch): the zkSync Era + Scroll swap-fix deploy
 * («هیچ توکنی از این دو شبکه کار نمیده» — LI.FI quoting hardened: fee-gate
 * rejects now classify honestly instead of «مسیری بین این دو توکن وجود
 * ندارد», and mis-cased token addresses are normalised before li.quest ever
 * sees them). An install still holding the v10 shell names the OLD hashed
 * chunk, i.e. the code that kept answering «no route» on both chains; the
 * cache rename evicts it on the site and on an in-place APK update alike.
 *
 * v11 -> v12 -> v13: the two deploys above moved the shell name forward in
 * PARALLEL (v11 LI.FI on main, v12 wallet/email on the other branch). The
 * merged tree carries both fixes at once, so it takes a fresh name — v13 —
 * evicting installs pinned to v10, v11 or v12 alike.
 *
 * v13 -> v14: the email/social REDIRECT RETURN fix. The boot marker
 * (`fbt_email_social_connected`) used to be written only after an in-page
 * attach, so a mobile login that left the site for the OTP/OAuth step came
 * back to a fresh document with no reason to look for AppKit's warm session:
 * the wallet never attached until the user tapped a second time. It is now
 * claimed before the modal opens, and handed back by rollbackEmailSocialMarker
 * when the attempt ends with nothing to restore. That behaviour lives in the
 * shell bundle — and for this feature the shell is what decides whether a
 * returning page restores — so an install pinned to v13 keeps reproducing the
 * bug byte for byte. Renaming the cache evicts it on the site and on an
 * in-place APK update alike.
 *
 * v14 -> v15: the email/social session RESTORE was honest-ified (SDK login
 * marker re-armed before createAppKit, 30s window instead of 8s, timeout no
 * longer deletes the boot marker) and a returning page is now re-consulted on
 * pageshow/bfcache as well as on foreground. All of that lives in the shell
 * bundle, and a device pinned to the v14 shell keeps the exact restore path
 * that turned one slow boot into a permanent «کیف پول ساخته نشد» — the shell
 * cache is what decides which of the two a returning user runs. Renaming the
 * cache evicts it on the site and on an in-place APK update alike. (The
 * «بررسی سلامت اتصال» panel ships in the same bundle, so a stale shell would
 * also hide the report that measures the remaining last mile.)
 */
const SHELL = 'fbt-shell-v15';

/*
 * ─── PHASE 94: cachePolicyFor, PUBLIC PAGES ONLY ────────────────────────────
 * This mirrors `cachePolicyFor` in src/lib/intent-ai/offlineQueue.js. A service
 * worker is not part of the bundle graph — it cannot import an ES module that
 * pulls in failureModes.js and termsDiff.js — so the route list is repeated
 * here and the phase-94 probe asserts the two lists are identical. If somebody
 * adds a route to CACHEABLE_ROUTES and forgets this file, the suite fails.
 *
 * The rule the duplication protects: only public, non-personal, non-live pages
 * may be served from cache. A page that reflects a balance, a price, a session
 * or a receipt must hit the network or show nothing — a saved copy of somebody's
 * portfolio is a lie with a timestamp.
 */
const CACHEABLE_ROUTES = ['/', '/about', '/faq', '/terms', '/privacy', '/landing'];

function cachePolicyFor(route) {
  const path = String(route || '');
  const cacheable = CACHEABLE_ROUTES.includes(path) || path.startsWith('/landing');
  return {
    route: path,
    cacheable,
    reason: cacheable ? 'PUBLIC_STATIC' : 'PERSONAL_OR_LIVE',
    servesStalePrices: false
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/index.html']).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never serve market data or AI answers from cache.
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode !== 'navigate') return;

  /*
   * ─── ONLY A SUCCESSFUL RESPONSE MAY BE CACHED ───────────────────────────
   * This used to cache `res` unconditionally. A 404, a 502 or a captive
   * portal's login page would therefore be stored as the app shell and served
   * on every subsequent offline load -- turning one bad moment into a
   * permanently broken install.
   *
   * `res.ok` alone is not enough either: a redirect to a Wi-Fi login page is
   * a 200 with `type: 'opaqueredirect'` or a different URL, and caching that
   * as index.html is exactly how a captive portal bricks a PWA.
   */
  /*
   * Phase 94 — the public/personal split. Only a route `cachePolicyFor`
   * approves is ever WRITTEN to the cache. Everything else stays network-only
   * on the way in; on the way out it may still fall back to the app shell, so
   * a private route offline renders the empty shell (which then says it needs
   * a connection) rather than one person's stale account page.
   */
  const policy = cachePolicyFor(url.pathname);

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (policy.cacheable && res && res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => (policy.cacheable
        ? caches.match(request).then((r) => r ?? caches.match('/index.html'))
        : caches.match('/index.html')))
  );
});

/* ------------------------------ push ------------------------------------- */

/*
 * ─── PRESENTATION: THE SHADE IS A BRAND SURFACE ─────────────────────────────
 * «نوار نوتیفیکیشن موبایل باید مدرن باشد: لوگو، رنگ‌ها و تم درست». This handler
 * runs when the SITE is closed too — the service worker is woken by the push
 * service itself — so everything the notification needs must be resolvable
 * here, with no page alive:
 *
 *   icon   the colour brand mark on FBT black (public/notification/), not the
 *          generic launcher square; a payload may still override it.
 *   badge  the MONOCHROME mark — Chrome/Android silhouette the badge slot, so
 *          feeding it the colour artwork used to produce a white blob. The
 *          badge PNGs are generated by scripts/gen-notification-icons.mjs
 *          from the same geometry as the Android vector drawable.
 *   lang   Persian first: the shade renders the OS's font/shaping for the
 *          message language; 'fa' unless the server says otherwise.
 *   dir    resolved from lang, not 'auto' — 'auto' guesses per string and
 *          mixed bidi («BTC به ۶۵٬۰۰ رسید») renders ragged; an explicit rtl
 *          for Persian/Arabic keeps every row aligned the same way.
 */
const RTL_LANGS = ['fa', 'ar', 'ur', 'he', 'ckb', 'sd', 'ps'];
const dirFor = (lang) => (RTL_LANGS.includes(String(lang).split('-')[0]) ? 'rtl' : 'ltr');

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'FBT Swap', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'FBT Swap';
  const lang = payload.lang || 'fa';
  const vibrate = Array.isArray(payload.vibrate) && payload.vibrate.length
    ? payload.vibrate
    : [40, 60, 40];
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/notification/icon-color-192.png',
    badge: payload.badge || '/notification/badge-96.png',
    tag: payload.tag || 'fbt',
    lang,
    dir: payload.dir || dirFor(lang),
    data: { url: payload.url || '/', stage: payload.stage || '', color: payload.color || '' },
    vibrate,
    requireInteraction: payload.stage === 'ready'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data?.url || '/';
  /*
   * The app is a HashRouter SPA: its routes live AFTER '#', so navigating a
   * client to '/predict' lands on the home screen and silently drops the
   * deep link the notification promised. Absolute http(s) URLs (the native
   * app's public origin) pass through untouched; app paths get the hash.
   */
  const target = /^https?:\/\//.test(raw) || raw.startsWith('#')
    ? raw
    : `${self.location.origin}/#${raw.startsWith('/') ? raw : `/${raw}`}`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
