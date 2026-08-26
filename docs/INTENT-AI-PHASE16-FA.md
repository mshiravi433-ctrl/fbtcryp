# FBT INTENT AI — فاز ۱۶: Execution Adapter Activation

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی محصول

## وضعیت صادقانه

Boundary مشترک wallet، broker و bridge adapter با simulation، recipient/calldata re-check، no-sign failure و idempotency پیاده شده است. Provider، signer و venue health production در این محیط موجود نیستند؛ پس activation **live نیست**.

## Implementation

فایل: `src/lib/intent-ai/executionAdapters.js`

- readiness به provider health/attestation، signer، simulate و submit نیاز دارد؛
- mock adapter در production رد می‌شود؛
- transaction chain، recipient، calldata و value قبل از sign و دوباره پیش از submit check می‌شوند؛
- simulation missing/failed مسیر no-sign دارد؛
- `executeWithAdapter` پیش از signer authorization screen، user confirmation، Guardian، policy، همهٔ limitها و runtime evidence را check می‌کند؛
- wallet/broker/bridge از kind مشترک استفاده می‌کنند؛ bridge بدون activation evidence unavailable است؛
- idempotency key از transaction دوم جلوگیری می‌کند.

## API و schema

- `fbt.execution-adapter.v1`
- `fbt.execution-adapter-readiness.v1`
- `fbt.transaction-simulation.v1`
- `fbt.execution-attempt.v1`

این فاز endpoint عمومی برای submit خودکار اضافه نمی‌کند. status در `GET /api/intents/v1/phase-status` و `GET /api/intents/v1/public-status` است.

## Tests

- probe: `test/intent-ai/phase16-adapter-activation-probe.mjs`
- assertions: **۱۳/۱۳ موفق**
- موارد: provider/signer، mock production، simulation، mismatch، no-sign، authorization، idempotency و bridge.
- اجرا: `npm run test:phase16`
- syntax/import: موفق.

## Configuration

- configured: adapter contract و guard.
- partially configured: test doubles فقط در probe.
- not configured: wallet provider، broker provider، bridge provider، signer و venue health runtime.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: provider، signer و runtime evidence.
- blockerها: `WALLET_PROVIDER_REQUIRED`، `BROKER_PROVIDER_REQUIRED`، `BRIDGE_PROVIDER_REQUIRED`، `SIGNER_REQUIRED`.

## Safety Confirmation

- نبود provider/signer success می‌شود؟ **خیر**.
- خطا یا timeout sign می‌کند؟ **خیر**؛ no-sign است.
- recipient/calldata قبل از امضا check می‌شود؟ **بله، و دوباره قبل از submit**.
- mock production فعال است؟ **خیر**.
- execution بدون screen/Guardian/policy ممکن است؟ **خیر**.

## تصمیم

ادامهٔ فاز ۱۷ مجاز است؛ activation مالی تا evidence واقعی provider، signer و venue متوقف می‌ماند.
