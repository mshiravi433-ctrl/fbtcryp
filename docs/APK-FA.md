# ساخت APK — راهنمای قطعی

> **وضعیت: build سبز است — از ۲۰۲۶‑09‑02 (۱۴۰۵/۰۶/۱۱).**
> فایل‌ها در `releases/tag/latest` هستند: `FBT-Swap-full.apk`، `app-release.apk`،
> `app-release.aab`.
>
> آخرین **دو** چیزی که ساخت را می‌کشت، هیچ‌کدام paste نبود:
>
> 1. `npm ci` روی اوبونتو با `EBADPLATFORM` می‌مرد — `fsevents` (فقط macOS، داخل
>    `ganache`) در lockfile به‌جای `optional` به‌عنوان وابستگی اجباری ثبت شده بود.
>    ۳۴ ثانیه بعد از شروع، قبل از این‌که Gradle اصلاً اجرا شود.
> 2. یک خط در `ci/build-apk.sh` متغیر `HERE` را می‌خواند که فقط در فایل
>    صداکننده (`build-both.sh`) تعریف شده بود؛ با `set -u` یعنی خروج فوری.
>
> هر دو در `ci/` درست شدند — هیچ نیازی به دست‌زدن به `​.github/workflows/` نبود —
> و `npm run verify:apk-lock` نگهبانِ برگشتِ مورد اول است. متن پایینِ همین سند،
> راهنمای همان خرابی *paste* است: هنوز درست است، ولی دیگر تنها علت ممکن نیست.

## چرا تا الان نساخته شده

فایل `.github/workflows/build-apk.yml` دو بار پشت سر هم موقع paste خراب شد:

| بار | مشکل |
|---|---|
| اول | خط ۲۷ با **۱۶ فاصله** به‌جای ۶ |
| دوم | خط ۲۷ با **۰ فاصله**، و خط ۲۶ حرف آخرش افتاد (`.ap` به‌جای `.apk`) |

در YAML فاصله معنی دارد، پس هر دو بار فایل نامعتبر شد و build با `0s` مرد.

من نمی‌توانم خودم درستش کنم — سه راه امتحان کردم و گیت‌هاب هر سه را رد کرد:

```
git push                → refusing to allow a GitHub App to update workflow
API contents PUT        → 403 without `workflows` permission
workflow dispatch/rerun → 403 Resource not accessible by integration
```

## ✅ راه‌حل: دیگر لازم نیست YAML طولانی paste کنی

کل مراحل build را به فایل `ci/build-apk.sh` منتقل کردم. حالا workflow فقط
**۲۷ خط** است و تنها یک خط دستور دارد. مهم‌تر: از این به بعد هر تغییری در
build لازم شد، من در آن اسکریپت انجام می‌دهم و تو دیگر دست به YAML نمی‌زنی.

### مرحله ۱ — فایل را باز کن

```
github.com/mshiravi433-ctrl/fbtcryp/edit/arena/019fa427-fbtcryp/.github/workflows/build-apk.yml
```

### مرحله ۲ — همه محتوا را پاک کن

داخل کادر بزن → **Select all** → **Delete**. مطمئن شو کادر کاملاً خالی است.

### مرحله ۳ — محتوای جدید را کپی کن

این لینک را در تب جدید باز کن (صفحه raw، فقط متن خالی است):

```
raw.githubusercontent.com/mshiravi433-ctrl/fbtcryp/arena/019fa427-fbtcryp/ci/WORKFLOW.txt
```

روی متن نگه دار → **Select all** → **Copy**

> ⚠️ حتماً از لینک `raw.githubusercontent.com` استفاده کن، نه صفحه معمولی
> گیت‌هاب. صفحه معمولی شماره خط و دکمه دارد که وارد کپی می‌شوند و فایل را
> خراب می‌کنند — همان اتفاقی که دو بار افتاد.

### مرحله ۴ — paste و commit

برگرد به تب ویرایش → داخل کادر خالی paste کن → پایین صفحه
**Commit changes** → **Commit directly**

### مرحله ۵ — چک کن درست شد

تب **Actions** را باز کن:

| نشانه | یعنی |
|---|---|
| نام اجرا **Build APK** و زمان چند دقیقه‌ای | ✅ درست شد |
| زمان `0s` و فوراً قرمز | ❌ هنوز خراب است |

اگر باز `0s` شد، به‌جای paste کردن **دستی تایپش کن** — فقط ۲۷ خط است و
متن زیر کاملش است:

```yaml
name: Build APK
on: [push, workflow_dispatch]
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: android-actions/setup-android@v3
      - run: bash ci/build-apk.sh
      - uses: actions/upload-artifact@v4
        with:
          name: FBT-Swap-apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: latest
          name: FBT Swap - latest
          files: android/app/build/outputs/apk/debug/app-debug.apk
```

قانون فاصله‌ها ساده است: خطوطی که با `- uses:` یا `- run:` شروع می‌شوند
همگی **۶ فاصله** دارند و باید کاملاً زیر هم باشند.

---

## بعد از موفقیت

APK به‌صورت خودکار در دو جا می‌آید:

**۱. صفحه Releases** (بدون نیاز به لاگین، یک لمس نصب):
```
github.com/mshiravi433-ctrl/fbtcryp/releases
```

**۲. تب Actions** → آخرین اجرا → بخش **Artifacts** (نیاز به لاگین دارد)

### نصب

۱. روی فایل `.apk` بزن
۲. اندروید هشدار «منابع ناشناس» می‌دهد → اجازه بده → نصب
۳. بعد از نصب، آن اجازه را دوباره خاموش کن

---

## فایل‌ها کجا هستند (همین حالا ساخته می‌شوند)

هر اجرای موفق سه فایل می‌گذارد، همه در یک جا:

```
github.com/mshiravi433-ctrl/fbtcryp/releases/tag/latest
```

| فایل | برای چه کسی |
|---|---|
| `FBT-Swap-full.apk` | نصب مستقیم — نسخهٔ کامل با همهٔ ماژول‌ها |
| `app-release.apk` | بازار، مایکت و بقیهٔ فروشگاه‌ها — بدون صفحات قمار |
| `app-release.aab` | فقط Google Play |

هر سه با کلید release امضا شده‌اند. بالای همین صفحه یک بلوک خودکار هست که
versionName/versionCode و SHA‑256ِ همان فایل‌ها را نوشته — قبل از نصب، خلاصهٔ
فایل دانلودی را با آن مقایسه کن:

```sh
sha256sum FBT-Swap-full.apk
```

اگر فرق داشت، نصب نکن. آن بلوک را خودِ پایپ‌لاین در هر ساخت بازنویسی می‌کند،
پس هیچ‌وقت «قدیمی» نمی‌شود؛ یادداشت‌های دستی پایینِ همان بلوک هم دست‌نخورده
می‌ماند.

> **برای این‌که آن بلوک خودکار روی خودِ صفحهٔ Release هم نوشته شود** یک خط لازم
> است — دقیقاً مثل همین‌که کلیدها و `VITE_*`ها باید دستی به محیط مرحلهٔ build داده
> شوند. در `.github/workflows/build-apk.yml`، زیر `env:` همان مرحله‌ای که
> `bash ci/build-both.sh` را اجرا می‌کند، اضافه کن:
>
> ```yaml
>           GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
> ```
>
> نسخهٔ آماده‌اش در `ci/WORKFLOW-FIXED.yml` هست، پس کپی کل فایل هم همین خط را
> با خودش می‌آورد. تا وقتی این خط نیست، همان اطلاعات در **خلاصهٔ همان اجرا** و در
> `out/RELEASE-NOTES.md` نوشته می‌شود و پایپ‌لاین با یک warning قرمز نمی‌شود —
> یک توضیحِ بی‌اعتبار هیچ‌وقت نباید ساختِ معتبر را متوقف کند.

---

## اگر باز هم نساخت، اول کجا را نگاه کنی

لاگ Actions روی گوشی تقریباً خوانده نمی‌شود، برای همین پایپ‌لاین هر چیزی که
لازم داری را به‌صورت **Annotation** بالای همان صفحهٔ اجرا می‌نویسد:

- خط قرمز `Build failed` یا `full build failed (exit n)` — همان یک خط که مشکل
  را می‌گوید، بدون باز کردن لاگ؛
- خط‌های آبی `npm ci` → `web bundle` → `android sdk` → `apk` — ترتیبشان می‌گوید
  ساخت تا کجا جلو رفته. آخرین خط آبی که می‌بینی یعنی مرحلهٔ بعدی مرده؛
- `apk` سبز شد ولی فایل در Release نیامد؟ مشکل از آپلود است، از بیلد نه.

روی کامپیوتر یا Termux همین‌ها را می‌شود مستقیم گرفت:

```sh
gh run list --workflow=build-apk.yml --limit 3
gh run view <run-id> --json conclusion,jobs --jq '.jobs[] | .name, .conclusion'
```

و قبل از هر commit، چکِ خود lockfile:

```sh
npm run verify:apk-lock
```

این چک نگهبانِ همان باگ قدیمی است: `package-lock.json` یک پکیجِ فقط‑macOS
(`fsevents`، داخل `ganache`) را **اجباری** می‌کرد، `npm ci` روی اوبونتو با
`EBADPLATFORM` می‌مرد — ۳۴ ثانیه بعد، قبل از این‌که Gradle اصلاً اجرا شود، و با
هیچ پیامی جز «Process completed with exit code 1».

---

## چه چیزی در نسخه جدید خواهد بود

- 🤖 **سیگنال هوشمند** — RSI، MACD، بولینگر، میانگین متحرک با گیج انیمیشنی
- 📊 **سهام** — توکن‌های RWA و ناشران دارای مجوز
- 🚀 **welcome پنج مرحله‌ای** — با اتصال کیف پول و تایید قوانین
- 💰 **کارمزد اجباری ۰.۵٪** — دیگر هیچ مسیر بدون کارمزدی وجود ندارد
- 🎨 رنگ‌های بیشتر و انیمیشن‌های جدید (aurora، shimmer، grid glow)
- 🔧 رفع باگ MACD که باعث می‌شد این اندیکاتور هیچ سهمی در امتیاز نداشته باشد
- 📄 حذف دو پاراگراف حقوقی از شرایط و حریم خصوصی
- 👤 حذف نام کاربری
- 💬 پشتیبانی فقط با دکمه تلگرام
