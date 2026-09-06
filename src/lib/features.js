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
 * ─── WHAT THE DEFAULT ACTUALLY IS ───────────────────────────────────────────
 * ON unless `VITE_ENABLE_SPECULATION=false` is set. This comment used to claim
 * the opposite ("OFF by default, so a release build that forgets an env var
 * fails SAFE") while the expression below read `!== 'false'`. Anyone trusting
 * the comment over the code would have shipped a store build believing these
 * screens were gone.
 *
 * The default is ON because this flag serves the WEBSITE, which is the common
 * case and where the owner wants the screens. The distribution that must not
 * contain them opts out explicitly and verifiably:
 *
 *     "android:sync": "VITE_ENABLE_SPECULATION=false npm run build && …"
 *
 * so the store build cannot forget — the flag is written into the one script
 * that produces it, and `test/run.mjs` builds with the variable both ways and
 * greps the output to prove the screens really are absent in one and present
 * in the other.
 *
 * When the flag is off the routes and their chunks are removed entirely, not
 * hidden — someone unzipping the APK finds no trace of them.
 */
export const SPECULATION_ENABLED =
  typeof __SPECULATION_ENABLED__ !== 'undefined'
    ? __SPECULATION_ENABLED__
    : import.meta.env?.VITE_ENABLE_SPECULATION !== 'false';

/* -------------------------------------------------------------------------- */
/* AAVE V3 · BASE · USDC SUPPLY — OFF BY DEFAULT, IN EVERY BUILD               */
/* -------------------------------------------------------------------------- */
/*
 * This is the app's first adapter that MOVES VALUE INTO A THIRD-PARTY SMART
 * CONTRACT (lib/defi/aaveV3Base.js). It is not the arcade and it is not the
 * speculation screens: what it does is real and useful, so unlike those it is
 * worth keeping behind a flag rather than deleting. But it is the one feature
 * in this file where a mistake costs the user money rather than their opinion
 * of the product, so the default is the opposite of SPECULATION_ENABLED.
 *
 * ─── WHY `=== 'true'` AND NOT `!== 'false'` ─────────────────────────────────
 * SPECULATION_ENABLED is ON unless explicitly switched off, because the
 * website is the common case. This flag is OFF unless explicitly switched ON:
 * a build that forgets an env var must ship with the money path closed, not
 * open. `!== 'false'` would invert that and fail open.
 *
 * ─── HOW TO TURN IT ON ──────────────────────────────────────────────────────
 * Set the env var at build time (the same mechanism every other flag uses):
 *
 *     VITE_ENABLE_AAVE_BASE_SUPPLY=true npm run build
 *
 * or pin it in the build script, the way `android:sync` pins
 * VITE_ENABLE_SPECULATION=false. Do NOT enable it in a store build without the
 * rollout checklist in docs/defi/aave-v3-base.md being completed: independent
 * review of the adapter, a passing Base-mainnet fork probe, and an allowlist.
 *
 * ─── KILL SWITCH ────────────────────────────────────────────────────────────
 * Turn the flag off and rebuild. Supply disappears everywhere, for everyone.
 * Position and WITHDRAW DO NOT — see `aaveBaseWithdrawAllowedFor` below. A
 * user who supplied while the flag was on must still be able to get their
 * money out afterwards; gating the exit would turn a safety feature into a
 * trap on their funds.
 */

const envFlag = (name) => (typeof import.meta !== 'undefined' ? import.meta.env?.[name] : undefined);

/** True only when the build was explicitly told to expose in-app Aave supply. */
export const AAVE_BASE_SUPPLY_ENABLED =
  typeof __AAVE_BASE_SUPPLY_ENABLED__ !== 'undefined'
    ? __AAVE_BASE_SUPPLY_ENABLED__
    : envFlag('VITE_ENABLE_AAVE_BASE_SUPPLY') === 'true';

/**
 * A finite, parseable number from the environment, or the default.
 *
 * A cap is a safety limit, so an unusable value must NOT silently become 0
 * (which would block everything and look like a bug) nor Infinity (which would
 * remove the limit). Non-finite input falls back to the default, and the value
 * is clamped to a sane ceiling so a typo cannot type 1e18 into a cap.
 */
function envCap(name, fallback, ceiling) {
  const raw = envFlag(name);
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, ceiling);
}

/** Per-transaction supply ceiling, in whole USDC. Enforced in the adapter. */
export const AAVE_BASE_SUPPLY_MAX_USDC_PER_TX = envCap(
  'VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX', 100, 10_000
);

/** Lifetime position ceiling, in whole USDC (existing position + new supply). */
export const AAVE_BASE_SUPPLY_MAX_USDC_TOTAL = envCap(
  'VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL', 500, 100_000
);

/**
 * Optional small-group gate: lowercase 0x addresses. Empty means "anyone the
 * flag is on for". Compared case-insensitively against the connected owner.
 *
 *     VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xabc...,0xdef...
 */
export const AAVE_BASE_SUPPLY_ALLOWLIST = Object.freeze(
  String(envFlag('VITE_AAVE_BASE_SUPPLY_ALLOWLIST') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s))
);

/**
 * Can THIS wallet open a NEW supply?
 *
 * All three gates, in order: the build flag, then the allowlist (when one is
 * configured), then the caller's own hard caps. Withdrawal never calls this.
 */
export function aaveBaseSupplyAllowedFor(owner) {
  if (!AAVE_BASE_SUPPLY_ENABLED) return false;
  if (AAVE_BASE_SUPPLY_ALLOWLIST.length === 0) return true;
  const who = String(owner ?? '').trim().toLowerCase();
  return AAVE_BASE_SUPPLY_ALLOWLIST.includes(who);
}

/**
 * Can THIS wallet withdraw?
 *
 * Deliberately independent of the flag, the caps and the allowlist: the only
 * requirement is that there is something to withdraw. `hasPosition` is the
 * caller's on-chain aToken balance > 0.
 */
export function aaveBaseWithdrawAllowedFor({ owner, hasPosition } = {}) {
  if (!owner) return false;
  return Boolean(hasPosition);
}
