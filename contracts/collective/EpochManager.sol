// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ICollectiveInterfaces.sol";

contract EpochManager is IEpochManager {
    address public owner;
    address public keeper;

    uint256 public override currentEpoch = 1;
    uint256 public override epochDuration = 30 days;
    uint256 public override windowDuration = 5 days; // Last 5 days of epoch for withdrawal requests

    mapping(uint256 => uint256) public override epochStartTime;
    mapping(uint256 => bool) public epochSettled;

    event EpochStarted(uint256 indexed epochId, uint256 startTime);
    event EpochSettled(uint256 indexed epochId, uint256 settledAt);
    event KeeperUpdated(address indexed newKeeper);

    modifier onlyAuthorized() {
        require(msg.sender == owner || msg.sender == keeper, "EpochManager: unauthorized");
        _;
    }

    constructor(address _owner, address _keeper) {
        require(_owner != address(0), "Invalid owner");
        owner = _owner;
        keeper = _keeper;
        epochStartTime[1] = block.timestamp;
        emit EpochStarted(1, block.timestamp);
    }

    function setKeeper(address _keeper) external {
        require(msg.sender == owner, "Only owner");
        keeper = _keeper;
        emit KeeperUpdated(_keeper);
    }

    function isWithdrawalWindowOpen() public view override returns (bool) {
        uint256 start = epochStartTime[currentEpoch];
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= epochDuration) return true;
        return elapsed >= (epochDuration - windowDuration);
    }

    function canSettle() public view returns (bool) {
        uint256 start = epochStartTime[currentEpoch];
        return (block.timestamp >= start + epochDuration) && !epochSettled[currentEpoch];
    }

    function advanceEpoch() external onlyAuthorized returns (uint256) {
        require(canSettle(), "Current epoch not ready to settle");
        epochSettled[currentEpoch] = true;
        emit EpochSettled(currentEpoch, block.timestamp);

        currentEpoch += 1;
        epochStartTime[currentEpoch] = block.timestamp;
        emit EpochStarted(currentEpoch, block.timestamp);
        return currentEpoch;
    }
}
