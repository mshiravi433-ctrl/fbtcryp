# FBT Intent AI — فاز ۵: یادگیری تطبیقی محلی-اول

## هدف
حافظهٔ محلی ناشناس (opt-in) برای بهبود **پیشنهاد استراتژی** — بدون تضعیف ایمنی و بدون وعدهٔ سود.

## ماژول‌ها (`src/lib/intent-ai/`)

### `adaptiveMemory.js`
- ذخیرهٔ محلی outcomeهای opt-in (از `learningOptIn`). **بدون PII**: بدون address / user id / IP / tx hash / کلید.
- `bounded size` (محدود) و قابل پاک‌سازی توسط کاربر (`clearMemory`).
- `memoryStats` فقط مجموع/میزان موفقیت ناشناس؛ هیچ دادهٔ شخصی.
- `memoryCapabilities` صادقانه `local:true`, `externalSync:false`, `optInRequired:true`.

### `strategyRefine.js`
- refine پیشنهادها با آمار محلی؛ `confidence` سقف‌دار (`MAX_REFINED_CONFIDENCE <= 80`).
- همیشه `disclaimers`: `NOT_GUARANTEED`, `PARTIAL_LOSS_POSSIBLE`.
- refine هرگز Guardian / Risk / Gate را skip نمی‌کند؛ فقط پیشنهاد است.
- بدون opt-in → no-op با پیام صادقانه `NO_LOCAL_MEMORY`.

### `confidentialCollab.js`
- پاکت همکاری بین ایجنت‌ها با **redaction اسرار**. هیچ plaintext key / seed / mnemonic / password / api secret / master credential در پیام نشت نمی‌کند.
- `carriesSecret` نشت را قبل از ارسال می‌بندد.
- **صداقت TEE / commit-reveal**: اگر TEE واقعی، Secret Manager واقعی یا encryption-at-rest نباشد، `unavailable` برگردانده می‌شود؛ ادعای پنهان‌ماندن از FBT نمی‌شود.
- `confidentialCapabilities({tee, secretManager, atRestEncryption})`.

## تصمیمات امنیتی
- حافظه فقط پیشنهاد استراتژی را بهبود می‌دهد؛ هرگز Guardian/Risk/Gate را ضعیف نمی‌کند.
- بدون رضایت صریح هیچ ذخیره/ارسال.
- رکورد جعلی (success بدون confirm) ثبت نمی‌شود.
- هیچ وعدهٔ سود تضمینی.

## تست‌ها
- `test/intent-ai/phase5-adaptive-memory-probe.mjs`
- `test/intent-ai/phase5-refine-probe.mjs`
- `test/intent-ai/phase5-confidential-probe.mjs`

همه از `npm test` اجرا می‌شوند.
