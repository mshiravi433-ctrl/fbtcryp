import { describe, expect, it } from 'vitest';
import {
  AAVE_BASE_SUPPLY_ENABLED,
  AAVE_BASE_SUPPLY_PUBLIC,
  LIDO_STAKE_ENABLED,
  LIDO_STAKE_PUBLIC,
  aaveBaseSupplyAllowedFor,
  lidoStakeAllowedFor,
  aaveBaseWithdrawAllowedFor,
  lidoWithdrawAllowedFor
} from '../src/lib/features.js';

/**
 * Runs ONLY under test/vitest.public.config.mjs, which bakes the
 * `__*_SUPPLY_ENABLED__` and `__*_PUBLIC__` defines to `true`.
 *
 * This is the runtime side of the public-canary override: with the build
 * carrying the public flag (which the rollout gate has already approved at
 * build time), ANY connected wallet may open a new supply / stake, while the
 * exit path stays gated by `hasPosition` only.
 */

const OTHER = '0x2222222222222222222222222222222222222222';

describe('public-canary override — open to any wallet (public build)', () => {
  it('opens Aave Base supply to a wallet that is not on the canary allowlist', () => {
    expect(AAVE_BASE_SUPPLY_ENABLED).toBe(true);
    expect(AAVE_BASE_SUPPLY_PUBLIC).toBe(true);
    expect(aaveBaseSupplyAllowedFor(OTHER)).toBe(true);
  });

  it('opens Lido staking to any wallet while exits stay gated by hasPosition', () => {
    expect(LIDO_STAKE_ENABLED).toBe(true);
    expect(LIDO_STAKE_PUBLIC).toBe(true);
    expect(lidoStakeAllowedFor(OTHER)).toBe(true);
    // The exit path is never widened by the public override.
    expect(lidoWithdrawAllowedFor({ owner: OTHER, hasPosition: true })).toBe(true);
    expect(lidoWithdrawAllowedFor({ owner: OTHER, hasPosition: false })).toBe(false);
  });

  it('still keeps a withdraw gated by hasPosition, not by the public flag', () => {
    expect(aaveBaseWithdrawAllowedFor({ owner: OTHER, hasPosition: true })).toBe(true);
    expect(aaveBaseWithdrawAllowedFor({ owner: OTHER, hasPosition: false })).toBe(false);
  });
});
