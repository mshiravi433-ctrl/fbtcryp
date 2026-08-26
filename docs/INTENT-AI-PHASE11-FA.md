# FBT INTENT AI — فاز ۱۱: تولید Strategy، رقابت و Simulation

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی **FBT INTENT AI — NEXT-GENERATION AUTONOMOUS FINANCIAL AGENT OS**

## وضعیت صادقانه

این فاز در سطح source contract، integration محلی و probe پیاده‌سازی شده است؛ **live یا operational اعلام نمی‌شود**. Route simulator، evidence feed و monitoring provider واقعی در محیط فعلی متصل نیستند. بنابراین strategy فقط proposal/preparation است و هیچ winnerی مجوز execution نیست.

## Implementation

- `src/lib/intent-ai/strategyCompetition.js`
  - تولید چند proposal با schema نسخه‌دار؛
  - مقایسهٔ deterministic بر اساس evidence، expected return و risk؛
  - withheld کردن winner در صورت evidence ناکافی؛
  - اجرای simulation فقط از طریق simulator تزریق‌شده و با status صریح `passed`؛
  - competition، switching، recalculation و monitoring؛
  - replan امن پس از decline قابلیت optional.
- `src/lib/intent-ai/phaseBoundary.js`
  - مرز مشترک عدم صدور permission و runtime evidence.
- `src/lib/intent-ai/index.js`
  - export عمومی قراردادهای فاز ۱۱.
- `src/lib/intentNetwork.js` و `src/components/IntentAIPanel.jsx`
  - خواندن status فازها در کنار capability و discovery؛ فقط read-only.

## API و schema

Schemaهای اصلی:

- `fbt.intent-strategy-proposal.v1`
- `fbt.intent-route-simulation.v1`
- `fbt.intent-strategy-competition.v1`
- `fbt.intent-strategy-monitor.v1`
- `fbt.intent-strategy-switch.v1`

Endpoint status مشترک:

```http
GET /api/intents/v1/phase-status
GET /api/intents/v1/public-status
```

برای فاز ۱۱ هیچ endpointی برای اجرای خودکار یا صدور authorization اضافه نشده است.

## Tests

- probe: `test/intent-ai/phase11-strategy-competition-probe.mjs`
- assertions: **۱۲/۱۲ موفق**
- موارد: چند strategy، عدم تضمین سود، withheld evidence، simulation unavailable/failed/passed، competition provisional، switching، optional decline و monitoring.
- اجرا: `npm run test:phase11`
- syntax/import: موفق.

## Configuration

- configured: قرارداد source و export؛ status endpoint read-only.
- partially configured: هیچ simulator یا evidence feed واقعی؛ injected simulator فقط در probe است.
- not configured: route simulation provider، strategy monitoring runtime و production evidence.

## Operational Status

- implemented: **true در سطح source و test**.
- ready: **false**.
- live: **false**.
- unavailable: runtime simulator و monitor.
- blockerها: `ROUTE_SIMULATION_PROVIDER_REQUIRED`، `OBSERVED_EVIDENCE_REQUIRED`، `USER_CHOICE_REQUIRED`.

## Safety Confirmation

- raw secret expose شده؟ **خیر**؛ ورودی credential-shaped رد می‌شود.
- execution بدون user confirmation ممکن است؟ **خیر**؛ این فاز فقط proposal است.
- Guardian و policy قابل bypass هستند؟ **خیر**؛ این فاز اصلاً permission صادر نمی‌کند.
- score یا success بدون evidence گزارش شده؟ **خیر**؛ winner بدون evidence withheld است و سود تضمین نمی‌شود.
- نبود provider unavailable گزارش می‌شود؟ **بله**؛ simulation/monitor بدون provider موفق گزارش نمی‌شوند.

## تصمیم

ادامهٔ فاز ۱۲ مجاز است؛ اما فاز ۱۱ تا اتصال simulator، evidence و monitoring واقعی **operationally complete نیست**.
