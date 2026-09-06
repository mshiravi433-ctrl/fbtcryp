/**
 * A mock Aave v3 / Base provider for the adapter unit tests.
 *
 * This is NOT a mock of our own code — `aaveV3Base.js` runs for real, with its
 * real ABIs, real bitmap decoding and real ethers encoding. Only the CHAIN is
 * replaced: `provider.call` answers each selector the way a Base node would.
 *
 * It speaks both ReserveData struct layouts (v3.3+ and v3.0–v3.2) so the
 * adapter's shape-validation is exercised, and it can be told to lie — a wrong
 * Pool, a wrong aToken, a paused reserve — because the point of these tests is
 * that the adapter refuses those.
 */
import { AbiCoder, Interface } from 'ethers';

const coder = AbiCoder.defaultAbiCoder();

const IFACES = {
  addressesProvider: new Interface([
    'function getPool() view returns (address)',
    'function getPriceOracle() view returns (address)'
  ]),
  pool: new Interface([
    'function getConfiguration(address asset) view returns (uint256)',
    'function getUserAccountData(address user) view returns (uint256, uint256, uint256, uint256, uint256, uint256)',
    'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
    'function withdraw(address asset, uint256 amount, address to) returns (uint256)'
  ]),
  erc20: new Interface([
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function totalSupply() view returns (uint256)'
  ]),
  aToken: new Interface([
    'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
    'function POOL() view returns (address)'
  ]),
  oracle: new Interface(['function getAssetPrice(address asset) view returns (uint256)']),
  reserveData: new Interface(['function getReserveData(address asset) view returns (uint256[15])'])
};

const RAY = 10n ** 27n;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Build the ReserveConfiguration bitmap exactly the way
 * ReserveConfiguration.sol lays it out.
 */
export function encodeReserveConfig({
  ltvBps = 0,
  liquidationThresholdBps = 0,
  decimals = 6,
  active = true,
  frozen = false,
  paused = false,
  supplyCapWhole = 0n
} = {}) {
  let data = 0n;
  data |= BigInt(ltvBps) & 0xffffn;
  data |= (BigInt(liquidationThresholdBps) & 0xffffn) << 16n;
  data |= (BigInt(decimals) & 0xffn) << 48n;
  data |= (active ? 1n : 0n) << 56n;
  data |= (frozen ? 1n : 0n) << 57n;
  data |= (paused ? 1n : 0n) << 60n;
  data |= (BigInt(supplyCapWhole) & ((1n << 36n) - 1n)) << 116n;
  return data;
}

/** Encode the raw ReserveData tuple for one of the two known layouts. */
export function encodeReserveData({ shape = 'v3.3+', config, liquidityRateRay, aToken, liquidityIndex = RAY }) {
  if (shape === 'v3.3+') {
    return coder.encode(
      ['tuple(uint256, uint128, uint128, uint128, uint128, uint40, uint16, address, address, uint128, uint128, uint128, uint128)'],
      [[
        config, liquidityIndex, liquidityRateRay, RAY + 1n, RAY + 2n,
        1700000000, 3, aToken, ZERO_ADDRESS, 0n, 0n, 0n, 0n
      ]]
    );
  }
  return coder.encode(
    ['tuple(uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address, address, uint128, uint128, uint128)'],
    [[
      config, liquidityIndex, liquidityRateRay, RAY + 1n, RAY + 2n, 0n,
      1700000000, 3, aToken, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 0n, 0n, 0n
    ]]
  );
}

/**
 * @param {object} cfg
 * @param {string} [cfg.pool]            what PoolAddressesProvider.getPool() returns
 * @param {string} [cfg.aToken]          what getReserveData says the aToken is
 * @param {string} cfg.usdc              the underlying USDC address (chains.js value)
 * @param {string} cfg.pinnedPool        what the adapter pinned as the Pool
 * @param {string} cfg.pinnedAToken      what the adapter pinned as aBasUSDC
 * @param {string} [cfg.reserveDataShape] 'v3.3+' | 'v3.0-v3.2' | 'garbage'
 * @param {bigint} [cfg.configBitmap]
 * @param {bigint} [cfg.liquidityRateRay]
 * @param {bigint} [cfg.allowanceWei]    USDC allowance the Pool already holds
 * @param {bigint} [cfg.usdcBalanceWei]  the owner's USDC balance
 * @param {bigint} [cfg.aTokenBalanceWei] the owner's aToken balance (position)
 * @param {bigint} [cfg.totalSupplyWei]  aToken total supply (reserve size)
 * @param {bigint} [cfg.nativeBalanceWei]
 * @param {number} [cfg.oraclePriceUsd8] 1e8-based USD price, or 0 to make the read fail
 */
export function makeAaveProvider({
  pool,
  aToken,
  usdc,
  pinnedPool,
  pinnedAToken,
  reserveDataShape = 'v3.3+',
  configBitmap,
  liquidityRateRay = RAY / 20n, // 5.00% APY
  allowanceWei = 0n,
  usdcBalanceWei = 0n,
  aTokenBalanceWei = 0n,
  totalSupplyWei = 0n,
  nativeBalanceWei = 10n ** 18n,
  oraclePriceUsd8 = 100000000n,
  chainId = 8453,
  calls = []
} = {}) {
  const sel = {
    getPool: IFACES.addressesProvider.getFunction('getPool').selector,
    getPriceOracle: IFACES.addressesProvider.getFunction('getPriceOracle').selector,
    getConfiguration: IFACES.pool.getFunction('getConfiguration').selector,
    getUserAccountData: IFACES.pool.getFunction('getUserAccountData').selector,
    getReserveData: IFACES.reserveData.getFunction('getReserveData').selector,
    balanceOf: IFACES.erc20.getFunction('balanceOf').selector,
    allowance: IFACES.erc20.getFunction('allowance').selector,
    totalSupply: IFACES.erc20.getFunction('totalSupply').selector,
    underlying: IFACES.aToken.getFunction('UNDERLYING_ASSET_ADDRESS').selector,
    aPool: IFACES.aToken.getFunction('POOL').selector,
    getAssetPrice: IFACES.oracle.getFunction('getAssetPrice').selector
  };

  const provider = {
    calls,
    async getNetwork() { return { chainId: BigInt(chainId) }; },
    async getBalance() { return nativeBalanceWei; },
    async estimateGas() { return 120000n; },
    async call(tx) {
      calls.push({ to: String(tx.to).toLowerCase(), selector: String(tx.data).slice(0, 10), data: tx.data });
      const to = String(tx.to).toLowerCase();
      const selector = String(tx.data).slice(0, 10);
      const enc = (types, values) => coder.encode(types, values);

      if (to === String(pool ?? pinnedPool).toLowerCase()) {
        if (selector === sel.getConfiguration) return enc(['uint256'], [configBitmap ?? 0n]);
        if (selector === sel.getUserAccountData) {
          // No debt: Aave reports type(uint256).max as the health factor.
          return enc(
            ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
            [aTokenBalanceWei, 0n, 0n, 0n, 0n, 2n ** 256n - 1n]
          );
        }
        if (selector === sel.getReserveData) {
          if (reserveDataShape === 'garbage') return enc(['uint256'], [0n]);
          return encodeReserveData({
            shape: reserveDataShape,
            config: configBitmap ?? encodeReserveConfig(),
            liquidityRateRay,
            aToken: aToken ?? pinnedAToken
          });
        }
      }
      // The addresses provider is a different contract; getPool()/getPriceOracle()
      if (selector === sel.getPool) return enc(['address'], [pool ?? pinnedPool]);
      if (selector === sel.getPriceOracle) {
        return enc(['address'], [oraclePriceUsd8 > 0n ? '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156' : ZERO_ADDRESS]);
      }
      if (selector === sel.getAssetPrice) {
        if (!(oraclePriceUsd8 > 0n)) throw new Error('execution reverted');
        return enc(['uint256'], [oraclePriceUsd8]);
      }
      if (selector === sel.underlying) return enc(['address'], [usdc]);
      if (selector === sel.aPool) return enc(['address'], [pinnedPool]);
      if (selector === sel.totalSupply) return enc(['uint256'], [totalSupplyWei]);
      if (selector === sel.allowance) return enc(['uint256'], [allowanceWei]);
      if (selector === sel.balanceOf) {
        // aToken balance == position; USDC balance == spendable.
        return enc(['uint256'], [to === String(aToken ?? pinnedAToken).toLowerCase() ? aTokenBalanceWei : usdcBalanceWei]);
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
