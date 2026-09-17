> ⚠️ **بایگانی‌شده (۲۰۲۶-۰۹-۱۷):** این سند یک راندِ رفعِ اشکالِ قدیمی را
> توصیف می‌کند. مسیرهایی که در آن آمده (`src/lib/wcWallets.js`،
> `src/lib/emailSocialWallet.js`، `src/lib/walletHealth.js` و همراهانشان)
> دیگر وجود ندارند: کلِ ستکِ والت‌کانکت در `src/lib/wc/` از نو نوشته شده
> است. **تحلیل و علتِ این گزارش همچنان معتبر است؛ فقط محلِ کد عوض شده.**
> معماریٔ فعلی: [`WALLET-CONNECT-STACK-FA.md`](./WALLET-CONNECT-STACK-FA.md)

---

# ریشه‌یابی دو گزارش کیف پول

> «ایمیل تأیید می‌شود ولی وقتی برمی‌گردیم کیف پول ساخته نشده» — «تراست والت باز
> می‌شود ولی چیزی نمی‌آید که تأیید کنم».

این سند حاصلِ یک مرورِ خط‌به‌خط روی همهٔ مسیرهای اتصال (`injected` / `local` /
`email-social` / `WalletConnect`) با **کدِ نصب‌شدهٔ خودِ کتابخانه‌ها به‌عنوان
مرجعِ نهایی** (`node_modules/@reown/**`, `@walletconnect/**`) است. هر ادعای این
سند یا شمارهٔ خط دارد، یا با یک probe قابلِ اجرا سنجیده می‌شود. آن‌چه در این
محیط قابلِ اندازه‌گیری **نبود**، صریح گفته شده.

---

## ۱) اول فرضیهٔ خودت: «شاید از پروژه‌آیدی و اپ‌کیت‌آیدی استفاده نمی‌کنی»

**نتیجهٔ نهایی: هم کد از شناسهٔ پروژه استفاده می‌کند، هم خودِ داشبورد درست تنظیم
است — پس این علتِ خرابی نیست.** هر دو نیمه اکنون اندازه‌گیری شده است.

### نیمهٔ اول: کد (شاهد با شمارهٔ خط)

| کجا | چه می‌کند |
|---|---|
| `src/context/WalletContext.jsx:57` | `const WC_PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20'` (شناسهٔ عمومی، هاردکد) |
| `:589` و `:691` | ساختِ نمونهٔ ایمیل/سوشال (`getEmailSocialAppKit(WC_PROJECT_ID, …)`) در اتصال و در بازیابی |
| `:757` | `projectId` در `buildWcInitConfig()` — همان configی که هم `connect` و هم `restore` با آن بالا می‌آیند |
| `:889` | `customWallets: appKitCustomWallets(WC_PROJECT_ID)` — پنج کیفِ پروموت‌شده در مودالِ AppKit |
| `:2158` | `wcProjectId` که به شیت و به پنلِ سلامت پاس داده می‌شود |

نکته‌های مهمِ همین موضوع:

- در Reown **فقط یک شناسهٔ عمومی** وجود دارد (Project ID)؛ «AppKit ID» جداگانه
  معنا ندارد. آن‌چه شبیه «App Key / Secret» است **فقط سمت سرور** معنا دارد و کدِ
  فعلی عمداً هیچ رمزی را مصرف نمی‌کند (نه در باندل، نه زیر `VITE_`).
- `VITE_WALLETCONNECT_PROJECT_ID` عمداً بازنشسته شده و یک تست (wiring) تضمین
  می‌کند کسی دوباره برنگرداندش.
- پس اگر چیزی در این ناحیه خراب باشد، خرابی **در داشبورد** است نه در سیم‌کشی.

### نیمهٔ دوم: داشبورد — با پاسخِ خودِ API (اندازه‌گیری‌شده در همین بررسی)

همان دو درخواستی که خودِ AppKit در زمان اجرا می‌زند، با همان شناسهٔ پروژه:

```
GET https://api.web3modal.org/appkit/v1/config?projectId=8e36eccabebf5a4567f4e974fafd6b20
→ {"features":[…
   {"id":"social_login","isEnabled":true,
    "config":["email","google","x","discord","farcaster","github","apple","facebook"]},
   {"id":"reown_authentication","isEnabled":true,"config":[]}, …]}

GET https://api.web3modal.org/projects/v1/origins?projectId=8e36eccabebf5a4567f4e974fafd6b20
→ {"allowedOrigins":["fbtswap.ir","https://fbtswap.ir","https://localhost"]}
```

یعنی: شناسهٔ پروژه **معتبر** است، ایمیل و همهٔ سوشال‌ها روی داشبورد **روشن**اند،
و هر سه مبدأِ لازم (`fbtswap.ir`، `https://fbtswap.ir`، و `https://localhost`
برای WebView اندروید) در فهرست مجاز هستند. ⇒ سه فرضیهٔ «Project ID غلط /
Email خاموش / دامنه مجاز نیست» **رد می‌شوند** و علت باید در خودِ کد باشد؛
همان سه علتی که در بخش ۲ آمد و اصلاح شد.

> **تصحیح بعدی (همین امروز):** دوباره از API زنده خوانده شد و همان پاسخ آمد
> (`social_login.isEnabled = true` با هشت نام، از جمله `email`). اما پنلِ سلامت
> روی گوشیِ کاربر `email=false socials=0` چاپ می‌کرد — **غلطِ خودِ ابزار** بود:
> ماژول `features.social_login` را می‌خواند درحالی‌که `features` یک **آرایه** است
> و قاعدهٔ خودِ SDK `.find(f => f.id === 'social_login')` است. این خطا و خطای
> «رله = یک میزبان» با هم در
> [`WALLET-HEALTH-INSTRUMENT-FIX-FA.md`](./WALLET-HEALTH-INSTRUMENT-FIX-FA.md)
> اندازه‌گیری، اثبات و اصلاح شده‌اند.

---

## ۲) علت‌های واقعیِ سمتِ کد — و اصلاحشان

### الف) مارکرِ خودِ SDK پاک می‌شد؛ بازگشتِ ایمیل هیچ‌وقت «پرسیده» نمی‌شد

`W3mFrameProvider` (کیفِ درون‌سایتی AppKit) کلید
`@appkit-wallet/EMAIL_LOGIN_USED_KEY` را **در سازنده** می‌خواند و اگر نباشد
**اصلاً iframe نمی‌سازد** — یعنی AppKit از همان لحظهٔ اول نتیجه می‌گیرد «چیزی
برای بازیابی نیست». بدتر: `isConnected()` هر `false` یا هر **خطا** را با
`deleteAuthLoginCache()` جواب می‌دهد که همان کلید را پاک می‌کند. یک بوتِ سردِ
کند (یا شبکه‌ای که `secure.walletconnect.org` را کند/مسدود می‌کند) کافی بود تا
کیفِ ایمیل برای همیشه «نامرئی» شود؛ تنها راهِ باقی‌مانده، همان چیزی بود که
کاربر یاد گرفته بود: «یک بار دیگر بزن».

**اصلاح:** `rearmSdkLoginMarker()` در `src/lib/emailSocialWallet.js` و صدا زدنش
**پیش از** `createAppKit()` در `getEmailSocialAppKit()` — چون provider هنگام
ساختنِ نمونه از روی options ساخته می‌شود، بازگرداندنِ کلید بعد از آن یک
page-load دیر است. مقدارِ نوشته‌شده همان `'true'` خودِ SDK است و فقط وقتی
نوشته می‌شود که **مارکرِ خودمان** (`fbt_email_social_connected`) موجود باشد.

### ب) پنجرهٔ بازیابیِ ۸ ثانیه‌ای، کوچک‌تر از سقفِ خودِ SDK بود

`appEvent()` در SDK قبل از هر پیام به iframe، یک تایمرِ `20_000` میلی‌ثانیه‌ای
(`iframeReadyTimeout`) می‌گذارد. پنجرهٔ ۸ ثانیه‌ای ما همیشه این مسابقه را
می‌باخت — و شاخهٔ باخت (`clearEmailSocialSession({ disconnect:false })`) مارکرِ
ما را **پاک** می‌کرد. یعنی یک بوتِ کند، نشستِ سالم را برای همیشه از بین می‌برد.

**اصلاح:** `EMAIL_RESTORE_WINDOW_MS = 30_000` + شاخهٔ «حسابی نیامد» حالا از
`rollbackEmailSocialMarker(modal)` رد می‌شود: اگر AppKit بگوید «وصل نیست» مارکر
پاک می‌شود؛ اگر AppKit **نتواند جواب بدهد** مارکر می‌ماند تا بازگشتِ بعدی
دوباره بپرسد. (رویدادهای trace: `email_restore_none` / `email_restore_pending`.)

### ج) مسیرِ «برگشتن» بازبینی نمی‌شد

سه شکافِ مستقل:

1. هندلرِ `visibilitychange` فقط WalletConnect را بازیابی می‌کرد و **ایمیل را
   عمداً رد می‌کرد** («cold-start only»)؛
2. هیچ‌جا به `pageshow` گوش داده نمی‌شد — و در iOS Safari وقتی از کیف پول/لینکِ
   ایمیل برمی‌گردی، صفحه از **bfcache** برمی‌گردد و هیچ mount دوباره‌ای رخ نمی‌دهد
   (پس نه ایمیل پرسیده می‌شد، نه WC)؛
3. اگر یک تلاشِ WalletConnect نیمه‌کاره مانده بود (`wcRef.current` بدون حساب)،
   هندلرِ قبلی بی‌صدا رد می‌شد و آن نیم‌کاره تا پایانِ تایمرِ ۳۰۰ ثانیه‌ای قفل
   می‌ماند.

**اصلاح:** یک مسیرِ واحدِ بازگشت (`onReturn`) روی `visibilitychange` + `focus` +
`pageshow(persisted)`:

```
بدونِ حسابِ متصل →
  مارکرِ ایمیل هست؟      → resumeEmailThenWc()   (اول ایمیل، پنجرهٔ ۳۰s)
  وگرنه                 → resumeWc()            (آزادسازیِ تلاشِ قفل‌شده، سپس بازیابی)
```

و یک قانونِ ضدقفل‌شدن: اگر ایمیل **صریحاً** بگوید «وصل نیست» (مارکر پاک شد) و
روی دیسک یک نشستِ `wc@2:` باشد، همان بازگشت نوبت را به WalletConnect می‌دهد؛
اگر مارکرِ ایمیل مانده باشد (AppKit جواب نداده) هیچ‌چیز جای آن را نمی‌گیرد.

### خلاصهٔ اصلاحات و تست‌شان

| اصلاح | فایل | تستِ قفل‌کننده |
|---|---|---|
| بازگرداندنِ کلیدِ `@appkit-wallet/EMAIL_LOGIN_USED_KEY` پیش از `createAppKit` | `src/lib/emailSocialWallet.js` | `email-social-probe` («the SDK login marker is handed back BEFORE createAppKit…») |
| پنجرهٔ ۳۰ ثانیه + rollbackِ صادقانه (بدون پاک‌کردنِ کورکورانه) | `WalletContext.jsx` / `emailSocialWallet.js` | «waits LONGER than the SDK gives its own iframe» / «hands the claim back HONESTLY» |
| بازگشتِ موبایل/bfcache: `pageshow`، اولویتِ ایمیل، آزادسازیِ تلاشِ قفل‌شده | `WalletContext.jsx` | `email-social-probe` + `wc-connect-probe` («a returning page… re-runs BOTH restores») |
| ضدقفل‌شدن: مارکرِ مرده راهِ WalletConnect را نمی‌بندد | `WalletContext.jsx` | «a dead email claim hands the return to the stored WalletConnect session» |

---

## ۳) «تراست باز می‌شود ولی چیزی برای تأیید نمی‌آید» — زنجیرهٔ دقیق

مسیرِ واقعیِ دست‌دادن (همه‌اش در همین ریپو تست شده):

1. `display_uri` از universal-provider می‌آید → `wcPairUri` → در شیت، QR از
   `repairPairingUri(uri)` ساخته می‌شود (یک‌بار encode؛ دوباره‌decode‌شده با
   کتابخانهٔ دیگری در تست).
2. ردیفِ تراست با `href="trust://wc?uri=<encoded>"` (و مسیرِ HTTPS
   `https://link.trustwallet.com/wc?uri=<encoded>` به‌عنوان درِ دوم) باز می‌شود؛
   در APK، MainActivity همان را به `ACTION_VIEW` با بستهٔ
   `com.wallet.crypto.trustapp` تبدیل می‌کند.
3. پچِ `wcAppKitPatch` جلوی هدفِ `_self` (پیش‌فرضِ SDK) را می‌گیرد؛ `browser.js`
   هیچ‌وقت `_self`/`_top` باز نمی‌کند، پس تبِ dApp و سوکتِ رله زنده می‌مانند.

چهار شکستِ ممکنِ باقی‌مانده و علامتِ هرکدام:

| شکست | علامت از سمتِ کاربر | وضعیت در کد |
|---|---|---|
| URI خرابِ دوبار encode‌شده | کیف پول باز می‌شود ولی «Invalid Url» / هیچ | اصلاح و تست‌شده (`wc-uri-hygiene-probe`: ۳۲ ادعا) |
| پیشنهاد هرگز به رله نرسیده (فیلترینگِ شبکه روی `relay.walletconnect.com`) | کیف پول باز می‌شود، صفحهٔ WC، **هیچ پیشنهادی** | از داخل فرانت‌اند **قابلِ رفع نیست**؛ فقط قابلِ اندازه‌گیری است (پنلِ سلامت) |
| دپ‌لینکِ HTTPS تراست به صفحهٔ دانلود می‌افتد | همان صفحهٔ دانلود و دکمهٔ «Open in Trust Wallet» | شاهدِ زنده: صفحهٔ `https://link.trustwallet.com/wc?uri=…` یک landingِ دانلود است و تنها درِ ورودش `trust://wc?uri=…` است؛ پروژه هر دو را می‌دهد |
| صفحهٔ dApp هنگام رفتن به کیف پول خواب/کشته می‌شود | برمی‌گردی، چیزی وصل نیست | `_self` ممنوع + بازبینیِ بازگشت (بخش ۲ج) |

> `window.open(deepLink, '_blank', 'noreferrer noopener')` باید **هم‌زمان** با
> ژستِ کاربر باشد (مستنداتِ خودِ Trust)؛ پلِ `installWalletOpenBridge` روی
> `window.open` همین کار را با هدفِ امن انجام می‌دهد.

---

## ۴) آن‌چه فقط شبکهٔ کاربر می‌تواند جواب بدهد

- **شبکهٔ کاربر**: دسترسی به `relay.walletconnect.com` (جفت‌شدن),
  `api.web3modal.org` (تنظیماتِ پروژه) و `secure.walletconnect.org/sdk`
  (فریمِ کیفِ ایمیل/سوشال). اگر هرکدام فیلتر/کند باشند، علامتش نه «ارورِ قشنگ»
  است نه «صفحهٔ سفید»: TIMEOUT و «هیچ اتفاقی نمی‌افتد» — دقیقاً همان چیزی که
  گزارش شده. اندازه‌گیری‌اش همان سه probe‌ی پنلِ سلامت است (بخش ۵).
- **داشبورد**: با پاسخِ واقعیِ API بررسی شد و **سالم** است (بخش ۱)؛ فقط اگر
  بعداً دامنه‌ای اضافه/عوض شد، همان دو درخواست را دوباره می‌شود خواند.
- جزء باقی‌ماندهٔ تراست (بخش ۳) با شاهدِ رجیستری رسمی: رکوردِ Trust در
  WalletConnect Explorer (به‌روزرسانی ۲۰۲۶-۰۹-۰۸) هر دو شکل را رسمی می‌داند:

```
"mobile": {"native": "trust://", "universal": "https://link.trustwallet.com"},
"injected": [{"namespace":"eip155","injected_id":"isTrust"},
             {"namespace":"eip155","injected_id":"isTrustWallet"}],
"rdns": "com.trustwallet.app", "sdks": ["sign_v1","sign_v2","auth_v1"]
```

یعنی آن‌چه ما دستِ والت می‌دهیم (`trust://wc?uri=…` با درِ دومِ
`https://link.trustwallet.com/wc?uri=…`) **مو‌به‌مو همان چیزی است که رجیستری
رسمی می‌گوید** — پس اگر روی دستگاهی باز شود و پیشنهادی نیاید، مشکل در
«شکلِ لینک» نیست؛ در رسیدنِ خودِ پیام روی رله یا در از دست رفتنِ صفحهٔ dApp است.

---

## ۵) ابزارِ تازه: «بررسی سلامت اتصال» در شیتِ کیف پول

از این به بعد هر گزارش باید با شاهد بیاید. در شیتِ اتصال (نمای انتخاب کیف پول)
یک بخشِ `بررسی سلامت اتصال` اضافه شده که چهار پیوندِ نامرئی را **روی همان
دستگاه و همان شبکه** می‌سنجد و JSONِ قابل‌کپی می‌دهد:

1. `GET api.web3modal.org/appkit/v1/config?projectId=…` → یعنی شناسهٔ پروژه
   معتبر است؟ و dashboard چه feature‌هایی می‌دهد (`email` / `socials`)؟
2. `GET api.web3modal.org/projects/v1/origins?projectId=…` → فهرستِ دامنه‌های
   مجاز. (قاعدهٔ اندازه‌گیری‌شدهٔ SDK: فهرستِ **خالی** یعنی همه مجازند و
   `localhost` همیشه مجاز است — پس فقط یک لیستِ ناتهیِ بی‌نسبت می‌تواند بلاک کند.)
3. سوکتِ **هر دو** میزبانِ رله (`relay.walletconnect.org` پیش‌فرضِ SDK، و
   `relay.walletconnect.com` میزبانِ تاریخی) + درِ HTTPS هر کدام → هر میزبان
   جداگانه: `open` با زمانش / `SOCKET_ERROR` (و `closeCode` وقتی مرورگر کدی
   داده باشد) / `CLOSED_xxxx` / `TIMEOUT`، و در انتها یک **حکم** از قاعدهٔ
   `relayVerdict()`: `OPEN` / `WS_REFUSED` / `UNREACHABLE` / `TIMEOUT` /
   `NO_WEBSOCKET` / `NO_MEASUREMENT`.
4. `https://secure.walletconnect.org/sdk` → فریمِ کیفِ سوشال.

به‌علاوه: وضعیتِ دو مارکر (`fbt_email_social_connected` و کلیدِ SDK) و تعدادِ
نشست‌های `wc@2:` روی همان دستگاه، و آخرین رویدادهای trace.
کد: `src/lib/walletHealth.js` + `src/components/WalletHealthPanel.jsx`؛
تست: `test/wallet-health-probe.mjs` (۶۲ ادعا، همهٔ لبه‌های شبکه‌ای شبیه‌سازی‌شده).

> **دو خطای همین ابزار که بعداً با گزارشِ کاربر پیدا شد:** خواندنِ
> `features.social_login` روی یک **آرایه** (⇒ همیشه `email=false socials=0`) و
> چاپِ نتیجهٔ **یک** میزبانِ رله زیر برچسبِ «رلهٔ WalletConnect». هر دو در
> [`WALLET-HEALTH-INSTRUMENT-FIX-FA.md`](./WALLET-HEALTH-INSTRUMENT-FIX-FA.md)
> با سورسِ نصب‌شدهٔ SDK و پاسخِ زندهٔ API اثبات و اصلاح شده‌اند.

---

## ۶) دو مسیرِ پذیرشی که خواستی

- **QR**: شیت، `repairPairingUri(uri)` را با حاشیهٔ آرامِ ۴ ماژول رندر می‌کند؛
  تستِ `wc-pairing-surface-probe` همان QR را با کتابخانهٔ **دیگری** (`jsQR`)
  دوباره decode می‌کند و باید **بایت‌به‌بایت** همان URI برگردد (۶۴ ادعا). روی
  گوشی دوم، با اسکنرِ خودِ کیف پول اسکن شود.
- **مرورگرِ خودِ کیف پول**: در مرورگرِ داخلیِ تراست، `window.ethereum` تزریق
  می‌شود و شیت یک ردیفِ تزریقی نشان می‌دهد (برچسبش با `isTrust` تشخیص داده
  می‌شود) که به `connectInjected` می‌رسد — بدونِ رله و بدونِ دیپ‌لینک.

## ۷) آزمون‌ها (اجراشده در همین ورک‌اسپیس)

```
wiring                 18/18
wc-connect             77/77
wc-timeout             24/24
wc-storage              7/7
wc-chain               12/12
wc-wallets             37/37
wc-deeplink            37/37
wc-uri-hygiene         32/32
wc-pairing-surface     64/64
wallet-health          62/62   (پس از اصلاحِ ابزار: payloadِ آرایه‌ای + هر دو میزبانِ رله)
email-social           49/49
                       ─────
                       419 assertion, 0 failure
```

> آن‌چه در این محیط **قابلِ اندازه‌گیری نبود**: جفت‌شدنِ زنده روی رله، اسکنِ
> واقعیِ QR با گوشی، و خودِ dashboard. برای همین، پنلِ سلامت اضافه شد تا سمتِ
> کاربر اندازه‌گیری شود؛ نتیجهٔ آن JSON در کمتر از یک دقیقه می‌گوید کدام حلقه
> پاره است.
