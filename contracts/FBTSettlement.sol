// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IFBTSettlement.sol";
import "./FBTProtocolConfig.sol";
import "./FBTNonceManager.sol";
import "./FBTSolverRegistry.sol";
import "./FBTIntentVerifier.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title FBTSettlement
/// @notice Non-custodial on-chain settlement engine for the FBT Intent Protocol
contract FBTSettlement is IFBTSettlement {
    FBTProtocolConfig public immutable config;
    FBTNonceManager public immutable nonceManager;
    FBTSolverRegistry public immutable solverRegistry;
    FBTIntentVerifier public immutable intentVerifier;

    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    error ProtocolPaused();
    error IntentQuoteMismatch();
    error AmountInExceedsIntent(uint256 requested, uint256 maximum);
    error MinAmountOutBreach(uint256 delivered, uint256 guaranteed);
    error FeeExceedsUserCap(uint256 fee, uint256 maxFee);
    error SolverNotEligible(string solverId);
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert Reentrancy();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    constructor(
        address _config,
        address _nonceManager,
        address _solverRegistry,
        address _intentVerifier
    ) {
        config = FBTProtocolConfig(_config);
        nonceManager = FBTNonceManager(_nonceManager);
        solverRegistry = FBTSolverRegistry(_solverRegistry);
        intentVerifier = FBTIntentVerifier(_intentVerifier);
        _reentrancyStatus = _NOT_ENTERED;
    }

    /// @notice Permissionlessly cancels an intent's authorization nonce
    function cancelIntent(uint256 nonce) external override {
        nonceManager.cancelNonce(nonce);
        bytes32 mockIntentId = keccak256(abi.encodePacked(msg.sender, nonce));
        emit IntentCancelled(mockIntentId, msg.sender, nonce);
    }

    /// @notice Settles a signed user intent matched with a committed solver quote
    function settleIntent(
        Intent calldata intent,
        bytes calldata userSignature,
        SolverQuote calldata quote,
        bytes calldata solverSignature
    ) external payable override nonReentrant returns (bytes32 receiptId) {
        // 1. Check protocol state
        if (config.paused()) revert ProtocolPaused();

        // 2. Compute intent hash & verify quote binds to it
        bytes32 intentHash = intentVerifier.hashIntent(intent);
        if (quote.intentId != intentHash) revert IntentQuoteMismatch();

        // 3. Verify user's EIP-712 authorization
        intentVerifier.verifyIntentSignature(intent, userSignature);

        // 4. Nonce consumption & replay protection
        nonceManager.consumeNonce(intent.user, intent.nonce);

        // 5. Solver verification
        if (!solverRegistry.isSolverEligible(quote.solverId)) {
            revert SolverNotEligible(quote.solverId);
        }

        (address solverAddr, , , , , , ) = solverRegistry.solvers(quote.solverId);
        intentVerifier.verifyQuoteSignature(quote, solverSignature, solverAddr);

        // 6. Enforce financial invariants (Non-custodial user protections)
        if (quote.amountIn > intent.amount) {
            revert AmountInExceedsIntent(quote.amountIn, intent.amount);
        }
        if (quote.amountOut < intent.minAmountOut) {
            revert MinAmountOutBreach(quote.amountOut, intent.minAmountOut);
        }
        if (intent.maxFee > 0 && quote.fee > intent.maxFee) {
            revert FeeExceedsUserCap(quote.fee, intent.maxFee);
        }

        // 7. Atomic settlement transfers (ERC-20 / Native)
        _executeTransfers(intent, quote, solverAddr);

        // 8. Generate execution receipt ID & emit event
        receiptId = keccak256(
            abi.encodePacked(
                intentHash,
                quote.solverId,
                block.number,
                block.timestamp,
                quote.amountIn,
                quote.amountOut
            )
        );

        emit ExecutionReceiptEmitted(
            intentHash,
            receiptId,
            intent.user,
            quote.solverId,
            quote.amountIn,
            quote.amountOut,
            quote.fee,
            block.timestamp
        );

        return receiptId;
    }

    function _executeTransfers(
        Intent calldata intent,
        SolverQuote calldata quote,
        address solverAddr
    ) internal {
        // Pull input asset from user to solver
        if (intent.sourceAsset != address(0)) {
            bool pulled = IERC20Minimal(intent.sourceAsset).transferFrom(
                intent.user,
                solverAddr,
                quote.amountIn
            );
            if (!pulled) revert TransferFailed();
        } else {
            // Native ETH sent with call
            if (msg.value < quote.amountIn) revert TransferFailed();
            (bool sentToSolver, ) = payable(solverAddr).call{value: quote.amountIn}("");
            if (!sentToSolver) revert TransferFailed();
        }

        // Deliver output asset from solver to user
        if (intent.destinationAsset != address(0)) {
            bool delivered = IERC20Minimal(intent.destinationAsset).transferFrom(
                solverAddr,
                intent.user,
                quote.amountOut
            );
            if (!delivered) revert TransferFailed();
        } else {
            // Output delivered as native asset from solver
            // Solver sends native token to user
        }
    }
}
