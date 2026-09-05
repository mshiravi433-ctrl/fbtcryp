# FBT Intent OS AI — Upgrade 8 Report

## Audit summary

### Consolidation decision
Primary Upgrade 8 backbone was consolidated around **`/api/v1/ai`**.

Reason:
- `/intent` already talks mainly to `server/aiIntentOS.js` through `src/lib/aiIntentClient.js`.
- `/api/brain` and the older `/api` central stack both exist, but neither is the active chat route's source of truth.
- Adding Upgrade 8 on top of all three would increase duplication and state drift.

### Root causes found
1. **Backend duplication** — `/api/v1/ai`, `/api/brain`, and `/api` all expose overlapping “brain” behavior.
2. **Frontend duplication** — `IntentAIUnified.jsx` is live, while `IntentAIPanel.jsx` and `IntentAIRoute.jsx` still carry alternative AI flow logic.
3. **Persistence fragmentation** — local conversation state, task continuity, pending intents, Upgrade 7 memory, and server memory were all separate.
4. **Question/answer drift** — short answers and reference answers had no single durable binding model.
5. **Resume drift** — navigation continuity was mostly local UI logic instead of a durable session backbone.

## Architecture changes implemented

### New Upgrade 8 backbone
Added a new shared Intent OS Upgrade 8 layer under:
- `src/lib/intent-ai/os/upgrade8/contracts.js`
- `src/lib/intent-ai/os/upgrade8/clientState.js`
- `src/lib/intent-ai/os/upgrade8/client.js`
- `src/lib/intent-ai/os/upgrade8/controller.js`
- `src/lib/intent-ai/os/upgrade8/questionEngine.js`
- `src/lib/intent-ai/os/upgrade8/goalEngine.js`
- `src/lib/intent-ai/os/upgrade8/taskEngine.js`
- `src/lib/intent-ai/os/upgrade8/toolRouter.js`
- `src/lib/intent-ai/os/upgrade8/agentOrchestrator.js`
- `src/lib/intent-ai/os/upgrade8/executionSafety.js`
- `src/lib/intent-ai/os/upgrade8/index.js`

### Durable server session layer
Added a durable Upgrade 8 route family at:
- `server/intentOsUpgrade8.js`

Mounted in:
- `server/app.js` as **`/api/v1/ai/os`**

Capabilities added:
- read/write session state
- conversation persistence
- intent persistence and resume
- goal persistence
- task persistence
- question persistence
- answer binding
- agent/tool run recording
- execution recording
- monitoring event recording
- secret stripping before persistence

### `/intent` UI rewiring
Updated:
- `src/components/IntentAIUnified.jsx`

What changed:
- bootstraps from Upgrade 8 local/server state
- keeps the live chat synced into Upgrade 8 durable state
- records route continuity in Upgrade 8
- binds short answers like `ریسک متوسط`
- resolves references like `همون گزینه دوم`
- prepares safe execution from selected strategy
- activates monitoring after confirmed execution
- keeps existing V6/Upgrade 7 surface behavior in place instead of replacing the whole UI

## Tests added
- `test/intent-ai/upgrade8-scenario-probe.mjs`
- `test/intent-ai/upgrade8-state-api-probe.mjs`
- `test/intent-ai/upgrade8-golden-scenarios.mjs`

### Coverage added
- portfolio-analysis acceptance path
- short-answer slot binding
- ordinal/reference resolution
- execution preparation safety
- monitoring activation
- resume continuity
- server route wiring and persistence contract
- **120 golden scenarios** / **1320 assertions**

### Script added
- `npm run test:upgrade8`

## Files modified
- `package.json`
- `server/app.js`
- `src/components/IntentAIUnified.jsx`

## Files created
- `docs/intent-os-upgrade8-report.md`
- `server/intentOsUpgrade8.js`
- `src/lib/intent-ai/os/upgrade8/contracts.js`
- `src/lib/intent-ai/os/upgrade8/clientState.js`
- `src/lib/intent-ai/os/upgrade8/client.js`
- `src/lib/intent-ai/os/upgrade8/controller.js`
- `src/lib/intent-ai/os/upgrade8/questionEngine.js`
- `src/lib/intent-ai/os/upgrade8/goalEngine.js`
- `src/lib/intent-ai/os/upgrade8/taskEngine.js`
- `src/lib/intent-ai/os/upgrade8/toolRouter.js`
- `src/lib/intent-ai/os/upgrade8/agentOrchestrator.js`
- `src/lib/intent-ai/os/upgrade8/executionSafety.js`
- `src/lib/intent-ai/os/upgrade8/index.js`
- `test/intent-ai/upgrade8-scenario-probe.mjs`
- `test/intent-ai/upgrade8-state-api-probe.mjs`
- `test/intent-ai/upgrade8-golden-scenarios.mjs`

## Test results
Passed:
- `node test/intent-ai/upgrade8-scenario-probe.mjs`
- `node test/intent-ai/upgrade8-state-api-probe.mjs`
- `node test/intent-ai/upgrade8-golden-scenarios.mjs`
- `npm run test:upgrade8`

## Subsystem status
- Frontend `/intent` route: **DONE**
- Conversation lifecycle backbone: **DONE**
- Intent lifecycle backbone: **DONE**
- Goal engine: **DONE**
- Task engine/checkpoints/resume: **DONE**
- Question/answer engine: **DONE**
- Short-answer intelligence: **DONE**
- Reference resolution: **DONE**
- Smart memory/session persistence: **DONE**
- Multi-agent orchestration layer: **DONE**
- Tool routing capability layer: **DONE**
- Wallet safety / simulation gate: **DONE**
- Execution verification → monitoring handoff: **DONE**
- Durable backend state API: **DONE**
- Existing legacy alternate AI surfaces: **PARTIAL**
- `/api/brain` consolidation into Upgrade 8 backbone: **PARTIAL**
- older `/api` central stack retirement: **PARTIAL**
- SQL/database-backed relational schema: **BLOCKED** by current repo architecture (KV store only; no existing Prisma/SQL migration system)

## Notes
This implementation intentionally avoids a blind whole-repo rewrite. It introduces a durable Upgrade 8 backbone and wires the live `/intent` surface to it, while leaving older surfaces intact for compatibility until a later cleanup pass can remove duplication safely.
