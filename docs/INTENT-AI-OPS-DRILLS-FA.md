# FBT INTENT AI — مرحلهٔ ۲: drillهای عملیاتی واقعی

تاریخ: ۲۰۲۶-۰۸-۲۸

چهار شاهدی که قبلاً با مقدار ثابت «موفق» گزارش می‌شدند، حالا **واقعاً اجرا**
می‌شوند. هیچ digest ساختگی تولید نمی‌شود؛ اگر چک رد شود، هیچ شاهدی صادر
نمی‌شود.

| شاهد | چه چیزی واقعاً اجرا می‌شود | digest |
|------|---------------------------|--------|
| `backup-restore-drill` | یک snapshot عملیاتی نوشته، خوانده و hash آن تطبیق داده می‌شود | SHA-256 همان snapshot |
| `rollback-drill` | یک release خراب overlay می‌شود، بعد previous restore می‌شود | SHA-256 نسخهٔ restored |
| `sandbox-operator` | یک child process (یا `node:vm`) با env تهی از کلید production اجرا می‌شود | SHA-256 گزارش isolation |
| `policy-contract` | bytecode متعهدِ FeeRouter دو بار hash می‌شود؛ اگر RPC باشد با on-chain مقایسه می‌شود | SHA-256 همان deployedBytecode |

## اجرا از دیپلوی (بدون کامپیوتر)

```
GET /api/intents/v1/ops-probe
GET /api/intents/v1/ops-probe?dry=1
GET /api/intents/v1/drill-status
```

`?dry=1` فقط گزارش می‌دهد و چیزی ذخیره نمی‌کند. بدون آن، شواهد کسب‌شده وارد
store شواهد می‌شوند و روی Blob (اگر توکن باشد) ماندگار می‌مانند.

نمونهٔ خروجی:

```json
{
  "schema": "fbt.ops-probe.v1",
  "earnedCount": 4,
  "earned": [
    { "kind": "backup-restore-drill", "providerId": "local-backup-store", "digest": "…" },
    { "kind": "rollback-drill", "providerId": "local-release-plane", "digest": "…" },
    { "kind": "sandbox-operator", "providerId": "node-isolated-sandbox", "digest": "…" },
    { "kind": "policy-contract", "providerId": "compiled-FeeRouter", "digest": "…" }
  ],
  "missing": []
}
```

سرور همین چهار drill را موقع بوت و هر ۴ ساعت تکرار می‌کند.

## اجرا از CLI

```bash
npm run ops:drill
npm run test:ops-drills
```

## آنچه این drillها نیستند

- **backup-restore** یک بازیابی Vercel Blob از region دیگر نیست؛ بازیابی
  snapshot عملیاتی همین فرآیند است، با hash match واقعی.
- **rollback** یک rollback پروداکشن Vercel نیست (به توکن Vercel نیاز دارد).
  rollback یک release artifact داخل store است: good → bad → restore good.
- **sandbox** Firecracker/gVisor نیست. isolation واقعی است
  (`node-isolated-sandbox`): env تهی از `DEPLOYER_PRIVATE_KEY`، KMS، custody و
  mainnet RPC. اگر child process در serverless محدود باشد، `node:vm` با همان
  قرارداد جایگزین می‌شود.
- **policy-contract** بدون `RPC_URL` + آدرس قرارداد، تطبیق on-chain ندارد؛
  digest همان bytecode متعهد است. اگر RPC ست باشد و کد زنجیره جور درنیاید،
  شاهد صادر نمی‌شود.

## قوانین

- Missing evidence = هرگز success/ready/verified/live/production.
- Secret چاپ/ذخیره نمی‌شود.
- این چهار kind در `intentAutoEvidence.SELF_VERIFIABLE_KINDS` نیستند؛ فقط پس از
  موفقیت drill از مسیر ops-probe وارد store می‌شوند.
