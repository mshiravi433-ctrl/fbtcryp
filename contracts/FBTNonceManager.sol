// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBTNonceManager
/// @notice Replay protection and cancellation registry for FBT Intents
contract FBTNonceManager {
    address public settlementEngine;
    address public owner;

    // user => sequential nonce counter
    mapping(address => uint256) public userSequentialNonce;
    // user => nonce => isUsed
    mapping(address => mapping(uint256 => bool)) public isNonceUsed;
    // user => nonce => isCancelled
    mapping(address => mapping(uint256 => bool)) public isNonceCancelled;

    event NonceUsed(address indexed user, uint256 indexed nonce);
    event NonceCancelled(address indexed user, uint256 indexed nonce);
    event SettlementEngineUpdated(address indexed newEngine);

    error NonceAlreadySpent(address user, uint256 nonce);
    error NonceAlreadyCancelled(address user, uint256 nonce);
    error UnauthorizedCaller();

    modifier onlySettlementOrOwner() {
        if (msg.sender != settlementEngine && msg.sender != owner) revert UnauthorizedCaller();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setSettlementEngine(address _engine) external {
        if (msg.sender != owner) revert UnauthorizedCaller();
        settlementEngine = _engine;
        emit SettlementEngineUpdated(_engine);
    }

    /// @notice Consumes a nonce during intent execution. Reverts on replay.
    function consumeNonce(address user, uint256 nonce) external onlySettlementOrOwner {
        if (isNonceCancelled[user][nonce]) revert NonceAlreadyCancelled(user, nonce);
        if (isNonceUsed[user][nonce]) revert NonceAlreadySpent(user, nonce);

        isNonceUsed[user][nonce] = true;
        if (nonce > userSequentialNonce[user]) {
            userSequentialNonce[user] = nonce;
        }

        emit NonceUsed(user, nonce);
    }

    /// @notice Permissionlessly cancels an unspent nonce by the user themselves.
    function cancelNonce(uint256 nonce) external {
        if (isNonceUsed[msg.sender][nonce]) revert NonceAlreadySpent(msg.sender, nonce);
        if (isNonceCancelled[msg.sender][nonce]) revert NonceAlreadyCancelled(msg.sender, nonce);

        isNonceCancelled[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    /// @notice Views whether a nonce is valid for execution.
    function isNonceValid(address user, uint256 nonce) external view returns (bool) {
        return !isNonceUsed[user][nonce] && !isNonceCancelled[user][nonce];
    }
}
