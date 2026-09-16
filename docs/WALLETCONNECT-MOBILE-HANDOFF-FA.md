# گزارش نهایی رفع WalletConnect موبایل — Trust، Uniswap و MetaMask

تاریخ بررسی: ۲۰۲۶-۰۹-۱۵

## خلاصه

QR کار می‌کرد؛ بنابراین Project ID، ساخت pairing URI، رله و اصل proposal خراب نبودند. شکست در **آخرین متر انتقال URI از dApp به اپ کیف پول** رخ می‌داد.

رفتار قبلی همهٔ لینک‌های موبایل را به universal link‌ HTTPS تبدیل می‌کرد. این لینک می‌توانست Trust Wallet یا Uniswap را باز کند، اما بازشدن اپ به معنی رسیدن pairing URI نیست. redirector ممکن بود پارامتر `uri=wc:…` را حذف کند؛ نتیجه دقیقاً همان علامت گزارش‌شده بود: کیف پول باز می‌شود ولی درخواست Connect وجود ندارد. MetaMask نیز سابقهٔ همین حذف query در مسیر Branch/Universal Link دارد.

راه‌حل نهایی:

- وب موبایل: deep link بومی کیف پول (`trust://wc?uri=…`، `uniswap://wc?uri=…`، `metamask://wc?uri=…`).
- APK اندروید: `ACTION_VIEW` با pairing URI خام `wc:…` و package صریح کیف پول؛ اگر کیف پول URI خام را register نکرده باشد، MainActivity همان‌جا لینک scheme بومی را با `Uri.Builder` می‌سازد. هیچ‌کدام از این دو مسیر از redirector HTTPS عبور نمی‌کنند.
- Telegram Mini App: طرح بومی کیف پول با `window.open(…, '_blank')` و gesture کاربر — همان مکانیزمی که SDK خودِ WalletConnect داخل تلگرام به کلاینت تحویل می‌دهد تا OS اپ را launch کند. در تلگرام-اندروید pairing URI double-encoded فرستاده می‌شود چون کلاینت URL را یک‌بار در مسیر decode می‌کند. `Telegram.WebApp.openLink(https)` فقط fallback آخر است.

> ⚠️ **به‌روزرسانی ۲۰۲۶-۰۹-۱۵ (مدخل ۶ CHANGELOG):** `link.trustwallet.com/wc?uri=…` دیگر redirect خودکار به اپ ندارد؛ صفحهٔ فعلی یک landing دستی است («Open in Trust Wallet» با anchor نوع `trust://`). آن anchor داخل WebView تلگرام intent ایجاد نمی‌کند، پس universal link در تلگرام دیگر بن‌بست است. به همین دلیل تحویل اصلی تلگرام به scheme بومی برگشت و HTTPS آخرین fallback ماند.
- صفحهٔ dApp همیشه زنده می‌ماند (`_blank`، نه `_self`) تا socket رله و Promise اتصال قبل از پاسخ کیف پول نابود نشوند.
- Uniswap Wallet با scheme رسمی `uniswap://` و package رسمی `com.uniswap.mobile` به فهرست اضافه شد.
- `@walletconnect/ethereum-provider` از `2.23.10` به `2.25.0` ارتقا یافت.

## شواهد فنی

1. موفقیت QR نشان می‌دهد همان URI وقتی واقعاً به کیف پول می‌رسد قابل مصرف است.
2. مستندات فعلی WalletConnect برای mobile linking، deep link بومی را بر universal link ترجیح می‌دهد و در Android native dapp از `Intent.ACTION_VIEW` استفاده می‌کند.
3. کد متن‌باز فعلی Uniswap Wallet فرم `uniswap://wc?uri=`، universal form و URI خام `wc:` را parse می‌کند.
4. issue تاریخی MetaMask #4955 مستقیماً حالتی را ثبت کرده که universal redirect اپ را باز می‌کند ولی query pairing را حذف می‌کند. این issue به‌تنهایی اثبات نسخهٔ امروز نیست، اما با علامت فعلی و تفاوت «QR موفق / handoff ناموفق» هم‌خوان است.
5. کد قبلی `src/lib/wcDeepLink.js` عمداً scheme بومی را به HTTPS بازنویسی می‌کرد و `experimental_preferUniversalLinks` نیز روشن بود. هر دو رفتار اکنون native-first شده‌اند.

## تغییرات کد

- `src/lib/wcWallets.js`
  - registry واحد native/universal/package؛
  - افزودن Uniswap؛
  - packageهای MetaMask، Trust، Uniswap، SafePal و Rainbow.
- `src/lib/wcDeepLink.js`
  - لینک native مسیر اصلی؛
  - universal فقط fallback؛
  - استخراج URI خام بدون double encoding؛
  - تبدیل universal ورودی به native همان کیف پول.
- `src/lib/browser.js`
  - انتخاب کانال: `web-native`، `android-intent` یا `telegram`؛
  - عدم navigation صفحهٔ pairing؛
  - ارسال raw URI و package به bridge اندروید.
- `android/app/src/main/java/ir/fbtswap/app/MainActivity.java`
  - bridge محدود `FBTWalletLink`؛
  - اعتبارسنجی WC v2 و `symKey` ۶۴-هگز؛
  - allowlist ثابت package/scheme؛
  - raw `wc:` intent، سپس native-scheme intent؛
  - بدون generic intent proxy.
- `android/app/src/main/AndroidManifest.xml`
  - package visibility برای پنج کیف پول.
- `src/context/WalletContext.jsx`
  - `experimental_preferUniversalLinks: false`؛
  - bridge قبل از `wc.connect()` نصب و در `finally` حذف می‌شود.
- `public/sw.js`
  - cache shell به v10 ارتقا یافت تا PWA باندل handoff قدیمی را نگه ندارد.

## آیا تنظیمی غیر از Project ID لازم است؟

### لازم/مهم در Reown Dashboard

در پروژه‌ای که ID آن در کد استفاده می‌شود، بخش **Project Domains / Allowlist** را بررسی کنید:

- `https://fbtswap.ir`
- اگر واقعاً استفاده می‌شود: `https://www.fbtswap.ir` (hostname دقیق مهم است)
- برای APK: Application ID برابر `ir.fbtswap.app`
- اگر Dashboard برای WebView origin ورودی جدا می‌خواهد: `https://localhost`
- preview/staging فقط در صورتی اضافه شود که واقعاً از همان origin تست می‌کنید.

اگر allowlist خالی باشد Reown همهٔ originها را می‌پذیرد؛ برای production بهتر است allowlist محدود باشد. اگر scheme یا port را می‌نویسید باید دقیقاً match شود. اعمال تغییر ممکن است تا ۱۵ دقیقه طول بکشد.

`metadata.url` باید با دامنهٔ واقعی یکی باشد. کد فعلی آن را عمداً روی `https://fbtswap.ir` نگه می‌دارد، حتی وقتی APK صفحه را از `https://localhost` سرو می‌کند.

### توصیه‌شده، نه علت این باگ

- Domain verification را در Dashboard تکمیل کنید. اگر Dashboard توکن DNS TXT یا فایل `/.well-known/walletconnect.txt` می‌دهد، دقیقاً همان مقدار تولیدشده برای پروژه را استفاده کنید؛ توکن قابل حدس نیست و نباید مقدار ساختگی در repository گذاشت.
- Verify API را فعال/بررسی کنید تا wallet دامنه را معتبر نشان دهد.

### لازم نیست

- Reown API Secret در Vercel یا frontend لازم نیست و نباید با پیشوند `VITE_` منتشر شود.
- IP allowlist لازم نیست؛ SDK از مرورگر/دستگاه کاربر به رله وصل می‌شود.
- تأیید دستی پروژه برای استفاده از Project ID لازم نیست.

## نکته مهم درباره Vercel Project ID

نسخهٔ فعلی عمداً `VITE_WALLETCONNECT_PROJECT_ID` را نمی‌خواند. منبع واحد پروژه در `WalletContext.jsx` است:

`8e36eccabebf5a4567f4e974fafd6b20`

پس Project ID قرارگرفته در Vercel علت موفقیت یا شکست این build نیست. QR با همین ID داخل source موفق بوده است. این تصمیم برای جلوگیری از اختلاف ID سایت و APK گرفته شده؛ اگر روزی ID عوض شود باید منبع واحد کد و تنظیمات Dashboard با هم عوض شوند.

## تست پس از انتشار

1. سایت را در حالت ناشناس یا بعد از hard refresh باز کنید.
2. نشست‌های قدیمی fbtswap را از Connected Sites / WalletConnect Sessions کیف پول حذف کنید.
3. برای هر کیف پول یک pairing تازه بسازید؛ URI حدود پنج دقیقه اعتبار دارد.
4. در Chrome/Safari موبایل: لمس Trust، Uniswap و MetaMask باید مستقیماً درخواست Connect را نشان دهد، نه فقط صفحهٔ اصلی کیف پول.
5. APK تازه را نصب کنید؛ APK قدیمی bridge اندروید را ندارد.
6. بازگشت از کیف پول باید صفحهٔ dApp را زنده و در حال انتظار نگه داشته باشد.
7. QR را نیز دوباره تست کنید تا regression در مسیر پایه رد شود.
8. در Telegram، لمس کیف پول باید همان لحظه اپ را launch کند (تحویل با `window.open` روی scheme بومی). اگر به‌جای آن صفحهٔ `link.trustwallet.com` باز شد، یعنی کلاینت تلگرام window.open را پذیرفته و به fallback رسیده‌ایم — در آن صورت گزینهٔ «Open in browser» یا مسیر «باز کردن سایت داخل مرورگر خودِ کیف پول» راه قطعی است.

## نتیجه

این مشکل با اضافه‌کردن Secret یا Project ID دوم حل نمی‌شد. Project ID و relay پایه از قبل به‌اندازه‌ای سالم بودند که QR کار کند. اصلاح اصلی حذف universal rewrite اجباری و تحویل pairing URI از کانال مناسب هر محیط بود.
