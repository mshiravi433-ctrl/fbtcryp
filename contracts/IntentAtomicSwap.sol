// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FBT Intent Atomic Swap (HTLC)
/// @notice Hash-Timelocked cross-chain escrow for EVM<->EVM atomic swaps.
/// @dev Honesty, which this source is the source of:
///      - Unlike IntentWorkflowBatch, this contract DOES escrow funds while a
///        swap is open. That escrow is the entire mechanism: atomicity across
///        two chains exists ONLY because both legs are locked under the same
///        hashlock with timelocks ordered so that either both legs complete or
///        both legs refund. Remove the escrow and the atomicity claim is gone.
///      - The escrow is contract-enforced and symmetric. FBT holds no key, has
///        no owner role here, cannot release, redirect or rescue funds. There
///        is no owner, no pause, no upgrade, no admin function of any kind.
///      - `claim` pays ONLY the recipient recorded at lock time. `refund` pays
///        ONLY the sender recorded at lock time. Neither can be changed.
///      - The preimage revealed by `claim` is public on-chain by design; that
///        is what lets the counterparty claim the paired leg. A hashlock whose
///        preimage must stay secret has no business in this contract.
///      - keccak256 is the only hash function. The safety of a swap depends on
///        the OFF-chain compiler enforcing destinationTimeout + margin <=
///        sourceTimeout; this contract only enforces its own per-swap timeout.
///      - ERC-20 tokens must be approved to this contract before `newSwap`.
///        Native ETH is accepted with token == address(0). ERC-20 sent without
///        approval reverts; nothing can be stuck by a partial call because
///        `newSwap` reverts atomically.
///      - A swapId may be used exactly once per chain. Re-locking a used id
///        reverts (`SwapAlreadyExists`).
contract IntentAtomicSwap {
    enum State {
        Empty,
        Locked,
        Claimed,
        Refunded
    }

    struct Swap {
        address sender;      // locks and receives the refund
        address recipient;   // receives the funds on claim
        address token;       // address(0) => native ETH
        uint256 amount;
        bytes32 hashlock;    // keccak256(preimage)
        uint64 timeout;      // block.timestamp deadline for claim; refund after
        State state;
    }

    uint256 public constant MAX_TIMEOUT_WINDOW = 30 days;
    uint256 public constant MIN_TIMEOUT_WINDOW = 10 minutes;

    uint256 private constant _REENTRANCY_UNLOCKED = 1;
    uint256 private constant _REENTRANCY_LOCKED = 2;
    uint256 private _reentrancy = _REENTRANCY_UNLOCKED;

    mapping(bytes32 => Swap) private _swaps;

    error SwapAlreadyExists();
    error SwapNotFound();
    error SwapNotLocked();
    error SwapAlreadySettled();
    error ZeroSwapId();
    error ZeroHashlock();
    error ZeroAmount();
    error ZeroSender();
    error ZeroRecipient();
    error TimeoutTooSoon();
    error TimeoutTooFar();
    error HashlockMismatch();
    error ClaimWindowClosed();
    error RefundWindowNotOpen();
    error EthAmountMismatch();
    error UnexpectedEth();
    error ReentrantCall();
    error EthTransferFailed();

    event SwapLocked(
        bytes32 indexed swapId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint64 timeout
    );
    event SwapClaimed(
        bytes32 indexed swapId,
        address indexed recipient,
        bytes32 preimage
    );
    event SwapRefunded(bytes32 indexed swapId, address indexed sender);

    modifier nonReentrant() {
        if (_reentrancy == _REENTRANCY_LOCKED) revert ReentrantCall();
        _reentrancy = _REENTRANCY_LOCKED;
        _;
        _reentrancy = _REENTRANCY_UNLOCKED;
    }

    /// @notice Lock `amount` of `token` (native ETH when token == address(0))
    ///         under `hashlock` until `timeout`. Claimable only by `recipient`
    ///         with the preimage; refundable only to the caller after timeout.
    function newSwap(
        bytes32 swapId,
        bytes32 hashlock,
        uint64 timeout,
        address recipient,
        address token,
        uint256 amount
    ) external payable nonReentrant {
        if (swapId == bytes32(0)) revert ZeroSwapId();
        if (hashlock == bytes32(0)) revert ZeroHashlock();
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroRecipient();
        if (_swaps[swapId].state != State.Empty) revert SwapAlreadyExists();
        if (timeout <= block.timestamp + MIN_TIMEOUT_WINDOW) revert TimeoutTooSoon();
        if (timeout > block.timestamp + MAX_TIMEOUT_WINDOW) revert TimeoutTooFar();

        if (token == address(0)) {
            if (msg.value != amount) revert EthAmountMismatch();
        } else {
            if (msg.value != 0) revert UnexpectedEth();
            // ERC-20 pull. Reverts (whole call) if allowance/balance is short.
            (bool ok, bytes memory ret) = token.call(
                abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
            );
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert EthTransferFailed();
        }

        _swaps[swapId] = Swap({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            hashlock: hashlock,
            timeout: timeout,
            state: State.Locked
        });

        emit SwapLocked(swapId, msg.sender, recipient, token, amount, hashlock, timeout);
    }

    /// @notice Claim with the preimage. The preimage is published on-chain by
    ///         this call — that is the mechanism, not a leak: the counterparty
    ///         uses it to claim the paired leg on the other chain.
    function claim(bytes32 swapId, bytes calldata preimage) external nonReentrant {
        Swap storage swap = _swaps[swapId];
        if (swap.state == State.Empty) revert SwapNotFound();
        if (swap.state != State.Locked) revert SwapAlreadySettled();
        if (keccak256(preimage) != swap.hashlock) revert HashlockMismatch();
        if (block.timestamp > swap.timeout) revert ClaimWindowClosed();

        swap.state = State.Claimed;

        if (swap.token == address(0)) {
            (bool sent, ) = swap.recipient.call{value: swap.amount}("");
            if (!sent) revert EthTransferFailed();
        } else {
            (bool ok, bytes memory ret) = swap.token.call(
                abi.encodeWithSignature("transfer(address,uint256)", swap.recipient, swap.amount)
            );
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert EthTransferFailed();
        }

        emit SwapClaimed(swapId, swap.recipient, bytes32(preimage));
    }

    /// @notice Refund to the original sender once the claim window has closed.
    function refund(bytes32 swapId) external nonReentrant {
        Swap storage swap = _swaps[swapId];
        if (swap.state == State.Empty) revert SwapNotFound();
        if (swap.state != State.Locked) revert SwapAlreadySettled();
        if (block.timestamp <= swap.timeout) revert RefundWindowNotOpen();

        swap.state = State.Refunded;

        if (swap.token == address(0)) {
            (bool sent, ) = swap.sender.call{value: swap.amount}("");
            if (!sent) revert EthTransferFailed();
        } else {
            (bool ok, bytes memory ret) = swap.token.call(
                abi.encodeWithSignature("transfer(address,uint256)", swap.sender, swap.amount)
            );
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert EthTransferFailed();
        }

        emit SwapRefunded(swapId, swap.sender);
    }

    /// @notice Read a swap. state: 0 empty, 1 locked, 2 claimed, 3 refunded.
    function swaps(bytes32 swapId)
        external
        view
        returns (
            address sender,
            address recipient,
            address token,
            uint256 amount,
            bytes32 hashlock,
            uint64 timeout,
            uint8 state
        )
    {
        Swap storage swap = _swaps[swapId];
        return (swap.sender, swap.recipient, swap.token, swap.amount, swap.hashlock, swap.timeout, uint8(swap.state));
    }

    /// @notice Do not accept stray ETH. Funding happens only through newSwap.
    receive() external payable {
        revert UnexpectedEth();
    }
}
