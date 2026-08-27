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
 * needs to be force-refreshed on every existing install.
 */
const SHELL = 'fbt-shell-v4';

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

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'FBT Swap', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'FBT Swap';
  const vibrate = Array.isArray(payload.vibrate) && payload.vibrate.length
    ? payload.vibrate
    : [40, 60, 40];
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'fbt',
    data: { url: payload.url || '/', stage: payload.stage || '', color: payload.color || '' },
    vibrate,
    requireInteraction: payload.stage === 'ready',
    dir: 'auto'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
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
