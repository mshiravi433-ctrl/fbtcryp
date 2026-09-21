# Cross-Chain Intents Specification

## Overview

A user expresses their desired outcome:
> *"I have 100 USDC on Arbitrum and want ETH on Base with at least 0.038 ETH received."*

The user does not need to manually select bridges, wrap tokens, or execute multi-step deposit-relay-withdraw sequences.

---

## Execution Flow

```text
User Cross-Chain Intent
        ↓
Source Chain Auction
        ↓
Solver Liquidity Discovery
  ├── Fast Bridge (Across, Stargate, CCTP)
  └── HTLC Atomic Swap
        ↓
Destination Chain Settlement
        ↓
Execution Receipt & Proof Verification
```

---

## Cross-Chain Adapter Interface (`CrossChainExecutionAdapter`)

The protocol decouples bridge and messaging providers from the core state machine via the `CrossChainExecutionAdapter` interface:

```ts
interface CrossChainExecutionAdapter {
  estimateRoute(intent: FBTIntent): Promise<CrossChainRouteEstimate>;
  buildSourceLeg(intent: FBTIntent, quote: SolverQuote): Promise<SourceTransaction>;
  trackRelayStatus(relayTxHash: string): Promise<RelayStatus>;
  verifyDestinationSettlement(receipt: DestinationReceipt): Promise<VerificationResult>;
}
```

This guarantees:
1. No single bridge protocol is hardcoded.
2. If one bridge experiences downtime or congestion, solvers dynamically route through alternate bridges.
3. Destination settlement is independently verified against the user's `minAmountOut` on the destination chain.
