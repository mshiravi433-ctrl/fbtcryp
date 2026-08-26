# FBT Intent AI — فاز ۸: فعال‌سازی تولید و مرز Secret Manager

تاریخ شروع: ۲۰۲۶-۰۸-۲۶
وضعیت: **کد پیاده‌سازی شد؛ operational activation هنوز مشروط است**

## هدف

بعد از بسته‌شدن فازهای ۱ تا ۷، مشکل بعدی «قابلیت جدید نمایشی» نیست؛ مشکل این
است که بین این چهار مفهوم تفاوت قطعی وجود داشته باشد:

1. کد وجود دارد؛
2. adapter به مسیر اجرا وصل است؛
3. پیکربندی runtime حاضر است؛
4. operational proof واقعاً تأیید شده است.

فاز ۸ این مرز را به یک قرارداد عمومی و قابل‌آزمون تبدیل می‌کند و جایگزین
`SecureMemoryMap` را به‌صورت یک **provider boundary واقعی و fail-closed** آماده
می‌سازد. این فاز ادعا نمی‌کند که در این repository یک KMS واقعی نصب شده است.

## خروجی‌های انجام‌شده

### ۱) مرز Secret Manager — `server/intentSecretManager.js`

- فقط provider تزریق‌شده با health snapshot، دوام (`durable`) و attestation معتبر
  می‌تواند operational شود؛ env flag به‌تنهایی کافی نیست.
- در این repository provider ابری واقعی وجود ندارد، بنابراین مسیر پیش‌فرض
  `unavailable` است.
- فقط handle مبهم و metadata محدود در حافظهٔ این boundary نگه‌داری می‌شود؛ raw
  secret در metadata، status، list یا log ذخیره نمی‌شود.
- metadata به `policyId`، `agentId`، capabilities، chain/protocol scope، expiry و
  purpose محدود است.
- استفادهٔ داخلی فقط از طریق `withSecretHandle` و callback scoped انجام می‌شود؛
  secret در پاسخ عمومی برنمی‌گردد.
- policy/agent/capability mismatch، expiry، provider failure و revoke همگی
  fail-closed هستند.

### ۲) گزارش فعال‌سازی — `server/intentActivation.js`

endpoint جدید:

```http
GET /api/intents/v1/activation
```

این endpoint فقط status، blocker code، شناسهٔ عمومی و تعدادها را برمی‌گرداند؛
هیچ env value، URL، key reference یا secret را برنمی‌گرداند.

گزارش به‌صورت جداگانه اعلام می‌کند:

- `implementation`
- `operational`
- `configured`
- `durable`
- `attested`

و فهرست رسمی ادامهٔ roadmap از فاز ۸ تا ۲۰ را منتشر می‌کند. فازهای ۹ تا ۲۰
در این commit انجام‌شده اعلام نمی‌شوند.

### ۳) اتصال API و UI

- مسیر activation در `INTENT_CAPABILITIES.endpoints.activation` ثبت شد.
- کلاینت read-only در `src/lib/intentNetwork.js` اضافه شد.
- پنل `IntentAIPanel` وضعیت فعال‌سازی فاز ۸ و تعداد blockerها را نمایش می‌دهد.
- کلیدهای UI در `en`، `fa` و `ar` اضافه شدند؛ متن فارسی/عربی در JSX hardcode
  نشده است.

### ۴) تست

`test/intent-ai/phase8-activation-probe.mjs` موارد زیر را قفل می‌کند:

- فازهای ۱ تا ۷ کامل و فازهای ۹ تا ۲۰ هنوز roadmap هستند؛
- Secret Manager پیش‌فرض fake-operational نمی‌شود؛
- provider بدون health/durable/attestation سبز نمی‌شود؛
- metadata دارای private key یا raw secret رد می‌شود؛
- secret فقط داخل consumer داخلی قابل استفاده است؛
- scope mismatch و expiry رد می‌شوند؛
- activation report فاقد secret است.

این probe در `npm test` بعد از probeهای فاز ۷ اجرا می‌شود.

## وضعیت operational فعلی

تا وقتی provider واقعی به این boundary inject نشود:

```json
{
  "implementation": "implemented",
  "operational": "partial",
  "secretManager": {
    "configured": false,
    "operational": false,
    "secretsExposed": false,
    "rawSecretsPersisted": false
  }
}
```

این رفتار عمدی است. فاز ۸ با قرار دادن یک `true` در env، KMS جعلی اعلام نمی‌کند.

## معیار پذیرش provider واقعی

Provider production باید:

1. `health()` همگام و cache‌شده ارائه کند؛
2. `ok: true`، `durable: true` و `attested: true` را فقط با شواهد واقعی اعلام
   کند؛
3. `resolve(handle, scopedContext)` و revoke را پیاده کند؛
4. raw secret را در storage این repository، client bundle، log یا public API
   قرار ندهد؛
5. key rotation، expiry و incident revoke داشته باشد؛
6. با integration test مستقل و audit عملیاتی اثبات شود.

## فاز بعد

فاز ۹ فقط پس از review همین boundary، روی **bridge execution** کار می‌کند و
نباید quote-only مسیر فعلی را به‌صورت ضمنی executable نشان دهد.
