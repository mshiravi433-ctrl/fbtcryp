# مرحله‌به‌مرحله: چه کاری بدون پول انجام بدهیم

تاریخ بررسی: ۲۰۲۶/۰۸/۰۶ — همهٔ عددها و پاسخ‌های زیر **همین امروز زنده تست شده‌اند**،
نه از حافظه نوشته شده‌اند. هر ادعایی که تست نشده، صریح علامت خورده.

---

## بخش صفر — الان دقیقاً از چه چیزهایی کارمزد می‌گیریم

این را اول می‌آورم چون بدون آن، بقیهٔ سند بی‌معنی است.

| سرویس | وضعیت امروز | مدرک |
|---|---|---|
| **سواپ EVM (KyberSwap)** | ✅ **کارمزد می‌گیریم — ۰٫۷۰٪** | یک quote زندهٔ WETH→USDC روی Base زدم؛ در پاسخ برگشت: `"extraFee":{"feeAmount":"70","chargeFeeBy":"currency_in","isInBps":true,"feeReceiver":"0xaf5ce154...224d6"}` |
| **سواپ بدون گس (0x Gasless)** | ✅ **کارمزد می‌گیریم — ۰٫۷۰٪** | `https://fbtswap.ir/api/gasless/status` → `{"configured":true,"feeBps":70,"feeRecipient":"0xaf5CE154..."}` |
| **پل بین‌شبکه‌ای (LI.FI)** | ✅ **کارمزد می‌گیریم — ۰٫۳۰٪** | `https://fbtswap.ir/api/bridge/status` → `{"integrator":"fbtswap","registered":true,"feePercent":0.003}` |
| **THORChain (شبکه‌های غیر بیت‌کوینی)** | ✅ کارمزد می‌گیریم — ۰٫۷۰٪ | قبلاً تست شد: `"affiliate":"20608"` روی ETH→BTC |
| **THORChain (BTC/BCH/LTC/DOGE)** | ❌ صفر | دیوارهٔ ۸۰ بایتی memo — نیاز به THORName (~۹ دلار) |
| **سواپ سولانا (Jupiter)** | ❌ **صفر** | `https://fbtswap.ir/api/solana/status` → `{"configured":false,"feeReady":false,"referralAccount":null}` |
| **GMX** | ❌ صفر | `VITE_GMX_REF_CODE` خالی است |
| **کیف‌پول سخت‌افزاری (Trezor)** | ❌ صفر | منتظر تأیید آن‌ها |

**خلاصه:** سه خط درآمدی ما زنده و سالم است. سه خط خاموش است.
از این سه خاموش، **فقط یکی واقعاً رایگان است** و پایین توضیح می‌دهم چطور.

---

## بخش یک — ژوپیتر (سولانا): چرا الان صفر است و راه رایگانش چیست

### چرا صفر است

مکانیزم ژوپیتر با KyberSwap فرق دارد. در KyberSwap ما فقط یک آدرس در درخواست
می‌گذاریم و تمام. در ژوپیتر باید **سه چیز روی خودِ بلاکچین ساخته شود**:

1. یک `referralAccount` (یک‌بار)
2. یک `referralTokenAccount` **برای هر توکنی که می‌خواهیم کارمزد بگیریم** — حداقل SOL و USDC
3. کلید API (این یکی رایگان است)

مورد ۲ همان تلهٔ اصلی است. مستندات خودشان امروز این جمله را دارند
(از `developers.jup.ag/docs/swap/order-and-execute`):

> «If the `referralTokenAccount` for the `feeMint` is not initialised, the order
> still returns but executes **without your fees** (the user still gets their swap)»

یعنی اگر ناقص انجامش بدهیم، سواپ کار می‌کند، کاربر راضی است، و ما **صفر** می‌گیریم
و هیچ خطایی هم نمی‌بینیم. بدترین حالت ممکن.

### هزینهٔ واقعی

ساختن این حساب‌ها تراکنش روی زنجیرهٔ سولاناست ⇒ نیاز به SOL دارد.
کیف سولانای ما را همین الان چک کردم:

```
GET https://api.jup.ag/ultra/v1/balances/B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4
→ {"SOL":{"amount":"0","uiAmount":0}}
```

**صفر SOL.** پس ژوپیتر **رایگان نیست** — حدود ۱ دلار SOL لازم دارد (کارمزد شبکه +
اجارهٔ حساب توکن که در سولانا اجباری است).

### 🎯 راه‌حل رایگان که پیدا کردم: OpenOcean

ما همین الان کتابخانهٔ OpenOcean را در کد داریم (`src/lib/openocean.js`) ولی
**فقط برای مقایسهٔ قیمت** استفاده می‌شود، اجرا نمی‌کند. امروز کشف کردم که
OpenOcean **سولانا را هم پوشش می‌دهد و کارمزد ما را هم می‌پردازد** — بدون هیچ
کلید API و بدون هیچ حساب on-chain.

تست زنده‌ای که زدم (SOL→USDC با آدرس سولانای خودمان به‌عنوان referrer):

```
GET https://open-api.openocean.finance/v4/solana/swap
    ?inTokenAddress=So111...112 &outTokenAddress=EPjFW...Dt1v
    &amount=1 &account=B6gysn5J... 
    &referrer=B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4
    &referrerFee=0.7

→ {"code":200,"data":{ ... "feeRatio":0.007 ... "data":"0100000000..." }}
```

`feeRatio: 0.007` یعنی درخواست ۰٫۷٪ ما **پذیرفته شد** و در تراکنش لحاظ شده.
همین را روی EVM هم تست کردم (WETH→USDC روی Base) و آدرس ما
`af5ce154cefd22da5bd1d0a54479e81963a224d6` عیناً داخل calldata برگشت.

طبق مستندات خودشان: «By default, OpenOcean shares 20% of the fee» — یعنی مثل
ژوپیتر ۲۰٪ برمی‌دارند و ۸۰٪ به ما می‌رسد. برابر با ژوپیتر، ولی **بدون هیچ هزینه‌ای**.

**پیشنهاد من:** به‌جای اینکه منتظر ۱ دلار SOL بمانیم، مسیر سولانا را از OpenOcean
اجرا کنیم. این کار برنامه‌نویسی است و من انجامش می‌دهم — از شما هیچ اقدامی
نمی‌خواهد. ولی چون تغییر مسیر اجرای پول است، اول باید تأیید کنید.

### اگر باز هم ژوپیتر را خواستید — مرحله‌به‌مرحله

**گام ۱ — کلید API رایگان (۵ دقیقه، صفر تومان)**

1. برو به <https://developers.jup.ag/portal>
2. ثبت‌نام کن → یک Team بساز
3. `Create API Key` بزن، اسمش را بگذار `fbtswap`
4. کلیدی به شکل `jup_...` می‌دهد. **آن را در چت نفرست.**
5. برو <https://vercel.com/dashboard> → پروژهٔ `fbtcryp-kkxi` → Settings → Environment Variables
6. متغیر جدید:
   - Name: `JUPITER_API_KEY`
   - Value: همان `jup_...`
   - Environment: هر سه تا (Production / Preview / Development)
7. Save → بعد برو تب Deployments → آخرین دیپلوی → منوی سه‌نقطه → **Redeploy**

پلن Free آن‌ها ۱ درخواست بر ثانیه است که برای الان کافی است.

**گام ۲ — حساب referral (نیاز به ~۱ دلار SOL دارد)**

بدون SOL این گام ممکن نیست. وقتی SOL داشتید:

1. برو <https://referral.jup.ag/dashboard>
2. کیف سولانا را وصل کن (**کیف پرداختیِ ما**: `B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4`)
3. `Create Referral Account` → اسم `fbtswap`
4. یک آدرس به تو می‌دهد — این همان `referralAccount` است، **عمومی است و می‌شود در چت فرستاد**
5. ⚠️ **گام حیاتی که همه فراموش می‌کنند:** در همان داشبورد، بخش token accounts:
   - `Create Token Account` برای **SOL** (`So11111111111111111111111111111111111111112`)
   - `Create Token Account` برای **USDC** (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
   - بدون این دو، کارمزد ما بی‌سروصدا صفر می‌ماند
6. در Vercel متغیر `JUP_REFERRAL_ACCOUNT` را با آن آدرس ست کن → Redeploy

**گام ۳ — تأیید (این را من انجام می‌دهم)**

`https://fbtswap.ir/api/solana/status` باید بشود `{"configured":true,"feeReady":true,...}`

---

## بخش دو — KyberSwap: مهم‌ترین کار رایگانِ این فهرست

### چرا مهم است

بزرگ‌ترین خط درآمدی ما همین است و **در معرض خطر است**. مستندات رسمی‌شان
(`docs.kyberswap.com`) امروز این را می‌گوید:

> «Use the API gateway base URL: `https://api.kyberswap.com/swap/`. Include an
> `X-Api-Key` header with every request... **The previous base URL remains
> available. It is rate limited.**»

ما روی همان آدرس قدیمیِ محدودشده هستیم. تست زنده:

- آدرس قدیمی (چیزی که ما استفاده می‌کنیم): ✅ کار می‌کند، کارمزد ۷۰ bps را هم برمی‌گرداند
- آدرس جدید بدون کلید: ❌ `{"message":"missing api key","status":401}`

یعنی امروز مشکلی نداریم، ولی **اگر روزی آدرس قدیمی را ببندند، درآمد سواپ EVM ما
یک‌شبه صفر می‌شود**. کلید رایگان است. این را باید انجام داد قبل از اینکه لازم شود.

همچنین سقف فعلی ما **۳ درخواست بر ثانیه** است (از صفحهٔ Rate Limits آن‌ها).
با کلید، این سقف بالا می‌رود.

### مرحله‌به‌مرحله (۱۰ دقیقه، صفر تومان)

۱. یک ایمیل بنویس به: **business@kyber.network**

۲. متن پیشنهادی (کپی کن، انگلیسی است چون آن‌ها فارسی نمی‌خوانند):

```
Subject: API key request — FBT Swap (client-id: fbt-swap)

Hello KyberSwap BD team,

We are FBT Swap, a non-custodial DEX interface at https://fbtswap.ir
(also shipping as an Android app). We have been integrating the Aggregator
API in production, sending the x-client-id header "fbt-swap".

Following your docs note about the gateway migration to
https://api.kyberswap.com/swap/ with an X-Api-Key header, we would like to
request an API key so we can move off the rate-limited legacy base URL
before it is retired.

Chains we route today: Ethereum, BNB Chain, Polygon, Arbitrum, Base,
Optimism, Avalanche.
We use feeReceiver + feeAmount + isInBps + chargeFeeBy=currency_in.

Contact: fbtswap@gmail.com
Site: https://fbtswap.ir
X: https://x.com/CompanyFbt

Thank you,
Mohammad Shiravi — FBT Swap
```

۳. وقتی جواب دادند و کلید را فرستادند:
   - **کلید را در چت نفرست**
   - Vercel → پروژه → Settings → Environment Variables
   - Name: `KYBER_API_KEY` (بدون پیشوند `VITE_` — این یک رمز است)
   - Redeploy

۴. بعد به من بگو «کلید کایبر ست شد» — من کد را به gateway جدید منتقل می‌کنم
   با fallback به آدرس قدیمی، تا اگر کلید مشکلی داشت سواپ نخوابد.

⏱ زمان انتظار: نامعلوم. تیم BD معمولاً چند روز تا دو هفته. پس **همین امروز بفرست.**

---

## بخش سه — بقیهٔ موارد، مرتب‌شده بر اساس «رایگان یا نه»

### ✅ کاملاً رایگان — همین امروز قابل انجام

**۱. کلید ژوپیتر** — بالا توضیح داده شد. (حساب referral رایگان نیست، ولی کلید هست.)

**۲. ایمیل به KyberSwap** — بالا توضیح داده شد. **اولویت اول.**

**۳. پیگیری Trezor**
شما قبلاً درخواست داده‌اید و جواب نیامده. بیش از دو هفته گذشته.
یک ایمیل پیگیری به آدرسی که فرم را از آن ثبت کردید بفرست:

```
Subject: Follow-up — affiliate application for FBT Swap (fbtswap.ir)

Hello,

I submitted an affiliate application for FBT Swap (https://fbtswap.ir) and
have not yet received a reply. Could you please let me know the status?

We are a non-custodial crypto swap interface. Hardware wallet security is
directly relevant to our users, and we already have a placeholder card in
the app ready to carry a Trezor affiliate link.

Contact: fbtswap@gmail.com

Thank you.
```

وقتی تأیید شد → Vercel → `VITE_AFFILIATE_TREZOR` → **Redeploy**
(⚠️ متغیرهای `VITE_` موقع build داخل فایل جاوااسکریپت پخته می‌شوند. بدون Redeploy
هیچ اتفاقی نمی‌افتد. فقط Save کردن کافی نیست.)

**۴. AADS — تبلیغات، پرداخت با بیت‌کوین، بدون KYC**
این تنها راه درآمدیِ غیرکارمزدی است که برای ایران باز است.

- سایت: <https://aads.com/ad-units/new/>
- بدون احراز هویت، بدون فرم مالیاتی، بدون بانک
- پرداخت روزانه، حداقل برداشت **۰٫۰۰۱ BTC**
- کدش فقط HTML/CSS است — بدون جاوااسکریپت، سایت را کند نمی‌کند

مراحل:
1. برو به لینک بالا
2. `Create ad unit` → اندازهٔ بنر را انتخاب کن
3. آدرس بیت‌کوین برداشت را وارد کن
4. کد HTML را کپی کن و برای من بفرست (این کد عمومی است، فرستادنش خطری ندارد)
5. من آن را در جای مناسب — نه وسط صفحهٔ سواپ — قرار می‌دهم

⚠️ صادق باشم: با ترافیک فعلی، درآمد این نزدیک صفر است. ارزشش این است که
**زیرساختش از امروز آماده باشد** تا وقتی ترافیک آمد، از روز اول کار کند.

### 💰 رایگان نیست — به ترتیب ارزانی

| کار | هزینه | چه چیزی باز می‌کند |
|---|---|---|
| **GMX** | ~۰٫۰۲ دلار (گس آربیتروم) | ۵٪ از کارمزد معاملات ارجاعی، بدون حداقل حجم |
| **ژوپیتر referral** | ~۱ دلار SOL | ۵۶ bps مؤثر روی سواپ سولانا |
| **THORName** | ~۹ دلار (۱۰ ساله) | کارمزد BTC/BCH/LTC/DOGE |
| **صندوق Morpho** | ~۲۵ دلار | کارمزد مدیریت ۱۰٪ |

کیف EVM ما را هم چک کردم: روی اتریوم و آربیتروم **صفر** است. یعنی حتی آن ۲ سنت GMX هم
الان در دسترس نیست.

**ترتیب پیشنهادی وقتی پول شد:** GMX (۲ سنت) → ژوپیتر (۱ دلار) → THORName (۹ دلار).

### ⛔ بسته است — دنبالش نرو

اینها را با مدرک بررسی کرده‌ام، وقت گذاشتن رویشان تلف کردن وقت است:

- **Ledger** — در فرم عضویت، منوی کشویی کشور **ایران را اصلاً ندارد**
- **Travala / Impact.com / Koinly / CoinLedger** — فرم W-8BEN می‌خواهند.
  خودِ FAQ شمارهٔ ۵۴ خزانه‌داری آمریکا: «an account with a W-8 showing an address
  in Iran... should be considered **restricted**»
- **Bitrefill** — ۱٪ می‌دهد ولی به‌صورت **اعتبار فروشگاهی**، نه پول
- **Aave / Compound** — اصلاً برنامهٔ ارجاع ندارند
- **dYdX** — حداقل ۱۰٬۰۰۰ دلار حجم
- **Hyperliquid** — باید ۱۰۰ USDC موجودی نگه داشت

---

## بخش چهار — کاری که خودم باید بکنم (از شما اقدامی نمی‌خواهد)

۱. **اجرای سواپ سولانا از مسیر OpenOcean** — درآمد سولانا بدون خرج یک ریال.
   منتظر تأیید شما هستم چون مسیر اجرای پول را عوض می‌کند.

۲. **KyberSwap با کلید + fallback** — بعد از اینکه کلید رسید.

۳. **اضافه‌کردن Linea و Sonic** — دو شبکه که KyberSwap پشتیبانی می‌کند و ما نداریم.
   رایگان، فقط کد. (۹ شبکهٔ دیگرشان به نظرم فقط شلوغی منو است.)

---

## بخش پنج — کار فوریِ امنیتی که هنوز انجام نشده

کلید LI.FI که در چت فرستادید هنوز باطل نشده. آن کلید **افشا شده** است.
هرکسی که این گفتگو را ببیند می‌تواند از سهمیهٔ ما استفاده کند.

1. <https://portal.li.fi> → وارد شو
2. بخش API Keys → کلید فعلی → **Revoke**
3. `Create new key`
4. Vercel → `LIFI_API_KEY` → مقدار جدید → Redeploy
5. **کلید جدید را در چت نفرست.** فقط بگو «انجام شد».

این کار درآمد جدیدی نمی‌سازد، ولی جلوی از دست رفتن درآمد فعلی را می‌گیرد.

---

## چک‌لیست کوتاه — به ترتیب اولویت

- [ ] ایمیل به `business@kyber.network` (بزرگ‌ترین خط درآمدی ما را بیمه می‌کند)
- [ ] باطل‌کردن کلید LI.FI
- [ ] ایمیل پیگیری Trezor
- [ ] کلید رایگان ژوپیتر از `developers.jup.ag/portal`
- [ ] ساخت ad unit در `aads.com`
- [ ] به من بگو OpenOcean را برای سولانا اجرایی کنم یا نه
