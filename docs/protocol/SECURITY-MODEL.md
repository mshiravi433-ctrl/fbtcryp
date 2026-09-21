# FBT Intent Protocol Security Model & Threat Analysis

## Overview

The FBT Intent Protocol implements defense-in-depth protections across cryptographic authorization, smart contract invariants, solver economics, and AI boundaries.

---

## Threat Matrix & Implemented Defenses

| Threat Vector | Attack Scenario | Implemented Protocol Defense |
|---|---|---|
| **Replay Attacks** | Submitting an already executed intent on the same chain | `FBTNonceManager` and `ProtocolNonceManager` record used nonces. Attempting reuse throws `NONCE_ALREADY_USED`. |
| **Cross-Chain Replay** | Submitting an intent signed for Arbitrum onto Base | `EIP712Domain` separator includes `chainId`. Struct hash includes `sourceChainId` and `destinationChainId`. |
| **Constraint Modification** | Malicious solver lowering `minAmountOut` or increasing `fee` | `assertConstraintsUnmodified()` verifies that quote `amountOut >= intent.minAmountOut` and `fee <= intent.maxFee`. On-chain contract reverts otherwise. |
| **Quote Replacement / Bait-and-Switch** | Solver offering generous quote, then executing worse terms | Cryptographic `quoteCommitmentHash` signed by solver. Settlement contract verifies revealed quote matches committed hash. |
| **Expired Intent Execution** | Executing an old intent during unfavorable market conditions | `intent.deadline` enforced both off-chain in state machine and on-chain via `require(intent.deadline > block.timestamp)`. |
| **Unauthorized Cancellation** | Attacker trying to cancel another user's intent | Cancellation requires user authorization; on-chain `cancelNonce()` uses `msg.sender`. |
| **Malicious / Defaulting Solver** | Solver takes input and fails to deliver output | `FBTSolverRegistry` requires economic bond (min 0.1 ETH / $10,000 USD). Slashing logic penalizes defaulting solvers and suspends them. |
| **Reentrancy Attacks** | Malicious token re-entering settlement during transfer | Settlement contract employs `ReentrancyGuard` on all state-mutating execution entry points. |
| **AI Prompt / Tool Injection** | Prompt injection attempting to forge direct transaction execution | AI layer can only emit structured tool requests. All execution flows strictly through Policy Validation -> Simulation -> User Signature -> Protocol Auction. Direct transaction execution is structurally impossible. |
| **Custody Risk** | Relayer or backend stealing funds | Non-custodial contracts. Tokens transfer directly from user to solver / solver to user. |
