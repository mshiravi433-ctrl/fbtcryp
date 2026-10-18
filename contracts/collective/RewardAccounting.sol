// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ICollectiveInterfaces.sol";

contract RewardAccounting is IRewardAccounting {
    address public immutable vault;
    IERC20 public immutable usdtToken;

    uint256 public rewardPerShareStored;
    uint256 public lastUpdateTime;
    uint256 public totalDistributed;

    mapping(address => uint256) public userRewardPerSharePaid;
    mapping(address => uint256) public rewards;

    event RewardDistributed(uint256 amount, uint256 rewardPerShare);
    event RewardPaid(address indexed user, uint256 reward);

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault allowed");
        _;
    }

    constructor(address _vault, address _usdt) {
        require(_vault != address(0) && _usdt != address(0), "Invalid address");
        vault = _vault;
        usdtToken = IERC20(_usdt);
    }

    function earnedReward(address user) public view override returns (uint256) {
        uint256 balance = IERC20(vault).balanceOf(user);
        uint256 diff = rewardPerShareStored - userRewardPerSharePaid[user];
        return rewards[user] + (balance * diff) / 1e18;
    }

    function updateReward(address user) internal {
        if (user != address(0)) {
            rewards[user] = earnedReward(user);
            userRewardPerSharePaid[user] = rewardPerShareStored;
        }
    }

    function onShareBalanceChange(address user) external onlyVault {
        updateReward(user);
    }

    function distributeReward(address token, uint256 amount) external override onlyVault {
        require(token == address(usdtToken), "Only USDT supported for dividends");
        require(amount > 0, "Amount must be > 0");

        uint256 totalShares = IERC20(vault).totalSupply();
        require(totalShares > 0, "No shares available");

        rewardPerShareStored += (amount * 1e18) / totalShares;
        totalDistributed += amount;
        lastUpdateTime = block.timestamp;

        emit RewardDistributed(amount, rewardPerShareStored);
    }

    function claimReward(address user) external override onlyVault returns (uint256) {
        updateReward(user);
        uint256 reward = rewards[user];
        if (reward > 0) {
            rewards[user] = 0;
            require(usdtToken.transfer(user, reward), "USDT transfer failed");
            emit RewardPaid(user, reward);
        }
        return reward;
    }
}
