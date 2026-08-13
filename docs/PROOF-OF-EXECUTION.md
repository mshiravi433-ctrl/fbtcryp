# FBT Proof-of-Execution (PoE) — Receipt and Protocol Draft

**Status:** client receipt implemented; solver-attested protocol proposed  
**Receipt schema:** `fbt.execution-proof.v1`  
**Quote trace schema:** `fbt.quote-trace.v1`

## 1. Exact claim

An FBT execution receipt makes this bounded claim:

> Under the recorded fee, slippage, executability and time constraints, the selected route had the highest output among the usable executable responses observed by this quote round.

It does **not** prove global optimality. A client cannot prove what a solver that timed out, censored the request, or was never queried would have returned.

## 2. Implemented receipt

A receipt is created only after a supported EVM swap confirms. It contains:

- input/output asset identity and chain;
- amount, fee, slippage, minimum output and deadline;
- requested, answered and usable solver counts;
- compact evidence for every requested solver, including failures;
- the deterministic selection policy;
- selected response and measurable output advantage;
- transaction hash, block number and gas used;
- explicit `null` values for gas/MEV savings that were not measured;
- a canonical JSON SHA-256 digest.

Wallet addresses, free-form intent notes, route calldata and large aggregator route bodies are not copied into local receipts.

## 3. Canonicalisation

`sorted-key-json-v1` applies recursively:

1. object keys are sorted lexicographically;
2. arrays preserve order;
3. `BigInt` becomes a base-10 string;
4. non-finite numbers become `null`;
5. `undefined` and functions are omitted.

The digest is:

```text
SHA-256(UTF8(canonical-json(payload)))
```

## 4. Integrity versus authenticity

The implemented digest is a reproducible **content fingerprint**. If a user shares a digest and JSON separately, modification is detectable. It is not an FBT signature: someone who can replace both the document and digest can compute a new valid pair.

A protocol-grade proof therefore requires at least one external authenticity mechanism:

- solver signatures over quote commitments;
- FBT/verifier signature over the receipt root;
- an on-chain registry anchor; or
- an append-only public transparency log with inclusion proofs.

The UI must not label the current digest as a ZK proof or signed attestation.

## 5. Proposed solver quote commitment

```json
{
  "schema": "fbt.solver-quote.v1",
  "intentHash": "0x…",
  "solverId": "did:key:…",
  "chainId": 42161,
  "amountOut": "400000000000000000",
  "maxGas": "250000",
  "feeBps": 70,
  "slippageBps": 50,
  "executable": true,
  "validUntil": 1786579200,
  "nonce": "0x…",
  "routeCommitment": "0x…",
  "signature": "0x…"
}
```

The bid set should be committed as a Merkle tree before selection. A receipt then carries:

- the root;
- selected bid and inclusion proof;
- excluded/failed solver status;
- selection function version;
- settlement transaction;
- verifier signature or registry inclusion proof.

## 6. Selection policy

The current code uses:

```text
MAX_OUTPUT_EXECUTABLE_SAME_FEE_AND_SLIPPAGE
```

Eligibility requirements:

1. positive integral output;
2. executable route;
3. same platform fee basis points;
4. same slippage assumption.

Gas is recorded when provided, but the current policy does not claim gas-adjusted ranking because sources do not all provide a comparable gas USD value. A future policy may use:

```text
MAX_NET_OUTPUT_USD_AFTER_ATTESTED_GAS
```

only when every eligible bid uses a timestamped, common price source and an attested gas bound.

## 7. MEV and privacy evidence

A private-RPC recommendation is not transport attestation. A receipt may claim private settlement only if it can bind a cryptographic attestation to the exact transaction or bundle. Otherwise:

```json
{
  "confidentialIntent": false,
  "privateRelayAttested": false
}
```

MEV savings remain `null` unless compared against a defensible counterfactual methodology. “No sandwich was observed” is not equivalent to “X dollars of MEV were saved.”

## 8. Verification

Client verification recomputes the canonical SHA-256 digest. Full protocol verification should additionally:

1. verify every solver signature;
2. verify Merkle inclusion and bid-set root anchoring;
3. re-run the selection function;
4. verify the settlement transaction and receipt status;
5. verify output against the selected bid's guaranteed minimum;
6. verify expiry, nonce and chain binding;
7. verify any transport or confidential-compute attestation.

## 9. Relevant implementation

- `src/lib/bestQuote.js` — parallel quote race and compact trace
- `src/lib/swap.js` — named solver requests and selection evidence
- `src/lib/executionProof.js` — canonical receipt, hashing, storage and verification
- `src/pages/Swap.jsx` — receipt creation after confirmed settlement
- `src/pages/IntentOS.jsx` — proof archive, verification and JSON export
