# BUY / SELL provider integration status

## Current status: deliberately unavailable

The native **BUY / SELL** page is the only purchase/sale surface. It currently
shows `UNAVAILABLE` and cannot create a quote, order, hosted-checkout URL, or
settlement event.

The placeholder named `changenow_fiat` in `server/buySell.js` is **not an
active ChangeNOW integration**. It is a fail-closed provider interface that
returns `PROVIDER_REQUIRES_INTEGRATION`. No environment variable can activate
it. This is intentional: this repository does not have authoritative Fiat
checkout callback, signature, event, or authenticated settlement-status
specification for that provider.

`POST /api/v1/buy-sell/webhooks/:provider` also returns HTTP 503. It does not
parse or trust an undocumented signature header or payload, and a browser
return URL never updates an order to complete.

## Non-custodial boundary

FBT must not receive card data, fiat, private keys, or seed phrases. A future
approved provider must settle purchased crypto directly to the user-confirmed
wallet on the selected supported network. Off-ramp/sell is separately
unavailable until an approved provider offers a documented source-wallet and
fiat-payout flow.

There is no CEX order-book, CEX API, or redirect to a CEX trading page in the
Buy / Sell client or server path.

## Required evidence before an adapter may be implemented

Obtain this from the provider's official developer documentation and the
merchant/partner agreement, then add it to a reviewed integration change:

1. Hosted/embedded checkout creation endpoint, request schema, response
   schema, authenticated API mechanism, and approved checkout origins.
2. Official asset/network, country/residency, KYC/AML, payment-method, and
   min/max eligibility matrix for the specific FBT merchant account.
3. Immutable provider order/session ID and a documented authenticated status
   endpoint that is bound to that ID.
4. Callback URL registration requirements, exact raw-body signature algorithm,
   signature header, timestamp tolerance, event IDs, retry/replay behavior,
   IP/TLS requirements, and key-rotation procedure.
5. Documented settlement event fields that bind provider reference, asset,
   chain/network, recipient, exact decimal amount, and on-chain transaction
   hash. A payment-success event alone is insufficient.
6. Production and sandbox approval, a successful end-to-end sandbox test, and
   a compliance/legal review for each enabled geography and payment rail.

Do not infer any of those fields from a crypto-swap API, a status page, a
return URL, or generic HMAC examples.

## Existing guardrails to preserve when activated

- The service exposes a versioned provider/router interface, explicit order
  states, opaque session-only browser order capabilities, no-store responses,
  explicit checkout confirmation, and an atomic Upstash `SET NX EX`
  idempotency primitive.
- `verifyEvmSettlement()` is the prospective BSC verification gate. It checks
  RPC chain ID, successful receipt, confirmations, normalized recipient,
  canonical token/native transfer, and exact integer-unit amount. RPC failure,
  a missing transaction, a wrong recipient/amount, or insufficient
  confirmations is never `COMPLETED`.
- Completion refreshes the client wallet and portfolio readers only after
  verified settlement. It must never synthesize a balance or transaction.
- A future payment action needs a dedicated private durable order/audit store,
  distributed rate limits, retry/terminal idempotency semantics, and a
  reconciliation worker that uses only the documented provider status API.

## Current blockers

| Blocker | Effect |
| --- | --- |
| Official Fiat callback/signature/event/status contract absent | Buy provider remains unavailable; callback disabled. |
| No contracted off-ramp source-wallet/fiat payout mechanism | SELL remains unavailable. |
| No approved country/payment/asset matrix for an FBT merchant account | No asset, country, or payment method is presented as purchasable. |
| No provider sandbox/production credentials and compliance approval | No provider checkout test can be performed. |
| No reconciliation worker or payment-specific durable store | Production money-movement activation is blocked. The capability-protected audit timeline endpoint is not a substitute for either. |

The safety probe is `npm run test:buy-sell`; it asserts these fail-closed
responses rather than pretending a payment integration exists.
