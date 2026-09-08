import { describe, expect, it } from 'vitest';
import { SUPPORTED_FARM_POSITION_POOLS } from '../src/components/Farm/FarmPositionHub';
import { isAaveBaseUsdcPool } from '../src/lib/defi/aaveV3Base';
import { isCompoundBaseUsdcPool } from '../src/lib/defi/compoundV3Base';
import { isAaveArbUsdcPool } from '../src/lib/defi/aaveV3Arbitrum';
import { isLidoPool } from '../src/lib/defi/lido';

describe('feed-independent Farm position hub', () => {
  it('pins only matcher descriptors and no feed-derived rates or positions', () => {
    for (const row of Object.values(SUPPORTED_FARM_POSITION_POOLS)) {
      expect(row).not.toHaveProperty('apy');
      expect(row).not.toHaveProperty('tvlUsd');
      expect(row).not.toHaveProperty('position');
      expect(row).not.toHaveProperty('url');
    }
  });

  it('routes every descriptor to exactly its supported direct adapter', () => {
    const { aaveBase, compoundBase, aaveArbitrum, lido } = SUPPORTED_FARM_POSITION_POOLS;
    expect(isAaveBaseUsdcPool(aaveBase)).toBe(true);
    expect(isCompoundBaseUsdcPool(compoundBase)).toBe(true);
    expect(isAaveArbUsdcPool(aaveArbitrum)).toBe(true);
    expect(isLidoPool(lido)).toBe(true);

    expect(isCompoundBaseUsdcPool(aaveBase)).toBe(false);
    expect(isAaveBaseUsdcPool(compoundBase)).toBe(false);
    expect(isAaveBaseUsdcPool(aaveArbitrum)).toBe(false);
    expect(isLidoPool(aaveBase)).toBe(false);
  });
});
