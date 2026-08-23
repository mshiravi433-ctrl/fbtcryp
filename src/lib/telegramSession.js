/**
 * The ONE place the client reads a Telegram session from.
 *
 * `window.Telegram.WebApp.initData` is the signed login blob; the server
 * re-verifies its HMAC on every request (server/telegramAuth.js), so this
 * module is a transport detail, not a trust decision. Two rules:
 *
 *   1. Never send `initDataUnsafe`. It is the same data WITHOUT the signature,
 *      which makes it attacker-controlled; it is fine for painting a name on
 *      screen and useless for authorising anything.
 *   2. Absence is a first-class state. Outside Telegram there is no session
 *      and the UI must say so instead of firing requests that will 401.
 */

export const telegramInitData = () => {
  const value = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const hasTelegramSession = () => Boolean(telegramInitData());

/** Headers for an authenticated call, or `null` when there is no session. */
export function telegramAuthHeaders(extra = {}) {
  const initData = telegramInitData();
  if (!initData) return null;
  return { accept: 'application/json', 'x-telegram-init-data': initData, ...extra };
}

/**
 * Body fields for an authenticated POST — the byte-exact transport.
 *
 * HTTP headers can be truncated or re-encoded by proxies and are rejected
 * outright when they contain non-ASCII bytes, while a JSON string round-trips
 * any content exactly. So POSTs carry the initData BOTH ways: the server
 * compares the two and can prove (or rule out) in-transit corruption. The
 * header stays for GETs and for every older caller.
 */
export function telegramAuthBodyFields() {
  const initData = telegramInitData();
  return initData ? { initData } : null;
}
