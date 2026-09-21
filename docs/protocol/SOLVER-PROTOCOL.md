# FBT Solver Protocol Specification

## Overview

The **FBT Solver Network** is an open, permissionless competitive market. Solvers discover open intents, simulate execution routes across DEXs, bridges, and private inventories, and submit binding quotes into the protocol auction.

---

## Solver Interface (`FBTSolver`)

Any solver must implement the following standardized interface:

```ts
interface FBTSolver {
  solverId: string;
  metadata: SolverMetadata;
  capabilities(): SolverCapabilities;
  validateIntent(intent: FBTIntent): Promise<ValidationResult>;
  quote(intent: FBTIntent): Promise<SolverQuote>;
  commit(quote: SolverQuote): Promise<QuoteCommitment>;
  execute(intent: FBTIntent, quote: SolverQuote): Promise<ExecutionResult>;
  verify(execution: ExecutionResult): Promise<VerificationResult>;
}
```

---

## Solver Registry (`FBTSolverRegistry`)

The protocol maintains both an in-memory/API registry and an on-chain smart contract registry (`contracts/FBTSolverRegistry.sol`).

### Metadata Fields
- `solverId`: Unique string identifier
- `address`: EVM / Solana payout & signing address
- `chains`: Array of supported chain IDs
- `capabilities`: Supported feature tags (e.g., `['swap', 'bridge', 'rfq', 'partial_fill', 'mev_shielded']`)
- `status`: `'active' | 'suspended' | 'retired'`
- `reputation`: Dynamic score from 0 to 100 based on historical fulfillment
- `stake`: Economic bond deposited in smart contract (minimum 0.1 ETH / 10,000 USD equivalent)

---

## Quote Structure (`SolverQuote`)

```ts
type SolverQuote = {
  quoteId: string;
  intentId: string;
  solverId: string;
  amountIn: string;
  amountOut: string;
  fee: string;
  gasEstimate?: string;
  executionDeadline: number;
  route?: any[];
  commitment: string; // keccak256 hash of canonical quote
  createdAt: number;
  expiresAt: number;
  signature?: string;
};
```

---

## Auction Scoring Engine

The protocol evaluates quotes using explicit multi-dimensional scoring rather than a simple "highest output wins" heuristic:

$$\text{Score} = (\text{amountOut} - \text{fee}) \times W_{\text{output}} - (\text{gasEstimate} \times W_{\text{gas}}) + (\text{reputation} \times W_{\text{rep}})$$

Configurable policies:
- `MAX_OUTPUT`: Prioritizes net tokens delivered to user.
- `LOWEST_FEE`: Penalizes solver and relayer fees.
- `FASTEST_EXECUTION`: Favors low-latency and short execution deadlines.
- `REPUTATION_WEIGHTED`: Weights quotes by solver historical reliability.
- `MEV_PROTECTED`: Applies bonus to private, non-public mempool solver execution.
