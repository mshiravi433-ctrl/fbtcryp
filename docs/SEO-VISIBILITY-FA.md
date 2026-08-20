# دیده‌شدن `fbtswap.ir` — نقشهٔ اجرای سئو و انتشار

> این برنامه برای دیده‌شدن **واقعی و پایدار** است، نه خرید بازدید یا لینک اسپم. هیچ فهرست یا موتور جست‌وجویی رتبهٔ یک را تضمین نمی‌کند؛ هدف این است که موتورهای جست‌وجو، کیف‌پول‌ها و مخاطبِ درست بتوانند محصول واقعی را پیدا و بررسی کنند.

## کارهایی که در خود سایت آماده شده‌اند

بعد از انتشار نسخهٔ production، سایت این زیرساخت را دارد:

- `https://fbtswap.ir/robots.txt` با ارجاع به نقشهٔ سایت؛
- `https://fbtswap.ir/sitemap.xml` با صفحهٔ اصلی و راهنماهای واقعی؛
- صفحه‌های استاتیکِ قابل‌خزش فارسی و انگلیسی، با canonical، `hreflang`، FAQ قابل‌خواندن، breadcrumb و دادهٔ ساختاریافته؛
- کارت اشتراک‌گذاری برای تلگرام، واتس‌اپ، لینکدین و X؛
- ارسال خودکار URLهای production به IndexNow برای موتورهای پشتیبان آن. این مورد **جای ثبت دستی در گوگل را نمی‌گیرد**.

### صفحه‌ای که باید برای هر موضوع لینک بدهی

به‌جای اینکه همیشه فقط صفحهٔ اصلی را بگذاری، لینک را با موضوع همان محتوا هماهنگ کن:

| موضوع محتوا | لینک درست |
|---|---|
| سواپ غیرامانی / صرافی غیرمتمرکز | `https://fbtswap.ir/صرافی-غیرمتمرکز` |
| هشدار قیمت، حد ضرر متحرک، خرید پله‌ای | `https://fbtswap.ir/هشدار-قیمت-ارز-دیجیتال` |
| تحلیل تکنیکال، RSI، MACD، حمایت و مقاومت | `https://fbtswap.ir/تحلیل-تکنیکال-ارز-دیجیتال` |
| کیف پول غیرامانی و امنیت عبارت بازیابی | `https://fbtswap.ir/کیف-پول-غیرامانی` |
| مخاطب انگلیسیِ سواپ غیرامانی | `https://fbtswap.ir/non-custodial-crypto-swap` |
| صفحهٔ اصلی محصول | `https://fbtswap.ir/` |

لینکِ موضوعی هم برای کاربر مفیدتر است و هم به موتور جست‌وجو نشان می‌دهد هر صفحه واقعاً دربارهٔ چه چیزی است.

---

## اولویت ۱ — ثبت در موتورهای جست‌وجو (همین امروز)

### 1) Google Search Console — مهم‌ترین کار

**برو به:** <https://search.google.com/search-console>

1. Property از نوع **URL prefix** بساز و دقیقاً `https://fbtswap.ir/` را وارد کن.
2. روش تأیید **HTML tag** را انتخاب کن. تگ تأیید در `index.html` از قبل وجود دارد؛ آن را حذف نکن.
3. بعد از تأیید، از منوی **Sitemaps** فقط `sitemap.xml` را Submit کن.
4. پس از deploy، با **URL inspection** این چهار URL فارسی را جداگانه بررسی کن و در صورت آماده‌بودن صفحه، `Request indexing` بزن:
   - `https://fbtswap.ir/صرافی-غیرمتمرکز`
   - `https://fbtswap.ir/هشدار-قیمت-ارز-دیجیتال`
   - `https://fbtswap.ir/تحلیل-تکنیکال-ارز-دیجیتال`
   - `https://fbtswap.ir/کیف-پول-غیرامانی`

راهنمای رسمی گوگل دربارهٔ sitemap: <https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap>

**نکته:** درخواست ایندکس و sitemap «درخواست بررسی» هستند، نه تضمین ایندکس یا رتبه. به endpointهای قدیمیِ `ping?sitemap=` گوگل چیزی نفرست؛ گوگل آن روش را کنار گذاشته است.

### 2) Bing Webmaster Tools

**برو به:** <https://www.bing.com/webmasters/>

بعد از تأیید Google Search Console، گزینهٔ **Import from Google Search Console** را بزن. سپس چک کن که این فایل در Sitemaps دیده می‌شود:

```text
https://fbtswap.ir/sitemap.xml
```

این کار برای Bing و سرویس‌هایی که از دادهٔ آن استفاده می‌کنند مفید است. راهنمای رسمی Import: <https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b>

### 3) Yandex Webmaster

**برو به:** <https://webmaster.yandex.com/>

1. سایت `https://fbtswap.ir/` را اضافه و تأیید کن.
2. از **Indexing → Sitemap files**، آدرس کامل `https://fbtswap.ir/sitemap.xml` را اضافه کن.
3. وضعیت crawl و خطاهای sitemap را هر دو هفته یک‌بار بررسی کن.

راهنمای رسمی sitemap یاندکس: <https://yandex.com/support/webmaster/en/indexing-options/sitemap>

---

## اولویت ۲ — جایی که واقعاً مخاطب Web3 حضور دارد

این‌ها صرفاً «بک‌لینک» نیستند؛ اگر اطلاعات درست ثبت شود، کاربرِ آمادهٔ استفاده هم می‌آورند.

### 4) DappRadar

**ثبت پروژه:** <https://dappradar.com/developers>

- دسته: `DeFi` / `Exchange` یا نزدیک‌ترین دستهٔ دقیق؛
- وب‌سایت: `https://fbtswap.ir/`؛
- لوگو، اسکرین‌شات واقعی و توضیح کوتاه را کامل بگذار؛
- فقط آدرس قراردادهایی را وارد کن که واقعاً متعلق به FBT Swap هستند. قرارداد PancakeSwap، KyberSwap یا Uniswap را به‌عنوان قرارداد خودت معرفی نکن؛
- اگر فرم بین «dapp» و «Web3 project» فرق می‌گذارد و قرارداد مستقلِ live نداری، گزینهٔ صادقانه‌تر را انتخاب کن.

DappRadar برای بررسی معمولاً نام، URL، لوگو، توضیح، شبکه‌ها، آدرس قراردادهای واقعی و شبکه‌های اجتماعی می‌خواهد. راهنمای رسمی: <https://dappradar.com/blog/how-to-list-your-dapps-on-dappradar-for-free>

### 5) BNB Chain DappBay

**ثبت پروژه:** <https://dappbay.bnbchain.org/submit-dapp>

چون BNB Chain واقعاً در محصول پشتیبانی می‌شود، این مورد اولویت بالایی دارد. پیش از ارسال این‌ها را آماده کن: URL سایت، لوگو، توضیح صادقانه، آدرس/تنظیمات BNB Chain که واقعاً در محصول استفاده می‌شود و راه تست. راهنمای BNB Chain: <https://docs.bnbchain.org/join-ecosystem/platforms/dappbay/>

### 6) WalletConnect Explorer

**داشبورد:** <https://dashboard.reown.com/>

در Project موجود، بخش **Explorer** را تکمیل و Submit کن:

- Type: dApp؛
- Homepage و Web App: `https://fbtswap.ir/`؛
- Chains: فقط شبکه‌هایی که واقعاً در UI قابل استفاده‌اند؛
- لوگو و توضیح کوتاه؛
- Testing instructions: وصل‌کردن WalletConnect، انتخاب شبکه، دیدن quote و تأیید اینکه امضای تراکنش داخل کیف پول کاربر انجام می‌شود.

این کار اختیاری است، اما باعث می‌شود پروژه در Explorer/WalletGuide قابل کشف باشد. راهنمای رسمی: <https://docs.walletconnect.network/wallet-sdk/ios/cloud/explorer-submission>

### 7) Trust Wallet dApp listing — بعد از آماده‌بودن کامل

**راهنما:** <https://developer.trustwallet.com/developer/listing-guide>

فقط زمانی درخواست بده که اتصال، URL، لوگو، راهنمای امنیتی و مسیر تست پایدار هستند. این فهرست curated است؛ ادعای اغراق‌آمیز یا ناقص‌بودن اطلاعات شانس ردشدن را بالا می‌برد.

---

## اولویت ۳ — کانال‌های برند و مخاطب فارسی

### 8) تلگرام، X و GitHub

- در bio/website کانال رسمی تلگرام و پروفایل X، `https://fbtswap.ir/` را بگذار.
- برای یک پست آموزشی دربارهٔ سواپ، به صفحهٔ «صرافی غیرمتمرکز» لینک بده؛ برای پست تحلیل، به صفحهٔ تحلیل؛ و برای پست امنیت، به صفحهٔ کیف پول. از کپی‌کردن یک لینک ثابت در همه‌جا پرهیز کن.
- در بخش **About → Website** مخزن GitHub، دامنهٔ `https://fbtswap.ir/` را بگذار. README پروژه نیز باید همین دامنه و تعداد واقعی شبکه‌ها را نشان دهد.
- اگر کانال یا صفحهٔ رسمی دیگری ساختی، نام، لوگو، URL و ایمیل پشتیبانی را دقیقاً یکسان نگه دار: `FBT Swap`، `https://fbtswap.ir/` و `fbtswap@gmail.com`.

### 9) انتشار اپ Android

صفحهٔ رسمی APK در یک فروشگاه شناخته‌شده می‌تواند جست‌وجوی برند و اعتماد کاربر را بهتر کند. اولویت با فروشگاه‌هایی است که اپِ واقعی و نسخهٔ امضاشده را بررسی می‌کنند، نه سایت‌های دانلود ناشناس. راهنماهای موجود پروژه برای APKPure، Uptodown، مایکت و کافه‌بازار در `docs/APK-STORES-FA.md` و `docs/PUBLISH-COPY-AND-LINKS-FA.md` هستند.

در صفحهٔ هر فروشگاه، URL سایت را `https://fbtswap.ir/` بگذار و اسکرین‌شات واقعی همان نسخهٔ منتشرشده را آپلود کن. صفحهٔ اپ باید به‌وضوح بگوید که تراکنش‌ها واقعی‌اند و کاربر باید هر معامله را در کیف پول خودش تأیید کند.

---

## متن آمادهٔ کوتاه برای فرم‌ها و معرفی‌ها

### فارسی (حدود ۱۵۰ کاراکتر)

> اف‌بی‌تی سواپ یک رابط غیرامانی برای سواپ ارز دیجیتال روی ۱۰ شبکه است. کلید و دارایی نزد کیف پول کاربر می‌ماند و هر تراکنش با امضای خودش انجام می‌شود.

### English (under 160 characters)

> FBT Swap is a non-custodial crypto swap interface on 10 networks. Users keep their keys and sign every transaction from their own wallet.

### پاسخ کوتاه برای «چرا متفاوت است؟»

> FBT Swap does not take deposits or sign in place of the user. It shows a quote, price impact and fee, then the user approves the on-chain transaction from their own wallet.

از عبارت‌هایی مثل «سود تضمینی»، «بهترین قیمت تضمینی»، «بدون ریسک»، «صرافی رسمی» یا ادعای پشتیبانی از شبکه/توکنی که واقعاً در محصول نیست استفاده نکن.

---

## چه کارهایی انجام نده

- لینک انبوه، خرید بک‌لینک، کامنت‌اسپم، پروفایل‌اسپم و PBN نخَر؛ معمولاً اثر پایدار ندارند و می‌توانند اعتبار دامنه را خراب کنند.
- برای یک عبارت، ده‌ها صفحهٔ نازکِ «تبدیل BTC به X» نساز؛ فقط برای قابلیتی صفحه بساز که واقعاً کار می‌کند و توضیح مفید دارد.
- سایت را در Google Business Profile ثبت نکن، مگر اینکه واقعاً مکانِ دارای مراجعهٔ حضوری/خدمت حضوری با ساعت مشخص داری. یک کسب‌وکار صرفاً آنلاین معمولاً واجد شرایط آن نیست.
- هیچ‌وقت عبارت بازیابی، کلید خصوصی یا رمز کیف پول را در فرم ثبت سایت، DM یا ایمیل نفرست.
- به شکل خودکار صدها URL هش‌دار (`/#/...`) را به موتورهای جست‌وجو نفرست؛ بخش بعد از `#` یک سند مستقل برای crawler نیست.

---

## برنامهٔ ۳۰ روزهٔ ساده

| زمان | کار | معیار موفقیت |
|---|---|---|
| روز انتشار | deploy production و بازکردن `robots.txt`، `sitemap.xml` و چهار صفحهٔ فارسی | پاسخ 200 و canonical روی `fbtswap.ir` |
| روز ۱ | Search Console + Bing + Yandex | sitemap پذیرفته شده و خطای مهم ندارد |
| هفتهٔ ۱ | DappRadar، DappBay، WalletConnect Explorer | درخواست ثبت کامل، همراه با لوگو و راه تست واقعی |
| هفتهٔ ۲ | ۲ تا ۴ محتوای آموزشی واقعی در کانال‌های رسمی | هر محتوا یک لینک موضوعی مناسب دارد |
| هفتهٔ ۴ | Search Console → Pages و Performance را بررسی کن | URLهای معتبر در crawl/index و عبارت‌های جست‌وجو قابل مشاهده‌اند |

`site:fbtswap.ir` فقط یک بررسی تقریبی است؛ معیار اصلی، گزارش **Pages** و **Performance** در Search Console است.
