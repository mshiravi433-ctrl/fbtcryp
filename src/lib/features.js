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
 * THE ARCADE IS GONE — NOT FLAGGED OFF, DELETED.
 * ---------------------------------------------------------------------------
 * It used to be a build flag (`GAMES_ENABLED` / `VITE_ENABLE_GAMES`), off for
 * store builds and on for the website and the direct-download APK. That was
 * the wrong shape for two reasons and the owner was right to call it:
 *
 *   1. A gambling-styled arcade next to a real, non-custodial swap screen
 *      damages the product wherever it appears. The website is what Google
 *      indexes and what a first-time user judges; "Crash / Dice / Mines" sat
 *      one tap from a screen that moves real money.
 *   2. It earned nothing. Every round ran on virtual NX credits, so it could
 *      never produce revenue, while being a permanent rejection risk and a
 *      permanent maintenance cost.
 *
 * So `src/games/`, `src/pages/Play.jsx`, `src/lib/fairness.js`,
 * `src/hooks/useFairSession.js` and the whole `game.*` locale namespace are
 * removed from the repository. There is no flag to turn them back on — a flag
 * would just be the same problem waiting for someone to set an env var.
 *
 * SPECULATION_ENABLED below is a DIFFERENT case and deliberately still a flag:
 * those screens are educational simulations of instruments that exist, and
 * the owner wants them on the website.
 */

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
 * OFF by default, so a release build that forgets
 * an env var fails SAFE. The routes and their chunks are removed entirely,
 * not hidden — someone unzipping the APK finds no trace of them.
 */
export const SPECULATION_ENABLED =
  typeof __SPECULATION_ENABLED__ !== 'undefined'
    ? __SPECULATION_ENABLED__
    : import.meta.env?.VITE_ENABLE_SPECULATION !== 'false';
