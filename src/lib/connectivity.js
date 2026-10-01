/**
 * Read the browser's best available connection-quality hint.
 *
 * `navigator.onLine` is useful when it says `false`, but a value of `true`
 * only means the device has a network interface — it does not prove the app's
 * server is reachable. Network Information API hints are optional and mostly
 * available in Chromium; callers must keep working without them.
 */
export function classifyConnection(navigatorLike = typeof navigator !== 'undefined' ? navigator : null) {
  if (!navigatorLike) return 'online';
  if (navigatorLike.onLine === false) return 'offline';

  const connection = navigatorLike.connection
    || navigatorLike.mozConnection
    || navigatorLike.webkitConnection;
  if (!connection) return 'online';

  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'weak';

  const rtt = Number(connection.rtt);
  const downlink = Number(connection.downlink);
  if ((Number.isFinite(rtt) && rtt >= 1800)
    || (Number.isFinite(downlink) && downlink > 0 && downlink < 0.35)) {
    return 'weak';
  }

  return 'online';
}
