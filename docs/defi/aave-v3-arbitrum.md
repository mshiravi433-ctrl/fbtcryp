# Aave v3 · Arbitrum One · USDC — in-app supply adapter

The app's third DeFi **execution** adapter: supply native USDC into the Aave v3
pool on Arbitrum One (chainId 42161), withdraw it, and show the live position —
from inside the app, signed by the user's own wallet.

Same Pool interface as the Base adapter (`docs/defi/aave-v3-base.md`), different
deployment, different USDC, different aToken — and its OWN flag, so one chain
can be switched off without touching the other.

This document is the operating manual. Read it before touching the flag.

| | |
|---|---|
| Adapter | `src/lib/defi/aaveV3Arbitrum.js` (pure, no React) |
| Feature flag | `src/lib/features.js` (`AAVE_ARB_SUPPLY_*`) |
| Local ledger | `src/lib/defi/aaveV3ArbHistory.js` |
| UI | `src/components/Farm/AaveArbUsdcPanel.jsx`, mounted from `src/pages/Farm.jsx` |
| Unit tests | `test/farm-aave-arb-panel.test.jsx` (vitest, mocked provider, 8 tests) |
| Wiring pins | `test/wiring.mjs`, section 115 |
| Fork probe | `test/aave-arbitrum-fork-probe.mjs` → `npm run test:aave-arbitrum-fork` |
| Manual-run workflow | `ci/aave-arbitrum-fork-probe.yml` → hand-placed at `.github/workflows/` |

Shared semantics (the `getReserveData` struct layouts, the two revert eras,
exact-amount approvals, the open exit) are documented once, in
`docs/defi/aave-v3-base.md`, and are NOT repeated here. This file documents
only what is different on Arbitrum.

---

## 1. Addresses and where they came from

Every Aave address is pinned in `src/lib/defi/aaveV3Arbitrum.js` and **nowhere
else** in `src/` (the Pool proxy excepted — see below). A wiring pin greps the
whole tree to prove it.

| Contract | Address | Source |
|---|---|---|
| Pool (proxy) | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | Aave Address Book, `src/AaveV3Arbitrum.sol` → `POOL` |
| PoolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | Aave Address Book → `POOL_ADDRESSES_PROVIDER` |
| aToken, native-USDC reserve | `0x724dc807b04555b71ed48a6896b6F41593b8C637` | Aave Address Book, `ASSETS.USDCn` → `A_TOKEN` |

Source of record: <https://github.com/bgd-labs/aave-address-book>, file
`src/AaveV3Arbitrum.sol`. Pins were read from the published
`@bgd-labs/aave-address-book` npm package (v4.44.22) and cross-checked against
this repo's own tables (below) — not typed from memory.

**USDC is not in that list of pins.** It is read from the existing token table in
`src/lib/chains.js` (`TOKENS[42161]`, decimals 6) via `getToken(42161, 'USDC')`,
so the repo keeps exactly one USDC address per chain.

### The USDCn trap

Arbitrum has TWO USDCs and Aave lists BOTH as separate reserves:

| Reserve | Underlying | aToken | In this adapter? |
|---|---|---|---|
| `USDC` (bridged USDC.e) | `0xFF97…` | `0x625E…` | **NO — must never be pinned here** |
| `USDCn` (Circle-native USDC) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x724dc807b04555b71ed48a6896b6F41593b8C637` | **YES** |

The adapter pins the NATIVE one because that is what this app's token table
calls `'USDC'` on Arbitrum — the token the user buys on the swap screen before
coming here. The full bridged addresses appear nowhere in the adapter file, not
even in a comment (a wiring pin enforces this): a documented address gets
copy-pasted into code.

### Runtime verification

Pinned constants are never trusted alone. Before any write:

1. `PoolAddressesProvider.getPool()` must equal the pinned Pool.
2. The native-USDC reserve's aToken must equal the pinned aToken.

The fork probe additionally asserts the pinned underlying is `0xaf88…`
(native), so a USDC.e mix-up fails the suite rather than shipping.

**The Pool address existed before this feature.** `src/lib/lending.js` carries
`AAVE_V3_POOLS[42161]` (the canonical v3 Pool — the same address also serves
Optimism and Polygon in that table). Rather than leave two copies that could
drift, the adapter imports that table and **throws at module load**
(`AAVE_ADAPTER_POOL_TABLE_DISAGREEMENT`) if they ever disagree.

---

## 2. Flag, caps, allowlist

| Env var | Default | Meaning |
|---|---|---|
| `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | off (`=== 'true'`) | exposes in-app Arbitrum supply |
| `VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX` | 100 | per-transaction ceiling, enforced in the adapter |
| `VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL` | 500 | position ceiling (existing + new), enforced in the adapter |
| `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | empty (supply closed) | required non-empty canary gate |

Build defines in `vite.config.js`: `__AAVE_ARB_SUPPLY_ENABLED__` (inverted
test — a forgotten env var fails CLOSED) and `__AAVE_ARB_BUILD_ENV__` (cap
table, consulted by `buildOrEnv` in `src/lib/features.js`).

The kill switch never gates the EXIT: `aaveArbWithdrawAllowedFor` depends only
on `{ owner, hasPosition }`.

---

## 3. Rollout checklist (do NOT enable without these)

1. **Independent review** of `src/lib/defi/aaveV3Arbitrum.js` — especially the
   three pins in §1 and the USDCn/USDC.e distinction.
2. **A passing Arbitrum-mainnet fork probe** (`npm run test:aave-arbitrum-fork`
   with `--strict`, or the manual-run workflow): all rules green on forked
   Arbitrum One state. Arbitrum Sepolia is NOT an acceptable substitute — it
   carries a different deployment.
3. **Wiring green**: `test/wiring.mjs` section 115, plus the panel suite
   (`npx vitest run test/farm-aave-arb-panel.test.jsx`).

Enabling is one line in `package.json` (`build:full`, website only — the store
chain `android:sync → build` stays flag-free, same as the Base and Compound
adapters):

```
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=true
```
