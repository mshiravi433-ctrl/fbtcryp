// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEpochManager} from "./interfaces/ICollective.sol";

/**
 * Rolling 30-day epochs (not calendar months). After the first epoch, shares
 * are subscribed only in the seven-day window after settlement; initial
 * enrollment remains open until the first epoch is actually started so a quiet
 * launch cannot strand deposits behind an expired timer. No minting is allowed
 * during an active epoch. The epoch-start checkpoint is therefore the exact
 * income-eligibility snapshot and excludes mid-epoch deposits.
 */
contract EpochManager is IEpochManager {
    uint64 public constant EPOCH_DURATION = 30 days;
    uint64 public constant WITHDRAWAL_WINDOW = 7 days;
    uint64 public constant SUBSCRIPTION_WINDOW = 7 days;

    address public immutable override vault;
    uint64 public subscriptionDeadline;

    uint64 public override currentEpoch = 1;
    uint64 public override currentEpochStart;
    uint64 public override currentEpochEnd;
    uint48 public override currentSnapshotBlock;
    uint64 public lastSettledBlock;
    bool public override started;

    event EpochStarted(uint64 indexed epoch, uint64 start, uint64 end, uint48 snapshotBlock);
    event EpochClosed(uint64 indexed epoch, uint48 indexed snapshotBlock, uint64 subscriptionDeadline);

    error OnlyVault();
    error SubscriptionWindowClosed(uint64 deadline);
    error AlreadyStarted();
    error NotStarted();
    error EpochNotEnded(uint64 end);
    error SameBlockSettlement();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_) {
        require(vault_ != address(0), "ZERO_VAULT");
        vault = vault_;
        subscriptionDeadline = uint64(block.timestamp + SUBSCRIPTION_WINDOW);
    }

    function depositsOpen() external view override returns (bool) {
        // Before epoch one, an expired first-launch timer must not permanently
        // prevent a later depositor from joining the initial cohort.
        return !started && (currentEpoch == 1 || block.timestamp < subscriptionDeadline);
    }

    function withdrawalWindowOpen() external view override returns (bool) {
        // After a 30-day period ends, requests can queue even if settlement is
        // delayed while a strategy position is made liquid. Once settlement
        // completes, keep the same seven-day window open for the next cohort.
        if (started) return block.timestamp >= currentEpochEnd;
        return currentEpoch > 1 && block.timestamp < subscriptionDeadline;
    }

    /** Permissionless start after subscription closes; StrategyVault requires an existing snapshot supply. */
    function startFirstEpoch() external override {
        if (started) revert AlreadyStarted();
        if (block.timestamp < subscriptionDeadline) revert SubscriptionWindowClosed(subscriptionDeadline);
        started = true;
        currentEpochStart = uint64(block.timestamp);
        currentEpochEnd = uint64(block.timestamp + EPOCH_DURATION);
        currentSnapshotBlock = block.number == 0 ? 0 : uint48(block.number - 1);
        emit EpochStarted(currentEpoch, currentEpochStart, currentEpochEnd, currentSnapshotBlock);
    }

    /** Called by the vault after the active 30-day period has elapsed. */
    function settleEpoch() external override onlyVault returns (uint64 epoch, uint48 snapshotBlock) {
        if (!started) revert NotStarted();
        if (block.timestamp < currentEpochEnd) revert EpochNotEnded(currentEpochEnd);
        if (block.number <= lastSettledBlock) revert SameBlockSettlement();

        epoch = currentEpoch;
        snapshotBlock = currentSnapshotBlock;
        lastSettledBlock = uint64(block.number);
        started = false;
        currentEpoch += 1;
        currentEpochStart = 0;
        currentEpochEnd = 0;
        currentSnapshotBlock = 0;
        subscriptionDeadline = uint64(block.timestamp + SUBSCRIPTION_WINDOW);
        emit EpochClosed(epoch, snapshotBlock, subscriptionDeadline);
    }
}
