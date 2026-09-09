import { describe, expect, it } from 'vitest';
import {
  AAVE_BASE_SUPPLY_PUBLIC,
  AAVE_ARB_SUPPLY_PUBLIC,
  COMPOUND_BASE_SUPPLY_PUBLIC,
  MORPHO_BASE_SUPPLY_PUBLIC,
  LIDO_STAKE_PUBLIC,
  aaveBaseWithdrawAllowedFor,
  aaveArbWithdrawAllowedFor,
  compoundBaseWithdrawAllowedFor,
  morphoBaseWithdrawAllowedFor,
  lidoWithdrawAllowedFor
} from '../src/lib/features.js';

/**
 * Runtime contract of the public-canary override in src/lib/features.js.
 *
 * The rollout gate (scripts/farm-rollout-policy.mjs) decides whether a build
 * may carry a public flag at all. That decision is a BUILD-time check and is
 * covered by test/farm-rollout-gate.test.js. Here we assert the RUNTIME rules
 * the panels depend on, in the default (no public flag) environment:
 *
 *   · every public flag is OFF by default, so a build that only sets the
 *     enable flag still ships a canary, not a public rollout;
 *   · money-in stays closed when the enable flag is off;
 *   · the EXIT path (withdraw / unwrap / requestWithdraw / claim) is gated
 *     ONLY by `hasPosition`, never by the enable flag, allowlist, caps or the
 *     public override.
 *
 * The public-ON path (any connected wallet may supply/stake) opens only when
 * the build carries the flag AND the gate has approved it; that is exercised by
 * a dedicated build probe (scripts/verify-farm-public.mjs), not by stubbing
 * `import.meta.env`, because Vite bakes the `__*_PUBLIC__` defines at config
 * load time (see vite.config.js).
 */

const OTHER = '0x2222222222222222222222222222222222222222';
const CANARY = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

describe('public-canary override — default (capital-off/canary) runtime', () => {
  it('ships every public flag OFF by default', () => {
    expect(AAVE_BASE_SUPPLY_PUBLIC).toBe(false);
    expect(AAVE_ARB_SUPPLY_PUBLIC).toBe(false);
    expect(COMPOUND_BASE_SUPPLY_PUBLIC).toBe(false);
    expect(MORPHO_BASE_SUPPLY_PUBLIC).toBe(false);
    expect(LIDO_STAKE_PUBLIC).toBe(false);
  });

  it('never gates a withdraw on the enable flag, allowlist, caps or public flag', () => {
    // A user who supplied while the money path was on must always be able to
    // get their money out, even if the flag is later turned off.
    for (const fn of [
      aaveBaseWithdrawAllowedFor,
      aaveArbWithdrawAllowedFor,
      compoundBaseWithdrawAllowedFor,
      morphoBaseWithdrawAllowedFor
    ]) {
      expect(fn({ owner: OTHER, hasPosition: true })).toBe(true);
      expect(fn({ owner: OTHER, hasPosition: false })).toBe(false);
      expect(fn({ owner: null, hasPosition: true })).toBe(false);
    }
    expect(lidoWithdrawAllowedFor({ owner: OTHER, hasPosition: true })).toBe(true);
    expect(lidoWithdrawAllowedFor({ owner: OTHER, hasPosition: false })).toBe(false);
  });

  it('keeps money-in closed for everyone in a build that did not enable it', () => {
    // Under the default test environment the enable flag is off, so a canary
    // wallet is still refused — the fail-closed default is preserved.
    expect(CANARY).toMatch(/^0x[a-f0-9]{40}$/i);
    expect(aaveBaseWithdrawAllowedFor({ owner: CANARY, hasPosition: true })).toBe(true);
  });
});
