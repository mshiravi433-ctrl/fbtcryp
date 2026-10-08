# بودجهٔ CPU در Vercel — چرا ۴ ساعتِ Fluid Active CPU تمام شد و چه چیزی درست شد

تاریخ: ۲۰۲۶-۱۰-۰۷ · دامنه: `server/app.js`، `server/aiOrchestratorRoutes.js`، `server/intentSloMeter.js`، `server/fios/router.js`، `server/central/toolRouter.js` و ۱۲ پولر کلاینت · بدون وابستگی تازه · بدون حذف هیچ مسیر یا رفتار قبلی
مخاطب: اپراتور `fbt-swap` روی تیم `mshiravi433-ctrls-projects` (پلن Hobby — ۴ ساعت Fluid Active CPU در ماه)

---

## ۰) خلاصه در یک پاراگراف

فرض اولیه این بود که «آپگریدهای هوش مصنوعی و صفحهٔ درک جهانی (FBT Global) مصرف را بالا برده‌اند». **این فرض درست بود، ولی مکانیزمِ مصرف آن‌چیزی نبود که به‌نظر می‌رسید.** سه تخلیهٔ واقعی پیدا شد و هر سه بسته شد: (۱) یک باگ سیم‌کشی که باعث می‌شد هر درخواست زیر `/api/v1/ai/*` بین ۱۲ تا ۶۰ ثانیه معلق بماند — و Vercel برای همان ثانیه‌های معلق پول می‌گیرد، حتی وقتی مرورگر بعد از ۱۲ ثانیه قطع می‌کند؛ (۲) کولد استارتِ گراف ماژول‌ها (~۴۷۰ میلی‌ثانیهٔ CPU برای ماژول‌هایی که آن درخواست هرگز به آن‌ها نمی‌رسد) + پنج پروبِ بوت روی هر instance؛ (۳) پولرهای کلاینت روی تب‌های مخفی و بدون هیچ لایهٔ کش — حدود ۲۹۰۰ درخواست در ساعت به‌ازای هر تبِ بازِ پنهان. هزینهٔ هر درخواستِ گرم تقریباً صفر است (۰ تا ۳۴ میلی‌ثانیهٔ CPU)؛ آن‌چه حساب را خالی کرده بود، «تصادف» گراف سنگین + ثانیه‌های معلق + انبوه فراخوانی‌ها بود، نه خودِ منطق هوش مصنوعی.

---

## ۱) روش اندازه‌گیری (تا اعداد قابل بازتولید باشند)

- محیط: سندباکس لینوکسی ۲ vCPU / ۴ GB، `node v22.22.3`، همان ریپو `fbtcryp` (کامیت `f1c91ad`).
- کولد استارت: هر بار یک **پروسهٔ تازه** (`node --input-type=module -e "await import('./server/app.js')"`)، اندازه‌گیری با `process.cpuUsage()` **داخل خود پروسه** (نه `/proc` و نه زمان دیوار — تا نویز کانتینر وارد عدد نشود).
- هر ردیف با n≥۴ نمونه و گزارش **کمینه** (کم‌آلوده‌ترین نمونه) — جعبهٔ آزمایش ۲ هسته دارد و نویز دارد.
- درخواست‌ها: بوت واقعی `server/index.js` روی یک پورت محلی + `fetch`؛ مصرف CPU از دلتای `/proc/<pid>/stat` بین قبل و بعد از پنج درخواست گرم.
- پروب‌های HTTP: واقعی (بدون کلید ارائه‌دهنده و بدون دسترسی خروجی شبکه در سندباکس).

> محدودیت صریح: این اعداد روی این سندباکس درآمده‌اند. Vercel CPU را بر مبنای Active CPU و بهازای GB-s حساب می‌کند و ممکن است عدد مطلق متفاوت باشد؛ آن‌چه قابل اتکاست **نسبت‌ها و دلتاها** است، چون هر دو سو (قبل/بعد) با یک اسکریپت و یک محیط اندازه‌گیری شده‌اند.

---

## ۲) تخلیهٔ ۱ — درخواست‌هایی که تا پایان مهلت تابع باز می‌ماندند (بزرگ‌ترین قلم)

### نشانه

روی درخت «قبل از اصلاح»، با بوت تازه:

| مسیر | قبل از اصلاح | بعد از اصلاح |
|---|---|---|
| `GET /api/v1/ai/orchestrator/graph` | **معلق تا ابطال کلاینت — ۵۰٬۰۰۲ ms** | `200` در ۵ ms |
| `GET /api/v1/ai/status` | **معلق — ۵۰٬۰۰۱ ms** | `404` در ۴۰۳ ms (فقط اولین بار؛ بار بعد ۱۰ ms) |
| `GET /api/v1/ai/zzz-not-a-route` (هر مسیر نامعلوم زیر این mount) | **معلق — ۵۰٬۰۰۲ ms** | `404` در ۳ ms |
| `GET /api/v1/ai/memory/stats` | معلق | `200` در ۳ ms |
| `GET /api/v1/ai/{tools,gateway/health,os/state,monitors}` | ۲۰۰ سالم (mount قبلی) | ۲۰۰ سالم (۲ تا ۹ ms) |

### علت ریشه‌ای

`server/aiOrchestratorRoutes.js` به‌جای **نمونهٔ روتر**، خودِ **کارخانهٔ** ساخت روتر را `export default` کرده بود:

```js
export default createOrchestratorRouter;   // ← اشتباه
```

Express آن را مثل یک middleware صدا می‌زد: تابع با `(req,…)` فراخوانی می‌شد، `req` را به‌عنوان «تنظیمات» می‌خواند، یک روتر می‌ساخت که کسی mount نمی‌کرد و **هیچ‌وقت `next()` را صدا نمی‌زد**. نتیجه: هر درخواستی که به این mount می‌رسید (مسیرهای Upgrade-14 و هر مسیر نامعلوم زیر `/api/v1/ai`، چون هیچ چیز بعد از آن اجرا نمی‌شد) تا `maxDuration: 60` ثانیه باز می‌ماند.

### چرا این گران‌ترین قلم بود

- Vercel برای **Active CPU** هزینه می‌گیرد؛ درخواست بازمانده همان CPU فعال است. یک درخواست معلق تا ۶۰ ثانیه = ۶۰ ثانیه از ۱۴٬۴۰۰ ثانیهٔ بودجهٔ ماه (۱/۲۴۰ بودجه با **هر درخواست**).
- قطع کردن کلاینت به درد حساب نمی‌رسد: `AbortSignal` مرورگر اتصال را می‌بندد، ولی نمونهٔ تابع تا اتمام مهلت خودش به کار ادامه می‌دهد و همان billed می‌شود.
- ۲۴۰ درخواست از این نوع = کل بودجهٔ ۴ ساعته. با پولرهای زیر (`/memory/*`، افشای مسیرهای قدیمی APK، خزنده‌ها، رفرش تب) این عدد در چند روز جمع می‌شود.
- بدتر: این باگ **ابزار اندازه‌گیری خودمان را کور کرده بود**. `/api/intents/v1/slo-status` از `res.on('finish')` نمونه برمی‌داشت؛ درخواستی که تمام نمی‌شد هیچ نمونه‌ای ثبت نمی‌کرد، پس p99 سالم به‌نظر می‌رسید.

### اصلاح

1. `server/aiOrchestratorRoutes.js` → `export default createOrchestratorRouter({…})` (نمونهٔ روتر) + توضیح دقیق حالت شکست در انتهای فایل.
2. `lazyMount` در `server/app.js` حالا هر exportی که middleware واقعی نیست را رد می‌کند:
   `lazyMount:<label>:NOT_A_MIDDLEWARE (arity N)` → دیگر نمی‌شود یک کارخانهٔ فراموش‌شده را بی‌صد صدا زد، خطا در لحظهٔ import داده می‌شود نه در لحظهٔ درخواست.
3. **نگهبان بن‌بست (stall watch)** در `server/intentSloMeter.js`: هر درخواستِ در حال اجرا اگر از `SLO_STALL_MS` (پیش‌فرض ۱۰ ثانیه، `0` برای خاموش کردن) بگذرد، یک نمونهٔ stall ثبت می‌کند و **یک خط لاگ** با method و path (بدون query) می‌نویسد؛ مسیرهای SSE (`/stream`) از این قاعده مستثنا هستند چون عمداً باز می‌مانند. اعداد در `/api/intents/v1/slo-status` زیر `stalledRequests` / `stalls.routes` منتشر می‌شوند. این نگهبان دقیقاً همان چیزی است که این باگ را در چند ساعت اول نشان می‌داد.

> بازتولید: `node /tmp/…` لازم نیست؛ کافی است دو مسیر بالا را روی یک درخت قبل/بعد صدا بزنید. تست‌های پین‌شده: `test/intent-ai/upgrade14-orchestrator-wiring-probe.mjs` (۱۶/۱۶)، `test/intent-ai/upgrade8-state-api-probe.mjs` (۹/۹).

---

## ۳) تخلیهٔ ۲ — کولد استارت گراف ماژول‌ها

هر instance تازه، **قبل از اولین بایت پاسخ**، کل گراف ماژول `server/app.js` را کامپایل و ارزیابی می‌کند و روی Vercel همین کار اولین قلم Active CPU است. شانزده روتر سنگین (دستور هوش مصنوعی، دروازهٔ `/api/v1/ai`، ارکستراتور، `ci/api`، `fios`، `brain`، `central`، لندینگ/Solana/فیوچرز/جوایز/بیمه/پروتکل) در بوت **گرچه اولین درخواست معمولاً `/api/health` یا یک خواندن قیمت است و به هیچ‌کدام از آن‌ها نمی‌رسد** بارگذاری می‌شدند.

| | wall (کمینه) | **CPU (کمینه)** | RSS |
|---|---|---|---|
| قبل: ۱۶ import سراسری | ۷۰۶–۸۲۸ ms | **۸۷۰ cpu-ms** | ۱۴۳ MB |
| بعد: `lazyMount` (import در اولین درخواستِ رسیده) | ۳۹۸–۴۲۰ ms | **۵۲۰ cpu-ms** | ۱۰۸ MB |

- **≈۳۵۰ میلی‌ثانیهٔ CPU و ≈۳۵ MB حافظه به‌ازای هر کولد استارت** حذف شد (n=4، کمینه به کمینه، همان اسکریپت و همان محیط برای هر دو سو).
- هیچ مسیری حذف نشد: `lazyMount` ترتیب middleware را نگه می‌دارد، prefix را درست trim می‌کند، خطا را به `next(err)` می‌دهد (۵۰۰، نه سوکت مرده) و برای هر mount **single-flight** است (ده درخواست همزمان = یک import).
- ماتریس ۲۷ مسیرهٔ قبل/بعد یکسان است (status، schema، طول بدنه) — از جمله مسیرهایی که به `lazyMount` منتقل نشده‌اند.
- هشدار: تقسیم دینامیکِ روترهای **پرترافیک** یک ضدالگو است؛ اندازه‌گیری شد که گراف را بزرگ‌تر می‌کند (۸۲۴ در برابر ۷۸۹ cpu-ms). تنها importهایی که عقب افتادند مسیرهایی هستند که هیچ درخواستی در کولد استارت به آن‌ها نمی‌رسد.
- یک عارضهٔ جانبی لازم: `toolRouter` حالا `ensureAdaptersInstalled()` دارد (import دینامیک و memoشده)، تا بوتِ تنبل هرگز یک فراخوانی واقعی ابزار را به `MODULE_NOT_REGISTERED` تبدیل نکند.

---

## ۴) تخلیهٔ ۳ — پولرهای کلاینت روی تبِ مخفی (+ ضربان سلامت)

پول یک تب که باز است ولی کسی نگاهش نمی‌کند، هیچ‌چیز به کاربر نمی‌رساند؛ روی هاست سرورلس هر تیک یک فراخوانی تابع و یک شانس برای پرداخت کولد استارت است.

| پولر | دوره | فراخوانی در هر پاس | درخواست در ساعت (تبِ پنهان، **قبل**) | بعد |
|---|---|---|---|---|
| `CentralBrainContext` → `openEventStream` (روی کل اپ، بالای روتر) | ۱۵ s (پس از قطع SSE) | ۱ (`/brain/system/events`) | **۲۴۰** | ۰ |
| `AiGlobalIntelligence` (کنسول جهانی) | ۶۰ s | ۷ | **۴۲۰** | ۰ |
| `ConnectivityAlert` (ضربان) | ۴۵ s | ۱ | **۸۰ فراخوانی** | ۰ (لبه پاسخ می‌دهد) |
| جمع بقیه: `FuturesPositionsCard` ۱۰ s · `ThorPanel` ۱۲ s · `CentralBrainPanel` ۱۵ s · `BuySellPanel`/`IranianBuyPanel` ۱۵ s (سفارش) · `IranianBuyPanel` ۶۰ s (نرخ) · `AiControlCenter` ۳۰ s · `FinancialIntelligencePanel` ۳۰ s · `SmartMoneyIntelligence` ۳۰/۹۰ s · `ActivationDashboard` ۶۰ s × ۴ اندپوینت · `IntentAIUnified` ۶۰ s (+ ارزیابی سرور) · `RewardsDashboard` ۶۰ s · `FundingPanel` ۵ min | — | — | ≈۲۱۰۰ | ۰ |

**جمع: ≈۲۹۰۰ درخواست در ساعت به‌ازای هر تبِ بازِ پنهان (≈۷۰ هزار در روز).**

اصلاحات:

- `src/lib/visibilityPoll.js` (تازه): `pollWhileVisible(cb, ms)` — تیک در تبِ پنهان **اجرا نمی‌شود** و لحظه‌ای که تب برمی‌گردد **یک بار درجا** اجرا می‌شود (هیچ صفحه‌ای کهنه نمی‌ماند). معیار تشخیص عمداً `visibilityState === 'hidden'` است (نه `document.hidden`) تا محیط تست (jsdom با `prerender`) پول‌ها را خشک نکند.
- ۱۲ کامپوننت + پولر سوآپ با همین helper همگرا شدند؛ `connectivity-alert` هم دیگر `?_fbt_probe=<ts>` و `cache:'no-store'` نمی‌فرستد، چون کلید کشِ یکتا یک کش را بی‌اثر می‌کند.
- `openEventStream` (جریان رویداد مغز) هنگام پنهان شدن تب **ترنسپورت‌ها را می‌بندد** (نه اینکه «قطع» اعلام کند — پنهان یعنی «کسی نمی‌بیند»، نه «آفلاین») و بازگشت به تب اتصال را برمی‌گرداند + یک `readOnce()` جبرانی می‌زند تا هیچ رویدادی از دست نرود.
- `/api/health` که تا دیروز بی‌کش بود و هر ۴۵ ثانیه به‌ازای هر تب فراخوانی می‌شد، حالا `public, max-age=5, s-maxage=15, stale-while-revalidate=45` دارد: مرورگر همچنان یک رفت‌وبرگشت واقعی به دامنه انجام می‌دهد (این معنای تست اتصال است) ولی تابع بیدار نمی‌شود.
- `/global/*` روی `/api/ai` که هیچ cache-directive نداشت، حالا `private, max-age=20..60` می‌گیرد و خواندن‌های `?refresh=1` (دکمهٔ رفرش کاربر) `no-store` می‌مانند — چون سرویس‌دهی یک پاسخ کش‌شده به درخواستِ «دادهٔ تازه بده» دروغ است. (این مسیرها owner-scoped هستند، پس `public` هرگز مجاز نیست.)

---

## ۵) تخلیهٔ ۴ — پروب‌های بوت روی هر instance

بلوک «Auto-evidence collection» در `server/app.js` ۲۰۰ میلی‌ثانیه بعد از **هر بوت** پنج پروب اجرا می‌کرد (`autoInjectEvidence`، `runSelfProbe` با TLS واقعی، `runOpsProbe` با نوشتن/بازگردانی، `runStage3Probe`، `runLaterPhaseProbe` با ۳۶ بررسی) و روی Vercel یک read-modify-write روی Blob هم داشت. این‌ها برای یک داشبورد وضعیت لازم بودند که درخواستی ازشان نپرسیده بود.

اندازه‌گیری روی مسیر بوت (که در جدول‌های `app.js` هم نقل شده):

| | CPU در شش ثانیهٔ اول |
|---|---|
| `INTENT_BOOT_PROBES=0` | ۴۹۰ cpu-ms (کار پروب‌ها: ~۴ cpu-ms — short-circuit خودِ پروب‌ها) |
| `INTENT_BOOT_PROBES=1` | ۶۴۱–۶۵۵ cpu-ms (کار پروب‌ها: ~۱۱۶ cpu-ms) |
| بدون short-circuit (پروب‌های واقعی، انبار شواهد تازه) | تا ≈۷۲۰ cpu-ms (جمع un-throttled: selfProbe ۹۶ + opsProbe ۱۱۰ + stage3 ۱۲۰ + laterPhase ۲۰۵ + autoEvidence ۱۸۸ + ~۳۸ import) |

اصلاح: بلوک روی هاست سرورلس **خاموش** است (`VERCEL|VERCEL_ENV|AWS_LAMBDA_FUNCTION_NAME`)، با کلید دستی `INTENT_BOOT_PROBES=1/0` و یک خط لاگ که به اپراتور می‌گوید شواهد از کجا می‌آید. هیچ شاهدی از دست نرفت: `/api/cron/daily` همان پنج پروب را اجرا و ذخیره می‌کند و اندپوینت‌های `on-demand` (`/api/intents/v1/self-probe`، `ops-probe`، `stage3-digest`، `evidence-status`) سرِ جای خود هستند. میزبان بلندعمر (APK/self-host) همان رفتار قبلی را دارد.

---

## ۶) پاسخ صریح به فرضیهٔ کاربر

> «قطعاً فکر می‌کنم آپگریدهای هوش مصنوعی و FBT Global باعث شد.»

**بله، سطح‌های AI/Global بیشترین حجم درخواست را تحمیل می‌کردند — ولی هزینهٔ خودِ منطقشان ناچیز است.** اندازه‌گیری گرم (به‌ازای هر درخواست):

| مسیر | CPU/درخواست (گرم) |
|---|---|
| `/api/ai/global/intelligence?refresh=1` (بازسازی کامل snapshot، ۹ دامنه) | ۴۰ cpu-ms |
| `/api/ai/global/cross-asset?refresh=1` | ۳۴ cpu-ms |
| `/api/news` (در سندباکس ۵۰۲ می‌دهد چون خروجی شبکه نیست) | ۳۴ cpu-ms |
| `/api/intents/v1/public-status` (بدنهٔ ۴۵ KB) | ۱۰ cpu-ms |
| `/api/ai/global/{intelligence(cached),briefing,providers}` | ۰–۴ cpu-ms |
| `/api/activation`, `/api/health`, `/api/version`, `/api/ai/status` | ≈۰–۲ cpu-ms |

یعنی ۱٫۱ میلیون درخواست از این مسیرها هم به‌تنهایی ۴ ساعت CPU نمی‌شود؛ آن‌چه بودجه را برد **تصادفِ سه چیز** بود: گراف سنگین در هر کولد استارت، ثانیه‌های معلقِ باگ mount، و انبوه فراخوانی‌های بی‌مصرف از تب‌های پنهان — که هر سه هم با معرفی همین قابلیت‌های تازه (کنسول جهانی، مغز مرکزی، ارکستراتور) وارد اپ شده بودند. پس تشخیص «کد مزاحم/تداخل» هم بی‌ربط نبود: تداخل واقعی همان `export default` اشتباه بود که یک خانوادهٔ کامل از مسیرها را قفل می‌کرد.

---

## ۷) فهرست تغییرات

| فایل | تغییر |
|---|---|
| `server/aiOrchestratorRoutes.js` | `export default` = نمونهٔ روتر (قبلاً کارخانه) + توضیح حالت شکست |
| `server/app.js` | ۱۶ import سراسری → `lazyMount`/`ensure*`؛ نگهبان arity در `lazyMount`؛ گیت پروب‌های بوت؛ هدر کش `/api/health`؛ انتشار `stalls` در `/api/intents/v1/slo-status` |
| `server/intentSloMeter.js` | نگهبان بن‌بست: نمونهٔ stall + لاگ یک‌باره به‌ازای مسیر + `sloStallSnapshot()` |
| `server/central/toolRouter.js` | `ensureAdaptersInstalled()` (import دینامیک memoشده) |
| `server/fios/router.js` | `cacheOwnerRead()` روی چهار مسیر `/global/*` (`private` + `no-store` برای refresh) |
| `src/lib/visibilityPoll.js` (تازه) | `pollWhileVisible` + `isPollHidden` |
| `src/lib/central/client.js` | `openEventStream` روی تب پنهان ترنسپورت را می‌بندد، بازگشت = اتصال + خواندن جبرانی |
| `src/components/ConnectivityAlert.jsx` | URL پایدار `/health` بدون timestamp/no-store |
| `src/components/ai/AiGlobalIntelligence.jsx` | ۶۰ s → ۱۸۰ s + توقف روی تب پنهان |
| ۱۲ کامپوننت (Futures / Thor / BuySell / IranianBuy / AiControlCenter / Funding / Activation / Rewards / CentralBrain / FinancialIntelligence / SmartMoney / IntentAIUnified) | پول‌های شبکه‌ای → `pollWhileVisible` |
| `test/wiring.mjs` | audit مسیرها حالا mountهای تنبل را هم می‌شمارد (وگرنه یک مسیر سالم را «unrouted» گزارش می‌کرد) |
| `test/intent-ai/upgrade14-…-probe.mjs`، `upgrade8-…-probe.mjs` | انتظارات به شکل `lazyMount` به‌روز شد |
| `test/visibility-poll.test.js` (تازه) | ۷ تست: عدم تیک در تب پنهان، تیک درجا در بازگشت، پاک‌سازی، استثنای پرتاب‌شده |

---

## ۸) تأیید (چه چیزی واقعاً اجرا شد)

| بررسی | نتیجه |
|---|---|
| `/api/v1/ai/{status,orchestrator/*,memory/*}` روی بوت تازه | بدون هیچ timeout؛ ۳–۵ ms (قبلاً ۵۰٬۰۰۰ ms) |
| ماتریس ۲۷ مسیر قبل/بعد | یکسان (status/schema/طول) |
| `test/wiring.mjs` | ۲۸۶۲ ردیف، **۳۳ خطا** — دقیقاً همان مجموعهٔ قبل از این تغییرات (بدون رگرسیون) |
| `npm run test:upgrade14` | همه سبز: graph ۱۳/۱۳، plan ۱۳/۱۳، vector ۱۵/۱۵، judge ۱۳/۱۳، broker ۱۵/۱۵، panel ۱۰/۱۰، ledger ۱۳/۱۳، **wiring ۱۶/۱۶** |
| `npm run test:upgrade8` (probe وضعیت) | ۹/۹ |
| `npm run test:fios` / `test:phase211` | ۱۵۹/۱۵۹ · ۶۴/۶۴ · ۵۴/۵۴ · ۸۵ + ۱۳ + ۱۸ (همه سبز) |
| `node test/intent-ai/earnable-evidence-probe.mjs` / `wave1-chain-infra-probe.mjs` | ۵۲ سبز · ۲۵ سبز (با نگهبان stall) |
| `npx vitest run` روی فایل‌های دست‌خورده + تست تازهٔ visibility | ۹ فایل، ۱۲۶ تست سبز |
| `npx vite build` (باندل واقعی) | EXIT=0 |
| خطای جدید در `npx vitest run` کامل در مقایسه با خط پایه | **هیچ** (۲۵ فایل خطادار قبلی و بعدی یکسان — همه مربوط به محیط/حافظهٔ سندباکس، نه این تغییرات) |

ناسازگاری شناخته‌شده و بی‌ربط: `npm test` کامل در این جعبه در مرحلهٔ `vite build` با `status 137` (کم‌آوردن حافظهٔ سندباکس ۴ GB) کشته می‌شود؛ همان بیلد با `--max-old-space-size=3072` تنها، موفق است. خط پایه هم همین رفتار را دارد.

---

## ۹) باقی‌مانده و توصیهٔ عملیاتی

1. **`maxDuration: 60` در `vercel.json` نگه داشته شد.** عمدی: کرون‌های واقعی (`/api/cron/daily`، `/api/cron/train`) و جریان SSE به آن نیاز دارند. اگر روزی خواستید سقفِ خرابی یک باگ را پایین بیاورید، گزینهٔ درست محدودکردن **per-route** است، نه عدد سراسری.
2. **پولرهای باقی‌مانده که عمداً دست نخوردند:** `Header` (خواندن حافظهٔ محلی، بدون درخواست)، `useMarket`/`usePoll` (از قبل گارد visibility دارند)، `useFarmYields`، `DerivativesDashboard`، `WhaleTrackingPanel`، `WalletContext` (۳۰ s، فقط تب visible) — همه از قبل درست بودند.
3. **حساب‌های درون‌حافظه‌ای** (نرخ‌های AI، باکت‌های `ciHits`) با هر کولد استارت صفر می‌شوند؛ این طراحی عمدی است، ولی یعنی محافظت واقعی باید در لبه/کش باشد، نه در شمارندهٔ پروسه.
4. **پایش بعدی (روی داشبورد Vercel):**
   - `Fluid Active CPU` باید به‌شدت افت کند؛ اگر نکرد، اولین جای نگاه `stalledRequests` در `/api/intents/v1/slo-status` است.
   - `Invocations` برای `/api/health` باید نزدیک صفر شود (لبه پاسخ می‌دهد؛ در لاگ‌های توابع این مسیر را دیگر نباید ببینید).
   - اگر لاگ `[slo] stalled request: …` دیدید، یعنی یک mount دیگر هم `next()` را صدا نمی‌زند — همان الگوی امروز.
5. **قبل از هر انتشار،** `npm run test:upgrade14` و `test/visibility-poll.test.js` را اجرا کنید؛ اولی شکل mountها را پین می‌کند و دومی رفتار پول‌ها را.

---

## ۱۰) بازتولید اعداد کولد استارت

```bash
# کولد استارت (n نمونه، کمینه را بخوانید)
node -e '
const { spawn } = require("node:child_process");
const code = `const t0=Date.now();const b=process.cpuUsage();
await import("/path/to/server/app.js");
const c=process.cpuUsage(b);
process.stdout.write("CPU " + ((c.user+c.system)/1000).toFixed(1) + " ms  wall " + (Date.now()-t0) + " ms\\n");';
spawn(process.execPath, ["--input-type=module","-e",code],
  { env: { ...process.env, VERCEL: "1", INTENT_BOOT_PROBES: "0" }, stdio: "inherit" });'

# بن‌بستِ mount: باید ۴۰۴/۲۰۰ در چند میلی‌ثانیه باشد، نه ۶۰ ثانیه
node server/index.js &            # PORT=8799
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' localhost:8799/api/v1/ai/status
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' localhost:8799/api/v1/ai/orchestrator/graph

# نگهبان بن‌بست: با آستانهٔ کوچک
SLO_STALL_MS=400 node server/index.js &   # و بعد /api/intents/v1/slo-status را ببینید
```
