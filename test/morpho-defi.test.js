import { describe, expect, it } from 'vitest';
import {
  MORPHO_BLUE_BASE,
  MorphoAdapterError,
  fromUsdcWei,
  isMorphoBlueBaseMarket,
  verifyDeployment,
  verifyMorphoReceipt
} from '../src/lib/defi/morphoBlueBase';
import {
  MORPHO_BASE_SUPPLY_ENABLED,
  MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX,
  MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL,
  morphoBaseWithdrawAllowedFor
} from '../src/lib/features';

const OWNER = '0x1111111111111111111111111111111111111111';

describe('Morpho Blue Base selected market', () => {
  it('pins one Base market and keeps the data UUID out of transaction identity', () => {
    expect(MORPHO_BLUE_BASE.chainId).toBe(8453);
    expect(MORPHO_BLUE_BASE.marketId).toBe('0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836');
    expect(MORPHO_BLUE_BASE.loanSymbol).toBe('USDC');
    expect(MORPHO_BLUE_BASE.collateralSymbol).toBe('cbBTC');
    expect(MORPHO_BLUE_BASE.lltv).toBe(860000000000000000n);
    expect(MORPHO_BLUE_BASE.defiLlamaPoolId).toBe('7d33d57d-36dc-414b-9538-22a223250468');
    expect(MORPHO_BLUE_BASE.defiLlamaPoolId).not.toBe(MORPHO_BLUE_BASE.marketId);
  });

  it('matches only the documented DefiLlama data row, not a vault or guessed symbol', () => {
    const row = { project: 'morpho-blue', chain: 'Base', pool: MORPHO_BLUE_BASE.defiLlamaPoolId, symbol: 'CBBTC' };
    expect(isMorphoBlueBaseMarket(row)).toBe(true);
    expect(isMorphoBlueBaseMarket({ ...row, project: 'morpho-v1' })).toBe(false);
    expect(isMorphoBlueBaseMarket({ ...row, pool: '0xvault' })).toBe(false);
    expect(isMorphoBlueBaseMarket({ ...row, symbol: 'USDC' })).toBe(true); // UUID + chain are the identity; symbol is display data only.
  });

  it('ships capital execution off and exits are independent of the supply flag', () => {
    expect(MORPHO_BASE_SUPPLY_ENABLED).toBe(false);
    expect(MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX).toBe(100);
    expect(MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL).toBe(500);
    expect(morphoBaseWithdrawAllowedFor({ owner: OWNER, hasPosition: true })).toBe(true);
    expect(morphoBaseWithdrawAllowedFor({ owner: OWNER, hasPosition: false })).toBe(false);
  });

  it('fails closed on a wrong network before reading or writing a market', async () => {
    const provider = { getNetwork: async () => ({ chainId: 1 }) };
    await expect(verifyDeployment(provider, { force: true })).rejects.toMatchObject({ code: 'MORPHO_WRONG_CHAIN' });
  });

  it('rejects a successful receipt with no selected-market event', async () => {
    await expect(verifyMorphoReceipt({
      provider: {}, receipt: { status: 1, logs: [] }, owner: OWNER, action: 'supply', amountWei: 1n
    })).rejects.toMatchObject({ code: 'MORPHO_EXPECTED_EVENT_MISSING' });
  });

  it('formats exact six-decimal loan amounts without a display round trip', () => {
    expect(fromUsdcWei(1n)).toBe('0.000001');
    expect(fromUsdcWei(5_000_000n)).toBe('5.000000');
  });
});
