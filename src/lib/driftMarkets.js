/**
 * Drift perp market catalogue — pure constants, NO SDK imports.
 *
 * Kept separate from driftTrade.js so the UI can map base symbol → Drift
 * market index statically (tiny, tree-shakeable) without touching the large,
 * lazy-loaded Drift SDK vendor bundle.
 */

/** Drift perp market index by base symbol. Mirrors the BFF adapter catalogue. */
export const DRIFT_PERP_INDEX = Object.freeze({
  SOL: 0, BTC: 1, ETH: 2, JUP: 92, JTO: 78, WIF: 80, PYTH: 58, RAY: 56, HNT: 22,
  W: 70, BNB: 89, XRP: 61, DOGE: 42, LINK: 88, SUI: 87, APT: 97, ARB: 69,
  TNSR: 105, TON: 127, TRUMP: 156
});

export const driftPerpIndex = (base) => DRIFT_PERP_INDEX[String(base || '').toUpperCase()] ?? null;
