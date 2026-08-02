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
