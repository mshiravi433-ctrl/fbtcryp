# FBT Protection Marketplace — Production Deployment & Operations

Status: **production activation** · Date: 2026-09-07
Companion docs: `docs/insurance-architecture.md`, `docs/insurance-acceptance.md`

## 1. What changed (sandbox → production)

| Area | Before | Now |
|---|---|---|
| Providers | Sandbox EVM/Solana + Nexus stub | **Nexus Mutual (live)**, **InsurAce (live, key-gated)**, OpenCover **Verified Vault Coverage Registry** |
| Sandbox | Registered everywhere | Registered **only outside production**; registration in production throws `SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION` |
| Purchase | Prepared sandbox transfer + simulated signature | Prepared **unsigned provider transaction** (Nexus `CoverBroker.buyCover`, InsurAce `buyCoverV3`); user's wallet signs; server verifies the on-chain receipt (CoverNFT mint → coverId) before activation |
| Fees | Implicit | Fee engine wired to env, default **exact $0**, disclosure string `FBT Marketplace Fee: $0` always available pre-signature |
| API | ad-hoc JSON | Standard envelope: `requestId / timestamp / version / data / warnings / errors / source / freshness` |
| Admin | Admin tab in user UI | Admin UI **removed**; `/api/insurance/admin/*` key-gated, **404 in production without a key** |
| UI | Hardcoded English, wrapping tabs | i18n (13 locales), horizontal touch-scrollable tab rail with keyboard nav + RTL/LTR, transparency accordion with theme-aware inline SVGs |

## 2. Provider integrations (all sources verified 2026-09-07)

### Nexus Mutual (primary)
- Public API v2 `https://api.nexusmutual.io/v2` — `/products`, `/capacity/{productId}`, `/pricing/products/{productId}`, `/quote` (verified against the official swagger + `@nexusmutual/sdk@3.1.1`, whose default `apiUrl` is exactly this base).
- Purchase: `CoverBroker.buyCover(buyCoverParams, poolAllocationRequests)` — ABI and address from `@nexusmutual/deployments@3.4.0` (sha256-pinned provenance in `server/insurance/adapters/config/nexus-mainnet.json`). `commissionRatio=0` unless a real agreement exists (`NEXUS_COMMISSION_RATIO_BPS`).
- Constraints enforced: period 28–365 days, cover-asset allowlist (default USDC), terms+annex+membership/KYC acknowledgement required before quoting (`NEXUS_TERMS_REQUIRED`), PoS cover off (`NEXUS_POS_ENABLED=false`).
- Verification: receipt must hit `CoverBroker` AND mint a `CoverNFT` token to the buyer; `tokenId` is recorded as `coverId`, plus `blockNumber`.
- Environment: `NEXUS_ENABLED`, `NEXUS_API_BASE_URL`, `NEXUS_CHAIN_ALLOWLIST`, `NEXUS_PRODUCT_IDS` (optional operator allowlist).

### InsurAce (secondary, key-gated)
- API `https://api.insurace.io/ops/v1` — `getProductList`, `getCurrencyList`, `getCoverPremiumV2`, `confirmCoverPremiumV2` (flow verified from official docs). Access key in `INSURACE_API_CODE` (env-only secret; docs publish a low-volume key — request a dedicated one for production traffic).
- Purchase: `buyCoverV3(...)` on the InsurAce Cover contract. **The docs provide addresses only to integrators**, so FBT reads them from operator-verified env (`INSURACE_COVER_CONTRACT_ADDRESS_{ETH,BSC,POLYGON,AVALANCHE}`). Missing address ⇒ purchase `NOT_CONFIGURED`, quoting still possible.
- Chains: `INSURACE_CHAIN_ALLOWLIST=ETH,BSC,POLYGON,AVALANCHE`.

### OpenCover (registry, not a provider)
- No official data API ⇒ **no scraping**. `GET /api/insurance/vaults` serves a human-verified registry (protocol, vault, asset, chain, Nexus `productId`, official Policy/Annex links, `source: opencover`, `lastVerifiedAt`). Capacity is fetched **live from Nexus** for the recorded productId; without a live lookup it is `UNKNOWN` + `stale` + `STALE_DATA_REFRESH_REQUIRED` warning. APY figures are deliberately not copied.

## 3. Deployment checklist

```bash
# 1. Configure environment (secret manager — never committed)
NODE_ENV=production
NEXUS_ENABLED=true
INSURACE_ENABLED=true
INSURACE_API_CODE=<secret>            # optional until InsurAce goes live
FBT_INSURANCE_FEE_BPS=0               # marketplace fee: $0
FBT_PROTECTION_POOL_ENABLED=false
INSURANCE_AUTO_PURCHASE=false
INSURANCE_CUSTODY_ENABLED=false
INSURANCE_ADMIN_KEY=<secret>          # multisig-operated; omit ⇒ admin routes 404
INSURANCE_RPC_URLS=<keyed RPCs>       # independent receipt verification

# 2. Tests
npm test
npm run test:insurance

# 3. Build & deploy (Vercel: api/index.js mounts the same server app)
npm run build
```

## 4. Live smoke test (after deploy)

```bash
BASE=https://<your-deployment>
curl -s $BASE/api/insurance/providers                       # nexus-mutual LIVE expected
curl -s $BASE/api/insurance/provider-health                 # per-provider probe
curl -s "$BASE/api/insurance/products?chainId=1"            # real Nexus products
curl -s -XPOST $BASE/api/insurance/quote -H 'content-type: application/json' \
  -d '{"chainId":1,"walletAddress":"0x…","protectionType":"smart-contract","coverageAmount":"10000","durationDays":28,"termsAccepted":true}'
curl -s $BASE/api/insurance/vaults                          # OpenCover registry w/ live capacity
```

If a provider or its API is unavailable the API answers honestly:
`NO_ELIGIBLE_PROTECTION` / `PROVIDER_TEMPORARILY_UNAVAILABLE` / `LIVE_QUOTE_NOT_AVAILABLE`
— **no purchase is possible and nothing simulated is offered.** Never enable
sandbox providers to "fill the gap".

## 5. Security posture

- Non-custodial: no key material ever reaches the server; purchase paths end at unsigned transactions; `INSURANCE_CUSTODY_ENABLED=false` is asserted in `/capabilities`.
- No auto-purchase: AI/intents can recommend but never buy (`autoExecuteAllowed: false`, `protect-portfolio` `autoExecute:false`).
- Idempotency + replay protection on purchase/activation/payout (content-hash keyed); duplicate `txHash` cannot double-activate.
- Receipt verification with confirmation depth (`EVM_CONFIRMATIONS`), contract-address match, and CoverNFT-mint-to-owner check.
- Rate limiting/circuit breaker per provider via health probes: `UNAVAILABLE/DEGRADED` providers are skipped for new purchases; existing coverage stays visible.
- Emergency pause (key-gated, multisig-operated in production) blocks all purchase routes with 503.
- Audit log is append-only (`ins:audit:*`).
- Solidity side (FBTInsuranceRouter, fees/attribution only): OpenZeppelin `ReentrancyGuard/Pausable/AccessControl/SafeERC20`, EIP-712 purchase struct, nonces + deadlines (asserted by `test:insurance-contract`).
- Secrets (`INSURACE_API_CODE`, RPC URLs, `INSURANCE_ADMIN_KEY`) exist only in the secret manager — never source, bundle, logs, or git.

## 6. Honest-status report template

```text
Production Provider Status
Nexus Mutual: LIVE (health via /api/insurance/provider-health)
InsurAce: NOT_CONFIGURED until INSURACE_API_CODE (+ contract address) is set
OpenCover Registry: LIVE (registry rows) / capacity freshness per row

Sandbox Production Status: DISABLED (structural)
FBT Marketplace Fee: $0
Custody: DISABLED
Auto Purchase: DISABLED
Pool: DISABLED
On-chain Purchase: READY (Nexus path; InsurAce pending verified address)
Quote: LIVE / NOT_AVAILABLE (per provider health)
Coverage Verification: LIVE (RPC receipt + CoverNFT check)
Claim Verification: LIVE (on-chain payout recording only after verification)
```
