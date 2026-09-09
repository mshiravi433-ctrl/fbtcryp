# Farm fork-probe evidence records

The staged rollout gate (`scripts/farm-rollout-policy.mjs`, invoked by
`vite.config.js` as `assertFarmRollout`) is fail-closed on a bare
`FARM_STRICT_FORK_EVIDENCE=true`. For an **enabled** protocol the policy keeps that
requirement strict; the evidence record produced below and its committed
`farm-fork-evidence/<protocol-id>.json` anchor make the gate reproducible in a fresh
CI/Vercel checkout and pin the probe-log digest. A canary build for a protocol is
therefore only sound when both:

1. `FARM_STRICT_FORK_EVIDENCE=true` is set, **and**
2. an evidence record with `result: "PASS"` and a full assertion count exists on
   disk next to the build.

This is what stops the gate from being bypassed with an env-var alone.

## Producing the record

Run a protocol's `--strict` fork probe, capture the output, and pipe it into the
recorder, which hashes the raw log and writes the record:

```bash
# Aave v3 · Base · USDC
node test/aave-base-fork-probe.mjs --strict | tee /tmp/aave-base.probe.log
node scripts/record-farm-fork-evidence.mjs aave-base < /tmp/aave-base.probe.log

# Compound V3 · Base · USDC
node test/compound-base-fork-probe.mjs --strict | tee /tmp/compound-base.probe.log
node scripts/record-farm-fork-evidence.mjs compound-base < /tmp/compound-base.probe.log

# Aave v3 · Arbitrum One · USDC
node test/aave-arbitrum-fork-probe.mjs --strict | tee /tmp/aave-arb.probe.log
node scripts/record-farm-fork-evidence.mjs aave-arbitrum < /tmp/aave-arb.probe.log

# Morpho Blue · Base · USDC/cbBTC
node test/morpho-base-fork-probe.mjs --strict | tee /tmp/morpho-base.probe.log
node scripts/record-farm-fork-evidence.mjs morpho < /tmp/morpho-base.probe.log

# Lido · Ethereum · stETH
node test/lido-mainnet-fork-probe.mjs --strict | tee /tmp/lido.probe.log
node scripts/record-farm-fork-evidence.mjs lido < /tmp/lido.probe.log
```

The recorder refuses to write anything that is not a clean `N/N passed` full PASS
(it exits non-zero, so a FAIL cannot be recorded).

## Format

```json
{
  "protocol": "aave-base",
  "result": "PASS",
  "assertionsPassed": 36,
  "totalAssertions": 36,
  "fingerprint": { "algo": "sha256", "digest": "<sha256 of the raw probe log>" },
  "recordedAt": "<ISO timestamp>",
  "note": "Strict mainnet-fork probe output. This is a re-earned per-run record, not a git artifact."
}
```

`farm-fork-evidence/` keeps the *canonical PASS record for a protocol that was
actually rolled out* committed as an auditable anchor (so the fail-closed gate is
reproducible on a fresh CI/Vercel checkout). Transient per-run records for other
protocols are re-earned and not tracked. A reviewer verifies the committed record
against the raw fork-probe log that was posted to the PR.

Currently committed as PASS anchors:
- `aave-base` (36/36, Base 8453 native USDC)
- `aave-arbitrum` (37/37, Arbitrum One 42161 native USDC / USDCn)
- `compound-base` (46/46, Base 8453 USDC, Compound V3 Comet cUSDCv3)

`lido` becomes a committed anchor when its mainnet fork probe passes and
`scripts/record-farm-fork-evidence.mjs lido` writes `farm-fork-evidence/lido.json`.

## Staged canary example — Aave Base + Aave Arbitrum

The canary allowlist is the **fee-recipient wallet** that the project already
collects revenue to (`0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6`, see
`src/lib/chains.js` / `src/lib/payout.js`). Only that operator-owned wallet may
open a new supply, which keeps the canary to a single, known address.

```env
FARM_STRICT_FORK_EVIDENCE=true
FARM_ROLLOUT_PROTOCOLS=aave-base,aave-arbitrum

VITE_ENABLE_AAVE_BASE_SUPPLY=true
VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=true
VITE_AAVE_ARB_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX=100
VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL=500
VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX=100
VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL=500

VITE_ENABLE_COMPOUND_BASE_SUPPLY=false
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=false
VITE_ENABLE_MORPHO_BASE_SUPPLY=false
```

## Staged canary example — Compound V3 Base

Compound also uses the fee-recipient wallet as the allowlisted address. Caps are
in whole USDC (default 100 per-tx / 500 total).

```env
FARM_STRICT_FORK_EVIDENCE=true
FARM_ROLLOUT_PROTOCOLS=compound-base

VITE_ENABLE_COMPOUND_BASE_SUPPLY=true
VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX=100
VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL=500

VITE_ENABLE_AAVE_BASE_SUPPLY=false
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=false
VITE_ENABLE_LIDO_STAKE=false
VITE_ENABLE_MORPHO_BASE_SUPPLY=false
```

## Staged canary example — Lido

The Lido canary also uses the fee-recipient wallet as the only allowlisted
address. Caps are in whole ETH (default 1 per-tx / 10 total), not USDC.

```env
FARM_STRICT_FORK_EVIDENCE=true
FARM_ROLLOUT_PROTOCOLS=lido

VITE_ENABLE_LIDO_STAKE=true
VITE_LIDO_STAKE_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
VITE_LIDO_STAKE_MAX_ETH_PER_TX=1
VITE_LIDO_STAKE_MAX_ETH_TOTAL=10

VITE_ENABLE_AAVE_BASE_SUPPLY=false
VITE_ENABLE_COMPOUND_BASE_SUPPLY=false
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=false
VITE_ENABLE_MORPHO_BASE_SUPPLY=false
```

This is a limited canary, **not** public capital enablement. No private key / seed /
credential is requested or stored, and no transaction is sent without explicit
confirmation from the wallet owner.
