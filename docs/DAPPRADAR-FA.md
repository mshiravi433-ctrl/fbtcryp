# DappRadar — متن آمادهٔ ثبت

راهنمای رسمی خودشان را خواندم و این متن‌ها را **دقیقاً طبق قوانینشان** نوشتم. هر ✅ و ❌ زیر، قانون واقعی آن‌هاست نه سلیقهٔ من.

---

## 🔴 قبل از شروع — دو چیز

**۱. ادبلاک را خاموش کن.** خودشان صریح هشدار داده‌اند: ادبلاک ارسال فرم را می‌شکند و متنت از بین می‌رود.

**۲. اول چک کن قبلاً ثبت نشده باشیم.** در `dappradar.com` جستجو کن «FBT Swap». اگر بود، به‌جای Submit دکمهٔ **Claim dapp** را بزن.

---

## 🔗 لینک درست — این مهم است

آدرس `/dashboard` که قبلاً دادم **به صفحهٔ اصلی ریدایرکت می‌شود** و جای ثبت‌نام ندارد. راهنمای رسمی خودشان مسیر دیگری می‌دهد:

**۱.** برو به: **https://dappradar.com/developers**

**۲.** دکمهٔ **«Submit project»** را بزن

**۳.** *حالا* صفحهٔ ورود/ثبت‌نام می‌آید. سه راه داری:
   - ایمیل (`fbtswap@gmail.com`)
   - حساب گوگل
   - کیف پول

**۴.** ایمیل تأیید را باز کن و لینکش را بزن

**۵.** داخل داشبورد، **گوشهٔ پایین-راست** دنبال **«Submit new dapp»** بگرد

> ترتیب مهم است: صفحهٔ ثبت‌نام **بعد از** زدن Submit project می‌آید، نه قبلش. برای همین `/dashboard` خالی به نظر می‌رسید.

📧 اگر گیر کردی: developers@dappradar.com
💬 دیسکورد: https://discord.com/invite/4ybbssrHkm

---

## فیلد ۱ — Dapp name

```
FBT Swap
```

> قانونشان: بدون شعار تبلیغاتی، بدون اسم دسته‌بندی داخل نام. «FBT Swap DEX» یا «FBT Swap – Best Rates» **رد می‌شود**.

---

## فیلد ۲ — Category

```
DeFi
```

> یک دستهٔ **اصلی** بخواه. ما اول از همه یک صرافی هستیم.

---

## فیلد ۳ — Website

```
https://www.lawpoetics.ir
```

> ❌ **لینک گوگل‌پلی اینجا نگذار.** خودشان گفته‌اند فیلد جداگانه‌ای برای فروشگاه‌ها دارند.

---

## فیلد ۴ — Short description

> سقف رسمی: **۱۶۰ کاراکتر**. متن زیر ۱۱۰ کاراکتر است.

```
Non-custodial DEX interface for swapping crypto across nine networks. You hold your keys and sign every trade.
```

---

## فیلد ۵ — Tags (حداکثر ۵، ولی مجبور نیستی همه را پر کنی)

```
DEX
Swap
Non-custodial
Multichain
Wallet
```

> قانونشان: تگ نامرتبط فقط چون محبوب است انتخاب نکن، و تگ را **مثل دسته‌بندی** نگذار (پس «DeFi» را اینجا تکرار نکردم).

---

## فیلد ۶ — Smart contracts

زیر هر شبکه، **فقط خود آدرس** — بدون لینک اکسپلورر:

```
0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
```

این آدرس را زیر این شبکه‌ها بگذار:
**BNB Chain · Ethereum · Polygon · Arbitrum · Base · Optimism · Avalanche**

> **چرا همین آدرس:** ما قرارداد هوشمند خودمان را deploy نکرده‌ایم چون سواپ‌ها از روترهای موجود (PancakeSwap، Uniswap) عبور می‌کنند. این آدرس دریافت‌کنندهٔ کارمزد ماست و **تراکنش واقعی روی زنجیره دارد** — یعنی همان چیزی که برای ردیابی فعالیت لازم دارند.
>
> اگر فرم آدرس را نپذیرفت، در توضیح بلند بنویس که واسط غیرحضانتی هستیم و به روترهای شخص ثالث مسیریابی می‌کنیم. این حالت را از قبل در متن زیر آورده‌ام.

---

## فیلد ۷ — Full description (سقف ۲۰۰۰ کاراکتر)

این را کامل کپی کن — **۱۶۴۸ کاراکتر** است، جا دارد:

```
FBT Swap is a non-custodial exchange interface that lets you trade tokens across nine networks without ever handing over your keys.

Connect MetaMask, Trust Wallet or any WalletConnect wallet — or create an encrypted wallet inside the app. Every transaction is signed on your own device and broadcast straight to the blockchain. FBT Swap holds no funds, stores no private keys, and cannot move, freeze or reverse anything. There is no account to open and no identity check to pass.

Supported networks: BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Solana and Tron.

Orders route through established DEX aggregators, so you get competitive pricing and deep liquidity without a custodial middleman. The 0.70% platform fee is collected on-chain inside the same transaction you sign, and it is shown to you before you sign — never buried.

What you can do:

• Swap tokens across nine chains from one screen
• Set limit orders and trailing stops that alert you when your price hits
• Run DCA plans that buy on a fixed schedule
• Track live prices, charts and market data
• View your NFTs across five chains, read-only
• Look up any address or transaction in the built-in multi-chain explorer
• Secure the app with fingerprint unlock or a two-factor code

Built for people who want real self-custody without a steep learning curve. The interface is fully translated into 12 languages including English, Persian, Arabic, Turkish, Chinese, Hindi and Spanish, with right-to-left layouts done properly rather than mirrored.

Available as a web app and as a signed Android application.

Built by Fanous Bazaar Pishgam Co., Isfahan, Iran.
```

---

## فیلد ۸ — Social media (هرچه بیشتر بهتر)

```
X:        https://x.com/CompanyFbt
LinkedIn: https://www.linkedin.com/in/mohammad-shiravi-a8891321b
GitHub:   https://github.com/mshiravi433-ctrl/fbtcryp
Email:    fbtswap@gmail.com
```

---

## فیلد ۹ — لوگو و تصاویر

**⚠️ لوگو مشخصات سختگیرانه دارد: دقیقاً ۲۵۰×۲۵۰ پیکسل و حداکثر ۱۵۰ کیلوبایت.**

لوگوی قبلی ما ۵۱۲×۵۱۲ و ۴۱۲ کیلوبایت بود — **رد می‌شد**. یکی مطابق مشخصات ساختم:

| چیز | فایل |
|---|---|
| **لوگو** | `store/dappradar-logo-250.png` ← ۲۵۰×۲۵۰ · ۲۷KB ✅ |
| اسکرین‌شات ۱ | `store/promo-1-swap.png` |
| اسکرین‌شات ۲ | `store/promo-2-market.png` |
| اسکرین‌شات ۳ | `store/promo-3-security.png` |

> اگر روی گوشی هستی، این فایل‌ها را از گیت‌هاب دانلود کن:
> `github.com/mshiravi433-ctrl/fbtcryp` ← پوشهٔ `store`

**نکتهٔ خودشان:** اسکرین‌شات باید **خود اپ** را نشان دهد، نه نمودار و اینفوگرافیک. سه فایل بالا دقیقاً همین‌اند.

---

## ⚠️ توصیهٔ مهم خودشان

> «اول توضیحات را در یک فایل Word بنویس. اگر ارسال شکست خورد، متنت از بین نمی‌رود.»

**پیشنهاد من:** همین صفحه را در گوشی‌ات باز نگه دار و از اینجا کپی کن — همین کار را می‌کند.

---

## بعد از ارسال

⏱ بررسی معمولاً **۳ تا ۷ روز کاری**.

اگر رد شد یا سؤالی پرسیدند، پیام را برایم بفرست — با هم درستش می‌کنیم.

بعد از تأیید، صفحهٔ اختصاصی ما در DappRadar می‌آید که **سئوی قوی دارد** و به سایت ما لینک می‌دهد. این خودش برای رتبهٔ گوگل ارزش دارد، جدا از ترافیک مستقیمش.
