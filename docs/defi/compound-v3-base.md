# Compound V3 (Comet) · Base · USDC — in-app supply adapter

The second place in this app where a user's money leaves their wallet and
enters a third-party smart contract. The first is Aave v3
([`aave-v3-base.md`](./aave-v3-base.md)); this document only explains what is
**different**, and every difference below exists because Compound III is not
Aave with different addresses.

| | |
|---|---|
| Module | `src/lib/defi/compoundV3Base.js` (no React, never signs) |
| Ledger | `src/lib/defi/compoundV3History.js` — `localStorage`, own key |
| UI | `src/components/Farm/CompoundBaseUsdcPanel.jsx`, mounted in `src/pages/Farm.jsx` |
| Flag | `COMPOUND_BASE_SUPPLY_ENABLED` — **off in every build** |
| Caps | 100 USDC per transaction, 500 USDC total position |
| Actions | `supply` and `withdraw`. Nothing else. |
| Unit tests | `test/compound-defi.test.js` (69), `test/farm-compound-panel.test.jsx` (9) |
| Wiring pins | `test/wiring.mjs` section 114 (44 assertions) |
| Acceptance | `npm run test:compound-base-fork` (Base mainnet fork) |

---

## 1. Addresses and where they came from

Pinned in **exactly one module**, `src/lib/defi/compoundV3Base.js`, and nowhere
else in the repository (`test/wiring.mjs` fails the build if any of them appears
in a second file).

| Contract | Address |
|---|---|
| Comet (cUSDCv3) | `0xb125E6687d4313864e53df431d5425969c15Eb2F` |
| Configurator | `0x45939657d1CA34A8FA39A924B71D28Fe8431e581` |
| CometRewards | `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1` |

Source: [`compound-finance/comet`](https://github.com/compound-finance/comet),
`deployments/base/usdc/roots.json` — the deployment file Compound governance
itself maintains and deploys from. This is the Compound equivalent of the
`bgd-labs/aave-address-book` repository the Aave adapter cites: a
governance-maintained artifact, not a blog post, a block explorer page or a
docs table.

**USDC is not in that list on purpose.** It is imported from
`getToken(8453, 'USDC')` in `src/lib/chains.js`, the app's single token
registry, and the module throws `COMPOUND_ADAPTER_MISSING_USDC_ON_BASE` at
import time if it is ever absent. A second hand-typed copy of a token address
is how two files eventually disagree.

### Runtime verification

No write is ever built before `verifyDeployment(provider)` has proved, against
the live chain, that the pinned address is the market we think it is. Comet has
no `PoolAddressesProvider`, so the equivalent evidence is assembled from two
**independent** sources:

1. **The market describes itself.** `baseToken()` must equal the USDC address
   from the token registry, and `decimals()` must be 6. This is the check that
   catches the "the pin points at the WETH market" mistake, and it cannot be
   skipped or downgraded.
2. **Governance's own record.** `Configurator.getConfiguration(comet).baseToken`
   — a *different contract*, writable only by governance — must agree.

If the Configurator read fails (a busy RPC, an upgraded ABI), verification still
succeeds on check 1 alone but records `verifiedVia: 'comet.self-report'` instead
of `'comet.baseToken+configurator'`, so a reviewer can see the cross-check did
not run. A **disagreement** between the two always throws
`COMPOUND_CONFIGURATOR_MISMATCH`.

Successful verifications are cached per provider object in a `WeakMap`;
failures are never cached, so a failed check is retried rather than remembered.

Errors: `COMPOUND_NO_PROVIDER`, `COMPOUND_DEPLOYMENT_UNVERIFIABLE`,
`COMPOUND_BASE_TOKEN_MISMATCH`, `COMPOUND_DECIMALS_MISMATCH`,
`COMPOUND_CONFIGURATOR_MISMATCH`, `COMPOUND_WRONG_CHAIN`.

---

## 2. Five ways Comet is NOT Aave

This section is the reason the adapter is a separate file rather than a
parameter on the Aave one. Each of these would produce a plausible-looking,
wrong result if the Aave logic had been reused.

### 2.1 Rates are per-second, not per-year rays

Aave quotes `currentLiquidityRate` as a **per-year ray** (1e27). Comet's
`getSupplyRate(utilization)` returns a **per-second, 1e18-scaled** rate. Feeding
one into the other's converter is wrong by roughly **1e9** — and the result
still looks like a percentage.

The adapter therefore has its own two functions and reports **both** figures,
labelled separately in the UI:

```
APR (simple)   = rate / 1e18 × 31 536 000 × 100
APY (compound) = expm1(31 536 000 × log1p(rate / 1e18)) × 100
```

The APR line is exactly Compound's own documented formula, so the number on the
card can be compared with Compound's interface line for line. The APY is the
compounded figure, which is what "APY" means on the Aave card next to it.
Showing only one of them would mean either contradicting Compound's own UI or
quoting a return the position does not actually earn. `expm1`/`log1p` are used
because `(1+r)**n` at r ≈ 1e-9 loses most of its precision in floating point.

`test/wiring.mjs` pins that `rayToApyPct` and `RAY` do not appear in this file
at all.

### 2.2 There is no receipt token

Aave mints an aToken; the position is `aUSDC.balanceOf(owner)`. Comet mints
nothing. The position is `Comet.balanceOf(owner)` — the present value of the
base principal projected forward by the supply index. There is no aToken to
read, and the wiring pins assert the word does not appear in the adapter.

### 2.3 The base asset has NO supply cap

Comet enforces supply caps on **collateral** assets only:
`SupplyCapExceeded()` is raised in `supplyCollateral`, and `supplyBase` has no
cap check at all. The Base USDC market's configuration confirms it — caps exist
for cbETH and WETH, both collateral, and none for USDC.

`getMarketStatus` therefore reports `hasSupplyCap: false, supplyCapUsdc: null`
as a **stated protocol fact**, not as a read that failed. Reporting `0n`, or
omitting the field, would both be worse: one invents a limit that does not
exist, the other looks like a gap.

### 2.4 Over-withdrawing does not revert — it opens a LOAN

**This is the one that can cost a user money, and it has no Aave equivalent.**

Aave reverts an over-withdraw (code 32 / `NotEnoughAvailableUserBalance`).
Comet does not. In `withdrawBase`, a collateralised account's base balance is
allowed to go negative; the account simply starts **borrowing** at the borrow
rate, and only then is collateralisation checked. A user pressing "withdraw"
too hard would be handed a debt instead of an error message.

So `buildWithdrawPlan` refuses any explicit amount above the live position with
`COMPOUND_WITHDRAW_EXCEEDS_POSITION`, and the UI directs the user to **Max** for
a full exit. `'max'` encodes as `MaxUint256`, which Comet resolves internally to
exactly `balanceOf(src)` — so the full-exit path can never become a borrow
either. The fork probe asserts both halves: that the adapter refuses it, and
what the chain actually does with the call it refused.

### 2.5 Supplying while in debt REPAYS instead of earning

Comet is one contract for supply and borrow. `supplyBase` nets against a
negative principal (`repayAndSupplyAmount`), so a user with an open borrow who
presses a button labelled "supply to earn" would be **repaying their loan**.
That may even be what they want — but it is not what the button says.

`buildSupplyPlan` blocks it with `COMPOUND_EXISTING_BORROW` and the copy tells
the user to repay from Compound's own interface first. An open borrow is also
surfaced on the position card rather than hidden behind the supply figure.

---

## 3. Approvals, recipients and scope

* **Approvals are for the exact amount, never unbounded.** `approve(comet,
  amountWei)`, and `approve(comet, 0)` to revoke. `MaxUint256` appears in this
  file only in the withdraw builder, where it is Comet's own encoding for
  "everything" — the wiring pins assert positionally that it exists nowhere
  before that function and nowhere in the revoke path.
* **The recipient cannot be wrong, because there is no recipient parameter.**
  The adapter uses `supply(asset, amount)` and `withdraw(asset, amount)`, the
  two-argument forms in which Comet sets both payer and beneficiary to
  `msg.sender`. The variants that *do* take a third party — `supplyTo`,
  `supplyFrom`, `withdrawTo`, `withdrawFrom`, `transferAsset`, `allow` — are
  **absent from the ABI in this file**, so they cannot be encoded at all. The
  fork probe additionally checks the calldata is 2 argument words long.
* **Reads fail closed.** Every read either returns a real value or throws a
  typed `CompoundAdapterError`. A failed balance read blocks the supply
  (`COMPOUND_POSITION_UNREADABLE`) rather than treating "unknown" as "zero".
* **The module never signs.** No `getSigner`, no `sendTransaction`. It returns
  unsigned steps; the panel runs each through `src/lib/preSignSimulation.js` and
  only enables the sign button on `simulated-clean`.

### Deliberately not built

`CometRewards.claim` (see below), `buyCollateral`, `absorb`, collateral supply
or withdrawal, the Bulker, `allow()` delegation, and borrowing. Any of these
would widen the blast radius well beyond "put stablecoins in, take them out".

### Rewards: honest silence

This market's `baseMinForRewards` is **1 000 USDC**, above our 500 USDC total
cap. No position opened through this app can accrue COMP, so no claim path is
built and the card says so plainly instead of showing a reward line that will
always read zero. `getRewardsOwed` exists as a read only — via `eth_call`,
because `getRewardOwed` is non-`view` — and returns `null` on any failure, so a
reconfigured rewards contract can never block a withdrawal.

---

## 4. The flag, the caps and the kill switch

```
VITE_ENABLE_COMPOUND_BASE_SUPPLY=true npm run build
```

| Constant | Default | Env var |
|---|---|---|
| `COMPOUND_BASE_SUPPLY_ENABLED` | `false` | `VITE_ENABLE_COMPOUND_BASE_SUPPLY=true` |
| `COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX` | `100` | `VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX` |
| `COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL` | `500` | `VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL` |
| `COMPOUND_BASE_SUPPLY_ALLOWLIST` | `[]` (everyone) | `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST=0x…,0x…` |

The flag is tested with `=== 'true'`, never `!== 'false'`: a build that forgets
the variable ships with the money path **closed**. Caps are enforced inside the
adapter, not only in the UI, and an unparseable env value falls back to the
default rather than becoming `0` or `Infinity`.

**Compound has its own flag rather than sharing Aave's.** Two protocols, two
blast radii: an incident in one must be switchable off without also taking away
the other, which a shared flag would make impossible exactly when precision
matters. `test/wiring.mjs` asserts the Compound flag block never reads the Aave
flag.

### The kill switch never blocks the exit

`compoundBaseWithdrawAllowedFor({ owner, hasPosition })` reads **only** whether
there is something to withdraw. It does not read the flag, the caps, or the
allowlist — pinned in `test/wiring.mjs`, and asserted in both test suites.
Turning the flag off removes the supply button and leaves the withdraw button.

There is a third case the panel handles: the flag is off, the wallet is on
another network so the position cannot be read, but the local ledger shows this
owner supplied through this app. The card still renders, with a "switch to
Base" prompt. Hiding it would leave someone holding a position with no in-app
route back to it.

### Partial state (approve confirmed, supply did not)

Approve and supply are two transactions. If the first confirms and the second
is rejected, the user holds a standing allowance with nothing supplied. That
state survives a reload: `derivePartialApprovalState` combines the local record
with the **on-chain allowance**, and the chain wins — a stale allowance with no
local record is still surfaced, and an allowance the user revoked elsewhere is
still treated as clean. The sheet then offers "continue" or "revoke".

The ledger uses its own key, `fbt-compound-base-history-v1`, separate from
Aave's. Merging them would corrupt the "accrued since" figure for both, since
that number is `on-chain balance − net local principal`. Fields are written
through an explicit whitelist, so no key, mnemonic or signature can be
persisted even by a careless caller.

---

## 5. Rollout checklist

Do not enable the flag until every line is done.

1. **Independent review** of `src/lib/defi/compoundV3Base.js` by someone who
   did not write it, specifically checking §2.4 (the over-withdraw guard) and
   the approval amounts.
2. **Unit suites green:**
   ```
   npx vitest run test/compound-defi.test.js test/farm-compound-panel.test.jsx
   ```
3. **Wiring pins green** — section 114, 44 assertions:
   ```
   node -e "const m=await import('./test/wiring.mjs'); \
     m.default().filter(([,ok])=>!ok).forEach(f=>console.log(f[0]))"
   ```
   (Two unrelated insurance-routing failures are pre-existing.)
4. **Mainnet-fork acceptance probe**, which is the real gate:
   ```
   curl -L https://foundry.paradigm.xyz | bash && foundryup
   BASE_RPC_URL=<base archive rpc> npm run test:compound-base-fork
   ```
   It must print `n/n passed`. It forks Base mainnet, funds a test account,
   runs the **real** adapter end to end (approve → supply → position →
   over-withdraw refusal → max withdraw), and asserts the shipped caps and the
   APR/APY relationship against live rates. Testnet is not a substitute: Base
   Sepolia is a different deployment with different parameters.
5. **Confirm the flag is genuinely off in the current production bundle**
   before flipping it:
   ```
   grep -c VITE_ENABLE_COMPOUND_BASE_SUPPLY dist/assets/*.js   # expect 0 matches
   ```
   The variable name never survives the build — Vite folds the define into a
   literal — so its absence is expected and is not evidence either way. Check
   behaviour in a preview build instead.
6. **Enable for a small allowlist first** (`VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST`),
   with the caps at their defaults, and watch real positions before widening.

---

## 6. Known limitations, stated plainly

* **`accruedSinceUsdc` is best-effort and device-local.** It is
  `balance − net local principal`, so it is `null` on a new device, after
  clearing storage, or for a position opened elsewhere. It is never estimated
  from the APY, because an estimate presented as earnings is a lie with a
  decimal point.
* **The over-withdraw guard is a software guard.** It relies on the position
  read; if that read fails, the plan is blocked rather than allowed. It cannot
  protect a user who transacts with Comet outside this app.
* **The fork probe has not been run in this environment.** No RPC endpoint and
  no Foundry toolchain are reachable from the sandbox this adapter was written
  in, so the probe is written, wired to `npm run test:compound-base-fork`, and
  self-skips with a copy-pasteable command. **It must be run, and must print
  `n/n passed`, before the flag is enabled.** Everything else in this document
  has been executed and is green.
* **Collateralised accounts are not modelled.** The adapter assumes a
  supply-only position, which is all it can create. It surfaces a borrow if one
  exists and refuses to act, rather than pretending to manage it.
* **The rewards floor is read live**, so if governance ever lowers
  `baseMinForRewards` below our cap, the card stops claiming rewards are out of
  reach — but no claim path appears either, because there still isn't one.
