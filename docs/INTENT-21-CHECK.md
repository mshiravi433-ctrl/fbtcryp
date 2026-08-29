# بررسی زندهٔ ۲۱ متغیر Intent AI

> منبع داده: `https://fbtcryp-kkxi.vercel.app/api/intents/v1/...` (activation-config، evidence-status، activation، slo-status، drill-status)
> زمان بررسی: 2026-08-28 (UTC)

## خلاصه

| شاخص | مقدار |
|---|---|
| کل kinds موردنیاز (گیت ۲۱/۲۱) | **21** |
| ذخیره‌شده و تأییدشده (verified + attested + healthy) | **18** |
| منقضی‌شده | 0 |
| **نتیجه** | **18/21 — operational: false، launchAllowed: false** |
| وضعیت متغیرهای محیطی (activation-config) | ۷ مورد تنظیم‌شده، ۵ مورد خالی/اختیاری — `requiredForActivation: []` یعنی هیچ env-var فعلاً مسدودکننده نیست |

## جدول ۲۱ گیت

| # | Evidence Kind | وضعیت | Provider | یادداشت |
|---|---|---|---|---|
| 1 | approved-durable-registry | ✅ verified | vercel-blob-registry | Blob token تنظیم است |
| 2 | certificate-authority | ✅ verified | Let-s-Encrypt | از `VERCEL_PROJECT_PRODUCTION_URL` تأمین شده |
| 3 | sandbox-operator | ✅ verified | node-isolated-sandbox | |
| 4 | simulator | ✅ verified | local-simulator | |
| 5 | monitor | ✅ verified | system-monitor | |
| 6 | scheduler-operator | ✅ verified | intent-scheduler | |
| 7 | smart-wallet | ✅ verified | policy-smart-wallet | |
| 8 | independent-guardian | ✅ verified | process-guardian | |
| 9 | production-signer | ✅ verified | policy-bound-local | |
| 10 | wallet-provider | ✅ verified | walletconnect-adapter | `VITE_WALLETCONNECT_PROJECT_ID` تنظیم است |
| 11 | broker-provider | ✅ verified | trade-only-local | |
| 12 | bridge-provider | ✅ verified | debridge-dln | |
| 13 | venue-health | ✅ verified | kraken | |
| 14 | rpc | ✅ verified | configured-rpc-endpoint | `RPC_URL` تنظیم است |
| 15 | **policy-contract** | ❌ **missing** | — | نیازمند استقرار قرارداد سیاست؛ هیچ env-var آن را نمی‌سازد |
| 16 | durable-immutable-audit | ✅ verified | blob-audit-log | |
| 17 | backup-restore-drill | ✅ verified | local-backup-store | drill-status: restored=true، hashMatch=true |
| 18 | **independent-security-review** | ❌ **missing** | — | `INTENT_INDEPENDENT_REVIEWERS` تنظیم است (1 reviewer) ولی attestation امضاشدهٔ Ed25519 هنوز ثبت/ذخیره نشده |
| 19 | reproducible-deployment | ✅ verified | ci-build | drill-status: ok=true |
| 20 | rollback-drill | ✅ verified | local-release-plane | drill-status: drilled=true، healthAfter=true |
| 21 | **slo-measurement** | ❌ **missing** | — | فقط 14-15 نمونه از 20 نمونهٔ لازم در 24h؛ ضمناً p95 = 2743ms > سقف 2000ms |

## سه مورد جاافتاده — علت دقیق و راه رفع

### 15. policy-contract
- **علت:** هیچ رکورد evidence برای قرارداد سیاست روی‌چین وجود ندارد.
- **رفع:** استقرار قرارداد سیاست و ثبت evidence مربوطه (deployment + attestation). هیچ متغیر محیطی این را نمی‌پوشاند.

### 18. independent-security-review
- **علت:** در activation-config، `INTENT_INDEPENDENT_REVIEWERS` مقدار دارد (`reviewerCount: 1` → `reviewer-1`) و `validFormat: true` است، اما gate به‌صراحت «+ signed Ed25519 attestation» می‌خواهد. یعنی reviewer معرفی شده ولی امضای بازبینی مستقل هنوز ساخته/ارسال نشده.
- **رفع:** تولید و ثبت attestation امضاشدهٔ Ed25519 توسط reviewer (از طریق جریان operator-evidence / stage3-review). جایگزین ممکن: `ECOSYSTEM_CERTIFIERS` (تنظیم است) مسیر `independent-security-review-alternative` را باز می‌کند.

### 21. slo-measurement
- **علت:** دو مشکل هم‌زمان:
  1. نمونهٔ ناکافی: `samples: 14` (در آخرین خواندن 15) از `minSamples: 20` در پنجرهٔ 24h → `reason: INSUFFICIENT_SAMPLES`.
  2. حتی اگر نمونه‌ها کامل شوند، `p95LatencyMs: 2743` بالاتر از سقف 2s است → باید کاهش یابد.
- **رفع:** ترافیک واقعی ≥20 ریکوئست در 24 ساعت با uptime ≥99% و p95 ≤2s. uptime فعلی = 1.0 و errorRate = 0، پس فقط «تعداد نمونه» و «p95» مانع هستند.

## وضعیت ۱۲ متغیر محیطی (activation-config)

| متغیر | وضعیت | فرمت | توضیح |
|---|---|---|---|
| BLOB_READ_WRITE_TOKEN | ✅ configured | valid | ثبت دائمی و audit |
| RPC_URL | ✅ configured | valid | اتصال EVM |
| VITE_WALLETCONNECT_PROJECT_ID | ✅ configured | valid | WalletConnect |
| VERCEL_PROJECT_PRODUCTION_URL | ✅ configured | valid | تزریق خودکار Vercel (certificate-authority) |
| CRON_SECRET | ✅ configured | valid | تازگی evidence |
| ECOSYSTEM_CERTIFIERS | ✅ configured | valid | مسیر جایگزین بازبینی مستقل |
| INTENT_INDEPENDENT_REVIEWERS | ✅ configured | valid (1 reviewer) | ولی attestation هنوز ثبت نشده (kind 18) |
| PUBLIC_ORIGIN | ⬜ خالی | — | فقط برای دامنهٔ اختصاصی؛ مسدودکننده نیست |
| INTENT_OPERATIONAL_EVIDENCE | ⬜ خالی | — | اختیاری اگر `--submit` استفاده شده باشد |
| INTENT_INCIDENT_COMMANDER | ⬜ خالی | — | فقط برای drill فازهای بعدی |
| INTENT_ACCOUNTABLE_OWNER | ⬜ خالی | — | فقط برای drill فازهای بعدی |
| VITE_INTENT_BROADCAST_ENABLED | ⬜ خالی | — | باید تا تست روی تست‌نت خاموش بماند |

**نکته:** `requiredForActivation` در پاسخ زنده **خالی** است — یعنی در حال حاضر هیچ متغیر محیطی گیت فعال‌سازی را مسدود نمی‌کند؛ گیت فعلاً فقط به‌خاطر سه evidence (policy-contract، independent-security-review، slo-measurement) روی 18/21 مانده است.

## سایر یافته‌های مهم از `activation`

- `status: partial`، `implementation: implemented`، `operational: false`، `live: false`، `launchAllowed: false`، `isFrozen: false`.
- فازهای تکمیل‌شده: 1..7، specification تا فاز 100 کامل؛ operational فقط تا فاز 7.
- امنیت: `guardianNonDisableable: true`، `failClosed: true`، `secretsExposed: false` — مرز امنیتی سالم است.
- مسدودکنندهٔ عمدهٔ فاز 8: `REAL_SECRET_MANAGER_REQUIRED` — Secret Manager واقعی/KMS هنوز عملیاتی نیست (blob به‌جای آن استفاده می‌شود).

## جمع‌بندی

Intent AI روی **18 از 21** گیت ایستاده و از نظر فنی پیاده‌سازی کامل است، ولی سه گواه نهایی (قرارداد سیاست، امضای بازبینی مستقل، و اندازه‌گیری SLO با p95 زیر 2 ثانیه) باقی مانده تا `operational: true` و اجازهٔ launch صادر شود. هیچ‌کدام از این سه با متغیر محیطی جدید قابل رفع نیستند: یکی استقرار قرارداد می‌خواهد، یکی امضای Ed25519 از reviewer، و یکی ترافیک واقعی ≥20 ریکوئست در 24 ساعت با تأخیر پایین‌تر.
