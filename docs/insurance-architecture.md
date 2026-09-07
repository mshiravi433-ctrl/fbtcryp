# FBT Insurance OS — Architecture & Integration

Status: **v2 — production activation (Nexus Mutual live · InsurAce deactivated · OpenCover registry)** · Owner: FBT Web3 Architecture
Date: 2026-09-08

This document describes how **FBT Insurance OS** integrates into the existing FBT
Swap monorepo without breaking any existing module (Swap, Bridge, Wallet,
Lending, Futures, Intent OS, Rewards, …).

> **Honesty rule (§64).** FBT is a DEX/aggregator interface, not an insurer and
> not a custodian. This module does **not** pretend FBT underwrites coverage and
> does **not** custody premiums or claim funds. Every purchase is a *prepared,
> unsigned* hand-off the user signs in their own wallet and settles directly with
> an external protection provider. Real provider payloads, terms, commissions
> and contracts are **not invented** here (§“Do not invent provider APIs…”).

## v2 — Production activation (this milestone)

| Item | State |
|---|---|
| Nexus Mutual | **LIVE** — Public API v2 (`https://api.nexusmutual.io/v2` — `/products`, `/product-types`, `/cover-metadata`, `/quote`, `/capacity/{id}`; re-verified 2026-09-08 against the live API and `@nexusmutual/sdk@3.1.1`), unsigned `CoverBroker.buyCover` prepared server-side (ABI + addresses from `@nexusmutual/deployments@3.4.0`, provenance in `adapters/config/nexus-mainnet.json`), activation verified independently via `CoverNFT` mint receipt (tokenId == coverId). Period 28–365d, terms acceptance mandatory, commission 0 (no agreement), PoS off. |
| InsurAce | **DEACTIVATED (operator decision 2026-09-08)** — `INSURACE_ENABLED` defaults `false` in code and `.env.example`; the adapter still implements `getProductList/getCurrencyList/getCoverPremiumV2/confirmCoverPremiumV2` against `https://api.insurace.io/ops/v1` (`INSURACE_API_CODE`, env-only secret) and purchase via `buyCoverV3` (operator-verified Cover contract address required) — re-activate deliberately after re-verification. |
| OpenCover | **Verified Vault Coverage Registry** — reference links only (protocol, vault, asset, chain, Nexus productId, official Policy/Annex URLs, `source: opencover`, human-verified date). No scraping; capacity fetched live from the Nexus capacity API or reported `UNKNOWN` + stale. |
| Sandbox | Registered **only** when `NODE_ENV !== 'production'`; production registration throws `SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION` (enforced in `provider-registry.js` + `adapters/index.js`). No simulated payouts or fabricated quotes in production. |
| Response envelope | All routes: `requestId, timestamp, version, data, warnings, errors, source, freshness` (`server/insurance/envelope.js`); stale data flagged `STALE_DATA_REFRESH_REQUIRED`, never shown as live. |
| Fees | `FBT_INSURANCE_FEE_BPS` / `FBT_INSURANCE_FLAT_FEE_MICRO` / `FBT_PROVIDER_COMMISSION_BPS` — operator decision 2026-09-08: FBT marketplace fee **ACTIVE at 100 bps (1% of provider premium)**; the fee is part of the user's total and always displayed pre-signature. Provider commission stays 0 (never assumed). |
| Verification | `server/insurance/verification.js` — `eth_getTransactionReceipt` with confirmation depth, contract match, and CoverNFT-mint-to-owner check; no RPC ⇒ `verified:false` (never approval-by-default). |
| Ranking | `server/insurance/recommendation.js` — 14-factor explainable scoring; `UNAVAILABLE/PAUSED/STALE/NOT_CONFIGURED/UNKNOWN` providers are never recommended for new purchases (existing coverage stays visible). |
| Admin | User-UI admin page **removed**; `/api/insurance/admin/*` key-gated and **404 in production** without `INSURANCE_ADMIN_KEY` (multisig-operated). |
| UI | Horizontal touch-scroll tab rail (RTL/LTR, keyboard nav, `role=tablist`), transparency accordion with inline theme-aware SVGs, i18n keys in all shipped locales, `FBT Marketplace Fee: $0` chip, per-quote Source/Freshness strip. |
| Hard switches | `FBT_PROTECTION_POOL_ENABLED=false`, `INSURANCE_AUTO_PURCHASE=false`, `INSURANCE_CUSTODY_ENABLED=false` (asserted in `/capabilities`). |

Deployment & operations: **docs/insurance-production-deployment.md**.

---

## 1. Existing architecture (as inspected)

| Layer | What exists | Where |
|---|---|---|
| Frontend | React 18 + Vite, `react-router-dom` **HashRouter**, i18n (fa/en/…) | `src/App.jsx`, `src/pages/*`, `src/components/*` |
| Backend | One shared Express app | `server/app.js` (mounted in `server/index.js` dev + `api/index.js` Vercel) |
| Module pattern | BFF routers, `app.use('/api/<mod>', <mod>Router())` | e.g. `/api/lending`, `/api/v1/futures`, `/api/v1/rewards` |
| Persistence | KV store over Vercel Blob / Upstash Redis with in-memory fallback | `server/store.js`, `server/blobCache.js` |
| Idempotency | Upstash SET-NX leases + content-hash keyed dedupe | `server/idempotency.js`, `server/buySell.js` |
| Wallet | Non-custodial; server builds **unsigned** calldata, wallet signs | lending/futures/rewards BFFs |
| Contracts | Solidity compiled via `solc` to JSON artifacts in `src/lib` | `contracts/*.sol`, `scripts/compile.mjs` |
| Intent OS / Brain | Central Intelligence OS; modules self-register adapters (`read/quote/prepare/…`) | `server/central/*` (registry/capabilities/adapters), `server/brain/*` |
| Notifications | web-push + FCM push registry, in-app notifications | `server/store.js`, `server/push.js` |
| AI | Multi-provider gateway, never signs, never fabricates tx | `server/aiGateway.js`, `server/central/*` |
| Chains | EVM registry + Solana support, RPC fallback lists | `server/chainsLite.js`, `src/lib/chains.js`, `server/solana.js` |
| Money | No SQL DB — durable KV; financial modules keep integer/atomic discipline | `server/buySell.js`, `server/iranBuy.js` |

### Key integration decisions
- No new database, no schema migration system: the repo intentionally uses KV
  (Blob/Upstash). We therefore model the “tables” of the spec (§12) as **typed KV
  namespaces** (see `server/insurance/store.js`) with strict prefixes, one JSON
  record per entity, plus an append-only audit/event log. A drop-in Postgres
  migration is documented but **not** introduced, preserving the existing
  deployment model.
- Server is the policy/validation layer; **blockchain/provider state is the
  authority for settlement**. Payouts are only marked `PAID` after independent
  on-chain verification (§25).
- Server never holds a key, never signs, never broadcasts. Purchase endpoints
  return unsigned `prepare` payloads.
- Amounts are integer micro-units (`1e6`) of the settlement token — never
  floating point for money.

---

## 2. Layering

```
USER
  ↓
FBT UI                     src/pages/insurance/*  + src/lib/insuranceClient.js
  ↓
FBT Insurance API          server/insurance/router.js   (mounted at /api/insurance)
  ↓
Aggregation Engine         server/insurance/service.js  (quote across providers, fallback/circuit-breaker)
  ↓
Provider Adapter layer     server/insurance/adapters/*  (implements InsuranceProviderAdapter)
  ↓
External Protection Prots  sandbox + Nexus Mutual stub + future FBT pool (disabled)
  ↓
Blockchain                contracts/FBTInsuranceRouter.sol (router/fees/attribution only — no custody)
```

---

## 3. New modules created

| # | Module | File |
|---|---|---|
| 1 | Adapter interface + errors | `server/insurance/adapter.js` |
| 2 | Provider registry + health | `server/insurance/provider-registry.js` |
| 3 | Sandbox EVM provider adapter | `server/insurance/adapters/mock-provider.js` |
| 4 | Sandbox Solana provider adapter | `server/insurance/adapters/solana-mock-provider.js` |
| 5 | Nexus Mutual adapter **stub** (unconfigured) | `server/insurance/adapters/nexus-mutual.js` |
| 6 | Adapter assembly | `server/insurance/adapters/index.js` |
| 7 | Durable store + idempotency + audit | `server/insurance/store.js` |
| 8 | Event bus emitter + audit log | `server/insurance/events.js` |
| 9 | Risk engine | `server/insurance/risk-engine.js` |
| 10 | Fee engine | `server/insurance/fee-engine.js` |
| 11 | Quote engine | `server/insurance/quote-engine.js` |
| 12 | Product catalogue | `server/insurance/product-catalog.js` |
| 13 | Coverage lifecycle | `server/insurance/coverage.js` |
| 14 | Claim engine | `server/insurance/claims.js` |
| 15 | Claim monitoring (incident detection) | `server/insurance/monitoring.js` |
| 16 | Blockchain indexer/verification | `server/insurance/indexer.js` |
| 17 | PROTECT_PORTFOLIO intent pipeline | `server/insurance/protect-portfolio.js` |
| 18 | Router / API + admin | `server/insurance/router.js`, `server/insurance/index.js` |
| 19 | Central-OS module adapter (Intent OS) | `server/insurance/central-adapter.js` |
| 20 | FBTInsuranceRouter contract | `contracts/FBTInsuranceRouter.sol` |
| 21 | Compile script | `scripts/compile-fbt-insurance.mjs` |

---

## 4. Data model (KV namespaces)

Prefixes used by `server/insurance/store.js`:

```
ins:providers:v1            provider registry list
ins:provider-health:v1:<id> last probe
ins:products:v1             catalogue snapshot (per provider, generated + cached)
ins:quotes:v1:<quoteId>     a quote (with expiry)
ins:coverage:v1:<id>        active / historical coverage
ins:claims:v1:<id>          a claim + timeline + evidence
ins:payouts:v1:<id>         payout verification record
ins:tx:v1:<id>              purchase/claim tx state machine
ins:incidents:v1:<id>       potential incident (monitoring)
ins:risk:v1:<wallet>        cached portfolio risk + exposure report
ins:audit:v1:<owner?>       append-only audit log
ins:events:v1               recent emitted events
ins:idem:v1:<op>:<hash>     idempotency dedupe (reuses server/idempotency.js style)
```

Every financial entity carries `id`, `chainId`, `blockNumber?`, `txHash?`,
`tokenAddress`, `providerId`, `quoteId`, `coverageId`, `claimId`, integer unit
amounts, and `termsHash`/`evidenceHash` where applicable (§46).

---

## 5. Contract changes

`contracts/FBTInsuranceRouter.sol` (new, not deployed in v1):

- **Does not underwrite, does not custody premiums.** It routes `quoteReference()`
  → `purchaseProtection()` → `recordCoverage()/recordClaim()/recordPayout()` for
  on-chain evidence, and collects an optional integration fee (§19/§20).
- OpenZeppelin `ReentrancyGuard`, `Pausable`, `AccessControl`, `SafeERC20`,
  EIP-712 typed coverage data + nonce/deadline/chainId replay protection,
  provider allowlist, emergency pause, multisig admin role (defaults to owner;
  production must use a real multisig + timelock).
- Direct settlement path: `purchaseProtection` forwards approved premium to the
  external provider contract when the provider signals `DIRECT`; otherwise the
  router itself stays a pure router.
- Existing contracts (`FeeRouter.sol`, `IntentAtomicSwap.sol`, etc.) are **not
  modified**.

Compile: `node scripts/compile-fbt-insurance.mjs` → `src/lib/fbtInsuranceRouterArtifact.json`.

---

## 6. API changes (new mount, no existing routes touched)

Mounted in `server/app.js`:

```js
app.use('/api/insurance', insuranceRouter());
```

Endpoints (§5): `GET /providers`, `GET /products`, `GET /products/:id`,
`POST /quote`, `POST /eligibility`, `POST /purchase-intent`,
`POST /transaction`, `GET /coverage`, `GET /coverage/:id`, `POST /claim`,
`GET /claims`, `GET /claims/:id`, `POST /renew`, `POST /cancel`,
`GET /risk`, `GET /portfolio-exposure`, `GET /providers/:provider/health`,
plus `POST /intent/protect-portfolio`, `GET /capabilities`, admin group under
`/admin/*`, `POST /provider/:id/verify-payout` (indexer), and `/events`.

---

## 7. Security model

- OpenZeppelin, EIP-712, nonce+deadline+chainId, provider allowlist, pause,
  AccessControl/multisig.
- Server-side canonical validation; frontend is untrusted (§59).
- No keys/seeds/credentials server-side (§10). Signing is always the user wallet.
- Idempotency on every money-moving op (purchase/claim/renew/payout-record/
  commission-record) so retries never double-create (§36).
- Amounts validated server-side as integers; deterministic fee engine (§20).
- Rate limiting via the shared `/api` limiter + per-endpoint guard.
- Audit log for sensitive actions; critical ops require the admin role.

---

## 8. Data / transaction / claim / provider flow

See §9–§11 of the spec; implemented across `quote-engine`, `coverage`,
`claims`, `indexer`, `monitoring`, `service.js`. Full walk-throughs live in the
module doc-comments.

---

## 9. Intent OS integration

An `insurance` module adapter is registered into the FBT **Central Intelligence
OS** (`server/central/adapters.js`) exposing `read` (dashboard/coverage/risk),
`quote`, and `prepare` (unsigned purchase hand-off). It declares **no**
`execute`: the brain can analyze, recommend and prepare, never auto-purchase
(§15/§55). The dedicated `PROTECT_PORTFOLIO` pipeline in
`server/insurance/protect-portfolio.js` implements the full
portfolio→risk→gap→provider→quote→rank→recommend flow with `autoExecute:false`.

---

## 10. Solana

Provider capabilities declare supported chains. `adapters/solana-mock-provider.js`
implements the same `InsuranceProviderAdapter` interface against the sandbox
bookkeeping store so Solana flows (native SOL + SPL) share every engine.

---

## 11. Acceptance checklist mapping

See `docs/insurance-acceptance.md` for the final §63 checklist and its per-item
status. Short version: product browsing, sandbox quotes with expiry, provider
comparison, full fee breakdown, prepared wallet hand-off, coverage lifecycle,
incident detection, claims with timeline + status, independent payout
verification, provider fallback, idempotency, no private keys, no silent AI
purchase, configurable providers, role-gated admin, emergency pause, audit log,
Intent OS integration, security + E2E probes — all implemented. Live external
provider wiring, multisig deployment and independent security review are
explicitly **pending** (§14 stage).
