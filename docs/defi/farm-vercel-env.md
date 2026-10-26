# Farm canary & rollout — Vercel Environment Variables

_Operator reference for configuring staged Farm canary or public-open builds in Vercel (`2026-10-26`). Aligned 1:1 with `scripts/farm-rollout-policy.mjs` (uncapped contract — artificial `VITE_*_MAX_*` env vars were removed after fork verification; only protocol on-chain supply caps and wallet balances apply)._

## ✅ Shared rollout config vs Stage-1 Aave Base limited canary

- **Full 5-protocol build (`ci/farm-rollout.env.sh`):** Sourced by `npm run build:full` (`vercel.json` → `buildCommand`) and `ci/build-both.sh`. Uses `${VAR:-default}` parameter expansion so any variable explicitly set in Vercel Dashboard overrides the file default.
- **Stage-1 Aave-Base-only limited canary (`ci/farm-aave-base-canary.env.example`):** Ready-to-use sample configuration that enables **only `aave-base`** in `limited-canary` mode (`FARM_CANARY_CONFIRMED=false`, `VITE_AAVE_BASE_SUPPLY_PUBLIC=false`, all other four protocols `false`, SplitRouter `OFF`) so only "owner permission + canary wallet" are needed before running a live 5 USDC round-trip canary.
- **Preflight check (zero spend, zero keys):**
  ```bash
  CANARY_WALLET=0xYourPublicCanaryWallet npm run check:aave-base-canary
  ```

| Operational goal in Vercel | Variables to set in Vercel Dashboard |
|---|---|
| **Kill switch — close all Farm money-in immediately** | `FARM_CAPITAL=off` |
| **Stage-1 limited canary (Aave Base only, 1 wallet)** | Copy values from `ci/farm-aave-base-canary.env.example` with owner's `0x…` canary wallet in `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` |
| **Drop all 5 protocols back to allowlist-only canary** | `FARM_CANARY_CONFIRMED=false` and all five `VITE_*_PUBLIC=false` |

Anything half-set fails the build closed (`scripts/farm-rollout-policy.mjs`, re-asserted by `vite.config.js`), so an override typo produces a red deploy, never a half-open Farm.

---

## ⚠️ Two rules that govern every value

1. **Zero private keys / secrets.** Farm supply/stake reads from public contracts + RPC and signs strictly inside the user's connected wallet UI. **Never** put a private key, seed phrase, mnemonic, or writable token in Vercel, CI, or `.env` (`npm run check:aave-base-canary` fails closed if any secret-shaped variable is present).
2. Every `VITE_*` variable is compiled into the browser bundle at build time (public booleans and public `0x…` allowlist addresses only).

---

## Stage-1 Aave Base Limited Canary Override (Recommended First Live Step)

| Name | Value |
|---|---|
| `FARM_ROLLOUT_PROTOCOLS` | `aave-base` |
| `FARM_STRICT_FORK_EVIDENCE` | `true` |
| `FARM_CANARY_CONFIRMED` | `false` |
| `VITE_ENABLE_AAVE_BASE_SUPPLY` | `true` |
| `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | `0xREPLACE_WITH_OWNER_PUBLIC_CANARY_WALLET` |
| `VITE_AAVE_BASE_SUPPLY_PUBLIC` | `false` |
| `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `false` |
| `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `false` |
| `VITE_ENABLE_LIDO_STAKE` | `false` |
| `VITE_ENABLE_MORPHO_BASE_SUPPLY` | `false` |

Gate output for this profile:
```text
Farm rollout gate passed: limited canary for aave-base (1 canary wallet, uncapped).
```

---

## All Five Protocol Variables Reference

| Protocol (`id`) | Enable Flag | Allowlist Variable (public `0x…`, comma-separated) | Public Override Flag (requires `FARM_CANARY_CONFIRMED=true`) |
|---|---|---|---|
| Aave v3 Base (`aave-base`) | `VITE_ENABLE_AAVE_BASE_SUPPLY` | `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | `VITE_AAVE_BASE_SUPPLY_PUBLIC` |
| Compound v3 Base (`compound-base`) | `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` | `VITE_COMPOUND_BASE_SUPPLY_PUBLIC` |
| Aave v3 Arbitrum (`aave-arbitrum`) | `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | `VITE_AAVE_ARB_SUPPLY_PUBLIC` |
| Lido Ethereum (`lido`) | `VITE_ENABLE_LIDO_STAKE` | `VITE_LIDO_STAKE_ALLOWLIST` | `VITE_LIDO_STAKE_PUBLIC` |
| Morpho Blue Base (`morpho-base`) | `VITE_ENABLE_MORPHO_BASE_SUPPLY` | `VITE_MORPHO_BASE_SUPPLY_ALLOWLIST` | `VITE_MORPHO_BASE_SUPPLY_PUBLIC` |

### Exit & Withdrawal Invariant
**WITHDRAW / UNWRAP / REQUESTWITHDRAW / CLAIM / REVOKE** are gated **only** by `hasPosition` on-chain — never by `VITE_ENABLE_*`, allowlists, or `*_PUBLIC` flags. Turning `FARM_CAPITAL=off` closes new deposits immediately while keeping every existing position 100% withdrawable.
