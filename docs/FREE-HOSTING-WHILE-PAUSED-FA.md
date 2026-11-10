# سایت در حالت مکث است — دفترچهٔ راهنمای برگشت (بدون پرداخت)

**تاریخ:** ۲۰۲۶-۱۱-۱۰ · **علت مکث:** `fluidCpuDuration` (۱۰۳٪ از ۴ ساعت) ·
**پایان خودکار مکث:** ۲۰۲۶-۱۲-۱۰ · **هزینهٔ راه‌حل‌های این سند:** صفر

این سند سه مسیر را به‌ترتیب اولویت می‌آورد. مسیر ۱ رایگان است و سریع‌ترین؛ مسیر ۲
اگر پشتیبانی سریع جواب نداد سایت را همان روز بالا می‌آورد؛ مسیر ۳ کاری است که بعد از
برگشت باید انجام شود تا دوباره تکرار نشود.

---

## ۰. چک‌لیست کارهایی که کامیت انجامشان نمی‌دهد

کدِ کاهش مصرف در همین شاخه است، ولی چهار کار **فقط دستی** ممکن است. اگر هیچ‌کدام را
انجام ندهید، سایت باز می‌شود ولی مصرف همچنان بالا می‌ماند:

| # | کار | جای انجام | چرا دستی |
|---|---|---|---|
| ۱ | محتوای `ci/order-watch-tick.yml` را روی `.github/workflows/order-watch-tick.yml` جای‌گذاری و commit کنید | GitHub، همین ریپو | گیت‌هاب کامیتِ ابزار خودکار در `.github/workflows/` را رد می‌کند (`refusing to allow a GitHub App to create or update workflow`) |
| ۲ | `CRON_SECRET` را در Settings → Secrets and variables → Actions چک کنید | GitHub | بدون آن، همین تیک هم اجرا نمی‌شود (خودش warning می‌دهد) |
| ۳ | تیکت برداشتن مکث بزنید (§۱) | vercel.com/help | تصمیم با پشتیبانی است، نه با کد |
| ۴ | یک‌بار `main` را بعد از باز شدن حساب deploy کنید | Vercel | تا حساب باز نشود build هم اجرا نمی‌شود |

> نکتهٔ مهم دربارهٔ شاخه‌ها: کاهش‌های سمت کلاینت و سرور فقط وقتی روی سایت اثر دارند که
> روی **`main`** باشند. `vercel.json` صریحاً `"deploymentEnabled": { "arena/*": false }`
> دارد، یعنی شاخهٔ `arena/...` عمداً deploy نمی‌شود. مرج به `main` = استقرار.

---

## ۱. درخواست برداشتن مکث (رایگان، معمولاً چند روز)

مکث به‌صورت `unpauseAt` روی حساب نوشته شده، ولی Vercel در عمل وقتی **مصرف پنجرهٔ ۳۰ روز
غلتان به زیر ۱۰۰٪ برگردد** حساب را زودتر باز می‌کند. الان روی **۱۰۳٪** است؛ یعنی فقط
باید روزهای سنگین از پنجره بیرون بروند.

1. **هر روز یک‌بار** این مسیر را ببین:
   `vercel.com` → تیم `mshiravi433-ctrl's projects` → **Usage** → تب **Fluid Active CPU**.
   عدد باید از ۱۰۳٪ پایین بیاید. تا وقتی بالای ۱۰۰٪ است، درخواست دادن فایده ندارد.
2. وقتی زیر ۱۰۰٪ رفت، به **vercel.com/help** برو و تیکت بزن. متن آماده (همان چیزی که در
   انجمن Vercel برای همین حالت جواب می‌گیرد):

> **Subject:** Request to unpause Hobby team — Fluid Active CPU usage is back under the limit
>
> Hello,
>
> My Hobby team `mshiravi433-ctrls-projects` was soft-blocked on 2026-11-10 for
> `fluidCpuDuration` (it briefly reached 103% of the 4-hour allowance). Our Usage page now
> shows the rolling 30-day figure back **below** the included limit.
>
> I have already shipped the fix that caused the spike, and it is waiting to deploy:
>
> - the only trigger that ran with zero traffic (a scheduled 5-minute tick) is now every
>   20 minutes — 288 → 72 invocations per day;
> - one screen polled 5 endpoints every 5 seconds (60 requests/minute from a single tab);
>   it now polls every 30 seconds (10/minute);
> - four other screens no longer poll in hidden tabs, and two halved their rate;
> - the app now meters Fluid Active CPU per route (`/api/usage/cpu`) so I can see the cost
>   of every endpoint instead of guessing.
>
> Estimated effect: roughly a 6–8× reduction in daily function CPU for the same traffic. I
> will monitor the per-route report daily and keep it under 100%.
>
> Could you please unpause the team so I can deploy the fix and confirm the numbers?
>
> Thanks.

3. اگر جواب نداد، ۱۰ دسامبر مکث خودبه‌خود برداشته می‌شود؛ مسیر ۲ تا آن روز سایت را زنده
   نگه می‌دارد.

> **کاری که نکنید:** ساختن تیم/حساب دوم برای دور زدن سقف Hobby. این نقض قواعد استفادهٔ
> منصفانه است و نتیجه‌اش بلاک شدن هر دو حساب است.

---

## ۲. بالا آوردن سایت روی میزبان رایگان (همان روز)

منطق: Vercel مکث شده و **build هم نمی‌سازد**، پس کد اصلاح‌شده تا باز شدن حساب قابل
استقرار نیست. یک میزبان رایگان که «زمان CPU» را صورت‌حساب نمی‌کند (فقط ساعت اجرا یا
درخواست) سایت را با همان کد — نه یک نسخهٔ جداگانه — بالا می‌آورد:

`server/index.js` همان `server/app.js` سرورless را import می‌کند، `dist/` را سرو می‌کند و
روی `0.0.0.0` گوش می‌دهد. پس یک کانتینر کافی است؛ `Dockerfile` در ریشهٔ مخزن همین کار
را می‌کند.

### ۲.۱ ساخت ایمیج (یک‌بار)

`npm run build` حدود ۳ تا ۴ گیگابایت رم می‌خواهد (vite + اسکریپت‌های vendor). بعضی
میزبان‌های رایگان به builder بیشتر از ۵۱۲ مگ نمی‌دهند و build با OOM می‌میرد — پس ایمیج
را بیرون از میزبان می‌سازیم و منتشر می‌کنیم:

1. فایل `ci/docker-image.yml` را در `.github/workflows/docker-image.yml` کپی کنید
   (گیت‌هاب اجازه نمی‌دهد ابزارهای خودکار در آن پوشه کامیت کنند؛ دستی اضافه کنید).
2. تب **Actions** → «Build app image» → **Run workflow**.
3. ایمیج این‌جا آماده می‌شود:
   `ghcr.io/mshiravi433-ctrl/fbtcryp:latest`
   اگر بسته خصوصی بود: Settings → Packages → همان بسته → Change visibility → **Public**.

اگر به Actions دسترسی ندارید، روی لپ‌تاپ خودتان (با رم کافی و اینترنت آزاد):

```bash
docker build -t ghcr.io/USER/fbtcryp:latest .
docker push ghcr.io/USER/fbtcryp:latest   # بعد از docker login ghcr.io
```

### ۲.۲ اجرا روی میزبان

هر گزینه‌ای که **ایمیج آماده** می‌پذیرد و دامنهٔ اختصاصی رایگان می‌دهد:

| میزبان | طرح رایگان | نکته |
|---|---|---|
| **Render** | Web Service از نوع *Existing image* · ۵۱۲MB · بعد از ۱۵ دقیقه بی‌کاری می‌خوابد | دامنهٔ اختصاصی رایگان دارد؛ اولین بازدید بعد از خواب ~۴۰ ثانیه طول می‌کشد |
| **Koyeb** | ۱ سرویس · ۵۱۲MB | دامنهٔ اختصاصی و health check دارد |
| **Hugging Face Spaces** | Docker · ۱۶GB / ۲ vCPU · بدون متر CPU | دامنهٔ اختصاصی پولی است؛ برای تست عالی، برای دامنهٔ اصلی نه |

تنظیمات مشترک هر سه:

```
Image:  ghcr.io/mshiravi433-ctrl/fbtcryp:latest
Port:   8787
Health: /api/health
Env:    همان متغیرهایی که در Vercel → Settings → Environment Variables دارید
```

**متغیرهای محیطی:** فهرست کامل در `.env.example` است. آن‌هایی که اگر نباشند سایت
بالا می‌آید ولی بخشی از کار نمی‌کند: `OPENROUTER_API_KEY` (AI)، کلیدهای Firebase
(اعلان)، `CRON_SECRET` (کران‌ها)، و کلیدهای RPC. مقدارها را از Vercel کپی کنید —
هیچ‌کدام را در مخزن کامیت نکنید.

### ۲.۳ دامنه

در پنل میزبان، دامنهٔ `fbtswap.ir` را اضافه کنید و رکورد DNS را همان‌طور که میزبان
می‌گوید تغییر دهید (معمولاً `A`/`CNAME`). TTL را روی ۶۰ ثانیه بگذارید تا برگشت به Vercel
در ۱۰ دسامبر سریع باشد.

> ⚠️ **پیش از تغییر DNS:** فایل‌های سرویس‌ورکر و PWA روی مرورگر کاربران کش شده‌اند. اگر
> دامنه جابه‌جا شود، `sw.js` نسخهٔ قبلی را نگه می‌دارد؛ یک بار `sw.js` را با
> `Cache-Control: no-cache` سرو کنید (در `server/index.js` همین‌طور است) و به کاربران
> بگویید یک بار صفحه را ببندند و باز کنند.

### ۲.۴ چیزی که در میزبانی کانتینری **کار نمی‌کند**

* **کران‌های Vercel** (`/api/cron/*` طبق `vercel.json`): روی کانتینر زمان‌بند
  پلتفرم اجرا نمی‌شود. جایگزین: همان گردش‌کار `order-watch-tick.yml` که هر ۲۰ دقیقه
  صدا می‌زند (فقط `TICK_URL` را در فایل ورک‌فلو به دامنهٔ جدید عوض کنید) و دفترچهٔ
  `docs/VERCEL-CRON-HOBBY-FA.md` برای بقیه.
* **CDN لبه:** `s-maxage` روی کانتینر معنایی ندارد. آن‌جا کش داخل پروسه
  (`server/cache.js`) کار می‌کند؛ ترافیک کم را جواب می‌دهد.
* **`/api/usage/cpu`** کار می‌کند و همان عدد را می‌دهد — آن‌جا معیار صورت‌حساب میزبان
  نیست، ولی برای پیدا کردن مسیر گران همان کافی است.

---

## ۳. برگشت به Vercel و نگه‌داشتن عدد زیر ۱۰۰٪

وقتی حساب باز شد:

1. `main` را deploy کنید (این کامیت شامل همهٔ کاهش‌هاست).
2. یک هفته، هر روز:
   ```bash
   curl -s -H "x-cron-secret: $CRON_SECRET" https://fbtswap.ir/api/usage/cpu \
     | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['budget']); [print(r['share'], r['route']) for r in d['routes'][:10]]"
   ```
3. قاعدهٔ ساده: اگر یک مسیر بیش از ۲۰٪ CPU را گرفت، یکی از این سه را انجام دهید —
   `s-maxage` بیشتر، حلقهٔ کلاینت کندتر، یا حذف مسیر از مسیر داغ (lazy).
4. اگر `coldStartCpuMs` بزرگ بود (بیش از ۵۰۰ms) و ترافیک کم بود: importها را بیشتر
   lazy کنید؛ هر ۱۰۰ms کاهش در cold start، روی ۱۰۰۰ فراخوانی سرد در ماه، ۱۰۰ ثانیه
   CPU است.
