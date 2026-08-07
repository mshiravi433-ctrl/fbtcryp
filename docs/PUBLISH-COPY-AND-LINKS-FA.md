# متن انگلیسی + لینک همهٔ فروشگاه‌ها

> نسخهٔ **۱.۲۷.۰** (versionCode 55) · نوشته: ۱۸ مرداد ۱۴۰۵
> همهٔ لینک‌های این صفحه را همین امروز باز کردم و چک کردم که زنده باشند.

---

# بخش ۱ — فایلی که آپلود می‌کنی

```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/download/latest/app-release.apk
```

**`app-release.apk` — ۹.۵۷ مگابایت — امضاشده**

⚠️ **`FBT-Swap-full.apk` را به هیچ فروشگاهی نده.** آن نسخه صفحات پیش‌بینی و
اهرم را دارد — همان چیزی که قبلاً باعث رد شدن با «کلمات حساس» شد.

---

# بخش ۲ — توضیحات طولانی (انگلیسی)

**۳٬۴۷۰ کاراکتر** — سقف گوگل‌پلی ۴٬۰۰۰ است، بقیهٔ فروشگاه‌ها بیشتر می‌دهند.
از `FBT Swap is...` تا `...Isfahan, Iran.` را کامل کپی کن.

```
FBT Swap is a non-custodial wallet interface for Android. You connect a wallet
you already own, you exchange one token for another through public smart
contracts, and your assets never leave your control. There is no account, no
email, no identity check, and no company wallet holding your money.

WHAT IT DOES

• Swap tokens across ten networks: BNB Smart Chain, Ethereum, Polygon,
  Arbitrum One, Base, Optimism, Avalanche, Linea, Sonic and Solana.
• Thousands of tokens from public token lists, searchable by ticker, name or
  contract address — plus import-any-contract for tokens too new to be listed.
• An optional in-app wallet whose recovery phrase is encrypted on your device
  and never transmitted anywhere.
• Biometric app lock (fingerprint or face) and TOTP two-factor authentication.
• Camera QR scanning for wallet addresses and WalletConnect pairing.
• Price alerts and recurring buy plans that notify you on your phone, even
  when the app is closed.
• Live market data: prices, 24-hour change, charts and coin detail pages.
• Technical indicators (RSI, MACD, Bollinger Bands, moving averages,
  volatility) computed on your device from public price data.
• Chart history: how often a price level has held, the largest fall in the
  period, and how today's volume compares with normal.
• Crypto news, refreshed daily from public feeds.
• A step-by-step guide written for people who have never used a wallet.
• 12 languages including Persian, Arabic and Urdu, with full right-to-left
  layout, plus light and dark themes.
• Works offline for everything that does not need live prices.

HOW THE SWAP WORKS

FBT Swap does not run an order book and holds no liquidity of its own. It
compares routes from public aggregators across the decentralised protocols on
the network you chose, shows you the quote, the price impact and the fee, then
hands the transaction to your wallet. You are the one who signs it. The
exchange settles on-chain, directly between your wallet and the protocol.

There is no leverage, no derivatives, no prediction market and no game of
chance anywhere in this app.

FEES, STATED PLAINLY

• Platform fee: 0.70% of the amount you are swapping, taken from the input
  token inside the same on-chain transaction. It is shown on screen before you
  sign — never after.
• Network gas: paid in the network's own coin. This goes to the network's
  validators, not to us, and we cannot reduce it.

YOUR KEYS, YOUR COINS

We never receive your recovery phrase, private key or wallet password. This
also means what you would expect: we cannot reverse a transaction, freeze
funds, refund a swap you regret, or recover a lost recovery phrase. Nobody
can.

PRIVACY

No signup. No email or phone number. No advertising SDK. Your preferences and
your reward points stay on your device — nothing about your activity is
published anywhere, and your score is not shared or compared with anyone.
Blockchain activity is public by nature: every swap, including your wallet
address and the amounts, is permanently visible on-chain to anyone.

RISK

Crypto assets are volatile and on-chain transactions are irreversible. You can
lose money, including all of it. Nothing in this app is financial advice, and
the indicator readouts are arithmetic on past prices — they describe what has
already happened and forecast nothing. Use only what you can afford to lose,
and check the rules that apply where you live.

Built by Fanous Bazaar Pishgam, Isfahan, Iran.
```

## چرا این متن این‌طور نوشته شده

سه تصمیم در این متن عمدی است و اگر عوضشان کنی ممکن است رد شوی:

| تصمیم | دلیل |
|---|---|
| می‌گوید **wallet interface**، نه exchange | «صرافی» یعنی نهاد دارای مجوز. ما دفتر سفارش نداریم و نقدینگی نگه نمی‌داریم |
| بند «no leverage, no derivatives, no prediction market, no game of chance» | جواب مستقیم به فیلتر خودکاری که قبلاً ردمان کرد |
| با قابلیت‌های **روی گوشی** شروع می‌شود | قانون Uptodown اپ‌هایی که «فقط یک سایت را نشان می‌دهند» رد می‌کند. اپ ما با Capacitor ساخته شده پس فنیاً WebView است — دفاعش این است که بگوییم کیف پول رمزنگاری‌شده، قفل انگشتی، اسکن QR و کار آفلاین از یک سایت ساده برنمی‌آید |

---

# بخش ۳ — بقیهٔ فیلدها

| فیلد | مقدار |
|---|---|
| **App name** | `FBT Swap` |
| **Short description** (۷۷ کاراکتر) | `Swap crypto from your own wallet. Non-custodial, on-chain, no account needed.` |
| **Category** | `Finance` (دوم: `Tools`) — **هرگز** Trading/Investing |
| **Tags** | `crypto, defi, wallet, swap, blockchain` |
| **Age / PEGI** | `18+` |
| **Website** | `https://fbtswap.ir` |
| **Email** | `fbtswap@gmail.com` |
| **Privacy policy** | `https://fbtswap.ir/#/legal/privacy` |
| **Terms** | `https://fbtswap.ir/#/legal/terms` |
| **Developer** | `Fanous Bazaar Pishgam Co.` |
| **Country** | `Iran` |
| **Package** | `ir.fbt.swap` |

🔴 **علامت `#` در آدرس Privacy حیاتی است.** بدون آن صفحه **۴۰۴** می‌دهد (تست
کردم). این فیلد اجباری است و بازبین واقعاً بازش می‌کند.

**What's new** (برای فیلد تغییرات نسخه):
```
• Fixed the white box around the app icon on the home screen.
• The launch screen is now our own logo on black — it used to be a white
  placeholder screen left over from the build tool.
• The points screen now shows your own points and where each one came from,
  with the date. It no longer ranks you against other people.
• Your score is no longer uploaded anywhere. It stays on your device.
```

---

# بخش ۴ — لینک فروشگاه‌ها

## ✅ ۱. APKPure — از این شروع کن

| | |
|---|---|
| ثبت‌نام | **https://developer.apkpure.com** |
| هزینه | رایگان |
| بررسی | ≤ ۳ روز کاری |
| مدرک شناسایی | ندارد |
| پشتیبانی | `developer@apkpure.com` |

سریع‌ترین گزینه و بدون مدرک. مسیر: کنسول ← `MANAGE VERSIONS` ← `SELECT FILES`
← آپلود APK. آیکون و شماره نسخه خودکار از داخل APK خوانده می‌شود.

## ✅ ۲. Uptodown — بیشترین ترافیک گوگل

| | |
|---|---|
| ثبت‌نام | **https://www.uptodown.dev/#/sign-up** |
| هزینه | رایگان |
| بررسی | حدود ۱ هفته |

صفحات این سایت در گوگل خوب رتبه می‌گیرند — یعنی بازدید رایگان.
**Country Restriction را دست نزن** (پیش‌فرض = کل دنیا).
Author: `Fanous Bazaar Pishgam Co.` · PEGI: `18` · Nationality: `Iran`

## ✅ ۳. GitHub Releases — همین الان زنده است

```
https://github.com/mshiravi433-ctrl/fbtcryp/releases/latest
```
این را مستقیم به کاربر بده. هیچ بررسی و انتظاری ندارد.

## ⚠️ ۴. IzzyOnDroid

| | |
|---|---|
| درخواست | **https://gitlab.com/IzzyOnDroid/repo/-/issues** |
| هزینه | رایگان · حدود ۲ هفته |

ممکن است به‌خاطر Firebase ردمان کنند.

## ⚠️ ۵. مایکت

| | |
|---|---|
| ثبت‌نام | **https://developer.myket.ir** |
| قوانین انتشار | https://myket.ir/kb/topics/myket-app-publishing-rules-fa |
| هزینه | رایگان |

## ⚠️ ۶. کافه‌بازار

| | |
|---|---|
| ثبت‌نام | **https://pishkhan.cafebazaar.ir/account/register** |
| قوانین انتشار | https://developers.cafebazaar.ir/fa/app-publish-guidelines |
| هزینه | حدود ۴۰ هزار تومان در سال |

### دربارهٔ مایکت و بازار، صادقانه

مصوبهٔ شورای عالی فضای مجازی (۲۶ بهمن ۱۴۰۳) تبلیغ خدمات رمزارز را به ارائه‌دهندگان
**دارای مجوز** محدود می‌کند. ثبت‌نام هم کد ملی، کد پستی و شبا می‌خواهد — یعنی زیر
هویت حقیقی خودت.

اگر باز هم فرستادی:
- **market-viewing and wallet-management tool** بنویس، نه «صرافی». این دروغ نیست:
  اپ دفتر سفارش ندارد و نقدینگی نگه نمی‌دارد.
- کلمات **«سرمایه‌گذاری»، «سود»، «بازدهی»** را **اصلاً** به کار نبر — همین‌ها
  دقیقاً کلماتی هستند که مصوبه محدود کرده.

## ⏳ ۷. گوگل‌پلی

فایلش فرق دارد: **`app-release.aab`** (نه APK).
هزینه: **۲۵ دلار، یک‌بار** — سالانه نیست.
تأیید هویت توسعه‌دهنده از ۸ مهر ۱۴۰۵ در برزیل، اندونزی، سنگاپور و تایلند شروع
می‌شود و بقیهٔ دنیا ۱۴۰۶ — **ایران در موج اول نیست**، پس وقت داری.

---

# بخش ۵ — این‌ها را وقت نگذار

| فروشگاه | چرا نه |
|---|---|
| Amazon Appstore | ۲۹ مرداد ۱۴۰۴ تعطیل شد. در بسته نیست — **در وجود ندارد** |
| Aptoide | ۶۹ دلار در سال |
| Samsung Galaxy Store | فقط فروشندهٔ تجاری با شرکت ثبت‌شده |
| F-Droid | فقط نرم‌افزار آزاد؛ لایسنس ما بسته است و Firebase را قبول نمی‌کنند |
| Huawei AppGallery | ثبت‌نام با هویت ایرانی ندارد |
| APKMirror | آینه است نه فروشگاه — فقط اپ‌های داخل گوگل‌پلی را بازنشر می‌کند |
| Apple App Store | ۹۹ دلار در سال، از ایران قابل خرید نیست. **غیرممکن، نه سخت** |

---

# بخش ۶ — اسکرین‌شات

این یکی را **باید خودت** بگیری. عکس ساختگی که با اپ واقعی نخواند، در APKPure
(«تصاویر بی‌کیفیت») و Uptodown صریحاً دلیل رد شدن است.

۱. APK را نصب کن
۲. **زبان اپ را انگلیسی کن** — راهنمای خود Uptodown: اسکرین‌شات انگلیسی به
   کاربران **همهٔ** زبان‌ها نشان داده می‌شود، فارسی فقط به فارسی‌زبان‌ها
۳. از این پنج صفحه، به همین ترتیب:
   ۱. **Swap** با یک قیمت واقعی روی صفحه ← این اول باشد، هدف اصلی اپ است
   ۲. **Market**
   ۳. **Coin detail** با نمودار
   ۴. **Wallet**
   ۵. **Settings** با زبان و تم
۴. **خام** آپلود کن. عکس معمولی ۱۰۸۰×۲۴۰۰ گوشی قبول است. قاب نگذار، برش نده،
   متن تبلیغاتی رویش ننویس.

تصاویر آماده در پوشهٔ `store/`:
- آیکون: `store/icon-512.png`
- بنر: `store/feature-graphic-1024x500.png`
