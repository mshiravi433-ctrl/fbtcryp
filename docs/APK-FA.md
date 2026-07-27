# APK — دانلود

## ⬇️ آخرین نسخه (v1.1.0)

**راه ۱ — صفحه Releases:**

```
github.com/mshiravi433-ctrl/fbtcryp/releases
```

**راه ۲ — مستقیم از build:**

```
github.com/mshiravi433-ctrl/fbtcryp/actions/runs/30303838744
```

صفحه را باز کن → پایین بیا → بخش **Artifacts** → روی **FBT-Swap-apk** بزن.

> ⚠️ دانلود از Artifacts نیاز به **لاگین گیت‌هاب** دارد. اگر دکمه کار نکرد،
> اول وارد حسابت شو.

### نصب روی گوشی

۱. فایل `.zip` دانلود می‌شود → با فایل‌منیجر بازش کن → `app-debug.apk` را بگیر
۲. روی فایل apk بزن
۳. اندروید هشدار «نصب از منابع ناشناس» می‌دهد — برای هر APK خارج از گوگل‌پلی
   عادی است
۴. اجازه بده → **Install**
۵. بعد از نصب، آن اجازه را دوباره خاموش کن

### مشخصات

| مورد | مقدار |
|---|---|
| نسخه | v1.1.0 |
| حجم | ۴.۵۶ مگابایت |
| نام بسته | `ir.fbt.swap` |
| امضا | debug (تست و توزیع مستقیم) |
| کارمزد | ۰.۵٪ → `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6` |

---

## 🔧 پیشنهاد: خودکار کردن Release

الان workflow فقط artifact می‌سازد، که دانلودش لاگین می‌خواهد و zip است. با
اضافه کردن **۸ خط** به آخر فایل، از این به بعد APK خودکار در صفحه Releases
منتشر می‌شود — بدون zip، بدون لاگین، یک لمس و نصب.

**۱.** این لینک را باز کن:

```
github.com/mshiravi433-ctrl/fbtcryp/edit/arena/019fa427-fbtcryp/.github/workflows/build-apk.yml
```

**۲.** برو به **آخر فایل** (بعد از خط
`path: android/app/build/outputs/apk/debug/app-debug.apk`)

**۳.** این ۸ خط را **اضافه** کن (چیزی را پاک نکن):

```yaml
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: latest
          name: FBT Swap - latest
          files: android/app/build/outputs/apk/debug/app-debug.apk
          body: |
            آخرین نسخه. روی فایل apk بزن تا نصب شود.
```

> فاصله‌های ابتدای خط مهم‌اند: `- uses:` باید **۶ فاصله** از چپ داشته باشد،
> دقیقاً هم‌تراز با `- uses: actions/upload-artifact@v4` بالایش.

**۴.** **Commit changes**

از این به بعد هر build، APK را مستقیم در
`github.com/mshiravi433-ctrl/fbtcryp/releases` می‌گذارد.

---

## چرا خودم این کار را نمی‌کنم

امتحان کردم، گیت‌هاب رد کرد:

```
refusing to allow a GitHub App to create or update workflow
`.github/workflows/build-apk.yml` without `workflows` permission
```

توکن من اجازه نوشتن در پوشه `.github/workflows/` را ندارد. این تنها بخشی از
پروژه است که باید خودت انجام بدهی.

همچنین نمی‌توانم فایل APK را از سندباکس دانلود و به Release بچسبانم — سرور
Azure که artifactها را سرو می‌کند از اینجا در دسترس نیست.

---

## تاریخچه نسخه‌ها

### v1.1.0

- رفع باگ بیومتریک — شناسه اثر انگشت ذخیره نمی‌شد
- پاپ‌آپ‌ها به وسط صفحه منتقل شدند، با دکمه بستن
- فارسی پیش‌فرض شد
- صفحه فیوچرز (Perp) و فارم اضافه شد
- صفحات شرایط استفاده و حریم خصوصی
- تماس با ما → تلگرام
- WalletConnect وصل شد

### v1.0.0

اولین نسخه اندروید.
