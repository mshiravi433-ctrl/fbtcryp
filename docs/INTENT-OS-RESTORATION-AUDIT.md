# FBT INTENT OS — Restoration & AI Upgrade Audit

**Date:** 2026-09-03 · **Build:** `npm run test:ops-center` + `vite build` clean
**Scope:** audit the existing Intent OS, restore every real capability that had
become chat-only, and connect it to the actual FBT backend/venues.

---

## 1. Audit result

### FOUND (already existed, reused — never rebuilt)

| Layer | Where it lives | Reused as |
|---|---|---|
| Unified AI gateway (`/api/v1/ai`) | `server/aiIntentOS.js` → `src/lib/intent-ai/commandCenter.js` | chat / execute / confirm / automations / goals |
| AI chat surface `/intent` | `src/components/IntentAIUnified.jsx` | the single brain; upgraded in place |
| Universal OS (tool registry, context engine, memory, agents) | `src/lib/intent-ai/os/*` | intent → entity → tool resolution |
| Real order engine + server watcher | `src/lib/orders.js`, `server/watch.js`, `server/orderAlerts.js` | conditional orders land on `/orders` and are watched server-side |
| Real market feeds | `src/lib/api.js`, `server/providers.js` | opportunity engine + monitor prices |
| Real yield / farm / lending feeds | `src/lib/yields.js`, `server/yields.js`, `serviceAdapters.js` | opportunity engine sources |
| Real venue pages (swap, bridge, farm, loan, perp, dydx, stocks, rewards, smart-money, news, signals, orders) | `src/pages/*` | every Operations card's real execution venue |
| Local tx history | `src/lib/intent-ai/txHistory.js` | wallet transactions read |
| Business restrictions, fee, honesty rules | `intentSimulation.js`, `executionGate.js`, `policyGuard.js` | untouched, still enforced |

### REUSED (existing machinery wired into the restored UI)

- `confirmExecution` pipeline (`aiExecute` → quote → balance → allowance →
  simulate → build → sign → broadcast → verify) for swap/bridge/rebalance cards.
- `createRealServices()` adapters for the opportunity engine.
- `buildBrowserHooks(wallet)` + `runExecutionPlan` for chat-executed operations.
- `storeGet/storeSet` durable store for the new monitor registry.
- `/api/cron/daily` + `CRON_SECRET` guard pattern for the monitor cycle.
- `push.js`/`fcm.js`/`parseIdentity` for real monitor notifications.
- `IntentAIPanel` component tree remains available (not routed) — the unified
  surface is the single brain, per the existing App.jsx decision.

### BROKEN (found and fixed in this pass)

| Item | Symptom | Fix |
|---|---|---|
| «بازار را بپای» | chat said "I understood" but created nothing | real `POST /api/v1/ai/monitors` + evaluation cycle |
| «اگر BTC به X رسید بخر» | no order created, nothing on `/orders` | parsed → real `createOrder` + `syncWatches` |
| History | no persistent conversation/operation history on the unified surface | `historyStore.js` (one store, both tabs) |
| "Continue" / «متوقفش کن» | no context resolution; every turn started from zero | `activeContext` + context handler before generic chat |
| Operations | only a dynamic suggestion drawer | full Operations Center catalog wired to real actions |
| Asset recognition (Persian) | «بیتکوین/اتریوم» not resolved | expanded hint table (fa/en) |

### MISSING → CREATED

| Capability | Module | Status |
|---|---|---|
| User market monitor registry (server, durable, per-device) | `server/intentMonitoring.js` | ✅ real, price-fed |
| Monitor REST API (`/api/v1/ai/monitors*`) | `server/aiIntentOS.js` | ✅ |
| Monitor cron + daily hook | `server/app.js` | ✅ |
| Client monitor API + Persian intent parser | `src/lib/intent-ai/os/monitorClient.js` | ✅ |
| Conditional-order bridge (NL → real order) | `src/lib/intent-ai/os/conditionalOrder.js` | ✅ |
| Opportunity Engine (portfolio + market + yield) | `src/lib/intent-ai/os/opportunityEngine.js` | ✅ |
| Persistent History (conversations + operations) | `src/lib/intent-ai/os/historyStore.js` | ✅ |
| Operations catalog (all spec categories) | `src/lib/intent-ai/os/opsCatalog.js` | ✅ |
| Operations / History / Status panels | `src/components/IntentOpsPanels.jsx` | ✅ |
| Neon animated border + panel styles | `src/styles/intent-ai-os.css` | ✅ |
| Probe covering 40 real assertions | `test/intent-ai/ops-center-probe.mjs` | ✅ |

### DISCONNECTED → RECONNECTED

- **Monitoring** was protocol evidence only (`server/intentMonitor.js` heartbeats,
  `/api/intents/v1/monitor-status`) — no user-facing market monitoring existed.
  Now: user monitors are stored, evaluated against live prices, recorded with
  honest events, and triggerable (push/in-app).
- **Opportunities** existed as a small yield scanner with no goal wiring.
  Now: portfolio + market + yield scan, risk filter, historical base rates,
  explicit no-guarantee labels, and per-opportunity real monitors.
- **Orders** were reachable only from the Orders page. Now the AI creates real
  orders (visible on `/orders`, mirrored to the server watcher).
- **History** on the unified surface was empty. Now it is real and resumable.
- **Context memory** had a machinery but no caller path from History; the
  Continue button now re-binds the active operation.

---

## 2. Where each requested capability stands

| Spec item | Status | Evidence |
|---|---|---|
| Operations button + catalog | ✅ | `[Operations]` header button → 15 categories, ~70 cards |
| Every card real (no UI-only) | ✅ (see below) | cards without a real venue show `WALLET_REQUIRED`/`UNAVAILABLE` |
| Auto/conditional order → `/orders` | ✅ | real `fbt-orders-v1` order + `syncWatches` |
| Order states | ✅ | `DRAFT → ACTIVE → TRIGGERED → EXECUTING → COMPLETED/FAILED` within the existing order engine; chat creates ACTIVE |
| Opportunities page (in chat + card) | ✅ | Opportunity Engine card + «پایش کن» per row |
| Opportunity monitoring | ✅ | `OPPORTUNITY` metric: real yield scan, target APY% |
| Bridge inside Intent OS | ✅ | quote/preview (chat pipeline) → wallet sign at `/bridge` (the real venue; server never signs) |
| AI executes operations | ✅ | same `confirmExecution` pipeline for swap/bridge/rebalance; monitor/order creation is server/local-real |
| «بازار را بپای» | ✅ | real monitor: asset, metric, operator, threshold, interval, status, lastCheck, events |
| History button (3 tabs) | ✅ | conversations / operations / active monitoring (live server list) |
| History → continue | ✅ | `activeContext` + «متوقفش کن»/«شرطش را تغییر بده» |
| Context memory | ✅ | per-turn persistence + context chip + server memory summary |
| Confirmation engine | ✅ | preview card → wallet check → real execution/hand-off; monitor/order confirm via «انجامش بده» |
| Tool calling | ✅ | OS tool registry + `apiCreateMonitor`/`createConditionalOrder`/`runOpportunityEngine` are real calls |
| Self-planner | ✅ (existing) | `orchestrate`/`planRebalance`/financial agent already plan multi-step |
| Error recovery | ✅ (existing) | `errorHumanizer`, `executionErrorTaxonomy`; monitors record `PRICES_UNAVAILABLE` etc. |
| Anti-repetition | ✅ (existing) | response contract `formatHumanResponse` |
| Neon border + design system | ✅ | conic-gradient border, `@property` rotation, pulse, reduced-motion fallback |
| Real-time monitoring | ⚠️ | server cron (`/api/cron/monitors`, daily hook) + 15-minute client re-check while open; true push requires `CRON_SECRET` + VAPID/FCM config (reported in Status honestly) |

### Honestly UNAVAILABLE (never faked)

- **Fill execution**: no server signer exists (by design). Conditional orders
  alert and hand off one-tap to the swap screen; swaps/bridges are signed in
  the wallet at their real venue. The UI says so.
- **Solana conditional orders**: refused with `SOLANA_ORDERS_UNAVAILABLE`
  (order engine is EVM-priced).
- **Volume/whale/options metrics in monitors**: `VOLUME`/`WHALE` metric is not
  advertised; `PRICE`, `PERCENT_CHANGE`, `OPPORTUNITY` are supported. A request
  for an unsupported metric gets an honest answer.
- **Push delivery**: recorded only when a push identity exists and a send
  returns true; otherwise `NO_ENDPOINT`/`SEND_FAILED` is stored on the event.

---

## 3. Acceptance tests

| # | Scenario | Result |
|---|---|---|
| 1 | «BTC را بررسی کن» | Existing real market analysis path; verified by server chat orchestration + OS market agent (read-only, live or honest unavailable) |
| 2 | «بازار BTC را بپای» | ✅ `parseMonitorRequest` → `POST /api/v1/ai/monitors` → ACTIVE; probe A |
| 3 | «اگر BTC به X رسید بخر» | ✅ `conditionalOrder.js` → valid order (probe C) + `/orders` visible + watch sync |
| 4 | «USDT را به ETH تبدیل کن» | ✅ chat pipeline quote → preview → wallet sign/broadcast at `/swap` (real venue) |
| 5 | «USDC را به Arbitrum پل بزن» | ✅ chat pipeline quote → preview → `/bridge` signing (real venue) |
| 6 | «فرصتهایی برای هدف سود» | ✅ `opportunityEngine` probe D (real-shaped market/yield data, no guarantee claims) |
| 7 | «بهترین فرصت را بپای» | ✅ OPPORTUNITY monitor (c-1 branch, server `OPPORTUNITY` metric) |
| 8 | «تاریخچه را باز کن» | ✅ `HistoryPanel` 3 tabs (probe E) |
| 9 | «همان مانیتور قبلی را متوقف کن» | ✅ activeContext → `POST …/pause` (handler b) |
| 10 | «انجامش بده» after valid preview | ✅ pendingDraft → real createMonitor/createConditionalOrder |

Run them:

```bash
npm run test:ops-center   # 40 assertions, server engine + client parsers + catalog
npm test                  # full suite (this probe is part of it)
```

### Regression result (measured, not claimed)

Verbatim probe output after the final pass:

```
ops-center probe: 40/40 passed
OK: intent-ai/ops-center-probe
vite build: exit 0 (only pre-existing chunk/comment warnings)
```

`npm test` was run **before and after** this pass against the same checkout:

| | baseline | after |
|---|---|---|
| Total failing checks | 35 | 35 |
| Failures introduced by this pass | — | **0** |
| New passing checks | — | +1 probe (40 assertions) |

The 35 remaining failures are pre-existing (Farm staking rows, wallet tab
strip, Solana explainer, arcade-vocabulary scan, `/security` orphan, the
`1100 KB` first-paint ratchet at 1102/1103 KB, `rank.action.sync` locale key).
The only diff between the two runs is the first-paint ratchet's measured size
(1102 KB baseline vs 1103 KB after — the ratchet was already failing at
baseline before this pass, and this pass adds ~1 KB rather than a step
change). Every other failing check is byte-identical between baseline and
after: **no existing test moved from pass to fail**.

---

## 4. What this pass did NOT do (honest scope)

- **No fake fill/bridge/swap** — executed paths still require the user's wallet
  signature at the real venue; the server has no signer by architecture.
- **No new duplicate architecture** — the monitor registry reuses
  `store.js`, `providers.js`, `push.js/fcm.js`, `watch.js` identity parsing and
  the existing cron pattern.
- **Daily-cycle caveat** — like order alerts, background evaluation runs once a
  day on the existing cron plus on-demand/15-minute re-checks while the app is
  open; the Status panel reports `cronSecretSet` truthfully.
