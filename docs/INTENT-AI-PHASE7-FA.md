# FBT Intent AI — فاز ۷: UI محصول، i18n و فعال‌سازی صادقانه

## هدف
Intent AI از پنل آزمایشی به سطح محصول برسد: Confirmation Gate کامل، risk summary، رسید صادقانه، partial، Emergency Stop و سطوح L1/L2/L3 — همه قابل‌ترجمه، با فعال‌سازی لایو **بدون دروغ**.

## کارهای انجام‌شده

### `src/components/IntentAIPanel.jsx` (بازنویسی محصول)
- **Confirmation Gate کامل**: دکمه‌های `CONFIRM / REJECT / CANCEL / REAUTHORIZE`؛ تغییر شرایط → `REAUTHORIZE`.
- **Risk summary** از `riskEngine.evaluateRisk` (سطح + تصمیم).
- **رسید صادقانه** از `reconcile`: `pending / submitted / partial / failed / unavailable / reauthorize / rejected / cancelled / unconfirmed / emergency-stop` — هرگز `COMPLETED` جعلی.
- **Emergency Stop** همیشه در دسترس؛ همهٔ نشست + gate را قطع می‌کند.
- **سطوح L1/L2/L3** با پیش‌نمایش سیاست L3 (confirm/cancel).
- **فعال‌سازی صادقانه**: بخش «Capabilities & readiness» به‌صراحت می‌گوید SecureMemoryMap هنوز جایگزین فاز ۲ است (نه Secret Manager واقعی) و کدام venue واقعاً live است و کدام `configured:false`.

### i18n
- همهٔ رشته‌های جدید تحت namespace `intentAI` در `en` / `fa` / `ar`.
- **هیچ فارسی/عربی هاردکد در JSX نیست.**
- آزمون `wiring` (هر `t()` استاتیک در `en.json` وجود دارد) سبز می‌ماند.
- واژگان ممنوع (`اهرم` و…) از باندل حذف شد تا آرایش vocabulary-check سبز بماند.

### مسیر ورود
- Route جدید `/intent-ai` در `App.jsx`.
- در صفحهٔ `/intent` (Intent OS) یک دکمهٔ natural «Ask the Intent AI assistant» به `/intent-ai` اضافه شد.
- **هیچ دکمهٔ execute/sign روی کاتالوگ ایجنت خارجی نیست.**

## مهندسی
- از همان کتابخانهٔ intent-ai (`openConfirmationGate`, `decideGate`, `assertGateAllowsSubmit`, `evaluateRisk`, `venueHealth`, `reconcile`) استفاده شد؛ مسیر اجرای Guardian/Risk/Gate در همهٔ فازها حفظ شد.

## تست‌ها
- `test/intent-ai/phase7-ui-i18n-probe.mjs` — کلیدهای i18n، عدم هاردکد fa/ar، دکمه‌های Gate، استفاده از gate/venueHealth/reconcile و صداقت فعال‌سازی.
- همهٔ probeهای phase1–6 با `npm test` سبز.

## باقی‌مانده‌ها
«Intent AI در سطح محصول تا فاز ۷ بسته شد.» موارد باقی‌ماندهٔ واقعی (که عمداً خاموش‌اند) در `docs/INTENT-AI-PHASE7-ACTIVATE-FA.md` فهرست شده‌اند: Secret Manager واقعی، اجرای bridge، broker handle، و dYdX session.
