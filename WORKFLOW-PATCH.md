# چرا APK ساخته نمی‌شود — علت واقعی (از روی لاگ، نه حدس)

## خطای دقیق

از لاگ ران `34914591474` (مرحله ۵ از ۸):

```
[command] /usr/local/lib/android/sdk/cmdline-tools/16.0/bin/sdkmanager tools
Warning: Failed to find package 'tools'
Error: The process 'sdkmanager' failed with exit code 1
```

**هیچ چیزی دانلود نشد و هیچ لینکی خراب نبود.** ورودی پیش‌فرض `packages` در اکشن
`android-actions/setup-android@v3` دقیقاً این رشته است: `tools platform-tools`.
اکشن برای هر کدام یک بار `sdkmanager <pkg>` اجرا می‌کند. بسته‌ی `tools` همان
**SDK Tools منسوخ** است که گوگل از مخزن حذفش کرده — پس `sdkmanager` نمی‌تواند
پیدایش کند، با کد ۱ خارج می‌شود و کل جاب می‌میرد. جالب اینکه `platform-tools`
که واقعاً لازم است، اصلاً نوبتش نمی‌رسد نصب شود.

این خطا **گذرا نیست**. دوباره اجرا کردن هرگز کمک نمی‌کند: هر ران دقیقاً همین‌جا
می‌میرد تا وقتی ورک‌فلو بسته‌ای را بخواهد که دیگر وجود ندارد.

نتیجه: npm و Vite و Capacitor و Gradle **هرگز اجرا نشدند**، هیچ APK ساخته نشد،
و ریلیز `latest` همچنان باینری قدیمی را سرو می‌کند. به همین دلیل فیکس دیپ‌لینک
Trust Wallet «کار نکرده» به نظر می‌رسد — آن فیکس درست است ولی هرگز داخل بیلدی
که شما نصب کرده‌اید نبوده.

## وضعیت فیکس Trust Wallet

کد سالم است و تست شده. هر ۳۴ ادعای `test/wc-wallets-probe.mjs` پاس می‌شود:

```
total: 34 failed: 0
```

از جمله: «لینک Trust دقیقاً بایت‌به‌بایت همان چیزی است که داکیومنت خودشان
می‌گوید» و «URI دقیقاً یک بار encode شده». فقط باید در یک بیلد تازه بنشیند.

## فیکس (کامیت‌شده)

- `ci/build-apk.yml` — ورک‌فلوی کامل و اصلاح‌شده.
- `ci/ensure-android-sdk.sh` — از SDK‌ای که **از قبل روی رانر گیت‌هاب هست**
  (`/usr/local/lib/android/sdk`) استفاده می‌کند و هرگز بسته‌ی منسوخ `tools` را
  درخواست نمی‌کند.
- `ci/build-apk.sh` — اگر `sdkmanager` نبود خودش فراهم می‌کند.

## تنها کار دستی: دو خط

گیت‌هاب به توکن این ایجنت اجازه‌ی نوشتن در `.github/workflows/` را **نمی‌دهد** —
نه با push، نه با Contents API، نه با Git Data API (هر سه 403):

```
! [remote rejected] refusing to allow a GitHub App to create or update
  workflow `.github/workflows/build-apk.yml` without `workflows` permission
```

پس لطفاً در `.github/workflows/build-apk.yml` این خط:

```yaml
      - uses: android-actions/setup-android@v3
```

را با این جایگزین کنید:

```yaml
      - uses: android-actions/setup-android@v3
        continue-on-error: true
        with:
          packages: platform-tools
      - name: Ensure Android SDK
        run: bash ci/ensure-android-sdk.sh
```

خط کلیدی `packages: platform-tools` است — همان که بسته‌ی منسوخ `tools` را از
درخواست حذف می‌کند. دو خط دیگر بیمه‌اند تا اگر این اکشن دوباره خراب شد، بیلد
به‌جای مردن از SDK موجود روی رانر استفاده کند.

فایل کامل در `ci/build-apk.yml` است اگر ترجیح می‌دهید کل فایل را کپی کنید.
