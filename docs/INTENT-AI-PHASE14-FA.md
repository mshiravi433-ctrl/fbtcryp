# FBT INTENT AI — فاز ۱۴: Intent Genome و Local-First Memory

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی محصول

## وضعیت صادقانه

Genome، matching توضیح‌پذیر، evolution محدود و memory محلی در source و probe پیاده شده‌اند. این implementation یک encrypted device store یا upload service operational نیست؛ بنابراین فاز **partial و not live** باقی می‌ماند.

## Implementation

فایل: `src/lib/intent-ai/intentGenomeMemory.js`

- vector محدود preference/risk با dimensionهای مشخص؛
- similarity و توضیح اختلاف هر dimension؛
- `successProbability` عمداً null است و DNA match با احتمال موفقیت اشتباه نمی‌شود؛
- evolution تنها بعد از learning opt-in و با delta محدود انجام می‌شود؛ execution permission، Guardian و policy قابل تغییر نیستند؛
- structured eventهای allowlist‌شده؛
- رد credential پیش از storage؛
- local-first bounded memory با clear کاربر؛
- learning batch فقط aggregate است و upload به‌طور پیش‌فرض disabled است.

## API و schema

- `fbt.intent-genome.v1`
- `fbt.intent-genome-match.v1`
- `fbt.intent-genome-evolution.v1`
- `fbt.local-first-memory.v1`
- `fbt.local-memory-event.v1`
- `fbt.local-learning-batch.v1`

این فاز endpoint upload یا persistence سروری اضافه نمی‌کند. وضعیت از `GET /api/intents/v1/phase-status` قابل مشاهده است.

## Tests

- probe: `test/intent-ai/phase14-genome-memory-probe.mjs`
- assertions: **۱۳/۱۳ موفق**
- موارد: secret rejection، dimension، similarity، opt-in، redaction، bound، clear و upload default.
- اجرا: `npm run test:phase14`
- syntax/import: موفق.

## Configuration

- configured: قرارداد local-first و redaction.
- partially configured: storage adapter محلیِ قابل تزریق برای تست.
- not configured: encrypted-at-rest device store، learning consent service و retention operator.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: production encrypted storage و upload/retention evidence.
- blockerها: `ENCRYPTED_DEVICE_STORE_REQUIRED`، `LEARNING_CONSENT_REQUIRED`، `RETENTION_REVIEW_REQUIRED`.

## Safety Confirmation

- memory secret ذخیره می‌کند؟ **خیر**؛ raw secret رد می‌شود.
- learning بدون opt-in upload می‌شود؟ **خیر**.
- DNA match احتمال موفقیت است؟ **خیر**؛ فقط similarity توضیح‌پذیر است.
- evolution permission اجرا را تغییر می‌دهد؟ **خیر**.
- نبود provider unavailable گزارش می‌شود؟ **بله**؛ upload/production activation وجود ندارد.

## تصمیم

ادامهٔ فاز ۱۵ مجاز است؛ ادعای learning live یا encrypted production memory تا evidence واقعی ممنوع است.
