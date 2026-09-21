# FBT Intent Schema Specification

## Schema Version: `fbt.intent.v2`

The canonical Intent object represents a cryptographically verifiable financial request.

```ts
type FBTIntent = {
  intentId: string;                     // 0x-prefixed 32-byte cryptographic digest (keccak256)
  version: 'fbt.intent.v2';            // Schema version identifier
  user: string;                         // User wallet address (EVM 0x... or Solana Base58)
  sourceChain: number | string;         // Origin chain ID (e.g. 1, 8453, 42161, 501)
  destinationChain: number | string;    // Destination chain ID
  sourceAsset: string;                  // Token address or symbol
  destinationAsset: string;             // Token address or symbol
  amount: string;                       // Input amount in base units / wei string
  minAmountOut: string;                 // Guaranteed minimum received amount (in destination asset base units)
  maxAmountIn?: string;                 // Maximum input allowed to be consumed
  maxFee?: string;                      // Maximum fee user permits
  slippageBps: number;                  // Maximum slippage in basis points (e.g., 50 = 0.5%)
  deadline: number;                     // Unix timestamp in seconds after which intent cannot execute
  nonce: string;                        // Replay protection nonce (sequential or UUID)
  recipient: string;                    // Target recipient address (defaults to user)
  constraints: IntentConstraint[];      // Structured verifiable constraints
  constraintsHash: string;              // keccak256 hash of canonicalized constraints array
  executionPreferences?: {
    routingStrategy?: 'best_price' | 'lowest_fee' | 'fastest' | 'reputation' | 'mev_shielded';
    allowPartialFill?: boolean;
    preferredChains?: (number | string)[];
  };
  solverPolicy?: {
    requiredBondUsd?: string;
    minReputationScore?: number;
    allowedSolvers?: string[];
    disallowedSolvers?: string[];
    auctionTimeoutSeconds?: number;
  };
  createdAt: number;                    // Epoch timestamp in seconds
  signature?: string;                   // EIP-712 or Solana Ed25519 signature
  status: IntentStatus;                 // Canonical lifecycle status
  traceId: string;                      // Observability trace ID
  partialFill?: {
    enabled: boolean;
    minFillAmount?: string;
    filledAmount: string;
    remainingAmount: string;
    accumulatedOutput: string;
  };
};
```

---

## Canonical Hashing & Domain Separation

The cryptographic `intentId` is derived deterministically:

$$\text{intentId} = \text{keccak256}(\text{canonicalJson}(\text{intentFields}))$$

where `canonicalJson` recursively sorts all dictionary keys alphabetically and serializes all values deterministically.

For on-chain EVM contract verification, the standard EIP-712 struct hash is computed matching `contracts/FBTIntentVerifier.sol`:

```solidity
keccak256(
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
```

---

## Lifecycle State Machine

1. **CREATED**: Intent initialized with parameters.
2. **SIGNED**: Authorized by user wallet signature.
3. **VALIDATED**: Constraints, balance, and invariants verified.
4. **SUBMITTED**: Relayed to protocol intent pool.
5. **OPEN**: Available for solver bidding.
6. **QUOTING**: Solvers submit quotes to auction engine.
7. **COMMITTED**: Winning quote locked with cryptographic commitment.
8. **EXECUTING**: Chain transaction constructed and broadcasted.
9. **SETTLING**: On-chain settlement contract confirms execution.
10. **VERIFIED**: Proof-of-Execution verified against user constraints.
11. **COMPLETED**: Settlement finalized and receipt emitted.

Terminal failure paths:
- `INVALID`: Schema or constraint violation.
- `EXPIRED`: Deadline reached before execution.
- `CANCELLED`: User revoked authorization nonce.
- `REJECTED`: No valid quotes or policy block.
- `FAILED`: On-chain transaction reverted or dropped.
- `TIMEOUT`: Solver failed to fulfill within commitment window.
- `PARTIALLY_FILLED`: Intermediate state where partial fill was accepted.
- `DISPUTED`: Outcome deficit raised for slashing or adjudication.
