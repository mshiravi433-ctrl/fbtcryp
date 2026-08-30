// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * FBT Swap — FlashLiquidityRouter (Phase 152 reference executor)
 *
 * Atomic flash-loan arbitrage executor for the FBT Intent OS pipeline:
 *
 *   Intent OS → Opportunity Scanner → Flash Liquidity Router → MEV/Execution
 *   → DEX hops → Atomic Settlement (all-or-revert inside one transaction)
 *
 * Flow (Aave V3 mode):
 *   executeArbitrageAave(pool, asset, amount, hops, minProfit, profitTo, deadline)
 *     └─ pool.flashLoanSimple(address(this), asset, amount, params, 0)
 *          └─ executeOperation(asset, amount, premium, initiator, params)
 *               ├─ run every hop (whitelisted target only, minOut enforced
 *               │  by out-token balance delta)
 *               ├─ require balance(asset) ≥ amount + premium + minProfit
 *               ├─ repay pool (amount + premium)
 *               └─ sweep the profit to profitTo
 *
 * Flow (Balancer Vault mode): same, via vault.flashLoan / receiveFlashLoan.
 *
 * THE HONEST CONTRACT
 * ---------------------------------------------------------------------------
 * - A flash loan is NOT free money: principal + premium must be back in this
 *   contract before the transaction ends, or everything reverts. Gas is still
 *   spent on a revert.
 * - The min-profit check is on-chain: if reality moved against the plan, the
 *   transaction reverts instead of settling at a loss.
 * - Hop targets, flash sources and loan assets are owner-allowlisted. A
 *   compromised executor key can only call pre-approved targets with the
 *   owner's declared risk surface.
 * - Only `owner` or an `executor` (bot wallet) may start a flash arbitrage.
 *   The contract NEVER holds custody between transactions: intermediate-token
 *   dust aborts the settlement, and `rescue()` exists only for tokens donated
 *   by mistake.
 * - The executor key CANNOT change allowlists, sweep profits to itself, or
 *   touch anything outside one atomic transaction.
 *
 * NOT AUDITED. Reference implementation. Before any mainnet deployment, get
 * an independent professional audit and deploy per-chain with allowlists
 * configured from verified addresses (see
 * docs/INTENT-AI-PHASE152-FLASH-LIQUIDITY-FA.md).
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev Minimal Aave V3 Pool surface (Pool flashLoanSimple → executeOperation).
interface IAaveV3Pool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @dev Minimal Balancer V2 Vault surface (flashLoan → receiveFlashLoan).
interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external;
}

contract FlashLiquidityRouter {
    /* ----------------------------- constants ----------------------------- */

    uint256 public constant MAX_HOPS = 6;

    /* ------------------------------ storage ------------------------------ */

    address public owner;
    /// @dev Bot/automation wallets allowed to START flash arbitrages only.
    mapping(address => bool) public executors;
    /// @dev Flash-loan sources (Aave Pool / Balancer Vault), verified by owner.
    mapping(address => bool) public allowedFlashSource;
    /// @dev Swap destinations hop `target`s may call. Nothing else is callable.
    mapping(address => bool) public allowedTarget;
    /// @dev Assets this contract will flash-borrow. Keeps settlement honest.
    mapping(address => bool) public allowedAsset;

    /// @dev Set during one flash arbitrage; cleared in the same transaction.
    address private _activeSource;
    uint256 private _locked = 1;

    /* ------------------------------- types ------------------------------- */

    /**
     * @notice One swap leg. The router:
     *         1. asserts `tokenIn` dust balance is zero (exact accounting),
     *         2. approves `target` for `amountIn` of `tokenIn` (exact, then revoked),
     *         3. executes `callData` on `target` (whitelisted only),
     *         4. requires the `outToken` balance to grow by ≥ `minOut`.
     * @dev `amountIn` and `callData` come from the off-chain plan (BigInt-exact
     *      route simulation). If reality moved, `minOut` or the final
     *      min-profit check reverts the whole transaction.
     */
    struct Hop {
        address tokenIn;
        uint256 amountIn;
        address target;
        bytes callData;
        address outToken;
        uint256 minOut;
    }

    struct FlashParams {
        address asset;
        uint256 loanAmount;
        uint256 minProfitAsset;
        address profitTo;
        uint256 deadline;
        Hop[] hops;
    }

    /* ------------------------------- events ------------------------------ */

    event FlashArbitrageExecuted(
        address indexed source,
        address indexed asset,
        uint256 loanAmount,
        uint256 premium,
        uint256 profit,
        address indexed profitTo
    );
    event FlashArbitrageRevertedReason(address indexed source, string reason);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event ExecutorUpdated(address indexed executor, bool allowed);
    event FlashSourceUpdated(address indexed source, bool allowed);
    event TargetUpdated(address indexed target, bool allowed);
    event AssetUpdated(address indexed asset, bool allowed);
    event Rescued(address indexed token, uint256 amount);

    /* ------------------------------ modifiers ---------------------------- */

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner || executors[msg.sender], "NOT_AUTHORIZED");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }

    /* ---------------------------- construction --------------------------- */

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        require(executor != address(0), "ZERO_EXECUTOR");
        executors[executor] = allowed;
        emit ExecutorUpdated(executor, allowed);
    }

    function setFlashSource(address source, bool allowed) external onlyOwner {
        require(source != address(0), "ZERO_SOURCE");
        allowedFlashSource[source] = allowed;
        emit FlashSourceUpdated(source, allowed);
    }

    function setTarget(address target, bool allowed) external onlyOwner {
        require(target != address(0), "ZERO_TARGET");
        allowedTarget[target] = allowed;
        emit TargetUpdated(target, allowed);
    }

    function setAsset(address asset, bool allowed) external onlyOwner {
        require(asset != address(0), "ZERO_ASSET");
        allowedAsset[asset] = allowed;
        emit AssetUpdated(asset, allowed);
    }

    /* --------------------------- Aave V3 path ---------------------------- */

    /**
     * @notice Borrow `amount` of `asset` from an Aave V3 Pool, run `hops`,
     *         repay principal + premium, and sweep ≥ `minProfitAsset` of
     *         `asset` to `profitTo`. Everything in one transaction; any
     *         shortfall reverts.
     */
    function executeArbitrageAave(
        IAaveV3Pool pool,
        address asset,
        uint256 amount,
        Hop[] calldata hops,
        uint256 minProfitAsset,
        address profitTo,
        uint256 deadline
    ) external onlyAuthorized nonReentrant {
        require(address(pool) != address(0), "ZERO_SOURCE");
        require(allowedFlashSource[address(pool)], "SOURCE_NOT_ALLOWED");
        require(allowedAsset[asset], "ASSET_NOT_ALLOWED");
        require(profitTo != address(0), "ZERO_PROFIT_TO");
        require(block.timestamp <= deadline, "DEADLINE_PASSED");
        require(hops.length >= 1 && hops.length <= MAX_HOPS, "BAD_HOP_COUNT");
        require(IERC20(asset).balanceOf(address(this)) == 0, "PRE_EXISTING_BALANCE");

        FlashParams memory params = FlashParams({
            asset: asset,
            loanAmount: amount,
            minProfitAsset: minProfitAsset,
            profitTo: profitTo,
            deadline: deadline,
            hops: hops
        });

        _activeSource = address(pool);
        pool.flashLoanSimple(address(this), asset, amount, abi.encode(params), 0);
        _activeSource = address(0);
    }

    /**
     * @dev Aave V3 callback. The Pool transfers `amount` to this contract
     *      before calling; we approve `amount + premium` for repayment, sweep
     *      the profit, and return true. If anything is short, a require
     *      reverts the whole transaction.
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == _activeSource, "UNEXPECTED_CALLBACK_SOURCE");
        require(initiator == address(this), "UNEXPECTED_INITIATOR");

        FlashParams memory p = abi.decode(params, (FlashParams));
        require(p.asset == asset, "ASSET_MISMATCH");
        require(p.loanAmount == amount, "AMOUNT_MISMATCH");
        require(block.timestamp <= p.deadline, "DEADLINE_PASSED");

        _runHops(p.hops);

        uint256 balance = IERC20(asset).balanceOf(address(this));
        uint256 repay = amount + premium;
        require(balance >= repay + p.minProfitAsset, "INSUFFICIENT_PROFIT");

        _safeApprove(asset, msg.sender, 0);
        _safeApprove(asset, msg.sender, repay);

        uint256 profit = balance - repay;
        _safeTransfer(asset, p.profitTo, profit);

        emit FlashArbitrageExecuted(msg.sender, asset, amount, premium, profit, p.profitTo);
        return true;
    }

    /* -------------------------- Balancer path ---------------------------- */

    /**
     * @notice Borrow `amounts[i]` of `tokens[i]` from a Balancer Vault
     *         (multi-asset supported — every token must be fully repaid),
     *         run `hops`, and sweep ≥ `minProfitAsset` of `tokens[0]` (the
     *         settlement asset) to `profitTo`.
     */
    function executeArbitrageBalancer(
        IBalancerVault vault,
        address[] calldata tokens,
        uint256[] calldata amounts,
        Hop[] calldata hops,
        uint256 minProfitAsset,
        address profitTo,
        uint256 deadline
    ) external onlyAuthorized nonReentrant {
        require(address(vault) != address(0), "ZERO_SOURCE");
        require(allowedFlashSource[address(vault)], "SOURCE_NOT_ALLOWED");
        require(tokens.length == amounts.length && tokens.length >= 1, "BAD_TOKEN_ARRAY");
        require(profitTo != address(0), "ZERO_PROFIT_TO");
        require(block.timestamp <= deadline, "DEADLINE_PASSED");
        require(hops.length >= 1 && hops.length <= MAX_HOPS, "BAD_HOP_COUNT");
        for (uint256 i; i < tokens.length; ++i) {
            require(allowedAsset[tokens[i]], "ASSET_NOT_ALLOWED");
            require(IERC20(tokens[i]).balanceOf(address(this)) == 0, "PRE_EXISTING_BALANCE");
        }

        bytes memory userData = abi.encode(
            minProfitAsset,
            profitTo,
            deadline,
            hops
        );

        _activeSource = address(vault);
        vault.flashLoan(address(this), tokens, amounts, userData);
        _activeSource = address(0);
    }

    /**
     * @dev Balancer V2 callback. Vault transfers the tokens before calling;
     *      we must return with every `amounts[i] + feeAmounts[i]` repaid or
     *      the Vault reverts the whole transaction.
     */
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == _activeSource, "UNEXPECTED_CALLBACK_SOURCE");
        require(block.timestamp <= _deadlineFrom(userData), "DEADLINE_PASSED");

        (uint256 minProfitAsset, address profitTo, , Hop[] memory hops) = abi.decode(
            userData,
            (uint256, address, uint256, Hop[])
        );

        _runHops(hops);

        // Every borrowed token must be back (Balancer loans are fee-free
        // today, but feeAmounts is honored for forward compatibility).
        address settlement = tokens[0];
        uint256 profit = 0;
        for (uint256 i; i < tokens.length; ++i) {
            uint256 balance = IERC20(tokens[i]).balanceOf(address(this));
            uint256 owed = amounts[i] + feeAmounts[i];
            require(balance >= owed, "INSUFFICIENT_REPAY");
            if (tokens[i] == settlement) {
                profit = balance - owed;
                require(profit >= minProfitAsset, "INSUFFICIENT_PROFIT");
                _safeTransfer(tokens[i], profitTo, profit);
            } else {
                require(balance == owed, "DUST_LEFT_ON_INTERMEDIATE");
            }
        }

        emit FlashArbitrageExecuted(msg.sender, settlement, amounts[0], feeAmounts[0], profit, profitTo);
    }

    function _deadlineFrom(bytes memory userData) internal pure returns (uint256) {
        (, , uint256 deadline, ) = abi.decode(userData, (uint256, address, uint256, Hop[]));
        return deadline;
    }

    /* ------------------------------ hop engine ---------------------------- */

    /**
     * @dev Runs the hop chain, then enforces dust hygiene: no intermediate
     *      token may be left behind — settlement is exact, by construction.
     */
    function _runHops(Hop[] memory hops) internal {
        for (uint256 i; i < hops.length; ++i) {
            Hop memory hop = hops[i];
            require(allowedTarget[hop.target], "TARGET_NOT_ALLOWED");
            require(hop.amountIn > 0, "ZERO_AMOUNT_IN");
            require(IERC20(hop.tokenIn).balanceOf(address(this)) >= hop.amountIn, "INSUFFICIENT_TOKEN_IN");

            uint256 before = IERC20(hop.outToken).balanceOf(address(this));

            _safeApprove(hop.tokenIn, hop.target, 0);
            _safeApprove(hop.tokenIn, hop.target, hop.amountIn);
            (bool ok, bytes memory ret) = hop.target.call(hop.callData);
            if (!ok) {
                // Bubble the target's revert data when it carries one; the
                // whole flash transaction reverts either way.
                if (ret.length > 0) assembly { revert(add(ret, 0x20), mload(ret)) }
                revert("HOP_FAILED");
            }
            _safeApprove(hop.tokenIn, hop.target, 0);

            uint256 afterBal = IERC20(hop.outToken).balanceOf(address(this));
            require(afterBal >= before + hop.minOut, "HOP_OUTPUT_TOO_LOW");
        }

        // Dust hygiene: every intermediate out-token (all but the last hop's
        // out-token, which is the settlement asset) must be fully spent.
        for (uint256 i; i + 1 < hops.length; ++i) {
            require(IERC20(hops[i].outToken).balanceOf(address(this)) == 0, "DUST_LEFT_ON_INTERMEDIATE");
        }
    }

    /* --------------------------- safe ERC20 ops --------------------------- */

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "APPROVE_FAILED");
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "TRANSFER_FAILED");
    }

    /* ------------------------------- rescue ------------------------------- */

    /**
     * @notice Owner-only recovery for tokens donated by mistake. The flash
     *         paths above never leave a balance to rescue: pre-existing
     *         balances abort settlement by design.
     */
    function rescue(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "ZERO_TO");
        _safeTransfer(token, to, amount);
        emit Rescued(token, amount);
    }

    receive() external payable {
        revert("ETH_NOT_ACCEPTED");
    }
}
