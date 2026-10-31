# FBT — Autonomous Intelligence 2.0

## مرحلهٔ ۱ — ممیزی پیش از تغییر

تاریخ: 2026-10-31 · مبنای بررسی: `13d05a5` · شاخهٔ کار: `arena/d5054481-fbtcryp`

این گزارش از خواندن کد و اجرای آزمون‌ها تهیه شده است. وجود فایل، نام Agent یا پاسخ `ok:true` به‌تنهایی شاهد عملیاتی‌بودن محسوب نشده است. گزارش مرحله‌های بعد و نتایج اجرای واقعی در پایان همین سند اضافه می‌شود.

### معماری موجود که حفظ می‌شود

| زیرسیستم | مسیر واقعی | یافته |
|---|---|---|
| پوستهٔ مشترک API | `server/app.js`, `server/index.js`, `api/index.js` | Express مشترک برای Node و Vercel؛ ماژول‌های سنگین با `lazyMount` بارگذاری می‌شوند. |
| AI Gateway | `server/aiGateway.js` |.providerهای واقعی، failover، سلامت و پاک‌سازی prompt دارد؛ هزینهٔ دلاری و usage هنوز قرارداد یکپارچه ندارند. |
| AI Orchestrator | `server/aiOrchestrator.js`, `server/aiOrchestratorRoutes.js` | گراف plan→gather→analyze→judge→decide→learn واقعی است؛ یک turn محدود، نه صف مأموریت دائمی. |
| Intent OS | `server/aiIntentOS.js`, `src/pages/IntentAIUnified.jsx` | مسیر چت/قصد و handoff امضا حفظ می‌شود؛ امضای مرورگر معادل رسید قطعی زنجیره نیست. |
| Agent Hub / A2A | `server/agentHub/*` | کشف، consent، idempotency، اتصال و اجرای native/A2A موجود است؛ native در همان فراخوانی اجرا می‌شود و worker پایدار ندارد. |
| MCP | `mcp/*`, `server/protocolRoutes.js` | پل ابزار و پروتکل مستقل موجود است؛ نباید با صف داخلی جایگزین شود. |
| Memory / RAG | `src/lib/intent-ai/orchestrator/*`, `server/fios/memory.js`, `server/walrusMemoryBridge.js` | RAG و ledger موجود؛ backend و دوام به تنظیمات وابسته است. بعضی حافظه‌ها process-local هستند. |
| AI Judge / Consensus | `src/lib/intent-ai/orchestrator/judge.js`, `server/aiConsensus.js` | قضاوت شواهد‌محور و اختلاف نظرها واقعی است؛ اجماع مدل‌ها اثبات انجام عملیات نیست. |
| Decision Ledger | `src/lib/intent-ai/orchestrator/decisionLedger.js` | ثبت تصمیم و اصلاح ترتیب ابزار/تعداد seat دارد؛ ذخیرهٔ Blob آن برای queue اتمی مناسب نیست. |
| Financial OS | `server/fios/*`, `server/central/*`, `server/ci/*` | policy، ریسک، شواهد، council، simulation و handoff موجود؛ چند مسیر state و چند owner derivation متفاوت دارند. |
| Evidence موجود | `server/fios/evidence.js`, `server/intent*Verification.js` | envelope و verification برای حوزه‌های مختلف موجود است؛ دریافت متن Agent به‌تنهایی هنوز در مسیر FI می‌تواند evidence ثبت کند. |
| Smart Money | `server/smartMoney/*`, `server/whales.js` | خواندن واقعی DEX/RPC/explorer و پوشش صریح دارد؛ whale transfer لزوماً خرید نیست. |
| Scheduler / Monitor قدیمی | `server/intentScheduler.js`, `server/intentMonitor.js` | اولی فقط مجوز را بررسی می‌کند؛ دومی heartbeat حافظه‌ای دارد و در اولین خواندن heartbeat خودش را می‌سازد. این‌ها اثبات پردازشگر دائمی نیستند. |
| ذخیره‌سازی عمومی | `server/store.js`, `server/fios/collections.js` | Blob یا Map؛ read-modify-write آن last-writer-wins است. برای lease و صف رقابتی کافی نیست. |
| رابط موجود | `src/App.jsx`, `src/components/MoreSheet.jsx` | صفحه‌ها و مسیرهای موجود حفظ می‌شوند؛ Mission Control مسیر افزایشی مستقل خواهد داشت. |

### Mock، ناقص یا فاقد اتصال واقعی

1. **`server/aiMarketEngineRoutes.js`**: در مسیر market-prediction، حجم معاملات با `Math.random` ساخته می‌شد؛ نبود کندل به قیمت‌های ساختگی برمی‌گشت؛ on-chain و sentiment ثابت بودند. این مسیر نباید خروجی ساختگی را live بنامد. اصلاح افزایشی: حفظ endpoint و رد صریح دادهٔ ناموجود؛ شبیه‌سازی فقط با برچسب و درخواست جداگانه مجاز است.
2. **`server/fios/agentRuntimeOps.js`**: session/scope/kill switch واقعی، ولی sessionها در Map و `executionGranted:false` هستند؛ این ماژول worker queue نیست.
3. **`server/fios/evidence.js`**: `record()` ورودی معمولی را می‌پذیرد و حتی شکست ذخیره‌سازی را در آرایهٔ شواهد برمی‌گرداند. برای مأموریت جدید، فقط receipt ابزار معتبر با digest و راستی‌آزمایی مستقل پذیرفته می‌شود؛ API قدیمی حذف نمی‌شود.
4. **`server/agentHub/native/index.js`**: اجرای native واقعی است ولی هم‌زمان در request؛ خروجی متنی آن به‌تنهایی معیار تکمیل مأموریت نخواهد بود.
5. **`server/intentScheduler.js` و `server/intentMonitor.js`**: evidence قراردادی/حافظه‌ای دارند، نه پردازشگر پایدار. مسیرهای قدیمی حفظ و وضعیت runtime واقعی جداگانه گزارش می‌شود.
6. **دوام و مالکیت**: device header در بخش‌های قدیمی scope است نه احراز هویت قوی. Mission Control شناسهٔ تصادفی پرآنتروپی، مالکیت HMACشده و رد درخواست بدون هویت دارد. IP مالک مأموریت نمی‌شود.
7. **استقرار**: `vercel.json` تابع با سقف ۶۰ ثانیه و cronهای محدود دارد. `setInterval` داخل تابع، اجرای دائمی پس از بسته‌شدن صفحه را تضمین نمی‌کند. runtime جدید به process پایدار Node و دیسک پایدار نیاز دارد؛ حالت serverless بدون worker باید `UNAVAILABLE` بگوید.
8. **اجرای مالی خودکار**: کلید خصوصی در runtime جدید وجود ندارد. تأیید یک مأموریت مالی به‌معنی امضای خودکار نیست؛ handoff به مسیر موجود کیف پول و رسید مستقل لازم است. مأموریت دارای اثر مالی نامعلوم هرگز خودکار retry نمی‌شود.

### خط مبنای آزمون‌ها

| آزمون | نتیجه پیش از تغییر |
|---|---|
| `npm run build` | موفق؛ بیلد کامل و بودجهٔ first-paint، ۲۵۸ صفحهٔ landing. هشدار chunkهای بزرگ از قبل وجود دارد. |
| چهار فایل selected agent-hub | ۸۵ موفق، ۱ ناموفق: تست بودجهٔ Solana انتظار ۳ فراخوانی دارد ولی کد فعلی ۴ فراخوانی انجام می‌دهد. |
| `npm run test:upgrade14` | هر ۸ مجموعه موفق: graph 13، plan 13، vector/RAG 15، judge 13، broker 15، panel 10، ledger 13، wiring 16. |
| `npm run test:fios` | مجموعه‌های core/autonomy/intelligence/phase210/phase211 اجرا شدند؛ inventory قدیمی ۱۱ موفق و ۲ ناموفق دارد: snapshot قدیمی `/trade → Trade` را حذف‌شده می‌بیند و تعداد مسیرها ۶۴→۷۲ شده است. هیچ مسیر backend حذف نشده بود. |
| نصب وابستگی | `npm ci` عادی به علت entry ناسازگار `fsevents` در lockfile شکست خورد؛ نصب با `--force --ignore-scripts` موفق شد. lockfile تغییر نمی‌دهیم. Node میزبان 22 است؛ قرارداد پروژه Node 24 است و آزمون‌های جدید با Node 24 اجرا می‌شوند. |

این دو شکاف مبنایی پنهان نمی‌شوند و با passing شدن آزمون‌های جدید «موفق» جا زده نمی‌شوند. فایل‌های snapshot که تست قدیمی بازنویسی کرده بود به حالت مبنا برگردانده شدند.

### تصمیم معماری افزایشی

- هستهٔ جدید در `server/missionControl/` و مسیر `/api/v1/missions`؛ هیچ router یا صفحهٔ موجود جایگزین نمی‌شود.
- SQLite داخلی Node 24 روی volume پایدار، transaction و `BEGIN IMMEDIATE` برای صف، lease، idempotency و بازیابی؛ این storage مخصوص هستهٔ جدید است و دادهٔ قدیمی را مهاجرت/حذف نمی‌کند.
- worker پایدار، صف وابستگی‌دار، timeout/retry/circuit breaker، شواهد خام و verification جدا از تولید متن.
- adapterها به Smart Money، بازار، اخبار، RAG، Gateway، Judge و Consensus موجود متصل می‌شوند؛ مدل اضافه فقط در صورت نیاز و بودجهٔ صریح.
- Opportunity و World Intelligence فعلاً کریپتو؛ schema دارای asset class و instrument برای توسعهٔ بعدی.
- سیاست، توقف اضطراری، audit، هزینه و یادگیری برگشت‌پذیر در همان transaction store.
- UI فقط مصرف‌کنندهٔ API است؛ بستن صفحه اجرای سمت سرور را متوقف نمی‌کند.
