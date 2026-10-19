// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICollectivePriceOracle, ICollectiveLiquidityOracle} from "../interfaces/ICollective.sol";

/**
 * @title DeclaredPriceOracle
 * @notice A fixed, operator-declared USD price for exactly one accounting asset
 *         (normally a USD stablecoin) plus one declared native-gas price.
 *
 * This is NOT a market feed and NOT an independent observation. It reports the
 * constructor values and the current block timestamp, so the RiskController's
 * staleness check can never fail: the value is a governance declaration, not a
 * measurement. That is only acceptable for a vault whose accounting asset is a
 * USD peg (a $1.00 declaration) and whose per-trade and per-epoch limits are
 * sized as if the peg could break. Never use it for a volatile token, and never
 * use it for the trading lane, which needs two independently observed prices.
 *
 * The declared native price exists only so the on-chain transaction-cost
 * ceiling can be evaluated. It must be reviewed again whenever the gas price
 * environment changes materially. Every assumption is repeated in
 * docs/collective/ACTIVATION-FA.md.
 */
contract DeclaredPriceOracle is ICollectivePriceOracle {
    address public immutable asset;
    uint256 public immutable declaredAssetPriceUsdE8;
    uint256 public immutable declaredNativePriceUsdE8;

    error InvalidConfiguration();

    constructor(address asset_, uint256 assetPriceUsdE8_, uint256 nativePriceUsdE8_) {
        if (asset_.code.length == 0 || assetPriceUsdE8_ == 0 || nativePriceUsdE8_ == 0) {
            revert InvalidConfiguration();
        }
        asset = asset_;
        declaredAssetPriceUsdE8 = assetPriceUsdE8_;
        declaredNativePriceUsdE8 = nativePriceUsdE8_;
    }

    function tokenPriceUsdE8(address token) external view override returns (uint256 priceUsdE8, uint64 updatedAt) {
        if (token != asset) return (0, 0);
        return (declaredAssetPriceUsdE8, uint64(block.timestamp));
    }

    function nativePriceUsdE8() external view override returns (uint256 priceUsdE8, uint64 updatedAt) {
        return (declaredNativePriceUsdE8, uint64(block.timestamp));
    }
}

/**
 * @title DisabledLiquidityOracle
 * @notice Reports zero observable pair liquidity for every pair.
 *
 * The stable-yield lane never reads this oracle; it exists because the v1
 * RiskController requires a deployed liquidity oracle at construction. The
 * approved-token trading lane remains disabled in v1, and returning zero means
 * that even a misconfigured future swap can only fail the liquidity gate closed.
 */
contract DisabledLiquidityOracle is ICollectiveLiquidityOracle {
    function pairLiquidityUsdE8(address, address, address)
        external
        view
        override
        returns (uint256 liquidityUsdE8, uint64 updatedAt)
    {
        return (0, uint64(block.timestamp));
    }
}
