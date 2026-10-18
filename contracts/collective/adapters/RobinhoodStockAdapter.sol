// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICollectiveInterfaces.sol";

contract RobinhoodStockAdapter is IStrategyAdapter {
    address public immutable override asset; // Counter currency (e.g. USDG / USDT)
    address public immutable vault;
    address public immutable stockToken; // Tokenized equity (e.g. NVDA, AAPL)
    address public immutable swapRouter; // Kyber or OpenOcean router

    modifier onlyVault() {
        require(msg.sender == vault, "Adapter: only vault");
        _;
    }

    constructor(address _asset, address _vault, address _stockToken, address _swapRouter) {
        asset = _asset;
        vault = _vault;
        stockToken = _stockToken;
        swapRouter = _swapRouter;
    }

    function totalValue() external view override returns (uint256) {
        return IERC20(stockToken).balanceOf(address(this));
    }

    function deposit(uint256 amount) external override onlyVault returns (uint256) {
        require(amount > 0, "Zero amount");
        IERC20(asset).transferFrom(vault, address(this), amount);
        return amount;
    }

    function withdraw(uint256 amount, address recipient) external override onlyVault returns (uint256) {
        require(amount > 0, "Zero amount");
        IERC20(asset).transfer(recipient, amount);
        return amount;
    }

    function emergencyExit() external override onlyVault {
        uint256 stockBal = IERC20(stockToken).balanceOf(address(this));
        if (stockBal > 0) {
            IERC20(stockToken).transfer(vault, stockBal);
        }
        uint256 assetBal = IERC20(asset).balanceOf(address(this));
        if (assetBal > 0) {
            IERC20(asset).transfer(vault, assetBal);
        }
    }
}
