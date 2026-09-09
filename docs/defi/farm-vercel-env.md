# Farm canary — Vercel Environment Variables (all five protocols)

_This is the operator checklist for enabling the staged Farm canary in Vercel.
It covers **Aave v3 Base (native USDC)**, **Aave v3 Arbitrum (native USDC)**,
**Compound v3 Base (native USDC)**, **Lido Ethereum (stETH/wstETH)** and
**Morpho Blue Base (USDC/cbBTC)** in a single build. Every protocol has a strict-fork
PASS recorded under `farm-fork-evidence/`._

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
| `FARM_ROLLOUT_PROTOCOLS` | `aave-base,aave-arbitrum,compound-base,lido,morpho-base` |
| `FARM_STRICT_FORK_EVIDENCE` | `true` |

`vite.config.js` runs `assertFarmRollout(process.env)`. Without these the build
**fails closed** (or stays `capital-off` and shows no Farm UI).

---

## Aave v3 Base — native USDC

| Name | Value |
|---|---|
| `VITE_ENABLE_AAVE_BASE_SUPPLY` | `true` |
| `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX` | `1000` |
| `VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL` | `10000` |

## Aave v3 Arbitrum — native USDC

| Name | Value |
|---|---|
| `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `true` |
| `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX` | `1000` |
| `VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL` | `10000` |

## Compound v3 Base — native USDC

| Name | Value |
|---|---|
| `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `true` |
| `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX` | `1000` |
| `VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL` | `10000` |

## Lido Ethereum — stETH/wstETH

| Name | Value |
|---|---|
| `VITE_ENABLE_LIDO_STAKE` | `true` |
| `VITE_LIDO_STAKE_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_LIDO_STAKE_MAX_ETH_PER_TX` | `1` |
| `VITE_LIDO_STAKE_MAX_ETH_TOTAL` | `10` |

## Morpho Blue Base — USDC/cbBTC

| Name | Value |
|---|---|
| `VITE_ENABLE_MORPHO_BASE_SUPPLY` | `true` |
| `VITE_MORPHO_BASE_SUPPLY_ALLOWLIST` | `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |
| `VITE_MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX` | `1000` |
| `VITE_MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL` | `10000` |

---

## Where to put them in Vercel

- **Settings → Environment Variables → add** each pair above.
- **Scope:** set them for **Production**. If you also test `Preview`/`Development`,
  add them there too (otherwise the preview build stays `capital-off`).
- **Save**, then **Deployments → ⋯ → Redeploy** so the build picks them up.

## Public-open (post-canary) — OPTIONAL, OFF by default

The values above open the money-in UI **only to the allowlist wallet**. After a
protocol's canary has succeeded on-chain, you may widen it to ANY connected wallet
by adding that protocol's public flag **plus** `FARM_CANARY_CONFIRMED=true`.

| Name | Value (only for the public-open transition) |
|---|---|
| `FARM_CANARY_CONFIRMED` | `true` |
| `VITE_AAVE_BASE_SUPPLY_PUBLIC` | `true` |
| `VITE_AAVE_ARB_SUPPLY_PUBLIC` | `true` |
| `VITE_COMPOUND_BASE_SUPPLY_PUBLIC` | `true` |
| `VITE_LIDO_STAKE_PUBLIC` | `true` |
| `VITE_MORPHO_BASE_SUPPLY_PUBLIC` | `true` |

**Rules that never change:**

- A public flag **without** `FARM_CANARY_CONFIRMED=true` fails the build **closed**.
- The allowlist stays non-empty (the fee-recipient wallet above) even in public mode,
  so the gate never fails open.
- Public mode opens **SUPPLY/STAKE** to everyone, still capped (1000/10000 USDC and
  1 ETH/tx / 10 ETH total for Lido). **WITHDRAW/UNWRAP/REQUESTWITHDRAW/CLAIM** stay
  gated by `hasPosition` only, never by the flag/allowlist/caps/public override.
- **Do not set these until the canary has been confirmed.** Until then, leave them
  unset so the deployment stays `limited-canary`.

## Verified gate behaviour

Running `assertFarmRollout` with the above env returns:

```
ok: true          mode: limited-canary
enabled: [aave-base, compound-base, aave-arbitrum, lido, morpho-base]
  aave-base      -> allowlist 1 | caps 1000/10000
  compound-base  -> allowlist 1 | caps 1000/10000
  aave-arbitrum  -> allowlist 1 | caps 1000/10000
  lido           -> allowlist 1 | caps 1/10
  morpho-base    -> allowlist 1 | caps 1000/10000
errors: []
```

## Allowlist semantics

The single fee-recipient `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` is the only
wallet that sees the money-in UI. Any other connected wallet sees the position but
the supply/stake path stays closed (withdraw/exit/revoke is gated only by
`hasPosition`, never by allowlist/caps/flag). To add more operator wallets, join with
commas: `0xabc...,0xdef...`.

When you later widen to every wallet (public-open above), the allowlist still has to
be present and non-empty; it is no longer the only wallet allowed in, but it stays on
record as the canary wallet so the gate never fails open.

## Evidence-backed

Every protocol listed above has a strict-fork PASS under `farm-fork-evidence/`:
Aave Base 36/36, Aave Arbitrum 37/37, Compound Base 46/46, Lido 31/31, Morpho 34/34.
No path is enabled without its anchor, and the gate never fails open.
