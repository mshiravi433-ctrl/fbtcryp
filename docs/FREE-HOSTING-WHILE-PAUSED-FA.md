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
| ۴ | متغیر `VITE_ENV_FILE` را بسازید (Settings → Secrets and variables → Actions → **Variables**) | GitHub | `VITE_*` در **زمان بیلد** داخل باندل کامپایل می‌شوند؛ اگر نباشد سایت بالا می‌آید ولی WalletConnect، web-push و نمایش کارمزد بی‌صدا از کار می‌افتند (سناریوی «همه‌چیز هست، فقط کار نمی‌کند») |
| ۵ | یک‌بار `main` را بعد از باز شدن حساب deploy کنید | Vercel | تا حساب باز نشود build هم اجرا نمی‌شود |

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
را بیرون از میزبان می‌سازیم و منتشر می‌کنیم.

#### گام ۱ — فایل ورک‌فلو را سر جایش بگذارید (فقط یک دستور)

گیت‌هاب اجازه نمی‌دهد ابزارهای خودکار در `.github/workflows/` کامیت کنند، پس فایل در
`ci/docker-image.yml` نگه داشته می‌شود. یک‌بار از روی کلون مخزن:

```bash
mkdir -p .github/workflows \
  && cp ci/docker-image.yml .github/workflows/docker-image.yml \
  && git add .github/workflows/docker-image.yml \
  && git commit -m "ci: build app image" && git push
```

(یا از رابط وب: **Add file → Create new file** → مسیر
`.github/workflows/docker-image.yml` → محتوای فایل را paste کنید.)

#### گام ۲ — متغیر `VITE_ENV_FILE` را بسازید

**Settings → Secrets and variables → Actions → Variables → New repository variable**

نام: `VITE_ENV_FILE` · مقدار: خط‌به‌خط، هر خط یک `KEY=value` (بدون `export` و بدون
گیومه دور کل خط). حداقلِ لازم برای اینکه سایت «مثل خودش» باشد:

```
VITE_WALLETCONNECT_PROJECT_ID=...
VITE_VAPID_PUBLIC_KEY=...
VITE_FEE_BPS=70
```

> **`VITE_FEE_RECIPIENT` را ننویسید.** این متغیر فقط یک override است؛ آدرسِ واقعیِ
> کارمزد در `src/lib/payout.js` هارد‌کد است (`PAYOUT_ADDRESSES.evm` و آدرس‌های جدا برای
> سولانا/ترون). نوشتن یک آدرسِ حدسی یعنی کارمزد به کیف‌پولی می‌رود که کلیدش را ندارید.

> **چرا Variable و نه Secret؟** این مقدارها در زمان بیلد داخل جاوااسکریپت عمومی کامپایل
> می‌شوند؛ Secret گذاشتن‌شان حس امنیت کاذب می‌دهد و لاگ را کور می‌کند. خودِ ورک‌فلو
> جلوی کلیدِ شبیهِ راز (`VITE_*_SECRET`, `..._PRIVATE`, `..._MNEMONIC`) را می‌گیرد.
>
> **`VITE_API_BASE` لازم نیست:** روی کانتینر، API و فرانت یک پروسه و یک دامنه‌اند، پس
> درخواست‌ها نسبی می‌مانند. (روی Vercel هم همین‌طور است.)

#### گام ۳ — Actions → «Build app image» → Run workflow

ورک‌فلو چهار کار می‌کند و لاگش سند است:

| مرحله | چه چیزی را ثابت می‌کند |
|---|---|
| `Lockfile platform guard` + `npm ci --force` | بیلدِ لینوکسی روی قفل‌فایلی که `fsevents` مک را اجباری کرده گیر نمی‌کند |
| `Write build.env` | فقط کلیدهای `VITE_*` و فقط نام‌شان چاپ می‌شود؛ خطِ بدشکل یا شبیه‌راز **قبل از** ۲۰ دقیقه بیلد، build را می‌شکند |
| `Build and push` | ایمیج `linux/amd64` با دو تگ: `:latest` و `:${sha}` (برای برگشت، sha لازم است) |
| **`Smoke test`** | ایمیج را pull و اجرا می‌کند و تا ۶۰ ثانیه منتظر `200` از `/api/health` می‌ماند — «ساخته شد» با «بالا می‌آید» یکی نیست |

خروجی: `ghcr.io/mshiravi433-ctrl/fbtcryp:latest`. اگر بسته خصوصی بود:
Settings → Packages → همان بسته → **Change visibility → Public** (میزبان رایگان باید
بدون توکن pull کند).

#### اگر Actions در دسترس نبود — روی لپ‌تاپ خودتان

```bash
docker build -t ghcr.io/USER/fbtcryp:latest .            # رم و اینترنت لازم دارد
# اختیاری: بدون سرمایهٔ فارم (کلید خاموشیِ مستند)
docker build --build-arg FARM_CAPITAL=off -t fbt-swap:safe .
docker run --rm -p 8787:8787 ghcr.io/USER/fbtcryp:latest  # بعد /api/health را ببینید
docker push ghcr.io/USER/fbtcryp:latest                   # بعد از docker login ghcr.io
```

#### چه چیزی داخل ایمیج دقیقاً مثل production است (و چرا مهم است)

`Dockerfile` عمداً همان دو فایلِ محیطیِ `npm run build:full` را source می‌کند
(`ci/farm-rollout.env.sh` و `ci/web-season.env.sh`) و همان دو فلگ درون‌خطی را هم
پاس می‌دهد. بدون این، `VITE_ENABLE_*` همه `false` کامپایل می‌شدند، هر پنج آداپتر فارم
`null` برمی‌گرداندند و «آینه» یک فارمِ فقط‌خواندنی نشان می‌داد — همان باگی که یک‌بار روی
خودِ سایت رخ داد. `VERCEL_ENV=production` هم به همین دلیل ست می‌شود (سطحِ تاریخچهٔ
معاملات فقط برای بیلدِ production باز است)؛ برای بیلدِ بسته،
`--build-arg VERCEL_ENV=preview`.

حالا سه فایل (Dockerfile، `.dockerignore` و ورک‌فلو) با یک probe قفل شده‌اند:

```bash
node test/docker-image-probe.mjs   # 39/39 — drift در هر سه فایل همین‌جا می‌شکند
```

### ۲.۲ اجرا روی میزبان — و دیوارِ کارت (واقعیتِ ۱۱ نوامبر ۲۰۲۶)

ایمیج ساخته شد و smoke test پاس شد. ولی جایی که باید اجرا شود، امروز بسته است. این
جدول را از خودِ سایت‌هایشان (نه از حدس) پر کردم؛ هر ردیف یک ساعت وقتِ کسی است که دوباره
امتحانش نکند:

| میزبان | وضعیت | نتیجه |
|---|---|---|
| **Render** | برای سرویس رایگان کارت اعتباری می‌خواهد | ❌ کارت خارجی نداریم |
| **Hugging Face Spaces** | SDK رایگان فقط `gradio` و `static`؛ `docker` پلن پرداختی | ❌ |
| **Koyeb** | پلن رایگان حذف شده؛ ارزان‌ترین = **Pro ۲۹ دلار در ماه** | ❌ |
| Fly.io · Railway · Cloud Run · Oracle · Northflank | کارت (یا تأیید هویت بین‌المللی) | ❌ |

**پس معیار انتخاب میزبان دیگر «رایگان است؟» نیست؛ «بدون کارت خارجی است؟» است.**

#### مسیر A — دیدنِ سایت روی کامپیوتر خودتان + تونل رایگان

هیچ ثبت‌نام و کارتی لازم نیست؛ فقط Docker روی سیستم خودتان:

```bash
docker pull ghcr.io/mshiravi433-ctrl/fbtcryp:latest
docker run -d --name fbt -p 8787:8787 ghcr.io/mshiravi433-ctrl/fbtcryp:latest
curl -s http://localhost:8787/api/health          # {"ok":true,…}

# ترمینال دوم — آدرس عمومی https در چند ثانیه:
# نصب: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8787     # → https://xxxx.trycloudflare.com
```

محدودیت‌ها، صادقانه: آدرس با هر restart عوض می‌شود، تا وقتی کامپیوتر و ترمینال روشن
است زنده می‌ماند، و **کلیدهای سرور را ندارد** — پس UI و `/#/whats-new` کامل کار می‌کند
ولی AI، اعلان و cron نه. برای «دیدن تغییرات» کافی است؛ برای جایگزینِ سایت نه.

#### مسیر B — PaaS ایرانی با پرداخت ریالی

کارت ایرانی داریم، کارت خارجی نه؛ پس تنها خانواده‌ای که *می‌تواند* دائمی باشد همین است:

- **Liara** — https://liara.ir (استقرار از ایمیج Docker · پورت ۸۷۸۷ · دامنهٔ `*.liara.run`)
- **ArvanCloud** — https://www.arvancloud.ir · **Hostiran / Parspack** — سرویس ابری

مزیت مضاعف: برای کاربر ایرانی سریع‌تر و بی‌فیلتر است. عیب: «رایگانِ همیشگی» کم دارد؛
ارزان‌ترین پلن‌ها ریالی و معمولاً در حد چند صد هزار تومان در ماه‌اند.

#### مسیر C (توصیه‌شده) — صبر برای Vercel

هیچ‌کدام از A و B لازم نیست اگر دو روز صبر کنیم:

- عدد `4h 9m / 4h` روزی ~۸ دقیقه کم می‌شود → زیر ۴ ساعت حدود **۱۲–۱۳ نوامبر**.
- آن روز تیکت `vercel.com/help` (§۱) و بعد یک redeploy از `main`.
- هزینه صفر، دامنه دست‌نخورده، و ایمیجِ GHCR به‌عنوان بیمه باطل نمی‌شود.

> تصمیمِ ۱۱ نوامبر: چون هنوز مشتری‌ای روی سایت نیست، **مسیر C** انتخاب شد و A/B به‌عنوان
> بیمه باقی می‌مانند. هر وقت خواستید A یا B را بالا بیاورید، ایمیج از قبل آماده و
> smoke-tested است — کارِ امروز دور ریخته نشد.

#### مسیر D — پیش‌نمایش در مرورگر با GitHub Codespaces (بدون نصب، بدون کارت) ✅ برای «درست کردن ظاهر»

اگر هدف این است که **ظاهر سایت را ببینیم و اصلاح کنیم**، هیچ میزبانی لازم نیست: یک Codespace
همان dev server را در مرورگر بالا می‌آورد و آدرس عمومی می‌دهد.

1. https://github.com/codespaces/new?hide_repo_select=true&repo=mshiravi433-ctrl/fbtcryp&ref=main
   (یا در مخزن: دکمهٔ سبز **Code** → تب **Codespaces** → *Create codespace on main*)
2. **هیچ دستوری لازم نیست.** `.devcontainer/devcontainer.json` خودش Node 22 را می‌آورد،
   `npm ci --force` را اجرا می‌کند (≈۱ دقیقه، یک‌بار) و بعد `.devcontainer/start-dev.sh`
   در هر بوت، dev server را در پس‌زمینه بالا می‌آورد (log: `/tmp/fbt-dev.log`).
3. پورت `5173` با `onAutoForward: openPreview` **خودش** در پنجرهٔ پیش‌نمایش ادیتور باز می‌شود.
   اگر باز نشد: تب **Ports** → ردیف `5173` → آیکن 🌐. آدرس این شکلی است:
   `https://<codespace-name>-5173.app.github.dev`

   اگر خواستید دستی اجرا کنید (یا سرور را ری‌استارت کنید):
   ```bash
   bash .devcontainer/start-dev.sh     # idempotent: اگر بالاست، کاری نمی‌کند
   ```
4. برای دیدن چیدمان موبایل روی دسکتاپ: `F12` → `Ctrl+Shift+M`. (خودِ اپ `max-width: 520px`
   است، پس دسکتاپ تقریباً همان نمای گوشی را نشان می‌دهد.)

نکته‌های واقعی:

| موضوع | جزئیات |
|---|---|
| هزینه | سهمیهٔ رایگان حساب شخصی: ۱۲۰ core-hour در ماه (ماشین ۲ هسته‌ای ≈ ۶۰ ساعت) — بدون کارت |
| امنیت پورت | پورت‌ها پیش‌فرض **Private** هستند (فقط با نشست خودتان باز می‌شوند). عمداً Public نکردم: dev server به `/api` پروکسی می‌کند و یک پورت عمومی یعنی API شما هم عمومی |
| خواب | بعد از ~۳۰ دقیقه بی‌کاری Codespace می‌خوابد؛ از https://github.com/codespaces دوباره روشنش کنید (state حفظ می‌شود) |
| داده | مثل سندباکس: بدون کلیدها. UI/چیدمان/CSS کامل، قیمت‌ها و AI نه |
| چرا قبلاً ۴۰۳ می‌داد | Vite هر Host ناشناس را رد می‌کند (محافظت DNS-rebinding). `.app.github.dev` به `server.allowedHosts` اضافه شد؛ تست: همان Host → ۲۰۰، و `evil.example.com` هنوز ۴۰۳ |

> پیش‌نمایشِ سندباکسِ Arena (`https://5173-<sandbox>.e2b.app`) فقط تا وقتی آن نوبت در حال
> اجراست زنده است و بعد می‌خوابد (`502 Sandbox not found`)؛ برای کارِ طولانی روی ظاهر
> از Codespaces استفاده کنید.

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
