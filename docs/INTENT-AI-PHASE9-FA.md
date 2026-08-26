# FBT Intent AI — فاز ۹: هستهٔ Intent OS بر مبنای specification رسمی

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی و authoritative محصول **FBT INTENT AI — NEXT-GENERATION AUTONOMOUS FINANCIAL AGENT OS**

## محدودهٔ این فاز

فاز ۹ به‌جای اضافه‌کردن یک route یا یک چت‌بات عمومی، مرزهای product OS را در کد قابل‌آزمون تثبیت می‌کند. سه mode اصلی دقیقاً همین‌ها هستند و mode چهارم یا fallback نداریم:

1. `HUMAN ↔ AI`
2. `AI ↔ AI INSIDE FBT`
3. `FBT AI ↔ EXTERNAL AI AGENT`

`level`های قدیمی `ANALYSIS / PREPARE / CONTROLLED` **mode نیستند**؛ آن‌ها فقط tier جداگانهٔ permission هستند. هیچ mode یا level به‌تنهایی مجوز جابه‌جایی پول نمی‌دهد.

## implementation اضافه‌شده

### ۱) مرز mode و permission

`src/lib/intent-ai/sessionModes.js`

- catalog دقیق سه mode؛
- classification مستقل برای `analysis`، `preparation` و `execution`؛
- جداسازی صریح analysis/preparation از financial execution؛
- authorization screen برای execution؛
- ردکردن mode ناشناخته، raw credential و external Agent تأییدنشده؛
- assertion قابل‌استفاده در orchestrator و UI.

`src/lib/intent-ai/humanAi.js`

- session اکنون `mode`، `modeLabel`، `modeDefinition`، `authorization` و `permissions` جدا دارد؛
- proposal، research، strategy dialogue و Guardian approval در هیچ مسیری به `financialExecutionAuthorized` تبدیل نمی‌شوند؛
- پیام آمادهٔ تأیید، `authorizationScreen` و دکمه‌های `CONFIRM / REJECT / CANCEL / REAUTHORIZE` را صادر می‌کند؛
- `executeConfirmed` فقط در مسیر explicit confirmation می‌تواند وارد adapter قدیمی شود و پس از آن state مجوز action را ثبت می‌کند.

### ۲) capability discovery و optional capability

`src/lib/intent-ai/capabilityScanner.js`

- catalog ۲۹ capability محصول؛
- تفکیک `implemented`، `configured`، `operational` و evidence؛
- score هفت‌معیارهٔ `usefulness / risk / cost / reliability / liquidity / expectedImpact / executionQuality`؛
- score بدون همهٔ metricها `null` است و هرگز با حدس سبز نمی‌شود؛
- recommendation فقط وقتی `materialImpact` و evidence runtime وجود دارد و همیشه user choice لازم است؛
- decline، safe alternative و replan برمی‌گرداند و strategy را بی‌دلیل متوقف نمی‌کند.

صفحهٔ Intent AI هم capability API سرور و scan محلی را جدا نشان می‌دهد. نبود provider، signer، evidence یا runtime health همچنان `conditional / unavailable` باقی می‌ماند.

### ۳) target reality و challenge/council

`src/lib/intent-ai/targetReality.js`

- target سود promise نیست؛
- برای horizon کوتاه و targetهای بزرگ labelهایی مانند `extreme` و `very-high-risk` تولید می‌شود؛
- probability، expected return، potential loss، drawdown و confidence اگر evidence نداشته باشند `null` می‌مانند؛
- `NOT_GUARANTEED`، loss disclaimer و انتخاب‌های `REDUCE_RISK / EXTEND_DURATION / CHANGE_STRATEGY` همراه خروجی هستند.

`src/lib/intent-ai/agentCouncil.js`

- challenge مستقل Agent 2 علیه proposal Agent 1؛
- council roleهای research، strategy، risk، liquidity، fee، Guardian، execution، exit و auditor؛
- precedence تصمیم: `REJECT > REVISE > APPROVE`؛
- Council هرگز Guardian را replace نمی‌کند و `canExecute: false` دارد؛
- برای high-risk، high-value و mode داخلی AI↔AI فعال می‌شود.

### ۴) Intent Genome، memory و policy controls

`src/lib/intent-ai/intentGenome.js`

- vector قابل‌توضیح preference/risk؛
- DNA matching به‌صورت similarity، نه احتمال موفقیت؛
- evolution فقط از feedback محدود و بدون تغییر execution permission؛
- secret-shaped input رد می‌شود.

`src/lib/intent-ai/agentMemory.js`

- structured typed events؛
- redaction فیلدهای seed/private key/master password/token؛
- local-first memory و learning batch با `upload: disabled-by-default`.

`src/lib/intent-ai/policyGuard.js`

- fail-closed برای Capital, Transaction, Risk, Protocol, Chain, Time, Fee و Slippage؛
- policy معتبر فقط `ALLOW_REVIEW_ONLY` می‌دهد؛ execution adapter باید جداگانه وجود داشته باشد؛
- `STOP`, `PAUSE`, `REVOKE`, `DISCONNECT`, `EMERGENCY_EXIT` stateهای غیرقابل‌دورزدن هستند؛
- fee نامعلوم execution را مسدود می‌کند.

## UI و i18n

`src/components/IntentAIPanel.jsx` اکنون دارد:

- mode selector با همان سه mode رسمی؛
- authorization boundary که analysis، preparation و financial execution را جدا نشان می‌دهد؛
- capability readiness و score withheld؛
- کنترل‌های STOP / PAUSE / REVOKE / DISCONNECT / EMERGENCY EXIT؛
- agent dialogue غیرقابل‌اجرا، target reality و authorization message؛
- نمایش محافظه‌کارانهٔ receipt.

کلیدهای UI برای English و Persian در `src/i18n/locales/en.json` و `src/i18n/locales/fa.json` اضافه شده‌اند؛ labelهای mode نیز با i18n و `defaultValue` پوشش داده شده‌اند.

## probe و معیار پذیرش

`test/intent-ai/phase9-intent-os-probe.mjs` شامل ۲۹ assertion است و این موارد را قفل می‌کند:

- دقیقاً سه mode و نبود fallback؛
- separation مجوز analysis/preparation از execution؛
- external verification و raw credential boundary؛
- runtime capability scan و score withheld؛
- optional recommendation و replan بعد از decline؛
- target غیرواقعی بدون promise؛
- challenge و council مستقل؛
- DNA matching/evolution؛
- memory redaction و offline learning؛
- هر هفت limit و controls fail-closed؛
- Human↔AI، AI↔AI و External Agent در session واقعی.

نتیجهٔ probe در این تغییر: **۲۷/۲۷ موفق**. probe در `test/run.mjs` ثبت شده است.

## وضعیت عملیاتی صادقانه

این فاز از نظر source و test، **partial implementation** است؛ `done` یا production activation کامل اعلام نمی‌شود:

- external Agent verification/passport/sandbox واقعی هنوز provider و attestation عملیاتی ندارد؛
- capability scan بدون runtime evidence، capability را green نمی‌کند؛
- policy guard و confirmation boundary موجودند، اما provider واقعی Smart Wallet/KMS/venue باید جداگانه operational proof داشته باشد؛
- Secret Manager Phase 8 همچنان در runtime پیش‌فرض `partial` است؛
- server activation پاسخ اضافهٔ `intentOS` و `specificationRoadmap` دارد، در حالی‌که قرارداد تاریخی Phase 8 برای compatibility حفظ شده است.

هیچ Agent seed phrase، private key یا master password دریافت نمی‌کند و هیچ sticker، social message یا council vote نمی‌تواند Guardian، limit یا emergency control را دور بزند.
