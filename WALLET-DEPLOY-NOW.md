# Deploy اکنون — Trust Wallet و Verify API در production

> ⚠️ **اصلاح ۲۰۲۶-۰۹-۲۱ (همان روز):** نتیجه‌گیریِ این سند — «هیچ قدمی در داشبورد لازم نیست» — **غلط بود** و همین باعث شد «unverified domain» با وجود سه PR حل نشود.
> کد SDK همچنان `isVerified` را از سرور می‌خواند و سرور آن را از **رجیستری دامنهٔ پروژه** (داشبورد → Configuration → Domain → Allowlist) برمی‌گرداند؛ و مستندات امروز Reown هم دو قدم را لازم می‌داند.
> مدرک و رفعِ واقعی: [`WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md`](WALLET-UNVERIFIED-ROOT-CAUSE-2026-09-21.md)

> شاخه: `arena/01a0c289-fbtcryp` · PR: [#372](https://github.com/mshiravi433-ctrl/fbtcryp/pull/372)

## خلاصهٔ یک‌خطی

Verify API از آگوست ۲۰۲۵ attestation-only است. هیچ env var، هیچ فایل، هیچ کدی نیست که در Vercel یا GitHub قرار دهید — **تنها کار** این است که PR را merge کنید و `https://fbtswap.ir` را در یک مرورگر واقعی با Trust Wallet نصب‌شده باز کنید.

## وضعیت فعلی

| لایه | وضعیت |
|---|---|
| `metadata.url` = `https://fbtswap.ir` | ✅ در source (`walletIdentityUrl()` در `src/lib/wc/config.js`) |
| `verifyUrl` = `https://fbtswap.ir` | ✅ از همان `wcMetadata()` |
| `WC_PROJECT_ID` در AppKit | ✅ در source |
| سه origin در `WC_ALLOWED_ORIGINS` | ✅ در source |
| `WC_ANDROID_APP_ID = ir.fbtswap.app` | ✅ در source |
| PR #372 باز | ✅ |
| `/.well-known/walletconnect.txt` | ❌ **حذف شد** (بی‌فایده از آگوست ۲۰۲۵) |
| `WALLETCONNECT_VERIFY_CODE` env | ❌ **حذف شد** (چنین متغیری وجود ندارد) |
| `WALLETCONNECT_VERIFY_FILE` env | ❌ **حذف شد** (چنین متغیری وجود ندارد) |
| `scripts/walletconnect-write-verify-file.mjs` | ❌ **حذف شد** (CI step بی‌نیاز) |

## کاری که باید انجام دهید (به ترتیب)

### ۱) PR #372 را merge کنید (۳۰ ثانیه)

[github.com/mshiravi433-ctrl/fbtcryp/pull/372](https://github.com/mshiravi433-ctrl/fbtcryp/pull/372)
→ Merge pull request → Confirm merge.

### ۲) منتظر deploy خودکار بمانید

Vercel از merge شروع به deploy می‌کند. URL همان `https://fbtswap.ir` است.

### ۳) `https://fbtswap.ir` را در یک مرورگر واقعی باز کنید

مهم: **نه** `localhost`، **نه** `5173-*.e2b.app`. Trust Wallet باید origin واقعی را ببیند.

مرورگر گوشی (Chrome یا Safari) → `https://fbtswap.ir` → WalletConnect → Trust Wallet.

### ۴) تأیید کنید که verdict سبز است

دیالوگ تأیید Trust Wallet باید **بدون** «Unverified» یا «Domain mismatch» باشد. دامنهٔ بالای تأیید باید `fbtswap.ir` باشد، نه `localhost`.

اگر هنوز «unverified» است، مرحلهٔ «عیب‌یابی» در پایان این سند را بخوانید.

### ۵) (اختیاری) APK build بعدی هم verified می‌ماند

`WC_ANDROID_APP_ID = ir.fbtswap.app` در source است؛ در داشبورد Reown در **App IDs** ثبت شده (`scripts/walletconnect-reown-register.mjs --check` تأیید می‌کند). APK در WebView محلی `https://localhost` سرو می‌شود؛ این origin در `WC_ALLOWED_ORIGINS` است. بنابراین APK پس از install به‌طور خودکار verified است — **بدون** هیچ تغییری.

⚠️ اما spec موبایل هنوز attestation را تعریف نکرده (`verify-attestations.md` بند «Mobile» = TODO). اگر Trust Wallet را داخل WebView خود APK باز کنید و اتصال را از آنجا شروع کنید، verdict روی `UNKNOWN` می‌ماند — **این باگ ما نیست، gap مشخصات است**. APK باید Trust Wallet را از طریق intent خارجی باز کند، نه WebView خودش.

## چرا کاری نمانده؟

بر اساس [پست رسمی WalletConnect در ۲۷ آگوست ۲۰۲۵](https://walletconnect.com/blog/protect-users-from-phishing-with-walletconnect-verify-api-for-web3-apps-and-wallets):

> "WalletConnect's Verify API no longer requires manual domain listing in the Cloud dashboard. Instead, it now automatically determines and checks your app's domain when a wallet connects."

Enclave در `verify.walletconnect.org`:
1. از طریق `postMessage("<Attestation_Id>", "<Verify_Enclave_URL>")` از Verify Client پیام می‌گیرد.
2. در iframe داخلی `window.addEventListener('message', (event) => { const attestationId = event.data; const origin = event.origin; ... })` می‌خواند.
3. origin را با `metadata.url` مطابقت می‌دهد و verdict `VALID` / `INVALID` / `UNKNOWN` / `isScam` برمی‌گرداند.

پس هیچ فایل، هیچ DNS TXT، هیچ dashboard "Verify" کلیک، هیچ env var، هیچ CI step وجود ندارد.

## چه چیزی تغییر کرد (خلاصهٔ این PR)

| فایل | تغییر |
|---|---|
| `src/lib/wc/config.js` | `walletIdentityUrl()` حالا `www.fbtswap.ir` از subdomain برمی‌گرداند، نه `fbtswap.ir` |
| `src/lib/wc/session.js` | `repairMetadata()` حالا `verifyUrl` را روی هر سه target sign-client می‌نویسد |
| `src/lib/wc/health.js` | `probeVerifyFile` → `probeVerifyEnclave` (HEAD روی `verify.walletconnect.org`) |
| `src/components/WalletHealthPanel.jsx` | ردیف `verifyEnclave` (نه `verifyFile`) |
| `src/i18n/locales/{en,fa}.json` | کلید `healthVerifyEnclave` |
| `scripts/walletconnect-domain-verify.mjs` | بازنویسی به یک probe: reachability Enclave + print metadata |
| `scripts/walletconnect-reown-register.mjs` | حذف بخش «file verification»؛ فقط allowlist + App ID |
| `scripts/walletconnect-write-verify-file.mjs` | **حذف** |
| `public/.well-known/walletconnect.txt` | **حذف** |
| `vite.config.js` | plugin `walletconnectVerifyFile` **حذف** |
| `package.json` | prebuild step، `walletconnect:write` alias **حذف** |
| `test/walletconnect-stack-probe.mjs` | بلوک‌های spawnSync `walletconnect-write-verify-file.mjs` و `WC_VERIFY_FILE_PATH` حذف شدند |

## عیب‌یابی

اگر Trust Wallet هنوز «unverified domain» نشان می‌دهد:

1. **origin را بررسی کنید.** اگر از `https://fbt-swap-git-main.vercel.app` یا هر preview URL باز می‌کنید، verdict `UNKNOWN` می‌ماند — این origin در `WC_ALLOWED_ORIGINS` نیست. فقط `https://fbtswap.ir` و `https://www.fbtswap.ir` در لیست هستند.

2. **`reputation` را چک کنید.** `node scripts/wallet-reputation-check.mjs`. اگر `ChainPatrol` یا `MetaMask eth-phishing-detect` ما را FLAGGED کرده، حتی origin درست هم verdict `isScam` می‌گیرد.

3. **از WebView خود APK تست نکنید.** spec موبایل هنوز attestation ندارد (TODO). verdict `UNKNOWN` در آن مسیر طبیعی است.

4. **relay باز است؟** `https://fbtswap.ir` → Settings → Wallet Health → اگر relay verdict `WS_REFUSED` یا `UNREACHABLE` است، اول network را fix کنید.

5. **Trust Wallet را به‌روز کنید.** نسخه‌های قدیمی‌تر از Verify API استفاده نمی‌کنند.

## تست‌ها

```bash
npm run test:wallet-connection
```

انتظار: همهٔ چک‌ها pass، بجز ۳ پروب شبکه (relay open/timeout/verdict) که در sandbox محدود است. پس از merge، آن ۳ تا در CI هم سبز می‌شوند.

## مستندات بیشتر

- [`WALLET-VERIFY-REALITY-2026-09-21.md`](WALLET-VERIFY-REALITY-2026-09-21.md) — مستند کامل «doc → spec» mismatch که به این PR منجر شد.
- `scripts/walletconnect-reown-register.mjs` — چک‌لیست داشبورد + پروب زنده.
- `scripts/wallet-reputation-check.mjs` — بلاک‌لیست‌های عمومی.
