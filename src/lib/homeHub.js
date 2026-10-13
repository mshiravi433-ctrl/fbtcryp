/**
 * The static home reference content stays below the web homepage after boot.
 * App-only hash routes and the packaged app must not acquire a long marketing
 * footer. This follows the URL/platform, never the visitor's user agent.
 * Returning home restores the same DOM node instead of deleting its content.
 */
export function syncHomeHubVisibility({ document: doc, location, native = false } = {}) {
  const hub = doc?.getElementById?.('home-hub');
  if (!hub) return null; // Source-only dev and app test harnesses have no hub.
  const pathname = location?.pathname || '/';
  const route = (location?.hash || '').replace(/^#/, '').split('?')[0];
  const home = (pathname === '/' || pathname === '/index.html') && (route === '' || route === '/');
  hub.hidden = native || !home;
  return !hub.hidden;
}
