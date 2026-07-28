/**
 * Build-time feature flags.
 *
 * This lives in its own module on purpose. It used to be exported from
 * App.jsx, which MoreSheet imported — and App.jsx imports BottomNav, which
 * imports MoreSheet. That circle meant MoreSheet could evaluate before App's
 * module body had run, giving "Cannot access 'GAMES_ENABLED' before
 * initialization". The production bundle happened to order the chunks so it
 * didn't blow up, which is the worst kind of latent bug: it works until an
 * unrelated import changes and then the whole app is a blank screen.
 *
 * A leaf module with no imports of its own cannot participate in a cycle.
 */

/**
 * The arcade is OFF by default.
 *
 * Google Play and the Iranian stores (Bazaar, Myket) all restrict
 * gambling-styled content, and Crash/Dice/Mines read as gambling to a
 * reviewer even though the points have no cash value. It is the single most
 * likely reason a crypto app gets rejected.
 *
 * Defaulting to OFF rather than requiring VITE_DISABLE_GAMES=true is
 * deliberate: a release build that forgets to set an env var should fail
 * SAFE. The previous default meant one missing CI variable shipped the arcade
 * to the store, and you would only find out from a rejection email days
 * later.
 *
 * This removes the routes ENTIRELY — the lazy chunks are never emitted, so
 * the code is not in the APK at all for someone to find by unzipping it.
 * Set VITE_ENABLE_GAMES=true to build a variant that includes them.
 */
/*
 * `__GAMES_ENABLED__` is replaced with a literal `true` or `false` by Vite's
 * `define` (see vite.config.js). It must be a literal rather than an
 * `import.meta.env` lookup, otherwise Rollup cannot prove the lazy import in
 * App.jsx is unreachable and ships the game chunks anyway.
 *
 * The `typeof` guard keeps this working under the test harness and any
 * bundler that doesn't apply our define.
 */
export const GAMES_ENABLED =
  typeof __GAMES_ENABLED__ !== 'undefined'
    ? __GAMES_ENABLED__
    : import.meta.env?.VITE_ENABLE_GAMES === 'true';
