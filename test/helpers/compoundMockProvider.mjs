/**
 * A mock Compound III (Comet) / Base provider for the adapter unit tests.
 *
 * This is NOT a mock of our own code — `compoundV3Base.js` runs for real, with
 * its real ABIs, real rate maths and real ethers encoding. Only the CHAIN is
 * replaced: `provider.call` answers each selector the way a Base node would.
 *
 * Unlike Aave, Comet has no struct-layout ambiguity to model: every reply here
 * is a single value or a flat tuple. What it CAN do is lie — a market whose
 * baseToken is WETH, a Configurator that disagrees with the market, a paused
 * market, an account already carrying a borrow — because the point of these
 * tests is that the adapter refuses those.
 */
import { AbiCoder, Interface } from 'ethers';

const coder = AbiCoder.defaultAbiCoder();

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** The Configurator's Configuration tuple, exactly as declared in the adapter. */
const CONFIGURATION_TUPLE =
  'tuple(address governor, address pauseGuardian, address baseToken, address baseTokenPriceFeed, address extensionDelegate, uint64 supplyKink, uint64 supplyPerYearInterestRateSlopeLow, uint64 supplyPerYearInterestRateSlopeHigh, uint64 supplyPerYearInterestRateBase, uint64 borrowKink, uint64 borrowPerYearInterestRateSlopeLow, uint64 borrowPerYearInterestRateSlopeHigh, uint64 borrowPerYearInterestRateBase, uint64 storeFrontPriceFactor, uint64 trackingIndexScale, uint64 baseTrackingSupplySpeed, uint64 baseTrackingBorrowSpeed, uint104 baseMinForRewards, uint104 baseBorrowMin, uint104 targetReserves, tuple(address asset, address priceFeed, uint8 decimals, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap)[] assetConfigs)';

const IFACES = {
  comet: new Interface([
    'function supply(address asset, uint256 amount)',
    'function withdraw(address asset, uint256 amount)',
    'function borrow(address asset, uint256 amount)',
    'function repay(address asset, uint256 amount)',
    'function balanceOf(address owner) view returns (uint256)',
    'function borrowBalanceOf(address account) view returns (uint256)',
    'function baseToken() view returns (address)',
    'function baseTokenPriceFeed() view returns (address)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function totalBorrow() view returns (uint256)',
    'function getUtilization() view returns (uint256)',
    'function getSupplyRate(uint256 utilization) view returns (uint64)',
    'function getPrice(address priceFeed) view returns (uint256)',
    'function isSupplyPaused() view returns (bool)',
    'function isWithdrawPaused() view returns (bool)',
    'function baseMinForRewards() view returns (uint256)',
    'function baseTrackingSupplySpeed() view returns (uint256)',
    'function usdPerSupply() view returns (uint256)',
    'function usdPerBorrow() view returns (uint256)',
    'function supplyState() view returns (uint256,uint256)',
    'function getTotalSupply() view returns (uint256)',
    'function getTotalBorrow() view returns (uint256)',
    'function accountSupplyAssets() view returns (uint256)',
    'function accountBorrowAssets() view returns (uint256)',
    'function collateralBalanceOf(address account, address asset) view returns (uint256)',
    'function getHealthFactor() view returns (uint256)'
  ]),
  configurator: new Interface([`function getConfiguration(address cometProxy) view returns (${CONFIGURATION_TUPLE})`]),
  rewards: new Interface([
    'function getRewardOwed(address comet, address account) returns (tuple(address token, uint256 owed))'
  ]),
  erc20: new Interface([
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function decimals() view returns (uint8)'
  ])
};

const PRICE_FEED = '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B';

/**
 * @param {object} cfg
 * @param {string} cfg.comet             the adapter's pinned Comet address
 * @param {string} cfg.configurator      the adapter's pinned Configurator
 * @param {string} cfg.rewards           the adapter's pinned CometRewards
 * @param {string} cfg.usdc              the underlying USDC address (chains.js value)
 * @param {string} [cfg.baseToken]       what Comet.baseToken() answers (default: usdc)
 * @param {string} [cfg.configBaseToken] what the Configurator answers (default: usdc)
 * @param {number} [cfg.decimals]        what Comet.decimals() answers (default 6)
 * @param {boolean} [cfg.configuratorFails] make the Configurator read throw
 * @param {bigint} [cfg.supplyRatePerSecond] 1e18-scaled per-second supply rate
 * @param {bigint} [cfg.utilization]     1e18-scaled utilisation
 * @param {boolean} [cfg.supplyPaused]
 * @param {boolean} [cfg.withdrawPaused]
 * @param {bigint} [cfg.positionWei]     Comet.balanceOf(owner) — the position
 * @param {bigint} [cfg.borrowWei]       Comet.borrowBalanceOf(owner)
 * @param {bigint} [cfg.allowanceWei]    USDC allowance the market already holds
 * @param {bigint} [cfg.usdcBalanceWei]  the owner's USDC balance
 * @param {bigint} [cfg.rewardsOwedWei]  COMP owed, or null to make the read fail
 * @param {bigint} [cfg.baseMinForRewards]
 * @param {bigint} [cfg.priceUsd8]       1e8-based USD price, or 0 to fail the read
 * @param {bigint} [cfg.usdPerSupplyWei] 1e18-scaled USDC→USD exchange rate
 * @param {bigint} [cfg.usdPerBorrowWei] 1e18-scaled USDC→USD exchange rate
 * @param {bigint} [cfg.collateralBalanceWei] the owner's balance of the configured collateral
 * @param {bigint} [cfg.healthFactorWei] 1e18-scaled Comet.getHealthFactor(), or null to fail the read
 * @param {Array}  [cfg.assetConfigs]    the Configurator's configured collateral assets
 */
export function makeCometProvider({
  comet,
  configurator,
  rewards,
  usdc,
  baseToken,
  configBaseToken,
  decimals = 6,
  marketSymbol = 'cUSDCv3',
  configuratorFails = false,
  // 1.5e9 per second ≈ 4.73% simple APR — a realistic Base USDC figure.
  supplyRatePerSecond = 1_500_000_000n,
  utilization = (10n ** 18n * 85n) / 100n,
  supplyPaused = false,
  withdrawPaused = false,
  positionWei = 0n,
  borrowWei = 0n,
  allowanceWei = 0n,
  usdcBalanceWei = 0n,
  totalSupplyWei = 100_000n * 10n ** 6n,
  totalBorrowWei = 80_000n * 10n ** 6n,
  rewardsOwedWei = 0n,
  rewardsToken = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
  baseMinForRewards = 1000n * 10n ** 6n,
  baseTrackingSupplySpeed = 231_481_481_481n,
  priceUsd8 = 100_000_000n,
  usdPerSupplyWei = 10n ** 18n,
  usdPerBorrowWei = 10n ** 18n,
  collateralBalanceWei = 0n,
  healthFactorWei = null,
  assetConfigs = [],
  nativeBalanceWei = 10n ** 18n,
  chainId = 8453,
  calls = []
} = {}) {
  const collateralByAddress = Object.fromEntries(
    assetConfigs.map((a) => [String(a.asset).toLowerCase(), a])
  );
  const sel = (iface, name) => IFACES[iface].getFunction(name).selector;
  const S = {
    baseToken: sel('comet', 'baseToken'),
    baseTokenPriceFeed: sel('comet', 'baseTokenPriceFeed'),
    decimals: sel('comet', 'decimals'),
    symbol: sel('comet', 'symbol'),
    balanceOf: sel('comet', 'balanceOf'),
    borrowBalanceOf: sel('comet', 'borrowBalanceOf'),
    totalSupply: sel('comet', 'totalSupply'),
    totalBorrow: sel('comet', 'totalBorrow'),
    getUtilization: sel('comet', 'getUtilization'),
    getSupplyRate: sel('comet', 'getSupplyRate'),
    getPrice: sel('comet', 'getPrice'),
    isSupplyPaused: sel('comet', 'isSupplyPaused'),
    isWithdrawPaused: sel('comet', 'isWithdrawPaused'),
    baseMinForRewards: sel('comet', 'baseMinForRewards'),
    baseTrackingSupplySpeed: sel('comet', 'baseTrackingSupplySpeed'),
    usdPerSupply: sel('comet', 'usdPerSupply'),
    usdPerBorrow: sel('comet', 'usdPerBorrow'),
    supplyState: sel('comet', 'supplyState'),
    getTotalSupply: sel('comet', 'getTotalSupply'),
    getTotalBorrow: sel('comet', 'getTotalBorrow'),
    accountSupplyAssets: sel('comet', 'accountSupplyAssets'),
    accountBorrowAssets: sel('comet', 'accountBorrowAssets'),
    collateralBalanceOf: sel('comet', 'collateralBalanceOf'),
    getHealthFactor: sel('comet', 'getHealthFactor'),
    getConfiguration: sel('configurator', 'getConfiguration'),
    getRewardOwed: sel('rewards', 'getRewardOwed'),
    allowance: sel('erc20', 'allowance'),
    decimals20: sel('erc20', 'decimals')
  };

  const provider = {
    calls,
    async getNetwork() { return { chainId: BigInt(chainId) }; },
    async getBalance() { return nativeBalanceWei; },
    async estimateGas() { return 120000n; },
    async call(tx) {
      const to = String(tx.to).toLowerCase();
      const selector = String(tx.data).slice(0, 10);
      calls.push({ to, selector, data: tx.data, from: tx.from ?? null });
      const enc = (types, values) => coder.encode(types, values);

      if (to === String(comet).toLowerCase()) {
        if (selector === S.baseToken) return enc(['address'], [baseToken ?? usdc]);
        if (selector === S.baseTokenPriceFeed) {
          return enc(['address'], [priceUsd8 > 0n ? PRICE_FEED : ZERO_ADDRESS]);
        }
        if (selector === S.decimals) return enc(['uint8'], [decimals]);
        if (selector === S.symbol) return enc(['string'], [marketSymbol]);
        if (selector === S.balanceOf) return enc(['uint256'], [positionWei]);
        if (selector === S.borrowBalanceOf) return enc(['uint256'], [borrowWei]);
        if (selector === S.totalSupply) return enc(['uint256'], [totalSupplyWei]);
        if (selector === S.totalBorrow) return enc(['uint256'], [totalBorrowWei]);
        if (selector === S.getUtilization) return enc(['uint256'], [utilization]);
        if (selector === S.getSupplyRate) return enc(['uint64'], [supplyRatePerSecond]);
        if (selector === S.getPrice) {
          if (!(priceUsd8 > 0n)) throw new Error('execution reverted');
          return enc(['uint256'], [priceUsd8]);
        }
        if (selector === S.isSupplyPaused) return enc(['bool'], [supplyPaused]);
        if (selector === S.isWithdrawPaused) return enc(['bool'], [withdrawPaused]);
        if (selector === S.baseMinForRewards) return enc(['uint256'], [baseMinForRewards]);
        if (selector === S.baseTrackingSupplySpeed) return enc(['uint256'], [baseTrackingSupplySpeed]);
        if (selector === S.usdPerSupply) return enc(['uint256'], [usdPerSupplyWei]);
        if (selector === S.usdPerBorrow) return enc(['uint256'], [usdPerBorrowWei]);
        if (selector === S.supplyState) return enc(['uint256,uint256'], [totalSupplyWei, totalBorrowWei]);
        if (selector === S.getTotalSupply) return enc(['uint256'], [totalSupplyWei]);
        if (selector === S.getTotalBorrow) return enc(['uint256'], [totalBorrowWei]);
        if (selector === S.accountSupplyAssets) return enc(['uint256'], [positionWei]);
        if (selector === S.accountBorrowAssets) return enc(['uint256'], [borrowWei]);
        if (selector === S.collateralBalanceOf) return enc(['uint256'], [collateralBalanceWei]);
        if (selector === S.getHealthFactor) {
          if (healthFactorWei == null) throw new Error('execution reverted');
          return enc(['uint256'], [healthFactorWei]);
        }
      }

      if (to === String(configurator).toLowerCase() && selector === S.getConfiguration) {
        if (configuratorFails) throw new Error('execution reverted');
        return enc([CONFIGURATION_TUPLE], [[
          ZERO_ADDRESS, ZERO_ADDRESS, configBaseToken ?? usdc, PRICE_FEED, ZERO_ADDRESS,
          0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n,
          baseMinForRewards, 1n, 0n,
          assetConfigs.map((a) => [
            a.asset, a.priceFeed ?? PRICE_FEED, a.decimals ?? 8,
            a.borrowCollateralFactor ?? 0n, a.liquidateCollateralFactor ?? 0n,
            a.liquidationFactor ?? 0n, a.supplyCap ?? 0n
          ])
        ]]);
      }

      if (to === String(rewards).toLowerCase() && selector === S.getRewardOwed) {
        if (rewardsOwedWei == null) throw new Error('execution reverted');
        return enc(['tuple(address,uint256)'], [[rewardsToken, rewardsOwedWei]]);
      }

      if (to === String(usdc).toLowerCase()) {
        if (selector === S.allowance) return enc(['uint256'], [allowanceWei]);
        if (selector === S.balanceOf) return enc(['uint256'], [usdcBalanceWei]);
      }

      /* Configured collateral tokens answer like plain ERC20s. */
      if (collateralByAddress[to]) {
        const cfg = collateralByAddress[to];
        if (selector === S.balanceOf) return enc(['uint256'], [collateralBalanceWei]);
        if (selector === S.decimals20) return enc(['uint8'], [cfg.decimals ?? 8]);
      }

      throw new Error(`mock provider: unhandled call to ${to} selector ${selector}`);
    }
  };
  return provider;
}

/** Decode calldata with one of the interfaces above. */
export function decodeCall(ifaceName, fnName, data) {
  return IFACES[ifaceName].decodeFunctionData(fnName, data);
}

export { IFACES };
