// @vitest-environment jsdom
/**
 * A PUBLIC-OPEN BUILD SHOWS ITS EXECUTION PANELS TO EVERYONE.
 *
 * Runs ONLY under test/vitest.public.config.mjs (the five money-in defines
 * baked true), because the property under test is exactly what those defines
 * decide.
 *
 * Each panel used to answer "should I exist?" with
 * `!supplyAllowed && !hasPosition && !knownHere → null`, and `supplyAllowed`
 * is `*AllowedFor(owner)`, which is false for an empty owner. So in a build
 * where ANY wallet may supply, the panel was still invisible to the visitor
 * who had not connected yet — and FarmPositionHub is a stack of exactly those
 * panels, so the whole section rendered empty for them. The rollout was public
 * and the door was hidden: «در فارم هنوز نمیاد برای همه».
 *
 * What is asserted here is the split that fixed it:
 *   · VISIBILITY — with no wallet at all, the panel is on the page;
 *   · PERMISSION — the money button is NOT, because that still needs a
 *     connected owner (`*AllowedFor`), which nothing here widened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: () => {} } })
}));
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    isConnected: false,
    address: undefined,
    chainId: 8453,
    nativeBalance: 0,
    getReadProvider: async () => { throw new Error('NO_WALLET'); },
    getSigner: () => null,
    switchChain: async () => false
  })
}));

import AaveBaseUsdcPanel from '../src/components/Farm/AaveBaseUsdcPanel';
import AaveArbUsdcPanel from '../src/components/Farm/AaveArbUsdcPanel';
import CompoundBaseUsdcPanel from '../src/components/Farm/CompoundBaseUsdcPanel';
import LidoPanel from '../src/components/Farm/LidoPanel';
import MorphoBaseUsdcPanel from '../src/components/Farm/MorphoBaseUsdcPanel';
import { SUPPORTED_FARM_POSITION_POOLS } from '../src/components/Farm/FarmPositionHub';

const CASES = [
  ['aave base', AaveBaseUsdcPanel, SUPPORTED_FARM_POSITION_POOLS.aaveBase, 'farm.aave.panelTitle', 'farm.aave.supplyInApp'],
  ['aave arbitrum', AaveArbUsdcPanel, SUPPORTED_FARM_POSITION_POOLS.aaveArbitrum, 'farm.aaveArb.panelTitle', 'farm.aaveArb.supplyInApp'],
  ['compound base', CompoundBaseUsdcPanel, SUPPORTED_FARM_POSITION_POOLS.compoundBase, 'farm.compound.panelTitle', 'farm.compound.supplyInApp'],
  ['lido', LidoPanel, SUPPORTED_FARM_POSITION_POOLS.lido, 'farm.lido.panelTitle', 'farm.lido.stakeInApp'],
  ['morpho base', MorphoBaseUsdcPanel, SUPPORTED_FARM_POSITION_POOLS.morphoBase, 'farm.morpho.panelTitle', 'farm.morpho.supplyInApp']
];

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('panel visibility in a public-open build, with no wallet connected', () => {
  it.each(CASES)('%s renders its card and still hides the money button', (_label, Panel, pool, titleKey, actionKey) => {
    const { container, getByText, queryByText } = render(<Panel pool={pool} />);
    // Visible to everybody…
    expect(container.firstChild).toBeTruthy();
    expect(getByText(titleKey)).toBeTruthy();
    expect(getByText(/connectFirst|connect/i)).toBeTruthy();
    // …but nothing can be signed without an owner.
    expect(queryByText(actionKey)).toBeNull();
  });
});
