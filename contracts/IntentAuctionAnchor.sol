// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBT Intent Auction Anchor
/// @notice Permissionless timestamping for an already-signed auction close.
/// @dev This contract never holds tokens, executes swaps, selects winners, or
///      validates the off-chain coordinator signature. Independent verifiers
///      compare this event with the signed fbt.auction-close.v1 document.
contract IntentAuctionAnchor {
    error AlreadyAnchored(bytes32 anchorKey);
    error EmptyValue();

    /// @notice Full-record keys prevent somebody from blocking the legitimate
    /// close by front-running the same closeId with a different root.
    mapping(bytes32 anchorKey => bool) public anchored;

    event AuctionRootAnchored(
        bytes32 indexed closeId,
        bytes32 indexed intentHash,
        bytes32 indexed logRoot,
        uint64 logSize,
        uint64 closedAt,
        address anchorer
    );

    function anchor(
        bytes32 closeId,
        bytes32 intentHash,
        bytes32 logRoot,
        uint64 logSize,
        uint64 closedAt
    ) external {
        if (closeId == bytes32(0) || intentHash == bytes32(0) || logRoot == bytes32(0)) {
            revert EmptyValue();
        }
        bytes32 anchorKey = keccak256(abi.encode(closeId, intentHash, logRoot, logSize, closedAt));
        if (anchored[anchorKey]) revert AlreadyAnchored(anchorKey);
        anchored[anchorKey] = true;
        emit AuctionRootAnchored(closeId, intentHash, logRoot, logSize, closedAt, msg.sender);
    }
}
