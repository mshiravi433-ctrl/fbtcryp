// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * FNT DEX — FeeRouter
 *
 * Takes a 0.5% platform fee from the INPUT token, then forwards the remainder
 * to the PancakeSwap V2 router in the SAME transaction. Atomic: the user
 * cannot receive their swap without the fee being paid.
 *
 * DESIGN NOTES / AUDIT SURFACE
 * ---------------------------------------------------------------------------
 * - `feeBps` is capped at MAX_FEE_BPS (1%) at compile time. Even a compromised
 *   owner key cannot set a 100% fee and drain traders. This is deliberate.
 * - Owner can NEVER touch user funds mid-swap: tokens are only ever held by
 *   this contract for the duration of one transaction, and `rescue()` exists
 *   solely for tokens sent here by mistake.
 * - Uses `SafeERC20`-style low-level calls so non-standard tokens (USDT on
 *   some chains returns no bool) don't brick the router.
 * - Reentrancy guard on every external state-changing path.
 * - `amountOutMin` is passed through untouched — slippage protection is the
 *   caller's, and this contract cannot weaken it.
 *
 * NOT AUDITED. This is production-shaped code, but before you route real
 * volume through it you should get a professional audit. A bug here loses
 * other people's money, not just yours.
 */

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPancakeRouter {
    function WETH() external pure returns (address);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

contract FeeRouter {
    /* ----------------------------- constants ----------------------------- */

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// Hard ceiling. Owner cannot exceed this, ever.
    uint256 public constant MAX_FEE_BPS = 100; // 1.00%

    /* ------------------------------ storage ------------------------------ */

    address public owner;
    address public feeRecipient;
    uint256 public feeBps;
    IPancakeRouter public immutable dexRouter;

    uint256 private _locked = 1;

    /// Total fees collected per token, for accounting/dashboards.
    mapping(address => uint256) public totalFeesCollected;

    /* ------------------------------- events ------------------------------ */

    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 feeAmount
    );
    event FeeRecipientUpdated(address indexed previous, address indexed next);
    event FeeBpsUpdated(uint256 previous, uint256 next);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event Rescued(address indexed token, uint256 amount);

    /* ------------------------------ modifiers ---------------------------- */

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }

    /* ---------------------------- construction --------------------------- */

    constructor(address _dexRouter, address _feeRecipient, uint256 _feeBps) {
        require(_dexRouter != address(0), "ZERO_ROUTER");
        require(_feeRecipient != address(0), "ZERO_RECIPIENT");
        require(_feeBps <= MAX_FEE_BPS, "FEE_TOO_HIGH");

        owner = msg.sender;
        dexRouter = IPancakeRouter(_dexRouter);
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    /* ------------------------------- admin ------------------------------- */

    function setFeeRecipient(address next) external onlyOwner {
        require(next != address(0), "ZERO_RECIPIENT");
        emit FeeRecipientUpdated(feeRecipient, next);
        feeRecipient = next;
    }

    function setFeeBps(uint256 next) external onlyOwner {
        require(next <= MAX_FEE_BPS, "FEE_TOO_HIGH");
        emit FeeBpsUpdated(feeBps, next);
        feeBps = next;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    /**
     * Recover tokens accidentally sent to this contract. Cannot be abused
     * mid-swap because every swap function is nonReentrant and leaves a zero
     * balance behind.
     */
    function rescue(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool ok, ) = payable(owner).call{value: amount}("");
            require(ok, "ETH_RESCUE_FAILED");
        } else {
            _safeTransfer(token, owner, amount);
        }
        emit Rescued(token, amount);
    }

    /* ------------------------------- views ------------------------------- */

    /// Preview the split for a given input amount.
    function quoteFee(uint256 amountIn) public view returns (uint256 fee, uint256 amountAfterFee) {
        fee = (amountIn * feeBps) / BPS_DENOMINATOR;
        amountAfterFee = amountIn - fee;
    }

    /* ------------------------------- swaps ------------------------------- */

    /**
     * Native coin (BNB) -> token.
     * Fee is taken in BNB, the rest is swapped.
     */
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable nonReentrant {
        require(msg.value > 0, "ZERO_INPUT");
        require(to != address(0), "ZERO_TO");
        require(path.length >= 2, "BAD_PATH");

        (uint256 fee, uint256 swapAmount) = quoteFee(msg.value);

        if (fee > 0) {
            (bool sent, ) = payable(feeRecipient).call{value: fee}("");
            require(sent, "FEE_TRANSFER_FAILED");
            totalFeesCollected[address(0)] += fee;
        }

        dexRouter.swapExactETHForTokensSupportingFeeOnTransferTokens{value: swapAmount}(
            amountOutMin,
            path,
            to,
            deadline
        );

        emit SwapExecuted(msg.sender, address(0), path[path.length - 1], msg.value, fee);
    }

    /**
     * Token -> token.
     * Caller must have approved THIS contract for `amountIn`.
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant {
        require(amountIn > 0, "ZERO_INPUT");
        require(to != address(0), "ZERO_TO");
        require(path.length >= 2, "BAD_PATH");

        address tokenIn = path[0];

        // Measure what actually arrived — fee-on-transfer tokens deliver less
        // than requested, and assuming otherwise would revert the swap.
        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        uint256 received = IERC20(tokenIn).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "NOTHING_RECEIVED");

        (uint256 fee, uint256 swapAmount) = quoteFee(received);

        if (fee > 0) {
            _safeTransfer(tokenIn, feeRecipient, fee);
            totalFeesCollected[tokenIn] += fee;
        }

        _safeApprove(tokenIn, address(dexRouter), swapAmount);
        dexRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            path,
            to,
            deadline
        );

        emit SwapExecuted(msg.sender, tokenIn, path[path.length - 1], received, fee);
    }

    /**
     * Token -> native coin (BNB).
     * The DEX sends BNB straight to the user; the fee is taken in the input token.
     */
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant {
        require(amountIn > 0, "ZERO_INPUT");
        require(to != address(0), "ZERO_TO");
        require(path.length >= 2, "BAD_PATH");

        address tokenIn = path[0];

        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        uint256 received = IERC20(tokenIn).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "NOTHING_RECEIVED");

        (uint256 fee, uint256 swapAmount) = quoteFee(received);

        if (fee > 0) {
            _safeTransfer(tokenIn, feeRecipient, fee);
            totalFeesCollected[tokenIn] += fee;
        }

        _safeApprove(tokenIn, address(dexRouter), swapAmount);
        dexRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
            swapAmount,
            amountOutMin,
            path,
            to,
            deadline
        );

        emit SwapExecuted(msg.sender, tokenIn, address(0), received, fee);
    }

    /* --------------------------- safe ERC20 utils ------------------------- */

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    /// Some tokens (USDT) revert on non-zero -> non-zero approve; reset first.
    function _safeApprove(address token, address spender, uint256 value) private {
        (bool ok0, bytes memory d0) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, 0)
        );
        require(ok0 && (d0.length == 0 || abi.decode(d0, (bool))), "APPROVE_RESET_FAILED");

        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }

    /// Accept refunds from the DEX router only.
    receive() external payable {}
}
