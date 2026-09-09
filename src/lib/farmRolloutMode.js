/**
 * FARM ROLLOUT MODE — is each money path open to ANY visitor in this build?
 *
 * ─── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 * src/lib/features.js holds the build flags. Several of its audits read a
 * section as "everything from `export function xWithdrawAllowedFor` to the end
 * of the file" to prove that the EXIT helper never reads a supply flag, and
 * "everything from `export const COMPOUND_BASE_SUPPLY_ENABLED`" to prove the
 * Compound kill switch does not ride on the Aave one. Those slices are only
 * meaningful while each section is the last thing in the file, so a block of
 * derived constants appended at the end lands inside all of them and reads as
 * a violation. Deriving them here keeps features.js exactly as audited, and
 * gives this concern — a UI visibility rule, not a flag — its own home.
 *
 * ─── WHAT IT ANSWERS ─────────────────────────────────────────────────────────
 * Every panel used to answer "should I render at all?" with
 *
 *     if (!supplyAllowed && !hasPosition && !knownHere) return null;
 *
 * and `supplyAllowed` is `*AllowedFor(owner)`, which returns false for an empty
 * owner. So in a build where the money path is open to EVERY wallet
 * (`VITE_*_SUPPLY_PUBLIC=true`, approved by scripts/farm-rollout-policy.mjs),
 * the panel was still invisible to the one person who had not connected a
 * wallet yet — and FarmPositionHub is a stack of exactly those panels, so the
 * whole "my farms" section rendered empty for them. The rollout was public and
 * the door was still hidden: «در فارم هنوز نمیاد برای همه».
 *
 * So the two questions are separated:
 *
 *   · VISIBILITY — is this build one where any visitor may use the adapter?
 *     That is what decides whether the card is on the page, so the entry point
 *     exists before the wallet is connected and the panel can say "connect
 *     first" instead of not existing.
 *   · PERMISSION — may THIS wallet move money right now? That stays
 *     `*AllowedFor(owner)`, unchanged, and still requires a connected owner.
 *     The sign buttons read that, never these constants.
 *
 * Both flags are required: `PUBLIC` without the enable flag is rejected by the
 * build gate, and the enable flag without `PUBLIC` is a canary build, where a
 * wallet outside the allowlist must NOT see an entry point it cannot use.
 */
import {
  AAVE_BASE_SUPPLY_ENABLED, AAVE_BASE_SUPPLY_PUBLIC,
  AAVE_ARB_SUPPLY_ENABLED, AAVE_ARB_SUPPLY_PUBLIC,
  COMPOUND_BASE_SUPPLY_ENABLED, COMPOUND_BASE_SUPPLY_PUBLIC,
  MORPHO_BASE_SUPPLY_ENABLED, MORPHO_BASE_SUPPLY_PUBLIC,
  LIDO_STAKE_ENABLED, LIDO_STAKE_PUBLIC
} from './features';

/* OPEN-TO-PUBLIC — PANEL VISIBILITY, NOT PERMISSION                          */
/* -------------------------------------------------------------------------- */
/*
 * Every panel used to answer "should I render at all?" with
 *
 *     if (!supplyAllowed && !hasPosition && !knownHere) return null;
 *
 * and `supplyAllowed` is `*AllowedFor(owner)`, which returns false for an empty
 * owner. So in a build where the money path is open to EVERY wallet
 * (`VITE_*_SUPPLY_PUBLIC=true`, approved by scripts/farm-rollout-policy.mjs),
 * the panel was still invisible to the one person who had not connected a
 * wallet yet — and FarmPositionHub is a stack of exactly those panels, so the
 * whole "my farms" section rendered empty for them. The rollout was public and
 * the door was still hidden: «در فارم هنوز نمیاد برای همه».
 *
 * These five constants separate the two questions:
 *
 *   · VISIBILITY — is this build one where any visitor may use the adapter?
 *     That is what decides whether the card is on the page, so the entry point
 *     exists before the wallet is connected and the panel can say "connect
 *     first" instead of not existing.
 *   · PERMISSION — may THIS wallet move money right now? That stays
 *     `*AllowedFor(owner)`, unchanged, and still requires a connected owner.
 *     The sign buttons read that, never these constants.
 *
 * Both flags are required: `PUBLIC` without the enable flag is rejected by the
 * build gate, and the enable flag without `PUBLIC` is a canary build, where a
 * wallet outside the allowlist must NOT see an entry point it cannot use.
 */

/** Aave v3 · Base · USDC — is the supply path open to any visitor? */
export const AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC =
  AAVE_BASE_SUPPLY_ENABLED && AAVE_BASE_SUPPLY_PUBLIC;

/** Aave v3 · Arbitrum · USDC — is the supply path open to any visitor? */
export const AAVE_ARB_SUPPLY_OPEN_TO_PUBLIC =
  AAVE_ARB_SUPPLY_ENABLED && AAVE_ARB_SUPPLY_PUBLIC;

/** Compound v3 · Base · USDC — is the supply path open to any visitor? */
export const COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC =
  COMPOUND_BASE_SUPPLY_ENABLED && COMPOUND_BASE_SUPPLY_PUBLIC;

/** Morpho Blue · Base · USDC/cbBTC — is the supply path open to any visitor? */
export const MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC =
  MORPHO_BASE_SUPPLY_ENABLED && MORPHO_BASE_SUPPLY_PUBLIC;

/** Lido · Ethereum · ETH — is the stake path open to any visitor? */
export const LIDO_STAKE_OPEN_TO_PUBLIC = LIDO_STAKE_ENABLED && LIDO_STAKE_PUBLIC;
