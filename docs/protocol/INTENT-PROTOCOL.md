# FBT Intent Protocol — Architecture Specification

## Overview

The **FBT Intent Protocol** is a production-grade, non-custodial, cryptographically verifiable intent infrastructure. It upgrades FBT from an application-level AI orchestration assistant into an open, multi-chain settlement and solver auction protocol.

Under the FBT Intent Protocol:
1. Users express desired outcomes (what asset on what chain at what minimum output) rather than imperative transaction sequences.
2. Financial constraints (minimum received, maximum spend, deadline, nonces) are cryptographically signed by the user (EIP-712 on EVM, Ed25519 on Solana) and remain immutable.
3. Solvers compete permissionlessly in a deterministic auction to fulfill user intents.
4. Winning quotes are locked via cryptographic commitments.
5. On-chain settlement contracts (`FBTSettlement.sol`, `FBTNonceManager.sol`, `FBTSolverRegistry.sol`, `FBTIntentVerifier.sol`) verify signatures, enforce guarantees, and prevent replay attacks without custody of funds.
6. Execution yields an independently verifiable `ExecutionReceipt` anchored in a binary Merkle tree.

---

## Architecture Diagram

```text
                    FBT INTENT OS
                         │
                    AI / Agents
                         │
                    Intent Engine
                         │
                Canonical Intent
                         │
              Signature + Validation
                         │
                  Intent Pool
                         │
                Solver Competition
                    /    |    \
                   /     |     \
             Solver A  Solver B  Solver C
                   \     |     /
                    Quote Auction
                         │
                  Quote Commitment
                         │
                  Execution Router
                    /          \
                  EVM         Solana
                    \          /
                     Settlement
                         │
                  Execution Receipt
                         │
                   Verification
                         │
                Cryptographic Proof
                         │
                    User / App
```

---

## Core Protocol Guarantees

1. **Non-Custodial**: Neither FBT, nor relayers, nor backend operators hold user private keys or user funds.
2. **Immutable User Constraints**: A solver cannot modify input amount, destination asset, recipient, slippage limits, or minimum received output. Any quote attempting to do so is rejected.
3. **Cryptographic Replay Resistance**: Every intent is bound to a unique nonce, source chain, destination chain, protocol version, and verifying contract domain separator.
4. **Independent Verifiability**: Any third party can verify user signatures, solver quote commitments, and execution receipts using the exported proof functions without relying on proprietary servers.
