# Farm canary — Vercel Environment Variables (all four protocols)

_This is the operator checklist for enabling the staged Farm canary in Vercel.
It covers **Aave v3 Base (native USDC)**, **Aave v3 Arbitrum (native USDC)**,
**Compound v3 Base (native USDC)** and **Lido Ethereum (stETH/wstETH)** in a single
build. **Morpho stays OFF** until it records a strict-fork PASS._

## ⚠️ Two rules that govern every value

1. **No private key / secret for Farm.** Farm supply/stake is read from public
   contracts + RPC. None of the variables below are secrets. **Never** prefix a
   private key, mnemonic, or writable token with `VITE_` — that compiles into the
   browser bundle and is public.
2. Every `VITE_*` below is compiled into the app at build time (public). That is
   fine here because they are addresses / booleans / caps, not credentials.

---

## Gate (required) — do NOT omit

| Name | Value |
|---|---|
| `FARM_ROLLOUT_PROTOCOLS` | `aave-base,aave-arbitrum,compound-base,lido` |
| `FARM_STRICT_FORK_EVIDENCE` | `true` |

`vite.config.js` runs `assertFarmRollout(process.env)`. Without these the build
**fails closed** (or stays `capital-off` and shows no Farm UI).

---

## Aave v3 Base — native USDC

| Name | Value |
|---|---|
| `VITE_ENABLE_AAVE_BASE_SUPPLY` | `true` |
| `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX` | `100` |
| `VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL` | `500` |

## Aave v3 Arbitrum — native USDC

| Name | Value |
|---|---|
| `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `true` |
| `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX` | `100` |
| `VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL` | `500` |

## Compound v3 Base — native USDC

| Name | Value |
|---|---|
| `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `true` |
| `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX` | `100` |
| `VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL` | `500` |

## Lido Ethereum — stETH/wstETH

| Name | Value |
|---|---|
| `VITE_ENABLE_LIDO_STAKE` | `true` |
| `VITE_LIDO_STAKE_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_LIDO_STAKE_MAX_ETH_PER_TX` | `1` |
| `VITE_LIDO_STAKE_MAX_ETH_TOTAL` | `10` |

---

## Where to put them in Vercel

- **Settings → Environment Variables → add** each pair above.
- **Scope:** set them for **Production**. If you also test `Preview`/`Development`,
  add them there too (otherwise the preview build stays `capital-off`).
- **Save**, then **Deployments → ⋯ → Redeploy** so the build picks them up.

## Verified gate behaviour

Running `assertFarmRollout` with the above env returns:

```
ok: true          mode: limited-canary
enabled: [aave-base, compound-base, aave-arbitrum, lido]
  aave-base      -> allowlist 1 | caps 100/500
  compound-base  -> allowlist 1 | caps 100/500
  aave-arbitrum  -> allowlist 1 | caps 100/500
  lido           -> allowlist 1 | caps 1/10
errors: []
```

## Allowlist semantics

The single fee-recipient `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` is the only
wallet that sees the money-in UI. Any other connected wallet sees the position but
the supply/stake path stays closed (withdraw/exit/revoke is gated only by
`hasPosition`, never by allowlist/caps/flag). To add more operator wallets, join with
commas: `0xabc...,0xdef...`.

## Morpho — stays OFF

`VITE_ENABLE_MORPHO_BASE_SUPPLY` must **not** be `true` until a strict-fork PASS is
recorded under `farm-fork-evidence/`. Do **not** add it to `FARM_ROLLOUT_PROTOCOLS`.
