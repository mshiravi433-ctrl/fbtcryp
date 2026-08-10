/**
 * Am I running inside the packaged Android app?
 *
 * This exists as its own tiny module because the answer is needed by both the
 * settings store and plain components, and importing the store from a
 * presentational component just to read one boolean drags the whole
 * persistence layer into that chunk.
 *
 * It is also deliberately NOT a hook and NOT reactive: a WebView cannot stop
 * being a WebView at runtime, so re-rendering on it would be pointless work.
 *
 * Kept in sync with `applyNativeFlag()` in the settings store, which writes
 * the same answer onto <html data-native> for CSS to key off.
 */
export function isNativeShell() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

/**
 * The public URL of this app.
 *
 * `window.location` is wrong inside the APK: Capacitor serves from
 * https://localhost, so any link built from it — a wallet deeplink, a referral
 * invite — would point at the user's own phone. The configured origin is used
 * instead.
 *
 * Lives here rather than in a feature module so that importing it does not
 * drag an unrelated dependency along with it.
 *
 * The default is the bare origin. It briefly defaulted to '/#/solana' while
 * only the wallet deeplink used it; the referral invite then inherited that
 * and every shared link would have dropped friends on the Solana screen.
 * Callers name the route they want.
 */
export function publicAppUrl(path = '/') {
  const configured =
    typeof import.meta !== 'undefined' ? String(import.meta.env?.VITE_PUBLIC_URL || '') : '';
  /*
   * A stale Vercel/CI variable can outlive the code that set it. That happened:
   * VITE_PUBLIC_URL still named lawpoetics.ir, so Phantom correctly displayed
   * that unrelated domain even though every fallback in source said fbtswap.ir.
   *
   * Production identity is not a user preference. Only the canonical host (or
   * an explicit preview host for testing) may override it; the retired domain
   * is rejected rather than trusted merely because it came from an env var.
   */
  const allowed = /^https:\/\/(?:www\.)?fbtswap\.ir(?=\/|$)/i.test(configured)
    || /^https:\/\/[^/]+\.e2b\.app(?=\/|$)/i.test(configured);
  const base = allowed ? configured : 'https://fbtswap.ir';
  return `${String(base).replace(/\/+$/, '')}${path}`;
}
