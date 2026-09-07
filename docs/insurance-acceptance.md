# FBT Insurance OS — §63 Acceptance Checklist

Status date: 2026-09-07. Legend: ✅ implemented (runnable on sandbox providers) ·
🟡 scaffolded / pending live-provider or production milestone · ⬜ not started.

| # | §63 criterion | Status | Where |
|---|---|---|---|
| 1 | User can view protection products | ✅ | `GET /api/insurance/products`, marketplace page |
| 2 | User can obtain a real provider quote | 🟡 sandbox quote; live provider pending | `POST /api/insurance/quote`, quote-engine |
| 3 | Quote expiration works | ✅ | quote-engine `expiresAt`, probe asserts QUOTE_EXPIRED |
| 4 | User can compare providers | ✅ | aggregate quote + marketplace comparison |
| 5 | User can see every fee | ✅ | fee-engine breakdown (premium/FBT/network/total) |
| 6 | User can sign with wallet | 🟡 sandbox simulated signature; real wallet hand-off prepared | prepared unsigned payload + `/insurance/quote` |
| 7 | Coverage activation is verified | ✅ | indexer (sandbox) + `transaction/activate` |
| 8 | Active coverage is displayed | ✅ | dashboard + coverage pages |
| 9 | Coverage expiration is monitored | ✅ | coverage.applyExpiry + CoverageExpired event |
| 10 | Incident detection works | ✅ | monitoring.registerIncident → PotentialIncident |
| 11 | Claim creation works | ✅ | claims.createClaim + UI |
| 12 | Claim status is tracked | ✅ | claims timeline + statuses §24 |
| 13 | On-chain payout independently verified | ✅ sandbox indexer; real RPC pending | indexer + `recordPayout` |
| 14 | Provider failures have fallback | ✅ | service.probeAll/fallback returns honest "no eligible" |
| 15 | No duplicate purchase can occur | ✅ | idempotency (probe asserts same coverageId) |
| 16 | No raw private key stored | ✅ | no signer anywhere (§54) |
| 17 | AI cannot purchase without authorization | ✅ | central `protection` module declares no execute; protect-portfolio autoExecute=false |
| 18 | Provider contracts are configurable | 🟡 code registry; DB-backed future | provider-registry + adapters/index |
| 19 | Admin actions require authorization | ✅ sandbox key; production multisig required | router adminAuth |
| 20 | Emergency pause works | ✅ | admin/pause → route middleware 503 |
| 21 | Audit logs work | ✅ | auditLog append-only |
| 22 | EVM architecture production-ready | 🟡 live EVM provider + RPC confirmations pending | contract + indexer real-mode stub |
| 23 | Solana architecture is extensible | ✅ | SolanaSandboxProviderAdapter, multi-chain capabilities |
| 24 | Intent OS integration works | ✅ | central `protection` module + `/insurance/intent/protect-portfolio` |
| 25 | Security tests pass | ✅ | `npm run test:insurance-security` |
| 26 | End-to-end tests pass | ✅ | `npm run test:insurance-core` (engines, no HTTP) + HTTP smoke |
| 27 | Documentation is complete | ✅ | `docs/insurance-architecture.md` + this file |

### Pending production milestones (explicitly not fabricated)
- **Live provider wiring** (Nexus Mutual first): requires verified cover products,
  programmatic cover-buying, fees/commissions, supported chains and terms — the
  adapter is a disabled stub until those are integrated (§ honesty).
- **Multisig + timelock admin** and OpenZeppelin swap-in + independent security
  review (§49) before any production deployment.
- **Real on-chain indexer** (`INSURANCE_RPC_URL` mode) for EVM + Solana
  confirmation thresholds; sandbox mode is used today.
- **FBT internal protection pool / reserve / oracle TWAP** (§29–§31): architecture
  reserved, feature intentionally inactive.

### Test commands
```bash
npm run compile:fbt-insurance   # contracts/FBTInsuranceRouter.sol -> artifact
npm run test:insurance          # compile + core + security + contract probes
```
