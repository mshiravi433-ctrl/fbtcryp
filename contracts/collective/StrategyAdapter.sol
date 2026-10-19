// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IRiskController, IStrategyAdapter} from "./interfaces/ICollective.sol";

interface IStrategyVaultRiskView {
    function riskController() external view returns (address);
}

/**
 * Minimal stable-yield adapter for one immutable, allowlisted ERC-4626 target.
 * It never accepts arbitrary calldata or destination addresses. The underlying
 * share position stays here; exits always return the accounting asset directly
 * to the vault. Principal basis is reduced pro rata by shares actually burned,
 * so only value above/below that basis is reported as realized P&L.
 */
contract StrategyAdapter is IStrategyAdapter {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IERC20 public immutable underlying;
    IERC4626 public immutable target;
    address public immutable override vault;
    address public immutable override asset;
    address public immutable override protocol;
    uint256 public override principalBasis;

    event Invested(uint256 assets, uint256 strategyShares, uint256 principalBasis);
    event Divested(uint256 requestedAssets, uint256 receivedAssets, uint256 basisRemoved, int256 realizedPnl);
    event Liquidated(uint256 receivedAssets, uint256 basisRemoved, int256 realizedPnl);

    error OnlyVault();
    error InvalidTarget();
    error ZeroAmount();
    error InsufficientStrategyValue();
    error InvalidShareChange();
    error UnsupportedAssetTransfer();
    error SlippageExceeded(uint256 minimum, uint256 actual);

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_, IERC20 asset_, IERC4626 target_) {
        require(vault_ != address(0) && address(asset_) != address(0) && address(target_) != address(0), "ZERO_ADDRESS");
        if (address(target_).code.length == 0 || target_.asset() != address(asset_)) revert InvalidTarget();
        vault = vault_;
        asset = address(asset_);
        protocol = address(target_);
        underlying = asset_;
        target = target_;
    }

    function totalAssets() external view override returns (uint256) {
        uint256 shares = target.balanceOf(address(this));
        if (shares == 0) return 0;
        return target.convertToAssets(shares);
    }

    function positionShares() external view override returns (uint256) {
        return target.balanceOf(address(this));
    }

    function deposit(uint256 assets) external override onlyVault returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (target.maxDeposit(address(this)) < assets) revert InsufficientStrategyValue();
        uint256 expectedShares = target.previewDeposit(assets);
        if (expectedShares == 0) revert InvalidShareChange();
        uint16 maxSlippageBps = _maxSlippageBps();
        uint256 minShares = Math.mulDiv(expectedShares, BPS - maxSlippageBps, BPS);

        uint256 beforeAssets = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(vault, address(this), assets);
        uint256 received = underlying.balanceOf(address(this)) - beforeAssets;
        if (received != assets) revert UnsupportedAssetTransfer();

        uint256 beforeShares = target.balanceOf(address(this));
        underlying.forceApprove(address(target), assets);
        shares = target.deposit(assets, address(this));
        underlying.forceApprove(address(target), 0);
        uint256 afterShares = target.balanceOf(address(this));
        if (afterShares <= beforeShares) revert InvalidShareChange();
        uint256 mintedShares = afterShares - beforeShares;
        if (shares != mintedShares) revert InvalidShareChange();
        if (mintedShares < minShares) revert SlippageExceeded(minShares, mintedShares);

        principalBasis += assets;
        emit Invested(assets, mintedShares, principalBasis);
    }

    function withdraw(uint256 assets)
        external override onlyVault returns (int256 realizedPnl, uint256 assetsReceived)
    {
        if (assets == 0) revert ZeroAmount();
        uint256 sharesBefore = target.balanceOf(address(this));
        if (sharesBefore == 0) revert InsufficientStrategyValue();
        uint256 valueBefore = target.convertToAssets(sharesBefore);
        if (assets > valueBefore || target.maxWithdraw(address(this)) < assets) revert InsufficientStrategyValue();
        uint16 maxSlippageBps = _maxSlippageBps();
        uint256 minAssetsReceived = Math.mulDiv(assets, BPS - maxSlippageBps, BPS);

        uint256 vaultBalanceBefore = underlying.balanceOf(vault);
        target.withdraw(assets, vault, address(this));
        assetsReceived = underlying.balanceOf(vault) - vaultBalanceBefore;
        if (assetsReceived < minAssetsReceived) revert SlippageExceeded(minAssetsReceived, assetsReceived);
        uint256 sharesAfter = target.balanceOf(address(this));
        if (sharesAfter >= sharesBefore || assetsReceived == 0) revert InvalidShareChange();

        uint256 sharesBurned = sharesBefore - sharesAfter;
        uint256 basisRemoved = sharesBurned == sharesBefore
            ? principalBasis
            : Math.mulDiv(principalBasis, sharesBurned, sharesBefore);
        if (basisRemoved > principalBasis) revert InvalidShareChange();
        principalBasis -= basisRemoved;
        realizedPnl = _signedDifference(assetsReceived, basisRemoved);
        emit Divested(assets, assetsReceived, basisRemoved, realizedPnl);
    }

    function liquidate() external override onlyVault returns (int256 realizedPnl, uint256 assetsReceived) {
        uint256 sharesBefore = target.balanceOf(address(this));
        if (sharesBefore == 0) return (0, 0);
        uint256 basisRemoved = principalBasis;
        uint256 expectedAssets = target.previewRedeem(sharesBefore);
        uint16 maxSlippageBps = _maxSlippageBps();
        uint256 minAssetsReceived = Math.mulDiv(expectedAssets, BPS - maxSlippageBps, BPS);
        uint256 vaultBalanceBefore = underlying.balanceOf(vault);
        target.redeem(sharesBefore, vault, address(this));
        assetsReceived = underlying.balanceOf(vault) - vaultBalanceBefore;
        if (assetsReceived < minAssetsReceived) revert SlippageExceeded(minAssetsReceived, assetsReceived);
        if (target.balanceOf(address(this)) != 0) revert InvalidShareChange();
        principalBasis = 0;
        realizedPnl = _signedDifference(assetsReceived, basisRemoved);
        emit Liquidated(assetsReceived, basisRemoved, realizedPnl);
    }

    function _maxSlippageBps() private view returns (uint16) {
        address riskAddress = IStrategyVaultRiskView(vault).riskController();
        if (riskAddress.code.length == 0) revert InvalidTarget();
        IRiskController.Limits memory policy = IRiskController(riskAddress).limits(vault);
        if (policy.maxSlippageBps > 1_000) revert InvalidTarget();
        return policy.maxSlippageBps;
    }

    function _signedDifference(uint256 value, uint256 basis) private pure returns (int256) {
        if (value >= basis) {
            uint256 delta = value - basis;
            require(delta <= uint256(type(int256).max), "PNL_OVERFLOW");
            return int256(delta);
        }
        uint256 loss = basis - value;
        require(loss <= uint256(type(int256).max), "PNL_OVERFLOW");
        return -int256(loss);
    }
}
