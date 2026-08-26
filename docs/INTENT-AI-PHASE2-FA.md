# FBT Intent AI — فاز ۲: Controlled Execution

## هدف
لایهٔ اجرا از Draft/TermsHash تا submit، مانیتور، Exit، Reconciliation و Confirmation Gate — همه تحت Guardian و Risk Engine با معناشناسی Fail-closed.

## ماژول‌ها (`src/lib/intent-ai/`)
| ماژول | نقش |
|---|---|
| `confirmationGate.js` | قفل TermsHash، دکمه‌های CONFIRM/REJECT/CANCEL/REAUTHORIZE |
| `confirmationUI.js` | بلوک تغییرناپذیر UI |
| `riskEngine.js` | ترکیب token/wallet/MEV/simulation/price-impact/slippage → allow/acknowledge/block |
| `sessionKeys.js` | کلید نشست scoped/time-bounded؛ بدون raw secret |
| `secureMemoryMap.js` | جایگزین موقت Secret Manager (فاز ۳) |
| `walletAdapter.js` | فقط sign؛ هرگز submit نمی‌کند |
| `brokerAdapter.js` | Least-privilege + idempotency؛ برداشت نیازمند policy جدا |
| `executionMonitor.js` | heartbeat، تأیید، partial، timeout، Emergency Stop |
| `exitPolicy.js` | SL/TP/trailing/unwind فقط از مسیر Guardian |
| `reconciliation.js` | رسید صادقانه؛ جعل COMPLETED ممنوع |
| `failureModes.js` | RECOVERABLE/FAILED/EXPIRED/CANCELLED/PARTIAL_EXECUTION |
| `controlledExecution.js` | خط لولهٔ الزامی اجرا |

## تصمیمات امنیتی
- Guardian غیرقابل‌غیرفعال است.
- بدون Confirmation Gate هیچ submitی رخ نمی‌دهد.
- تغییر مواد → OPTIMIZING + reauthorisationRequired.
- Agent هرگز credential خام نمی‌گیرد.
- Emergency Stop همهٔ session keyهای policy را revoke می‌کند.
- Partial fill با مقدار واقعی گزارش می‌شود.

## تست‌ها
`test/intent-ai/phase2-*.mjs` از `npm test` اجرا می‌شوند.

## باقی‌مانده برای فاز ۳
- Secret Manager واقعی به‌جای SecureMemoryMap
- اتصال live به liquidity routers
- اکوسیستم چند-ایجنت با capability token محدود
