# FBT Intent Protocol Versioning Specification

## Version Coexistence Matrix

The protocol adopts semantic versioning across all core layers to permit future iterations to coexist with legacy installations without breaking backward compatibility:

| Component | Current Version | Backward Compatible With | Upgradability Mechanism |
|---|---|---|---|
| **Protocol Core** | `1.0.0` | `0.9.x` legacy APIs | Feature flags & version routing |
| **Intent Schema** | `fbt.intent.v2` | `fbt.intent.v1`, `fbt.universal-intent.v1` | `universalToCanonicalIntent()` adapter |
| **Solver Schema** | `fbt.solver.v2` | `fbt.solver.v1` | Standardized `FBTSolver` base class |
| **Quote Schema** | `fbt.solver-quote.v2` | `fbt.solver-quote.v1` | `computeQuoteHash()` |
| **Receipt Schema** | `fbt.execution-receipt.v2` | `fbt.intent-receipt.v1` | Four-tier evidence taxonomy |
| **Smart Contracts** | `1.0.0` | Paris EVM / Solidity 0.8.24 | Immutable modular components with router indirection |
| **Client SDK** | `@fbt/intent-sdk@1.0.0` | Node.js ESM + modern browsers | Clean typed client interface |

---

## Evolution Principles

1. **Additive Extensibility**: New optional constraints may be added to `IntentConstraint[]` without invalidating existing verifiers.
2. **Domain Separation Versioning**: If a breaking change to struct hashing occurs, `EIP712_DOMAIN_VERSION` increments (e.g. from `'1'` to `'2'`) preventing signature cross-contamination.
3. **Solver Backward Compatibility**: Solvers declaring support for protocol version `1.0.0` remain eligible until formally deprecated.
