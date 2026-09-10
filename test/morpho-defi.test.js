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

  it('ships capital execution off, uncapped, with exits independent of the supply flag', async () => {
    expect(MORPHO_BASE_SUPPLY_ENABLED).toBe(false);
    const features = await import('../src/lib/features.js');
    expect(Object.keys(features)).not.toContain('MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX');
    expect(Object.keys(features)).not.toContain('MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL');
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
  const MORPHO_READ_ABI = new Interface([
    'function idToMarketParams(bytes32 id) view returns (address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)',
    'function market(bytes32 id) view returns (uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)',
    'function position(bytes32 id,address user) view returns (uint256 supplyShares,uint128 borrowShares,uint128 collateral)',
    'event Supply(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets,uint256 shares)',
    'event Withdraw(bytes32 indexed id,address indexed caller,address indexed onBehalf,address receiver,uint256 assets,uint256 shares)'
  ]);

  function fakeMorphoProvider({ supplyShares = 0n, totalSupplyAssets = 9_999_999n, totalSupplyShares = 4n } = {}) {
    return {
      getNetwork: async () => ({ chainId: 8453 }),
      call: async ({ data }) => {
        const selector = String(data).slice(0, 10);
        if (selector === MORPHO_READ_ABI.getFunction('idToMarketParams').selector) {
          return MORPHO_READ_ABI.encodeFunctionResult('idToMarketParams', [
            MORPHO_BLUE_BASE.loanToken,
            MORPHO_BLUE_BASE.collateralToken,
            MORPHO_BLUE_BASE.oracle,
            MORPHO_BLUE_BASE.irm,
            MORPHO_BLUE_BASE.lltv
          ]);
        }
        if (selector === MORPHO_READ_ABI.getFunction('market').selector) {
          return MORPHO_READ_ABI.encodeFunctionResult('market', [
            totalSupplyAssets,
            totalSupplyShares,
            0n,
            0n,
            1n,
            0n
          ]);
        }
        if (selector === MORPHO_READ_ABI.getFunction('position').selector) {
          return MORPHO_READ_ABI.encodeFunctionResult('position', [supplyShares, 0n, 0n]);
        }
        throw new Error(`unexpected call ${selector}`);
      }
    };
  }

  function morphoReceipt(eventName, { assets, shares, owner = OWNER } = {}) {
    const encoded = eventName === 'Supply'
      ? MORPHO_READ_ABI.encodeEventLog(MORPHO_READ_ABI.getEvent('Supply'), [MORPHO_BLUE_BASE.marketId, owner, owner, assets, shares])
      : MORPHO_READ_ABI.encodeEventLog(MORPHO_READ_ABI.getEvent('Withdraw'), [MORPHO_BLUE_BASE.marketId, owner, owner, owner, assets, shares]);
    return {
      status: 1,
      logs: [{ address: MORPHO_BLUE_BASE.morpho, topics: encoded.topics, data: encoded.data }]
    };
  }

  it('proves supply by event shares when derived assets round one wei below the supplied amount', async () => {
    const proof = await verifyMorphoReceipt({
      provider: fakeMorphoProvider({ supplyShares: 2n, totalSupplyAssets: 9_999_999n, totalSupplyShares: 4n }),
      receipt: morphoReceipt('Supply', { assets: 5_000_000n, shares: 2n }),
      owner: OWNER,
      action: 'supply',
      amountWei: 5_000_000n,
      beforePositionWei: 0n,
      beforeSupplyShares: 0n
    });
    expect(proof.proof).toMatchObject({ eventAmount: 5_000_000n, eventShares: 2n, sharesDelta: 2n });
    expect(proof.position.supplyShares).toBe(2n);
    expect(proof.position.suppliedUsdc).toBe(4_999_999n);
  });

  it('rejects a supply receipt if the owner supply shares did not move', async () => {
    await expect(verifyMorphoReceipt({
      provider: fakeMorphoProvider({ supplyShares: 0n }),
      receipt: morphoReceipt('Supply', { assets: 5_000_000n, shares: 2n }),
      owner: OWNER,
      action: 'supply',
      amountWei: 5_000_000n,
      beforePositionWei: 0n,
      beforeSupplyShares: 0n
    })).rejects.toMatchObject({
      code: 'MORPHO_POSITION_UNCHANGED',
      detail: { expectedShares: 2n, sharesDelta: 0n }
    });
  });

  it('rejects a supply receipt if the owner supply shares moved by the wrong amount', async () => {
    await expect(verifyMorphoReceipt({
      provider: fakeMorphoProvider({ supplyShares: 1n }),
      receipt: morphoReceipt('Supply', { assets: 5_000_000n, shares: 2n }),
      owner: OWNER,
      action: 'supply',
      amountWei: 5_000_000n,
      beforePositionWei: 0n,
      beforeSupplyShares: 0n
    })).rejects.toMatchObject({
      code: 'MORPHO_POSITION_UNCHANGED',
      detail: { expectedShares: 2n, sharesDelta: 1n }
    });
  });

  it('proves withdraw by event shares instead of a derived-asset equality', async () => {
    const proof = await verifyMorphoReceipt({
      provider: fakeMorphoProvider({ supplyShares: 0n }),
      receipt: morphoReceipt('Withdraw', { assets: 4_999_999n, shares: 2n }),
      owner: OWNER,
      action: 'withdraw',
      amountWei: null,
      beforePositionWei: 4_999_999n,
      beforeSupplyShares: 2n
    });
    expect(proof.proof).toMatchObject({ eventAmount: 4_999_999n, eventShares: 2n, sharesDelta: 2n });
    expect(proof.position.supplyShares).toBe(0n);
  });

  it('rejects a withdraw receipt if the owner shares did not burn', async () => {
    await expect(verifyMorphoReceipt({
      provider: fakeMorphoProvider({ supplyShares: 2n }),
      receipt: morphoReceipt('Withdraw', { assets: 4_999_999n, shares: 2n }),
      owner: OWNER,
      action: 'withdraw',
      amountWei: null,
      beforePositionWei: 4_999_999n,
      beforeSupplyShares: 2n
    })).rejects.toMatchObject({
      code: 'MORPHO_POSITION_UNCHANGED',
      detail: { expectedShares: 2n, sharesDelta: 0n }
    });
  });

  describe('ROUTED supply receipts (split router)', () => {
    const ROUTER = '0x1234567890123456789012345678901234567890';
    const OTHER = '0x2222222222222222222222222222222222222222';
    const GROSS = 5_000_000n;
    const FEE = (GROSS * 30n) / 10_000n;      // 30 bps
    const NET = GROSS - FEE;
    const splitRouter = { address: ROUTER, feeBps: 30n, feeAmount: FEE, netAmount: NET };
    const ROUTED_ABI = new Interface([
      'event Routed(address indexed target, address indexed user, address indexed asset, uint256 amountIn, uint256 feeTaken, uint256 netAmount)'
    ]);
    const routedLog = (user) => {
      const e = ROUTED_ABI.encodeEventLog(ROUTED_ABI.getEvent('Routed'), [MORPHO_BLUE_BASE.morpho, user, MORPHO_BLUE_BASE.loanToken, GROSS, FEE, NET]);
      return { address: ROUTER, topics: e.topics, data: e.data };
    };
    /* caller = ROUTER, onBehalf = OWNER — exactly what a routed supply emits. */
    const routedSupplyLog = (assets, shares, onBehalf = OWNER) => {
      const e = MORPHO_READ_ABI.encodeEventLog(MORPHO_READ_ABI.getEvent('Supply'), [MORPHO_BLUE_BASE.marketId, ROUTER, onBehalf, assets, shares]);
      return { address: MORPHO_BLUE_BASE.morpho, topics: e.topics, data: e.data };
    };

    it('proves a routed deposit from Routed + MarketSupply crediting the OWNER with the NET assets', async () => {
      const proof = await verifyMorphoReceipt({
        provider: fakeMorphoProvider({ supplyShares: 2n }),
        receipt: { status: 1, logs: [routedLog(OWNER), routedSupplyLog(NET, 2n)] },
        owner: OWNER, action: 'supply', amountWei: GROSS,
        beforePositionWei: 0n, beforeSupplyShares: 0n, splitRouter
      });
      expect(proof).toMatchObject({ ok: true, event: 'Supply' });
      expect(proof.routed.netAmount).toBe(NET);
      expect(proof.eventAmount).toBe(NET);
      expect(proof.eventShares).toBe(2n);
    });

    it('rejects a routed receipt that credits the GROSS amount or another account', async () => {
      await expect(verifyMorphoReceipt({
        provider: fakeMorphoProvider({ supplyShares: 2n }),
        receipt: { status: 1, logs: [routedLog(OWNER), routedSupplyLog(GROSS, 2n)] },
        owner: OWNER, action: 'supply', amountWei: GROSS,
        beforePositionWei: 0n, beforeSupplyShares: 0n, splitRouter
      })).rejects.toMatchObject({ code: 'MORPHO_PROTOCOL_EVENT_MISMATCH' });
      await expect(verifyMorphoReceipt({
        provider: fakeMorphoProvider({ supplyShares: 2n }),
        receipt: { status: 1, logs: [routedLog(OWNER), routedSupplyLog(NET, 2n, OTHER)] },
        owner: OWNER, action: 'supply', amountWei: GROSS,
        beforePositionWei: 0n, beforeSupplyShares: 0n, splitRouter
      })).rejects.toMatchObject({ code: 'MORPHO_PROTOCOL_EVENT_MISMATCH' });
    });

    it('rejects a routed receipt without the Routed event', async () => {
      await expect(verifyMorphoReceipt({
        provider: fakeMorphoProvider({ supplyShares: 2n }),
        receipt: { status: 1, logs: [routedSupplyLog(NET, 2n)] },
        owner: OWNER, action: 'supply', amountWei: GROSS,
        beforePositionWei: 0n, beforeSupplyShares: 0n, splitRouter
      })).rejects.toMatchObject({ code: 'SPLIT_ROUTER_PROOF_MISMATCH' });
    });
  });
});
