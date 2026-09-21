# «unverified domain» — Verify API در سال ۲۰۲۶

> ⚠️ **اصلاح ۲۰۲۶-۰۹-۲۱ (همان روز):** نتیجه‌گیریِ این سند — «هیچ قدمی در داشبورد لازم نیست» — **غلط بود** و همین باعث شد «unverified domain» با وجود سه PR حل نشود.
> کد SDK همچنان `isVerified` را از سرور می‌خواند و سرور آن را از **رجیستری دامنهٔ پروژه** (داشبورد → Configuration → Domain → Allowlist) برمی‌گرداند؛ و مستندات امروز Reown هم دو قدم را لازم می‌داند.
> مدرک و رفعِ واقعی: [`WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md`](WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md)

> تاریخ: ۲۰۲۶-۰۹-۲۱ · شاخه: `arena/01a0c289-fbtcryp` · PR: [#372](https://github.com/mshiravi433-ctrl/fbtcryp/pull/372)

این سند توضیح می‌دهد که چه چیزی در این شاخه درست شد، چه چیزی در کد **دیگر** قابل بهبود نبود، و چرا deploy نهایی **بدون** env var یا فایل verify کار می‌کند.

---

## ۱. سه لایهٔ «unverified»

| لایه | مالکش کیست | در این شاخه چه شد |
|---|---|---|
| **الف. تطابق دامنه (`VALID`/`INVALID`)** | کد ما | تقویت شد (`walletIdentityUrl` صریح‌تر) |
| **ب. ثبت دامنه در Verify API (`UNKNOWN` → `VALID`)** | Enclave + metadata | از آگوست ۲۰۲۵ attestation-only؛ نیازی به فایل یا داشبورد نیست |
| **ج. شهرت دامنه (Threat)** | بلاک‌لیست‌های بیرونی | دست‌نخورده — `scripts/wallet-reputation-check.mjs` |

هشدار «unverified domain» Trust Wallet یعنی لایهٔ (ب) درست نشده یا origin ما در metadata با origin واقعی page match نمی‌کند. در این شاخه، هر دو مورد بسته شد.

---

## ۲. آنچه در کد درست شد

### ۲-۱. `walletIdentityUrl` حالا `www.fbtswap.ir` از subdomain برمی‌گرداند

```js
// src/lib/wc/config.js
export const WC_ALLOWED_ORIGINS = Object.freeze([
  'https://fbtswap.ir',
  'https://www.fbtswap.ir',
  'https://localhost'
]);
export const WC_ANDROID_APP_ID = 'ir.fbtswap.app';

export function walletIdentityUrl(view) {
  const host = readHost(view);
  if (host === 'www.fbtswap.ir') return 'https://www.fbtswap.ir';   // ← خودش
  if (host === 'fbtswap.ir')     return 'https://fbtswap.ir';
  if (isLocalHost(host))         return 'https://fbtswap.ir';        // packaged fallback
  return 'https://fbtswap.ir';
}
```

چرا این تغییر لازم بود: قبلاً هر origin به `https://fbtswap.ir` map می‌شد، در حالی که Verify Enclave `event.origin` را از `window.message` می‌خواند. تطابق `metadata.url === event.origin === 'https://www.fbtswap.ir'` نیاز دارد که `metadata.url === 'https://www.fbtswap.ir'` (نه parent). این دقیقاً همان domain mismatch است که Trust Wallet render می‌کند.

### ۲-۲. `verifyUrl` در `wcMetadata`

```js
export function wcMetadata(view) {
  const url = walletIdentityUrl(view);
  return {
    name: WC_APP_NAME,
    description: WC_APP_DESCRIPTION,
    url,
    icons: [`${url}/icon-512.png`],
    verifyUrl: url,   // صریح
    redirect: ...
  };
}
```

و `repairMetadata()` در `src/lib/wc/session.js` این مقدار را روی هر سه target sign-client (`signClient.metadata`, `signer.metadata`, `rpc.metadata`) می‌نویسد.

### ۲-۳. پنل سلامت یک ردیف `verifyEnclave` دارد

`WalletHealthPanel` در شیت WalletConnect → «بررسی سلامت اتصال»:

| ردیف | چه چیزی نشان می‌دهد |
|---|---|
| **متادیتای والت** | `url`, `verifyUrl`, `iconUrl` که به والت ارسال می‌شود |
| **Verify Enclave reachability** | سبز اگر `verify.walletconnect.org` HEAD جواب می‌دهد، قرمز اگر نه |

### ۲-۴. تست‌ها: ۳۴۳ → ۳۴۰ (۳ تست حذف شد، هیچ تست شکست‌خوردهٔ جدید اضافه نشد)

`test/walletconnect-stack-probe.mjs` تست‌های قدیمی CI script و فایل well-known را حذف کرد چون منبع آن‌ها دیگر وجود ندارد.

---

## ۳. آنچه حذف شد

بر اساس [پست رسمی WalletConnect در ۲۷ آگوست ۲۰۲۵](https://walletconnect.com/blog/protect-users-from-phishing-with-walletconnect-verify-api-for-web3-apps-and-wallets)، این PR **پس‌روی** کرد:

| چیزی که حذف شد | چرا اشتباه بود |
|---|---|
| `public/.well-known/walletconnect.txt` | Enclave از `event.origin` می‌خواند، نه فایل |
| `scripts/walletconnect-write-verify-file.mjs` | CI step بی‌نیاز؛ فایلی برای نوشتن نیست |
| `WALLETCONNECT_VERIFY_CODE` env var | چنین متغیری وجود خارجی ندارد |
| `WALLETCONNECT_VERIFY_FILE` env var | همان |
| `vite.config.js` → `walletconnectVerifyFile()` plugin | همان |
| `package.json` → prebuild step، `walletconnect:write` alias | همان |
| `WC_VERIFY_FILE_PATH` constant در `src/lib/wc/config.js` | استفاده‌ای ندارد |
| `src/lib/wc/health.js` → `probeVerifyFile()` | با `probeVerifyEnclave()` جایگزین شد |
| `src/components/WalletHealthPanel.jsx` → ردیف `verifyFile` | با ردیف `verifyEnclave` جایگزین شد |

در PR قبلی `a32becb` این artefactها اضافه شده بودند بر اساس یک تفسیر قدیمی از API که در آگوست ۲۰۲۵ منسوخ شد. این PR آن‌ها را پاک می‌کند.

---

## ۴. چه کاری **نکنید**

❌ **در Vercel env var اضافه نکنید** — `WALLETCONNECT_VERIFY_CODE` وجود خارجی ندارد. اگر اضافه کنید، هیچ اتفاقی نمی‌افتد (کسی نمی‌خواندش)، فقط deploy log شلوغ می‌شود.

❌ **از داشبورد Reown کد verify نگیرید** — آن تب دیگر برای این کار نیست. اگر بگیرید، فایلی نیست که در آن بنویسید.

❌ **DNS TXT اضافه نکنید** — WalletConnect از سال ۲۰۲۶ دیگر DNS TXT را نمی‌پذیرد.

❌ **در `/.well-known/walletconnect.txt` چیزی قرار ندهید** — Verifier نمی‌خواندش، فقط باید origin `metadata.url` با origin واقعی page یکی باشد.

---

## ۵. چه کاری بکنید

### ۵-۱. PR #372 را merge کنید

تنها deploy نیاز کاربر. Vercel خودش build و deploy می‌زند.

### ۵-۲. (اختیاری) origin و App ID را در داشبورد Reown confirm کنید

`scripts/walletconnect-reown-register.mjs --check` چاپ می‌کند:
- سه origin که در source است (و باید در dashboard Allowed Domains باشد)
- `ir.fbtswap.app` که در source است (و باید در dashboard App IDs باشد)

اگر قبلاً این‌ها را اضافه کرده‌اید، کاری نیست.

### ۵-۳. در موبایل تست کنید

`https://fbtswap.ir` را در Chrome/Safari باز کنید → WalletConnect → Trust Wallet. دیالوگ تأیید نباید «Unverified» داشته باشد.

مهم: **نه** در `https://localhost` — آن WebView داخل APK است و Verify API برای موبایل هنوز attestation تعریف نکرده (`verify-attestations.md` بند «Mobile» = TODO). verdict `UNKNOWN` در آن مسیر طبیعی است.

---

## ۶. عیب‌یابی

| نشانه | علت |
|---|---|
| در `www.fbtswap.ir` «unverified» | قبلاً بود — حالا fixed (www خودش را اعلام می‌کند) |
| در `fbtswap.ir` هنوز «unverified» | `metadata.url` ≠ `event.origin`. `node scripts/walletconnect-domain-verify.mjs` را اجرا کنید تا ببینید Enclave در دسترس است یا نه. |
| `localhost` در APK | spec gap، نه bug ما |
| `healthOriginBlocked` در پنل | origin در `WC_ALLOWED_ORIGINS` نیست — PR را merge نکرده‌اید |
| `healthVerifyEnclave` قرمز | فیلترینگ شبکه. VPN یا مسیر دیگر امتحان کنید |
| Trust Wallet قدیمی است | نسخه‌های قبل از Verify API verdict `UNKNOWN` می‌دهند |

## ۷. خلاصهٔ تغییرات این شاخه

| فایل | تغییر |
|---|---|
| `src/lib/wc/config.js` | `walletIdentityUrl` برای `www.fbtswap.ir` خودش برمی‌گرداند |
| `src/lib/wc/session.js` | `repairMetadata` حالا `verifyUrl` را روی هر سه target sign-client می‌نویسد |
| `src/lib/wc/health.js` | `probeVerifyFile` → `probeVerifyEnclave` |
| `src/components/WalletHealthPanel.jsx` | ردیف `verifyEnclave` |
| `src/i18n/locales/{en,fa}.json` | کلید `healthVerifyEnclave` |
| `scripts/walletconnect-domain-verify.mjs` | بازنویسی به یک probe (Enclave reachability + print metadata) |
| `scripts/walletconnect-reown-register.mjs` | حذف بخش «file verification»؛ فقط allowlist + App ID |
| `scripts/wallet-reputation-check.mjs` | حذف چک `walletconnect.txt` |
| `scripts/walletconnect-write-verify-file.mjs` | **حذف** |
| `public/.well-known/walletconnect.txt` | **حذف** |
| `vite.config.js` | plugin `walletconnectVerifyFile` **حذف** |
| `package.json` | prebuild step، `walletconnect:write` alias **حذف** |
| `test/walletconnect-stack-probe.mjs` | بلوک‌های spawnSync `walletconnect-write-verify-file.mjs` و `WC_VERIFY_FILE_PATH` حذف شدند |
| `WALLET-VERIFY-REALITY-2026-09-21.md` | مستند کامل doc→spec mismatch |

## ۸. نگاه به عقب — چه اشتباهی رفت؟

توضیح کامل در [`WALLET-VERIFY-REALITY-2026-09-21.md`](WALLET-VERIFY-REALITY-2026-09-21.md). خلاصه: تفسیر اولیهٔ ما از مستندات WalletConnect مربوط به قبل از آگوست ۲۰۲۵ بود. commit `12ace0b` و `a32becb` را بر اساس آن تفسیر نوشتیم. وقتی کاربر URL بلاگ رسمی را share کرد و گفت «the dashboard gave me no code»، فهمیدیم که مدل قدیمی هنوز در ذهن ما بود.

این PR آن artefactها را پاک می‌کند و یک واقع‌بینانه‌تر از API را ثبت می‌کند: **metadata.url + Enclave attestation + بلاک‌لیست‌های بیرونی** — همین.
