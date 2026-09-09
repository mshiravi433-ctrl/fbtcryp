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
Compound Base) pin the raw probe-log `sha256` so the evidence is reproducible and
auditable in a fresh CI/Vercel checkout. **No record exists for Lido or Morpho yet.**

---

## 2. Protocol status table

| Network | Asset | Protocol | Op | Flag | Allowlist | Caps (per tx / total) | Fork evidence | Status |
|---|---|---|---|---|---|---|---|---|
| Base | native USDC (aUSDC) | Aave v3 | supply | `VITE_ENABLE_AAVE_BASE_SUPPLY` | `VITE_AAVE_BASE_SUPPLY_ALLOWLIST` | 100 / 500 | **36/36 PASS** (`aave-base.json`) | ✅ canary-ready |
| Arbitrum One | native USDC (aUSDC) | Aave v3 | supply | `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY` | `VITE_AAVE_ARB_SUPPLY_ALLOWLIST` | 100 / 500 | **37/37 PASS** (`aave-arbitrum.json`) | ✅ canary-ready |
| Base | native USDC (cUSDCv3) | Compound v3 | supply | `VITE_ENABLE_COMPOUND_BASE_SUPPLY` | `VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST` | 100 / 500 | **46/46 PASS** (`compound-base.json`) | ✅ canary-ready |
| Ethereum | stETH↔wstETH | Lido | stake/wrap | `VITE_ENABLE_LIDO_STAKE` | `VITE_LIDO_STAKE_ALLOWLIST` | 1 ETH / 10 ETH (proposed) | **NO PASS yet** | ⛔ must stay OFF until PASS |
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
are real operator-owned `0x` addresses. The allowlist is non-empty in all three
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
caps default 100/500 USDC → `limited-canary`, `ok: true`. Capital-off build passes too.

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

`farm-fork-evidence/*.json` are git-ignored by default; only these three committed
anchors are un-ignored (see `.gitignore`) so transient re-earned records don't
clutter the repo.

---

## 6. Lido — the running blocker

Lido's `--strict` mainnet fork probe (`test/lido-mainnet-fork-probe.mjs`) currently
**fails on the unwrap step**, so there is **no `farm-fork-evidence/lido.json`**.

**Root cause (confirmed):** the probe wraps `0.005` stETH, then calls
`buildUnwrapPlan({ amountWstETH: wrapAmount })` where `wrapAmount` is `"0.005"` —
i.e. it passes the **stETH** amount as if it were **wstETH**. stETH→wstETH is not
1:1 (`0.005` stETH produced ≈ `0.0040207` wstETH), so `buildUnwrapPlan` correctly
returns `steps: []` with `LIDO_INSUFFICIENT_WSTETH`, and the probe crashes
dereferencing `steps[0].to`.

**Fix (PR #258, merged to `main` as `cf04767`):** unwrap the **real** wstETH balance held after the wrap:
```js
const unwrapAmount = formatEther(afterWrap.wstETHWei);
const unwrapWei   = afterWrap.wstETHWei;
const unwrapPlan  = await adapter.buildUnwrapPlan({
  provider, owner: ACCOUNT, amountWstETH: unwrapAmount
});
```
Because `afterWrap.wstETHWei` is the actual wstETH the account holds, the plan is
non-empty and the probe can complete wrap → unwrap → request → claim. The remote
strict `EXPLICIT_RPC` gate is untouched.

**Status:** the unwrap fix is **now on `main`** (PR #258, merged as `cf04767`), and
the Aave/Compound evidence anchors are also on `main` (PR #259, merged as `f2b0390`).

**Probe result as of the latest manual run:** **27/28 passed.** Every real-logic
assertion passes (stake → wrap → unwrap → withdrawal request → real `requestId` →
ownership → fresh request not finalized → claim blocked until finalization). The
**single** remaining FAIL is the last assertion (`probe completed without an
unexpected error`): it is a **transport/archive error, not a logic bug** — the fork
RPC used (`https://ethereum-rpc.publicnode.com`) rejects `eth_getLogs` over the queue
history with `HTTP 403 "Archive requests require a personal token"`. Per the strict
rule, a transport error is never counted as a pass, so this run is **not** evidence
yet.

**Required fix — use a token-free ARCHIVE fork RPC.** Pass an RPC that serves
archival state without a personal token (the workflow default
`https://eth.llamarpc.com`, or `https://eth-mainnet.public.blastapi.io`,
`https://eth.drpc.org`, `https://1rpc.io/eth`). Do **not** use
`https://ethereum-rpc.publicnode.com` or any non-archive endpoint — it will `403`
on archive `getLogs`. The probe now also **chunks** `eth_getLogs` into 10k-block
windows so a per-request range cap cannot reject it.

**Next step:** re-run the manual **Lido mainnet fork probe** action with a token-free
archive RPC; if it returns a clean `N/N passed` (expected 28/28), record
`farm-fork-evidence/lido.json` from that log, and only then consider Lido a canary
candidate.

---

## 7. Remaining limits

- **Lido** and **Morpho** stay OFF until each has a recorded `N/N passed` strict-fork
  PASS under `farm-fork-evidence/`. No amount of attestation (`FARM_STRICT_FORK_EVIDENCE=true`)
  replaces a real PASS log.
- No canary is enabled with an empty allowlist or incomplete flags; the gate never
  fails open.
- The GitHub App cannot write `.github/workflows/`; workflow YAML for the agent is a
  committed `ci/` reference that the operator places by hand (this applies to Lido too).
- The recommended rollout is **Aave Base + Aave Arbitrum + Compound Base** in one
  canary (fee-recipient allowlist), then Lido once its evidence lands, then Morpho.
