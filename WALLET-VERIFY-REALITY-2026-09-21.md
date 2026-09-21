# WalletConnect Verify API — واقعیت ۲۰۲۶، نه آنچه فکر می‌کردیم

> ⚠️ **اصلاح ۲۰۲۶-۰۹-۲۱ (همان روز):** نتیجه‌گیریِ این سند — «هیچ قدمی در داشبورد لازم نیست» — **غلط بود** و همین باعث شد «unverified domain» با وجود سه PR حل نشود.
> کد SDK همچنان `isVerified` را از سرور می‌خواند و سرور آن را از **رجیستری دامنهٔ پروژه** (داشبورد → Configuration → Domain → Allowlist) برمی‌گرداند؛ و مستندات امروز Reown هم دو قدم را لازم می‌داند.
> مدرک و رفعِ واقعی: [`WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md`](WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md)

> تاریخ: ۲۰۲۶-۰۹-۲۱ · شاخه: `arena/01a0c289-fbtcryp`

## کشف کلیدی: WalletConnect دیگر به دامنهٔ ثبت‌شده نیاز ندارد

بعد از خواندن [blog رسمی WalletConnect](https://walletconnect.com/blog/protect-users-from-phishing-with-walletconnect-verify-api-for-web3-apps-and-wallets) (آگوست ۲۰۲۵)، [Verify Client spec](https://specs.walletconnect.com/2.0/specs/clients/core/verify/verify-client-api) و [Verify Attestations spec](https://specs.walletconnect.com/2.0/specs/clients/core/verify/verify-attestations)، فهمیدم که **تمام کاری که در PR قبلی روی فایل `walletconnect.txt` و dashboard listing انجام دادم اضافی بود**.

قسمت نقل‌به‌عل مطلب از blog رسمی:

> **«WalletConnect's Verify API no longer requires manual domain listing in the Cloud dashboard. Instead, it now automatically determines and checks your app's domain when a wallet connects.»**

یعنی:

| چیزی که فکر می‌کردم لازم است | واقعیت ۲۰۲۶ |
|---|---|
| ❌ فایل `/.well-known/walletconnect.txt` با کد تأیید | دیگر لازم نیست — Verify Client API از `window.postMessage` + Verify Enclave iframe استفاده می‌کند (spec رسمی) |
| ❌ اضافه کردن دامنه در داشبورد Reown | اختیاری — Dashboard فقط برای App IDs (mobile) لازم است، نه برای browser attestation |
| ❌ دریافت کد تأیید از داشبورد | کدی وجود ندارد — attestation خودکار است |
| ✅ `metadata.url` درست تنظیم شده باشد | **این تمام چیزی است که dApp باید انجام دهد** |

## مکانیزم واقعی

مرورگر dApp ← `Verify Client.register({ attestationId })` →
یک `window.postMessage` به Verify Enclave در `verify.walletconnect.org` می‌فرستد →
Enclave `event.origin` را از postMessage می‌گیرد و به Verify Server می‌فرستد →
Server origin را به attestationId مپ می‌کند.

وقتی Wallet session_proposal می‌بیند:
- `Verify.resolve({ attestationId })` → Server برمی‌گرداند `{ origin, isScam, validation }`
- `validation = (result.origin === new URL(metadata.url).origin) ? 'VALID' : 'INVALID'`

**دو چک** انجام می‌شود:
1. **Domain Match** — `metadata.url` با origin واقعی مطابقت دارد؟
2. **Scam Check** — دامنه در Data Lake بلاک‌لیست است؟

اگر هر دو پاس شوند → «Trusted». اگر mismatch یا scam → wallet هشدار می‌دهد یا بلاک می‌کند.

## چه چیزی در PR قبلی درست بود (نگه می‌داریم)

- ✅ `walletIdentityUrl()` — حالا subdomain (`www.fbtswap.ir`) را به عنوان خودش معرفی می‌کند نه canonical
- ✅ `wcMetadata()` با `verifyUrl` — آینده‌نگر برای Verify Enclave URL
- ✅ `repairMetadata()` در session.js — `verifyUrl` را در هر سه‌جایگاه sign-client می‌نویسد
- ✅ تست‌ها (۳۴۸ checks)

## چه چیزی اضافی بود (پاک می‌کنیم)

- ❌ `scripts/walletconnect-write-verify-file.mjs` — CI step برای نوشتن فایل از env var
- ❌ Vite plugin `walletconnectVerifyFile()` — همان منطق
- ❌ `public/.well-known/walletconnect.txt` — فایل تأیید
- ❌ `scripts/walletconnect-reown-register.mjs` — اسکریپت داشبورد (بیشترش)
- ❌ `scripts/walletconnect-domain-verify.mjs` — اسکریپت تأیید فایل (بیشترش)
- ❌ `WALLETCONNECT_VERIFY_CODE` در package.json
- ❌ `WALLETCONNECT_VERIFY_CODE` در .github/workflows/build-apk.yml
- ❌ `WALLET-WORKFLOW-PATCH.diff`

## آنچه واقعاً باقی می‌ماند

**برای حل مشکل «unverified domain» در Trust Wallet:**

1. **مطمئن شوید `metadata.url` درست است** — این در PR قبلی fix شده.
2. **دامنه در بلاک‌لیست نباشد** — اگر هست، بلاک‌لیست را پاک کنید (لایهٔ سوم).
3. **dApp در مرورگر واقعی باز شود** (نه curl/script) — Verify Enclave از `window.postMessage` استفاده می‌کند.
4. **برای APK (https://localhost)** — فقط ثبت App ID (`ir.fbtswap.app`) در داشبورد کافی است، که شما انجام داده‌اید.

**اگر بعد از deploy هنوز «unverified» است:**
- `metadata.url` با origin واقعی مطابقت ندارد → کد ما را چک کنید
- دامنه در Data Lake بلاک شده → `node scripts/wallet-reputation-check.mjs` را اجرا کنید

## نتیجه‌گیری

این PR اکثر کار اضافی را که در مرحلهٔ قبل انجام داده بودم حذف می‌کند. فقط تغییرات زیر باقی می‌ماند:

1. `walletIdentityUrl()` بهبود یافته (www.fbtswap.ir)
2. `wcMetadata()` با `verifyUrl` (آینده‌نگر)
3. `repairMetadata()` بهبود یافته
4. مستندات به‌روز شده
5. یک health panel row بهبود یافته

این یعنی **deploy فوری** بدون نیاز به env var، بدون نیاز به فایل، بدون نیاز به کد تأیید.

---

## Walk-back log: artefactهایی که پاک شدند

تاریخ: ۲۰۲۶-۰۹-۲۱. این بخش ثبت می‌کند که چه چیزی از commit `12ace0b` و `a32becb` حذف شد، به ترتیبی که PR این‌ها را پاک می‌کند.

### `12ace0b` و `a32becb` چه اضافه کرده بودند

- `scripts/walletconnect-write-verify-file.mjs` — env var `WALLETCONNECT_VERIFY_CODE` را می‌خواند و فایل `walletconnect.txt` می‌نویسد.
- `vite.config.js` plugin `walletconnectVerifyFile()` — موازی قبل از Vite، با همان منطق.
- `package.json`:
  - `"prebuild": "node scripts/walletconnect-write-verify-file.mjs"`
  - `"build:full": "... && node scripts/walletconnect-write-verify-file.mjs && ..."`
  - `"walletconnect:write": "node scripts/walletconnect-write-verify-file.mjs"`
- `public/.well-known/walletconnect.txt` — placeholder `PENDING_REOWN_VERIFICATION_fbtswap_ir_DO_NOT_SHIP`.
- `src/lib/wc/config.js` → `export const WC_VERIFY_FILE_PATH = '/.well-known/walletconnect.txt';`
- `src/lib/wc/index.js` → re-export آن.
- `src/lib/wc/health.js` → `probeVerifyFile()` (HEAD روی فایل روی origin فعلی).
- `src/components/WalletHealthPanel.jsx` → ردیف `verifyFile` (سبز/قرمز بر اساس HEAD روی فایل).
- `src/i18n/locales/{en,fa}.json` → کلیدهای `healthMetadataVerifyFile`, `healthVerifyFileOk`, `healthVerifyFileMissing`.
- `.github/workflows/build-apk.yml` → env `WALLETCONNECT_VERIFY_CODE` (این را GitHub App نمی‌توانست push کند؛ به `WALLET-WORKFLOW-PATCH.diff` منتقل شد).
- `WALLET-WORKFLOW-PATCH.diff` — patch برای workflow.
- `WALLET-DEPLOY-NOW.md` (نسخهٔ قبلی) — مراحل ۲ تا ۵ در مورد env var و فایل.
- `WALLET-DOMAIN-VERIFY-FIX-2026-09-21.md` (نسخهٔ قبلی) — کل سند در مورد فایل و داشبورد.

### در این PR چه پاک شد

| فایل / artefact | وضعیت |
|---|---|
| `scripts/walletconnect-write-verify-file.mjs` | حذف با `rm` |
| `public/.well-known/walletconnect.txt` | حذف با `rm` |
| `WALLET-WORKFLOW-PATCH.diff` | حذف با `rm` |
| `vite.config.js` plugin `walletconnectVerifyFile()` | حذف؛ NOTE block اضافه شد به این سند اشاره می‌کند |
| `package.json` prebuild + `walletconnect:write` alias | حذف |
| `src/lib/wc/config.js` `WC_VERIFY_FILE_PATH` constant | حذف |
| `src/lib/wc/index.js` re-export آن | حذف |
| `src/lib/wc/health.js` `probeVerifyFile` → `probeVerifyEnclave` | جایگزین شد (HEAD روی `https://verify.walletconnect.org/`) |
| `src/components/WalletHealthPanel.jsx` ردیف `verifyFile` → `verifyEnclave` | جایگزین شد |
| `src/i18n/locales/en.json` | `healthVerifyEnclave` اضافه شد؛ کلیدهای قدیمی باقی ماند (تا fa.json mirror شود) |
| `src/i18n/locales/fa.json` | `healthVerifyEnclave` اضافه شد؛ کلیدهای قدیمی در mirror بعدی پاک می‌شود |
| `test/walletconnect-stack-probe.mjs` | بلوک spawnSync `walletconnect-write-verify-file.mjs` + invariant `WC_VERIFY_FILE_PATH` حذف شد |
| `scripts/walletconnect-domain-verify.mjs` | بازنویسی به probe ساده (Enclave reachability + print metadata) |
| `scripts/walletconnect-reown-register.mjs` | حذف بخش «Verify by file»؛ فقط allowlist + App ID |
| `scripts/wallet-reputation-check.mjs` | چک `walletconnect.txt` از آن حذف شد |
| `WALLET-DEPLOY-NOW.md` | بازنویسی کامل به «deploy بدون env var» |
| `WALLET-DOMAIN-VERIFY-FIX-2026-09-21.md` | بازنویسی کامل به واقعیت Verify API |
| این سند (`WALLET-VERIFY-REALITY-2026-09-21.md`) | اضافه شد با walk-back log |

### آنچه باقی ماند (و درست بود)

- `walletIdentityUrl()` بهبود یافته — `www.fbtswap.ir` خودش را معرفی می‌کند.
- `wcMetadata()` با `verifyUrl` — هنوز هم در spec رسمی معنی دارد (Verify Enclave URL را هم می‌پذیرد).
- `repairMetadata()` در session.js — همچنان `verifyUrl` را روی هر سه target sign-client می‌نویسد.
- `WC_ALLOWED_ORIGINS` سه‌گانه — همچنان معنی دارد (project allowlist برای AppKit).
- `WC_ANDROID_APP_ID = ir.fbtswap.app` — همچنان معنی دارد (App IDs در داشبورد).

### چرا این walk-back مهم بود

اگر کاربر URL بلاگ را share نمی‌کرد و نمی‌گفت «the dashboard gave me no code»، این artefactها تا اولین deploy واقعی لایو می‌شدند و در آن‌جا کار نمی‌کردند. deploy Vercel بدون env var → اسکریپت `walletconnect-write-verify-file.mjs` placeholder را deploy می‌کرد → Verify Enclave آن را نمی‌خواند (Enclave اصلاً فایل نمی‌گیرد) → verdict همچنان `UNKNOWN` یا `INVALID` → گزارش «هنوز کار نکرد» بدون سرنخ.

به جایش، کاربر با یک جملهٔ کوتاه تشخیص داد که مدل ذهنی ما قدیمی است، و این اجازه را داد که قبل از deploy، کل artefactها پاک شوند.
