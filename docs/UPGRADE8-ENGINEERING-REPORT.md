# FBT Intent OS AI — Upgrade 8 Engineering Report

Date: 2026-09-05  
Branch: `arena/01a0714f-fbtcryp`

## Audit result

The repository already contained a substantial Central Intelligence OS (server/central), an Upgrade 6/7 browser OS, wallet context, EVM/Solana adapters, tool registries, risk/policy gates, action idempotency, event buses, monitoring, financial goals, and an extensive probe suite. The main gap was not a lack of features; it was that the newest lifecycle contract was spread across incompatible records and was not represented by one explicit, shared Upgrade 8 state contract.

| Area | Finding |
|---|---|
| Frontend/navigation/chat | **PARTIALLY WORKING** — CentralBrainProvider is above the router and survives navigation; Upgrade 8 state was not exposed as a stable resource. |
| Backend/API | **PARTIALLY WORKING** — `/api/intent` and `/api/system/*` existed; goal/task/question/simulation lifecycle endpoints were missing. |
| Intent/context | **PARTIALLY WORKING** — existing parsers and context engines worked, but lifecycle/status types were distributed. |
| Wallet/EVM/Solana | **WORKING / guarded** — existing providers and client-owned wallet truth were retained; no signing secrets enter the new contract. |
| Agents/tools/risk | **WORKING / PARTIALLY WORKING** — existing central router has capability, permission, dependency, retry/fallback and timeout gates; the Upgrade 8 result contract was missing. |
| Persistence | **PARTIALLY WORKING** — central server state is process scoped and the browser has local persistence in older layers; a production database adapter is still required for cross-restart durability. |
| Database | **MISSING** — no relational/document schema or migration system was found. No speculative database dependency was added. |
| Tests | **WORKING** — many existing phase probes; Upgrade 8 now adds a 100-scenario deterministic golden probe. |

## Root causes

1. Lifecycle identity, question binding, simulation, and execution safety lived in multiple Upgrade layers instead of a single versioned contract.
2. The existing API had a central intent gateway but no first-class Upgrade 8 state resource for resume/checkpoint/question flows.
3. In-memory server session storage is useful for live continuity but cannot survive process restart or support durable cross-device recovery.

## Architecture changes

- Added `fbt.intent-os.v2` as a provider-agnostic central state contract.
- Added explicit conversation, intent, task, goal, question, answer, checkpoint, agent-result, simulation, permission, and execution primitives.
- Added deterministic short-answer normalization and reference resolution, including Persian references such as `اولی`, `دومی`, `همون گزینه دوم`.
- Added parallel agent orchestration with normalized results, latency, confidence, source list, error isolation, and conflict detection.
- Added simulation objects that explicitly cannot create transactions.
- Added execution permission/simulation/confirmation gating and an idempotency guard.
- Added recursive secret sanitization for state/context boundaries.
- Added central API routes under `/api/intent-os/*` for state, intent creation, question creation, and simulation.
- Preserved existing UI identity and existing CentralBrain/legacy APIs; no visual redesign was made.

## Files created

- `src/lib/intent-ai/upgrade8/index.js`
- `server/central/upgrade8Store.js`
- `test/intent-ai/upgrade8-probe.mjs`
- `docs/UPGRADE8-ENGINEERING-REPORT.md`

## Files modified

- `src/lib/intent-ai/os/index.js` — exports Upgrade 8 as a namespace and named primitives.
- `server/central/router.js` — adds Upgrade 8 lifecycle/simulation endpoints.
- `package.json` — adds `test:upgrade8`.

## Files deleted

None.

## Feature status

| Subsystem | Status | Notes |
|---|---|---|
| Intent Engine | **DONE** | Versioned intent lifecycle and state transitions. Existing classifier remains intact. |
| Context Engine | **PARTIAL** | New state contract and sanitizer added; durable provider-backed context still belongs to existing central adapters. |
| Memory | **PARTIAL** | Existing short/session/long-term memory remains; Upgrade 8 state facade does not yet add database-backed summarization. |
| Goal Engine | **DONE** | Goal object and linkage to task/intent added; live goal monitoring remains in existing modules. |
| Task Engine | **DONE** | Task steps, progress, status, checkpoints, and recovery shape added. |
| Agents | **DONE** | Standard result contract, parallel execution, isolation, and conflict detection added. |
| Tools | **PARTIAL** | Existing central Tool Router remains authoritative; Upgrade 8 adds the contract but does not duplicate provider adapters. |
| Wallet | **PARTIAL** | Existing EVM/Solana wallet stack retained; fresh snapshot enforcement for every live execution remains in central execution adapters. |
| Execution | **PARTIAL** | Permission + simulation + confirmation + idempotency primitives are done; real signing/verification continues through existing wallet handoff. |
| Monitoring | **PARTIAL** | Existing event/monitoring system retained; Upgrade 8 state has monitoring fields but not a new scheduler. |
| Chat | **PARTIAL** | Existing navigation-safe CentralBrainProvider retained; Upgrade 8 API is available but not yet a replacement chat UI. |
| Thinking Orb | **PARTIAL** | Existing `ThinkingOrb` retained; no visual identity change. |
| Database | **BLOCKED** | No database adapter/schema exists in the repository. Production persistence requires an infrastructure decision. |
| API | **DONE** | New state/intent/question/simulate routes are wired through the central router. |
| Security | **DONE** | Secret-key filtering and simulation non-transaction invariant are covered. |
| Performance | **DONE** | Agent calls use `Promise.all`; no synchronous provider or UI work added. |

## Verification

- `npm run test:upgrade8` — **PASS** (`100 golden scenarios passed`).
- `node --check server/central/upgrade8Store.js` — **PASS**.
- `node --check server/central/router.js` — **PASS**.
- `npm run build` — **BLOCKED by the checkout environment**: the existing `prebuild` script imports `esbuild`, but `esbuild` is not installed in the available `node_modules`; this is unrelated to Upgrade 8 source changes.

## Acceptance path coverage

The new contract supports: create intent → attach goal/task → ask a typed question → bind `ریسک متوسط` to its slot → checkpoint steps → run independent agents in parallel → simulate bull/base/bear/stress without a transaction → require permission, simulation, and confirmation before execution → deduplicate by idempotency key. Existing wallet handoff, transaction verification, event monitoring, and navigation-safe chat remain the integration points for the final live-money flow.

## Remaining production work

- Replace `server/central/upgrade8Store.js` Map storage with the deployment's approved database/session adapter and migrations for conversations, intents, goals, tasks, checkpoints, questions, answers, agent runs, tool runs, executions, monitoring events, and notifications.
- Persist the same owner/session identity across devices only after authentication/consent policy is selected.
- Connect the existing live agent/tool adapters to the new `agentState` and `toolState` records, then run the full external-provider and wallet E2E probes in an environment with real providers.
