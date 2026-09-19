# «این dApp کلاهبرداری است» — چرا والت این را نشان می‌دهد و چه کاری واقعاً آن را برمی‌دارد

> گزارش: «وقتی می‌خواهم EVM یا سولانا را در والت‌هایی مثل تراست‌والت امضا کنم — بخصوص
> سولانا مثل فانتوم — ارور می‌دهد: این dApp به نظر می‌رسد کلاهبرداری باشد، هشدار
> کلاهبرداری برای اپ ما می‌گذارد و می‌گوید خارج شو یا با مسئولیت خودت ادامه بده.»
>
> این سند علت‌های واقعی را جدا می‌کند، آن بخشی که در کد خودمان بود اصلاح شده، و
> مسیرهای بیرونی که فقط خودِ سرویس‌دهنده می‌تواند بردارد با متن آماده آمده است.

---

## ۰) وضعیت انتشار — چه چیزی همین حالا لایو است

| مورد | وضعیت |
|---|---|
| PR #364 → `main` | ✅ مرج شد (کامیت `da44ace`) |
| استقرار Production در Vercel | ✅ موفق، ref = `da44ace` (2026-09-19 15:13 UTC) |
| بیلد APK روی `main` | ✅ موفق — artifact تازه؛ کاربران اپ باید نسخهٔ جدید را نصب کنند |
| `https://fbtswap.ir/.well-known/walletconnect.txt` | ❌ فعلاً ۴۰۴ — منتظر کد تأیید Reown (گام ۱ پایین) |

یعنی اصلاحات کد روی سایت زنده است؛ چیزی که هنوز باقی مانده **فقط** کارهای
بیرونی است (گام‌های ۱ تا ۵). تا وقتی فایل تأیید نباشد، همهٔ والت‌ها این دامنه را
«UNVERIFIED» می‌بینند.

---

## ۱) سه چیز کاملاً متفاوت، یک جملهٔ شبیه هم

هشدار «کلاهبرداری» یک منبع ندارد. سه لایه وجود دارد و هر لایه دشمن و راه‌حل خودش را دارد:

| لایه | چه کسی می‌سازد | جملهٔ روی صفحه | آیا کد ما می‌تواند درستش کند؟ |
|---|---|---|---|
| **الف) شهرت دامنه (blocklist)** | Blowfish (فانتوم، بک‌پک، سولفلر)، Blockaid (تراست، متامسک، کوین‌بیس)، فهرست‌های باز مثل `phantom/blocklist`، `MetaMask/eth-phishing-detect`، ScamSniffer، ChainPatrol، Google Safe Browsing | «This dApp could be malicious / Do not proceed unless you are certain this is safe» یا «خارج شو» | ❌ نه — فقط خودِ آن سرویس می‌تواند بردارد (بخش ۵) |
| **ب) تأیید هویت در WalletConnect (Verify API)** | خودِ WalletConnect/Reown + فهرست دامنهٔ ثبت‌شده | «Verified / Unverified / Domain mismatch / Threat» — والت تراست و متامسک این را پررنگ نشان می‌دهند | ✅ **بله** — و یک باگ واقعی در کد ما همین بود (بخش ۳) |
| **ج) شکلِ درخواست امضا** | همان موتور لایهٔ الف، ولی بر اساس *رفتار* dApp | «این درخواست مشکوک است» حتی وقتی دامنه سالم است | ✅ تا حد زیادی — با استفاده از `signAndSendTransaction` به‌جای امضا‌کردن توسط والت و ارسال توسط ما (بخش ۳) |

نکتهٔ کلیدی: تا وقتی لایهٔ (ب) و (ج) درست نشده باشند، درخواست whitelist هم
راحت رد می‌شود؛ بازبین‌ها همان دامنهٔ جدید را «تأییدنشده» می‌بینند و ادامه می‌دهند.

---

## ۲) شواهد زندهٔ همین حالا (بررسی‌شده روی مخازن واقعی)

این‌ها را همین امروز از خود مخازن عمومی چک کردم:

| فهرست | حجم بررسی‌شده | نتیجه برای `fbtswap.ir` |
|---|---|---|
| `phantom/blocklist` → `blocklist.yaml` | ۲٬۳۱۹ ورودی | ✅ **نیست** |
| `phantom/blocklist` → `fuzzylist.yaml` | خالی | ✅ خطری نیست |
| `MetaMask/eth-phishing-detect` → `src/config.json` | ۲٫۸ مگابایت | ✅ **نیست** |
| ScamSniffer → `blacklist/domains.json` | ۹ مگابایت | ✅ **نیست** |
| `fbtswap.ir`, `lawpoetics.ir` (نام قدیمی) | همهٔ موارد بالا | ✅ هیچ‌کدام نیست |

**یعنی «در لیست سیاه بودن» توضیح این هشدار نیست.** آنچه باقی می‌ماند:

1. **عدم تطابق دامنه (Verify = INVALID)** — باگ واقعی در کد ما؛ در صفحه‌های
   preview/dev، اپ خودش را «fbtswap.ir» معرفی می‌کرد در حالی که واقعاً روی دامنهٔ
   دیگری باز شده بود. والت این را «دامنهٔ اعلام‌شده با فرستندهٔ درخواست یکی نیست»
   می‌بیند و همان را مثل فیشینگ نشان می‌دهد. **اصلاح شد — بخش ۳.**
2. **امتیاز دامنهٔ Blowfish** (موتور فانتوم موبایل، بک‌پک، سولفلر و اسکنر داخل
   تراست‌والت). این فهرست *عمومی نیست*؛ دامنهٔ نو و بدون سابقه در آن «تأییدنشده»
   است و تصمیمش فقط با ایمیل به خودشان عوض می‌شود — بخش ۵.
3. **Blockaid** (تراست‌والت/متامسک/کوین‌بیس) — هم دامنه، هم تراکنش. پورتال
   عمومی اعتراض دارد — بخش ۵.
4. **رفتار تراکنش**: هرجا اپ ما تراکنش را امضا می‌گرفت و *خودش* ارسال می‌کرد،
   دقیقاً همان الگویی بود که موتورهای امنیتی به‌عنوان «drainer» علامت می‌زنند —
   اصلاح شد — بخش ۳-۲.

---

## ۳) آنچه در کد اصلاح شد (روی همین برنچ)

### ۳-۱. هویت والت = همان دامنه‌ای که صفحه روی آن باز شده

فایل: `src/lib/wc/config.js` → تابع جدید `walletIdentityUrl()`

WalletConnect هویت اپ را **متقاطع چک می‌کند**. تابع `Verify.register()` در SDK
دقیقاً `window.location.origin` را به سرور تأیید می‌فرستد و JWT امضاشده همان
origin را برمی‌گرداند؛ بعد SDK این را می‌سازد:

```js
validation = attestedOrigin === new URL(metadata.url).origin ? 'VALID' : 'INVALID'
```

قبلاً `wcMetadata()` همیشه `https://fbtswap.ir` را اعلام می‌کرد — حتی وقتی صفحه
روی `*.vercel.app` یا preview سندباکس باز بود. نتیجه: **INVALID = عدم تطابق دامنه**
و همان صفحهٔ قرمز «این dApp مشکوک است» در والتی که Verify را جدی می‌گیرد (تراست).

قانون جدید:

* صفحهٔ واقعی روی `https` → **خودش** اعلام می‌شود (`https://fbtswap.ir` در
  پروداکشن، دامنهٔ preview در preview). تأییدیه و آدرس‌بار کاربر یکی می‌شوند.
* فقط جایی که والت نمی‌تواند آن را باز کند — اپ بستهٔ اندروید
  (`https://localhost`)، `localhost` دولوپمنت، یا صفحهٔ `http://` — هویت عمومی
  `https://fbtswap.ir` اعلام می‌شود (متامسک `https://localhost` را اساساً رد می‌کند).

📌 **نکتهٔ عملیاتی مهم:** از این به بعد روی preview هم والت نام دامنهٔ همان
preview را می‌بیند. این **درست** است و دیگر هشدار تطابق نمی‌دهد؛ ولی اگر می‌خواهی
هویت پروداکشن را تست کنی، باید روی `https://fbtswap.ir` تست کنی.

### ۳-۲. سولانا: والت خودش ارسال می‌کند، نه ما

فایل: `src/lib/launch/solana/signing.js` → `signSendConfirm()`

این تابع قبلاً ترجیح می‌داد `provider.signTransaction()` بگیرد و بعد خودش با
`connection.sendRawTransaction()` بفرستد. این همان الگویی است که بلاو‌فیش/بلاک‌اید
به آن حساس است (توصیهٔ رسمی خودشان برای برداشتن این هشدار: از
`signAndSendTransaction` استفاده کن). اکنون:

* اگر والت `signAndSendTransaction` دارد → **خود والت می‌فرستد** (هم روی
  `provider` تزریقی، هم روی MWA با فیچر `solana:signAndSendTransaction`).
* `signTransaction` + ارسال توسط ما فقط **مسیر جایگزین** است، برای زمانی که والت
  یک تراکنش نیمه‌امضاشدهٔ create را نمی‌پذیرد. رد کاربر (4001) هیچ‌وقت دوباره
  پرسیده نمی‌شود.

مسیر swap در `src/lib/solanaWallet.js` از قبل همین ترتیب را داشت و دست‌نخورده ماند.

### ۳-۳. گزارش سلامت، حالا هویت والت را هم نشان می‌دهد

`src/lib/wc/health.js` + `src/components/WalletHealthPanel.jsx`: ردیف
«هویت کیف پول (چیزی که به والت گفته می‌شود)» که دو چیز را کنار هم می‌گذارد:
«چه می‌گوییم» و «صفحه روی چه چیزی باز است». اگر این دو یکی نباشند، به‌جای یک
برچسب مبهم، هر دو origin را چاپ می‌کند. از شیت WalletConnect → «بررسی سلامت
اتصال» اجرا می‌شود.

### ۳-۴. دو اسکریپت برای اینکه این وضعیت قابل اندازه‌گیری باشد

```bash
# هویت والت: آیا دامنه در Reown تأیید شده؟ کد تأیید را می‌نویسد / چک می‌کند
node scripts/walletconnect-domain-verify.mjs --check
node scripts/walletconnect-domain-verify.mjs --code=<کد از داشبورد Reown>

# شهرت دامنه روی فهرست‌های عمومی + آن دو URLی که والت خودش می‌گیرد
node scripts/wallet-reputation-check.mjs
node scripts/wallet-reputation-check.mjs --domain=fbtswap.ir
GSB_API_KEY=... node scripts/wallet-reputation-check.mjs   # اختیاری، گوگل
```

`wallet-reputation-check` هر فهرستی که جواب ندهد را `UNKNOWN` می‌گوید، هیچ‌وقت
`PASS` — گزارش دروغ بدتر از نگرفتن گزارش است.

### ۳-۵. تست‌ها

`test/walletconnect-stack-probe.mjs` شانزده بررسی جدید گرفت (کل: ۳۲۵ بررسی):
هویت در پروداکشن، روی ساب‌دامین، روی preview، سندباکس، اپ بسته، لوکال‌هاست،
`http`، و اینکه هیچ ورودی‌ای هرگز هویت `localhost` نمی‌دهد. سه خطای باقی‌مانده
در این سندباکس به‌خاطر نبود شبکه است (پروپ رله واقعی)، نه این تغییر.

---

## ۴) کارهایی که باید انجام بدهی — به همین ترتیب

### گام ۰ (بدون تأخیر): انتشار کد اصلاح‌شده

بدون این، هر درخواست تأییدی که می‌فرستی پشت باگ (ب) است. بعد از deploy، این را
روی موبایل تست کن: شیت WalletConnect → «بررسی سلامت اتصال» → ردیف هویت باید
دو بار یک دامنه نشان دهد (✅).

### گام ۱: ثبت و تأیید دامنه در Reown (همین امروز، ۱۰ دقیقه)

این تنها کاری است که لایهٔ (ب) را از `UNKNOWN` به `VALID` می‌برد — و همان چیزی
است که تراست‌والت به کاربر نشان می‌دهد.

1. <https://dashboard.reown.com> → همان پروژه (`WC_PROJECT_ID` در
   `src/lib/wc/config.js`) → تب **Domains**.
2. دامنه‌ها را **با پروتکل و بدون اسلش انتهایی** ثبت کن:
   * `https://fbtswap.ir`
   * `https://www.fbtswap.ir`
   * `https://localhost` ← لازم برای اپ اندروید (WebView روی `https://localhost` است)
   * دامنهٔ preview/سندباکس فقط اگر واقعاً می‌خواهی روی آن تست کنی
3. روش تأیید را **file** انتخاب کن، کد را کپی کن و بعد:

   ```bash
   node scripts/walletconnect-domain-verify.mjs --code=<کد>
   npm run build          # فایل در public/.well-known/ است و با بیلد منتشر می‌شود
   # deploy، سپس:
   curl -s https://fbtswap.ir/.well-known/walletconnect.txt
   ```

4. برگرد به داشبورد و **Verify** را بزن.
   *(روش DNS TXT هم قبول است: رکورد TXT روی `@` با همان کد. هر دو را با کدهای
   متفاوت انجام نده.)*

### گام ۲: بستهٔ مدارک را آماده کن (۳۰ دقیقه، یک‌بار برای همیشه)

هر درخواست بیرونی بدون این‌ها رد می‌شود. یک فایل متنی بساز و در همهٔ ایمیل‌ها
پیوست/لینکش کن:

* نام پروژه: **FBT Swap** — سایت: `https://fbtswap.ir`
* GitHub: <https://github.com/mshiravi433-ctrl/fbtcryp> (کد باز؛ نقل‌قول از
  `src/lib/wc/config.js` و `src/lib/launch/solana/signing.js` که نشان می‌دهد از
  API امن خود والت استفاده می‌کنیم)
* شبکه‌های اجتماعی و هویت تیم: X و LinkedIn و Instagram و Crunchbase (در فوتر
  سایت لینک شده‌اند) + ایمیل `fbtswap@gmail.com`
* صفحه‌های حقوقی: `/legal/terms`, `/legal/privacy`, `/legal/disclaimer`
* **چه چیزی را امضا می‌گیرید:** فقط swap/deposit/withdraw از پروتکل‌های شناخته‌شده
  (Jupiter، OpenOcean، Aave، Lido، Compound، Morpho…)؛ هیچ‌وقت seed phrase،
  هیچ‌وقت `eth_sign`، هیچ‌وقت approve نامحدود (allowance کمینه است — ببین
  `src/lib/intent-ai/approvalHygiene.js`)
* تراکنش نمونهٔ روی زنجیر (هش‌های واقعی) — ۲ تا ۳ مورد کافی است
* تأییدیه‌های اگر داری: ثبت در DappRadar / DappBay / Trust Wallet listing

### گام ۳: فانتوم و Blowfish (هشدار سولانا؛ مهم‌ترین برای تو)

دو مسیر موازی، هر دو را انجام بده:

* **ایمیل:** `review@blowfish.xyz` **و** `review@phantom.com` (بلاو‌فیش در نوامبر
  ۲۰۲۴ توسط فانتوم خریداری شد؛ هر دو آدرس را در یک ایمیل با CC بفرست).
* **گیت‌هاب:** یک Discussion در
  <https://github.com/orgs/phantom/discussions> باز کن (قالب گزارش‌های مشابه:
  عنوان = دامنه + متن هشدار) و در صورت توان یک PR به
  <https://github.com/phantom/blocklist> برای `whitelist.yaml` بزن.
* اگر کسی در جامعهٔ سولانا (نه اینفلوئنسر، بلکه دولوپر شناخته‌شده) داری،
  بگو در X به `@blowfishxyz` پیام بدهد — خودشان این را به‌عنوان مسیر تسریع
  معرفی می‌کنند.

متن آماده در بخش ۶.

### گام ۴: Blockaid (تراست‌والت، متامسک، کوین‌بیس)

* <https://report.blockaid.io/> → گزینهٔ **Developer** برای «verify a project»
  (جلوگیری از اینکه پروژه‌ات دوباره علامت بخورد) و گزینهٔ **Mistake** برای
  اعتراض به علامت فعلی.
* پورتال متامسک: <https://blockaid-false-positive-portal.metamask.io/report>
* اگر متامسک روی سایت هشدار «Deceptive site» داد (لایهٔ دیگر)، آن از فهرست
  `eth-phishing-detect` است: PR روی
  <https://github.com/MetaMask/eth-phishing-detect> با مدارک.

### گام ۵: بقیهٔ فهرست‌ها

| فهرست | آدرس اعتراض |
|---|---|
| ChainPatrol (همان چیزی که WalletConnect Verify از آن «Threat» می‌سازد) | <https://app.chainpatrol.io/> — گزارش false positive |
| ScamSniffer | `support@scamsniffer.io` یا Issue در <https://github.com/scamsniffer/scam-database> |
| Google Safe Browsing | <https://safebrowsing.google.com/safebrowsing/report_error/> |
| Trust Wallet (لیست dApp + پشتیبانی) | <https://developer.trustwallet.com/developer/listing-guide> و <https://support.trustwallet.com> |

### گام ۶: «سابقه» بساز — چون الگوریتم‌ها همین را می‌خوانند

خود بلاو‌فیش صریح می‌گوید دامنهٔ نو بدون سابقه، بدون مخزن عمومی و بدون تأیید
جامعه، در نبود اطلاعات بد هم علامت می‌خورد. این‌ها همان «سابقه» را می‌سازند:

* DappRadar و BNB Chain DappBay (راهنمای کامل در `docs/SEO-VISIBILITY-FA.md`)
* Trust Wallet listing (فقط بعد از پایدار شدن اتصال و هشدارها)
* لیست‌شدن در WalletConnect Explorer (داشبورد Reown → Explorer)
* صفحهٔ امنیت/شفافیت در سایت: چه کدی اجرا می‌شود، چه چیزی امضا می‌گیرید،
  چطور می‌شود اعتمادها را باطل کرد (`revoke.cash` را لینک بده)

---

## ۵) چه چیزی را هرگز نکن

* **به کاربر نگو «هشدار را نادیده بگیر».** هم اعتماد را از بین می‌برد، هم
  از نگاه بازبین، خودش یک الگوی کلاهبرداری است.
* **هویت جعلی نگذار.** اعلام کردن `fbtswap.ir` از روی یک preview دقیقاً همان
  چیزی است که صفحهٔ «عدم تطابق دامنه» را می‌سازد (این باگ بود و اصلاح شد).
* **`eth_sign` یا امضای هگز خام نخواه.** همین حالا هم نمی‌خواهیم؛ نگهش دار.
* **approve نامحدود (MaxUint256) نده.** هر جا لازم بود، به اندازهٔ همان تراکنش.
* **کپی‌های وسوسه‌انگیز «وصل کن و جایزه بگیر» را پررنگ نکن.** ماموریت «وصل کردن
  کیف پول» + پاداش، از نگاه اسکنر خودکار همان الگوی drainer است؛ اگر هست،
  ادبیاتش را «امتیاز باشگاه» و بی‌ارتباط به پول نگه دار (همین حالا در
  `src/lib/faqLocal.js` توضیح داده شده که امتیاز پول نیست).
* **دامنه/شبکه‌های واسط را عوض نکن** تا وقتی پروندهٔ تأیید باز است؛ سابقهٔ دامنه
  با جابه‌جایی صفر می‌شود.

---

## ۶) متن آمادهٔ ایمیل (انگلیسی، کپی کن و بفرست)

### ۶-۱. به Blowfish / Phantom

```text
To: review@blowfish.xyz, review@phantom.com
Subject: Domain review request — fbtswap.ir (FBT Swap), flagged as "could be malicious"

Hello Blowfish / Phantom team,

We operate https://fbtswap.ir (FBT Swap), a non-custodial swap and DeFi front-end.
Our users on Phantom are shown the "This dApp could be malicious. Do not proceed
unless you are certain this is safe" screen when connecting or signing, and we
would like to have the domain reviewed.

About the project
- Name: FBT Swap — https://fbtswap.ir
- Source code (public): https://github.com/mshiravi433-ctrl/fbtcryp
- Team identity and channels: https://fbtswap.ir (footer: X, LinkedIn, Instagram,
  Crunchbase), contact fbtswap@gmail.com
- Legal pages: /legal/terms, /legal/privacy, /legal/disclaimer

What the dApp asks the wallet to do
- EVM: standard ERC-20 approve (minimum amount, never unlimited —
  src/lib/intent-ai/approvalHygiene.js), swaps, deposits/withdrawals on audited
  third-party protocols (Aave, Lido, Compound, Morpho, bridges).
- Solana: Jupiter and OpenOcean routes. We send transactions through the wallet's
  own signAndSendTransaction so the wallet broadcasts, never sign-then-broadcast
  from our page:
  src/lib/solanaWallet.js, src/lib/launch/solana/signing.js (see signSendConfirm).
- We never request eth_sign, never ask for a seed phrase or private key, never
  ask for message signatures to move funds, and we never request delegate or
  owner authority.

Verification steps we have already completed
- WalletConnect/Reown: domain registered and verified in the Reown dashboard
  (ownership file served at https://fbtswap.ir/.well-known/walletconnect.txt).
- Sample transactions (mainnet): <TX_HASH_1>, <TX_HASH_2>, <TX_HASH_3>
- Listings: <DappRadar / DappBay / Trust Wallet links if available>

Could you please review https://fbtswap.ir and, if it is a false positive,
remove the flag or allowlist the domain (as well as any walletconnect/unpacked
origin we connect from)? If you need anything else — a walkthrough video, a
staging URL, or a build hash — we will provide it immediately.

Thank you,
<NAME>, FBT Swap
```

### ۶-۲. به Blockaid

```text
Subject: Project verification + false-positive appeal — fbtswap.ir

Hello Blockaid team,

We submitted https://fbtswap.ir through report.blockaid.io (Developer, project
verification) and are following up here as well. Our users see "High risk
detected" / dApp warnings in wallets that use your API (Trust Wallet, MetaMask,
Coinbase Wallet) when connecting from https://fbtswap.ir.

Details
- Project: FBT Swap (non-custodial swap / DeFi front-end), https://fbtswap.ir
- Public repository: https://github.com/mshiravi433-ctrl/fbtcryp
- Contracts we interact with: third-party, audited protocols only; we deploy no
  custom token contracts for users to sign.
- Approvals: always minimum-amount; no unlimited approvals.
- Solana: transactions are signed AND sent by the wallet
  (signAndSendTransaction); we never broadcast a wallet-signed transaction from
  our own servers.
- Reown domain verification: completed (/.well-known/walletconnect.txt).

If a specific transaction or address triggered the flag, please share the
identifier and we will provide the exact calldata, the contract, and the
transaction simulation. Any additional information you need, we will send today.

Thank you,
<NAME>, FBT Swap
```

---

## ۷) بعد از رفع، چطور مطمئن شویم رفع شده

```bash
node scripts/wallet-reputation-check.mjs        # باید همه ✅/UNKNOWN باشد، هیچ ❌
node scripts/walletconnect-domain-verify.mjs --check
```

و تست دستی روی گوشی (همه باید بدون هشدار رد شوند):

- [ ] فانتوم موبایل: `phantom.app/ul/browse/https://fbtswap.ir` → Connect → امضا.
- [ ] سولانا: یک swap (Jupiter) و یک launch — در صفحهٔ امضا، *خودِ والت* باید
      «ارسال» را انجام دهد، نه ما.
- [ ] تراست‌والت (EVM): WalletConnect → در شیت والت باید «Verified» باشد، نه
      «Unverified/Mismatch».
- [ ] متامسک: صفحهٔ اتصال بدون «Deceptive site».
- [ ] روی preview: شیت سلامت → ردیف هویت → ✅ (این ثابت می‌کند باگ (ب) برنگشته).

---

## ۸) خلاصهٔ یک‌خطی

سه هشدار مختلف با یک ظاهر وجود دارد: **شهرت دامنه** (فقط با درخواست به Blowfish/
Blockaid/فهرست‌ها برداشته می‌شود)، **تأیید هویت WalletConnect** (باگ خودمان بود،
اصلاح شد + ثبت دامنه در Reown)، و **الگوی امضا/ارسال** (اکنون خود والت ارسال
می‌کند). هیچ‌کدام با «به کاربر بگو ادامه بده» حل نمی‌شوند؛ آن فقط اعتماد را
خراب می‌کند.
