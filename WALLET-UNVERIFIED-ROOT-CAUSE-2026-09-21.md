# «Unverified domain» چرا درست نشد — ریشهٔ واقعی، با مدرک

> تاریخ: ۲۰۲۶-۰۹-۲۱ · شاخه: `arena/01a0c48d-fbtcryp`
> وضعیت: **علت پیدا شد و اندازه‌گیری شد.** یک قدمِ دستی در داشبورد Reown باقی مانده که هیچ کدی نمی‌تواند انجامش دهد.

---

## ۱. خلاصهٔ یک‌خطی

کد هویت درستی می‌فرستد، اما **پروژه‌ای که کد الان استفاده می‌کند هیچ دامنه‌ای در رجیستری ندارد**. دامنه روی پروژهٔ *قدیمی* ثبت شده است؛ کد در ۱۷ سپتامبر به پروژهٔ جدید مهاجرت کرد و فهرست دامنه‌ها جابه‌جا نشد. برای همین هر اتصالی از آن روز به بعد، صرف‌نظر از درستیِ `metadata.url`، حکم `UNKNOWN` می‌گیرد و والت می‌گوید «Unverified / Cannot verify».

---

## ۲. مدرک (اندازه‌گیری‌شده، نه حدس)

همین الان، از بیرون، اندپوینت عمومیِ allowlist پروژه‌ها:

```
GET https://api.web3modal.org/projects/v1/origins?projectId=<id>&st=appkit&sv=html-appkit-1.8.19
```

| projectId | پاسخ | معنا |
|---|---|---|
| `8e36eccabebf5a4567f4e974fafd6b20` (پروژهٔ **قدیمی**، تا ۲۰۲۶-۰۹-۱۷) | `{"allowedOrigins":["fbtswap.ir","https://fbtswap.ir","https://localhost"]}` | ✅ دامنه‌ها اینجا ثبت شده‌اند |
| `5997d5aee8bb42f43ddec4b1a5f94eb1` (پروژهٔ **فعلیِ داخل کد**) | `{"allowedOrigins":[]}` | ❌ هیچ دامنه‌ای ثبت نیست |
| `00000000000000000000000000000000` (ساختگی) | `Forbidden` | یعنی اندپوینت واقعاً پروژه را تفکیک می‌کند و «لیست خالی» یک پاسخ معتبر است، نه خطا |

کد امروز فقط یک شناسه می‌شناسد — ثابتِ `WC_PROJECT_ID` در `src/lib/wc/config.js`:

```js
export const WC_PROJECT_ID = '5997d5aee8bb42f43ddec4b1a5f94eb1';   // ← لیستش خالی است
```

تکرارِ پاسخِ خودتان را با این ببینید:

```bash
npm run walletconnect:check     # لیست پروژه + حکم Verify را چاپ می‌کند
```

---

## ۳. حکم والت چطور واقعاً ساخته می‌شود (از روی کد SDK، نه از روی بلاگ)

منبع: `@walletconnect/core@2.x` → `src/controllers/verify.ts` و `@walletconnect/sign-client` → `src/controllers/engine.ts`.

**قدم ۱ — سمت dApp، هنگام propose:**

```ts
const attestationId = hashMessage(proposeSessionMessage);          // رمزشدهٔ پیام
const attestation   = await core.verify.register({ id: attestationId, decryptedId });
```

`register()` یک iframe پنهان به این نشانی می‌سازد و **۵ ثانیه** منتظر یک JWT امضاشده می‌ماند:

```
https://verify.walletconnect.org/v3/attestation?projectId=…&origin=<window.location.origin>&id=…&decryptedId=…
```

اگر چیزی نرسد، برمی‌گرداند `""` — بدون هیچ خطایی.

**قدم ۲ — سمت والت، هنگام دریافت proposal** (`getVerifyContext` → `verify.resolve`):

```ts
if (attestationId === "")            return;      // → UNKNOWN
if (decoded.payload.id !== encryptedId) return;   // → UNKNOWN
if (!validation)                     return;      // امضا/انقضا           → UNKNOWN
if (!validation.isVerified)          return;      // رجیستریِ دامنه       → UNKNOWN
validation = (result.origin === new URL(metadata.url).origin) ? 'VALID' : 'INVALID';
```

**قدم ۳ — فقط حالا** `metadata.url` با origin گواهی‌شده مقایسه می‌شود.

یعنی سه دروازه است: **شبکه** (JWT باید در ۵ ثانیه برسد) → **رجیستری دامنه** (`isVerified` سرور) → **تطابق metadata**. دروازهٔ دوم از روز مهاجرت بسته بوده و هیچ‌کدام از PRهای قبلی به آن دست نزده بودند.

---

## ۴. چرا PRهای قبلی درستش نکردند

| PR | چه چیزی را درست کرد | کدام دروازه | نتیجه |
|---|---|---|---|
| #364 (۲۰۲۶-۰۹-۱۹) | هویت Verify + حذف هشدار کلاهبرداری | دروازهٔ ۳ (metadata) | لازم بود، کافی نبود |
| #369 (۲۰۲۶-۰۹-۲۰) | تأیید یک‌مرحله‌ای در وب و APK | مسیر اتصال | بی‌ربط به حکم Verify |
| #372 (۲۰۲۶-۰۹-۲۱) | `verifyUrl` در metadata + `walletIdentityUrl` برای `www` | دروازهٔ ۳ | **بی‌اثر برای این گزارش** |

#372 بر اساس این برداشت بود که «از آگوست ۲۰۲۵ دیگر نیازی به ثبت دامنه در داشبورد نیست». آن برداشت از یک بلاگ آمد، نه از کد. کدِ فعلیِ SDK همچنان `isVerified` را از سرور می‌خواند و مستنداتِ امروزِ Reown
([Domain Verification](https://docs.reown.com/appkit/domain-verification)) صریح می‌گوید دو قدم لازم است:

1. **Allowlist کردن دامنه در داشبورد** — Configuration → Domain → `+ Domain` → Allowlist
2. **همان دامنه در metadata**

و اضافه می‌کند: «فقط دامنه‌ای که در metadata است دامنهٔ واقعی شمرده می‌شود؛ دامنه‌های دیگر unverified می‌مانند» و «انتشار تا ۵ دقیقه طول می‌کشد».

پس #372 نه‌تنها بی‌اثر بود، بلکه مستنداتی گذاشت که صریحاً می‌گفت «در داشبورد کاری انجام ندهید» — دقیقاً همان کاری که باید می‌شد.

---

## ۵. رفع (۵ دقیقه، یک کلیک دستی)

### الف) در داشبورد Reown — روی پروژهٔ **فعلی**

```
https://dashboard.reown.com/project/5997d5aee8bb42f43ddec4b1a5f94eb1
```

1. تب **Configuration**
2. بخش **Domain** → `+ Domain`
3. مقدار: `https://fbtswap.ir` (با پروتکل، **بدون** اسلش آخر)
4. دکمهٔ **Allowlist**
5. همان را برای `fbtswap.ir` هم تکرار کنید (پروژهٔ قدیمی هر دو شکل را داشت)
6. `https://localhost` را هم اضافه کنید (origin داخل WebViewـِ APK)

> نکته: طبق مستندات Reown، «فقط دامنه‌ای که در metadata هست دامنهٔ واقعی شمرده می‌شود». چون `www.fbtswap.ir` در عمل به `fbtswap.ir` ریدایرکت می‌شود، دامنهٔ کانونی همان `https://fbtswap.ir` است — همان‌که `walletIdentityUrl()` در production برمی‌گرداند.

### ب) بعد از انتشار (تا ۵ دقیقه)

1. نشست‌های قدیمی را **از داخل Trust Wallet پاک کنید** (Settings → WalletConnect → قطع اتصال).
2. مرورگر را یک بار reload کنید (باندل و کش).
3. `https://fbtswap.ir` را باز کنید → WalletConnect → Trust Wallet.
4. پنل سلامت: **اتصال والت → بررسی سلامت اتصال** → ردیف «گواهی Verify» باید بگوید:
   `isVerified=true · origin=https://fbtswap.ir`

تأیید از خط فرمان (بعد از allowlist):

```bash
npm run walletconnect:check
# انتظار: registry: 2 domains · حکم: VALID (برای https://fbtswap.ir)
```

---

## ۶. اگر بعد از این هم unverified ماند

| نشانهٔ پنل سلامت | علت | کار |
|---|---|---|
| `NO_ATTESTATION` | `verify.walletconnect.org` روی این شبکه فیلتر/کند است؛ بودجهٔ ۵ ثانیه‌ای SDK کافی نیست | VPN یا شبکهٔ دیگر؛ این PR اتصال را از قبل گرم می‌کند (`warmVerifyEnclave`) |
| `UNVERIFIED` با `isVerified=false` | دامنه هنوز در رجیستریِ **این** پروژه نیست | بخش ۵ را دوباره؛ ۵ دقیقه صبر؛ نشست قدیمی را پاک کنید |
| `MISMATCH` | `metadata.url` با origin صفحه یکی نیست | صفحه را روی `https://fbtswap.ir` باز کنید، نه preview، نه `www`، نه `localhost` |
| داخل **APK** («Cannot verify») | spec موبایل هنوز attestation تعریف نکرده و origin صفحه `https://localhost` است | طبیعی است؛ راه اندازی از مرورگر است، نه WebView خود APK |
| Trust Wallet برچسب «External App» | بعضی والت‌ها Verify خودشان را دارند، نه Verify APIیِ Reown | از جانب ما قابل رفع نیست |

---

## ۷. آنچه این شاخه در کد تغییر داد

علت اصلی با کد حل نمی‌شد — اما **دیده‌شدنش** چرا. تا امروز «unverified» یک برچسب بود و هیچ جای اپلیکیشن نمی‌گفت کدام دروازه بسته است.

| فایل | تغییر |
|---|---|
| `src/lib/wc/verify.js` | **جدید.** `probeVerifyAttestation()` همان iframe و درخواستِ خودِ SDK را اجرا می‌کند و JWT سرور را می‌خواند (`isVerified`, `isScam`, `origin`, `exp`) — اولین باری که dApp می‌تواند پاسخ سرور را ببیند. به‌علاوهٔ `predictVerifyVerdict()` (حکم از روی allowlist، بدون نیاز به شبکه) و `warmVerifyEnclave()` |
| `src/lib/wc/health.js` | گزارش سه‌گانه: `verify.registry` (رجیستری)، `verify.attestation` (اندازه‌گیری زنده)، `verify.predicted` (حکم محاسبه‌شده) |
| `src/components/WalletHealthPanel.jsx` | ردیف «گواهی Verify» + جملهٔ دقیق علت + لینک و مقدار آمادهٔ کپی برای داشبورد |
| `src/lib/wc/session.js` | گرم‌کردن اتصال Enclave در شروع `connect()` — بودجهٔ ۵ ثانیه‌ای روی شبکهٔ فیلترشده |
| `src/lib/wc/config.js` | اصلاح توضیحِ گمراه‌کنندهٔ «نیازی به ثبت دامنه نیست» |
| `src/i18n/locales/{en,fa}.json` | کلیدهای هر هشت حکم + جملهٔ رفع |
| `scripts/walletconnect-domain-verify.mjs` | بازنویسی: رجیستری را از API می‌خواند و حکم را چاپ می‌کند |
| `scripts/walletconnect-reown-register.mjs` | چک‌لیست اصلاح‌شده: allowlist دامنه حالا قدمِ ۱ است، نه «بی‌نیاز» |
| `test/walletconnect-stack-probe.mjs` | بخش ۱۶ — ۳۸ بررسی جدید برای هر سه دروازه |

تست‌ها: `node test/walletconnect-stack-probe.mjs` → ۳۷۷/۳۸۰ (سه خطایِ مانده مربوط به نبودِ `node_modules` در این محیط است و به این تغییر ربطی ندارد).

---

## ۸. درس

یک بلاگِ ۲۰۲۵ را به‌جای کدِ SDK مبنا گرفتیم، و بعد مستنداتی نوشتیم که قدمِ لازم را صریحاً «نیاز نیست» اعلام کرد. کدِ SDK (که در بالا نقل شد) و مستنداتِ امروزِ Reown هر دو می‌گویند ثبت دامنه لازم است؛ اندازه‌گیریِ allowlist پروژه‌ها همین را نشان می‌دهد. از این به بعد، هر ادعایی دربارهٔ Verify باید یا به کد SDK ارجاع بدهد یا به یک اندازه‌گیری — مثل این سند.
