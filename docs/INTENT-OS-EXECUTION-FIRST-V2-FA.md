# FBT INTENT OS — Execution-First System Prompt v2.0 — گزارش فعال‌سازی

> وضعیت: فعال‌شده (Activation) · برنچ: `arena/01a05ebd-fbtcryp`
> اسکوپ: پذیرش و «زنده‌کردن» اسپک ۵۱-قاعده‌ای به‌عنوان قرارداد حاکم بر رفتار Intent OS — نه پیاده‌سازی قابلیت مالی جدید.

---

## ۱. خلاصه

اسپک «Production Intelligence & Action Orchestration Specification v2.0» که در این
سشن ارائه شد، به سه شکل در مخزن «زنده» شد:

1. **سند مرجع (verbatim)** — متن کامل و اصلاح‌شده در
   `prompts/INTENT-OS-EXECUTION-FIRST-V2.md`.
2. **ماژول قرارداد در زمان اجرا** — `src/lib/intent-ai/os/systemPrompt.js` که
   زنجیرهٔ اجرا، ۵۱ قاعدهٔ شماره‌دار، حالت‌های پاسخ، وضعیت‌های Capability و
   تابع `buildSystemPrompt()` (state-aware و fail-closed) را به‌صورت
   machine-readable در دسترس قرار می‌دهد.
3. **قرارداد Backend ↔ Frontend** — endpoint جدید `GET /api/v1/ai/system-prompt`
   و فیلد `contract` در پاسخ `POST /api/v1/ai/chat` (مطابق قاعدهٔ ۴۹: backend
   state می‌دهد و frontend فقط render می‌کند).

هیچ قابلیت مالی جدیدی ساخته نشد، هیچ عددی جعل نشد و هیچ عملیاتی اجرا نشد.

---

## ۲. فایل‌های تغییر‌یافته

| فایل | تغییر |
| --- | --- |
| `prompts/INTENT-OS-EXECUTION-FIRST-V2.md` | متن کامل اسپک (HTML entities اصلاح‌شده) |
| `src/lib/intent-ai/os/systemPrompt.js` | ماژول قرارداد: version، زنجیره‌ها، ۵۱ قاعده، `buildSystemPrompt()` |
| `server/aiIntentOS.js` | import + `GET /system-prompt` + فیلد `contract` در پاسخ `/chat` |
| `test/intent-ai/execution-first-v2-probe.mjs` | ۲۰ تست قرارداد (pure + HTTP) |
| `test/run.mjs` | ثبت probe جدید در `npm test` |
| `package.json` | اسکریپت `test:exec-first-v2` |

---

## ۳. قرارداد اجرا

### `GET /api/v1/ai/system-prompt`

```json
{
  "ok": true,
  "schema": "fbt.intent-os.system-prompt.v1",
  "version": "fbt.intent-os.execution-first.v2.0",
  "executionChain": ["UNDERSTAND","INSPECT","PLAN","CONFIRM","EXECUTE","VERIFY","REPORT"],
  "rules": [ { "id": 1, "key": "main_law", "title": "…" }, … 51 … ],
  "contract": { "ruleCount": 51, "responseModes": […], "capabilityStatuses": […] },
  "systemPrompt": "…fa…",
  "systemPromptEn": "…en…"
}
```

### پاسخ `/chat`

هر نوبت چت اکنون فیلد `reply.contract` را با `version` و `executionChain`
برمی‌گرداند تا frontend به‌جای حدس زدن، قرارداد حاکم را از backend بخواند.

### `buildSystemPrompt({ locale, state })`

- **بدون state** → می‌گوید «در این نوبت بررسی نشده» و ادعای متصل/غیرمتصل را
  ممنوع می‌کند (قاعدهٔ ۴۱).
- **wallet متصل** → دقیقاً آدرس/زنجیرهٔ گزارش‌شده را اعلام می‌کند، نه بیشتر.
- **wallet غیرمتصل** → `DISCONNECTED`/«غیرمتصل» صریح؛ بدون موجودی جعلی.
- قواعد صداقت مطلق و ممنوعیت «سود تضمینی» همیشه در پرامپت هستند.

---

## ۴. نگاشت ۵۱ قاعده → ماژول‌های موجود

وضعیت‌ها: ✅ موجود و تست‌شده · 🟡 بخشی (نیازمند فید/ادغام زنده) · ⚪ در این
سشن صرفاً به‌عنوان قرارداد ثبت شده (اجرای آن در ماژول‌های قبلی پراکنده است).

| # | قاعده | وضعیت | ماژول(های) پوشش‌دهنده |
| --- | --- | --- | --- |
| 1 | قانون اصلی / زنجیره | ✅ | `os/systemPrompt.js` (جدید)، `commandCenter.orchestrate` |
| 2 | ممنوعیت پاسخ تکراری | ✅ | `humanResponse.js` + `FORBIDDEN_PHRASES` (جدید) |
| 3 | بررسی وضعیت کیف پول قبل از پیشنهاد اتصال | ✅ | `buildAIContext` + `walletContext.js` + `systemPrompt` |
| 4 | Intent Detection ساختاری | ✅ | `intentParser.js`، `intentKinds.js`، `semanticIntent.js` |
| 5 | Intent از متن+UI+state | ✅ | `contextResolver.js`، `os/contextEngine.js` |
| 6 | Entity Resolution | ✅ | `intentParser.js`، `semanticLexicon.js` |
| 7 | Context Memory | ✅ | `os/memoryEngine.js`، `adaptiveMemory.js`، `/memory` |
| 8 | Capability Registry | ✅ | `os/appCapabilities.js`، `capabilityScanner.js` |
| 9 | اتصال همه اجزا / صداقت Integration | ✅ | `serviceAdapters.js`، `integration`‌های server |
| 10 | Portfolio Analysis | ✅ | `portfolioLedger.js`، `rebalanceEngine.js` |
| 11 | Portfolio Actionable | ✅ | `planNarrator.js`، `humanResponse.js` |
| 12 | Global Markets | 🟡 | `server/markets`‌ها؛ عرضهٔ سهام/فارکس وابسته به provider |
| 13 | Futures / dYdX | 🟡 | دادهٔ funding/OI موجود؛ اجرای dYdX طبق قرارداد صادقانه `UNAVAILABLE` |
| 14 | Lending | ✅ | lending server + `riskEngine.js` (LTV/health) |
| 15 | Swap | ✅ | `swap.js`، quote/simulate/sign/broadcast |
| 16 | Bridge | ✅ | `bridge.js`، `draftTransactionBridge.js` |
| 17 | Farm / LP | ✅ | farm/lending servers + `riskEngine.js` |
| 18 | News | 🟡 | provider-dependent؛ timestamp در دسترس است |
| 19 | Signals | ✅ | `signals` server + ساختار اجباری |
| 20 | Events | ✅ | `eventRiskAdapter.js`، تقویم اقتصادی |
| 21 | Recommendation Engine | ✅ | `planNarrator.js`، `whyTransparency.js` |
| 22 | Forecast Engine | 🟡 | سناریوی Bear/Base/Bull؛ وابسته به دادهٔ زنده |
| 23 | Action Permission | ✅ | `confirmationGate.js`، `executionStateMachine.js` |
| 24 | اجازه گرفتن طبیعی | ✅ | `humanResponse.js` (ACTION_CARD/CHOICE) |
| 25 | Error Handling | ✅ | `errorHumanizer.js`، `executionErrorTaxonomy.js` |
| 26 | خطای تکراری ممنوع | ✅ | `executionErrorTaxonomy.js` (ERROR_ID/RETRY) |
| 27 | Recovery Engine | ✅ | `executionStateMachine.js`، `disasterMode.js` |
| 28 | Never Bypass Security | ✅ | `guardian.js`، `simulationGate.js`، `walletChainVerify.js` |
| 29 | System State | ✅ | `buildAIContext` (wallet/network/markets/portfolio/…) |
| 30 | Tool Selection | ✅ | `aiToolRegistry.js`، `os/toolRegistry.js` |
| 31 | Verification | ✅ | `reconciliation.js`، `onchainReceipt.js` |
| 32 | Transaction States | ✅ | `executionStateMachine.js` |
| 33 | UI Context Awareness | ✅ | `os/contextEngine.js`، `getCurrentPageContext` |
| 34 | Cross-Module Intelligence | ✅ | `os/orchestrator.js`، `agentCouncil.js` |
| 35 | مثال واقعی (هدف+پرتفوی) | ✅ | `goalProgress.js`، `financialGoals.js` |
| 36 | اگر Wallet وجود ندارد | ✅ | `humanResponse.js` (CONNECT_WALLET/آدرس عمومی) |
| 37 | Wallet متصل + Indexer خراب | ✅ | fail-closed در `buildAIContext`/provider fallback |
| 38 | Capability UNAVAILABLE صادقانه | ✅ | `aiToolRegistry.js` + `CAPABILITY_UNAVAILABLE` |
| 39 | Response Intelligence | ✅ | `humanResponse.js` |
| 40 | چهار حالت پاسخ | ✅ | `RESPONSE_MODES` (جدید) + `UI_TYPES` |
| 41 | Anti-Hallucination | ✅ | fail-closed + `FORBIDDEN_PHRASES` |
| 42 | Data Freshness | ✅ | `dataLifecycle.js`، timestamps در داده‌ها |
| 43 | Confidence | ✅ | `confidenceDecay.js`، confidence/data-quality جدا |
| 44 | Never Promise Guaranteed Profit | ✅ | `FORBIDDEN_PHRASES` (جدید) |
| 45 | Goal Execution | ✅ | `financialGoals.js`، `goalNegotiation.js` |
| 46 | Cross-module Action Example | ✅ | `intentPlanner.js` + PLAN/Review |
| 47 | Multi-Step Execution | ✅ | `executionStateMachine.js` (step fail → STOP/ASK) |
| 48 | Observability | ✅ | `observabilityProof.js`، intentId/executionId |
| 49 | Frontend ↔ Backend Contract | ✅ | `GET /system-prompt` + `reply.contract` (جدید) |
| 50 | Final Response Rule | ✅ | اولویت EXECUTE→ANALYZE→… در `humanResponse.js` |
| 51 | Ultimate Rule | ✅ | `ULTIMATE_CHAIN` + `EXECUTION_CHAIN` (جدید) |

نکتهٔ صادقانه: چت اصلی Intent OS در حال حاضر **rule-based** است (LLM فقط برای
classify نیت در confidence پایین استفاده می‌شود). پرامپت سیستمی فوق به‌عنوان
قرارداد رفتار ثبت و از طریق endpoint قابل مصرف است تا هر ادغام LLM آینده
(state-aware) مستقیماً از آن استفاده کند؛ اما ادعا نمی‌کنیم که یک LLMِ
گفتگوی آزاد این ۵۱ قاعده را «اجرا» می‌کند — اجرای واقعی در همان ماژول‌های
تست‌شدهٔ فوق است.

---

## ۵. نتایج تست و بیلد

- **`npm run test:exec-first-v2`** → `20/20` ✅
- **`npx vite build`** → موفق ✅ (39s)
- **`npm test`** → کل سوئیت اجرا شد؛ **۱ تست از پیش موجود قرمز** است:

```
✗ Confirm in the unified chat runs the wallet runtime, not navigate(handoff)
```

این تست (`test/intent-ai/intent-os-human-layer-probe.mjs`) متن
`src/components/IntentAIUnified.jsx` را بررسی می‌کند و چون آن فایل حاوی
`navigate(route)` است، شکست می‌خورد. این فایل در این سشن **تغییری نکرده**
(`git status` تأیید می‌کند) و این شکست روی commit پایهٔ `main` نیز وجود دارد؛
یعنی ربطی به تغییرات این سشن ندارد. طبق قاعدهٔ ۲۸ (امنیت/صحیح‌بودن) آن را
بدون بررسی جداگانه و با تغییر نامرتبط «اصلاح» نکردم تا اسکوپ آلوده نشود.

---

## ۶. آنچه عمداً انجام نشد

- هیچ ادغام LLM گفتگوی آزاد برای چت اصلی ساخته نشد (خارج از اسکوپ؛ نیازمند
  تصمیم محصول دربارهٔ provider و بودجه).
- هیچ قابلیت مالی جدید (dYdX execution، بازار سهام زنده و …) روشن نشد.
- تست قرمز از پیش موجود (`navigate(route)`) دست‌نخورده ماند؛ فقط گزارش شد.
- هیچ راز/کلیدی در هیچ‌جای این تغییرات قرار نگرفت.

---

## ۷. نحوهٔ تأیید

```bash
npm run test:exec-first-v2      # 20/20
curl -s localhost:PORT/api/v1/ai/system-prompt | jq .version
npx vite build
```
