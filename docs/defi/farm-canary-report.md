# Farm canary rollout — current status report

_Status as of 2026-09-09. This report records exactly which protocol paths are
**canary-limited and evidence-backed** and which must stay **OFF**. It is an
operational status document, not a claim that public capital is on._

> **Rule that governs every line below:** public capital is only enabled once a
> protocol has (a) a clean `--strict` fork-probe PASS recorded in
> `farm-fork-evidence/<id>.json`, (b) a non-empty operator allowlist, and (c) a
> successful canary. Until then the gate is `capital-off`. Withdraw/exit/revoke is
> gated **only** by `hasPosition`, never by the supply flag, allowlist, or caps.

---

## 1. Gate behaviour

The staged rollout gate is `scripts/farm-rollout-policy.mjs`, invoked by
`vite.config.js` as `assertFarmRollout(process.env)`. It is **fail-closed**:

- No `VITE_ENABLE_*_SUPPLY=true` → `mode: "capital-off"`, `ok: true`, no evidence
  required. This is the default build.
- Any `VITE_ENABLE_*_SUPPLY=true` → `FARM_STRICT_FORK_EVIDENCE` **must** be `true`,
  the matching id must be in `FARM_ROLLOUT_PROTOCOLS`, that protocol's allowlist
  must be non-empty, and caps must not exceed the reviewed canary caps. Otherwise
  it throws and the build fails.
- `FARM_ROLLOUT_PROTOCOLS` selects/stages which protocols are allowed to be enabled
  together. You cannot enable a protocol that isn't selected, and you cannot select
  one whose flag isn't `true`.

A `FARM_STRICT_FORK_EVIDENCE=true` on its own is an operator attestation. The
`farm-fork-evidence/<id>.json` anchors in this repo (Aave Base / Aave Arbitrum /
Compound Base / **Lido**) pin the raw probe-log `sha256` so the evidence is
reproducible and auditable in a fresh CI/Vercel checkout. **No record exists for
Morpho yet.**

---

## 2. Protocol status table

| Network | Asset | Protocol | Op | Flag | Allowlist | Caps (per tx / total) | Fork evidence | Status |
|---|---|---|---|---|---|---|---|---|
| Base | native USDC (aUSDC) | Aave v3 | supply | `VITE_ENABLE_AAVE_BASE_SUPPLY` | `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | 1000 / 10000 | **36/36 PASS** (`aave-base.json`) | ✅ canary-ready |
| Arbitrum One | native USDC (aUSDC) | Aave v3 | supply | `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | 1000 / 10000 | **37/37 PASS** (`aave-arbitrum.json`) | ✅ canary-ready |
| Base | native USDC (cUSDCv3) | Compound v3 | supply | `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` | 1000 / 10000 | **46/46 PASS** (`compound-base.json`) | ✅ canary-ready |
| Ethereum | stETH↔wstETH | Lido | stake/wrap | `VITE_ENABLE_LIDO_STAKE` | `VITE_LIDO_STAKE_ALLOWLIST` | 1 ETH / 10 ETH | **31/31 PASS** (`lido.json`) | ✅ canary-ready |
| Base | native USDC / cbBTC (ERC-4626/earner) | Morpho Blue | supply | `VITE_ENABLE_MORPHO_BASE_SUPPLY` | `VITE_MORPHO_BASE_SUPPLY_ALLOWLIST` | — | **NO PASS yet** | ⛔ must stay OFF until PASS |

Capital-off (the default, no money-in flag) is always allowed.

---

## 3. Operator canary allowlist (fee-recipient wallets)

The canary allowlist is the set of addresses that receive fees, not arbitrary
wallets. Primary operator fee-recipient:

```
0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
```

Additional per-chain fee recipients from the repo are acceptable **only if** they
are real operator-owned `0x` addresses. The allowlist is non-empty in all four
canary-ready protocols (only the fee wallet above).

---

## 4. Canary build examples (verified locally against the gate)

**Compound v3 Base (canary):**
```
FARM_STRICT_FORK_EVIDENCE=true \
FARM_ROLLOUT_PROTOCOLS=compound-base \
VITE_ENABLE_COMPOUND_BASE_SUPPLY=true \
VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
```
caps default 1000/10000 USDC → `limited-canary`, `ok: true`. Capital-off build passes too.

**Aave v3 Base + Arbitrum (canary):**
```
FARM_ROLLOUT_PROTOCOLS=aave-base,aave-arbitrum \
FARM_STRICT_FORK_EVIDENCE=true \
VITE_ENABLE_AAVE_BASE_SUPPLY=true \
VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6 \
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=true \
VITE_AAVE_ARB_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
```

**Lido (canary) — only after a PASS:**
```
FARM_STRICT_FORK_EVIDENCE=true \
FARM_ROLLOUT_PROTOCOLS=lido \
VITE_ENABLE_LIDO_STAKE=true \
VITE_LIDO_STAKE_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
```
caps proposed 1 ETH/tx, 10 ETH total. **Do not enable until**
`farm-fork-evidence/lido.json` with `result: "PASS"` exists.

---

## 5. Records / proof

Each `farm-fork-evidence/<id>.json` records `result: PASS`, the full assertion
count, and the raw probe-log `sha256` (the fingerprint). They are produced by
`scripts/record-farm-fork-evidence.mjs`, which refuses any log that is not a clean
`N/N passed` full PASS. Current committed anchors:

| id | result | assertions | sha256 fingerprint |
|---|---|---|---|
| `aave-base` | PASS | 36/36 | `97abf4ad49c016a4ff719eb797b6f9f4dc52b192a5d44a9d3e50f524f4b32fc3` |
| `aave-arbitrum` | PASS | 37/37 | `29d686b8fc0b707a12d06e1de6d702f0eac43369f7dd6ae4939434d591a4bd08` |
| `compound-base` | PASS | 46/46 | `e43e1301469cbeeccaa8c1787713259b27f7777daa2a9e0a374151a6c89f8eae` |
| `lido` | PASS | 31/31 | `3365c0a8c6877cd19709a09fcfc1408634a7a2c46d8739780d0c82354d4122b9` |

`farm-fork-evidence/*.json` are git-ignored by default; only these four committed
anchors are un-ignored (see `.gitignore`) so transient re-earned records don't
clutter the repo.

---

## 6. Lido — now evidence-backed

Lido's `--strict` mainnet fork probe (`test/lido-mainnet-fork-probe.mjs`) **now passes
31/31**, so `farm-fork-evidence/lido.json` is recorded (sha256
`3365c0a8c6877cd19709a09fcfc1408634a7a2c46d8739780d0c82354d4122b9`).

Getting here required several fixes, all merged to `main`:
- **Unwrap real wstETH** (PR #258, `cf04767`): the probe originally passed the stETH
  input as `amountWstETH`, but stETH→wstETH isn't 1:1 (`0.005` stETH ≈ `0.0040207`
  wstETH), so `buildUnwrapPlan` returned `steps: []` and the probe crashed. It now uses
  `formatEther(afterWrap.wstETHWei)` / `afterWrap.wstETHWei`.
- **Adaptive `eth_getLogs` chunking** (PR #264, `00aaefb`): the chosen fork RPC caps
  the `eth_getLogs` range (e.g. `blastapi` caps at 10 blocks). The probe now reads the
  RPC's suggested window from a range error and shrinks the chunk, retrying the same
  start block so no logs are skipped. Honors `LIDO_LOG_CHUNK`.
- **RPC auto-failover** (PR #263, `0dfe356`): tries the operator's explicit `rpc_url`
  first, then a set of token-free archive endpoints, and picks the first reachable one.
- **Anvil boot budget** (PR #262, `61f4926`): waits up to `ANVIL_START_TIMEOUT_MS`
  (default 180s) and surfaces the last fork error.
- **Token-free archive RPC** requirement documented in `ci/lido-mainnet-fork-probe.yml`
  (`publicnode` is excluded because it 403s on archive `getLogs`).

The successful run used `https://eth-mainnet.public.blastapi.io`, found a real
finalized/unclaimed request (`#134974`), and proved claim ownership/finalization.

---

## 7. Remaining limits

- **Morpho** stays OFF until it records an `N/N passed` strict-fork PASS under
  `farm-fork-evidence/`. No amount of attestation (`FARM_STRICT_FORK_EVIDENCE=true`)
  replaces a real PASS log. Lido now has its evidence and is canary-ready.
- No canary is enabled with an empty allowlist or incomplete flags; the gate never
  fails open.
- The GitHub App cannot write `.github/workflows/`; workflow YAML for the agent is a
  committed `ci/` reference that the operator places by hand (this applies to Lido's
  workflow too — the probe already works; the workflow file just needs to be kept in
  sync with `ci/lido-mainnet-fork-probe.yml`).
- The recommended rollout is **Aave Base + Aave Arbitrum + Compound Base + Lido** in one
  canary (fee-recipient allowlist, Lido caps 1 ETH/tx / 10 ETH total), then Morpho once
  its evidence lands.
