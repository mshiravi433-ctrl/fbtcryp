import { defineConfig } from 'vitest/config';

/**
 * A SECOND vitest environment that bakes the public-canary override defines to
 * `true`, so the runtime side of `VITE_*_PUBLIC=true` can be asserted.
 *
 * The default test run (via vite.config.js) bakes every `__*_SUPPLY_ENABLED__`
 * and `__*_PUBLIC__` value to `false`, so it exercises only the canary/capital-off
 * contract. This config exists only to prove the other half: when a build
 * carries a public flag, supply/stake opens to any connected wallet while the
 * exit path stays gated by `hasPosition`.
 *
 * It is intentionally NOT selected by the main `test:farm` run. Run it via:
 *
 *     npm run test:farm:public
 */
export default defineConfig({
  define: {
    __AAVE_BASE_SUPPLY_ENABLED__: true,
    __AAVE_BASE_SUPPLY_PUBLIC__: true,
    __AAVE_ARB_SUPPLY_ENABLED__: true,
    __AAVE_ARB_SUPPLY_PUBLIC__: true,
    __COMPOUND_BASE_SUPPLY_ENABLED__: true,
    __COMPOUND_BASE_SUPPLY_PUBLIC__: true,
    __MORPHO_BASE_SUPPLY_ENABLED__: true,
    __MORPHO_BASE_SUPPLY_PUBLIC__: true,
    __LIDO_STAKE_ENABLED__: true,
    __LIDO_STAKE_PUBLIC__: true
  },
  test: {
    include: ['test/farm-public-mode-public.test.js']
  }
});
