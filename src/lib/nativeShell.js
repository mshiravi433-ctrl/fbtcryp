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
  const base =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_URL) ||
    /*
     * The canonical home moved from www.lawpoetics.ir to fbtswap.ir, and this
     * default matters more than most: it is what a referral invite and a
     * share link resolve to inside the APK, where window.location is
     * https://localhost. Left stale, every invite the app has ever generated
     * would keep pointing at the old host.
     */
    'https://fbtswap.ir';
  return `${String(base).replace(/\/+$/, '')}${path}`;
}
