# FBT INTENT AI — فاز ۱۵: External Agent Runtime

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی محصول

## وضعیت صادقانه

Runtime adapter contract، capability negotiation، scoped session و expiry/revoke در source وجود دارد؛ provider، sandbox operator و session-key runtime production متصل نیستند. فاز **implemented / unavailable operationally** است.

## Implementation

فایل: `src/lib/intent-ai/externalAgentRuntime.js`

- runtime health باید `ok`، `operational` و `attested` باشد؛ در غیر این صورت provider unavailable است؛
- negotiation فقط capability/chain/protocol compatibility را بررسی می‌کند؛
- session فقط opaque `handle`، capability scope، chain/protocol scope، amount limit و expiry برمی‌گرداند؛
- request در هر بار expiration، revoke، disconnect، chain، protocol، amount و capability را دوباره check می‌کند؛
- `invoke` provider را با handle و request محدود صدا می‌زند، نه credential؛
- disconnect و revoke فوری scope را invalid می‌کنند؛
- status هرگز execution را activated نشان نمی‌دهد.

## API و schema

- `fbt.external-agent-runtime.v1`
- `fbt.external-agent-session.v1`
- `fbt.external-capability-negotiation.v1`
- `fbt.external-runtime-request.v1`
- `fbt.external-runtime-event.v1`

Endpointهای read-only وضعیت:

```http
GET /api/intents/v1/external-agents
GET /api/intents/v1/phase-status
```

هیچ endpointی private key، seed، password یا master credential را می‌پذیرد.

## Tests

- probe: `test/intent-ai/phase15-external-runtime-probe.mjs`
- assertions: **۱۲/۱۲ موفق**
- موارد: provider unavailable، negotiation، auth، opaque handle، scope، expiry، revoke، disconnect و secret boundary.
- اجرا: `npm run test:phase15`
- syntax/import: موفق.

## Configuration

- configured: runtime interface و fail-closed checks.
- partially configured: injected provider فقط در probe.
- not configured: external transport، session-key provider، sandbox runtime و operator.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: external runtime provider و transport.
- blockerها: `RUNTIME_ADAPTER_REQUIRED`، `SESSION_KEY_PROVIDER_REQUIRED`، `SANDBOX_OPERATOR_REQUIRED`.

## Safety Confirmation

- External Agent چه می‌گیرد؟ **فقط handle و scope محدود**.
- raw secret منتقل/ذخیره شده؟ **خیر**.
- expiration هر request بررسی می‌شود؟ **بله**.
- disconnect/revoke bypass می‌شوند؟ **خیر**.
- نبود provider موفق گزارش می‌شود؟ **خیر؛ unavailable**.

## تصمیم

ادامهٔ فاز ۱۶ مجاز است، ولی External Agent live یا financial execution بیرونی اعلام نمی‌شود.
