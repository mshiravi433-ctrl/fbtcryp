# FBT INTENT OS — UPGRADE 7 · AUDIT + IMPLEMENTATION PLAN

> فاز اول: فقط AUDIT (بدون تغییر کد). فاز دوم: پیاده‌سازی افزایشی (EXTEND — DON'T REPLACE).

---

## بخش ۱ — AUDIT

### CURRENT AI ARCHITECTURE

```
src/lib/intent-ai/            194 module (لایه‌های phase 1..50 + upgrade 1..6)
└── os/                       هستهٔ Intent OS v3  (13.4k خط)
    ├── index.js              createIntentOS() → process() ← نقطهٔ ورود واحد
    ├── intentUnderstanding.js        classifier مبتنی بر pattern/keyword (v3)
    ├── intentUnderstandingEngine.js  Upgrade 4 NLP (normalize/slang/typo/entity)
    ├── contextEngine.js      buildContext() موازی + cache
    ├── memoryEngine.js       working / session / long-term
    ├── orchestrator.js       plan() + routeToAgents() (استاتیک، rule-based)
    ├── agentLoop.js          حلقهٔ perceive→plan→act→verify
    ├── toolRegistry.js       ~۷۰ tool با inputSchema/readOnly/requiresConfirmation
    ├── confidenceEngine.js   امتیاز اطمینان + pre-execution checklist
    ├── humanResponse.js      لایهٔ پاسخ انسانی (۸۴۲ خط)
    ├── agents/               ۱۳ agent
    └── upgrade6/             ۱۶ ماژول stateful (conversationState, slots, …)
server/
├── aiIntentOS.js             BFF / روت‌های HTTP هوش مصنوعی
├── aiGateway.js              چند provider (openrouter, groq, gemini, …)
└── central/                  pipeline · planner · router · riskEngine · policy
```

مصرف‌کنندهٔ اصلی UI: `src/components/IntentAIUnified.jsx` (۲۹۸۴ خط) — تنها سطحی که
`getIntentOS().process()` را صدا می‌زند.

### CURRENT INTENT ENGINE

- `understandIntent(message, context)` → امتیازدهی pattern + keyword + navigation +
  entity، خروجی تخت (`type`, `entities`, `confidence`, `missingInformation`,
  `minimalQuestion`, `readOnly`, `handoff`, …).
- Upgrade 4: `extractEntitiesUpgrade4`, `classifyQuestionType`, `detectConflict`,
  `detectUserCorrection`, `resolveReferences`, `predictNextActions`,
  `calculateClarificationPriority`, `calculateIntentConfidenceBreakdown`.
- Upgrade 6: `slotFillingEngine`, `referenceResolver`, `conversationState`,
  `intentLifecycle`, `stateMachine`, `memoryV2 (L1/L2/L3)`, `followUpResolver`.

**ضعف:** خروجی «تک‌بعدی» است — یک `type` غالب. مفاهیم WHY / GOAL / OBJECTIVE /
CONSTRAINTS به‌صورت ساختاریافته و یکجا استخراج نمی‌شوند، و intentهای پنهان
(مثلاً «بیت‌کوین چطوره؟» → price+trend+risk+opportunity+portfolio-impact) مدل نشده‌اند.

### CURRENT AGENTS

`intent, navigation, media, wallet, portfolio, market, trading, yield, research,
risk, strategy, guardian, execution, verification, financial` (۱۵ کلید در
`createIntentOS`). ارکستراسیون در `orchestrator.routeToAgents` بر پایهٔ `switch` روی
`intent.type` است؛ `upgrade6/sharedContext.AgentOrchestratorV2` مسیر ترتیبی با
shared-context دارد ولی فقط برای پرسش‌های سناریویی از UI صدا زده می‌شود.

**ضعف:** بدون timeout / retry / fallback / health، بدون اجرای موازی، بدون
cross-check و synthesis.

### CURRENT TOOLS

`toolRegistry.js` — رجیستری با `resolveToolsForIntent`, `getToolsByCapability`,
`validateToolInput`; `toolExecutor.executeIntentTools`; آداپتورهای واقعی در
`serviceAdapters.createRealServices` (wallet, portfolio, swap, market, yield, news,
smart-money, …). `upgrade6/toolCapabilityChecker` بررسی در دسترس بودن دارد.

### CURRENT MEMORY

سه سیستم موازی: `memoryEngine` (working/session/long-term)، `upgrade6/memoryV2`
(L1 پیام‌ها / L2 taskها / L3 preferenceها)، و `intentSession` (اسلات‌های عملیاتی
per-conversation) + `taskContinuity` (localStorage).

**ضعف:** حافظهٔ «معنایی» (facts / decisions / goals) و فشرده‌سازی context وجود ندارد.

### CURRENT WALLET STATE

`centralWalletState.js` (SSOT) + `upgrade6/walletContextManager` (global,
snapshot-before-op) + `WalletContext.jsx`. کلید خصوصی هرگز وارد مسیر AI نمی‌شود؛
`security.assertNoSecrets` روی پیام کاربر اجرا می‌شود.

### CURRENT NAVIGATION STATE

`moduleRouter.js` + `routeAdapter.resolveIntent` + `upgrade6/navigationManager`
(با loop-guard) + `followUpResolver` (PAGE_OPEN_INTENTS / INTENT_DEFAULT_ROUTE).

### CURRENT API CONNECTIONS

`server/index.js` (۲۸۶ route) — `aiGateway` (چند LLM)، `aiIntentOS`، `aiWebResearch`،
`news`, `whales`, `smartMoney/*`, `signalEngine`, `yields`, `lending`, `futures/*`,
`crossChain`, `intentScheduler`, `intentMonitor`, …

### CURRENT WEAKNESSES (خلاصه)

1. Intent تک‌بعدی؛ بدون WHY/GOAL/OBJECTIVE ساختاریافته.
2. Hidden intent مدل نشده.
3. Plan صریح و قابل resume وجود ندارد (plan فعلی = خروجی یک‌بارهٔ orchestrator).
4. Graph اجرا با وضعیت node وجود ندارد.
5. Agentها بدون timeout/retry/fallback/health و بدون cross-check.
6. تازگی داده به‌صورت policy اجباری برای پاسخ‌های market-sensitive اعمال نمی‌شود.
7. حافظهٔ معنایی و فشرده‌سازی context نیست؛ conversation طولانی = prompt سنگین.
8. تشخیص تناقض فقط درون یک جمله است، نه بین نوبت‌ها.
9. dedupe درخواست تکراری وجود ندارد.
10. اولویت/تعارض بین Intentها مدل نشده.
11. مجموعه تست «مکالمهٔ طلایی» و رگرسیون Upgrade 1–6 به‌شکل یکجا نیست.

---

## بخش ۲ — IMPLEMENTATION PLAN

قانون: هیچ فایل UI/استایل تغییر نمی‌کند. تمام قابلیت‌ها به‌صورت یک لایهٔ جدید
`src/lib/intent-ai/os/upgrade7/` اضافه می‌شوند و فقط با یک اتصال کوچک و
غیرشکننده (append-only روی خروجی `process()`) به هستهٔ فعلی وصل می‌شوند.

| # | ماژول جدید | بندهای spec |
|---|---|---|
| 1 | `deepIntent.js` | §1 §2 §11 §18 |
| 2 | `intentGraph.js` | §3 §36 |
| 3 | `planner.js` | §4 §5 §6 §30 |
| 4 | `predictive.js` | §7 §8 |
| 5 | `financialContext.js` | §9 §10 §17 |
| 6 | `agentMesh.js` | §12 §13 §40 §41 |
| 7 | `confidence.js` | §14 §15 §16 §26 §29 |
| 8 | `semanticMemory.js` | §18 §22 §23 §24 §25 |
| 9 | `safety.js` | §21 §27 §28 §46 |
| 10 | `monitoring.js` | §31 §32 §33 §34 §35 |
| 11 | `runtime.js` | §38 §39 |
| 12 | `goldenConversations.js` | §43 §44 |
| 13 | `index.js` | §47 barrel + `createUpgrade7()` |

اتصال: در `os/index.js` داخل `process()` پس از ساخت پاسخ، یک بلوک
`try { … } catch {}` مقدار `upgrade7` را به خروجی اضافه می‌کند — هیچ کلید موجودی
حذف یا بازنویسی نمی‌شود، و هر خطایی در این لایه پاسخ اصلی را از کار نمی‌اندازد.

تست‌ها: `test/intent-ai/upgrade7-intelligence-probe.mjs`،
`upgrade7-golden-conversations-probe.mjs`، `upgrade7-regression-probe.mjs`
و اسکریپت‌های `npm run test:upgrade7*`.
