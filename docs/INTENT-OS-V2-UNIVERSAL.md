# FBT INTENT OS V2 — Universal AI Operating Agent

## Overview
Intent OS از یک Chatbot ساده به یک **AI Operating Layer واقعی برای کل FBT App و Website** تبدیل شد.

> کاربر فقط منظور خود را بگوید؛ AI باید منظور را بفهمد، Context را جمع کند، بهترین قابلیت/صفحه/پروتکل را پیدا کند، پیشنهاد مناسب بدهد و پس از تأیید کاربر، عملیات واقعی را تا پایان انجام دهد.

## Architecture Implemented

```
                    USER
                      │
                      ▼
                INTENT AI (V2)
                      │
              ┌───────┴───────┐
              ▼               ▼
        CONTEXT ENGINE    MEMORY ENGINE
              │               │
              └───────┬───────┘
                      ▼
               ORCHESTRATOR
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
      AGENTS         TOOLS       NAVIGATION
        │             │             │
        └─────────────┼─────────────┘
                      ▼
                  ACTION BUS
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
       WALLET      FINANCE       APP
          │           │            │
          ▼           ▼            ▼
     BLOCKCHAIN     PROTOCOLS    PAGES
          │           │            │
          └───────────┼────────────┘
                      ▼
                  VERIFIER
                      │
                      ▼
                    MEMORY
                      │
                      ▼
               HUMAN RESPONSE
```

## Implemented Modules (src/lib/intent-ai/os/)

### 1. App Capabilities Registry (appCapabilities.js)
- Registry کامل از قابلیت‌های FBT:
  Wallet, EVM Wallet, Solana Wallet, Portfolio, Swap, Bridge, Cross-Chain, Intent OS, Orders, Futures, Lending, Borrowing, Farming, Yield, Staking, Signals, Smart Money, Whale Tracking, Market, Tokens, Stocks, DCA, Rebalancing, Financial Goals, AI Agents, News, Explore, NFT, Gift Cards, SIM, Travel, Hotels, Settings, Notifications, Calm/Relaxation
- هر capability: id, actions, queries, route, events, category, requiresWallet
- Hierarchical grouping: wallet, portfolio, trading, defi, market, investment, content, commerce, system, media

### 2. Universal Tool Registry (toolRegistry.js)
```typescript
interface AITool {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  inputSchema: object;
  execute: Function;
  readOnly: boolean;
  requiresWallet: boolean;
  requiresConfirmation: boolean;
  supportedChains?: string[];
  route?: string;
}
```
- Tools: wallet.getBalances, wallet.getPortfolio, swap.quote, swap.execute, bridge.quote, bridge.execute, send.execute, yield.discover, farming.list, lending.markets, market.overview, signals.list, smartMoney.track, whale.track, dca.create, portfolio.rebalance, goals.create, news.search, navigation.open, calm.play, etc.
- **Hierarchical & Dynamic**: `resolveToolsForIntent()` — فقط Toolهای مرتبط Load می‌شوند. مثلا "برای ETH سرمایه‌گذاری" → Investment → Portfolio, Yield, Market, Signals, DCA, Swap
- Validation: `validateToolInput()` — اگر Tool موجود نیست → "این قابلیت در حال حاضر در دسترس نیست" — no hallucination

### 3. Intent Understanding (intentUnderstanding.js)
- Extract real intent:
  - "ببین چرا پرتفوی من امروز افت کرده" → PORTFOLIO_ANALYSIS, MARKET_ANALYSIS, RISK_ANALYSIS
  - "100 دلارم را جایی بگذار که سود بیشتری بدهد" → YIELD_DISCOVERY, RISK_ANALYSIS, PORTFOLIO_CONTEXT
  - "اخبار امروز کریپتو را ببین" → NEWS_SEARCH, MARKET_CONTEXT
  - "یه آهنگ آرامش‌بخش بذار" → OPEN_CALM, PLAY_MUSIC
- Persian + English patterns, entity extraction (amounts, tokens, chains, risk)
- Navigation extraction: "اخبار را باز کن" → route /news
- **Acceptance Tests: 17/17 PASS**

### 4. Context Engine (contextEngine.js)
```typescript
const context = await contextEngine.build({
  userId, sessionId, currentPage, currentRoute, walletState, portfolioState, conversation, memory
});
```
- Includes: Current Page, Tab, Wallet, Balances, Portfolio, Connected Chains, Recent Actions, Preferences, Goals, Conversation, History
- Performance: Parallel reads (`Promise.all`), Lazy Context, Caching (30s TTL), Event-driven Updates
- Current Page Awareness: `getCurrentPageContext()` — "این را اجرا کن" refers to current page action

### 5. Navigation Agent (agents/navigationAgent.js)
- `navigate({ route: "/news" })` — no confirmation needed
- Persian aliases: اخبار, فارم, کیف پول, پرتفوی, بازار, etc.
- Handles: "اخبار را باز کن", "صفحه فارم را باز کن", "کیف پولم را باز کن"

### 6. Media Control (agents/mediaAgent.js)
- Flow: OPEN_CALM → GET_RECOMMENDED_TRACK → PLAY
- `navigate("/calm"); playMusic({ category: "relaxation" });`
- Mood detection: relax, focus, sleep, meditation

### 7. Memory System (memoryEngine.js)
- Three types:
  - Working Memory: همین مکالمه (20)
  - Session Memory: کارهای همین Session (50)
  - Long-Term Memory: ترجیحات, اهداف, تصمیمات, رفتارها, تاریخچه Action (200)
- Schema:
```typescript
interface AIMemory {
  id, userId, type: preference|goal|decision|action|conversation|behavior,
  content, importance, confidence, createdAt, updatedAt, expiresAt
}
```
- Retrieval-based: `searchMemory({ query, topK: 8 })` — only relevant memory in context
- Conflict resolution: newer/higher confidence wins
- Learning: Interaction → Outcome → Evaluation → Memory → Preference

### 8. Action Memory (actionMemory.js)
- Every real action stored: intent, tools, inputs, result, status, duration, timestamp
- Sanitized: no private keys, seed phrases

### 9. Agent Loop (agentLoop.js)
```
PERCEIVE → UNDERSTAND → PLAN → ACT → OBSERVE → VERIFY → CONTINUE → COMPLETE
```
- Real agent, not chatbot
- Trace, iteration, self-healing, verification

### 10. Multi-Agent Orchestrator (orchestrator.js)
- Specialist agents:
  Intent Agent, Portfolio Agent, Market Agent, Trading Agent, Wallet Agent, Yield Agent, Research Agent, Navigation Agent, Media Agent, Risk Agent, Execution Agent, Verification Agent
- But user sees only **Intent AI**
- Example flow for "بهترین راه برای سرمایه‌گذاری 1000 دلارم":
  Intent Agent → Portfolio Agent → Market Agent → Yield Agent → Risk Agent → Research Agent → Strategy → Intent AI (unified response)

### 11. Dynamic Suggestions (suggestionEngine.js)
- **Removed static** Swap, Bridge, Send, Goal, Analysis for all users
- Contextual:
  - "سود بیشتری می‌خواهم" → Yieldهای مناسب, DCA, Portfolio Rebalance, Risk/Return
  - "ETH می‌خواهم" → Buy ETH, Swap, Cross-chain, DCA ETH, ETH Analysis
  - "بازار را بررسی کن" → Market Overview, Smart Money, Whale Activity, Signals, Top Movers
- Based on currentPage, intentType, entities

### 12. Financial Agent (financialAgent.js)
```
Goal → Portfolio → Risk → Market → Liquidity → Yield → Strategy → Execution
```
- First reads Portfolio, then suggests — no blind swap

### 13. Universal Wallet Context (agents/walletAgent.js)
- EVM, Solana, Balances, Tokens, NFT, Positions, LP, Farms, Lending, Borrowing, Orders, Futures
- Real services

### 14. Cross-App Action Bus & Event Bus (eventBus.js)
```typescript
interface AIEvent { type, source, payload, timestamp }
```
- Events: wallet.connected, swap.completed, bridge.completed, portfolio.updated, order.created, farm.updated, news.opened, music.played, etc.
- Action Bus: `await actionBus.dispatch({ action: "wallet.getBalance", input: {...} })`
- Global bus via window CustomEvents

### 15. Security (security.js)
- AI never sees Private Key, Seed Phrase, Recovery Phrase, Raw Secret
- Only Wallet Address, Balance, Public Position
- Signature always by wallet
- Forbidden keys detection, sanitization

### 16. Human Response (humanResponse.js)
- Never show internal: PORTFOLIO, Prepared 1 action(s), tool_call, action_id, internal_state, executor, router_state
- Instead: "پرتفوی شما را بررسی کردم و یک برنامه مناسب پیدا کردم."

### 17. Confirmation (in orchestrator + IntentAIUnified)
- Financial: Intent → Plan → Quote → ONE Confirmation → Wallet Signature → Execution → Verification
- Navigation / Music / Read-only: Intent → Action → Execute (no confirmation)

### 18. Task Continuity (taskContinuity.js)
- Task ID, State, Pending Action, Resume
- If user leaves and returns: "Resume active task?" + context restore

### 19. Verification Agent (agents/executionAgent.js)
- After each important action: Execution → Verification Agent → Actual Result → Compare Expected vs Actual
- Example: Expected 100 USDC → ETH, Actual 99.21 USDC → ETH, Status CONFIRMED

### 20. Self-Healing
- Tool Failed → Diagnose → Retry if safe → Alternative Tool → Re-plan → Continue
- No blind retry for financial transactions

### 21. Observability (observability.js)
- For each Task: taskId, intent, tools, latency, status, errors, retries, provider, result
- Never store private keys
- Stats: total, byStatus, byIntent, avgLatency

### 22. AI Dashboard Internal (debugDashboard.js)
- For Developer/Admin debug view: Intent, Context, Selected Agent, Selected Tools, Execution Graph, Memory Used, API Calls, Latency, Errors, Final Result
- Hidden from user, accessible via triple-click on header or ?debug
- `window.__FBT_INTENT_OS_DEBUG__`

### 23. Performance (performance.js)
- Lazy Context, Tool Routing, Caching, Parallel Reads, Event-driven Updates, Memory Retrieval
- Example:
```typescript
const [wallet, portfolio, market] = await Promise.all([
  walletService.getContext(),
  portfolioService.getSummary(),
  marketService.getRelevantData()
]);
```

## IntentAIUnified V2 Changes

### Removed Static ACTION_ITEMS (Spec §17)
Old:
```javascript
const ACTION_ITEMS = [Swap, Bridge, Send, Buy, Sell, Futures, Farm, Lending, Goal, DCA, Portfolio] // for all users
```

New:
- Dynamic `drawerItems` based on `currentPage` and last intent via `getSuggestionsForMessage()`
- Suggestions bar uses `getSuggestionsForIntent()` — contextual, not static

### Current Page Awareness (Spec §7)
- Uses `useLocation()` to get `currentPage`
- `getCurrentPageContext()` maps route to page capability
- Follow-up "این را اجرا کن" refers to current page action
- OS process receives `currentPage` in context

### Local-First OS Processing
1. Try local Intent OS `intentOS.process()` for:
   - NAVIGATION, NEWS_SEARCH, OPEN_CALM, PLAY_MUSIC, PORTFOLIO_ANALYSIS, WALLET_BALANCE, MARKET_ANALYSIS, SMART_MONEY, WHALE, read-only
   - No server needed, instant response
2. For financial (SWAP, BRIDGE, SEND, BUY, SELL, DCA, GOAL, REBALANCE) — needs confirmation:
   - Local OS builds plan
   - Then server `aiChat` + `aiExecute` for quote + wallet signature + verification
   - Preserves security: wallet signs, server never holds keys

### Multi-Agent But Single UI
- User sees only Intent AI
- Orchestrator selects: Intent → Portfolio → Market → Yield → Risk → Research → etc.
- Final response unified

### Memory Integration
- `searchMemory({ query, topK: 8 })` before each response
- Preference extraction: "من معمولاً ریسک متوسط می‌خواهم" → saved as long-term memory
- Future "برایم سرمایه‌گذاری پیدا کن" → uses medium risk preference

### Task Continuity
- `getLastActiveTask()` — if pending within 30min, offers resume

### Observability & Debug
- `logTask()` for every task
- Debug dashboard hidden, triple-click header to toggle

## Acceptance Tests (Spec §40) — 17/17 PASS

```
"اخبار را باز کن" → NEWS_SEARCH → Context → navigate("/news") → Execute → Verify
"صفحه فارم را باز کن" → FARM → navigate("/farm")
"کیف پولم را باز کن" → NAVIGATION → navigate("/wallet")
"یک آهنگ آرامش‌بخش پخش کن" → PLAY_MUSIC → OPEN_CALM → PLAY
"موجودی من را بررسی کن" → WALLET_BALANCE → wallet.getBalances → Response
"پرتفوی من را تحلیل کن" → PORTFOLIO_ANALYSIS → portfolio.analyze → Response
"بهترین فرصت سرمایه‌گذاری را پیدا کن" → INVESTMENT_PLAN → Portfolio→Market→Yield→Risk→Strategy
"100 USDC را به ETH تبدیل کن" → SWAP → swap.quote → Confirmation → Execution
"پرتفوی من را متعادل کن" → REBALANCE → rebalance.plan → Confirmation
"بهترین Yield را پیدا کن" → YIELD_DISCOVERY → yield.discover
"Smart Money را بررسی کن" → SMART_MONEY → smartMoney.track
"ببین نهنگ‌ها چه می‌خرند" → WHALE → whale.track
"برای هدف سه ساله‌ام برنامه بساز" → GOAL → goals.create
"همان کاری که گفتیم را ادامه بده" → CONTINUE → resumeTask
"این را اجرا کن" → EXECUTE_CURRENT → current page action
"لغوش کن" → CANCEL → cancel task
"جزئیاتش را بیشتر بررسی کن" → DETAILS → more analysis
```

Each follows:
```
UNDERSTAND → CONTEXT → PLAN → TOOL → ACTION → VERIFY → MEMORY → RESPONSE
```

## Security Compliance (Spec §37)
- No Private Key, Seed Phrase, Recovery Phrase, Raw Secret in AI
- Only Address, Balance, Public Position
- Wallet signature always
- `sanitizeForAI()` + `assertNoSecrets()`

## Performance (Spec §36)
- Build: 5600 modules, 33.5s, chunks optimized
- Lazy context, parallel reads, caching, event-driven

## Final Architecture (Spec §38) Implemented
See top diagram — matches spec exactly.

## Deployment

- Build passes: `npm run build` ✓
- Acceptance tests: 17/17 ✓
- No mock — wired to real APIs: walletService, portfolioService, marketService, newsService, swap, bridge, etc.
- App API Contract respected
- No hallucination — schema validation

## Branch Merge

- Developed on `arena/01a05cc0-fbtcryp`
- Merged to `main` for live deployment
- Live preview: Intent AI chat now handles natural language for any part of app, from "اخبار را باز کن" to "پرتفوی من را بررسی کن و بهترین مسیر را پیشنهاد بده و بعد از تأیید اجرا کن"

## Most Important Law (Spec §39)

Intent OS نباید فقط بگوید:
> "چه کاری می‌توانم برایتان انجام دهم؟"

باید **بفهمد، Context بگیرد، تصمیم بگیرد، ابزار درست را انتخاب کند، اقدام کند و نتیجه واقعی را بررسی کند.**

✅ Implemented in `createIntentOS().process()` — full loop.

---

**FBT Intent OS V2 = AI Brain + Memory + Context + Tools + Agents + App Control + Wallet + Protocols + Execution + Verification**

کاربر تقریباً با هر جمله طبیعی، هر قسمت مرتبط اپ را کنترل می‌کند.
