# APK — دانلود

## ⬇️ آخرین نسخه آماده است

```
github.com/mshiravi433-ctrl/fbtcryp/actions/runs/30304117148
```

صفحه را باز کن → پایین بیا → بخش **Artifacts** → روی **FBT-Swap-apk** بزن.

یا از صفحه Releases:

```
github.com/mshiravi433-ctrl/fbtcryp/releases
```

> ⚠️ دانلود از Artifacts نیاز به **لاگین گیت‌هاب** دارد.

**این نسخه همه تغییرات را دارد:** بیومتریک اصلاح‌شده، پاپ‌آپ وسط صفحه،
فارسی پیش‌فرض، صفحه فیوچرز، صفحه فارم، شرایط استفاده و حریم خصوصی،
تماس تلگرامی، و WalletConnect.

### نصب

۱. فایل `.zip` را با فایل‌منیجر باز کن → `app-debug.apk` را بگیر
۲. روی آن بزن → اندروید هشدار «منابع ناشناس» می‌دهد → اجازه بده → نصب
۳. بعد از نصب، آن اجازه را دوباره خاموش کن

| مورد | مقدار |
|---|---|
| حجم | ۴.۵۶ مگابایت |
| بسته | `ir.fbt.swap` |
| کارمزد | ۰.۵٪ → `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |

---

## ⚠️ فایل workflow خراب شده — یک خط باید اصلاح شود

آخرین build با `0s` شکست خورد. علتش دقیقاً یک چیز است: خط ۲۷ فایل workflow
**۱۶ فاصله** از چپ دارد، ولی باید **۶ فاصله** داشته باشد.

در YAML فاصله‌ها معنی دارند — با ۱۶ فاصله، گیت‌هاب فکر می‌کند آن خط بخشی از
مرحله قبلی است و کل فایل را نامعتبر می‌داند.

### راه‌حل: یک خط را اصلاح کن

**۱.** این لینک را باز کن:

```
github.com/mshiravi433-ctrl/fbtcryp/edit/arena/019fa427-fbtcryp/.github/workflows/build-apk.yml
```

**۲.** خط ۲۷ را پیدا کن. الان این‌طور است (با فاصله زیاد):

```
                - uses: softprops/action-gh-release@v2
```

**۳.** فاصله‌های اضافی ابتدای آن خط را پاک کن تا **دقیقاً هم‌تراز** با خط
`- uses: actions/upload-artifact@v4` بالایش شود:

```
      - uses: softprops/action-gh-release@v2
```

هر دو باید ۶ فاصله داشته باشند.

**۴.** **Commit changes**

### چطور بفهمی درست شد

بعد از commit، در تب **Actions**:

| نشانه | یعنی |
|---|---|
| نام اجرا **Build APK** | ✅ درست شد |
| زمان چند دقیقه‌ای | ✅ واقعاً اجرا شد |
| نام اجرا `.github/workflows/build-apk.yml` | ❌ هنوز خراب است |
| زمان `0s` و فوراً قرمز | ❌ هنوز خراب است |

بعد از موفقیت، APK **خودکار** در صفحه Releases منتشر می‌شود — بدون zip،
بدون لاگین، یک لمس و نصب.

### اگر ساده‌تر می‌خواهی

می‌توانی کل محتوای فایل را پاک کنی و این ۳۴ خط را جایگزین کنی:

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
      - run: npm ci
      - run: npm run build
      - run: npx cap sync android
      - run: chmod +x android/gradlew
      - run: cd android && ./gradlew assembleDebug --no-daemon
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

---

## چرا خودم درستش نمی‌کنم

سه بار امتحان کردم، گیت‌هاب هر بار رد کرد:

```
refusing to allow a GitHub App to create or update workflow
`.github/workflows/build-apk.yml` without `workflows` permission
```

اجرای دستی هم رد شد:

```
HTTP 403: Resource not accessible by integration
```

توکن من نه می‌تواند فایل‌های داخل `.github/workflows/` را بنویسد، نه build را
دستی اجرا کند. این تنها بخشی از پروژه است که باید خودت انجام بدهی.

همچنین نمی‌توانم APK را از سندباکس دانلود کنم و به Release بچسبانم — سرور
Azure که artifactها را سرو می‌کند از اینجا در دسترس نیست.
