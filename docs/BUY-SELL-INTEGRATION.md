# BUY / SELL — Ramp Network hosted checkout integration

## Architecture (no CEX API)

The native **BUY / SELL** page is the only purchase/sale surface. Its primary
provider is **Ramp Network's official Hosted Mode** — payment / on-ramp /
off-ramp infrastructure, never a CEX trading API. There is no Binance, Bybit,
KuCoin, MEXC or any other exchange trading API anywhere in this path, and the
absence of a CEX API can never make Buy unavailable.

```
FBT Swap → BUY/SELL → asset → network → amount → wallet address
  → FBT order (requestId · orderId · idempotencyKey · access capability)
  → Ramp Hosted Checkout (official app.rampnetwork.com URL, documented
    parameters only, destination prefilled via userAddress)
  → user pays Ramp directly (FBT never touches card data or fiat)
  → Ramp settles crypto DIRECTLY to the user's wallet
  → signed Ramp webhook reports the settlement transaction
  → FBT independently verifies chain · recipient · token · amount ·
    confirmations over its own RPC quorum
  → COMPLETED → wallet / portfolio / transactions / notifications refresh
```

Key modules:

- `server/providers/rampNetwork.js` — the Ramp adapter: configuration,
  capability engine, documented REST catalog/quote endpoints
  (`/host-api/v3/assets`, `/host-api/v3/onramp/quote/all`,
  `/host-api/v3/offramp/*`), hosted-URL composer, ECDSA webhook verification.
- `server/buySell.js` — ProviderRegistry (Ramp is Provider #1), ProviderRouter,
  order lifecycle, idempotency, on-chain settlement verification.
- `src/components/BuySellPanel.jsx` + `src/pages/Buy.jsx` — the UI, including
  the `/order/result/:orderId` return page (Ramp `finalUrl` target).

## Current status: CONFIGURATION_REQUIRED until legitimately credentialed

Without the real production configuration the provider reports
`status: "CONFIGURATION_REQUIRED"` and nothing is simulated — no fake
checkout, no fake payment, no fabricated tx hash, no manual balance credit.
The prerequisites are read from the environment at call time:

| Variable | Purpose |
| --- | --- |
| `RAMP_HOST_API_KEY` | Ramp's production Host API key for Hosted Mode. A **Ramp integration credential**, not a CEX API. Server-side only. |
| `RAMP_ENVIRONMENT` | `production` (default) or `demo` (`app.demo.rampnetwork.com`). |
| `RAMP_HOST_APP_NAME` / `RAMP_HOST_LOGO_URL` | Documented widget branding parameters. |
| `RAMP_ENABLED_FLOWS` | `ONRAMP` (default) or `ONRAMP,OFFRAMP`. Sell stays honestly `SELL_UNAVAILABLE` unless the approved integration enables off-ramp. |
| `RAMP_FINAL_URL_BASE` | Public app origin for `finalUrl` → `/order/result/:orderId`. |
| `RAMP_WEBHOOK_STATUS_URL` | Public URL of `POST /api/v1/buy-sell/webhooks/ramp`. Required: without the signed webhook the settlement tx hash can never be learned legitimately. |
| `RAMP_WEBHOOK_PUBLIC_KEY_PEM` | Ramp's published ECDSA public key. Callbacks failing `X-Body-Signature` verification are rejected (`401`) and never parsed as settlement. |

Durable order storage (Upstash) remains a prerequisite; a payment action is
never accepted against memory-only storage.

## Compliance boundary

- Ramp performs payment, KYC/AML, sanctions and geographic eligibility. FBT
  passes the user's real inputs through untouched: no country spoofing, no
  identity manipulation, no falsified company location, no bypass of a
  provider rejection. A jurisdiction rejection surfaces as
  `REGION_UNSUPPORTED` and stops there.
- Production onboarding requires Ramp's own partner/KYB approval for the FBT
  entity and applicable end-user jurisdictions. This repository ships the
  architecture; it does not and cannot ship eligibility.

## Fees

- `fbtTradingFee = 0` structurally (`FBT_TRADING_FEE` constant, asserted by
  tests). No spread, no markup, no Ramp partner fee is configured.
- Ramp's own fees (`appliedFee`, `networkFee`, `baseRampFee`) come from the
  live quote and are displayed verbatim. The UI never claims "total fee = 0".

## Settlement truth

Provider status is never sufficient. `COMPLETED` requires all of:
provider-reported settlement (signed webhook) **and** on-chain receipt found
**and** `chainId` matches **and** recipient matches the order wallet **and**
token contract + exact unit amount match **and** the configured confirmation
depth (`BUY_SELL_MIN_CONFIRMATIONS`, default 3). Assets on chains this app
cannot independently verify over its RPC quorum are not offered at all.

## Tests

- `test/buy-sell-probe.mjs` — unconfigured deployment fails closed
  (CONFIGURATION_REQUIRED, unsigned webhooks rejected, no quote/order).
- `test/buy-sell-ramp-flow-probe.mjs` — full configured lifecycle with only
  the network layer mocked: quote → order → hosted URL → genuinely
  ECDSA-signed webhook → independent on-chain verification → COMPLETED,
  including forged-signature rejection.
- `test/units.mjs` §Buy/Sell — capability, router, address validation and
  hosted-URL composer invariants (official host, documented params only,
  no fee/partner parameter).

## The no-registration guided rail (wizard + on-chain report)

The Buy page is a four-step wizard — **amount → wallet → asset/network →
review** — and always works, even with zero server configuration:

| Engine | When | What happens |
| --- | --- | --- |
| **Tracked flow** | `RAMP_*` credentials configured | quote → order → explicit confirm → hosted checkout → signed webhook → on-chain settlement verification (unchanged, documented above) |
| **Guided handoff** | no credentials | `src/lib/guidedCheckout.js` composes the provider's official public widget URL with only documented parameters (`swapAsset`/`offrampAsset`, `fiatValue`/`swapAmount` in exact base units, `fiatCurrency`, `userAddress`) and opens it. The user confirms and pays on the provider's own site, under the provider's own KYC and fees. |

Guided-rail guarantees, unit-tested in `test/units.mjs`:

- **No credential exists or appears** — the URL contains no `hostApiKey`,
  token or secret of any kind. It is the same public page a bookmark reaches.
- **Nothing is submitted on the user's behalf** — prefill is best-effort; an
  unrecognised parameter simply falls back to the provider's own selector.
- **The catalog is verifiable** — every asset/network pair maps to contract
  metadata already pinned in `src/lib/chains.js`, so the report below always
  watches the exact token the handoff named.
- **No KYC, geo or compliance step is bypassed** — the provider performs all
  of its own checks on its own site; FBT adds none and removes none.

### The on-chain wallet report (both tabs)

Because the guided rail has no webhook, the only truthful post-handoff signal
is the public blockchain. `src/lib/buySellWatch.js` +
`src/components/WalletWatchReport.jsx` poll the watched wallet's balance of
the chosen token through the app's public-RPC read providers and report every
movement — IN for Buy, OUT for Sell — via a pure delta tracker whose rules
are unit-tested:

- the first successful read is the **baseline**, never an event (no false
  instant "deposit" for existing holders);
- the tracker **re-baselines before reporting**, so a delta is never
  double-counted;
- a failed read is not an event and does not move the baseline.

**Wording rule (enforced in i18n copy):** a balance delta proves a
*transfer*, not a *payment*. The report says "deposit detected / withdrawal
detected — matches your order direction" and explicitly states it cannot see
the provider's payment status. It never says "payment confirmed"; only the
credentialed tracked flow, with a signed webhook plus on-chain receipt
verification, may ever say that.
