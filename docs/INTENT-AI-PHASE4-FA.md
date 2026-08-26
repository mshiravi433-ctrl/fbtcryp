# FBT Intent AI — فاز ۴: امتیازدهی ایجنت و بازار متخصص

## هدف
نمایش **امتیاز مشاهده‌شده** برای ایجنت‌ها و بازار متخصصِ **advice-only**؛ استخدام فقط با Confirmation Gate و Guardian و capability token و session key محدود.

## ماژول‌ها (`src/lib/intent-ai/`)

### `agentScore.js`
- امتیاز را فقط از **نمونهٔ مشاهده‌شده** می‌سازد؛ هیچ پیش‌بینی / استنتاج ندارد.
- `sampleSize < 5 (MIN_OBSERVED_SAMPLE_SIZE)` → `status = 'insufficient_data'` و `successRate=null`, `score=null`. هیچ `%` جعلی.
- هرگز «verified by score» نمی‌شود (`verifiedByScore: false`، `SCORE_NEVER_VERIFIES`).
- **Score جایگزین Guardian نیست** (`guardianReplacement: false`).
- رکورد جعلی (success بدون confirm) در شمارش محاسبه نمی‌شود.
- `scoreDisplayLabel` وضعیت ناکافی را «نامشخص» برمی‌گرداند، نه صفر یا ۱۰۰٪.

### `specialistMarket.js`
- فهرست متخصصان از Directory، فقط `securityStatus === 'verified'`.
- `quote` همیشه **advice-only**؛ هرگز اجرا / custody.
- `hire` نیازمند **همهٔ** گیت‌ها: `userConfirm + Guardian + capabilityToken + sessionKey`.
- هیچ `automaticExecution`، هیچ `withdraw`، هیچ `transfer` / تغییر مقصد.
- disclaimer صادقانه `NOT_GUARANTEED`.

### `collaborationSession.js`
- نشست چند-ایجنت با Social Protocol و token scope (session key محدود).
- پیام اجتماعی هرگز command / executable نیست؛ پیام‌های command/secret/withdraw رد می‌شوند.
- فقط ایجنت‌های تأییدشده و عضو نشست می‌توانند صحبت کنند.

## تصمیمات امنیتی
- Score هیچ‌جا Guardian، Risk یا Gate را دور نمی‌زند.
- استخدام بدون گیت کامل رد می‌شود (fail-closed).
- متخصص unverified هرگز quote/اجرا نمی‌شود.
- پیام اجتماعی در نشست هرگز قابلیت اجرا ندارد.

## UI
نمایش صادقانهٔ score (نمایش «نامشخص» برای insufficient_data) در پنل Intent AI در فاز ۷ با کلیدهای i18n پیاده می‌شود. منطق آماده است: `scoreDisplayLabel`.

## تست‌ها
- `test/intent-ai/phase4-scoring-probe.mjs`
- `test/intent-ai/phase4-marketplace-probe.mjs`
- `test/intent-ai/phase4-fail-closed-probe.mjs`

همه از `npm test` اجرا می‌شوند.
