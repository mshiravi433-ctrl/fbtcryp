# FBT INTENT OS — Universal AI Operating Agent

## خلاصه
Intent OS از یک Chatbot ساده به یک **AI Operating Layer واقعی برای کل FBT App و Website** تبدیل شد.

> کاربر فقط منظور خود را بگوید؛ AI باید منظور را بفهمد، Context را جمع کند، بهترین قابلیت/صفحه/پروتکل را پیدا کند، پیشنهاد مناسب بدهد و پس از تأیید کاربر، عملیات واقعی را تا پایان انجام دهد.

---

## 1. AI کل اپ را می‌شناسد

Registry کامل از قابلیت‌های FBT در `src/lib/intent-ai/os/appCapabilities.js`:

- Wallet, EVM Wallet, Solana Wallet
- Portfolio, Swap, Bridge, Cross-Chain
- Intent OS, Orders, Futures, Lending, Borrowing, Farming, Yield, Staking
- Signals, Smart Money, Whale Tracking, Market, Tokens, Stocks
- DCA, Rebalancing, Financial Goals, AI Agents
- News, Explore, NFT, Gift Cards, SIM, Travel, Hotels
- Settings, Notifications, Calm / Relaxation

هر capability دارای:
```typescript
interface AppCapability {
  id: string;
  actions: string[];
  queries: string[];
  route?: string;
  events?: string[];
}
```

---

## 2. Universal Tool Registry

`src/lib/intent-ai/os/toolRegistry.js`:

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

- همه Toolها Schema معتبر دارند (Spec §24)
- اگر Tool موجود نیست: "این قابلیت در حال حاضر در دسترس نیست"
- هیچ Endpoint یا پارامتر hallucinate نمی‌شود

---

## 3. Hierarchical & Dynamic Tool Loading

AI تمام Toolها را همزمان نمی‌بیند:

```
User: "برای ETH سرمایه‌گذاری می‌خواهم"
  ↓
Investment
  ↓
Portfolio, Yield, Market, Signals, DCA, Swap
```

فقط Toolهای مرتبط Load می‌شوند — جلوگیری از Tool Sprawl.

تابع `resolveToolsForIntent(intentType, context)` فقط ابزارهای مرتبط با Intent را برمی‌گرداند.

---

## 4. Intent Understanding

`src/lib/intent-ai/os/intentUnderstanding.js`:

- "ببین چرا پرتفوی من امروز افت کرده" → PORTFOLIO_ANALYSIS + MARKET_ANALYSIS + RISK_ANALYSIS
- "100 دلارم را جایی بگذار که سود بیشتری بدهد" → YIELD_DISCOVERY + RISK_ANALYSIS + PORTFOLIO_CONTEXT
- "اخبار امروز کریپتو را ببین" → NEWS_SEARCH + MARKET_CONTEXT
- "یه آهنگ آرامش‌بخش بذار" → OPEN_CALM + PLAY_MUSIC

AI همه چیز را Financial Intent فرض نمی‌کند.

---

## 5. Intent → Action Pipeline

```
User Intent
↓
Understand
↓
Retrieve Context
↓
Select Tools
↓
Plan
↓
Execute
↓
Observe
↓
Continue
↓
Complete
```

این یک Agent واقعی است، نه فقط پاسخ متنی.

---

## 6. Context Engine

`src/lib/intent-ai/os/contextEngine.js`:

```typescript
const context = await contextEngine.build({
  userId,
  sessionId,
  currentPage,
  currentRoute,
  walletState,
  portfolioState,
  conversation,
  memory
});
```

شامل:
- Current Page, Current Tab, Wallet, Balances, Portfolio, Connected Chains
- Recent Actions, Pending Actions, User Preferences, Previous Decisions
- Active Goals, Current Conversation, Relevant History

Performance: Lazy Context, Parallel Reads, Caching, Event-driven.

```typescript
const [wallet, portfolio, market] = await Promise.all([
  walletService.getContext(),
  portfolioService.getSummary(),
  marketService.getRelevantData()
]);
```

---

## 7. Current Page Awareness

AI می‌داند کاربر الان کجاست:

- اگر `currentPage = "/intent"` و کاربر گفت "این را اجرا کن" → Action فعلی صفحه
- اگر `currentPage = "/bridge"` و گفت "همین را انجام بده" → Bridge Plan فعلی

تابع `isFollowUpToCurrentPage` تشخیص می‌دهد "این" به چی اشاره دارد.

---

## 8. Navigation Agent

`src/lib/intent-ai/os/agents/navigationAgent.js`:

```typescript
navigate({ route: "/news" });
navigate({ route: "/farm" });
navigate({ route: "/wallet" });
```

نیاز به Confirmation ندارد (Spec §26).

---

## 9. Media Control

`src/lib/intent-ai/os/agents/mediaAgent.js`:

```
OPEN_CALM → GET_RECOMMENDED_TRACK → PLAY
```

```typescript
navigate("/calm");
playMusic({ category: "relaxation" });
```

پاسخ: "حتماً، یک موسیقی آرامش‌بخش برایت پخش کردم."

---

## 10. Memory System

`src/lib/intent-ai/os/memoryEngine.js`:

- **Working Memory**: همین مکالمه
- **Session Memory**: کارهای همین Session
- **Long-Term Memory**: ترجیحات، اهداف، تصمیمات، رفتارهای تکرارشونده

Retrieval-based، نه اینکه کل تاریخچه همیشه داخل Prompt قرار بگیرد.

---

## 11. Memory Schema

```typescript
interface AIMemory {
  id: string;
  userId: string;
  type: "preference" | "goal" | "decision" | "action" | "conversation" | "behavior";
  content: string;
  importance: number;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
```

---

## 12. استفاده از گذشته

کاربر قبلاً: "من معمولاً ریسک متوسط می‌خواهم."
بعداً: "برایم یک سرمایه‌گذاری پیدا کن."

AI Preference قبلی را در نظر می‌گیرد.

Memoryهای متناقض با نسخه جدیدتر/اطمینان بالاتر حل می‌شوند (conflict resolution).

---

## 13. Action Memory

`src/lib/intent-ai/os/actionMemory.js`:

```typescript
interface AIActionMemory {
  intent;
  tools;
  inputs;
  result;
  status;
  duration;
  timestamp;
}
```

مثال: `100 USDC → ETH, Successful, Base → Ethereum, LI.FI`

---

## 14. Agent Loop

`src/lib/intent-ai/os/agentLoop.js`:

```
PERCEIVE → UNDERSTAND → PLAN → ACT → OBSERVE → VERIFY → CONTINUE → COMPLETE
```

```typescript
while (!task.completed) {
  const decision = await agent.decide(context);
  const result = await toolExecutor.execute(decision.tool);
  context = await contextEngine.update(context, result);
  if (await verifier.isComplete(context)) break;
}
```

تفاوت اصلی Agent واقعی با Chatbot.

---

## 15. Multi-Agent

`src/lib/intent-ai/os/agents/`:

- Intent Agent
- Portfolio Agent
- Market Agent
- Trading Agent
- Wallet Agent
- Yield Agent
- Research Agent
- Navigation Agent
- Media Agent
- Risk Agent
- Execution Agent
- Verification Agent
- Financial Agent
- Proactive Agent

اما کاربر فقط یک AI می‌بیند: **Intent AI**

Orchestrator پشت صحنه Agent مناسب را انتخاب می‌کند.

---

## 16. مثال Multi-Agent

User: "بهترین راه برای سرمایه‌گذاری 1000 دلارم را پیدا کن."

```
Intent Agent
↓
Portfolio Agent
↓
Market Agent
↓
Yield Agent
↓
Risk Agent
↓
Research Agent
↓
Strategy Agent
↓
Intent AI
```

پاسخ نهایی یکپارچه.

---

## 17. پیشنهادات Dynamic

UI قدیمی حذف شد:
```
Swap, Bridge, Send, Goal, Analysis
```

پیشنهادات حالا Contextual:

- اگر گفت "سود بیشتری می‌خواهم" → Yieldهای مناسب, DCA, Rebalance, Risk/Return
- اگر گفت "ETH می‌خواهم" → Buy ETH, Swap, Cross-chain, DCA ETH, ETH Analysis
- اگر گفت "بازار را بررسی کن" → Market Overview, Smart Money, Whale Activity, Signals, Top Movers

`src/lib/intent-ai/os/suggestionEngine.js`

---

## 18. Proactive

`src/lib/intent-ai/os/proactiveAgent.js`:

اگر Goal فعال دارد: "Grow portfolio" و شرایط بازار تغییر کرد → "Opportunity detected"

اما **پیشنهاد ≠ اجرای خودکار**

اجرای مالی واقعی فقط با Confirmation.

---

## 19. Financial Agent

`src/lib/intent-ai/os/financialAgent.js`:

```
Goal → Portfolio → Risk → Market → Liquidity → Yield → Strategy → Execution
```

مثلاً "سرمایه‌ام را بهتر مدیریت کن" → اول Portfolio را می‌خواند، بعد پیشنهاد می‌دهد؛ نه کورکورانه Swap.

---

## 20. Universal Wallet Context

`src/lib/intent-ai/os/walletContext.js`:

- EVM, Solana, Balances, Tokens, NFT
- Positions, LP, Farms, Lending, Borrowing, Orders, Futures

از سرویس‌های واقعی اپ می‌خواند (Mock نیست).

---

## 21. Cross-App Action Bus

`src/lib/intent-ai/os/eventBus.js`:

```typescript
interface AIEvent {
  type: string;
  source: string;
  payload: unknown;
  timestamp: number;
}
```

Events:
- wallet.connected, wallet.disconnected
- swap.completed, bridge.completed
- portfolio.updated, order.created, farm.updated
- news.opened, music.played

---

## 22. Action Bus

همه عملیات AI از Action Bus عبور می‌کنند:

```typescript
await actionBus.dispatch({
  action: "wallet.getBalance",
  input: {...}
});

await actionBus.dispatch({
  action: "navigation.open",
  input: { route: "/news" }
});

await actionBus.dispatch({
  action: "calm.play",
  input: { mood: "relax" }
});
```

---

## 23. App API Contract

هر بخش API Contract دارد — در `appCapabilities.js` تعریف شده.

---

## 24. No Hallucination

```
Tool Registry → Schema → Validation → Execution
```

اگر Tool موجود نیست: "این قابلیت در حال حاضر در دسترس نیست."

---

## 25. Human Response

هرگز به کاربر نشان نده:
- PORTFOLIO, Prepared 1 action(s), tool_call, action_id, internal_state, etc.

به‌جایش: "پرتفوی شما را بررسی کردم و یک برنامه مناسب پیدا کردم."

`src/lib/intent-ai/os/humanResponse.js` با `stripInternalLeaks`.

---

## 26. Confirmation

برای عملیات مالی:
```
Intent → Plan → Quote → ONE Confirmation → Wallet Signature → Execution → Verification
```

برای Navigation / Music / Read-only:
```
Intent → Action → Execute
```

بدون Confirmation اضافی.

---

## 27. Navigation Examples

- "اخبار را باز کن" → navigate("/news")
- "صفحه Smart Money را باز کن" → navigate("/smart-money")
- "صفحه Bridge را باز کن" → navigate("/bridge")
- "آرامش را باز کن و موسیقی پخش کن" → navigate("/calm"); playMusic({ mood: "relaxation" })

---

## 28. Contextual Follow-up

اگر AI همین الان Bridge ساخته و User گفت "اجراش کن" → منظور همان Bridge Plan فعلی است.

نباید بپرسد "چه چیزی را اجرا کنم؟"

---

## 29. Task Continuity

```
Task ID → State → Pending Action → Resume
```

اگر کاربر از صفحه خارج شد و برگشت: "Resume active task?" و Context بازیابی شود.

`src/lib/intent-ai/os/taskContinuity.js`

---

## 30. Memory Retrieval

قبل از هر پاسخ:
```typescript
const memories = await memory.search({
  userId,
  query: currentIntent,
  topK: 8
});
```

فقط Memory مرتبط وارد Context شود.

---

## 31. Learning

```
Interaction → Outcome → Evaluation → Memory → Preference/Strategy Update → Future Decision
```

یادگیری قابل مشاهده، قابل برگشت و قابل ارزیابی.

---

## 32. Verification Agent

بعد از هر Action مهم:
```
Execution → Verification Agent → Actual Result → Compare Expected vs Actual
```

مثلاً:
```
Expected: 100 USDC → ETH
Actual: 99.21 USDC → ETH
Status: CONFIRMED
```

فقط بعد از Verification بگوید موفق شد.

---

## 33. Self-Healing

```
Tool Failed → Diagnose → Retry if safe → Alternative Tool → Re-plan → Continue
```

مثلاً Provider اول Quote نداد → Provider B → New Quote

برای Transaction مالی، Retry کورکورانه انجام نشود.

---

## 34. Observability

برای هر Task:
- taskId, intent, tools, latency, status, errors, retries, provider, result

ذخیره می‌شود، اما اطلاعات حساس و Private Key هرگز.

`src/lib/intent-ai/os/observability.js`

---

## 35. AI Dashboard Internal

برای Developer/Admin یک Debug View: `src/components/IntentOSDebug.jsx`

- Intent, Context, Selected Agent, Selected Tools
- Execution Graph, Memory Used, API Calls, Latency, Errors, Final Result

این بخش برای Debug است و به کاربر نمایش داده نمی‌شود (فقط با ?debug).

---

## 36. Performance

- Lazy Context
- Tool Routing
- Caching
- Parallel Reads
- Event-driven Updates
- Memory Retrieval

---

## 37. امنیت

AI نباید ببیند:
- Private Key, Seed Phrase, Recovery Phrase, Raw Secret

فقط:
- Wallet Address, Balance, Public Position

امضای Transaction همیشه توسط Wallet انجام شود.

`src/lib/intent-ai/os/security.js`

---

## 38. Final Architecture

```
                    USER
                      │
                      ▼
                INTENT AI
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

---

## 39. مهم‌ترین قانون

Intent OS نباید فقط بگوید: "چه کاری می‌توانم برایتان انجام دهم؟"

باید **بفهمد، Context بگیرد، تصمیم بگیرد، ابزار درست را انتخاب کند، اقدام کند و نتیجه واقعی را بررسی کند.**

---

## 40. Acceptance Tests

همه 17 تست پاس می‌شوند:

```
"اخبار را باز کن" → NEWS_SEARCH
"صفحه فارم را باز کن" → FARM
"کیف پولم را باز کن" → NAVIGATION
"یک آهنگ آرامش‌بخش پخش کن" → PLAY_MUSIC
"موجودی من را بررسی کن" → WALLET_BALANCE
"پرتفوی من را تحلیل کن" → PORTFOLIO_ANALYSIS
"بهترین فرصت سرمایه‌گذاری را پیدا کن" → INVESTMENT_PLAN
"100 USDC را به ETH تبدیل کن" → SWAP
"پرتفوی من را متعادل کن" → REBALANCE
"بهترین Yield را پیدا کن" → YIELD_DISCOVERY
"Smart Money را بررسی کن" → SMART_MONEY
"ببین نهنگ‌ها چه می‌خرند" → WHALE
"برای هدف سه ساله‌ام برنامه بساز" → GOAL
"همان کاری که گفتیم را ادامه بده" → CONTINUE
"این را اجرا کن" → EXECUTE_CURRENT
"لغوش کن" → CANCEL
"جزئیاتش را بیشتر بررسی کن" → DETAILS
```

برای هرکدام:
```
UNDERSTAND → CONTEXT → PLAN → TOOL → ACTION → VERIFY → MEMORY → RESPONSE
```

---

## فایل‌های جدید

- `src/lib/intent-ai/os/appCapabilities.js`
- `src/lib/intent-ai/os/toolRegistry.js`
- `src/lib/intent-ai/os/intentUnderstanding.js`
- `src/lib/intent-ai/os/contextEngine.js`
- `src/lib/intent-ai/os/memoryEngine.js`
- `src/lib/intent-ai/os/actionMemory.js`
- `src/lib/intent-ai/os/eventBus.js`
- `src/lib/intent-ai/os/agentLoop.js`
- `src/lib/intent-ai/os/orchestrator.js`
- `src/lib/intent-ai/os/suggestionEngine.js`
- `src/lib/intent-ai/os/taskContinuity.js`
- `src/lib/intent-ai/os/financialAgent.js`
- `src/lib/intent-ai/os/observability.js`
- `src/lib/intent-ai/os/humanResponse.js`
- `src/lib/intent-ai/os/walletContext.js`
- `src/lib/intent-ai/os/security.js`
- `src/lib/intent-ai/os/performance.js`
- `src/lib/intent-ai/os/debugDashboard.js`
- `src/lib/intent-ai/os/proactiveAgent.js`
- `src/lib/intent-ai/os/appIntegration.js`
- `src/lib/intent-ai/os/serviceAdapters.js`
- `src/lib/intent-ai/os/index.js`
- `src/lib/intent-ai/os/agents/*` (12 agent)
- `src/components/IntentAIUnified.jsx` (rewritten)
- `src/components/IntentOSDebug.jsx`
- `server/aiIntentOS.js` (patched for universal intents)

## نتیجه

> **FBT Intent OS = AI Brain + Memory + Context + Tools + Agents + App Control + Wallet + Protocols + Execution + Verification**

کاربر می‌تواند با هر جمله طبیعی، هر قسمت اپ را کنترل کند؛ از "اخبار را باز کن" و "موسیقی آرامش‌بخش پخش کن" تا "پرتفوی من را بررسی کن و بهترین مسیر را پیشنهاد بده و بعد از تأیید اجرا کن".
