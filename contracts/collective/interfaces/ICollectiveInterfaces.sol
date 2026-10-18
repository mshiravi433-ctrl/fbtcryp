// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface IRiskController {
    function isApprovedRouter(address router) external view returns (bool);
    function isApprovedToken(address token) external view returns (bool);
    function isApprovedProtocol(address protocol) external view returns (bool);
    function validateTrade(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address targetRouter
    ) external view returns (bool);
    function maxSlippageBps() external view returns (uint256);
    function maxConcentrationBps() external view returns (uint256);
}

interface IEpochManager {
    function currentEpoch() external view returns (uint256);
    function epochDuration() external view returns (uint256);
    function epochStartTime(uint256 epochId) external view returns (uint256);
    function isWithdrawalWindowOpen() external view returns (bool);
    function windowDuration() external view returns (uint256);
}

interface IRewardAccounting {
    function distributeReward(address token, uint256 amount) external;
    function claimReward(address user) external returns (uint256);
    function earnedReward(address user) external view returns (uint256);
}

interface IWithdrawalQueue {
    function requestWithdrawal(address user, uint256 shares) external returns (uint256 requestId);
    function cancelWithdrawal(uint256 requestId) external;
    function processQueue(uint256 maxCount) external returns (uint256 processedCount);
    function getUserPendingShares(address user) external view returns (uint256);
}

interface IStrategyAdapter {
    function asset() external view returns (address);
    function totalValue() external view returns (uint256);
    function deposit(uint256 amount) external returns (uint256);
    function withdraw(uint256 amount, address recipient) external returns (uint256);
    function emergencyExit() external;
}
