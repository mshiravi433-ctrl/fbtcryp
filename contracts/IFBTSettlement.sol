// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFBTSettlement
/// @notice Interface for the FBT Intent Protocol Settlement Engine
interface IFBTSettlement {
    struct Intent {
        string version;
        address user;
        uint256 sourceChainId;
        uint256 destinationChainId;
        address sourceAsset;
        address destinationAsset;
        uint256 amount;
        uint256 minAmountOut;
        uint256 maxFee;
        uint256 deadline;
        uint256 nonce;
        bytes32 constraintsHash;
    }

    struct SolverQuote {
        bytes32 intentId;
        string solverId;
        uint256 amountIn;
        uint256 amountOut;
        uint256 fee;
        uint256 executionDeadline;
        uint256 nonce;
        bytes32 routeHash;
    }

    event ExecutionReceiptEmitted(
        bytes32 indexed intentId,
        bytes32 indexed receiptId,
        address indexed user,
        string solverId,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        uint256 timestamp
    );

    event IntentCancelled(bytes32 indexed intentId, address indexed user, uint256 nonce);

    function settleIntent(
        Intent calldata intent,
        bytes calldata userSignature,
        SolverQuote calldata quote,
        bytes calldata solverSignature
    ) external payable returns (bytes32 receiptId);

    function cancelIntent(uint256 nonce) external;
}
