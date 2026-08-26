# FBT Intent AI — Phase 1 (Intent Foundation)

تاریخ: 2026-08-25
برنچ: `arena/01a03b40-fbtcryp`

## چه چیزی در این فاز پیاده‌سازی شد

لایهٔ اول Intent AI به‌صورت **Deterministic / Fail-closed / Local-first** روی کدبیس موجود FBT ساخته شد و هیچ کد تکراری به ماژول‌های موجود (intentOS, intentLifecycle, executionGate, intentGuardian) اضافه نکرد. همهٔ ماژول‌ها در مسیر `src/lib/intent-ai/` قرار دارند و هیچ‌کدام مستقیماً کلید خصوصی، تراکنش، یا signer نگه‌داری نمی‌کنند.

### ماژول‌های اصلی (Phase 1)

| فایل | نقش |
|---|---|
| `permissions.js` | سطوح دستوری L1 (Analysis) / L2 (Prepare) / L3 (Controlled Autonomous)، Hard-cap های جهانی، اعتبارسنجی allowlist زنجیره/پروتکل/دارایی |
| `policyModel.js` | مدل Policy نسخه‌دار و قابل‌تأیید کاربر (CONFIRM & START)، اعتبارسنجی، انقضا، Emergency stop، preview، ذخیره‌سازی محلی |
| `intentParser.js` | پارسر قاعده‌مند زبان طبیعی → Intent ساخت‌یافته، با پشتیبانی از swap/buy/sell/short/bridge/farm/analyze/goal، ابهام‌زدایی، clarify |
| `guardian.js` | Guardian مستقل و غیرقابل‌غیرفعال‌سازی با لیست کامل دلایل رد بر اساس Master Spec (سرمایه، تراکنش، زیان، لوریج، زنجیره، پروتکل، دارایی، مقصد، deadline، injection، secret، audit deletion، external-agent، fake receipt) |
| `strategyAgent.js` | Agent 1: Research, Technical/Fundamental Evidence، Candidate Strategy، Goal-based projection با disclaimers، REPLAN (هرگز STOP) |
| `executionOrchestrator.js` | Agent 2: بررسی مستقل Proposal، ساخت Plan، Gate گاردین به‌ازای هر Step، Terms Hash برای Confirmation Gate، Handshake |
| `draftOrder.js` | Draft Order (نتیجه L2/L3) با schema نسخه‌دار، خلاصه‌ٔ Confirmation Gate |
| `humanAi.js` | Session کامل Mode A (Human ↔ AI): startSession، chatTurn، clarify، confirm policy، emergency stop، audit |
| `socialProtocol.js` | پروتکل اجتماعی Agent ↔ Agent با 10 تایپ مجاز؛ هیچ پیام اجتماعی command نیست |
| `stickers.js` | 15 استیکر UI فقط برای reaction؛ لیست سفید؛ هرگز execute/permission/sign را تغییر نمی‌دهد |
| `audit.js` | لاگ رونوشت append-only محلی با sanitization کلیدهای ممنوعه و redaction |
| `index.js` | barrel export عمومی |

### UI

یک پنل React در `src/components/IntentAIPanel.jsx` که L1/L2/L3، تأیید سیاست L3 با دکمه‌های CONFIRM & START / CANCEL، چت، prepared draft، و emergency stop را نمایش می‌دهد.

### تست‌ها

- `test/intent-ai/intent-ai-foundation-probe.mjs` شامل **86 تست واحد** که همهٔ موارد زیر را قفل می‌کند:
  - سطوح دسترسی و عدم Escalation خودکار
  - clamp شدن مقادیر توسط hard-cap
  - تأیید/انقضا/Emergency Stop Policy
  - parse صحیح الگوهای رایج جمله (swap/buy/sell/short/goal/analyze)
  - رد injection، secret field، audit deletion، fake receipt توسط Guardian
  - تولید حداقل یک استراتژی حتی وقتی همهٔ optional capability ها رد شوند (fallback spot)
  - Reject اجرا در L1/L2 (فقط quote/draft)
  - L3 با تأیید Policy آمادهٔ Confirmation Gate می‌شود
  - social protocol و stickers هیچگاه executable نیستند
  - audit کلیدهای حساس را redact می‌کند
- به `test/run.mjs` اضافه شد و در `npm test` اجرا می‌شود.

## ویژگی‌های امنیتی قفل‌شده

1. **هیچ Agent اختیار نهایی ندارد.** همهٔ Stepها حتی در L3 توسط Guardian بازبینی می‌شوند.
2. **Guardian غیرقابل‌غیرفعال‌سازی.** هم برای L1/L2 quote و هم برای L3 execute فعال است.
3. **سطح مجوز جداگانه برای هر session.** ذخیره‌سازی اختیار L3 نیاز به CONFIRM & START صریح دارد.
4. **Prompt-Injection Detection.** هر فیلد متنی اسکن می‌شود و کلیدواژه‌های تلاش برای دور زدن policy به‌صورت hard-reject می‌شوند.
5. **Least-Privilege در External-Agent boundary.** (فقط گارد اولیه؛ full adapter در Phase 3 می‌آید.)
6. **REPLAN به‌جای STOP.** اگر capabilityای رد شد (مثلاً futures یا bridge) استراتژی جایگزین (مثلاً spot-only) تولید می‌شود.
7. **عدم قطعیت سود.** همهٔ Goal-based ها disclaimers صریح `NOT_GUARANTEED / PARTIAL_LOSS_POSSIBLE` دارند.
8. **Audit append-only و local-first.** کلیدهای خصوصی/seed/secret به‌هیچ‌وجه persist نمی‌شوند.

## محدودیت‌های این فاز (Phase 2 تکمیل می‌کند)

- Execution واقعی روی بلاکچین / Broker / Wallet — در این فاز Plan و Draft Order تولید می‌شود ولی sign/submit انجام نمی‌شود.
- Session Key، Scoped Authorization و Broker/Sub-account adapterها در Phase 2 می‌آیند.
- Risk Engine عمقی (ترکیب price-impact/MEV/token-risk/wallet-risk) در Phase 2 به Guardian اضافه می‌شود.
- Monitoring/Exit/Reconciliation واقعی بعد از Phase 2.
- کشف و آداپتور Agent خارجی، Agent Scoring، Local-first Learning در Phase 3.

## اجزای موجود که استفاده شد (بدون کد تکراری)

- `src/lib/intentGuardian.js` (SENSITIVE_ACTIONS)
- `src/lib/intentLifecycle.js` (termsFingerprint)
- `src/lib/ai.js` (به‌صورت inject، وابستگی مستقیم حذف شد تا import در Node ESM بدون باندلر هم کار کند)
- `src/lib/externalAgentSecurity.js` (سازگار)
- `src/lib/executionGate.js` (فاز 2 به‌هم متصل می‌شود)

## Build

```
npx vite build   # پاس می‌شود (فقط هشدارهای comment annotation از walletconnect)
npm test         # تست‌های Intent AI + تست‌های قبلی
```

## نحوهٔ استفاده در UI

```jsx
import IntentAIPanel from '../components/IntentAIPanel';
<IntentAIPanel defaultChainId={42161} onDraftReady={({ plan, drafts, termsHash }) => {
  // هدایت کاربر به Confirmation Gate
}} />
```

## پرامپت Phase 2 (برای اجرا در مرحلهٔ بعد)

متن کامل پرامپت فارسی برای Phase 2 در انتهای همین سند آمده و در فایل `PROMPT-PHASE2-FA.md` هم ذخیره می‌شود.

---

## پرامپت Phase 2 — Controlled Execution

```
# FBT INTENT AI — PHASE 2: CONTROLLED EXECUTION

برنچ کاری: arena/01a03b40-fbtcryp

۱) ابتدا repository را بررسی کن و از قابلیت‌های موجود (executionGate، preSignSimulation،
   smartWallet.js، swap.js، bridge.js، dcaExecution.js، orders.js، broker adapterهای ناقص،
   session key sketchها) استفاده کن؛ کد تکراری نساز.

۲) ماژول‌های زیر را در src/lib/intent-ai/ اضافه کن:
   - confirmationGate.js   : UI-ready immutable summary + CONFIRM/REJECT/CANCEL/REAUTHORIZE
   - riskEngine.js         : price impact / token risk / wallet risk / MEV / simulation ترکیبی
   - sessionKeys.js        : scoped, time-bounded session key (بدون نگهداری raw credential)
   - brokerAdapter.js      : least-privilege adapter interface (broker/smart-wallet/subaccount)
   - walletAdapter.js      : signer abstraction که فقط draftOrder+signature برمی‌گرداند
   - executionMonitor.js   : monitoring, partial-execution detection, heartbeat
   - exitPolicy.js         : stop-loss / take-profit / emergency unwind
   - reconciliation.js     : مقایسهٔ وضعیت on-chain/broker با رسید و صدور receipt صادقانه
   - failureModes.js       : RECOVERABLE / FAILED / EXPIRED / CANCELLED / PARTIAL_EXECUTION طبق lifecycle

۳) هر اجرا باید:
   - از Guardian عبور کند
   - از Risk Engine عبور کند
   - از Confirmation Gate عبور کند (مگر L3 با معتبر Policy و termsHash تطبیقی)
   - Session Key در scope داشته باشد
   - Audit ثبت کند
   - Reconciliation بعد از آن اجرا شود
   - هر خطا fail-closed باشد

۴) تست واحد + integration اضافه کن (tests/intent-ai/phase2-*.probe.mjs).
۵) Build کامل بگیر (vite build).
۶) خطاها را رفع کن.
۷) تغییرات را در docs/INTENT-AI-PHASE2-FA.md مستند کن.
۸) روی همین برنچ commit کن.
۹) Pull Request بساز.
۱۰) لینک PR و گزارش فارسی بده.
۱۱) پرامپت فاز بعد (Phase 3 — Multi-Agent Ecosystem) را ارائه بده.

محدودیت‌های غیرقابل‌مصالحه (مثل Phase 1):
- هیچ Agent، UI یا admin Guardian را غیرفعال نمی‌کند.
- هیچ ادعای سود/بازده قطعی مجاز نیست.
- کلید خصوصی / seed / mnemonic / master password هرگز به Agent داده نمی‌شود.
- External Agentها فقط از طریق Scoped Session Key + Capability Token + Subaccount کار می‌کنند.
- رسید / Success جعلی هرگز تولید نمی‌شود.
- partial-execution باید صادقانه نمایش داده شود.
```
