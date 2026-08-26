# FBT Intent AI — Phase 3 Prompt (Multi-Agent Ecosystem)

برنچ کاری جلسه را حفظ کن. هرگز به برنچ دیگری سوئیچ نکن.

بر اساس Phase 1 (Foundation) و Phase 2 (Controlled Execution) در `src/lib/intent-ai/` لایهٔ Multi-Agent Ecosystem را بساز.

## هدف
ایجنت‌های داخلی و خارجی بتوانند با Social Protocol و capability tokenهای محدود همکاری کنند، بدون دور زدن Guardian، بدون credential خام، و بدون اجرای خودکار برداشت.

## الزامات
۱) ابتدا repository را بررسی کن و از ماژول‌های موجود استفاده کن (تکرار نساز):
   - Phase 2: confirmationGate, riskEngine, sessionKeys, broker/wallet adapters, monitor, exit, reconciliation
   - `server/ecosystemRegistry.js`, `server/ecosystemSchemas.js`, `src/lib/externalAgentSecurity.js`
   - `src/lib/intent-ai/socialProtocol.js`

۲) اضافه کن:
   - capabilityToken.js — توکن محدود به policyId + scope + expiry؛ غیرقابل‌انتقال به عنوان master credential
   - agentDirectory.js — کشف ایجنت تأییدشده؛ unverified هرگز execute نمی‌شود
   - multiAgentOrchestrator.js — هماهنگی Strategy/Execution/External با Guardian per-step
   - learningOptIn.js — فقط با رضایت کاربر، دادهٔ ناشناس

۳) Fail-closed، بدون سود تضمینی، بدون رسید جعلی، Emergency Stop سراسری.

۴) تست در `test/intent-ai/phase3-*.mjs` و `npm test` باید سبز بماند.
۵) `npx vite build` بدون خطا.
۶) مستند `docs/INTENT-AI-PHASE3-FA.md` به فارسی.
۷) Commit و PR به main از همین برنچ.
