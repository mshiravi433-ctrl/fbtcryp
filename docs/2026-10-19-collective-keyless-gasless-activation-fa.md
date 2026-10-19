# ۲۰۲۶-۱۰-۱۹ — عملیاتی‌سازی «مجموعه هوشمند FBT» بدون دادن کلید و بدون گس (GitHub Actions)

خواستهٔ کاربر: «در مجموعهٔ هوشمند FBT، از GitHub Actions (بدون دادن کلید به کسی) یا
هر روشی که گس نخواهد برای عملیاتی شدن انجام بده و بیار روی برنچ اصلی لایو بشه.»

این سند دقیقاً می‌گوید چه چیزی خودکار شد، چه چیزی هنوز گس می‌خواهد، و چرا ادعای
«استقرار روی زنجیره بدون گس» دروغ می‌بود.

---

## ۰. خلاصهٔ یک‌خطی

| موضوع | وضعیت |
| --- | --- |
| کامپایل + پروب قرارداد + تست‌های API + تمرین کامل استقرار (دیپلوی → تایم‌لاک ۱ روزه → فعال‌سازی → واریز کاربر با گس خودش → سرمایه‌گذاری → خواندن) | **خودکار، بدون Secret، بدون گس** — `.github/workflows/collective-activation.yml` |
| انتشار شاهد عمومی اجرا (هش بایت‌کد هر قرارداد، اندازه، نتیجهٔ هر مرحله) | **خودکار** — `server/collective/activation.snapshot.js` + `public/collective/activation.json` |
| نمایش وضعیت واقعی روی `/#/collective` | **زنده** — `GET /api/collective/activation` (فقط‌خواندنی، بدون کلید) |
| استقرار روی Robinhood Chain (۴۶۶۳) | **نیازمند گسِ کیف پول خودِ اپراتور** — با یک Secret در GitHub و تأیید صریح |
| فعال شدن خواندن عمومی بعد از استقرار | **خودکار** — API رکورد تأییدشدهٔ CI را می‌خواند؛ ست‌کردن دستی env در Vercel لازم نیست |

> **صداقت عملیاتی:** هیچ روشی وجود ندارد که قرارداد را روی زنجیرهٔ ۴۶۶۳ بگذارد و
> گس صفر باشد؛ زنجیرهٔ Arbitrum Orbit گس را به ETH تسویه می‌کند. کاری که این تغییر
> می‌کند این است: هر چیزی که *می‌تواند* بدون کلید و بدون گس انجام شود، خودکار و
> قابل‌بازبینی شد؛ و برای آن یک قدم که گس می‌خواهد، کلید فقط داخل رانر می‌ماند و
> هیچ‌وقت به کسی داده نمی‌شود.

---

## ۱. چرا «کلید به کسی ندادن» با GitHub Actions حل می‌شود

کلید خصوصی یک Secret مخزن است. فقط در زمان اجرای همان Job، آن هم به‌صورت متغیر
محیط به پروسهٔ امضاکننده می‌رسد:

```yaml
env:
  COLLECTIVE_DEPLOYER_PRIVATE_KEY: ${{ secrets.COLLECTIVE_DEPLOYER_PRIVATE_KEY }}
```

- در لاگ چاپ نمی‌شود (GitHub مقادیر Secret را ماسک می‌کند و اسکریپت هم عمداً چیزی
  چاپ نمی‌کند).
- در دیسک نوشته نمی‌شود؛ `publicDeploymentRecord()` هر فیلد کلید را حذف می‌کند.
- در شاهد عمومی نمی‌رود؛ `scripts/collective-evidence.mjs` پیش از نوشتن، خروجی را
  برای الگوهای کلید ۳۲ بایتی و URL دارای اعتبارنامه اسکن می‌کند و در صورت تطبیق
  **fail** می‌شود.
- هیچ انسان یا سرویس ثالثی آن را نمی‌بیند: نه نویسندهٔ این تغییر، نه API، نه UI.

---

## ۲. سه لایهٔ پیاده‌شده

### لایهٔ ۱ — خط لولهٔ کاملاً رایگان (بدون Secret، بدون گس)

> **نصب یک‌باره (تنها قدم دستی):** GitHub به توکن‌های ربات اجازهٔ نوشتن در
> `.github/workflows/` را نمی‌دهد (هم `git push` و هم Contents API با خطای
> `refusing to allow a GitHub App to create or update workflow … without
> workflows permission` رد می‌شوند؛ عمداً تست شد). پس فایل کامل در
> [`ci/collective-activation.yml`](../ci/collective-activation.yml) نگه داشته می‌شود.
> یک‌بار در GitHub → **Add file → Create new file** مسیر
> `.github/workflows/collective-activation.yml` را بساز و محتوای همان فایل را
> بچسبان. کنسول صفحهٔ `/#/collective` وقتی ورک‌فلو نصب نباشد همین را با لینک
> مستقیم نشان می‌دهد. بعد از آن، همه‌چیز خودکار است.

فایل نصب‌شده، Job با نام `Keyless rehearsal`:

1. `npm ci` از lockfile
2. `npm run compile:collective` (solc 0.8.24، سقف EIP-170)
3. `node test/collective/contract-probe.mjs` روی Ganache درون‌فرآیندی
4. تست‌های API و فعال‌سازی (`node --test …`)
5. `node scripts/collective-deploy.mjs --local --rehearse` — تمرین کامل، شامل
   تایم‌لاک واقعی ۸۶٬۴۰۰ ثانیه‌ای `RiskController` و واریزی که **گسش را خودِ
   کاربر می‌دهد**
6. نوشتن و اعتبارسنجی شاهد عمومی و کامیت آن به `main`

اجرا روی `push` به `main` (مسیرهای مرتبط)، هفتگی (دوشنبه ۰۳:۱۷ UTC) و دستی.
کامیت شاهد با پیام `[collective-evidence]` است و همان ورک‌فلو با یک گارد از حلقهٔ
اجرا جلوگیری می‌کند.

### لایهٔ ۲ — وضعیت عمومی و پنل زنده

- `server/collective/activation.js` وضعیت را از **API عمومی** GitHub Actions
  می‌خواند (بدون توکن، چون مخزن عمومی است)، با کش ۵ دقیقه‌ای، تایم‌اوت ۴٫۵ ثانیه و
  fallback به شاهدِ کامیت‌شده. اگر GitHub در دسترس نباشد، endpoint هرگز ۵۰۰
  نمی‌دهد؛ همان آخرین شاهد را با `source: "snapshot"` برمی‌گرداند.
- `GET /api/collective/activation` فقط‌خواندنی است و هیچ کلیدی ندارد.
- در `/#/collective` یک «کنسول فعال‌سازی» اضافه شد: وضعیت خط لوله، مرحله‌ها، لینک
  به همان اجرا در GitHub، و تنها قدم بعدی به‌صورت دستور کپی‌شدنی.

### لایهٔ ۳ — استقرار واقعی و فعال شدن خودکار خواندن

Job دوم (`live`) فقط با `workflow_dispatch` و فقط با ورودی `acknowledge_gas=yes`
اجرا می‌شود. دو فاز دارد تا تایم‌لاک واقعی ۱ روزه رعایت شود:

```bash
# فاز ۱ — استقرار + صف‌کردن allowlistها
gh workflow run collective-activation.yml -f phase=deploy -f acknowledge_gas=yes

# بعد از ≥ ۱ روز (تایم‌لاک RiskController)
gh workflow run collective-activation.yml -f phase=activate -f acknowledge_gas=yes

# بررسی فقط‌خواندنی (بدون کلید)
gh workflow run collective-activation.yml -f phase=check
```

پس از سبز شدن `--check`، ورک‌فلو رکورد عمومی `deployments/collective-4663.json`
و شاهد تأییدشده را کامیت می‌کند. از آن لحظه:

- `readCollectiveConfig()` اگر env نداشته باشد، آدرس‌ها/بلاک/RPC را از همین شاهد
  **تأییدشده** برمی‌دارد و خواندن عمومی روشن می‌شود؛
- `COLLECTIVE_READS_ENABLED=false` همچنان همه‌چیز را خاموش می‌کند و env صریح همیشه
  اولویت دارد؛
- اگر شاهد `verified: true` نداشته باشد، هیچ آدرسی پذیرفته نمی‌شود (fail-closed).

نتیجه: «یک‌بار اجرای ورک‌فلو، بعد لایو» — بدون دست‌زدن به تنظیمات Vercel.

---

## ۳. فایل‌های تازه/تغییرکرده

| فایل | نقش |
| --- | --- |
| `.github/workflows/collective-activation.yml` | خط لولهٔ بدون کلید + Job استقرار گیت‌شده |
| `scripts/collective-evidence.mjs` | تولید و اعتبارسنجی شاهد عمومی (هش/اندازه/چک‌ها)، اسکن ضد-سکرت |
| `server/collective/activation.js` | وضعیت فعال‌سازی عمومی + کش + fallback |
| `server/collective/activation.snapshot.js` | شاهد کامیت‌شده (تولیدشده؛ seed دست‌نخورده) |
| `server/collective/config.js` | پذیرش رکورد تأییدشدهٔ CI به‌عنوان منبع آدرس با گاردهای سخت |
| `server/collective/routes.js` | `GET /api/collective/activation` |
| `src/lib/collective/api.js` | کلاینت همان endpoint |
| `src/pages/Collective.jsx` + `src/styles/collective.css` | کنسول فعال‌سازی |
| `src/i18n/locales/{fa,en}.json` | متن‌های پنل (fa/en؛ بقیهٔ زبان‌ها به انگلیسی fallback) |
| `public/collective/activation.json` | همان شاهد، قابل fetch و ممیزی مستقل |
| `test/collective/activation-status.test.mjs` | ۸ تست تازه |

---

## ۴. تست‌ها

| آزمون | نتیجه |
| --- | --- |
| `node --test test/collective/activation-status.test.mjs` | **۸/۸** |
| `node --test test/collective/api.test.mjs test/collective/activation.test.mjs` | **۱۱/۱۱** |
| `node scripts/collective-deploy.mjs --local --rehearse` | موفق (استقرار → تایم‌لاک → فعال‌سازی → واریز با گس کاربر → سرمایه‌گذاری → خواندن API) |
| `npx vite build` | خروج ۰ |

تست‌های حیاتی که قفل شده‌اند: payload هرگز استقرار تأییدنشده را «لایو» نشان نمی‌دهد؛
نبودِ GitHub باعث fallback به شاهد می‌شود نه خطا؛ `verified: false` یا chain اشتباه یا
RPC دارای اعتبارنامه هیچ آدرسی را فعال نمی‌کند؛ payload هیچ الگوی کلید ۳۲ بایتی ندارد.

---

## ۵. آنچه عمداً انجام نشد

- **استقرار روی زنجیرهٔ واقعی در این تغییر انجام نشد.** نه کلیدی وجود داشت، نه گسی،
  و ساختن آدرس/تراکنش جعلی بدترین کاری است که یک داشبورد می‌تواند بکند.
- استقرار روی تست‌نت (۴۶۶۳۰) هم انجام نشد: آن شبکه است و فاستش ضد-ربات است؛ نمایش
  آن روی سایتِ اصلی، «لایو» واقعی نیست و فقط ادعاست.
- ممیزی مستقل همچنان شرط انتشار گسترده است؛ پنل هم همین را می‌گوید.
