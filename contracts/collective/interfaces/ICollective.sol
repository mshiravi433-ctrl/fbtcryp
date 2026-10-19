// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface ICollectiveAccessController {
    function hasRole(bytes32 role, address account) external view returns (bool);
    function GOVERNOR_ROLE() external view returns (bytes32);
    function GUARDIAN_ROLE() external view returns (bytes32);
    function KEEPER_ROLE() external view returns (bytes32);
    function FACTORY_ROLE() external view returns (bytes32);
    function EXECUTION_ROUTER_ROLE() external view returns (bytes32);
    function VAULT_ROLE() external view returns (bytes32);
}

interface IEmergencyModule {
    function paused() external view returns (bool);
}

interface ICollectivePriceOracle {
    /// @return priceUsdE8 USD value of one whole token, scaled by 1e8.
    /// @return updatedAt Timestamp of the last valid observation.
    function tokenPriceUsdE8(address token) external view returns (uint256 priceUsdE8, uint64 updatedAt);

    /// @return priceUsdE8 USD value of one native gas token, scaled by 1e8.
    function nativePriceUsdE8() external view returns (uint256 priceUsdE8, uint64 updatedAt);
}

interface ICollectiveLiquidityOracle {
    /// @return liquidityUsdE8 trusted, on-chain pair liquidity observation, scaled by 1e8.
    /// @return updatedAt Timestamp of the observation.
    function pairLiquidityUsdE8(address router, address tokenA, address tokenB)
        external view returns (uint256 liquidityUsdE8, uint64 updatedAt);
}

interface IRiskController {
    struct Limits {
        uint128 maxTradeUsdE8;
        uint128 maxTxCostUsdE8;
        uint128 minLiquidityUsdE8;
        uint16 maxAllocationBps;
        uint16 maxConcentrationBps;
        uint16 maxSlippageBps;
        uint16 reserveBps;
        uint32 maxOracleAgeSeconds;
        bool enabled;
    }

    function isAssetAllowed(address asset) external view returns (bool);
    function isProtocolAllowed(address protocol) external view returns (bool);
    function isRouterAllowed(address router) external view returns (bool);
    function isExpenseRecipient(address recipient) external view returns (bool);
    function isKindEnabled(uint8 kind) external view returns (bool);
    function reserveBps(address vault) external view returns (uint16);
    function limits(address vault) external view returns (Limits memory);
    function validateInvestment(address vault, address protocol, address asset, uint256 amount, uint256 nav)
        external view;
    function validateSwap(
        address vault,
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 quotedAmountOut
    ) external view;
    function registerVault(address vault, uint8 kind, address asset, address protocol, Limits calldata limits)
        external;
}

interface IEpochManager {
    function vault() external view returns (address);
    function currentEpoch() external view returns (uint64);
    function currentEpochStart() external view returns (uint64);
    function currentEpochEnd() external view returns (uint64);
    function currentSnapshotBlock() external view returns (uint48);
    function started() external view returns (bool);
    function depositsOpen() external view returns (bool);
    function withdrawalWindowOpen() external view returns (bool);
    function startFirstEpoch() external;
    function settleEpoch() external returns (uint64 epoch, uint48 snapshotBlock);
}

interface IStrategyAdapter {
    function vault() external view returns (address);
    function asset() external view returns (address);
    function protocol() external view returns (address);
    function principalBasis() external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function positionShares() external view returns (uint256);
    function deposit(uint256 assets) external returns (uint256 shares);
    function withdraw(uint256 assets) external returns (int256 realizedPnl, uint256 assetsReceived);
    function liquidate() external returns (int256 realizedPnl, uint256 assetsReceived);
}

interface IStrategyVault {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function moveTradeInput(address token, uint256 amount) external;
    function queuedPayoutAvailable() external view returns (uint256);
    function payoutQueuedClaim(address receiver, uint256 amount) external;
}

interface IWithdrawalQueue {
    function vault() external view returns (address);
    function enqueue(address owner, uint256 shares, uint256 assets) external returns (uint256 id);
    function process(uint256 maxItems) external returns (uint256 assetsPaid, uint256 itemsProcessed);
    function head() external view returns (uint256);
    function nextId() external view returns (uint256);
    function request(uint256 id) external view returns (address owner, uint256 shares, uint256 remainingAssets, uint64 requestedAt);
}

interface IUniswapV2RouterLike {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
