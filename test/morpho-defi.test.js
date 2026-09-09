import { describe, expect, it } from 'vitest';
import { Interface } from 'ethers';
import {
  MORPHO_ACTION_SELECTORS,
  MORPHO_BLUE_BASE,
  MorphoAdapterError,
  encodeSupplyCalldata,
  encodeWithdrawCalldata,
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

  /*
   * Morpho Blue's interface is re-declared here from the published signatures and
   * its 4-byte selectors are derived from those strings, so anything that drifts in
   * the adapter — argument order, the callback `bytes data`, a renamed struct — is
   * caught offline. On-chain the same mistake is silent: an unknown selector on a
   * contract with no fallback reverts with no return data at all.
   */
  const MORPHO_BLUE_CANONICAL = new Interface([
    'function supply((address,address,address,address,uint256),uint256,uint256,address,bytes) returns (uint256,uint256)',
    'function withdraw((address,address,address,address,uint256),uint256,uint256,address,address) returns (uint256,uint256)'
  ]);

  it('asks for only the selectors Morpho Blue answers with on Base', () => {
    expect(MORPHO_ACTION_SELECTORS.supply).toBe(MORPHO_BLUE_CANONICAL.getFunction('supply').selector);
    expect(MORPHO_ACTION_SELECTORS.withdraw).toBe(MORPHO_BLUE_CANONICAL.getFunction('withdraw').selector);
  });

  it('puts supply amounts before onBehalf and keeps the callback empty', async () => {
    const data = await encodeSupplyCalldata({ owner: OWNER, amountWei: 5_000_000n });
    expect(data.slice(0, 10)).toBe(MORPHO_ACTION_SELECTORS.supply);
    const args = MORPHO_BLUE_CANONICAL.decodeFunctionData('supply', data);
    expect([...args[0]].map((value) => (typeof value === 'bigint' ? value : String(value).toLowerCase()))).toEqual([
      MORPHO_BLUE_BASE.loanToken.toLowerCase(),
      MORPHO_BLUE_BASE.collateralToken.toLowerCase(),
      MORPHO_BLUE_BASE.oracle.toLowerCase(),
      MORPHO_BLUE_BASE.irm.toLowerCase(),
      MORPHO_BLUE_BASE.lltv
    ]);
    expect(args[1]).toBe(5_000_000n);
    expect(args[2]).toBe(0n);
    expect(String(args[3]).toLowerCase()).toBe(OWNER.toLowerCase());
    expect(args[4]).toBe('0x');
  });

  it('exits a max withdrawal through shares and pays the owner as receiver', async () => {
    const data = await encodeWithdrawCalldata({ owner: OWNER, sharesWei: 123_456n });
    expect(data.slice(0, 10)).toBe(MORPHO_ACTION_SELECTORS.withdraw);
    const args = MORPHO_BLUE_CANONICAL.decodeFunctionData('withdraw', data);
    expect(args[1]).toBe(0n);
    expect(args[2]).toBe(123_456n);
    expect(String(args[3]).toLowerCase()).toBe(OWNER.toLowerCase());
    expect(String(args[4]).toLowerCase()).toBe(OWNER.toLowerCase());
  });

  it('refuses an ambiguous or owner-less action before it can be signed', async () => {
    await expect(encodeSupplyCalldata({ owner: 'not-an-address', amountWei: 1n }))
      .rejects.toMatchObject({ code: 'MORPHO_BAD_OWNER' });
    await expect(encodeSupplyCalldata({ owner: OWNER, amountWei: 1n, sharesWei: 1n }))
      .rejects.toMatchObject({ code: 'MORPHO_INPUT_ASSETS_OR_SHARES' });
    await expect(encodeWithdrawCalldata({ owner: OWNER }))
      .rejects.toMatchObject({ code: 'MORPHO_INVALID_AMOUNT' });
  });

  it('formats exact six-decimal loan amounts without a display round trip', () => {
    expect(fromUsdcWei(1n)).toBe('0.000001');
    expect(fromUsdcWei(5_000_000n)).toBe('5.000000');
  });
});
