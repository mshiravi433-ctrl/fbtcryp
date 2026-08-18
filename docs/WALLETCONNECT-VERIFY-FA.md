# پیام امنیتی جعلی WalletConnect — ریشه، فیکس کد، و کاری که فقط owner باید در داشبورد انجام دهد

> «Security risk / The domain is flagged unsafe by multiple security providers,
> leave immediately to protect your assets»
> تاریخ: ۲۰۲۶-۰۸-۱۸ · پروژه WalletConnect: `f0e8ca24821402a6226b4b675172b294`

---

## ۱) این پیام از کجا می‌آید و چرا «جعلی» بود

این صفحه را **خودِ کیف پول** (Trust Wallet / MetaMask) نشان می‌دهد، نه اپ ما.
کیف پول، دامنه‌ای را که dapp در session proposal خودش را با آن معرفی کرده
(`metadata.url`) می‌گیرد و آن را از دو مسیر بررسی می‌کند:

1. **Verify API والِت‌کانکت** (`verify.walletconnect.com`) — فقط وضعیت «تأییدشده/
   تأییدنشده» دامنه را برمی‌گرداند. حالت «Unverified» در بهترین حالت یک نشان
   خاکستری است، نه صفحه قرمز.
2. **اسکنر امنیتی خودِ کیف پول** (Blockaid/PhishFort برای تراست،
   eth-phishing-detect برای متامسک) — این همان مسیری است که صفحه قرمز
   «flagged unsafe by multiple security providers» را تولید می‌کند.

**ریشه فنی در کد ما پیدا شد:** تابع `repairSignClientMetadata()` در
`src/context/WalletContext.jsx` متادیتا را روی `wc.signer.client.metadata`
اصلاح می‌کرد. بررسی نسخه نصب‌شده (`@walletconnect/sign-client@2.23.10`) نشان
داد SignClient متادیتا را روی **خودش** (`signer.metadata`) نگه می‌دارد و
`signer.client` همان Core است که اصلاً پراپرتی `metadata` ندارد. پس آن «تعمیر»
یک no-op خاموش بود، و `populateAppMetadata()` داخل SDK — که هر جا هاستِ
`metadata.url` با `window.location.origin` فرق کند مقدار ما را با origin صفحه
overwrite می‌کند — مقدار `https://localhost` (در APK) یا آدرس preview را در
پروپوزال می‌گذاشت. کیف پول dapp‌ای را می‌دید که خودش را «https://localhost»
معرفی کرده — و این دقیقاً همان چیزی است که اسکنرهای امنیتی کیف پول پرچم
می‌زنند.

**فیکس (این شاخه):** repair حالا اول `wc.signer.metadata` را اصلاح می‌کند
(و شاخه Core را به‌عنوان دفاع آینده نگه می‌دارد)، نتیجه را verify می‌کند و
در event trace (`metadata_repaired` / `metadata_repair_failed`) گزارش می‌دهد.
تست `test/wc-connect-probe.mjs` قفلش کرده که مسیر مرده قبلی برنگردد.

بررسی لیست‌های فیشینگ واقعی: `fbtswap.ir` و `lawpoetics.ir` در
`eth-phishing-detect` متامسک (config.json اصلی)، و در جستجوی عمومی هیچ ردی از
flag شدن پیدا نشد. پس مشکل از لیست سیاه نبود — از هویت نادرست dapp بود که
اسکنرها آن را خطرناک تشخیص می‌دادند.

## ۲) کاری که فقط owner باید در داشبورد انجام دهد

این بخش از کد قابل انجام نیست — دسترسی `cloud.reown.com` لازم است:

1. وارد **https://cloud.reown.com** شوید → پروژه `f0e8ca24821402a6226b4b675172b294`.
2. **Verify API:** در تب Verify، دامنه `https://fbtswap.ir` را ثبت و attestation
   آن را تأیید کنید. این همان چیزی است که نشان سبز «Verified» را در پروپوزال
   کیف پول فعال می‌کند. (ثبت attestation سمت کلاینت ممکن نیست چون به کلید
   سرور نیاز دارد — این بخشی از پروژه است نه از باندل کلاینت.)
3. **Allowed Domains (هشدار مهم):** این لیست باید **خالی بماند**. origin واقعی
   APK اندروید `https://localhost` است؛ اگر دامنه‌ای در این لیست ثبت شود، رله
   درخواست APK را رد می‌کند و اتصال داخل اپ می‌میرد. (همین الان هم در کد
   توضیح داده شده — `WC_ORIGIN_BLOCKED` برای همین حالت است.)
4. اگر بعد از انتشارِ فیکس باز هم پیام قرمز روی دامنه واقعی دیده شد، یعنی
   دامنه در لیست یکی از سرویس‌های امنیتی کیف پول flag شده. مسیر اعتراض:
   - MetaMask: PR به whitelist ریپوی `MetaMask/eth-phishing-detect`
     (https://github.com/MetaMask/eth-phishing-detect)
   - Trust Wallet: فرم اعتراض Blockaid / تیکت رسمی تراست
   - PhishFort: فرم اعتراض در phishfort.com

## ۳) چرا «بدون projectId» گزینه نیست

`EthereumProvider.init()` بدون `projectId` اصلاً اجرا نمی‌شود و رد می‌کند —
این شناسه مدرک مسیریابی/احراز هویت رله است، نه چیزی که بشود «برای امنیت»
حذفش کرد. شناسه ذاتاً عمومی است (در باندل هر کلاینتی هست) و راز نیست؛ چیزی که
امنیت را تعیین می‌کند ثبت/تأیید دامنه در داشبورد است (بخش ۲). این توضیح در
FAQ آفلاین (`wcNoProjectId`) هم برای کاربران نوشته شده.

## ۴) تست فیکس

1. APK جدید بسازید، در گوشی واقعی Connect → WalletConnect بزنید و در کیف پول
   (تراست و متامسک هر دو) ببینید dapp با نام **FBT Swap** و دامنه
   **https://fbtswap.ir** ظاهر می‌شود — نه localhost.
2. در dev-build، کنسول باید `[wc] metadata_repaired` نشان دهد (رویداد trace،
   بدون هیچ داده حساس).
3. در وب (fbtswap.ir) هم پروپوزال باید همان هویت را داشته باشد.
4. تست خودکار: `npm test` → suites «WalletConnect behavior» و «WalletConnect
   storage hygiene» و «WalletConnect chain resolution».

## ۵) درباره redirect و آیکن (بررسی شد — مشکلی نیست)

- `metadata.icons` همیشه `${publicUrl}/icon-512.png` است — فایل واقعی و قابل
  fetch از fbtswap.ir. آیکن ۴۰۴ یکی از دلایل رد شدن پروپوزال است؛ این مورد
  تحت تست `walletconnect-wiring.mjs` قفل شده.
- `metadata.redirect.native` فقط داخل APK (و فقط اندروید) برابر
  `ir.fbtswap.app://` است و با `custom_url_scheme` مانیفست هم‌خوانی دارد (تست
  wiring). روی وب هرگز فرستاده نمی‌شود، پس هیچ کیف پولی فکر نمی‌کند سایت،
  اپ جعلی متامسک/تراست است.
- `redirect.universal` همیشه همان `publicUrl` است.
