# Lending / Lending & Borrowing — Audit & Production Fix

**Date:** 2026-09-22
**Scope:** the Lending page (`/loan`) and everything it depends on. No other page, route, nav item,
or module was redesigned, deleted, or disabled (§1). Nothing was replaced with a demo.
**Branch:** `arena/01a0c508-fbtcryp` · **Base:** `36fe872`
**Verdict:** implemented and tested offline. **Not** verified against a live chain or a real wallet
— see [§9 Remaining external requirements](#9-remaining-external-requirements), which is the honest
limit of this work and the reason several rows below say UNVERIFIED rather than PASS.

---

## 1. Feature classification (before anything was changed) (§2)

Every feature on the page was classified first, because the fix differs by class.

| Feature | Class found | What that meant |
|---|---|---|
| Supply / Borrow / Repay / Withdraw forms | **Real, incomplete** | Wired to a real Aave V3 client, but validated after signing rather than before |
| APY / APR badges | **Real** | Read from the pool (`currentLiquidityRate`), correct ray→APY compounding |
| Health factor | **Real, duplicated** | Two independent implementations disagreed with each other |
| Borrowing power | **Fake** | A hardcoded `35` in the UI, not the pool's `availableBorrowsBase` |
| Max borrow | **Fake** | Not implemented; the button had no computation behind it |
| Positions (supplied / debt) | **Real** | aToken + debt-token balances, correct |
| Collateral on/off toggle | **Missing** | No UI, no `setUserUseReserveAsCollateral` path at all |
| Transaction history | **Fake** | Rows rendered from a static array with invented hashes |
| Gas / network fee | **Fake** | A hardcoded "FBT Fee" card in the hero, and no real fee estimate |
| Simulation before signing | **Missing** | Transactions went to the wallet un-proven |
| Oracle prices | **Missing (client), Mislabelled (server)** | Client had no oracle read; the BFF called CoinGecko prices `aave-oracle` |
| Market depth / caps / LTV | **Missing** | Reserve configuration bitmap was fetched but never decoded for these fields |
| Data freshness / staleness | **Missing** | No polling, no age label, no refresh after a transaction |
| Network rail | **Partly fake** | Showed chains with no pool wiring as if selectable |
| Per-symbol "risk" pill | **Fake** | Hardcoded table keyed by ticker, defaulting to "medium" |
| Read-only / circuit breaker | **Real, display-only** | Banner rendered, but transactions were still allowed |
| Intent OS hand-off | **Real** | Preserved unchanged (§33: Lending stays standalone) |

## 2. Root cause

Not one bug but one **missing layer**. `src/lib/lending.js` was a competent chain client and
`src/pages/Loan.jsx` was a competent UI, with nothing between them: no place for a pre-flight
decision, no place for a data-status vocabulary, no place for a risk projection. So each component
invented its own answer — the page hardcoded a borrowing power of `35`, computed a health factor one
way while the engine computed it another, rendered a static array as transaction history, and let a
transaction reach the wallet without asking whether it would revert.

Three consequences followed, and they explain most of the individual findings:

1. **A failed read had nowhere to go.** With no status vocabulary, "could not read this" became `0`,
   `null`, or a plausible default — indistinguishable from a real value on screen (§3, §37).
2. **Validation happened after signing.** The only gate was the wallet's own rejection, so the user
   paid gas to discover what the protocol would have told them for free (§9, §22).
3. **The server and the client described the same chain differently.** The BFF read prices from
   CoinGecko and labelled them `aave-oracle`; the client read nothing. Two sources of truth about
   one market (§21, §32).

## 3. Files changed

| File | Change |
|---|---|
| `src/lib/lending-service.js` | **New (1007 lines).** The missing layer: `readMarketState`, `evaluateAction`, `projectActionRisk`, `getMaxBorrow`, `simulateLendingPlan`, `estimateNetworkFee`, `executeLendingPlan`, `createMarketCache`, `createTransactionHistory`, `assertLendingContracts`, `DATA_STATUS`, `TX_STATUS` |
| `src/lib/lending.js` | +786. Reserve-configuration bitmap decode, `readOraclePrices`, `readUserConfiguration`, `readReserve` liquidity/caps/decimals cross-check, `maxBorrowWei`, `projectHealthFactor`, `assertCollateralChangeSafe`, collateral step in `buildLendingPlan` |
| `src/pages/Loan.jsx` | +1689/−245. Repair, not redesign: existing layout, components and route preserved |
| `src/lib/lending-engine/adapter.js` | +15. `buildCollateralTransaction` on the Aave adapter and the base contract |
| `server/lending.js` | +344. Real on-chain oracle, complete reserve-config decode, decimals cross-check, honest `/alerts` oracle status |
| `src/i18n/locales/{en,fa,ar,es,fr,hi,id,pt,ru,tr,ur,zh}.json` | 339 `loan.*` keys in **all 12** locales, at exact parity |
| `test/lending-service.test.js` | **New.** 55 tests on the service layer |
| `test/lending-bff-config-probe.test.js` | **New.** 12 tests cross-checking the BFF against the client |
| `package.json` | +2 scripts: `test:lending-service`, `test:lending` |

**Nothing was deleted.** `git status` shows zero deletions or renames; `/loan` is still mounted at
`src/App.jsx:429` and the `nav.loan` item is intact.

## 4. Code reused rather than duplicated (§4, §8)

The repo already contained most of the hard parts. They were wired in, not rewritten:

| Reused | From | For |
|---|---|---|
| `simulateUnsignedTransaction`, `buildUnsignedTransaction`, `checkAllowance`, `decodeRevertReasonAsync` | `src/lib/preSignSimulation.js` | §22 simulation — the same honesty contract the swap flow uses |
| `assertProviderChain`, `assertSignerContext`, `isUserRejection`, `isTransactionReplacement`, `waitForMinedReceipt`, `assertSuccessfulReceipt` | `src/lib/defi/executionGuards.js` | §9/§29 pre-sign guards; the account/network can no longer change mid-flight unnoticed |
| `assessPosition`, `riskLevel`, `DEFAULT_RISK_BANDS`, `evaluateAlerts` | `src/lib/lending-engine/health.js`, `alerts.js` | One health-factor and risk-band definition, replacing the page's private copy |
| `mapRawError`, `LENDING_ERRORS` | `src/lib/lending-engine/errors.js` | §28 granular error mapping — a raw RPC string never reaches a user |
| `createTransactionMachine`, `createInFlightGuard`, `makeIdempotencyKey`, `createCircuitBreaker` | `src/lib/lending-engine/` | Existing state machine kept; read-only mode now *enforced*, not just displayed |
| `WalletContext` (`getSigner`, `getReadProvider`, `switchChain`) | `src/context/WalletContext.jsx` | §8 — the existing non-custodial wallet infra, untouched |
| `TOKENS`, `EVM_CHAINS`, `explorerTx` | `src/lib/chains.js` | §6 — addresses and decimals only from the audited registry |

`server/lending.js` cannot import `src/lib/lending.js` (that file pulls the Vite chain registry into
Node), so the reserve-config bit layout is necessarily written twice. Rather than leave that silent,
`test/lending-bff-config-probe.test.js` **pins** the two: same shifts, same decoded values across a
matrix of bitmaps, identical oracle calldata. It has already earned its keep — see §6, finding B23.

## 5. Real integrations, per protocol (§30, §31, §32)

| Protocol | Status | Detail |
|---|---|---|
| **Aave V3** | **WIRED, 7 chains** | Ethereum (1), Optimism (10), BNB (56), Polygon (137), Base (8453), Arbitrum (42161), Avalanche (43114). Pool addresses hardcoded from the audited registry and **never inferred** (§6). Reads: `getReserveData`, `getUserAccountData`, `getUserConfiguration`, `getPriceOracle`→`getAssetPrice`/`getAssetsPrices`/`BASE_CURRENCY_UNIT`, aToken/debt-token `balanceOf`, ERC-20 `decimals`/`allowance`/`balanceOf`. Writes: `supply`, `borrow`, `repay`, `withdraw`, `setUserUseReserveAsCollateral`, `approve` (exact amount, never `MaxUint256`) |
| **Compound V3 / Morpho** | **Adapter present, refuses** | Registered for Base in the engine but not reachable from the Lending page. Every method fails loudly rather than returning a plausible default |
| **Solana lending** | **Not integrated** | Registered as chain `900001` with a Pyth oracle, but the adapter refuses with `NO_POOL_REGISTERED` on every call. Audited separately per §7 — **no EVM assumption** (no allowance step, no `uint256`, no EVM gas model) is applied to it |
| **CEX** | **None** | No exchange is used for core state. CoinGecko appears **only** as an explicitly-labelled `reference` for anomaly detection, and its failure cannot flip lending read-only (§32) |

Reserves offered per chain come from `RESERVE_SYMBOLS` intersected with the app's own token registry
— so an asset is offered only if it is both an Aave reserve and a registered token with a known
address and decimals. Linea (59144) and Sonic (146) are registered but `enabled: false`
(`POOL_NOT_WIRED`); the rail now shows them as **coming-soon chips** that cannot be selected, rather
than as broken markets (§5).

## 6. What was actually fixed

B1–B22 were found in the first pass; B23–B25 emerged from the tests written afterwards.

| # | Finding | Fix |
|---|---|---|
| B1 | Borrow form used the *borrowed* asset as its own collateral input | Separate collateral-asset selector; defaults to "use my existing collateral" (§11) |
| B2 | Risk projected from raw token amounts, ignoring price | `projectActionRisk` prices every leg through the protocol oracle (§13) |
| B3 | Borrow not gated on capacity or liquidity | `getMaxBorrow` + `evaluateAction` gate on `availableBorrowsBase`, pool liquidity and the borrow cap (§11/§20) |
| B4 | Read-only mode displayed but not enforced | Enforced in `openExecution` **and** at signature time in `confirmExecution` (§27) |
| B5 | Withdraw not gated on the resulting health factor | Projection runs before the button enables (§17) |
| B6 | Two disagreeing health-factor implementations | Unified on the engine's `assessPosition`/`riskLevel` (§14) |
| B7 | No simulation | `simulateLendingPlan` — real `eth_call` + `estimateGas` per step (§22) |
| B8 | No gas estimate | `estimateNetworkFee` via `provider.getFeeData()`; never a hardcoded gas price (§23) |
| B9 | Reserve configuration fetched, not decoded | Full bitmap decode → LTV, thresholds, caps, paused/frozen/borrowingEnabled (§13/§20/§29) |
| B10 | No oracle read on the client | `readOraclePrices` with staleness handling (§21) |
| B11 | No max-borrow computation | `maxBorrowWei` names its binding constraint in `limitedBy` (§12) |
| B12 | LTV / liquidation threshold not shown | `MarketDepth` + risk cells in the account summary (§13) |
| B13 | No collateral toggle | Positions tab toggle with an `assertCollateralChangeSafe` pre-check (§15) |
| B14 | No MAX for repay/withdraw | MAX signs the `uint256` sentinel but **simulates and displays the real amount** (§16/§17) |
| B15 | History was a static array with invented hashes | Real history: entries exist from attempt start with **no hash**, a hash appears only when the wallet returns one, statuses `PENDING/CONFIRMED/FAILED/REPLACED/UNKNOWN`, explorer links (§27) |
| B16 | No refresh discipline | Poll every 45 s + `visibilitychange` + `focus` + forced refresh after every transaction; cache invalidated by market prefix (§25/§26) |
| B17 | Native token detected by symbol | Uses the registry's `native: true` flag |
| B18 | Decimals taken from the registry alone | Contract `decimals()` read and cross-checked against the bitmap; a mismatch is surfaced, not silently resolved (§18) |
| B19 | No "data unavailable" state | `DATA_STATUS.UNAVAILABLE` + a banner that says what failed and offers a retry (§37) |
| B20 | No pre-sign chain/account guard | `assertProviderChain` + `assertSignerContext` in `executeLendingPlan` (§29) |
| B21 | Hero showed an invented "FBT Fee" | Replaced with **"No FBT fee"** — FBT takes no fee on lending, and the network fee is shown separately and labelled (§24/§41) |
| B22 | Unwired chains looked selectable | Coming-soon chips with the reason in the tooltip (§5) |
| **B23** | **Client called a zero reserve bitmap `status: 'active'`** — a failed read presenting itself as an open market | Now `'unknown'`. Found by the cross-check test. Deliberately does **not** gate anything: callers still block only on an explicitly-true paused/frozen, so this changes a label, not an availability rule (§3/§37) |
| **B24** | **Client returned a cap of `0n` for an uncapped reserve**, contradicting its own documented contract ("0 means no cap → null"). Downstream readers already treated it as unlimited, so no borrow was blocked — but `supplyCapWhole: "0"` reached the UI as a real cap of zero tokens | `capOrNull()` on both client and server; pinned by the cross-check test (§20) |
| **B25** | **Server labelled CoinGecko prices `aave-oracle`** while the client read no oracle at all — and `/alerts` inferred oracle health from the circuit breaker, reporting `ok` for an oracle the process had never reached | Server now reads `pool.getPriceOracle()` → `getAssetPrice`. CoinGecko is demoted to a labelled `reference` used only to flag a >10 % deviation. `/alerts` reads the oracle. A zero price is treated as **missing**, never as "$0" (§21/§32) |
| B26 | Supply-side pill rendered a hardcoded per-symbol risk table, defaulting unknown tickers to "medium", using the Invest page's vocabulary, sitting under a live APY | Replaced with `ReserveStatePill`: the protocol's own paused/frozen state, or its live max LTV. Renders **nothing** when the bitmap could not be read (§37) |

Two decisions worth stating explicitly, because they are judgement calls rather than bug fixes:

- **A missing oracle price warns, it does not hard-disable borrowing.** The pool's own
  `getUserAccountData` is oracle-backed and still gates the amount, so the user is told "capacity
  unverified" and can proceed. Hard-blocking would strand users during a price-feed outage on a
  market the protocol still considers solvent. Full max-borrow and the hard gate apply only when the
  price is known.
- **A MAX sentinel is signed but never priced.** `eth_call` reverts on `uint256.max`, so simulation
  and every USD figure use the real balance/debt. Pricing the sentinel would produce an absurd number
  wearing an authoritative format.

## 7. Wallet integration — PASS / FAIL (§8)

Non-custodial throughout: the server builds unsigned calldata and holds no key; only the user's
wallet signs.

| Check | Result |
|---|---|
| Injected wallet connects and arms the in-page action button | **PASS** (probe) |
| Approval is the exact amount, never `MaxUint256` | **PASS** (probe + adapter test) |
| Supply signs `Pool.supply` with the exact amount and the user as beneficiary | **PASS** (probe) |
| Borrow signs a single transaction — no approval needed | **PASS** (probe) |
| Repay signs an approval first, then `Pool.repay` | **PASS** (probe) |
| Withdraw signs `Pool.withdraw` with the user as recipient | **PASS** (probe) |
| Nothing is signed on behalf of the app itself | **PASS** (probe) |
| Receipt links the real transaction hash | **PASS** (probe) |
| Chain switch offered when the wallet is on the wrong network | **PASS** (probe) |
| Adapter declares `capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' }` | **PASS** (test) |
| Account/chain change mid-flight aborts before signing | **PASS** (guard unit-tested; **UNVERIFIED** against a live wallet) |
| **MetaMask / Rabby / WalletConnect on a real device** | **UNVERIFIED** — no wallet available in this environment |
| **Android / mobile layout on a real device** | **UNVERIFIED** — §35 addressed in CSS only, not on hardware |
| **A real transaction against a live pool** | **NOT ATTEMPTED, deliberately** — §39 forbids auto-sending a real transaction |

## 8. Security (§29) and tests (§36, §38)

**Security.** Contract addresses come only from the audited registry and are re-checked by
`assertLendingContracts` before any RPC is dialled — an address from a URL, a hand-off, or a response
is refused with `TOKEN_NOT_ALLOWED`. All token arithmetic is `BigInt` with decimals read from the
contract (§18); the only float step is the final display conversion. Pre-sign guards reject a changed
account or network. A `revert-detected` simulation **disables the Confirm button** — a hard stop, not
an advisory. A simulation that could not complete reports `provider-busy` and is explicitly *not*
reported as a pass. Approvals are exact-amount. Errors pass through `mapRawError`, so a raw RPC
string never becomes a user-facing explanation, and a code the engine does not define is never
invented.

**Tests.** All offline; no RPC is dialed.

| Suite | Result |
|---|---|
| `test/loan-execution-probe.jsx` — the page end to end against a stubbed RPC | **37/37 PASS** |
| `test/lending-service.test.js` — new, service layer | **55/55 PASS** |
| `test/lending-bff-config-probe.test.js` — new, client↔server cross-check | **12/12 PASS** |
| `test/lending-engine-probe.mjs` | **PASS** (48 checks) |
| `test/lending-bff-probe.mjs` — real HTTP against the BFF | **16/16 PASS** |
| `test/intent-ai/lending-adapters-probe.mjs` | **30/30 PASS** |
| Production build `npx vite build` (§38) | **PASS** (exit 0; only pre-existing chunk-size and dynamic-import warnings) |
| `npm test` (whole repo) | **48/50** in `app-network-parity-probe`; the 2 failures are **pre-existing** — reproduced identically at base commit `36fe872` in a clean worktree, and both are in unrelated modules (network picker, perp page) that this scope forbids touching |

The four baselines were green before the first edit and are green after the last, so nothing was
traded away. The 37-assertion page probe was the constraint that shaped several decisions: its stub
returns `0x` for unknown selectors and `0n` for the reserve configuration, which is why availability
is gated on an *explicitly true* paused/frozen rather than on the `active` bit — a stricter rule
would have read that stub as "every market is closed".

Note on `npm test` in CI: it ends with a full production `vite build` that is **OOM-killed on a 4 GB
box** at the default heap (exit 137). This is pre-existing and environmental — the same build passes
with `NODE_OPTIONS=--max-old-space-size=3072`, and `test/run.mjs` already documents the trap and
honours `FBT_TEST_BUILD_HEAP`.

## 9. Remaining external requirements

These cannot be closed from this environment and are **not** claimed as done:

1. **Live RPC verification (§39).** Every outbound HTTPS call except the npm registry is blocked here
   (`SSL_ERROR_SYSCALL`). All reads are therefore exercised against a stubbed RPC. Before release,
   run read-only against each of the 7 chains and confirm: reserve list, rates, oracle prices, caps,
   and one wallet's account data. **Never** auto-send a real transaction.
2. **Real wallet pass.** MetaMask, Rabby and WalletConnect on desktop and Android, covering: connect,
   chain switch, approval + supply, borrow, repay, withdraw, collateral toggle, and rejection mid-flow.
3. **Contract-address re-verification (§6).** The pool addresses are the audited ones in the registry,
   but each should be re-confirmed against Aave's published deployments per chain before launch —
   especially Base (8453) and BNB (56), which differ from the shared `0x794a…14aD`.
4. **Protocol totals.** `/markets` still returns `totalSupply`, `totalBorrow` and `availableLiquidity`
   as honest `null`s pending a `UiPoolDataProvider` aggregation or an indexer. The client reads
   liquidity directly from aToken/debt total supplies, so the *page* is not blocked on this.
5. **Solana (§7).** Registered and refusing cleanly. A separate audit is required before it is enabled;
   no EVM assumption may be carried over.
6. **CI heap.** Raise the build heap or set `FBT_TEST_BUILD_HEAP` so `npm test` completes on 4 GB runners.
7. **Pre-existing parity failures.** `wallet: the network picker maps the whole registry` and
   `perp: the virtual-credit doorway has a real minimum height` fail at the base commit. Out of scope
   here; they should not be attributed to this change.

## 10. Acceptance criteria (§40)

| Criterion | Status |
|---|---|
| Only Lending touched; no page/route/nav deleted | **MET** — zero deletions; `/loan` and `nav.loan` intact |
| No fake APY, balances, positions, transactions, or protocol data in production | **MET** — every fabricated source removed (B15, B21, B26) or replaced with a live read |
| Live / cached / estimated / unavailable distinguished in the UI | **MET** — `DataStatusPill`, `UpdatedAgo`, `OracleNote`, `UnavailableBanner` |
| Clean layering UI → state → service → protocol adapter → chain adapter → RPC | **MET** — `lending-service.js` is the new layer; the page no longer talks to RPC directly |
| Only networks with a real implementation are offered | **MET** — unwired chains are non-selectable coming-soon chips |
| BigInt token math, decimals from the contract | **MET** — with a mismatch surfaced, not silently resolved |
| APY vs APR distinct and timestamped | **MET** — compounded ray→APY, `loan.rateSource` carries the read time |
| Oracle validated; stale/missing stops or warns explicitly | **MET** — client and server both read the protocol oracle |
| Transaction simulation before signing; revert = hard stop | **MET** — Confirm disabled on `revert-detected` |
| Real gas estimates, FBT fees separate and not invented | **MET** — native-token authoritative, USD labelled as an estimate; FBT fee stated as none |
| Live positions with refresh on connect / chain-switch / action / resume | **MET** |
| No stale cache; force refresh after a transaction | **MET** — a cached failure is never served as data |
| Real transaction history with statuses | **MET** — no hash is ever fabricated |
| Granular error mapping | **MET** — 81 codes across 12 locales |
| Build + static validation | **MET** |
| Live read-only validation | **NOT MET — UNVERIFIED**, network blocked (§9.1) |
| No "guaranteed safe / profit" language (§41) | **MET** — simulation states "would not revert at the current block… not a guarantee"; the risk panel states prices and rates move continuously |
| i18n complete | **MET** — 339 `loan.*` keys, exact parity across all 12 locales |
