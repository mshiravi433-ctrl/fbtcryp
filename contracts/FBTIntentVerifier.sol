// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IFBTSettlement.sol";

/// @title FBTIntentVerifier
/// @notice Cryptographic EIP-712 verifier for FBT Intents and Solver Quotes
contract FBTIntentVerifier {
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant FBT_INTENT_TYPEHASH =
        keccak256("FBTIntent(string version,address user,uint256 sourceChainId,uint256 destinationChainId,address sourceAsset,address destinationAsset,uint256 amount,uint256 minAmountOut,uint256 maxFee,uint256 deadline,uint256 nonce,bytes32 constraintsHash)");

    bytes32 public constant SOLVER_QUOTE_TYPEHASH =
        keccak256("SolverQuote(bytes32 intentId,string solverId,uint256 amountIn,uint256 amountOut,uint256 fee,uint256 executionDeadline,uint256 nonce,bytes32 routeHash)");

    error DeadlinePassed(uint256 deadline, uint256 currentBlockTime);
    error InvalidUserAddress();
    error InvalidAmount();
    error SignatureVerificationFailed(address expected, address recovered);
    error MalformedSignature();

    constructor(address settlementContract) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("FBT Intent Protocol")),
                keccak256(bytes("1")),
                block.chainid,
                settlementContract
            )
        );
    }

    /// @notice Computes deterministic EIP-712 struct hash for an Intent.
    function hashIntent(IFBTSettlement.Intent calldata intent) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FBT_INTENT_TYPEHASH,
                keccak256(bytes(intent.version)),
                intent.user,
                intent.sourceChainId,
                intent.destinationChainId,
                intent.sourceAsset,
                intent.destinationAsset,
                intent.amount,
                intent.minAmountOut,
                intent.maxFee,
                intent.deadline,
                intent.nonce,
                intent.constraintsHash
            )
        );
    }

    /// @notice Computes full EIP-712 digest.
    function computeDigest(bytes32 structHash) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Computes deterministic EIP-712 struct hash for a SolverQuote.
    function hashQuote(IFBTSettlement.SolverQuote calldata quote) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SOLVER_QUOTE_TYPEHASH,
                quote.intentId,
                keccak256(bytes(quote.solverId)),
                quote.amountIn,
                quote.amountOut,
                quote.fee,
                quote.executionDeadline,
                quote.nonce,
                quote.routeHash
            )
        );
    }

    /// @notice Verifies user's EIP-712 authorization signature.
    function verifyIntentSignature(
        IFBTSettlement.Intent calldata intent,
        bytes calldata signature
    ) external view returns (bool) {
        if (intent.deadline <= block.timestamp) revert DeadlinePassed(intent.deadline, block.timestamp);
        if (intent.user == address(0)) revert InvalidUserAddress();
        if (intent.amount == 0 || intent.minAmountOut == 0) revert InvalidAmount();

        bytes32 structHash = hashIntent(intent);
        bytes32 digest = computeDigest(structHash);

        address recovered = recoverSigner(digest, signature);
        if (recovered != intent.user) {
            revert SignatureVerificationFailed(intent.user, recovered);
        }

        return true;
    }

    /// @notice Verifies solver's commitment signature over the quote.
    function verifyQuoteSignature(
        IFBTSettlement.SolverQuote calldata quote,
        bytes calldata signature,
        address expectedSolverAddress
    ) external view returns (bool) {
        if (quote.executionDeadline <= block.timestamp) revert DeadlinePassed(quote.executionDeadline, block.timestamp);

        bytes32 structHash = hashQuote(quote);
        bytes32 digest = computeDigest(structHash);

        address recovered = recoverSigner(digest, signature);
        if (recovered != expectedSolverAddress) {
            revert SignatureVerificationFailed(expectedSolverAddress, recovered);
        }

        return true;
    }

    function recoverSigner(bytes32 digest, bytes calldata signature) public pure returns (address) {
        if (signature.length != 65) revert MalformedSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        return ecrecover(digest, v, r, s);
    }
}
