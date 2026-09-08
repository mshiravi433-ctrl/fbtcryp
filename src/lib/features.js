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
const buildEnv =
  typeof __AAVE_BASE_BUILD_ENV__ !== 'undefined' ? __AAVE_BASE_BUILD_ENV__ : null;
/*
 * The second adapter's caps arrive through their own build define. They are
 * looked up in BOTH tables (each define only carries its own protocol's keys)
 * before falling back to import.meta.env, so a Compound cap set at build time
 * is not silently ignored because the Aave table answered first with
 * `undefined`.
 */
const compoundBuildEnv =
  typeof __COMPOUND_BASE_BUILD_ENV__ !== 'undefined' ? __COMPOUND_BASE_BUILD_ENV__ : null;
/*
 * The third adapter's caps arrive through their own build define, same as the
 * first two: each define only carries its own deployment's keys, and every
 * table is consulted before falling back to import.meta.env.
 */
const arbBuildEnv =
  typeof __AAVE_ARB_BUILD_ENV__ !== 'undefined' ? __AAVE_ARB_BUILD_ENV__ : null;
const lidoBuildEnv =
  typeof __LIDO_BUILD_ENV__ !== 'undefined' ? __LIDO_BUILD_ENV__ : null;
const morphoBuildEnv =
  typeof __MORPHO_BASE_BUILD_ENV__ !== 'undefined' ? __MORPHO_BASE_BUILD_ENV__ : null;
const buildOrEnv = (key) => {
  if (buildEnv && buildEnv[key] != null && String(buildEnv[key]) !== '') return buildEnv[key];
  if (compoundBuildEnv && compoundBuildEnv[key] != null && String(compoundBuildEnv[key]) !== '') {
    return compoundBuildEnv[key];
  }
  if (arbBuildEnv && arbBuildEnv[key] != null && String(arbBuildEnv[key]) !== '') {
    return arbBuildEnv[key];
  }
  if (lidoBuildEnv && lidoBuildEnv[key] != null && String(lidoBuildEnv[key]) !== '') {
    return lidoBuildEnv[key];
  }
  if (morphoBuildEnv && morphoBuildEnv[key] != null && String(morphoBuildEnv[key]) !== '') {
    return morphoBuildEnv[key];
  }
  // In an app build the defines exist, so an unset variable must resolve to
  // "unset" here rather than falling through to an import.meta.env that the
  // bundler has already folded away.
  if (buildEnv || compoundBuildEnv || arbBuildEnv || lidoBuildEnv || morphoBuildEnv) return undefined;
  return envFlag(key);
};

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
  const raw = buildOrEnv(name);
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
 * Required small-group gate: lowercase 0x addresses. Empty means the money
 * path stays closed. Compared case-insensitively against the connected owner.
 *
 *     VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xabc...,0xdef...
 */
export const AAVE_BASE_SUPPLY_ALLOWLIST = Object.freeze(
  String(buildOrEnv('VITE_AAVE_BASE_SUPPLY_ALLOWLIST') ?? '')
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
  // An enabled money path without an explicit wallet list is still closed.
  if (AAVE_BASE_SUPPLY_ALLOWLIST.length === 0) return false;
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

/* -------------------------------------------------------------------------- */
/* AAVE V3 · ARBITRUM · USDC SUPPLY — OFF BY DEFAULT, IN EVERY BUILD           */
/* -------------------------------------------------------------------------- */
/*
 * The THIRD in-app DeFi execution adapter (lib/defi/aaveV3Arbitrum.js): the
 * same Aave v3 Pool interface as the Base adapter, but a different deployment
 * (Arbitrum One 42161), a different USDC (native 0xaf88…, the USDCn reserve —
 * NOT the bridged USDC.e reserve) and a different aToken. Same protocol does
 * NOT mean same flag: a governance incident, a paused reserve or a bad rate
 * on one chain must be switchable off without taking the other chain's supply
 * with it. Two deployments, two blast radii, two kill switches.
 *
 * Everything else follows the Base flag's rules deliberately:
 *
 *   · `=== 'true'`, never `!== 'false'`. A build that forgets the env var
 *     ships with the money path CLOSED.
 *   · Caps default to 100 USDC per transaction and 500 USDC in total, are
 *     enforced inside the adapter (not just the UI), and an unparseable env
 *     value falls back to the default rather than becoming 0 or Infinity.
 *   · The kill switch never gates the EXIT. See
 *     `aaveArbWithdrawAllowedFor` below.
 *
 * HOW TO TURN IT ON:
 *
 *     VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=true npm run build
 *
 * Do NOT enable it without the rollout checklist in
 * docs/defi/aave-v3-arbitrum.md: independent review of the adapter and a
 * passing Arbitrum-mainnet fork probe (`npm run test:aave-arbitrum-fork`).
 */

/** True only when the build was explicitly told to expose in-app Aave Arbitrum supply. */
export const AAVE_ARB_SUPPLY_ENABLED =
  typeof __AAVE_ARB_SUPPLY_ENABLED__ !== 'undefined'
    ? __AAVE_ARB_SUPPLY_ENABLED__
    : envFlag('VITE_ENABLE_AAVE_ARBITRUM_SUPPLY') === 'true';

/** Per-transaction supply ceiling, in whole USDC. Enforced in the adapter. */
export const AAVE_ARB_SUPPLY_MAX_USDC_PER_TX = envCap(
  'VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX', 100, 10_000
);

/** Lifetime position ceiling, in whole USDC (existing position + new supply). */
export const AAVE_ARB_SUPPLY_MAX_USDC_TOTAL = envCap(
  'VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL', 500, 100_000
);

/**
 * Required small-group gate: lowercase 0x addresses. Empty means the money
 * path stays closed. Compared case-insensitively against the connected owner.
 *
 *     VITE_AAVE_ARB_SUPPLY_ALLOWLIST=0xabc...,0xdef...
 */
export const AAVE_ARB_SUPPLY_ALLOWLIST = Object.freeze(
  String(buildOrEnv('VITE_AAVE_ARB_SUPPLY_ALLOWLIST') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s))
);

/**
 * Can THIS wallet open a NEW supply on Aave Arbitrum?
 *
 * All three gates, in order: the build flag, then the allowlist (when one is
 * configured), then the caller's own hard caps. Withdrawal never calls this.
 */
export function aaveArbSupplyAllowedFor(owner) {
  if (!AAVE_ARB_SUPPLY_ENABLED) return false;
  // An enabled money path without an explicit wallet list is still closed.
  if (AAVE_ARB_SUPPLY_ALLOWLIST.length === 0) return false;
  const who = String(owner ?? '').trim().toLowerCase();
  return AAVE_ARB_SUPPLY_ALLOWLIST.includes(who);
}

/**
 * Can THIS wallet withdraw from Aave Arbitrum?
 *
 * Deliberately independent of the flag, the caps and the allowlist: the only
 * requirement is that there is something to withdraw. `hasPosition` is the
 * caller's on-chain aToken balance > 0.
 */
export function aaveArbWithdrawAllowedFor({ owner, hasPosition } = {}) {
  if (!owner) return false;
  return Boolean(hasPosition);
}

/* -------------------------------------------------------------------------- */
/* COMPOUND V3 · BASE · USDC SUPPLY — OFF BY DEFAULT, IN EVERY BUILD           */
/* -------------------------------------------------------------------------- */
/*
 * The SECOND in-app DeFi execution adapter (lib/defi/compoundV3Base.js), and
 * it gets its own flag rather than riding on the Aave one. Two protocols, two
 * blast radii: a bug or a governance incident in Compound III must be
 * switchable off without also taking away the Aave path that thousands of
 * dollars might already be sitting in, and vice versa. One shared flag would
 * make the kill switch an all-or-nothing lever exactly when it needs to be
 * precise.
 *
 * Everything else follows the Aave flag's rules deliberately, because they
 * were argued once and should not be re-litigated per protocol:
 *
 *   · `=== 'true'`, never `!== 'false'`. A build that forgets the env var
 *     ships with the money path CLOSED.
 *   · Caps default to 100 USDC per transaction and 500 USDC in total, are
 *     enforced inside the adapter (not just the UI), and an unparseable env
 *     value falls back to the default rather than becoming 0 or Infinity.
 *   · The kill switch never gates the EXIT. See
 *     `compoundBaseWithdrawAllowedFor` below.
 *
 * HOW TO TURN IT ON:
 *
 *     VITE_ENABLE_COMPOUND_BASE_SUPPLY=true npm run build
 *
 * Do NOT enable it without the rollout checklist in
 * docs/defi/compound-v3-base.md: independent review of the adapter and a
 * passing Base-mainnet fork probe (`npm run test:compound-base-fork`).
 */

/** True only when the build was explicitly told to expose in-app Compound supply. */
export const COMPOUND_BASE_SUPPLY_ENABLED =
  typeof __COMPOUND_BASE_SUPPLY_ENABLED__ !== 'undefined'
    ? __COMPOUND_BASE_SUPPLY_ENABLED__
    : envFlag('VITE_ENABLE_COMPOUND_BASE_SUPPLY') === 'true';

/** Per-transaction supply ceiling, in whole USDC. Enforced in the adapter. */
export const COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX = envCap(
  'VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX', 100, 10_000
);

/** Lifetime position ceiling, in whole USDC (existing position + new supply). */
export const COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL = envCap(
  'VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL', 500, 100_000
);

/**
 * Required small-group gate: lowercase 0x addresses. Empty means the money
 * path stays closed. Compared case-insensitively against the connected owner.
 *
 *     VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST=0xabc...,0xdef...
 */
export const COMPOUND_BASE_SUPPLY_ALLOWLIST = Object.freeze(
  String(buildOrEnv('VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s))
);

/**
 * Can THIS wallet open a NEW Compound supply?
 *
 * The build flag, then the allowlist (when one is configured). Withdrawal
 * never calls this.
 */
export function compoundBaseSupplyAllowedFor(owner) {
  if (!COMPOUND_BASE_SUPPLY_ENABLED) return false;
  // An enabled money path without an explicit wallet list is still closed.
  if (COMPOUND_BASE_SUPPLY_ALLOWLIST.length === 0) return false;
  const who = String(owner ?? '').trim().toLowerCase();
  return COMPOUND_BASE_SUPPLY_ALLOWLIST.includes(who);
}

/**
 * Can THIS wallet withdraw from Compound?
 *
 * Deliberately independent of the flag, the caps and the allowlist: the only
 * requirement is that there is something to withdraw. `hasPosition` is the
 * caller's on-chain Comet base balance > 0.
 */
export function compoundBaseWithdrawAllowedFor({ owner, hasPosition } = {}) {
  if (!owner) return false;
  return Boolean(hasPosition);
}

/* -------------------------------------------------------------------------- */
/* MORPHO BLUE · BASE · ONE USDC/cbBTC MARKET — OFF BY DEFAULT                 */
/* -------------------------------------------------------------------------- */
/*
 * Morpho Blue is not a vault and this flag is not a discovery switch. The
 * adapter pins one marketId and verifies its immutable loan/collateral/oracle/
 * IRM/LLTV tuple on-chain. Keep the execution path dark until its strict fork
 * probe and the documented market mapping have been reviewed.
 */
export const MORPHO_BASE_SUPPLY_ENABLED =
  typeof __MORPHO_BASE_SUPPLY_ENABLED__ !== 'undefined'
    ? __MORPHO_BASE_SUPPLY_ENABLED__
    : envFlag('VITE_ENABLE_MORPHO_BASE_SUPPLY') === 'true';

export const MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX = envCap(
  'VITE_MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX', 100, 10_000
);
export const MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL = envCap(
  'VITE_MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL', 500, 100_000
);
export const MORPHO_BASE_SUPPLY_ALLOWLIST = Object.freeze(
  String(buildOrEnv('VITE_MORPHO_BASE_SUPPLY_ALLOWLIST') ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^0x[a-f0-9]{40}$/.test(s))
);
export function morphoBaseSupplyAllowedFor(owner) {
  if (!MORPHO_BASE_SUPPLY_ENABLED) return false;
  // Public capital must never open accidentally when the list is empty.
  if (MORPHO_BASE_SUPPLY_ALLOWLIST.length === 0) return false;
  return MORPHO_BASE_SUPPLY_ALLOWLIST.includes(String(owner ?? '').trim().toLowerCase());
}
export function morphoBaseWithdrawAllowedFor({ owner, hasPosition } = {}) {
  return Boolean(owner && hasPosition);
}

/* -------------------------------------------------------------------------- */
/* LIDO · ETHEREUM · stETH — OFF BY DEFAULT, IN EVERY BUILD                   */
/* -------------------------------------------------------------------------- */
/*
 * The FOURTH in-app DeFi execution adapter (lib/defi/lido.js): Lido liquid
 * staking on Ethereum mainnet (chain 1). Same blast-radius principle as the
 * three adapters above: a bug, a pause or a governance incident in Lido must
 * be switchable off without touching Aave or Compound, and vice versa.
 *
 * Lido is NOT a lending market: staking ETH mints stETH 1:1 at the current
 * share price, and unstaking goes through the WithdrawalQueue with a delay.
 * The adapter therefore exposes five actions:
 *
 *   stake            ETH  -> stETH  (Lido.submit)
 *   wrap             stETH -> wstETH
 *   unwrap           wstETH -> stETH
 *   requestWithdraw  stETH -> WithdrawalQueue ticket
 *   claim            ticket -> ETH
 *
 * Caps are in whole ETH (not USDC), default 1 ETH per tx and 10 ETH total,
 * enforced inside the adapter. An unparseable env value falls back to the
 * default.
 *
 * HOW TO TURN IT ON:
 *
 *     VITE_ENABLE_LIDO_STAKE=true npm run build
 *
 * Do NOT enable it without:
 *   · independent review of lib/defi/lido.js
 *   · a passing mainnet-fork probe (stake -> wrap -> unwrap -> request)
 *   · an allowlist for the first rollout
 *
 * KILL SWITCH:
 * Turn the flag off and rebuild. Stake disappears. Position and all exits
 * (unwrap, requestWithdraw, claim) remain — see `lidoWithdrawAllowedFor`.
 */

/** True only when the build was explicitly told to expose in-app Lido staking. */
export const LIDO_STAKE_ENABLED =
  typeof __LIDO_STAKE_ENABLED__ !== 'undefined'
    ? __LIDO_STAKE_ENABLED__
    : envFlag('VITE_ENABLE_LIDO_STAKE') === 'true';

/** Per-transaction stake ceiling, in whole ETH. */
export const LIDO_STAKE_MAX_ETH_PER_TX = envCap(
  'VITE_LIDO_STAKE_MAX_ETH_PER_TX', 1, 100
);

/** Lifetime position ceiling, in whole ETH (existing stETH + new stake). */
export const LIDO_STAKE_MAX_ETH_TOTAL = envCap(
  'VITE_LIDO_STAKE_MAX_ETH_TOTAL', 10, 1000
);

/**
 * Required allowlist: lowercase 0x addresses. Empty means the money path stays
 * closed.
 *
 *     VITE_LIDO_STAKE_ALLOWLIST=0xabc...,0xdef...
 */
export const LIDO_STAKE_ALLOWLIST = Object.freeze(
  String(buildOrEnv('VITE_LIDO_STAKE_ALLOWLIST') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s))
);

export function lidoStakeAllowedFor(owner) {
  if (!LIDO_STAKE_ENABLED) return false;
  // An enabled money path without an explicit wallet list is still closed.
  if (LIDO_STAKE_ALLOWLIST.length === 0) return false;
  const who = String(owner ?? '').trim().toLowerCase();
  return LIDO_STAKE_ALLOWLIST.includes(who);
}

export function lidoWithdrawAllowedFor({ owner, hasPosition } = {}) {
  if (!owner) return false;
  return Boolean(hasPosition);
}
