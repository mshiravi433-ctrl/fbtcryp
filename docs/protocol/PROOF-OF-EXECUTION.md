# Proof-of-Execution 2.0 & Evidence System

## Overview

Proof-of-Execution 2.0 provides an independently verifiable cryptographic record answering:
- What intent was requested?
- Who authorized it?
- Which solver won?
- Which quote was committed?
- What transaction occurred on what chain and block?
- Was the user's guaranteed output satisfied?

---

## Canonical Receipt Schema (`fbt.execution-receipt.v2`)

```ts
type ExecutionReceipt = {
  receiptId: string;              // keccak256 hash of canonical receipt fields
  proofVersion: 'fbt.execution-receipt.v2';
  intentId: string;
  solverId: string;
  quoteId: string;
  sourceChainId: number;
  destinationChainId: number;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
  amountIn: string;
  amountOut: string;
  fee: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  evidenceTier: EvidenceTier;
  calldataSummary?: any;
  attestationSignature?: string;
};
```

---

## Evidence Tier Separation

The protocol strictly separates evidence tiers to prevent claiming cryptographic certainty when data is merely operator-asserted:

1. **OBSERVED**: Locally seen event (e.g. client broadcasted tx or simulation result).
2. **OPERATOR_REPORTED**: Assertion signed by an off-chain coordinator or relayer.
3. **CRYPTOGRAPHICALLY_VERIFIED**: Verified via digital signature (EIP-712 / Ed25519) and verified Merkle inclusion proof.
4. **ON_CHAIN_VERIFIED**: Confirmed by transaction receipt on-chain, block header, and contract execution event.

---

## Merkle Evidence Tree

All execution receipts enter a binary Merkle tree:
- Leaf: $\text{leaf}_i = \text{keccak256}(\text{canonicalJson}(\text{receipt}_i))$
- Pair Node: $\text{node} = \text{keccak256}(\text{min}(\text{left}, \text{right}) + \text{max}(\text{left}, \text{right}))$
- Root: Published periodically to `IntentMerkleRootAnchor.sol` on EVM networks.

Any user or independent verifier can run `verifyMerkleProof(receiptHash, proof, root)` offline without calling FBT servers.
