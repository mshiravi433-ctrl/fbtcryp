# «unverified domain» — the 14 checks and the one dashboard form

> تاریخ: ۲۰۲۶-۰۹-۲۱ · شاخه: `arena/01a0c289-fbtcryp` · PR مبدأ: شماره بعدی

گزارش: «در تراست والت هم برای localhost و هم برای `fbtswap.ir` هنوز
`unverified domain` نشان می‌دهد.» این سند توضیح می‌دهد چه چیزی در این شاخه
درست شد، چه چیزی در کد دیگر قابل بهبود نبود، و چه چیزی فقط مالک پروژه
می‌تواند در داشبورد Reown کلیک کند.

---

## ۱. سه لایهٔ «unverified»

| لایه | مالکش کیست | در این شاخه چه شد |
|---|---|---|
| **الف. تطابق دامنه (`VALID`/`INVALID`)** | کد ما | قبلاً درست شده بود؛ اینجا تقویت شد |
| **ب. ثبت دامنه در Reown (`UNKNOWN` → `VALID`)** | داشبورد + یک فایل | فایل ساخته شد، اسکریپت داشبورد نوشته شد |
| **ج. شهرت دامنه (Threat)** | بلاک‌لیست‌های بیرونی | دست‌نخورده — فقط فیدهای عمومی قابل چک هستند |

**هشدار «unverified domain» تراست‌والت یعنی فقط لایهٔ (ب) درست نشده.**
لایه‌های (الف) و (ج) اگر خراب بودند پیام متفاوتی می‌دادند. این یعنی کد ما
درست کار می‌کند، فقط **اثبات مالکیت دامنه** مانده — که بیرون از این ریپازیتوری
اتفاق می‌افتد.

---

## ۲. آنچه در کد درست شد

### ۲-۱. سه‌گانهٔ `walletIdentityUrl` صریح‌تر شد

`src/lib/wc/config.js` اکنون سه چیز را صریح در source دارد:

```js
export const WC_ALLOWED_ORIGINS = Object.freeze([
  'https://fbtswap.ir',
  'https://www.fbtswap.ir',
  'https://localhost'
]);
export const WC_ANDROID_APP_ID = 'ir.fbtswap.app';
export const WC_VERIFY_FILE_PATH = '/.well-known/walletconnect.txt';
```

چرا این سه تا، نه فقط `fbtswap.ir`:

* **`https://fbtswap.ir`** — دامنهٔ اصلی. Verify API این را با attestation
  تطبیق می‌دهد.
* **`https://www.fbtswap.ir`** — اگر DNS هاست `www.` را هم به همین دپلوی اشاره
  بدهد (Vercel و بعضی CDNها این کار را می‌کنند)، Trust و MetaMask روی www
  یک «عدم تطابق دامنه» نشان می‌دهند — مگر اینکه www هم در allowlist باشد.
* **`https://localhost`** — WebView داخل APK روی این مبدأ جواب می‌دهد.
  رلهٔ WalletConnect نشست‌هایی که attested origin شان در allowlist نیست
  را با close code 1014 رد می‌کند، حتی اگر دامنهٔ اصلی verify شده باشد.

### ۲-۲. `verifyUrl` به metadata اضافه شد

```js
export function wcMetadata(view) {
  const url = walletIdentityUrl(view);
  return {
    name: WC_APP_NAME,
    description: WC_APP_DESCRIPTION,
    url,
    icons: [`${url}/icon-512.png`],
    verifyUrl: url,           // ← جدید
    redirect: ...
  };
}
```

و `repairMetadata()` در `session.js` این مقدار را در سه‌نقطهٔ
sign-client (`signClient.metadata`, `signer.metadata`, `rpc.metadata`)
می‌نویسد، چون SDK در غیر این صورت مقدار cached قبلی را نگه می‌دارد.

### ۲-۳. فایل `/.well-known/walletconnect.txt` در source است

`public/.well-known/walletconnect.txt` با یک placeholder واضح کامیت شده:

```
PENDING_REOWN_VERIFICATION_fbtswap_ir_DO_NOT_SHIP
```

و `scripts/walletconnect-domain-verify.mjs` این placeholder را می‌شناسد
و در `--check` توضیح می‌دهد که تا کد واقعی Reown نیامده، این فقط یک
نشانه است. Vite محتوای `public/` را عیناً کپی می‌کند، پس فایل **از همین
الان** روی هر دپلویی که از این شاخه بیاید موجود است — با همان محتوای
placeholder. اسکریپت با `--code=<کد>` آن را byte-for-byte با کد واقعی
عوض می‌کند.

### ۲-۴. اسکریپت داشبورد: `walletconnect-reown-register.mjs`

* چاپ سه‌گانهٔ دامنه‌ها + App ID + URL داشبورد، clipboard-ready.
* `--check` هر سه origin را HEAD می‌زند تا ببیند فایل تأیید و آیکون
  روی **هرکدام** جواب می‌دهد یا نه (Verifier فایل را از **هر** origin
  allowlist می‌خواند، نه فقط یکی).
* `--copy` فقط خطوط آمادهٔ paste چاپ می‌کند.

### ۲-۵. پنل سلامت سه ردیف جدید دارد

`WalletHealthPanel` در شیت WalletConnect → «بررسی سلامت اتصال»:

| ردیف جدید | چه چیزی نشان می‌دهد |
|---|---|
| **فهرست مورد انتظار (داشبورد Reown)** | سه دامنه‌ای که باید در dashboard باشند، کنار آنچه الان برمی‌گردد |
| **متادیتای والت** | `url`, `verifyUrl`, `iconUrl`, `verifyFilePath` که به والت ارسال می‌شود |
| **فایل تأیید** | سبز اگر `/.well-known/walletconnect.txt` روی همین origin جواب می‌دهد، قرمز اگر 404 |

### ۲-۶. تست‌ها: ۳۲۹ → ۳۴۳

`test/walletconnect-stack-probe.mjs` چهارده بررسی جدید گرفت:

| تعداد | چه چیزی |
|---|---|
| ۴ | `verifyUrl` در چهار سناریو (canonical، www، packaged، preview) |
| ۶ | شکلِ `WC_ALLOWED_ORIGINS` و `WC_ANDROID_APP_ID` و `WC_VERIFY_FILE_PATH` |
| ۴ | فایل well-known در source (وجود، شکل placeholder یا کد، بدون newline اضافه) |

سه شکست باقی‌مانده در پروب رله‌اند (این سندباکس اینترنت آزاد ندارد)،
نه این تغییرات.

---

## ۳. آنچه در کد قابل بهبود نبود

Verify API حرف‌آخر را در یک JWT امضا‌شده توسط سرور Reown می‌زند؛ کلاینت
نمی‌تواند خودش `VALID` اعلام کند. پس بدون ثبت در داشبورد + فایل تأیید،
این شاخه **نمی‌تواند** مشکل را ببندد. فقط می‌تواند مطمئن شود وقتی آن
دو کار انجام شد، همه‌چیز درست کار می‌کند.

---

## ۴. گام‌های بیرونی — به همین ترتیب

### گام ۱: دامنه‌ها را در داشبورد Reown ثبت کن (۱۰ دقیقه)

```
https://dashboard.reown.com/project/5997d5aee8bb42f43ddec4b1a5f94eb1
```

تب **Domains** → **Add domain**:

| مقدار | چرا |
|---|---|
| `https://fbtswap.ir` | دامنهٔ اصلی |
| `https://www.fbtswap.ir` | اگر www هم resolve می‌شود |
| `https://localhost` | WebView داخل APK |

بدون اسلش انتهایی، با پروتکل.

تب **App IDs** → **Add App ID**:

| مقدار |
|---|
| `ir.fbtswap.app` |

### گام ۲: فایل تأیید را بنویس (۲ دقیقه)

در داشبورد روی هر دامنه، روش **Verify by file** را انتخاب کن، کد را کپی
کن، بعد:

```bash
node scripts/walletconnect-domain-verify.mjs --code=<کد>
npm run build
# deploy
curl -s https://fbtswap.ir/.well-known/walletconnect.txt
```

خروجی باید دقیقاً همان کد باشد. در داشبورد سبز می‌شود.

### گام ۳: ۱۵ دقیقه صبر کن

به‌روزرسانی allowlist در Reown ۱۵ دقیقه طول می‌کشد. در این فاصله
نشست‌ها از origins تازه `INVALID` برمی‌گردند.

### گام ۴: روی موبایل تست کن

شیت WalletConnect → «بررسی سلامت اتصال» → هر سه ردیف جدید باید سبز باشد.
سپس یک Pair واقعی بزن Trust Wallet؛ بالای صفحهٔ تأیید نباید
«Unverified» یا «Domain mismatch» باشد.

---

## ۵. اگر بعد از گام ۴ هنوز «unverified» است

| نشانه | علت |
|---|---|
| فایل در `curl` 404 | deploy نشده، یا Vite فایل را کپی نکرده (با `npm run build && ls dist/.well-known/` چک کن) |
| فایل در `curl` 200 ولی والت هنوز UNVERIFIED | کد Reown و کد فایل با هم match نیستند — یکی را دوباره کپی کن |
| فقط روی www این است | دامنهٔ www در allowlist نیست (گام ۱) |
| فقط داخل APK این است | `ir.fbtswap.app` در App IDs نیست (گام ۱) |
| بالاخره درست نشد | `node scripts/wallet-reputation-check.mjs` بزن؛ اگر `THREAT` بود لایهٔ (ج) است و باید ایمیل Blockaid/Blowfish |

---

## ۶. خلاصهٔ تغییرات این شاخه

| فایل | تغییر |
|---|---|
| `src/lib/wc/config.js` | `WC_ALLOWED_ORIGINS`, `WC_ANDROID_APP_ID`, `WC_VERIFY_FILE_PATH`, `verifyUrl` در `wcMetadata` |
| `src/lib/wc/session.js` | `repairMetadata` حالا `verifyUrl` را هم به سه‌نقطه می‌نویسد |
| `src/lib/wc/health.js` | ردیف‌های `metadata`, `dashboardExpected`, `verifyFile` به گزارش اضافه شد |
| `src/lib/wc/index.js` | export سه ثابت جدید |
| `src/lib/nativeShell.js` | مستندسازی بهتر دربارهٔ `www.` |
| `src/components/WalletHealthPanel.jsx` | نمایش سه ردیف جدید |
| `src/i18n/locales/{en,fa}.json` | ترجمهٔ کلیدهای جدید |
| `public/.well-known/walletconnect.txt` | placeholder قابل تشخیص |
| `scripts/walletconnect-domain-verify.mjs` | تشخیص placeholder + راهنمای allowlist در `--code` |
| `scripts/walletconnect-reown-register.mjs` | اسکریپت جدید: چک‌لیست داشبورد + پروب زنده |
| `test/walletconnect-stack-probe.mjs` | ۱۴ بررسی جدید (۳۲۹ → ۳۴۳) |
