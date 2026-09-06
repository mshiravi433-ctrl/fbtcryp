# Aave v3 · Base · USDC — in-app supply adapter

The app's first DeFi **execution** adapter: supply USDC into the Aave v3 pool on
Base (chainId 8453), withdraw it, and show the live position — from inside the
app, signed by the user's own wallet.

This document is the operating manual. Read it before touching the flag.

| | |
|---|---|
| Adapter | `src/lib/defi/aaveV3Base.js` (pure, no React) |
| Feature flag | `src/lib/features.js` |
| Local ledger | `src/lib/defi/aaveV3History.js` |
| UI | `src/components/Farm/AaveBaseUsdcPanel.jsx`, mounted from `src/pages/Farm.jsx` |
| Unit tests | `test/farm-defi.test.js` (vitest, mocked provider) |
| Wiring pins | `test/wiring.mjs`, section 87 |
| Fork probe | `test/aave-base-fork-probe.mjs` → `npm run test:aave-base-fork` |

---

## 1. Addresses and where they came from

Every Aave address is pinned in `src/lib/defi/aaveV3Base.js` and **nowhere else**
in `src/`. A wiring pin greps the whole tree to prove it.

| Contract | Address | Source |
|---|---|---|
| Pool (proxy) | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | Aave Address Book, `src/AaveV3Base.sol` → `POOL` |
| PoolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` | Aave Address Book → `POOL_ADDRESSES_PROVIDER` |
| aBasUSDC (aToken) | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` | Aave Address Book, `AaveV3BaseAssets` → `USDC_A_TOKEN` |
| AaveProtocolDataProvider *(not used, listed for review)* | `0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A` | Aave Address Book |

Source of record: <https://github.com/bgd-labs/aave-address-book>, file
`src/AaveV3Base.sol`, rendered at <https://aave.com/docs/resources/addresses>.
That repository is governance-maintained by BGD Labs and is the canonical
machine-readable list of Aave deployments.

**USDC is not in that list of pins.** It is read from the existing token table in
`src/lib/chains.js` (`TOKENS[8453]`, decimals 6) via `getToken(8453, 'USDC')`, so
the repo keeps exactly one USDC address. The address book's `USDC_UNDERLYING`
for Base is that same address; `verifyDeployment` re-asserts the link at runtime
by comparing the reserve's aToken to the pin.

**The Pool address existed before this feature.** `src/lib/lending.js` has
carried `AAVE_V3_POOLS[8453]` since the read-only lending-rate work. Rather than
leave two copies that could drift, the adapter imports that table and **throws at
module load** (`AAVE_ADAPTER_POOL_TABLE_DISAGREEMENT`) if they ever disagree. The
wiring pin asserts both that the two files are the only ones holding the Pool
address and that the assertion exists.

### Runtime verification

Pinned constants are never trusted alone. Before any write:

1. `PoolAddressesProvider.getPool()` must equal the pinned Pool.
2. The USDC reserve's aToken must equal the pinned aBasUSDC.

Check 2 normally reads `Pool.getReserveData(USDC)`. That call returns the whole
`DataTypes.ReserveData` struct, and **Aave changed that struct between releases**.
The change is NOT what an early draft of the adapter assumed: v3.3.0 did not
drop the stable-rate fields (v3.2.0 deprecated them and v3.3.0 repurposed one
slot for `deficit`, but both slots are still in the struct). What moved
`aTokenAddress` was the v3.1.0 release of the `aave-v3-origin` codebase
(`liquidationGracePeriodUntil` inserted after `id`, `virtualUnderlyingBalance`
appended), and the governance upgrades have been running that codebase since.
The real lineage, verified against the released source (2026-09-06):

- **v3.0.x (`aave-v3-core`, master/v1.19.x)** — 15 words, aToken at word 8:
  the layout of the original 2023 deployments.
- **v3.1+ (`aave-v3-origin`, tags v3.1.0 … v3.7.0)** — 17 words, aToken at
  word 9, timestamp at 6, reserve id at 7 (identical in every tag; only the
  tail words differ).

Declaring one shape and hoping is how an integration starts reading a debt
token as an aToken, so both real layouts are declared explicitly
(`RESERVE_DATA_SHAPES`) and each decode is validated against facts the wrong
layout cannot satisfy — a 13-word "v3.3+" layout with the aToken at word 7
appeared in an early version of this table, matches **no** released pool, and
is pinned as rejected in `test/farm-defi.test.js`. Each decoded candidate must
pass:

- word 0's decimals field must be 6 (ReserveConfiguration bits 48–55)
- the timestamp word must be a real block timestamp (> 2017, fits uint40)
- the reserve id must be < 128 (Aave's `MAX_RESERVES_COUNT`)
- the liquidity index must be ≥ 1e27
- the aToken must look like a 160-bit address, not a small integer

If no layout validates, verification falls back to the aToken describing itself
(`aBasUSDC.POOL()` + `UNDERLYING_ASSET_ADDRESS()`), which involves no struct at
all. The returned evidence records **which** path passed
(`verifiedVia: 'pool.getReserveData' | 'atoken.self-report'`) so a reviewer can
see that the primary check did not run. A mismatch throws; nothing is cached
except a success, keyed by provider instance in a `WeakMap`.

### Protocol shapes relied on

Verified against `aave-v3-core` source, not memory:

- `Pool.supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `Pool.withdraw(address asset, uint256 amount, address to)`
- `Pool.getConfiguration(address) → uint256`; bitmap positions taken from
  `contracts/protocol/libraries/configuration/ReserveConfiguration.sol`
  (active = bit 56, frozen = 57, paused = 60, supply cap = bits 116–151).
- Reverts, in BOTH eras: instances on v3.0.x–v3.3 revert with the numeric
  `Error(string)` codes from `contracts/protocol/libraries/helpers/Errors.sol`
  (26 invalid amount, 27 inactive, 28 frozen, 29 paused, 32 not enough balance,
  35/45 health factor, 51 supply cap exceeded, 59 oracle sentinel, 77 zero
  address, 82 not listed); instances on v3.4+ (aave-v3-origin v3.4.0…v3.7.0)
  revert with the same-named no-argument custom errors (`InvalidAmount()`,
  `NotEnoughAvailableUserBalance()`, …), whose 4-byte selectors
  `explainRevert` maps to the same i18n keys (`AAVE_V3_CUSTOM_ERRORS`,
  selector-verified in `test/farm-defi.test.js`). The fork probe exercises
  both paths against real reverts: a zero-amount supply must map to the
  invalid-amount key and an over-withdraw to the not-enough-balance key,
  whichever era the forked pool runs.

---

## 2. Enabling the flag, and the caps

Everything is in `src/lib/features.js`. **All four default to the safe value.**

| Export | Default | Env var |
|---|---|---|
| `AAVE_BASE_SUPPLY_ENABLED` | `false` | `VITE_ENABLE_AAVE_BASE_SUPPLY=true` |
| `AAVE_BASE_SUPPLY_MAX_USDC_PER_TX` | `100` | `VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX` |
| `AAVE_BASE_SUPPLY_MAX_USDC_TOTAL` | `500` | `VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL` |
| `AAVE_BASE_SUPPLY_ALLOWLIST` | `[]` (empty = no restriction beyond the flag) | `VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xabc…,0xdef…` |

```bash
# allowlist of two wallets, shipped caps
VITE_ENABLE_AAVE_BASE_SUPPLY=true \
VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xaaa…,0xbbb… \
npm run build
```

Note the flag is `=== 'true'`, **not** `!== 'false'` like
`SPECULATION_ENABLED`. That inversion is deliberate: a build that forgets the env
var must ship with the money path **closed**. `vite.config.js` pins
`__AAVE_BASE_SUPPLY_ENABLED__` the same way. In an app build that define always
wins (it is unconditionally defined from `process.env`), so the env var is read
when Vite loads the config; the `import.meta.env` fallback in `features.js` is
what the fork-probe shim build uses, where the define is hardcoded `false`.

A cap value that does not parse falls back to the default — it never becomes `0`
(which would look like a bug) or `Infinity` (which would remove the limit), and
it is clamped to a ceiling so a typo cannot type `1e18` into a cap.

Caps are enforced **in the adapter**, in `buildSupplyPlan`, not only in the UI:
`checks.perTxCapOk` and `checks.totalCapOk` (the latter counts
`getPosition().suppliedUsdc + amount`). A blocked plan returns `steps: []`, so
there is no plan to sign.

### The kill switch

Set the flag off and rebuild. Supply disappears everywhere for everyone.

A wallet sitting on a *different* network cannot have its position read at all —
no Base provider is available — so the panel uses the local ledger: if this owner
has confirmed supply records, the card still renders with a "switch to Base"
prompt instead of vanishing. It reads no chain state to decide that, and it never
renders for someone with no Aave history, so browsing the Base pool from Ethereum
does not grow an Aave card.

**Position and withdraw do not disappear.** `aaveBaseWithdrawAllowedFor({ owner,
hasPosition })` looks only at whether the wallet has an aToken balance. It never
reads the flag, the caps or the allowlist, and a wiring pin asserts that. Gating
the exit would turn a safety feature into a trap on someone's funds. With the
flag off *and* no position, the panel renders nothing at all.

### Partial state (approve confirmed, supply did not)

Approve and supply are two transactions. If the first lands and the second is
rejected or reverts, the user holds a standing allowance with nothing supplied.
`derivePartialApprovalState()` combines the local ledger with the **on-chain
allowance** — the chain wins — and the panel reopens in a "continue or revoke"
state. This survives a reload because the ledger is in `localStorage`
(`fbt-aave-base-history-v1`) and the allowance is read from the chain. Revoke is
`approve(pool, 0)`.

The ledger is capped, newest-first, and written through an explicit field
whitelist. It stores public on-chain facts only: hash, amount, block, timestamp,
owner. **Never** a key, mnemonic or signature — a wiring pin parses the whitelist
and asserts none of those field names can be persisted.

---

## 3. Rollout checklist

1. **Flag off in all store builds.** Do not trust the env var being unset —
   prove the built artifact changed because of it. Build twice and compare the
   Farm chunk. Run during development, actual output:
   `off → Farm-DTQ2uKx4.js sha=bd99f3b49f718e86 (65050 bytes)`,
   `on → Farm-C3Uthd6d.js sha=9c3d13a4a77e2269 (65051 bytes)` — different, by the
   single byte of the folded `!1`/`!0`, and the off build was rebuilt afterwards
   and matched its own hash again:
   ```bash
   npm run build                                   # flag off
   sha256sum dist/assets/Farm-*.js                 # record this
   VITE_ENABLE_AAVE_BASE_SUPPLY=true npm run build # flag on
   sha256sum dist/assets/Farm-*.js                 # must differ
   npm run build                                   # rebuild the one you ship
   ```
   Note that `grep VITE_ENABLE_AAVE_BASE_SUPPLY dist/assets/*.js` returns
   **nothing in either build**, and that is expected: `vite.config.js` resolves
   the variable while loading the config and defines
   `__AAVE_BASE_SUPPLY_ENABLED__` as the literal `true`/`false`, so the
   `import.meta.env` fallback branch in `features.js` is dead code and gets
   eliminated. A grep for the env-var name proves nothing here — only the
   chunk-hash difference does.
2. **Independent review of `aaveV3Base.js`** by someone who did not write it.
   Reviewer signs off in the PR. Focus: the address pins, the approve amount,
   `onBehalfOf`, and the withdraw recipient.
3. **Fork probe passes**, with output attached to the PR:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash && foundryup
   BASE_RPC_URL=https://mainnet.base.org npm run test:aave-base-fork -- --strict
   ```
4. **Testnet is not sufficient on its own.** Base Sepolia carries a different
   Aave deployment — different Pool, different aToken, different caps. A green
   Sepolia run proves the code talks to *an* Aave, not to the one this adapter
   pins. The mainnet fork probe is the acceptance test.
5. **Enable for the allowlist only, caps 100/500.** Watch for 2–4 weeks:
   - any stuck partial state (approve without supply);
   - any revert not mapped to a readable message — check `explainRevert` output
     in the UI and add the code to `AAVE_V3_ERROR_KEYS` if it is missing;
   - any position mismatch against Aave's own UI.
6. **Only then** discuss raising the caps or adding a second asset.

---

## 4. What was deliberately not built

| Not built | Why |
|---|---|
| `borrow`, `repay` | Borrowing introduces liquidation risk, an oracle dependency and a health factor that can move against the user while the app is closed. Separate feature, separate review. |
| `setUserUseReserveAsCollateral`, eMode | Collateral toggles change liquidation exposure silently. |
| Flash loans | No user-facing purpose here, and the largest blast radius in the protocol. |
| Other assets (WETH, cbBTC, cbETH, DAI…) | Each has its own decimals, caps, freeze history and price behaviour. |
| Other chains | The pins, the fork probe and the reserve config are all chain-specific. |
| Unbounded ("infinite") approvals | A standing infinite allowance on the Pool would let a compromised Pool move the rest of the wallet's USDC later. Approvals are for exactly the amount, or zero on revoke. |
| Any server component | The ledger is local. Nothing about this feature is uploaded, and no server holds state that could be wrong. |
| A fee on supply/withdraw | None is charged, and the UI says so. If one is ever added it must be stated in the same copy. |
| An `onBehalfOf` or recipient parameter | Both are always the connected owner. There is no input anywhere that lets them differ. |
| The Aave SDK | Plain ABI calls suffice; the SDK would add a second provider abstraction beside the one the app already has. |
| A new page | The entry point attaches to the existing Farm pool detail for this one pool. The existing "buy the token on the protocol site" guidance stays for every other pool and for this one too. |

---

## 5. Known limitations, stated plainly

- **`accruedSinceUsdc` is best-effort and local.** It is
  `currentSupplied − net principal from local records`. It is **not** derived
  from the APY, and it returns `null` (rendered as "—") whenever the records
  cannot fully account for the position — a position opened on another device,
  cleared storage, or records claiming more than the chain shows.
- **`currentLiquidityRate` is read as the supply APY.** That is what Aave's own
  UI labels "Deposit APY" (`DataTypes.sol`: "the current supply rate. Expressed
  in ray"). It is variable.
- **`suppliedUsd`** uses `AaveOracle.getAssetPrice` (8-dp USD), resolved at
  runtime via `PoolAddressesProvider.getPriceOracle()` — no oracle address is
  pinned. If the read fails the value is `null`, not `0`.
- **The reserve-status read fails closed.** If `getReserveData` cannot be decoded
  the adapter throws `AAVE_RESERVE_DATA_UNDECODABLE` rather than guessing a rate
  or a cap, and `buildSupplyPlan` reports `AAVE_RESERVE_UNREADABLE` and returns
  no steps.
