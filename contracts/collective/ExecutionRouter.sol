// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    ICollectiveAccessController,
    IEmergencyModule,
    IRiskController,
    IStrategyVault,
    IUniswapV2RouterLike
} from "./interfaces/ICollective.sol";

/**
 * Narrow token-to-token execution surface for the later approved-token lane.
 * It constructs one fixed V2-style swap call, requires recipient == vault,
 * uses exact approvals, checks quote/oracle/slippage/liquidity/cost policy, and
 * consumes an on-chain nonce. There is intentionally no arbitrary `call`,
 * calldata forwarding, native-asset transfer, or recipient parameter.
 */
contract ExecutionRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant MAX_DEADLINE_AHEAD = 5 minutes;

    ICollectiveAccessController public immutable accessController;
    IEmergencyModule public immutable emergencyModule;
    IRiskController public immutable riskController;
    mapping(address => mapping(uint64 => bool)) public usedNonce;

    struct Trade {
        address vault;
        address dexRouter;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        uint64 nonce;
        uint64 deadline;
    }

    event TradeExecuted(
        address indexed vault,
        address indexed dexRouter,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint64 nonce
    );

    error NotKeeper();
    error EmergencyPaused();
    error InvalidTrade();
    error InvalidDeadline();
    error Replay();
    error InvalidQuote();
    error OutputBelowMinimum();
    error RouterRetainedTokens();

    constructor(
        ICollectiveAccessController access_,
        IEmergencyModule emergency_,
        IRiskController risk_
    ) {
        require(address(access_) != address(0) && address(emergency_) != address(0) && address(risk_) != address(0), "ZERO_CONTROL");
        accessController = access_;
        emergencyModule = emergency_;
        riskController = risk_;
    }

    function executeSwap(Trade calldata trade) external nonReentrant returns (uint256 amountOut) {
        if (!accessController.hasRole(accessController.KEEPER_ROLE(), msg.sender)) revert NotKeeper();
        if (emergencyModule.paused()) revert EmergencyPaused();
        if (
            trade.vault.code.length == 0 || trade.dexRouter.code.length == 0 ||
            trade.tokenIn.code.length == 0 || trade.tokenOut.code.length == 0 ||
            trade.tokenIn == trade.tokenOut || trade.amountIn == 0 || trade.amountOutMin == 0
        ) revert InvalidTrade();
        if (trade.deadline < block.timestamp || trade.deadline > block.timestamp + MAX_DEADLINE_AHEAD) revert InvalidDeadline();
        if (usedNonce[trade.vault][trade.nonce]) revert Replay();

        address[] memory path = new address[](2);
        path[0] = trade.tokenIn;
        path[1] = trade.tokenOut;
        uint256[] memory quote = IUniswapV2RouterLike(trade.dexRouter).getAmountsOut(trade.amountIn, path);
        if (quote.length != 2 || quote[1] < trade.amountOutMin) revert InvalidQuote();

        riskController.validateSwap(
            trade.vault,
            trade.dexRouter,
            trade.tokenIn,
            trade.tokenOut,
            trade.amountIn,
            trade.amountOutMin,
            quote[1]
        );

        usedNonce[trade.vault][trade.nonce] = true;
        uint256 routerInputBefore = IERC20(trade.tokenIn).balanceOf(address(this));
        uint256 vaultOutputBefore = IERC20(trade.tokenOut).balanceOf(trade.vault);
        IStrategyVault(trade.vault).moveTradeInput(trade.tokenIn, trade.amountIn);
        if (IERC20(trade.tokenIn).balanceOf(address(this)) - routerInputBefore != trade.amountIn) revert InvalidTrade();

        IERC20(trade.tokenIn).forceApprove(trade.dexRouter, trade.amountIn);
        IUniswapV2RouterLike(trade.dexRouter).swapExactTokensForTokens(
            trade.amountIn,
            trade.amountOutMin,
            path,
            trade.vault,
            trade.deadline
        );
        IERC20(trade.tokenIn).forceApprove(trade.dexRouter, 0);

        amountOut = IERC20(trade.tokenOut).balanceOf(trade.vault) - vaultOutputBefore;
        if (amountOut < trade.amountOutMin) revert OutputBelowMinimum();
        if (IERC20(trade.tokenIn).balanceOf(address(this)) != routerInputBefore) revert RouterRetainedTokens();
        emit TradeExecuted(
            trade.vault,
            trade.dexRouter,
            trade.tokenIn,
            trade.tokenOut,
            trade.amountIn,
            amountOut,
            trade.nonce
        );
    }
}
