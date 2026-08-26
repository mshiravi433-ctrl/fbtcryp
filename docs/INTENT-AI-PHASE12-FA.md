# FBT INTENT AI — فاز ۱۲: Smart Wallet و Guardian Policy

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی **FBT INTENT AI — NEXT-GENERATION AUTONOMOUS FINANCIAL AGENT OS**

## وضعیت صادقانه

مرز Policy، Guardian، fee transparency، authorization screen و کنترل‌های اضطراری در source پیاده شده است؛ Smart Wallet provider و signer production در محیط فعلی فعال نیستند. پس فاز **implemented / partial** است، نه ready یا live.

## Implementation

- `src/lib/intent-ai/smartWalletPolicy.js`
  - policy کامل و versioned؛
  - هفت limit اجباری شامل Capital، Transaction، Risk، Protocol، Chain، Time و Fee؛ Slippage در صورت وجود نیز bounded و اجباری است؛
  - Guardian مستقل و غیرقابل خاموش‌کردن؛
  - fee sheet برای network، protocol، bridge، external-agent، performance، execution و slippage؛
  - authorization screen مستقل از confirmation؛
  - explicit `CONFIRM`، policy decision و runtime evidence؛
  - STOP، PAUSE، REVOKE، DISCONNECT و EMERGENCY_EXIT بدون bypass.
- `phaseBoundary.js`: دروازهٔ مشترک execution که provider evidence را نیز الزام می‌کند.
- `IntentAIPanel.jsx`: نمایش موجود authorization boundary و کنترل‌ها؛ status operational جداگانه.

## API و schema

- `fbt.smart-wallet-policy.v1`
- `fbt.guardian-decision.v1`
- `fbt.fee-transparency.v1`
- `fbt.authorization-screen.v1`
- `fbt.financial-execution-authorization.v1`
- `fbt.intent-controls.v2`

این فاز transaction را broadcast نمی‌کند. status از endpointهای زیر read-only است:

```http
GET /api/intents/v1/phase-status
GET /api/intents/v1/activation
```

## Tests

- probe: `test/intent-ai/phase12-smart-wallet-policy-probe.mjs`
- assertions: **۱۷/۱۷ موفق**
- موارد: policy ناقص، allowlist خالی، هر limit، fee ناشناخته، Guardian، screen، confirmation، نبود runtime و کنترل emergency.
- اجرا: `npm run test:phase12`
- syntax/import: موفق.

## Configuration

- configured: policy contract و UI boundary.
- partially configured: policy محلی برای review؛ این policy on-chain یا Smart Wallet authority نیست.
- not configured: Smart Wallet/session provider، independent Guardian runtime و production signer.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: provider، signer و runtime evidence واقعی.
- blockerها: `SMART_WALLET_PROVIDER_REQUIRED`، `INDEPENDENT_GUARDIAN_REQUIRED`، `SIGNER_RUNTIME_REQUIRED`.

## Safety Confirmation

- raw secret expose شده؟ **خیر**.
- execution بدون screen و تأیید روشن کاربر ممکن است؟ **خیر**؛ `authorizeFinancialExecution` هر دو را الزام می‌کند.
- Guardian و policy قابل bypass هستند؟ **خیر**؛ Guardian non-disableable و کنترل‌ها fail-closed هستند.
- score/success بدون evidence؟ **خیر**؛ هیچ سودی در این فاز promise نمی‌شود.
- نبود provider unavailable؟ **بله**؛ authorization بدون evidence `RUNTIME_EVIDENCE_UNAVAILABLE` است.

## تصمیم

ادامهٔ فاز ۱۳ مجاز است. فعال‌سازی مالی تا اتصال Smart Wallet، Guardian، signer و evidence واقعی متوقف و fail-closed می‌ماند.
