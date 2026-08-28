# FBT INTENT AI — digest دریل عملیاتی

تاریخ: ۲۰۲۶-۰۸-۲۸

چهار دریل Wave 2 واقعاً اجرا می‌شوند. مرحلهٔ ۳ کار زنده است و
`independent-security-review` خودگواهی نمی‌شود. فازهای ۳۱–۱۰۰ داخل فرآیند
اثبات می‌شوند و هیچ kind جدیدی به برد ۲۱/۲۱ اضافه نمی‌کنند.

## مسیرهای زنده

```
GET /api/intents/v1/ops-probe
GET /api/intents/v1/ops-probe?dry=1
GET /api/intents/v1/later-phase-probe
GET /api/intents/v1/later-phase-probe?dry=1
GET /api/intents/v1/external-providers
```

`?dry=1` فقط گزارش می‌دهد و چیزی ذخیره نمی‌کند. later-phase هرگز kind جدید
به store شواهد اضافه نمی‌کند (`evidenceKindsAdded: 0`).

از CLI:

```bash
npm run ops:drill
npm run ops:drill -- --out docs/operational-drill-digest.json --md docs/OPERATIONAL-DRILL-DIGEST-FA.md
npm run test:later-phase
npm run test:ops-drills
npm run test:stage3
```

Schema خروجی JSON: `fbt.operational-drill-digest.v1`.
خروج CLI صفر است اگر و فقط اگر ۴/۴ دریل کسب شده باشند. `launchAllowed`
برای later-phase همیشه `false` می‌ماند.

## دریل‌ها

| شاهد | چه چیزی واقعاً اجرا می‌شود |
|------|---------------------------|
| `backup-restore-drill` | snapshot نوشته، خوانده و hash تطبیق داده می‌شود |
| `rollback-drill` | release خراب overlay، سپس previous restore |
| `sandbox-operator` | child/vm با env تهی از کلید production |
| `policy-contract` | bytecode متعهد FeeRouter دو بار hash می‌شود |

## فازهای بعدی که هنوز شخص ثالث می‌خواهند

این‌ها داخل فرآیند **اثبات می‌شوند که غایب‌اند** — جعل نمی‌شوند:

- `workforce-sso` — `WORKFORCE_SSO_UNATTESTED`
- `regulatory-counsel` — `REGULATORY_FILING_MISSING` / `INDEPENDENT_COUNSEL_REQUIRED`
- `dependency-sbom` — `SBOM_ATTESTATION_MISSING` (hash روی `package-lock` SBOM نیست)
- `failover-secondary` — `SECONDARY_REGION_UNREADY`
- `browser-wallet-e2e` — `BROWSER_WALLET_REQUIRED`
- `secret-manager` — `SECRET_MANAGER_NOT_VERIFIED` (Ed25519 محلی dual-control نیست)
- `model-supply` — `MODEL_ATTESTATION_MISSING`
- `agent-fleet` — `FLEET_UNATTESTED`
- `independent-security-review` — هرگز خودگواهی نمی‌شود

## قوانین

- Missing evidence = هرگز success/ready/verified/live/production.
- Secret چاپ/ذخیره نمی‌شود.
- later-phase در `SELF_VERIFIABLE_KINDS` نیست و `autoStoreEvidence` صدا زده نمی‌شود.
- `launchAllowed` / `live` / `operational` روی گزارش later-phase همیشه false است.
