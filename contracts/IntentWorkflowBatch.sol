// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBT Intent Workflow Batch
/// @notice User-signed same-transaction call batch for a single-chain workflow.
/// @dev Honesty, which this source is the source of:
///      - This contract NEVER holds tokens or keys. There is no owner and no
///        rescue. ERC-20 sent here by mistake is stuck.
///      - It does NOT verify call outputs against off-chain minOutput or
///        postconditions. Those live in the signed fbt.workflow.v1 document.
///      - Subcall `msg.sender` is this contract, not the user.
///      - Leftover ETH is refunded to the caller at the end of `execute`.
///      - MAX_CALLS is 8, matching the off-chain DAG bound.
contract IntentWorkflowBatch {
    uint256 public constant MAX_CALLS = 8;

    enum RevertPolicy {
        AbortAll,
        Continue,
        SkipRemaining
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
        uint256 deadline;
    }

    error EmptyCalls();
    error TooManyCalls();
    error BadPolicy();
    error ZeroWorkflowId();
    error CallDeadlinePassed();

    event WorkflowBatchExecuted(
        bytes32 indexed workflowId,
        address indexed caller,
        uint8 policy,
        uint256 callCount,
        uint256 successCount
    );

    function execute(
        bytes32 workflowId,
        Call[] calldata calls,
        RevertPolicy policy
    ) external payable returns (bool[] memory ok, bytes[] memory results) {
        if (workflowId == bytes32(0)) revert ZeroWorkflowId();
        uint256 n = calls.length;
        if (n == 0) revert EmptyCalls();
        if (n > MAX_CALLS) revert TooManyCalls();
        if (uint8(policy) > uint8(RevertPolicy.SkipRemaining)) revert BadPolicy();

        ok = new bool[](n);
        results = new bytes[](n);
        uint256 successCount;
        bool skipRest;

        for (uint256 i = 0; i < n; i++) {
            if (skipRest) {
                ok[i] = false;
                results[i] = "";
                continue;
            }
            if (calls[i].deadline != 0 && block.timestamp > calls[i].deadline) {
                if (policy == RevertPolicy.AbortAll) revert CallDeadlinePassed();
                ok[i] = false;
                results[i] = "";
                if (policy == RevertPolicy.SkipRemaining) skipRest = true;
                continue;
            }
            (bool success, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            ok[i] = success;
            results[i] = ret;
            if (success) {
                unchecked {
                    successCount++;
                }
            } else if (policy == RevertPolicy.AbortAll) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            } else if (policy == RevertPolicy.SkipRemaining) {
                skipRest = true;
            }
        }

        uint256 leftover = address(this).balance;
        if (leftover > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: leftover}("");
            require(refunded, "REFUND_FAILED");
        }

        emit WorkflowBatchExecuted(workflowId, msg.sender, uint8(policy), n, successCount);
    }

    /// @notice Accept ETH refunds from a subcall (e.g. a router). The next
    ///         `execute` refunds leftover ETH to ITS caller — do not send
    ///         stray ETH here.
    receive() external payable {}
}
