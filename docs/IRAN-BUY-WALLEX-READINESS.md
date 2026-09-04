# Iranian USDT buy — implementation and activation record

**Status: implemented end to end, fail-closed until a deployment is configured
and reviewed (updated 2026-09-04).**

This document records what is implemented, what has been verified from provider
material, and what an operator must still do before real money moves. The
feature does not turn itself on: the tab is visible to Persian users as a
read-only surface (live rate, calculator, journey, wallet check) and becomes a
payable flow only when every prerequisite in `server/iranBuyConfig.js` is met.

## Product boundary

The surface lives inside the existing **Buy & Sell** page, but it is an isolated
flow rather than another mode of the Ramp wizard:

- It is rendered whenever the active i18n language is `fa`. `GET
  /api/iran/buy/config` decides whether it can take money, not whether it
  exists.
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

The browser receives only a public capability, a public market rate, opaque
short-lived order/binding capabilities in `sessionStorage`, and its own
wallet/order data. It never sees an exchange API key, a merchant id, a provider
raw response, or the readiness checklist.

## The three legs

| Leg | Implementation | Truth source |
| --- | --- | --- |
| Collect Toman | `server/providers/iranZarinpal.js` — hosted checkout | `POST /pg/v4/payment/verify.json` answering 100/101 |
| Buy USDT | `server/providers/iranWallex.js` — OTC against the operator account | provider fill (`executedQty`/`executedSum`/`fills`) |
| Deliver USDT | Wallex crypto-withdrawal + independent RPC verification | an on-chain `Transfer` receipt with the configured token, recipient, amount and confirmations |

### Toman collection (ZarinPal)

A Wallex API key trades the *operator's* exchange account; it is not a customer
payment rail. Customer money is therefore collected through a real PSP:

| Purpose | Method and path | Fields used |
| --- | --- | --- |
| Create checkout | `POST /pg/v4/payment/request.json` | `merchant_id`, `amount` (Rial), `currency: "IRR"`, `description`, `callback_url`, `metadata.order_id` → `data.authority` |
| Hosted checkout | redirect to `/pg/StartPay/{authority}` | composed from the pinned checkout origin, never echoed from the response |
| Confirm payment | `POST /pg/v4/payment/verify.json` | `merchant_id`, `amount`, `authority` → `data.code` 100/101 and `data.ref_id` |
| Reconcile | `POST /pg/v4/payment/unVerified.json` | operator-only listing of collected-but-unverified authorities |

Sources: <https://www.zarinpal.com/docs/paymentGateway/connectToGateway> and
<https://www.zarinpal.com/docs/sdk/php/method/verify>.

Safety properties:

- **Amount unit is explicit.** Toman is converted to Rial (`×10`) and
  `currency: "IRR"` is always sent, on both request and verify, so the two calls
  can never disagree about the unit.
- **`Status=OK` is never evidence.** The browser's return parameters are only
  matched against the order's own authority hash; the payment becomes confirmed
  solely because ZarinPal's verify answered 100/101 for the stored amount.
- **Verify is idempotent** (code 101 = already verified), so an unknown network
  result is retried safely. `request` is never auto-retried: a second authority
  is a second potential charge.
- **No card data** is stored, logged, audited or returned. Only `ref_id` — the
  tracking number the payer already sees — is surfaced.
- A status poll re-asks the PSP one minute after an intent is created, so a
  customer who paid and closed the browser is still reconciled.
- There is no payment webhook endpoint. ZarinPal does not publish a signed
  callback contract for this product, and a guessed HMAC endpoint would be a
  fabricated payment flow.

### Bounded execution (the OTC cost cap)

The documented OTC create endpoint has no client max-cost parameter, so the
bound is enforced before the irreversible call: the live quote may not exceed
the price the customer was quoted times `1 + IRAN_BUY_MAX_SLIPPAGE_BPS/10000`
(exact decimal arithmetic, `__iranBuy.priceCapFor`). Outside the bound the
order stays `PAYMENT_CONFIRMED` / `PRICE_CAP_WAIT` and is retried on the next
poll; after 12 attempts it becomes `FAILED` / `REFUND_REQUIRED` for the manual
refund path. The operator must acknowledge that the residual spread is absorbed
by the treasury (`IRAN_BUY_TREASURY_COST_CAP_ACKNOWLEDGED`).

### Wallex endpoints represented by the server adapter

`server/providers/iranWallex.js` is server-only and pins its origin to
`https://api.wallex.ir`, using the documented `X-API-Key` header:

| Purpose | Method and path | Fields used |
| --- | --- | --- |
| OTC market eligibility | `GET /v1/otc/markets` | Locate only `USDTTMN`; require base `USDT`, quote `TMN`, and `buyStatus: ENABLE`; use provider market precision/minimums. |
| OTC buy quote | `GET /v1/account/otc/price?symbol=USDTTMN&side=BUY` | Provider `price` and `price_expires_at` only. |
| OTC buy | `POST /v1/account/otc/orders` | JSON `{ symbol: "USDTTMN", side: "BUY", amount }`. |
| OTC order reconciliation | `GET /v1/account/orders/{clientOrderId}` | Provider status and executed quantity/sum/fills. |
| USDT withdrawal request | `POST /v1/account/crypto-withdrawal` | JSON `{ coin: "USDT", network, value, wallet_address }`. |
| Withdrawal reconciliation | `GET /v1/account/crypto-withdrawal?page=1&per_page=100` | Find the provider-returned withdrawal id and poll status/tx hash. |

Sources: <https://developers.wallex.ir/docs> and <https://api-docs.wallex.ir/>.

The legacy reference shows the quote fields as a body in a `GET` example.
Standards-compliant `fetch` rejects a GET body, so the adapter serializes the
same documented fields as query parameters. This still needs a production
conformance run (see activation evidence). Do not change it into a guessed
alternate request.

`WALLEX_API_SECRET` is not used because the referenced OTC API documents
`X-API-Key`, not an API-secret signature scheme. The key may be IP-restricted
and time-limited: validate server egress, rotation and least privilege with
Wallex before activation.

### Public reference rate

`GET /api/iran/buy/rate` serves the *public* Wallex market endpoint
(`https://api.wallex.ir/v1/markets`, no key, no account), cached for 30s
server-side. It exists only so the tab can show a real rate and a labelled
estimate. It never prices an order — orders are priced from the authenticated
OTC quote — and if the payload shape is not exactly as expected the route
answers `available: false` instead of inventing a number.

TRC20 remains unavailable: there is no synchronized Tron wallet binding or Tron
finality verifier, so the app cannot claim that a connected wallet is a TRC20
destination.

## State and safety model

Persisted records use schema `fbt.iran-buy-order.v1` under a distinct
`iran-buy:*` namespace, on the existing durable store with **Upstash Redis
atomic leases** (not Blob read/overwrite) for idempotency and state transitions:

```text
CREATED → PAYMENT_PENDING → PAYMENT_PROCESSING → PAYMENT_CONFIRMED
        → PROCESSING → SETTLEMENT_PENDING → SENT → CONFIRMED

terminal: FAILED, CANCELLED, EXPIRED
```

Important properties:

- `PAYMENT_CONFIRMED` is not `CONFIRMED`: it waits for a fresh signature from
  the exact destination wallet before any provider action is eligible.
- A provider POST timeout after an OTC order or withdrawal is recorded as
  reconciliation-required and is **not retried** automatically.
- Provider fee/fill data must be present before a withdrawal amount is chosen.
- An execution whose reported Toman cost exceeds the confirmed customer amount
  is blocked before withdrawal and never reported as success.
- Audit timelines retain no signatures, authorities, raw payment payloads,
  secrets, card data, or checkout URLs.
- Cancelling asks the PSP first: an order paid in the seconds before the click
  is kept (`CANCEL_UNAVAILABLE`) rather than closed with the money collected,
  and a cancelled order stops advertising its checkout link.
- Write actions and provider-polling reads are limited per verified Telegram
  owner using durable Upstash fixed-window counters. Counter failure blocks the
  request.

## Not-yet-live behaviour (what Persian users see today)

When the capability reports `enabled: false`, the panel still renders the live
rate, the Toman → USDT calculator, the destination-wallet check, the four-step
journey and the terms, plus coarse readiness groups (`PAYMENT`, `EXCHANGE`,
`NETWORK`, `STORAGE`, `ACTIVATION`) explaining what is missing. Those groups are
a summary, not the internal checklist: they never name an environment variable,
host, key, or provider. Every mutating route still answers `IRAN_BUY_DISABLED`,
so nothing can be charged.

## Required activation evidence

All of the following must be reviewed and recorded before production values are
set:

1. **Payment collection:** signed ZarinPal merchant agreement, the merchant id
   provisioned server-side, the return page (`/iran-buy/return`) reachable over
   https on the production domain, a supervised real test payment plus a
   verified refund, and the refund/chargeback support playbook.
2. **Wallex OTC:** current official documentation and a supervised conformance
   run confirming quote serialization, market limits, order semantics, and exact
   fee accounting; plus a treasury policy for the slippage the cap allows.
3. **Wallex withdrawal:** supervised lifecycle test confirming
   accepted/pending/failed/broadcast states, lookup semantics, exact returned
   amount/fee meaning, and a safe terminal policy.
4. **Wallet/network:** one product-approved Wallex USDT network mapping to an
   `EVM_CHAINS` id, canonical token contract, decimals, recipient-format test,
   RPC reliability/finality threshold, and no manual destination escape hatch.
5. **Operations/compliance:** key/IP allowlist and rotation plan, Upstash
   availability/restore procedure, rate limits/alerts, legal/KYC/AML review,
   security review of the wallet signatures, staged rollout, and rollback plan.

## Operator activation checklist

Set on the server (never with a `VITE_` prefix), then redeploy:

```bash
IRAN_BUY_ENABLED=true
WALLEX_API_BASE_URL=https://api.wallex.ir
WALLEX_API_KEY=…                       # server-only exchange key
UPSTASH_REDIS_REST_URL=…               # durable atomic store
UPSTASH_REDIS_REST_TOKEN=…
IRAN_BUY_USDT_NETWORK=ERC20            # a Wallex network name
IRAN_BUY_USDT_NETWORK_LABEL=Ethereum
IRAN_BUY_NETWORK_APPROVED=true
IRAN_BUY_WALLET_FAMILY=EVM
IRAN_BUY_EVM_CHAIN_ID=1
IRAN_BUY_USDT_TOKEN_CONTRACT=0xdAC17F958D2ee523a2206206994597C13D831ec7
IRAN_BUY_USDT_DECIMALS=6
IRAN_BUY_MIN_TOMAN=500000
IRAN_BUY_MAX_TOMAN=100000000
IRAN_BUY_PAYMENT_ADAPTER=ZARINPAL
ZARINPAL_MERCHANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
IRAN_BUY_PAYMENT_CALLBACK_URL=https://your-domain/iran-buy/return
IRAN_BUY_APPROVED_PAYMENT_HOSTS=payment.zarinpal.com
IRAN_BUY_PAYMENT_CONTRACT_VERIFIED=true
IRAN_BUY_MAX_SLIPPAGE_BPS=50
IRAN_BUY_TREASURY_COST_CAP_ACKNOWLEDGED=true
IRAN_BUY_WALLEX_WITHDRAWAL_LIFECYCLE_VERIFIED=true
IRAN_BUY_SETTLEMENT_RECONCILIATION_APPROVED=true
```

Any missing or malformed value keeps the tab read-only; nothing partially
activates. Roll back by setting `IRAN_BUY_ENABLED=false` — existing orders stay
readable, and no provider call is made from an unready deployment.

## Tests

```bash
npm run test:iran-buy
```

Three probes run: the safety probe (37 checks), a full lifecycle probe (20
checks) that drives one order from wallet signature → hosted checkout →
verified payment → OTC fill → withdrawal → on-chain receipt against in-process
stubs for Redis, Wallex, ZarinPal and the EVM RPC, and the mounted Persian UI
probe (15 checks).

Together they check that an incomplete deployment cannot activate itself, that a complete
one exposes no credential, that both provider adapters use exactly the
documented endpoints and units, that verification (not a redirect parameter) is
the only proof of payment, that the price cap is exact decimal arithmetic (a market that jumps after
payment holds the order and settles it later instead of under-delivering), that
a chain transfer whose amount differs from the withdrawal is quarantined rather
than confirmed, and that the Persian UI renders correctly in both the live and
the not-yet-live state. No test sends an order, payment, withdrawal, or transaction to a
provider.
