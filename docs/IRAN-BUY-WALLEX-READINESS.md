# Iranian USDT buy — Wallex readiness record

**Status: disabled / fail-closed as of 2026-09-03.**

This document records what is implemented, what has actually been verified from
Wallex material, and—equally importantly—what has **not** been verified. The
feature is deliberately not exposed by default. `IRAN_BUY_ENABLED=true` is not
enough to expose it.

## Product boundary

The surface lives inside the existing **Buy & Sell** page, but it is an isolated
flow rather than another mode of the Ramp wizard:

- It is rendered only when the active i18n language is exactly `fa` **and**
  `GET /api/iran/buy/config` reports `enabled: true`.
- Its top-level tab is `فقط برای ایرانیان`; its only sub-tab is `خرید`.
- Asset and network come only from server configuration. The browser has no
  asset/network picker and never submits either value.
- The current wallet architecture is EVM-only. The configured destination is a
  signed, expiring proof of the active EVM account; no pasted/fallback address
  exists. Before a funded order can become a withdrawal, the same active wallet
  must sign a second order-specific confirmation.
- All mutation routes require validated Telegram Mini App `initData` in
  addition to the signed wallet proof. The ordinary optional Telegram middleware
  is not considered authentication for this flow unless it has attached a valid
  `req.tgUser`.

The browser receives only a public capability, opaque short-lived order/binding
capabilities in `sessionStorage`, and its own wallet/order data. It never sees
an exchange API key, webhook secret, provider raw response, or readiness
checklist.

## Wallex endpoints represented by the server adapter

`server/providers/iranWallex.js` is server-only and pins its origin to
`https://api.wallex.ir`. It uses the documented `X-API-Key` header. The adapter
contains these exact endpoint paths and fields, but **none are called while the
feature remains disabled**:

| Purpose | Method and path | Fields used |
| --- | --- | --- |
| OTC market eligibility | `GET /v1/otc/markets` | Locate only `USDTTMN`; require base `USDT`, quote `TMN`, and `buyStatus: ENABLE`; use provider market precision/minimums. |
| OTC buy quote | `GET /v1/account/otc/price?symbol=USDTTMN&side=BUY` | Provider `price` and `price_expires_at` only. The browser does not receive a locally generated rate. |
| OTC buy | `POST /v1/account/otc/orders` | JSON `{ symbol: "USDTTMN", side: "BUY", amount }`. |
| OTC order reconciliation | `GET /v1/account/orders/{clientOrderId}` | Provider status and executed quantity/sum/fills. |
| USDT withdrawal request | `POST /v1/account/crypto-withdrawal` | JSON `{ coin: "USDT", network, value, wallet_address }`. No user-supplied network/address is forwarded. |
| Withdrawal reconciliation | `GET /v1/account/crypto-withdrawal?page=1&per_page=100` | Find the provider-returned withdrawal id and poll provider status/transaction hash. |

Sources consulted:

- Current Wallex documentation entry point: <https://developers.wallex.ir/docs>
- Official legacy API reference, OTC market/price/order descriptions:
  <https://api-docs.wallex.ir/#5dbb671bc6>
- Official legacy API reference, crypto withdrawal/list descriptions:
  <https://api-docs.wallex.ir/#5dbb671bc6>

The legacy reference shows the quote fields as a body in a `GET` example.
Standards-compliant `fetch` rejects a GET body, so the adapter serializes the
same documented fields as query parameters. That serialization has **not** been
confirmed by a current production Wallex conformance test; it is another reason
the feature is disabled. Do not change it into a guessed alternate request.

The legacy reference also documents a private API key, potentially IP-restricted
and with a bounded lifetime. Before a future activation, operations must
validate server egress/IP allowlisting, secret rotation/expiry, and least
privilege with Wallex. `WALLEX_API_SECRET` is not used because the referenced
OTC API documents `X-API-Key`, not an API-secret signature scheme.

## What Wallex material does *not* establish

The documented OTC flow is a trade against the balances of the configured
Wallex **operator account**. It does **not** establish any of these necessary
customer-facing capabilities:

1. a user Toman/card/bank payment initiation or hosted merchant checkout;
2. a per-user Wallex authorization/OAuth model that debits that user rather than
   FBT/operator funds;
3. a signed Wallex payment webhook or merchant payment-reconciliation contract;
4. a documented OTC maximum-cost/idempotency parameter that makes a customer
   payment safe if an order POST times out or price changes; or
5. a current documented withdrawal-finality webhook/history contract sufficient
   to call a payment settled without independent chain verification.

The example withdrawal response in legacy docs includes `status: Accomplished`
and a transaction hash. That example is not treated as finality. For an
EVM-compatible, explicitly configured network, the implementation requires an
independent RPC receipt with: correct chain id, successful receipt, configured
USDT token contract, exact `Transfer` recipient and amount, and configured
minimum confirmations before state `CONFIRMED` is allowed.

TRC20 is intentionally unavailable. The application does not currently have a
synchronized Tron wallet binding or a Tron finality verifier, so it cannot claim
that an active connected wallet is a TRC20 destination. A future product may add
one only with a real Tron wallet architecture and equivalent verification.

## State and safety model

Persisted records use schema `fbt.iran-buy-order.v1` under a distinct
`iran-buy:*` namespace. They use the existing durable store and **Upstash Redis
atomic leases** (not Blob read/overwrite) for idempotency and state transitions.
The defined order states are:

```text
CREATED → PAYMENT_PENDING → PAYMENT_PROCESSING → PAYMENT_CONFIRMED
        → PROCESSING → SETTLEMENT_PENDING → SENT → CONFIRMED

terminal: FAILED, CANCELLED, EXPIRED
```

Important properties:

- `PAYMENT_CONFIRMED` is not `CONFIRMED`: it waits for a fresh signature from
  the exact destination wallet before any provider action is eligible.
- A provider POST timeout after an OTC order or withdrawal is recorded as
  reconciliation-required and is **not retried** automatically. Retrying an
  unknown exchange command can double-buy or double-withdraw.
- Provider fee/fill data must be present before a withdrawal amount is chosen.
  No fee means no automatic withdrawal.
- An execution whose reported Toman cost exceeds the confirmed customer amount
  is blocked before withdrawal and never reported as success.
- Audit timelines retain no signatures, raw payment payloads, secrets, card
  data, or checkout URLs. The browser can retrieve only timestamp/type audit
  events with its order capability and authenticated Telegram identity.
- Write actions and provider-polling reads are limited per verified Telegram
  owner using durable Upstash fixed-window counters. Counter failure blocks the
  request; it never falls back to an instance-local, bypassable allowance.
- No payment webhook endpoint is mounted today. Wallex documentation reviewed
  for this work does not establish a customer-payment callback schema, so a
  guessed HMAC header/body would be a fabricated payment flow. A future reviewed
  payment adapter must add its own raw-body verifier from its signed contract.

## Required activation evidence

All of the following must be reviewed and recorded before a code change removes
any fail-closed blocker:

1. **Payment collection:** an approved Iranian payment provider/merchant
   contract, backend intent creation contract, allowlisted checkout host,
   mutually documented signed callback/reconciliation fields, replay handling,
   refund/chargeback operations, and a test merchant run. No browser payment URL
   may be composed from environment strings.
2. **Wallex OTC:** current official documentation and a non-financial sandbox or
   supervised conformance run confirming current quote serialization, market
   limits, order idempotency/retry semantics, cost/price bound, and exact fee
   accounting.
3. **Wallex withdrawal:** current documentation plus supervised lifecycle test
   confirming accepted/pending/failed/broadcast states, lookup/reconciliation
   semantics, exact returned amount/fee meaning, and a safe terminal policy.
4. **Wallet/network:** one product-approved Wallex USDT network that maps to an
   existing `EVM_CHAINS` id, canonical token-contract address, token decimals,
   recipient-format test, RPC reliability/finality threshold, and no manual
   destination escape hatch.
5. **Operations/compliance:** key/IP allowlist and rotation plan, Upstash
   availability/restore procedure, rate limits/alerts, support/refund playbook,
   legal/KYC/AML review, security review of the wallet signatures and webhook,
   staged rollout, and incident rollback plan.

The required environment names are documented in `.env.example`. In particular,
`IRAN_BUY_ENABLED=false` remains the safe default. Environment attestations such
as `IRAN_BUY_PAYMENT_CONTRACT_VERIFIED` do not on their own activate the feature:
`server/iranBuyConfig.js` deliberately retains both
`PAYMENT_COLLECTION_ADAPTER_NOT_IMPLEMENTED` and
`WALLEX_OTC_COST_CAP_CONTRACT_REQUIRED` blockers until an actual reviewed payment
adapter and bounded-execution contract are implemented.

## Tests

Run the focused safety/UI suite with:

```bash
npm run test:iran-buy
```

It checks the disabled public capability, absence of a legacy direct Wallex
route, no client credential/header path, exact static asset/network boundary,
provider endpoint shape under a mocked upstream, and UI rendering/visibility
behavior for `fa` versus non-Persian locales. The tests do not send an order,
payment, withdrawal, or transaction to Wallex.
