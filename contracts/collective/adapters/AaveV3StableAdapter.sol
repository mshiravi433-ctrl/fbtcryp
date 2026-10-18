// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICollectiveInterfaces.sol";

contract AaveV3StableAdapter is IStrategyAdapter {
    address public immutable override asset;
    address public immutable vault;
    address public immutable pool; // Aave V3 Pool on Robinhood / Arbitrum Orbit
    address public immutable aToken;

    modifier onlyVault() {
        require(msg.sender == vault, "Adapter: only vault");
        _;
    }

    constructor(address _asset, address _vault, address _pool, address _aToken) {
        asset = _asset;
        vault = _vault;
        pool = _pool;
        aToken = _aToken;
    }

    function totalValue() external view override returns (uint256) {
        return IERC20(aToken).balanceOf(address(this));
    }

    function deposit(uint256 amount) external override onlyVault returns (uint256) {
        require(amount > 0, "Zero amount");
        IERC20(asset).transferFrom(vault, address(this), amount);
        IERC20(asset).approve(pool, amount);
        // Supply to Aave pool
        (bool success, ) = pool.call(
            abi.encodeWithSignature("supply(address,uint256,address,uint16)", asset, amount, address(this), 0)
        );
        require(success, "Supply to Aave failed");
        return amount;
    }

    function withdraw(uint256 amount, address recipient) external override onlyVault returns (uint256) {
        require(amount > 0, "Zero amount");
        // Withdraw from Aave pool
        (bool success, ) = pool.call(
            abi.encodeWithSignature("withdraw(address,uint256,address)", asset, amount, recipient)
        );
        require(success, "Withdraw from Aave failed");
        return amount;
    }

    function emergencyExit() external override onlyVault {
        uint256 bal = IERC20(aToken).balanceOf(address(this));
        if (bal > 0) {
            pool.call(abi.encodeWithSignature("withdraw(address,uint256,address)", asset, type(uint256).max, vault));
        }
    }
}
