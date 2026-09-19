# Bridge signing review and native deposit guidance — 2026-09-19

## Reported WalletConnect warning

The reported `0x55d398326f99059ff775485246999027b3197955` is the BNB Chain token contract in our registry. BscScan labels it **Binance-Peg BSC-USD** (18 decimals):
https://bscscan.com/token/0x55d398326f99059ff775485246999027b3197955

An ERC-20 `approve(spender, amount)` transaction targets the **token contract**; the spender is encoded inside the calldata. The subsequent bridge transaction targets the bridge contract. Neither address is the user's destination-chain recipient.

This does **not** establish why a particular wallet raised “Poisoning alert”, and does **not** prove a spender or arbitrary calldata safe. No wallet reputation check, WalletConnect Verify setting or warning was disabled. Reproducing the actual alert still requires the wallet name/version and the rejected request details (chain, target, calldata, spender; no seed, credentials or signatures). No mainnet transaction was signed in this work.

### Changes

- Both token-tab providers show a cancellable, translated pre-wallet review: source chain, provider, amount, token contract, spender, bridge target and payout address. Full addresses remain LTR in RTL layouts. The BNB USDT case includes a BscScan link and a role explanation, not an allowlist exemption.
- Shared EVM execution binds the refreshed quote to the requested chain pair, token pair, amount and any returned sender/recipient. It rejects malformed requests, direct ERC-20 transfer/approval payloads presented as bridge calls, a bridge target equal to the source token/recipient, missing approval targets and targets with no contract code.
- Re-check signer/network after review and before approval/broadcast. Transactions include the intended chain ID. Only newly required exact-amount approvals are sent, with the existing zero-reset behavior retained. Quotes expiring during review/approval do not broadcast a bridge transaction.
- deBridge uses **the freshly built order's** `tx.allowanceTarget` (or its own bridge target), not `dln.allowanceTarget` from an older price quote.
- The send button is bound to the quoted form inputs; stale quotes and invalid destination input cannot fall back to another recipient silently.

These are structural checks, **not** a complete calldata audit, router allowlist, simulation or reputation oracle. They do not certify an otherwise valid-looking malicious contract. Wallet warnings must still be respected.

## Native tab

Native signing remains **not integrated in this panel**. The existing generic EVM send / BTC send flows are not wired here: safe integration needs validated live vault/router information, chain-specific construction, quote/amount/expiry binding and tracking. Merely forwarding an address and memo to a generic Send sheet would be unsafe.

The accepted fallback is a theme-token-based expandable guide in **Persian, English and Arabic**, with the existing English fallback for other locales:

1. Choose a currently supported wallet in a THORChain-integrated interface (THORSwap link; never import a seed on a website).
2. Obtain the user's receiving address on the destination network. This form does not support destination tags or exchange deposits.
3. Network-specific instructions: UTXO **OP_RETURN**, EVM router **depositWithExpiry**, Cosmos on-chain **Memo**, conservative refusal of generic Send instructions on other chains.
4. Request and review a new quote in the chosen external interface; never mix that quote with this panel's memo/vault.
5. Keep the transaction hash, track there and do not double-send on a delay.

Advanced deposit details separately label recipient, temporary vault, router and memo. They are not displayed without a plausible destination, a matching request snapshot, a matching destination in the memo and an expiry more than 30 seconds away. Expired details are hidden; copy actions re-check time at the click itself. Editing any input invalidates the display immediately; stale async responses cannot restore it. A refresh button obtains a new quote.

Protocol reference: https://dev.thorchain.org/concepts/sending-transactions.html

## Verification

- `npm run test:bridge-safety`: 51 tests covering execution guards and review cancellation; fresh deBridge spender selection and stale-form gating; exact/zero-reset/already-sufficient allowance behavior; expiry/account changes; native request binding and late responses; native UI instructions, copy/expiry/refresh, Arabic/Persian translations and placeholder parity.
- `npm run test:cross-chain`: shared engine regression probe (115 checks). Its source-level approval assertion was updated for the explicit chain-ID override; runtime tests also assert the exact amount.
- Existing bridge/notification probe: 21 checks (import its default rows to assert results; running the module alone does not assert them).
- `npm run build`: production build succeeds; existing large-chunk/deprecation warnings remain.
- DOM tests use mocked wallet/RPC/network results. No real wallet alert reproduction, real-fund signing or browser screenshot verification is claimed. Chromium download for visual QA was blocked by CDN connection resets in this workspace.
