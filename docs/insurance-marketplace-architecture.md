# FBT Protection Marketplace

The insurance module is a non-custodial, provider-agnostic marketplace. FBT does not underwrite, guarantee a payout, or imply that a sandbox adapter is a real provider. Product and quote data must originate from a configured provider adapter; unknown data is returned as `UNKNOWN`.

## Flow

Wallet → Intent OS → Financial Brain / exposure report → risk and coverage-gap engines → `InsuranceAggregator` → `InsuranceProviderRouter` → user review → wallet signature → provider settlement → monitoring → evidence-based claims → independently verified payout.

The router ranks coverage, terms, deductible, risk, health, capacity, claim method, chain, protocol, duration and preferences—not price alone. No purchase is automatic.

## Production boundary

Only adapters with verified documentation, credentials, terms, supported chains and provider contracts may be enabled. The included sandbox adapters are simulation-only. FBT Protection Pool accounting and solvency primitives exist for a future phase, but pool underwriting is disabled until legal review, independent security review, capital/reserve design and governance are complete.

Jurisdiction is explicit and conservative: unavailable facts produce `UNKNOWN`, not an eligibility claim. Provider terms and their `termsHash` are retained with quotes and claims.

## Domain components

- `InsuranceAggregator`, `InsuranceProviderRouter`, `CoverageGapEngine`, `ProtectionScore`, `ProtectionProfile`, `JurisdictionEligibilityEngine`, `ClaimFraudEngine`: `server/insurance/marketplace.js`
- `ProtectionPoolAccounting`, `PoolSolvencyEngine`: `server/insurance/pool.js`
- risk, fees, event persistence and claim/payout verification: existing `server/insurance/*` modules

See the companion documents for adapter contracts, API, risk, claims, pool, security, threat model, deployment and legal configuration.