// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBTSolverRegistry
/// @notice On-chain solver registry with bonding, reputation, and slashing
contract FBTSolverRegistry {
    enum SolverStatus { Inactive, Active, Suspended, Retired }

    struct SolverInfo {
        address solverAddress;
        string solverId;
        SolverStatus status;
        uint256 stake;
        uint256 reputation; // 0 - 100
        uint256 registeredAt;
        uint256 unstakeUnlockTime;
    }

    uint256 public constant MINIMUM_BOND = 0.1 ether;
    uint256 public constant UNSTAKE_COOLDOWN = 3 days;

    address public owner;
    address public settlementEngine;

    mapping(string => SolverInfo) public solvers;
    mapping(address => string) public addressToSolverId;

    event SolverRegistered(string indexed solverId, address indexed solverAddress, uint256 stake);
    event SolverStakeDeposited(string indexed solverId, uint256 addedStake, uint256 totalStake);
    event SolverUnstakeRequested(string indexed solverId, uint256 unlockTime);
    event SolverUnstakeCompleted(string indexed solverId, uint256 withdrawn);
    event SolverStatusChanged(string indexed solverId, SolverStatus status);
    event SolverReputationUpdated(string indexed solverId, uint256 newReputation);
    event SolverSlashed(string indexed solverId, uint256 penaltyAmount, string reason);

    error Unauthorized();
    error SolverAlreadyExists(string solverId);
    error SolverNotFound(string solverId);
    error InsufficientBond(uint256 provided, uint256 required);
    error CooldownNotElapsed(uint256 unlockTime, uint256 currentTime);
    error SolverNotActive(string solverId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlySettlementOrOwner() {
        if (msg.sender != settlementEngine && msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setSettlementEngine(address _settlementEngine) external onlyOwner {
        settlementEngine = _settlementEngine;
    }

    function registerSolver(string calldata solverId) external payable {
        if (solvers[solverId].solverAddress != address(0)) revert SolverAlreadyExists(solverId);
        if (msg.value < MINIMUM_BOND) revert InsufficientBond(msg.value, MINIMUM_BOND);

        solvers[solverId] = SolverInfo({
            solverAddress: msg.sender,
            solverId: solverId,
            status: SolverStatus.Active,
            stake: msg.value,
            reputation: 90,
            registeredAt: block.timestamp,
            unstakeUnlockTime: 0
        });

        addressToSolverId[msg.sender] = solverId;
        emit SolverRegistered(solverId, msg.sender, msg.value);
    }

    function depositStake(string calldata solverId) external payable {
        SolverInfo storage s = solvers[solverId];
        if (s.solverAddress == address(0)) revert SolverNotFound(solverId);
        if (msg.sender != s.solverAddress && msg.sender != owner) revert Unauthorized();

        s.stake += msg.value;
        if (s.status == SolverStatus.Inactive && s.stake >= MINIMUM_BOND) {
            s.status = SolverStatus.Active;
        }

        emit SolverStakeDeposited(solverId, msg.value, s.stake);
    }

    function requestUnstake(string calldata solverId) external {
        SolverInfo storage s = solvers[solverId];
        if (msg.sender != s.solverAddress) revert Unauthorized();

        s.status = SolverStatus.Retired;
        s.unstakeUnlockTime = block.timestamp + UNSTAKE_COOLDOWN;
        emit SolverUnstakeRequested(solverId, s.unstakeUnlockTime);
    }

    function withdrawStake(string calldata solverId) external {
        SolverInfo storage s = solvers[solverId];
        if (msg.sender != s.solverAddress) revert Unauthorized();
        if (s.unstakeUnlockTime == 0 || block.timestamp < s.unstakeUnlockTime) {
            revert CooldownNotElapsed(s.unstakeUnlockTime, block.timestamp);
        }

        uint256 amount = s.stake;
        s.stake = 0;
        s.status = SolverStatus.Inactive;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH transfer failed");

        emit SolverUnstakeCompleted(solverId, amount);
    }

    function updateReputation(string calldata solverId, uint256 newScore) external onlySettlementOrOwner {
        SolverInfo storage s = solvers[solverId];
        if (s.solverAddress == address(0)) revert SolverNotFound(solverId);
        s.reputation = newScore > 100 ? 100 : newScore;
        emit SolverReputationUpdated(solverId, s.reputation);
    }

    function slashSolver(string calldata solverId, uint256 penaltyAmount, string calldata reason) external onlySettlementOrOwner {
        SolverInfo storage s = solvers[solverId];
        if (s.solverAddress == address(0)) revert SolverNotFound(solverId);

        uint256 penalty = penaltyAmount > s.stake ? s.stake : penaltyAmount;
        s.stake -= penalty;

        if (s.stake < MINIMUM_BOND) {
            s.status = SolverStatus.Suspended;
            emit SolverStatusChanged(solverId, SolverStatus.Suspended);
        }

        emit SolverSlashed(solverId, penalty, reason);
    }

    function isSolverEligible(string calldata solverId) external view returns (bool) {
        SolverInfo memory s = solvers[solverId];
        return s.status == SolverStatus.Active && s.stake >= MINIMUM_BOND;
    }
}
