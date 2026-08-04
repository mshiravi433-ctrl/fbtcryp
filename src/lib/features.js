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


/**
 * SPECULATION SCREENS — off by default, for the same reason the arcade is.
 *
 * ─── WHY THIS FLAG EXISTS ───────────────────────────────────────────────────
 * APKPure rejected the app: "Not involve illegal sensitive words."
 *
 * That is the standard wording for a content filter, and the app was giving
 * it plenty to find. It shipped a screen literally titled "Price prediction"
 * whose subtitle was "Call the next candle — up or down" (that is a binary
 * option, banned for retail traders in the UK and EU and illegal in Iran), a
 * "Perpetuals" screen advertising leveraged futures, and an "Invest" screen
 * offering "fixed-term yield plans".
 *
 * Every one of those is simulated and each carries an honest risk notice
 * saying so. That does not help: a reviewer, and certainly an automated
 * filter, reads the words on the screen. "Prediction", "leverage",
 * "perpetual futures" and "yield plan" are exactly the vocabulary that a
 * crypto content filter is built to catch, and the disclaimer three
 * paragraphs down does not change the classification.
 *
 * ─── WHY REMOVE RATHER THAN RE-WORD ─────────────────────────────────────────
 * Re-wording would be dishonest in the other direction: the screens really do
 * simulate binary options and leveraged futures, so any name that got them
 * past a filter would be a name that misdescribes them.
 *
 * They also earn nothing. Every one runs on virtual credits, so they cannot
 * produce a single unit of revenue — while being the specific reason the app
 * cannot be distributed. That is a bad trade in every direction.
 *
 * OFF by default, exactly like GAMES_ENABLED, so a release build that forgets
 * an env var fails SAFE. The routes and their chunks are removed entirely,
 * not hidden — someone unzipping the APK finds no trace of them.
 */
export const SPECULATION_ENABLED =
  typeof __SPECULATION_ENABLED__ !== 'undefined'
    ? __SPECULATION_ENABLED__
    : import.meta.env?.VITE_ENABLE_SPECULATION === 'true';
