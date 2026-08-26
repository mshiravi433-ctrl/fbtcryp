# FBT INTENT AI — نقشهٔ راه فعال‌سازی عملیاتی

تاریخ: ۲۰۲۶-۰۸-۲۶

## وضعیت فعلی

سیستم Intent AI (۶۵ بخش، PR #90) پیاده‌سازی شده است. فازهای ۱۰–۵۰
source + probe دارند اما هیچ‌کدام operational نیستند چون ۲۱ شاهد عملیاتی واقعی
وجود ندارد.

## ۲۱ شاهد مورد نیاز

| # | kind | توصیف | موج |
|---|------|-------|------|
| 1 | `approved-durable-registry` | Blob read/write فعال | 0 |
| 2 | `certificate-authority` | CA/PKI با fingerprint معتبر | 3 |
| 3 | `sandbox-operator` | sandbox با attested isolation | 3 |
| 4 | `simulator` | requestDigest + resultDigest | 2 |
| 5 | `monitor` | heartbeat ≤ 60s | 2 |
| 6 | `scheduler-operator` | signs:false, submits:false | 2 |
| 7 | `smart-wallet` | با guardian مستقل | 1 |
| 8 | `independent-guardian` | guardian مستقل | 3 |
| 9 | `production-signer` | policy-bound | 1 |
| 10 | `wallet-provider` | adapter سالم | 1 |
| 11 | `broker-provider` | broker env | 1 |
| 12 | `bridge-provider` | bridge quote | 1 |
| 13 | `venue-health` | verifyProviderHealth | 1 |
| 14 | `rpc` | RPC quorum | 1 |
| 15 | `policy-contract` | deployed bytecode match | 1 |
| 16 | `durable-immutable-audit` | audit rootHash | 2 |
| 17 | `backup-restore-drill` | restored + hashMatch | 2 |
| 18 | `independent-security-review` | reviewer مستقل | 3 |
| 19 | `reproducible-deployment` | build twice, hash match | 2 |
| 20 | `rollback-drill` | drilled + healthAfter | 2 |
| 21 | `slo-measurement` | measured | 2 |

## موج‌ها

### موج ۰ — Configuration
- `BLOB_READ_WRITE_TOKEN`: Vercel → Storage → Blob
- `ECOSYSTEM_CERTIFIERS`: فرمت `telegramUserId:Label`
- چک‌اسکریپت validate + نمایش در phase-status

### موج ۱ — زیرساخت زنجیره
- KMS adapter, deployedBytecode, deploy-all orchestrator
- Adapter های فقط-تحلیل (bridge, venue-health, broker)
- WalletConnect project ID format lock
- شواهد: rpc, policy-contract, production-signer, smart-wallet, wallet-provider, broker-provider, bridge-provider, venue-health

### موج ۲ — عملیات و اثبات‌پذیری
- simulator, monitor, scheduler, audit, backup-drill, reproducible-build, rollback, SLO
- شواهد: ۴، ۵، ۶، ۱۶، ۱۷، ۱۹، ۲۰، ۲۱

### موج ۳ — شخص ثالث
- CA/PKI، sandbox، security review
- شواهد: ۱، ۲، ۳، ۱۸ (+ guardian مستقل ۸)

### موج ۴ — مسیر تزریق شواهد و Unfreeze
- POST /api/intents/v1/operator-evidence
- Cron freshness تمدید
- فرمان unfreeze (دو اپراتور + audit)
- Dashboard بلوکرهای عمومی

## قوانین

- Missing evidence = هرگز success/ready/verified/live/production
- Secret چاپ/ذخیره نشود
- Dashboard با provider/cert/mock جعلی سبز نشود
- launchAllowed فقط پس از فرمان اپراتور true
