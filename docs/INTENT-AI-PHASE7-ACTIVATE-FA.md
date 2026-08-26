# FBT Intent AI — فعال‌سازی (Activation) فاز ۷

این سند صادقانه می‌گوید چه چیزی برای فعال‌شدن لازم است، چه چیزی **عمداً خاموش** است، و چگونه Emergency Stop تست می‌شود. هیچ ادعای توانایی‌ای که واقعاً پیاده نشده مطرح نیست.

## چه env / پیکربندی لازم است

### 1. اتصال کیف پول (signer + provider)
برای اجرای واقعی در مسیر swap/dYdX، پنل به یک **wallet متصل** نیاز دارد (ارائه‌دهندهٔ `signer` و `provider`). بدون آن، `venueHealth` وضعیت `unavailable` می‌دهد و هیچ sign/execution انجام نمی‌شود.
- کلید خصوصی هرگز به Agent یا External Adapter داده نمی‌شود؛ فقط از کیف پول کاربر sign می‌گیرد (non-custodial).

### 2. Broker handle (مسیر بروکر)
برای اجرای بروکر، یک `brokerHandle` باید با `bindBrokerHandle` محدود شود. بدون آن `configured:false` است. **برداشت / transfer / تغییر مقصد نیازمند policy جدا** است.

### 3. dYdX session (مسیر perp)
برای اجرای dYdX، کاربر باید ابتدا `connectDydx(signer)` را انجام دهد تا نشست در حافظه ساخته شود؛ بدون آن `NO_DYDX_SESSION` → `unavailable`.

### 4. Secret Manager واقعی — **عمداً خاموش**
`SecureMemoryMap` هنوز جایگزین موقت Phase-2 است (opaque handle در حافظه، نه KMS / Secret Manager واقعی). تا وقتی Secret Manager واقعی نصب نشود، پنل به‌صراحت این را به‌عنوان stand-in گزارش می‌دهد و ادعای «مخفی‌ماندن از FBT» نمی‌کند (در `confidentialCapabilities` هم `unavailable` برمی‌گردد).

## چه چیزی عمداً خاموش است (configured:false)

| قابلیت | وضعیت |
|---|---|
| اجرای bridge | عمداً خاموش — فقط quote؛ execute-bridge **wired نیست** |
| broker بدون handle | خاموش (`configured:false`) |
| dYdX بدون نشست | خاموش (`unavailable`) |
| Secret Manager واقعی | جایگزین فاز ۲ |
| TEE / commit-reveal / hide-from-FBT | `unavailable` مگر پیش‌نیازها برقرار باشند |
| DCA / smart wallet | تنظیم‌شده محلی |

## چگونه Emergency Stop تست می‌شود
Emergency Stop در چندجا بررسی می‌شود:
1. `guardian.emergencyStopCheck(stopFlagSet)` — if true → `EMERGENCY_STOP`.
2. `controlledExecution.emergencyHalt` — همهٔ session keyهای policy را revoke و `EMERGENCY_STOP` برمی‌گرداند.
3. `multiAgentOrchestrator.emergencyStopAllForPolicy` — همهٔ session keyها + capability tokenها را revoke می‌کند.
4. `executionMonitor.heartbeat(…, { emergencyStop })` — در حلقهٔ monitor، stop → `STOPPED` → `EMERGENCY_STOP`.
5. `submitPipeline(…, { emergencyStop: true })` — در خط لولهٔ فاز ۶، `emergency-stop` برمی‌گرداند.
6. دکمهٔ «🛑 Stop» در UI — `userStop(session)` + پاک‌کردن gate/receipt.

### تست‌های خودکار
- `test/intent-ai/phase2-fail-closed-probe.mjs` → `prepareExecution` با `emergencyStop:true` → `EMERGENCY_STOP`.
- `test/intent-ai/phase3-fail-closed-probe.mjs` → `emergencyStopAllForPolicy` → revokedKeys + revokedTokens.
- `test/intent-ai/phase6-unavailable-honest-probe.mjs` → `submitPipeline(…, emergencyStop:true)` → `emergency-stop`.

## آیا چیزی واقعاً باقی مانده؟
«Intent AI در سطح محصول تا فاز ۷ بسته شد.» موارد باقی‌ماندهٔ واقعی که برای production باید انجام شوند (و در این فاز عمداً خاموش‌اند):
1. جایگزینی `SecureMemoryMap` با یک Secret Manager / KMS واقعی.
2. اتصال اجرای bridge (اگر خواسته شود) — فقط یک مسیر اجرا الهام‌گرفته از `bridge.getBridgeQuote`.
3. اتصال broker واقعی با `brokerHandle` محدود.
4. اتصال مستمر dYdX session در UI (امروز با نشست متصل کار می‌کند).
5. افزودن kms secrets به `.env.example` فهرست‌شده به‌عنوان متغیرهای غیرضروری برای این فاز.
