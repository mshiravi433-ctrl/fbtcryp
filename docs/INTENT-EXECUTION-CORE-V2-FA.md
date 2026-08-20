# FBT Intent Execution Core v2 — چه چیزی ساخته شد و چه چیزی هنوز وجود ندارد

این سند دقیقاً همان چیزی را توضیح می‌دهد که در این فاز پیاده‌سازی شد، و به همان اندازه صریح می‌گوید چه چیزی هنوز ساخته نشده است. هر ادعایی که در کد قابل اثبات نبود، در این سند هم به‌عنوان «موجود نیست» ثبت شده است.

خلاصهٔ یک‌خطی: Intent OS از یک اسکلت Compiler/Proof/Auction به یک **مسیر اجرای واقعی و قابل‌ردیابی** ارتقا پیدا کرد؛ اما همچنان هیچ کلید خصوصی، Session Key نامحدود یا اختیار خرج‌کردن در سرور یا AI وجود ندارد.

---

## ۱. جریان واقعی اجرا

```text
Intent
→ Validation            (compileIntent — از قبل موجود بود)
→ Quoting               (quote race: KyberSwap / OpenOcean / Velora)
→ Deterministic Optimization   (intentRoutePolicy.js — جدید)
→ Exact Transaction Build      (intentTransaction.js — جدید)
→ Exact RPC Preflight          (intentSimulation.js — جدید، eth_call + estimateGas واقعی)
→ User Approval / Signature    (کیف پول خود کاربر)
→ Submission                   (فقط از مسیر sendIntentTransaction)
→ Confirmation                 (receipt)
→ Verification                 (Execution Proof v2)
→ Recovery                     (intentRecovery.js — جدید)
→ Privacy-Safe Observation     (intentObservation.js + server/intentObservation.js — جدید)
```

سرور در هیچ نقطه‌ای از این مسیر تراکنش امضا یا ارسال نمی‌کند.

---

## ۲. فایل‌های اصلی این فاز

| فایل | نقش |
|---|---|
| `src/lib/intentLifecycle.js` | State Machine خالص `fbt.intent-lifecycle.v1` |
| `src/lib/intentTransaction.js` | ساخت دقیق تراکنش `fbt.intent-transaction.v1` + fingerprint + تنها مسیر ارسال |
| `src/lib/intentSimulation.js` | شبیه‌سازی واقعی `fbt.intent-simulation.v1` روی همان بایت‌ها |
| `src/lib/intentRoutePolicy.js` | امتیازدهی قطعی مسیر `fbt.intent-route-policy.v1` |
| `src/lib/intentRecovery.js` | موتور Recovery `fbt.intent-recovery.v1` |
| `src/lib/intentObservation.js` | ساخت و ارسال Observation با opt-in |
| `src/hooks/useIntentExecution.js` | اتصال ماژول‌های خالص به صفحهٔ Swap |
| `src/components/IntentTimeline.jsx` | Timeline، کارت Simulation، کارت Policy، کارت Recovery |
| `server/intentObservation.js` | اعتبارسنجی سخت‌گیرانه و ذخیرهٔ fail-closed |
| `server/app.js` | `POST /api/intents/v1/observations` + rate limit اختصاصی |
| `server/intents.js` | بلوک `executionCore` در Capabilities |
| `src/lib/executionProof.js` | Execution Proof v2 با حفظ سازگاری v1 |

تست‌ها:

`test/intent-lifecycle-probe.mjs` · `test/intent-simulation-probe.mjs` · `test/intent-route-policy-probe.mjs` · `test/intent-recovery-probe.mjs` · `test/intent-observation-probe.mjs` (به‌علاوهٔ بخش جدید در `test/wiring.mjs`)

---

## ۳. Lifecycle — `fbt.intent-lifecycle.v1`

پانزده وضعیت: `CREATED · VALIDATING · VALIDATED · QUOTING · OPTIMIZING · SIMULATING · AWAITING_APPROVAL · AWAITING_SIGNATURE · SUBMITTED · CONFIRMING · COMPLETED · RECOVERABLE · FAILED · EXPIRED · CANCELLED`

قواعدی که در کد تضمین شده و در تست قفل شده‌اند:

1. **جدول Transition صریح** است؛ هر Transition اعلام‌نشده رد می‌شود (`INVALID_TRANSITION`).
2. **fail-closed**: هیچ Transition نامعتبری به نزدیک‌ترین حالت مجاز تبدیل نمی‌شود.
3. **Idempotency**: تکرار همان وضعیت، رویداد جدید نمی‌سازد و `sequence` را بالا نمی‌برد.
4. **وضعیت‌های terminal** (`COMPLETED/FAILED/EXPIRED/CANCELLED`) هیچ یال خروجی ندارند؛ بنابراین `FAILED → COMPLETED` و `CANCELLED → COMPLETED` از نظر ساختاری غیرممکن است.
5. هر رویداد شامل `schema, intentId, sequence, from, to, timestamp, reasonCode, policyVersion` است.
6. تاریخچه **کران‌دار** است (حداکثر ۴۰ رویداد؛ رویداد اول همیشه نگه داشته می‌شود).
7. در Local Storage فقط allowlist ذخیره می‌شود.
8. **هیچ** signer، provider، calldata، آدرس کیف پول یا secret ذخیره نمی‌شود (`sanitizeLifecycle` + `lifecycleIsClean` + تست مستقیم روی رشتهٔ ذخیره‌شده).
9. Intentهای قدیمی بدون lifecycle با `migrateLegacyIntent` خوانده می‌شوند و **هرگز** به وضعیت قابل‌امضا مهاجرت نمی‌کنند.
10. تغییر Route، Amount، Chain، Recipient، Slippage یا Min Output پس از بازبینی، بازبینی را باطل می‌کند (`applyMaterialChange` → `OPTIMIZING` + `reauthorisationRequired`).
11. Deadline گذشته، Intent را به `EXPIRED` می‌برد و اجرای Intent منقضی ممنوع است.

نکتهٔ طراحی: شرایط مورد تأیید کاربر به‌صورت **fingerprint** ذخیره می‌شود، نه به‌صورت مقدار خام؛ بنابراین هیچ آدرس یا مبلغی در حافظهٔ محلی lifecycle نوشته نمی‌شود. مبنای بازبینی، **quoteFingerprint** است نه calldata، چون هر بار build شدن همان مسیر بایت متفاوتی تولید می‌کند (deadline داخل calldata است) و در غیر این صورت هر rebuild به‌اشتباه «تغییر مسیر» تلقی می‌شد.

---

## ۴. Exact Transaction Builder — `fbt.intent-transaction.v1`

ساخت و ارسال کاملاً جدا شدند:

* `buildIntentTransactionRequest()` فقط می‌سازد.
* `simulateIntentTransaction()` روی همان شیء اجرا می‌شود.
* `sendIntentTransaction()` تنها تابعی است که به signer دست می‌زند.

تضمین‌ها:

* KyberSwap و OpenOcean قبل از ارسال، تراکنش دقیق می‌سازند.
* Fee bps، Fee receiver، Router address و Min output دوباره verify می‌شوند (`FEE_NOT_APPLIED`, `FEE_RECIPIENT_MISMATCH`, `ROUTER_MISMATCH`, `MIN_OUTPUT_REGRESSED`).
* `routeFingerprint` روی بایت‌های دقیق (router + calldata + value + sender) و `quoteFingerprint` روی اقتصاد معامله محاسبه می‌شود؛ هر تغییر material حداقل یکی را عوض می‌کند.
* Quote/Transaction منقضی قابل استفاده نیست (`expiresAt` + `deadline`).
* `sendIntentTransaction` بدون simulation موفقِ **bind‌شده به همان fingerprintها** ارسال نمی‌کند و هیچ پرچم `force` ندارد.
* Transaction Request فقط ephemeral در حافظهٔ کلاینت است: در ref نگه داشته می‌شود، در state یا Local Storage نمی‌رود و به سرور/telemetry ارسال نمی‌شود. برای نمایش و لاگ فقط `redactTransactionRequest()` وجود دارد.

---

## ۵. Exact RPC Preflight — `fbt.intent-simulation.v1`

مسیر: تأیید chain → تأیید account → موجودی native → موجودی و allowance توکن → `provider.call` → `provider.estimateGas` → decode revert → نتیجه.

قواعد صداقت که در کد اعمال شده‌اند:

* موفق‌بودن `eth_call` **قطعیت اجرا نیست** و در UI هم همین نوشته شده است.
* `stateDiffAvailable: false` (هیچ trace/state-diff گرفته نمی‌شود).
* `outputGuaranteeProven: false` — حتی وقتی مقدار min output داخل calldata دیده می‌شود، این «شواهد» است نه اثبات enforce شدن.
* `privateRelayAttested: false`.
* خطای RPC هرگز `passed` نمی‌شود؛ حتی نودی که `call` را جواب می‌دهد ولی `estimateGas` را رد می‌کند، `rpc-unavailable` گزارش می‌شود، نه «موفق با gas نامعلوم».
* Allowance ناکافی = `approval-required` (شاخهٔ AWAITING_APPROVAL)، نه شکست.
* **از state override جعلی برای ساختن allowance استفاده نمی‌شود**؛ فقط یک حالت صریح `experimentalStateOverride` وجود دارد که خروجی را با mode ‏`unsupported-experimental-state-override` برچسب می‌زند.
* Simulation به fingerprintها bind است؛ با تغییر route/quote یا با گذشت زمان stale می‌شود.

در UI دو ردیف جدا نمایش داده می‌شود: «تخمین صرفاً بر پایه Quote» و «شبیه‌سازی دقیق RPC» — به‌همراه شمارهٔ بلاک، gas و کد revert در صورت وجود.

**قاعدهٔ ارسال:** برای Swapهایی که از Intent OS آمده‌اند (`?intent=…`)، دکمهٔ تأیید تا پیش از `passed` شدن simulation غیرفعال است. Swap معمولی رفتار قبلی خود را حفظ می‌کند اما نتیجهٔ simulation (از جمله شکست) در Review نمایش داده می‌شود و پنهان نمی‌شود.

---

## ۶. Deterministic Route Scoring v2

دو Policy صریح:

1. `MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1` — فقط وقتی مجاز است که همهٔ مسیرهای eligible دارای `amountOutUsd` معتبر، `gasUsd` معتبر، **price source مشترک**، freshness قابل‌مقایسه، fee یکسان، slippage یکسان، chain و pair یکسان باشند. فرمول: `netOutputUsd = amountOutUsd - gasUsd`.
2. `MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2` — fallback صادقانه با ادعای دقیقاً همین جمله: *best executable output among comparable responses observed in this quote round*.

ترتیب Tie-break: خروجی بیشتر → gas کمتر (فقط اگر comparable باشد) → slippage کمتر → latency کمتر → hop کمتر → solver ID به ترتیب lexical.

سایر قواعد:

* اول **eligibility** (حذف)، بعد **ranking**؛ هیچ weighted score با واحدهای مخلوط وجود ندارد.
* Quote غیرقابل اجرا، منقضی، بدون خروجی، دارای integrity شکسته یا با ریسک critical **حذف** می‌شود، نه امتیاز کم می‌گیرد.
* مسیر با fee یا slippage یا chain یا pair متفاوت قابل مقایسه نیست و با کد دلیل رد می‌شود.
* هیچ reliability یا reputation ساختگی وارد امتیاز نمی‌شود.
* خروجی برای هر ترتیب ورودی یکسان است (در تست با چهار جایگشت بررسی می‌شود).
* Policy، claim، مسیرهای ردشده و فیلدهای ناقص وارد Execution Proof می‌شوند.

---

## ۷. Recovery Engine — `fbt.intent-recovery.v1`

۱۸ کد خطا (`QUOTE_EXPIRED … MIN_OUTPUT_AT_RISK`) و ۱۱ اقدام مجاز (`REQUOTE … MARK_EXPIRED`).

قواعد امنیتی که برای **هر** کد در تست بررسی می‌شوند:

* `resubmits: false` برای همهٔ planها — هیچ Recovery‌ای تراکنش را دوباره ارسال نمی‌کند.
* تغییر Amount/Route/Recipient/Chain/Slippage/calldata فقط با امضای جدید ممکن است (`requiresNewSignature`).
* Requote با مسیر جدید نیازمند بازبینی مجدد کاربر است؛ در UI ابتدا بنر «چه چیزی تغییر کرد» نمایش داده می‌شود و **فشردن اول** یعنی تأیید مجدد، **فشردن دوم** یعنی امضا.
* retry شبکه فقط دوباره می‌خواند.
* کد ناشناخته fail-closed است (`FAILED`).
* پیام‌ها code-based و ترجمه‌پذیرند (`exec.recovery.*` در `en` و `fa`).

---

## ۸. Privacy-Safe Execution Observation

`fbt.intent-execution-observation.v1` — فقط با opt-in فعلی telemetry و توکن رضایت دستگاه (`ct1:` + ۳۲ hex).

Payload **فقط** شامل: `intentKind, chainId, routePolicy, solver (از allowlist), quoteCount, hopCount, simulationStatus, gasEstimateBucket, gasErrorBpsBucket, outputErrorBpsBucket, confirmationLatencyBucket, failureCode, outcome, policyVersion, dayBucket`.

هرگز ارسال نمی‌شود: آدرس کیف پول، tx hash، calldata، آدرس قرارداد توکن، IP در payload، seed/key/signature، موجودی دقیق، recipient، user ID، topic/session واکنکت، متن آزاد کاربر.

* اعتبارسنجی روی **allowlist** است؛ فیلد ناشناس، enum ناشناخته، مقدار hex-شکل، مقدار base64-شکل و هر رشتهٔ دارای فاصله (یعنی «جمله») رد می‌شود — payload اصلاح نمی‌شود، رد می‌شود.
* endpoint نسخه‌دار و دارای rate limit اختصاصی است (`INTENT_OBSERVATION_RATE_LIMIT`، پیش‌فرض ۳۰/دقیقه).
* بدون storage durable، پاسخ `503 NOT_CONFIGURED` است (fail closed).
* خطای telemetry هرگز اجرای Swap را خراب نمی‌کند (fire-and-forget، همهٔ خطاها بلعیده می‌شوند).
* **در این فاز هیچ مدل ML ساخته نشد.** `/api/learning/params` بدون دیتاست همچنان `model:false` برمی‌گرداند و `executionObservations.modelTrained` در Capabilities برابر `false` است.

---

## ۹. Execution Proof v2

* `fbt.execution-proof.v1` بدون تغییر verify می‌شود و برای Swap بدون Execution Core همچنان همان v1 تولید می‌شود.
* `fbt.execution-proof.v2` وقتی تولید می‌شود که شواهد Execution Core موجود باشد و این‌ها را اضافه می‌کند: schema/version و وضعیت نهایی lifecycle، policy انتخاب مسیر و claim آن، مسیرهای ردشده و فیلدهای ناقص، route/quote fingerprint، نتیجهٔ simulation دقیق و شمارهٔ بلاک، hash تراکنش انتخاب‌شده، gas واقعی، دلتای پیش‌بینی/واقعیت، رویدادهای Recovery و بلوک `claimLimits`.
* ارجاع تراکنش Approval **فقط** در receipt محلی است و در payload observation وجود ندارد.
* `actualOutput` تنها زمانی پر می‌شود که از receipt/log قابل استخراج باشد؛ در غیر این صورت `null` است و ادعا نمی‌شود.
* Verification دوباره canonical JSON می‌سازد، دوباره SHA-256 می‌گیرد و در نسخهٔ v2 اتصال fingerprintها را هم بررسی می‌کند.

ادعا نمی‌شود: بهترین Route کل جهان، MEV saved بدون counterfactual، private relay بدون attestation، atomic cross-chain، ZK proof، guaranteed execution بر پایهٔ `eth_call`.

---

## ۱۰. Capabilities

`GET /api/intents/v1/capabilities` حالا شامل:

```json
"executionCore": {
  "lifecycleSchema": "fbt.intent-lifecycle.v1",
  "simulationSchema": "fbt.intent-simulation.v1",
  "recoverySchema": "fbt.intent-recovery.v1",
  "observationSchema": "fbt.intent-execution-observation.v1",
  "exactClientRpcPreflightSupported": true,
  "serverExecutesTransactions": false,
  "userSignatureRequired": true,
  "autonomousSpending": false,
  "stateDiffSimulation": false,
  "privateRelayAttested": false,
  "routePolicies": ["MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1", "MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2"]
}
```

`exactClientRpcPreflightSupported: true` فقط یعنی این قابلیت در کد وجود دارد و در Review اجرا می‌شود؛ نتیجهٔ هر Intent جداگانه `passed/failed` است.

---

## ۱۱. آنچه هنوز وجود ندارد (بدون لاپوشانی)

* **فقط یک Solver ثبت‌شده** وجود دارد؛ رقابت چند Solver مستقل ادعا نمی‌شود. Quote race میان KyberSwap/OpenOcean/Velora است، نه یک بازار Solver.
* **Bond روی زنجیره escrow نیست**؛ slashing خودکار وجود ندارد.
* **Workflow contract روی لایو configured نیست**: `workflowLiveRouterCalldata:false` و `workflowBatchVerifiesOutputs:false` بدون تغییر باقی مانده‌اند.
* **Cross-chain اتمیک نیست**.
* **Confidential Intent غیرفعال است**.
* **State diff simulation وجود ندارد**؛ فقط `eth_call` + `estimateGas`.
* **اثبات enforce شدن min output در قرارداد انجام نمی‌شود**؛ `outputGuaranteeProven` همیشه `false` است.
* **MEV Protection تضمین‌شده نیست**؛ هیچ private relay attested وجود ندارد.
* **مدل Learning ساخته نشد**؛ فقط Observation جمع می‌شود و بدون دادهٔ کافی `model:false` می‌ماند.
* **Multi-RPC quorum برای preflight پیاده نشده**؛ کد `RPC_DISAGREEMENT` در جدول Recovery وجود دارد اما مقایسهٔ چند نود در این فاز اجرا نمی‌شود (scaffold است، live نیست).
* **مسیر Direct-router و Gasless** از Exact Transaction Builder پشتیبانی نمی‌شوند (`UNSUPPORTED_SOURCE`) و رفتار قبلی خود را دارند.
* **پیگیری خودکار تراکنش جایگزین‌شده (replacement) در UI پیاده نشده**؛ کد و plan آن وجود دارد ولی ردیابی زندهٔ hash جایگزین در صفحهٔ Swap اضافه نشده است.
* سرور همچنان **هیچ کلید خصوصی، Seed یا Session Key** ندارد و هیچ تراکنشی امضا یا ارسال نمی‌کند.

---

## ۱۲. اجرای تست‌ها

```bash
npm test          # همهٔ Suiteها، شامل پنج probe جدید Execution Core
npm run build     # production build
```
