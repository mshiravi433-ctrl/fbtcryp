# FBT FINANCIAL INTELLIGENCE OS — Implementation Audit

Date: 2026-09-08 · Branch: `arena/01a08190-fbtcryp` · Base: `f170a56`

Method: every row below was produced by reading the file named in the "Evidence"
column (or by running the probe named there). Nothing in this table is inferred
from a filename. Status vocabulary:

| Status | Meaning |
| --- | --- |
| **EXISTS** | Real implementation, wired, exercised by a passing test. |
| **PARTIAL** | Real code, but does not cover the required behaviour end to end. |
| **BROKEN** | Present and fails, or cannot run as written. |
| **DISCONNECTED** | Implemented, but nothing calls it from the live request path. |
| **MOCKED** | Stands in for a provider that is not reachable/configured here. |
| **MISSING** | No implementation in the repository. |
| **READY FOR EXTENSION** | Solid foundation; the new layer is built on top of it. |

Two "brains" already exist and both are mounted:

* `server/central/*` → `/api/intent`, `/api/system/*`, `/api/tools/*` (probe: `test/central-os-probe.mjs`, 60/60 passing locally).
* `server/ci/*` + `src/lib/central/*` → `/api/brain/*` (the UI's only brain: `src/context/CentralBrainContext.jsx`, `src/lib/central/client.js`).

The Financial Intelligence OS added by this work composes **both** rather than
adding a third gateway: it reads the `/api/brain` state store, reuses the pure
engines in `src/lib/central/*`, delegates every money move to the brain's action
engine, and exposes the requested `/api/ai/*` surface.

---

## 1. Subsystem-by-subsystem audit

| # | Subsystem | Status | Evidence / notes |
| --- | --- | --- | --- |
| 1 | Frontend architecture | EXISTS | Vite + React SPA (`vite.config.js`, `src/pages/*`, 121 components). Intent OS page `src/pages/IntentOS.jsx` (2307 lines) already hosts `CentralBrainPanel`, `FinancialGoals`, `IntentCrossChainPanel`. |
| 2 | Backend architecture | EXISTS | One Express app shared by dev server and Vercel (`server/app.js`, 5.6k lines; `server/index.js`; `api/index.js`). |
| 3 | API architecture | EXISTS | `/api/brain/*` (`server/ci/api.js`), `/api/intent`+`/api/system/*`+`/api/tools/*` (`server/central/router.js`), `/api/ai/*` (status/diagnose/outlook/brief/ask + `server/aiCommand.js`: chat, dashboard, plan, automations, emergency-stop, agents). |
| 4 | AI services / multi-provider | EXISTS | `server/aiGateway.js` — 9 providers, `routedChat()` per-task failover, `parallelMultiProviderChat()`, `sanitizePrompt()`, `assertNoSecretsInPayload()`. |
| 5 | Intent OS / classification | EXISTS | `src/lib/central/intent.js` (`classify`, state machine), `server/ci/brain.js` (1446 lines) full turn pipeline. V1: `server/aiIntentOS.js` (1911 lines). |
| 6 | AI Command Center | EXISTS | `server/aiCommand.js` + `src/lib/intent-ai/commandCenter.js`, `src/lib/aiCommandClient.js`. |
| 7 | Wallet services (EVM) | EXISTS | `src/lib/wallet-engine/*`, `src/lib/localWallet.js`, `server/btcChain.js`, `server/gasless.js`. |
| 8 | Solana | EXISTS | `server/solana.js`, `server/solanaAssets.js`, `server/solanaIntel.js`, `src/lib/solanaWallet.js`. |
| 9 | Execution / signing / broadcast | EXISTS | `server/ci/actions.js` (action engine, unsigned handoff), `src/lib/intentTransaction.js` (`sendIntentTransaction` — the only signer path), `src/lib/intent-ai/executionAdapters.js`, `broadcastAdapter.js`. |
| 10 | Transaction monitoring / verification | EXISTS | `src/lib/intent-ai/executionMonitor.js`, `executionStateMachine.js`, `server/intentMonitoring.js`, `server/crossChainStore.js`. |
| 11 | Conditional orders | PARTIAL | `src/lib/intent-ai/os/conditionalOrder.js` exists and is surfaced by `IntentAIUnified.jsx`; no server-side evaluation loop — evaluation is client-only. |
| 12 | Goal Engine | EXISTS | `server/financialGoals.js` (7 routes + KV collections) + `src/lib/financialGoalEngine.js`; `src/lib/central/profile.js` (`createGoal`, `goalProgress`, `detectGoalConflicts`). **Do not duplicate.** |
| 13 | Opportunity Engine | EXISTS (client) | `src/lib/brain/opportunityEngine.js`, `src/lib/central/council.js#rankOpportunities`, `analysis.js#scanOpportunities`. |
| 14 | Memory | PARTIAL | `src/lib/central/memory.js` (`createMemoryStore`, origins `stated/observed/inferred`), `server/ci/brain.js` per-owner memory, `src/lib/intent-ai/intentGenomeMemory.js`. No separate preference / behaviour / strategy-outcome / financial-state-history stores; not persisted server-side per owner. → **Memory 2.0** added. |
| 15 | AI↔AI (council) | PARTIAL | `src/lib/central/council.js#runCouncil` (pure), `src/lib/intent-ai/agentCouncil.js`, `server/aiConsensus.js` (parallel providers). No financial role split (Analyst/Architect/Risk Auditor/Execution Auditor/Guardian) with persisted disagreement. → added. |
| 16 | External agents | EXISTS | `src/lib/intent-ai/externalAgentTrust.js` (830 lines: passport, security, sandbox, handshake, reputation), `externalAgentRuntime.js`, `agentDirectory.js`. Client-only; no server registry/persistence. → server registry added. |
| 17 | Smart money | EXISTS | `server/smartMoney/*`, `server/whales.js`, `src/lib/smartMoneyAI.js`, `council.js#smartMoneyModifier`. |
| 18 | DeFi / lending / farming | EXISTS | `server/lending.js`, `server/yields.js`, `yieldsApi.js`, `src/lib/lending-engine/*`, `farmDeFi.js`; fork probes `test/aave-base-fork-probe.mjs`, `test/compound-base-fork-probe.mjs`. |
| 19 | Futures | EXISTS | `server/futures/*` (incl. `intentAdapter.js`), `server/perp.js`, `server/dydx.js`, `src/lib/futures-engine/*`. |
| 20 | Stocks / RWA | EXISTS | `server/avantis.js` (tokenised equities), `server/ostium.js`, `server/rwa.js`, `server/structuredProducts.js`. |
| 21 | Research | PARTIAL | `server/aiWebResearch.js` (381 lines, provider-grounded), `server/news.js`, `server/securityIntel.js`, `server/tokenRisk.js`. No single structured research object (summary/evidence/signals/risks/sources/confidence) and no link to decisions. → Research Engine added. |
| 22 | Risk | EXISTS | `src/lib/central/risk.js` (`assessRisk`, `refreshRiskFor`), `analysis.js` (concentration, exposure, lending safety, shock, feasibility), `server/central/riskEngine.js`, `src/lib/intent-ai/adaptiveRisk.js`. |
| 23 | Guardian | EXISTS | `src/lib/intent-ai/guardian.js` (non-disableable), `council.js#financialGuardian`, `#executionGuardian`, `src/lib/intentGuardian.js`. Proactive (change-driven) notifications: **MISSING** → added. |
| 24 | Policy (per-turn) | EXISTS | `src/lib/central/policy.js#evaluatePolicy` (stale/missing/slippage/HF gates, `planDigest`), `server/central/policy.js`, `server/ci/actions.js`. |
| 25 | Autonomous policy (scoped standing authority) | PARTIAL / DISCONNECTED | `src/lib/intent-ai/policyModel.js` (localStorage, `createPolicy`/`confirmPolicy`/`triggerEmergencyStop`) and `onchainPolicy.js`. **No server-side policy object, no spend ledger, no autonomy loop** → added (`server/fios/policy.js`, `autonomy.js`). |
| 26 | Automation / scheduler | PARTIAL | `server/intentScheduler.js` (authorization check only, no loop), `src/lib/intent-ai/liveRecurringIntents.js`, `liveDcaTrigger.js`. |
| 27 | Database | PARTIAL (by design) | No SQL. KV store `server/store.js` (Vercel Blob when `BLOB_READ_WRITE_TOKEN` set, in-process Map otherwise); collections as key namespaces (`financial_goals`, `financial_goal_plans`, `financial_goal_events` in `server/financialGoals.js`). `storeDurable()` reports the mode. FI collections follow the same convention. |
| 28 | Queues / event bus | EXISTS | `server/ci/eventBus.js` (SSE), `server/central/eventBus.js`, `src/lib/central/schema.js#REFRESH_CASCADE`. |
| 29 | Simulation / what-if | PARTIAL | `src/lib/central/scenario.js` (`runScenarios`, `monteCarlo`, `twinProject`, `optimizePortfolio`), `financialGoals.js#goalWhatIf`/`goalSimulate`, `server/intentSimulator.js`. No natural-language what-if parser, no fee/gas/slippage/goal-probability composition → added. |
| 30 | Strategy engine + competition | PARTIAL | `src/lib/intent-ai/strategyCompetition.js` (`generateStrategies`, `compareStrategies`, `competeStrategies`, `explainStrategyComparison`, `replanAfterCapabilityDecline`), `parallelStrategies.js`. Needs candidates fed from live state; nothing generates them server-side → added. |
| 31 | Decision engine | EXISTS (pure) / DISCONNECTED from live state | `src/lib/central/decision.js` (`decide`, `scoreDecision`, `rankDecisions`, `weightsFor`), driven by `server/ci/kernel.js#advise`. No evidence-linked, persisted, traceable decision object → added. |
| 32 | Confidence engine | PARTIAL | `server/aiConfidence.js` (V1 heuristic, baseline 85 with penalties), `src/lib/intent-ai/confidenceDecay.js`. Not decomposed into intent/data/research/strategy/risk/execution derived from measured data quality → added. |
| 33 | Cross-chain | EXISTS (quotes) / reasoner MISSING | `server/crossChain.js` (LI.FI), `server/lifi.js`, `server/dln.js`, `server/xchain.js`, `server/thorchain.js`, `server/intentBridgeQuote.js`, `src/lib/intent-ai/multiVenuePlanner.js`, `liveVenueRouting.js`. No component that infers source wallet/chain/destination and scores routes → added. |
| 34 | Intent Genome | PARTIAL / DISCONNECTED | `src/lib/intent-ai/intentGenome.js` (dimensions, `matchIntentDNA`, `evolveIntentGenome`, `rejectSecretGenomeInput`). Not persisted, not queryable over HTTP, not fed by behaviour → added. |
| 35 | Preference model | PARTIAL | `src/lib/central/profile.js` (`updateProfile` with `origin: stated|inferred|default`, `assertedFacts`, `profileGaps`). No fee-sensitivity/leverage-tolerance/execution-style learning from outcomes → added. |
| 36 | Learning engine | PARTIAL | `server/aiLearning.js` (209 lines), `memory.js#evaluateOutcome`/`calibrate` (`MIN_CALIBRATION_SAMPLES = 10`), `monitoring.js#evaluateStrategy`. Not fed by verified executions into preferences/genome → added. |
| 37 | Decision trace | PARTIAL | `server/intentAuditLog.js`, `src/lib/intent-ai/auditTimeline.js`, `observabilityProof.js`, `server/intentOperationalEvidence.js`. No single queryable trace linking worldState→research→strategy→simulation→risk→policy→execution→verification→result → added. |
| 38 | Observability | EXISTS | `server/ci/eventBus.js` + SSE `/api/brain/system/stream`, `src/lib/central/schema.js#EVENT_TYPES`, `server/intentSloMeter.js`. FI emits the §34 vocabulary with correlation IDs on the same bus. |
| 39 | Error handling / idempotency | EXISTS | `src/lib/central/errors.js` (`classifyError`, `humanizeError`, `nextRecovery`), `server/central/errorEngine.js`, `server/idempotency.js`, `src/lib/intent-ai/executionErrorTaxonomy.js`, `failureModes.js`. |
| 40 | Prompt-injection defence | PARTIAL | `server/aiGateway.js#sanitizePrompt`/`assertNoSecretsInPayload`, `server/ci/stateStore.js#redact`, `src/lib/intent-ai/externalAgentSecurity.js`. No single "external text is DATA, not AUTHORITY" gate on the execution path → added (`server/fios/security.js`). |
| 41 | Feature flags | PARTIAL | `src/lib/features.js`, `src/lib/intent-ai/capabilityActivation.js`, `intentActivationConfig.js`. No FI-scoped flags → added. |
| 42 | Model router | PARTIAL | `aiGateway.getPreferredProvidersForTask()` gives per-task provider order but there is no cost/dedupe/cache layer and no deterministic-first policy → added (`server/fios/modelRouter.js`). |
| 43 | Tests | EXISTS | `npm test` (`test/run.mjs`) + ~120 probes (`test/intent-ai/*`), fork probes, vitest suites. FI adds `test/fios/*` and wires the unit probes into `npm test`. |
| 44 | Daily briefing | PARTIAL | `src/lib/central/monitoring.js#buildDailyBrief` (pure) + `server/ci/kernel.js`. Not scheduled, not reachable from the UI → exposed via `/api/ai/briefing`. |

### Explicitly MOCKED / BLOCKED at runtime in this sandbox

| Item | State | Why |
| --- | --- | --- |
| CoinGecko / LI.FI / dYdX / DefiLlama reads | **BLOCKED (network)** | No outbound provider keys or egress in the sandbox. Every FI read reports `dataStatus: 'unavailable'` with a reason; nothing fabricates a number. |
| Durable store | **MOCKED (in-process)** | `BLOB_READ_WRITE_TOKEN` unset → `storeDurable() === false`. FI collections report `durable:false` in every response. |
| LLM synthesis | **DEGRADED** | No `OPENROUTER_API_KEY`/`GEMINI_API_KEY`/… → `aiGateway` falls back to the `internal` deterministic engine. FI research/strategy text therefore comes from deterministic synthesis unless a key is present; `provider:'internal'` is reported. |
| On-chain execution | **BLOCKED by design** | No signer in this process. FI execution always stops at the brain's unsigned handoff. |

---

## 2. What this work adds (and what it reuses)

New layer: **`server/fios/`** (Financial Intelligence OS), mounted at `/api/ai/*`
by `server/app.js`, constructed with the live `/api/brain` `stateStore`, `events`,
`brain` and `kernel` so there is exactly **one** state store and exactly **one**
execution path.

| Requested capability | New file | Reuses (no duplication) |
| --- | --- | --- |
| Financial World Model | `fios/worldModel.js` | `server/ci/stateStore.js`, `src/lib/central/state.js`, `analysis.js` |
| Canonical financial state | `fios/financialState.js` | `src/lib/central/financialState.js#buildFinancialState` |
| Evidence engine | `fios/evidence.js` | — |
| Memory 2.0 | `fios/memory.js` | `src/lib/central/memory.js` (sanitize/origins) |
| Preference model | `fios/preferences.js` | `src/lib/central/profile.js` |
| Behaviour model | `fios/behavior.js` | `src/lib/central/memory.js#evaluateOutcome` |
| Intent Genome | `fios/genome.js` | `src/lib/intent-ai/intentGenome.js` |
| Research engine | `fios/research.js` | `server/news.js`, `securityIntel.js`, `tokenRisk.js`, `smartMoney/*`, `aiWebResearch.js`, `aiGateway` |
| Strategy engine | `fios/strategy.js` | `src/lib/intent-ai/strategyCompetition.js#generateStrategies` |
| Strategy competition | `fios/competition.js` | `compareStrategies`, `competeStrategies`, `explainStrategyComparison` |
| Simulation engine | `fios/simulation.js` | `src/lib/central/scenario.js#runScenarios` |
| What-if engine | `fios/whatif.js` | `analysis.js#simulateShock`, `financialGoals.js#goalWhatIf` |
| Decision engine | `fios/decision.js` | `src/lib/central/decision.js#decide/rankDecisions` |
| Confidence engine | `fios/confidence.js` | `state.js#freshness`, `server/aiConfidence.js` vocabulary |
| Cross-chain reasoner | `fios/crosschain.js` | `server/crossChain.js` (LI.FI quotes), `multiVenuePlanner.js` |
| Autonomous policy | `fios/policy.js` | `src/lib/central/policy.js#evaluatePolicy` |
| Autonomy loop | `fios/autonomy.js` | `server/ci/actions.js` (unsigned handoff only) |
| Proactive guardian | `fios/guardian.js` | `council.js#financialGuardian`, `monitoring.js#detectChanges/earlyWarnings` |
| Replanning | `fios/guardian.js` | `monitoring.js#REPLAN_TRIGGERS`, `strategyCompetition.js#replanAfterCapabilityDecline` |
| AI council | `fios/council.js` | `council.js#runCouncil`, `aiGateway#parallelMultiProviderChat` |
| External agents + trust | `fios/agents.js` | `src/lib/intent-ai/externalAgentTrust.js` |
| Learning engine | `fios/learning.js` | `memory.js#evaluateOutcome/calibrate` |
| Decision trace | `fios/trace.js` | `server/intentAuditLog.js` vocabulary |
| Observability | `fios/observability.js` | `server/ci/eventBus.js` |
| Model router + cost control | `fios/modelRouter.js` | `aiGateway#getPreferredProvidersForTask` |
| Security boundary | `fios/security.js` | `stateStore.js#redact`, `aiGateway#assertNoSecretsInPayload` |
| API | `fios/router.js` | `/api/brain` owner derivation |
| Frontend | `src/components/FinancialIntelligencePanel.jsx`, `src/lib/financialIntelligence.js` | `IntentOS.jsx`, `CentralBrainPanel` |

Feature flags (`server/fios/flags.js`): `FINANCIAL_WORLD_MODEL_ENABLED`,
`RESEARCH_ENGINE_ENABLED`, `STRATEGY_COMPETITION_ENABLED`,
`SIMULATION_ENGINE_ENABLED`, `DECISION_ENGINE_ENABLED`,
`CROSS_CHAIN_REASONER_ENABLED`, `AUTONOMOUS_POLICY_ENABLED`,
`LEARNING_ENGINE_ENABLED`, `PROACTIVE_GUARDIAN_ENABLED`.
A disabled flag returns `{ ok:false, code:'FEATURE_DISABLED' }` — it never fakes
success, and no broken feature is hidden behind a flag that reports healthy.

---

## Batch 7 — delivered (runtime-verified)

The API layer, migrations, UI and the runtime verification the audit demanded.
Every claim below is asserted by a probe that runs in CI (`npm test`); the
numbers are the probe output, not a readiness statement.

| piece | where | what it is |
|---|---|---|
| DB migrations | `fios/migrations.js` | versioned, idempotent, **per-owner lazy** (KV cannot enumerate owners); v2 normalises policy spend ledgers, recomputes live agent trust, pins `grantsExecution: false`, repairs trace links; applied version persisted at `fi:migrations:v1:<owner>` and surfaced on `/api/ai/health` |
| Composition root | `fios/index.js` | `createFinancialIntelligence({stateStore, events, brain, ownerFor})` — ONE place every engine is assembled; sections come from the brain's state store; the autonomy executor is the brain's **unsigned** `swap/bridge.prepare` hand-off |
| API router | `fios/router.js` | `/api/ai/{health, world-state, financial-state, strategies, simulate, what-if, decision, decision/:id, decision/:id/evidence, trace/:id, policies, policies/stop, policies/:id{,/stop,/resume,/revoke}, autonomy, autonomy/run, guardian/{status,check}, replan, council{,/:id}, external-agents{,/:id{,/interaction,/authorize,/revoke}}, learning{,/calibration}, preferences{,/statement}}` — mounted after the command-center routes; `/agents` and `/status` stay the command center's |
| Client | `src/lib/financialIntelligence.js` | reuses the brain's device key (`fbt.central.device.v1`) so FI sees the SAME owner the brain has state for; fail-closed `{ok:false, code}` |
| Panel | `src/components/FinancialIntelligencePanel.jsx` | mounted in `IntentOS.jsx`; **WHY?** (reason + six confidence dimensions), **SHOW EVIDENCE** (linked bundle + stale/untrusted counts), **ALTERNATIVES** (losers with scores + vetoed rows and why), **STOP** (per-policy + stop-all, with a confirmation step) |
| Wiring | `server/app.js` | FI mounts under `/api/ai` after `centralIntelligence`; same budget, same `ownerFor`, one state store |

### Runtime verification (the part that was missing)

`test/fios/fios-api-probe.mjs` boots the REAL `server/app.js` over real HTTP
(loopback, ephemeral port) and drives it exactly like `central-os-probe`
drives the brain: upstream sources swapped through the documented
`setCiSource` seam, everything else production code. It proves:

- one state store — a `/api/brain` turn (and the brain's own
  `tools/read` calls) writes the sections; `/api/ai/financial-state` then
  answers with those numbers ($20,000 gross, $0 debt read, $20,000 net);
  before any turn the same route answers UNAVAILABLE, never zero;
- the full decision pipeline over HTTP: real strategies → competition →
  decision → council (six votes, persisted disagreement), and the decision,
  its evidence bundle and its trace are retrievable afterwards;
- the policy engine fail-closed: flag off → `FEATURE_DISABLED`; stopped
  policy → every run refused `EMERGENCY_STOP`; over the ceiling →
  `PER_EXECUTION_LIMIT`; a run produces the brain's **unsigned** hand-off and
  stops at `VERIFY`; only a verification id reaches `COMPLETED` and settles
  the spend on the policy row; `canSign` is false on every answer;
- routing hygiene: `/api/ai/agents` and `/api/ai/status` still belong to the
  command center; unknown ids are named 404s.

Probe scores: fios-core **156/156**, fios-autonomy **64/64**,
fios-intelligence **54/54**, fios-api **42/42** (each stable across
repeated runs). `npm test` runs all four as child processes.

### Two plan rows, honestly restated

The capability table above lists `fios/whatif.js`, `fios/modelRouter.js` and
`fios/security.js` as planned files. As shipped: what-if parsing/execution
lives in `fios/simulation.js` (`parseWhatIf`/`runWhatIf`); the model router
and the dedicated security module are NOT built — the security boundary is
the existing state-store redaction plus the raw-credential passport refusal
in `fios/agents.js`, and no FI route can sign anything.
