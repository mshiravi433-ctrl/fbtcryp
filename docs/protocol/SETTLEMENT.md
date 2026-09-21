# FBT On-Chain Settlement Layer Specification

## Overview

The FBT On-Chain Settlement Layer guarantees non-custodial execution and independent mathematical enforcement of user financial constraints. The user never trusts the backend or solver to enforce financial limits: the smart contracts enforce them autonomously.

---

## Smart Contract Architecture

The settlement architecture consists of five modular contracts located in `contracts/`:

```text
┌────────────────────────────────────────────────────────┐
│                   FBTSettlement                        │
│  - Non-custodial coordinator                           │
│  - Executes atomic transfers                           │
│  - Emits ExecutionReceiptEmitted                       │
└──────────┬─────────────────┬─────────────────┬─────────┘
           │                 │                 │
           ▼                 ▼                 ▼
┌──────────────────┐ ┌───────────────┐ ┌────────────────┐
│ FBTIntentVerifier│ │FBTNonceManager│ │FBTSolverRegistry│
│ - EIP-712 hashing│ │- Replay guard │ │- Staking/bonds │
│ - ecrecover user │ │- Cancellation │ │- Active status │
│ - Constraint eval│ │- Bitmap nonces│ │- Slashing      │
└──────────────────┘ └───────────────┘ └────────────────┘
           │
           ▼
┌──────────────────┐
│FBTProtocolConfig │
│- Pausing/freeze  │
│- Fee ceiling cap │
└──────────────────┘
```

---

## Invariants Enforced On-Chain

1. **User Authorization**: The contract recovers the signer address from the user's EIP-712 signature and confirms it matches `intent.user`.
2. **Replay Protection**: The nonce is checked against `FBTNonceManager.isNonceUsed`. It is consumed atomically in the same transaction. Replaying the same intent fails.
3. **Execution Deadline**: `require(intent.deadline > block.timestamp)`. Expired intents cannot be executed.
4. **Guaranteed Minimum Output**: `require(quote.amountOut >= intent.minAmountOut)`. The contract reverts if the user would receive even 1 wei less than their signed minimum.
5. **Maximum Input Cap**: `require(quote.amountIn <= intent.amount)`. Solvers cannot take more input tokens than authorized.
6. **Maximum Fee Cap**: `require(quote.fee <= intent.maxFee)`. Unreasonable or surprise markups cause an immediate revert.
7. **Reentrancy Protection**: Uses `ReentrancyGuard` pattern to prevent reentrant callbacks.
8. **Direct Delivery**: Tokens transfer directly from user to solver, and from solver to user's recipient address. The settlement contract never retains custody of funds.
