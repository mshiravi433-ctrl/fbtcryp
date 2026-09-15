# رفع خطای «Invalid URL» هنگام اتصال تراست والت (از داخل اپ یا سایت)

گزارش: «برای وصل شدن به تراست والت، اگر در مرورگر باشد متامسک یا والت‌کانکت
وصل می‌شود، اما اگر در اپ یا سایت بخواهی وصل کنی ارور **Invalid URL** می‌دهد و
یک لینک زیرش می‌نویسد و وصل نمی‌شود.»

این سند می‌گوید مشکل کجا بود، چه چیزی عوض شد، و برای اینکه واقعاً روی گوشی
درست شود چه کارهایی فقط از دست خودت برمی‌آید.

---

## تشخیص: مشکل از جفت‌شدن نبود، از آخرِ یک مترِ آخر بود

رله، آی‌دی پروژه و نشست همگی سالم بودند. سه چیزِ جدا در «آدرسی که به گوشی
می‌دهیم» اشتباه بود.

### ۱. لینک‌ها را به شکلی می‌نوشتیم که مودال اصلاً نمی‌خواند

در `buildWcInitConfig()` فهرست کیف پول‌ها با این شکل تعریف شده بود:

```js
mobileWallets: [{ id: 'trust', name: 'Trust Wallet', links: { native: 'trust://', universal: 'https://link.trustwallet.com/' } }]
```

این شکلِ مودال قدیمی (Web3Modal مستقل) بود. از
`@walletconnect/ethereum-provider@2.23` به بعد مودالِ داخل SDK
**`@reown/appkit`** است و تابع `convertWCMToAppKitOptions()` از هر آیتم فقط
`{ id, name, links }` را کپی می‌کند. اما خودِ AppKit هرگز `links` را نمی‌خواند:

* `w3m-connecting-wc-view.determinePlatforms()` فقط این فیلدها را می‌بیند:
  `mobile_link`، `desktop_link`، `webapp_link`، `injected`، `rdns`؛
* `ConnectionControllerUtil.onConnectMobile()` برای ساختن لینک فقط
  `wallet.mobile_link` را می‌خواند.

یعنی آیتمی که فقط `links` دارد **هیچ لینکی ندارد**. نتیجه: بعد از لمس نام
تراست والت، فهرستِ پلتفرم‌ها خالی می‌ماند و کاربر به جای کیف پول، به صفحهٔ
«unsupported» می‌رود (یا هیچ چیز باز نمی‌شود). این همان الگوی «لیست کیف پول‌ها
هست اما لمس کردنش کاری نمی‌کند» است که قبلاً هم گزارش شده بود.

### ۲. لینکی که ساخته می‌شد، طرحِ اختصاصی (`trust://…`) بود

حتی جایی که لینکی وجود داشت، همان `trust://wc?uri=…` بود. طرحِ اختصاصی فقط از
مرورگرِ سیستم باز می‌شود. داخل یک **WebView** — اپ بسته‌بندی‌شده، تلگرام، یا
مرورگرِ داخلی خود تراست والت — `trust://` یک طرحِ ناشناس است و WebView دقیقاً
همان چیزی را نشان می‌دهد که گزارش شد: **«Invalid URL»** و همان آدرسِ خراب به
شکل لینک در زیرش.

مستندات رسمی خود تراست والت شکلِ درست را تجویز می‌کند:

```js
const deepLink = `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`
window.open(deepLink, '_blank', 'noreferrer noopener')
```

یک لینکِ https از هر جایی باز می‌شود: از مرورگر، از WebView، و از لایهٔ سیستم
(Android App Links / iOS Universal Links) که آن را به اپ کیف پول می‌سپارد — و
اگر اپ نصب نباشد به یک صفحهٔ وب می‌رود، نه به یک صفحهٔ خطا.

### ۳. هویتِ اپ داخل APK همچنان `https://localhost` بود

`populateAppMetadata()` در `@walletconnect/utils` هر وقت هاستِ `metadata.url` با
هاستِ `window.location.origin` فرق داشته باشد، آن را با origin بازنویسی می‌کند.
داخل APK آن origin یعنی `https://localhost` — آدرسی که کیف پول (یک اپ جدا)
نمی‌تواند آن را بگیرد. تعمیرِ این مورد در کد بود، اما هدف را اشتباه نشانه رفته
بود: `wc.signer.client` **خودِ SignClient** است (نه Core) و همان چیزی است که
موتور از آن پیشنهادِ نشست را می‌سازد؛ کد قدیم نتیجه را از `wc.signer.metadata`
گزارش می‌کرد که اصلاً وجود ندارد، پس در ردپای رویدادها همیشه
`metadata_repair_failed` ثبت می‌شد و کسی به این پیام اعتماد نمی‌کرد.

---

## چه چیزی عوض شد

### `src/lib/wcWallets.js` (جدید)

یک جدول واحد برای کیف پول‌های معرفی‌شده (متامسک، تراست والت، رینبو) که هر دو
شکل را از یک منبع تولید می‌کند:

* `appKitCustomWallets()` — شکلی که AppKit واقعاً می‌خواند: `mobile_link`
  (طرحِ اختصاصی، به‌عنوان fallback) و `link_mode` (لینکِ https). بدون
  `link_mode` اصلاً لینکِ https ساخته نمی‌شود.
* `walletLink()` / `walletLinkBase()` — قاعدهٔ دقیقِ AppKit برای چسباندن
  `wc?uri=` (فقط اضافه‌کردنِ اسلش، هرگز حذفِ آن؛ و کدگذاریِ دقیقاً یک‌باره).
* `legacyModalWallets()` — همان شکل قدیمی برای `qrModalOptions`.

### `src/context/WalletContext.jsx`

* `applyAppKitWalletLinks()` بعد از `init()` و **قبل از** `wc.connect()`
  (همان‌جا که مودال باز می‌شود):
  * `customWallets` با `mobile_link` و `link_mode`؛
  * `experimental_preferUniversalLinks: true` — یعنی AppKit به‌جای طرحِ
    اختصاصی، **لینکِ https را باز کند**. همین یک خط «Invalid URL» را از بین
    می‌برد؛
  * متادیتای عمومی، تا مودال هم اپ را با Origin خودِ WebView معرفی نکند.
  * این کار روی نمونهٔ مودالی که خودِ EthereumProvider ساخته
    (`wc.modal.updateOptions()`) انجام می‌شود، و اگر آن متد در نسخه‌ای حذف
    شود به کنترلرهای AppKit سقوط می‌کند؛ در هر دو صورت فقط «بهترین تلاش» است و
    هرگز باعث شکستِ دکمهٔ Connect نمی‌شود.
* `explorerRecommendedWalletIds: 'NONE'` — کیف پول‌های معرفی‌شده دیگر از پاسخِ
  `api.web3modal.org` ساخته نمی‌شوند؛ روی شبکه‌ای که آن API را فیلتر می‌کند
  همان سه کیف پول با لینکِ درست حاضرند.
* تعمیرِ متادیتا اصلاح شد: هدفِ اصلی `wc.signer.client` (SignClient)، هدفِ
  دفاعی `wc.signer` و `wc.rpc`، و نتیجه از همان شیئی گزارش می‌شود که موتور
  می‌خواند.

### تست

`test/wc-wallets-probe.mjs` (۳۴ ادعا، داخل `npm test`) قفل می‌کند که:

* لینک تراست والت بایت‌به‌بایت همان چیزی است که مستندات خودش تجویز می‌کند؛
* URI دقیقاً یک‌بار encode می‌شود؛
* هر کیف پول یک لینکِ https دارد (طرحِ اختصاصی به‌تنهایی ممنوع)؛
* ورودی‌هایی که به AppKit می‌رسند `mobile_link` و `link_mode` دارند و هیچ‌کدام
  به `links` وابسته نیستند؛
* با شبیه‌سازیِ وفادارانهٔ `determinePlatforms()`، شکل قدیمی هیچ پلتفرمی پیدا
  نمی‌کند (همان باگ) و شکل جدید روی موبایل «deep link» و روی دسکتاپ «QR» است.

`test/wc-connect-probe.mjs` هم به‌روز شد (ادعاهای قدیمی دربارهٔ محلِ متادیتا
اشتباه بودند و با نسخهٔ نصب‌شدهٔ SDK تأیید شده‌اند).

---

## تأیید تجربی روی خودِ SDK

با `@reown/appkit-controllers@1.8.19` نصب‌شده:

```js
CoreHelperUtil.formatNativeUrl('trust://', uri)
// → { redirect: 'trust://wc?uri=…' }                      ← بدون لینک https

CoreHelperUtil.formatNativeUrl('trust://', uri, 'https://link.trustwallet.com/')
// → { redirect: 'trust://wc?uri=…',
//     redirectUniversalLink: 'https://link.trustwallet.com/wc?uri=…' }
```

و `onConnectMobile()` وقتی `OptionsController.state.experimental_preferUniversalLinks`
درست باشد، `redirectUniversalLink` را باز می‌کند — یعنی همان لینکی که
WebView می‌فهمد.

---

## قدم‌هایی که فقط از دست خودت برمی‌آید

1. **انتشار دوبارهٔ وب** — متغیرهای `VITE_*` موقع build در باندل می‌روند؛ بعد
   از merge باید deploy جدید انجام شود و صفحه با رفرش سخت باز شود.
2. **APK جدید** — نسخه‌ای که روی گوشی است با کد قدیمی ساخته شده؛ بعد از merge،
   workflow «Build APK» را نصب کن و با همان تست کن.
3. **نشست‌های قدیمی را پاک کن** — در تراست والت و متامسک، بخشِ اتصال‌های
   WalletConnect را باز کن و هر نشستِ قدیمیِ fbtswap / lawpoetics را حذف کن.
4. **اگر باز هم نشد**، پیامِ خطای داخل شیتِ اتصال را بخوان: «دسترسی به رِله
   ممکن نشد» یعنی فیلترینگ شبکه (راهکار همان است که در
   `docs/WALLETCONNECT-FIX-FA.md` نوشته شده: VPNِ سراسری، یا باز کردن سایت در
   مرورگرِ داخلی خود کیف پول که اصلاً به رله نیاز ندارد).

نکتهٔ ظاهری: چون فهرستِ معرفی‌شده دیگر از API اکسپلورر نمی‌آید، آیکونِ این سه
کیف پول در مودال به‌جای لوگوی برند، آیکونِ عمومی والت است. این عمدی است:
یک آیکونِ ساده بهتر از ورودیِ زیبایی است که باز نمی‌شود.
