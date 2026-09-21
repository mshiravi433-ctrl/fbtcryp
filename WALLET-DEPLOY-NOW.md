# Deploy اکنون — Trust Wallet دیگر «unverified domain» نمی‌گوید

> شاخه: `arena/01a0c289-fbtcryp` · PR: [#372](https://github.com/mshiravi433-ctrl/fbtcryp/pull/372)

## وضعیت فعلی

| لایه | وضعیت |
|---|---|
| کد PR | ✅ آماده (commit `a32becb`) |
| PR به main | ✅ [#372](https://github.com/mshiravi433-ctrl/fbtcryp/pull/372) باز شده |
| Workflow patch | ⚠️ در `WALLET-WORKFLOW-PATCH.diff` (GitHub App من نمی‌تواند workflow را push کند) |
| دامنه در داشبورد Reown | ✅ ثبت شده (شما تأیید کردید) |
| کد تأیید در فایل | ❌ placeholder هنوز در source |
| Deploy روی production | ❌ هنوز deploy نشده |

## کاری که باید شما انجام دهید (به ترتیب)

### ۱) PR را merge کنید (۳۰ ثانیه)

[github.com/mshiravi433-ctrl/fbtcryp/pull/372](https://github.com/mshiravi433-ctrl/fbtcryp/pull/372)
→ Merge pull request → Confirm merge.

### ۲) کد تأیید را از داشبورد Reown بگیرید (۱ دقیقه)

[dashboard.reown.com](https://dashboard.reown.com) → پروژه (`5997d5aee8bb42f43ddec4b1a5f94eb1`) → **Domains** → دامنه‌ای که قبلاً اضافه کردید → روی **Verify by file** کلیک کنید → کد را کپی کنید.

کد شکلی شبیه این دارد: `a1b2c3d4e5f6...` (یک رشتهٔ بلند از حروف و اعداد).

### ۳) کد را در Vercel قرار دهید (۲ دقیقه)

Vercel → `fbt-swap` → **Settings** → **Environment Variables** → **Production** → **Add New**:

| Key | Value |
|---|---|
| `WALLETCONNECT_VERIFY_CODE` | (کد از مرحلهٔ ۲) |

→ **Save**.

سپس Vercel خودش build جدید می‌زند. یا اگر نشد: **Deployments** → آخرین deployment → **⋯** → **Redeploy**.

### ۴) کد را در GitHub Secrets قرار دهید (برای APK — ۲ دقیقه)

این مرحله اختیاری است — فقط اگر می‌خواهید APK build بعدی هم verified باشد.

GitHub → `mshiravi433-ctrl/fbtcryp` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Secret |
|---|---|
| `WALLETCONNECT_VERIFY_CODE` | (همان کد از مرحلهٔ ۲) |

### ۵) workflow را update کنید (۱ دقیقه — اختیاری برای APK)

این PR workflow را شامل نمی‌شود (GitHub App من نمی‌تواند). اگر می‌خواهید APK هم verified باشد:

```bash
git checkout main
git pull
git apply WALLET-WORKFLOW-PATCH.diff
git add .github/workflows/build-apk.yml
git commit -m "ci(apk): WALLETCONNECT_VERIFY_CODE را به env اضافه کن"
git push origin main
```

سپس GitHub Actions → Build APK → Run workflow → خروجی را چک کنید: `[walletconnect-verify] wrote public/.well-known/walletconnect.txt (XX chars)`.

### ۶) Verify کنید (۲ دقیقه)

بعد از deploy:

```bash
curl -s https://fbtswap.ir/.well-known/walletconnect.txt
```

باید **دقیقاً همان کد** را برگرداند که در Vercel گذاشتید (نه placeholder).

سپس در داشبورد Reown → **Domains** → **Verify** را بزنید. باید سبز شود.

### ۷) ۱۵ دقیقه صبر + تست روی موبایل

به‌روزرسانی allowlist در Reown ۱۵ دقیقه طول می‌کشد.

سپس:

1. `https://fbtswap.ir` را در گوشی باز کنید.
2. شیت اتصال → **WalletConnect** → **Trust Wallet**.
3. بالای صفحهٔ تأیید باید **بدون** «Unverified» یا «Domain mismatch» باشد.

اگر هنوز قرمز است: Vercel deploy را چک کنید، و سپس `node scripts/wallet-reputation-check.mjs` را اجرا کنید تا ببینید آیا بلاک‌لیستی دامنه را علامت زده (لایهٔ سوم، خارج از کنترل ما).

## کاری که من انجام دادم

| فایل | تغییر |
|---|---|
| `src/lib/wc/config.js` | `WC_ALLOWED_ORIGINS`, `WC_ANDROID_APP_ID`, `WC_VERIFY_FILE_PATH`, `verifyUrl` در `wcMetadata` |
| `src/lib/wc/session.js` | `repairMetadata` حالا `verifyUrl` را هم در هر سه‌جایگاه sign-client می‌نویسد |
| `src/lib/wc/health.js` | سه ردیف جدید: `metadata`, `dashboardExpected`, `verifyFile` |
| `src/lib/wc/index.js` | export سه ثابت جدید |
| `src/lib/nativeShell.js` | مستندسازی بهتر www.fbtswap.ir |
| `src/components/WalletHealthPanel.jsx` | سه ردیف جدید UI |
| `src/i18n/locales/{en,fa}.json` | ترجمهٔ کلیدهای جدید |
| `public/.well-known/walletconnect.txt` | placeholder قابل‌تشخیص (Vite کپی می‌کند) |
| `scripts/walletconnect-domain-verify.mjs` | تشخیص placeholder + راهنمای allowlist |
| `scripts/walletconnect-reown-register.mjs` | چک‌لیست داشبورد + پروب زنده |
| **`scripts/walletconnect-write-verify-file.mjs`** | **CI step جدید — env var → فایل** |
| `vite.config.js` | Vite plugin موازی |
| `package.json` | prebuild + چهار alias npm |
| `test/walletconnect-stack-probe.mjs` | ۱۹ تست جدید (۳۲۹ → ۳۴۸) |
| `WALLET-DOMAIN-VERIFY-FIX-2026-09-21.md` | سند معماری و عیب‌یابی |
| `WALLET-WORKFLOW-PATCH.diff` | patch برای workflow (نیاز به اعمال توسط شما) |

## چرا همه این کارها؟

WalletConnect یک **JWT امضا‌شده توسط سرور Reown** برمی‌گرداند که می‌گوید «این origin مال این dApp است». کلاینت نمی‌تواند خودش verdict «VALID» اعلام کند — این کار در سرور Reown انجام می‌شود.

سه چیز لازم است:

1. **کد صحیح در metadata** — این در source است ✓
2. **کد تأیید در فایل** — این از env var خوانده می‌شود (شما باید آن را در Vercel قرار دهید)
3. **origin در allowlist داشبورد** — این در داشبورد انجام شده ✓

بدون هر کدام، والت verdict «UNKNOWN» یا «INVALID» نشان می‌دهد.

## تست‌ها

```
$ npm run test:wallet-connection
✓ 345 checks passed
✗ 3 checks failed (network-only: relay reachability probes)
```

## مستندات بیشتر

- `WALLET-DOMAIN-VERIFY-FIX-2026-09-21.md` — معماری + عیب‌یابی کامل
- `scripts/walletconnect-reown-register.mjs` — چک‌لیست داشبورد
- `scripts/wallet-reputation-check.mjs` — بلاک‌لیست‌های عمومی
