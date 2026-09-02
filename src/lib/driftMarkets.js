/**
 * Velocity (ex-Drift) perp market catalogue — pure constants, NO SDK imports.
 *
 * Kept separate from driftTrade.js so the UI can map base symbol → perp market
 * index statically (tiny, tree-shakeable) without touching the large,
 * lazy-loaded venue SDK vendor bundle.
 *
 * The indices are the FORK's own: Velocity is a fresh program deployment, so
 * Drift's old index table (JUP 92, PYTH 58, TON 127 …) is meaningless here.
 * These four are the perps Velocity lists today (SOL 0, BTC 1, ETH 2, HYPE 3);
 * the authoritative list is still the live Data API read, which the BFF returns
 * with `marketId` — this table is only the offline fallback.
 */

/** Velocity perp market index by base symbol. Mirrors the BFF adapter feed. */
export const VELOCITY_PERP_INDEX = Object.freeze({
  SOL: 0, BTC: 1, ETH: 2, HYPE: 3
});

export const velocityPerpIndex = (base) => VELOCITY_PERP_INDEX[String(base || '').toUpperCase()] ?? null;

/* Drift-era aliases — same venue, renamed on chain. Existing imports keep
   working; new code should use the VELOCITY_* names. */
export const DRIFT_PERP_INDEX = VELOCITY_PERP_INDEX;
export const driftPerpIndex = velocityPerpIndex;
