# FBT Intent AI — Phase 2 Prompt (Controlled Execution)

برنچ کاری: `arena/01a03b40-fbtcryp`

بر اساس Phase 1 (Intent Foundation) که الان در `src/lib/intent-ai/` و `src/components/IntentAIPanel.jsx` موجود است:

## هدف
تکمیل لایهٔ Controlled Execution تا Intent AI بتواند با Guardian و Risk Engine و Confirmation Gate یک Draft Order را تا اجرا، مانیتورینگ، Exit و Reconciliation هدایت کند.

## الزامات

۱) **ابتدا repository را بررسی کن** و از قابلیت‌های موجود استفاده کن:
   - `src/lib/executionGate.js`
   - `src/lib/preSignSimulation.js`
   - `src/lib/smartWallet.js`
   - `src/lib/swap.js`, `bridge.js`, `dydx.js`, `perp.js`, `dcaExecution.js`
   - `src/lib/intentLifecycle.js` (وضعیت‌ها و transition ها)
   - `src/lib/intentGuardian.js`
   - Server-side intent execution (server/intentExecution.js, server/intents.js)
   - کد تکراری نساز.

۲) ماژول‌های زیر را در `src/lib/intent-ai/` اضافه کن:
   - `confirmationGate.js` — immutable summary + CONFIRM / REJECT / CANCEL / REAUTHORIZE
   - `riskEngine.js` — ترکیب token-risk / wallet-risk / MEV / simulation / price-impact / slippage
   - `sessionKeys.js` — scoped, time-bounded session key؛ هرگز raw credential نگه ندارد
   - `brokerAdapter.js` — رابط least-privilege برای Broker / Custodial / Sub-account
   - `walletAdapter.js` — Signer abstraction؛ فقط `(draftOrder) → signedTx`
   - `executionMonitor.js` — monitoring، heartbeat، partial-execution detection
   - `exitPolicy.js` — stop-loss / take-profit / emergency unwind
   - `reconciliation.js` — مقایسهٔ وضعیت on-chain/broker با رسید، صدور receipt صادقانه
   - `failureModes.js` — RECOVERABLE / FAILED / EXPIRED / CANCELLED / PARTIAL_EXECUTION

۳) هر اجرا باید به‌ترتیب از این لایه‌ها عبور کند:
   Intent → Guardian → RiskEngine → ConfirmationGate → SessionKey → Broker/Wallet → Submit → Monitor → Exit → Reconcile → Audit.

۴) **Re-authorization**: هر تغییر مهم در amount / asset / chain / protocol / recipient / slippage / fee / leverage / route / deadline / strategy / external-agent درخواست تأیید مجدد کند.

۵) **Fail-closed errors**: هر دادهٔ ناقص، خطای provider، timeout، یا simulation fail باید به RECOVERABLE یا FAILED منجر شود، نه به اجرا.

۶) **تست**: واحد + Integration در `test/intent-ai/phase2-*.probe.mjs`.
۷) **Build کامل**: `npx vite build` باید بدون خطا بگذرد.
۸) **مستندات**: `docs/INTENT-AI-PHASE2-FA.md`.
۹) **Commit** روی همین برنچ.
۱۰) **Pull Request** به `main`.
۱۱) لینک PR + گزارش فارسی.
۱۲) پرامپت Phase 3 (Multi-Agent Ecosystem) را ارائه بده.

## محدودیت‌های غیرقابل‌مصالحه
- Guardian و Risk Engine و Audit هیچ‌گاه قابل‌غیرفعال‌سازی نیستند.
- هیچ‌وقت کلید خصوصی / seed / mnemonic / master password به Agent یا External Adapter داده نمی‌شود.
- رسید جعلی یا تضمین سود ممنوع.
- Partial execution باید صادقانه به کاربر نمایش داده شود.
- پیش‌مجوز (L3 pre-auth) هرگز جایگزین Confirmation Gate نمی‌شود مگر اینکه کاربر صراحتاً L3 را فعال کرده باشد و تمام policyها معتبر باشند.
