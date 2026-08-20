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
 * Bumped v2 -> v3 so the `activate` handler below deletes the old cache. A
 * v2 cache can be holding an index.html from a previous deploy, and that HTML
 * names chunk files (CoinDetail-<hash>.js) the server no longer has. Serving
 * it produces a 404 on the dynamic import, which throws past <Suspense> and
 * lands the user on the crash screen -- reported as «بعضی اوقات ... کرش
 * میکنه». Renaming the cache is what evicts that stale HTML from devices
 * already carrying it.
 *
 * Bump this whenever the shell caching strategy changes.
 */
const SHELL = 'fbt-shell-v3';

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
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request).then((r) => r ?? caches.match('/index.html')))
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
