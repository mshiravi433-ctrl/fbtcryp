// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBTIntentRegistry
/// @notice On-chain discovery and status indexing registry for FBT Intents
contract FBTIntentRegistry {
    enum IntentOnChainStatus { None, Registered, Executed, Cancelled }

    struct IntentMetadata {
        bytes32 intentId;
        address user;
        uint256 sourceChainId;
        uint256 destinationChainId;
        uint256 deadline;
        IntentOnChainStatus status;
        bytes32 receiptId;
    }

    address public owner;
    address public settlementEngine;

    mapping(bytes32 => IntentMetadata) public intents;

    event IntentRegistered(bytes32 indexed intentId, address indexed user, uint256 deadline);
    event IntentStatusUpdated(bytes32 indexed intentId, IntentOnChainStatus status, bytes32 receiptId);

    error Unauthorized();

    modifier onlySettlementOrOwner() {
        if (msg.sender != settlementEngine && msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setSettlementEngine(address _engine) external {
        if (msg.sender != owner) revert Unauthorized();
        settlementEngine = _engine;
    }

    function registerIntent(
        bytes32 intentId,
        address user,
        uint256 sourceChainId,
        uint256 destinationChainId,
        uint256 deadline
    ) external {
        require(intents[intentId].intentId == bytes32(0), "Already registered");
        intents[intentId] = IntentMetadata({
            intentId: intentId,
            user: user,
            sourceChainId: sourceChainId,
            destinationChainId: destinationChainId,
            deadline: deadline,
            status: IntentOnChainStatus.Registered,
            receiptId: bytes32(0)
        });

        emit IntentRegistered(intentId, user, deadline);
    }

    function updateIntentStatus(
        bytes32 intentId,
        IntentOnChainStatus status,
        bytes32 receiptId
    ) external onlySettlementOrOwner {
        IntentMetadata storage item = intents[intentId];
        item.status = status;
        item.receiptId = receiptId;
        emit IntentStatusUpdated(intentId, status, receiptId);
    }
}
