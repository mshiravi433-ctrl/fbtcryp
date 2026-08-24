# FBT Swap — P0 Execution & Security Layer (Session Report)

This document is the honest, no-overclaim status of what this session delivered.
It follows the rule the master prompt sets: every capability is **Live**,
**Code-complete but needs external config**, or **Unavailable and honestly
labelled** — nothing is dressed up as `live` / `protected` / `atomic` / `AI
executed` unless it actually runs.

> Scope note: the master prompt describes a 9-phase overhaul. This session
> deliberately concentrated on **P0 (execution engine + security)** — the
> foundation every later phase depends on — rather than touching every screen.
> The existing codebase is mature; the work below fills the genuine P0 gaps.

---

## 1. What is now genuinely LIVE and executable

| Capability | Where | Why it is live |
|---|---|---|
| **Unified quote model** | `src/lib/quoteModel.js` | Pure, imported by tests and wired into the swap flow. Net-output selection, freshness, fingerprint, failure taxonomy — all enforced, all unit-tested. |
| **Real pre-sign `eth_call` simulation** | `src/lib/preSignSimulation.js` | Runs a real `provider.call()` + `estimateGas()`; a detected revert is reported and (when wired via the gate) blocks signing. Honest verdict states, never "safe" from a failed sim. |
| **MEV execution-path states** | `src/lib/mevProtection.js` | Pure state machine. Only `private-execution-confirmed` may render as "protected". Distinct from the existing risk *heuristic*. |
| **Execution risk gate (enforced, not displayed)** | `src/lib/executionGate.js` + `Swap.jsx` | The confirm button now **blocks** on critical risk (honeypot / unsellable / revert) and **requires a two-press acknowledge** on high/unknown risk. Risk is no longer decoration. |
| **Standard provider status endpoint** | `server/providerStatus.js` + `GET /api/providers/status` | Serves the full standard shape. `reachable`/`authenticated` start `false` and flip only on evidence; no secret is ever echoed. Verified over HTTP. |

## 2. What is code-complete but needs external configuration / wiring to be "live"

- **`reachable` / `lastSuccessAt` flipping** — the status shape and tracker exist,
  but the integration call sites (`aggregator`, `gasless`, `bridge`, …) do not
  yet call `recordSuccess`/`recordFailure`. They will report `reachable: false`
  until those one-line calls are threaded in. This is honest today (a configured
  key is not reachability) and trivially completable.
- **MEV states surfaced in the UI** — `mevProtection.js` is built and tested but
  `MevGuard.jsx` still renders the existing heuristic pill. Wiring the new
  states is a UI-only change; the state logic is done and locked by tests.
- **Quote-model normalization adopted by `getQuote`** — `bestQuote.js` still
  ranks on gross. `quoteModel.rankByNetOutput` is ready to replace it; the
  switchover is intentionally deferred so net-output ranking lands with a UI
  that shows the gas line per route.

## 3. What still needs an external dependency (API key, deployment, audit, partner, resolver)

Unchanged from the existing `/api/revenue/readiness` and the new
`/api/providers/status`. As of this session the operational truth is:

- **0x Gasless / cross-chain**: `ZEROX_API_KEY` not set → `configured: false`,
  `missingConfiguration: ['ZEROX_API_KEY']`.
- **THORChain UTXO revenue**: `THOR_NAME` not set → `feeReady: false`,
  `externalApprovalRequired: true`.
- **Resolver network**: **protocol-ready, not live.** No external resolver with
  a signed, verifiable quote and audited settlement exists. It is NOT shown as
  `live`, `atomic`, or `resolver network active`. Internal FBT quotes are
  explicitly not conflated with a real resolver network.

## 4. Endpoints / providers that fail or are unavailable

The new endpoint reports this directly (10 providers, 7 configured, **0
reachable** on a fresh process because no integration has logged a successful
call yet — which is the honest answer, not a failure). Operationally:

- `0x-gasless`, `0x-cross-chain`: unavailable without key.
- `thorchain`: UTXO revenue unavailable without THORName.
- `velora`: quote-only (`feeReady: false`, `role: price-source-only`) — cannot
  sign, reported honestly.

## 5. Files changed

New (5): `src/lib/quoteModel.js`, `src/lib/preSignSimulation.js`,
`src/lib/mevProtection.js`, `src/lib/executionGate.js`, `server/providerStatus.js`

Modified (7): `server/app.js` (import + `GET /api/providers/status`),
`src/pages/Swap.jsx` (gate wiring), `src/components/TokenRiskCard.jsx`
(`onRisk` lift), `src/i18n/locales/{en,fa}.json` (`swap.gate.*`),
`test/units.mjs` (~90 new tests), `test/wiring.mjs` (gate assertions).

## 6. Tests run + exact result

- `npm test` → **All suites passed.**
- Unit suite → **1628 / 1628 passing** (was 1538; +90 new).
- New coverage: stale-quote rejection, net-vs-gross selection, gas-unknown
  can't win, fingerprint tamper detection, revert detection, MEV
  "only confirmed may show protected", gate block/acknowledge, provider-status
  secrecy boundary, the wiring assertion that the gate disables the button.

## 7. Build result

`npm run build` → **✓ built in ~29s**, 7 landing pages generated. No errors.

## 8. Remaining security risks (honest)

- The fingerprint in `quoteModel.js` is **non-cryptographic (FNV-1a)** by
  design — it is a drift/tamper early-warning, not forgery protection. The
  authoritative protection remains the on-chain fee-echo verification in
  `aggregator.js`. Documented in the file header.
- `reachable`/`authenticated` in provider status are in-memory and per-process
  (not durable). Correct for "did the last call work"; not a global liveness
  oracle.
- MEV `private-execution-confirmed` is about the mempool path, **not** a
  sandwich-prevention guarantee. Labelled as such.
- The existing intent/resolver/cross-chain modules were **audited but not
  rewritten** — they remain in their current state and are honestly reported
  as protocol-ready/awaiting-resolvers where applicable.

## 9. Commit hash

`30400adbfd9ff874e05581d5d97989e69468143d` on `arena/01a03323-fbtcryp` (pushed).

## 10. Working tree

**Clean.** `git status` empty; `git diff --check` clean.
