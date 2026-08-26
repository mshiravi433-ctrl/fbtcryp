# FBT INTENT AI — فاز ۱۳: Live و Recurring Intents

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی محصول

## وضعیت صادقانه

Lifecycle و recurring preparation در source وجود دارد، اما scheduler/operator، live monitor و receipt provider متصل نیستند. این فاز **implemented در سطح قرارداد، operational unavailable** است.

## Implementation

فایل اصلی: `src/lib/intent-ai/liveRecurringIntents.js`

- lifecycleهای `DRAFT`، `PENDING`، `PARTIAL`، `FAILED`، `EXPIRED`، `COMPLETED`، `CANCELLED`، `PAUSED`، `REVOKED` و `UNAVAILABLE`؛
- timeline نسخه‌دار برای هر transition؛
- expiry پیش از transition بررسی می‌شود؛
- `COMPLETED` فقط با runtime evidence confirmed و verified final receipt پذیرفته می‌شود؛
- `finalResult` برای pending/partial/failed نتیجهٔ نهایی جعل نمی‌کند؛
- recurring intent فقط definition است؛ هر run policy، expiry، controls و user authorization را دوباره check می‌کند؛
- کنترل REVOKE و EMERGENCY_EXIT فوراً روی intent فعال اثر می‌گذارد.

## API و schema

- `fbt.live-intent.v1`
- `fbt.recurring-intent.v1`
- `fbt.intent-timeline.v1`
- `fbt.intent-final-result.v1`

Status مشترک:

```http
GET /api/intents/v1/phase-status
GET /api/intents/v1/public-status
```

هیچ scheduler یا recurring execution endpoint فعال نشده است.

## Tests

- probe: `test/intent-ai/phase13-live-recurring-probe.mjs`
- assertions: **۱۵/۱۵ موفق**
- موارد: pending/partial/failed/expired/completed، receipt proof، recurring policy re-check، monitor unavailable و revoke.
- اجرا: `npm run test:phase13`
- syntax/import: موفق.

## Configuration

- configured: state machine و timeline source.
- partially configured: تعریف schedule و run preparation.
- not configured: live monitor، scheduler/operator، receipt/finality provider.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: runtime monitor، scheduler و receipt evidence.
- blockerها: `LIVE_MONITOR_REQUIRED`، `SCHEDULER_OPERATOR_REQUIRED`، `VERIFIED_RECEIPT_REQUIRED`.

## Safety Confirmation

- raw secret expose شده؟ **خیر**؛ intent و timeline allowlist می‌شوند.
- execution بدون user confirmation ممکن است؟ **خیر**؛ recurring هر بار authorization می‌خواهد و submit نمی‌کند.
- Guardian/policy bypass؟ **خیر**؛ controls و policy re-check مستقل باقی می‌مانند.
- pending/partial Completed گزارش می‌شوند؟ **خیر**.
- نبود runtime evidence success می‌شود؟ **خیر**؛ `UNAVAILABLE` یا non-final برمی‌گردد.

## تصمیم

ادامهٔ فاز ۱۴ مجاز است؛ فعال‌سازی live و recurring تا provider/operator واقعی متوقف است.
