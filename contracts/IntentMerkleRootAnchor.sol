// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBT Intent Merkle Root Anchor
/// @notice Permissionless timestamp publication for an off-chain transparency
///         log root. The event commits to one exact root and size.
/// @dev This contract never holds tokens, executes swaps, verifies signatures,
///      or proves the submitted log was complete. Independent clients recompute
///      fbt.merkle-root-manifest.v1 and compare it with this event.
contract IntentMerkleRootAnchor {
    error AlreadyAnchored(bytes32 anchorKey);
    error EmptyValue();
    error EmptyLog();

    /// @notice A full-record key prevents somebody from blocking the legitimate
    /// root by front-running its deterministic rootId with a different tuple.
    mapping(bytes32 anchorKey => bool) public anchored;

    event MerkleRootAnchored(
        bytes32 indexed rootId,
        bytes32 indexed intentHash,
        bytes32 indexed merkleRoot,
        uint64 logSize,
        address anchorer
    );

    function anchorRoot(
        bytes32 rootId,
        bytes32 intentHash,
        bytes32 merkleRoot,
        uint64 logSize
    ) external {
        if (rootId == bytes32(0) || intentHash == bytes32(0) || merkleRoot == bytes32(0)) {
            revert EmptyValue();
        }
        if (logSize == 0) revert EmptyLog();
        bytes32 anchorKey = keccak256(abi.encode(rootId, intentHash, merkleRoot, logSize));
        if (anchored[anchorKey]) revert AlreadyAnchored(anchorKey);
        anchored[anchorKey] = true;
        emit MerkleRootAnchored(rootId, intentHash, merkleRoot, logSize, msg.sender);
    }
}
