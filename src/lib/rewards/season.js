/**
 * AIRDROP SEASON — gated on a REAL funded pool, never on optimism.
 * ---------------------------------------------------------------------------
 * The brief allowed a season only "if a pool is actually funded". So the
 * default is OFF, and the UI says exactly that: entries are collected, no
 * prize is promised. There is no amount, no token symbol and no winners count
 * anywhere in this file unless an operator explicitly configures one after a
 * pool exists.
 *
 * To turn the surface on, set BOTH at build time:
 *   VITE_REWARDS_SEASON_FUNDED=true
 *   VITE_REWARDS_SEASON_POOL=<human-readable, verifiable pool description>
 *
 * `VITE_REWARDS_SEASON_TOKEN` is optional and only rendered when funded. It is
 * never a promise of a specific allocation — an entry is not a payout.
 */
const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const SEASON = Object.freeze({
  id: 'fbt-season-1',
  funded: String(env.VITE_REWARDS_SEASON_FUNDED || '').toLowerCase() === 'true',
  pool: typeof env.VITE_REWARDS_SEASON_POOL === 'string' && env.VITE_REWARDS_SEASON_POOL.trim()
    ? env.VITE_REWARDS_SEASON_POOL.trim()
    : null,
  tokenSymbol: typeof env.VITE_REWARDS_SEASON_TOKEN === 'string' && env.VITE_REWARDS_SEASON_TOKEN.trim()
    ? env.VITE_REWARDS_SEASON_TOKEN.trim()
    : null
});

/** Never claim a prize for a pool that is not funded AND described. */
export const seasonIsLive = () => SEASON.funded && Boolean(SEASON.pool);
