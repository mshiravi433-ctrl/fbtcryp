/* eslint-env serviceworker */
/**
 * Service worker: push delivery + a minimal offline shell.
 *
 * Kept deliberately small. An over-eager cache in a market app is a bug
 * factory — showing yesterday's price as if it were live is worse than showing
 * nothing — so API responses are never cached here. Only the static shell is,
 * and even that is network-first so a deploy takes effect immediately.
 */

const SHELL = 'fbt-shell-v1';

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

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
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
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'fbt',
    data: { url: payload.url || '/' },
    vibrate: [40, 60, 40],
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
