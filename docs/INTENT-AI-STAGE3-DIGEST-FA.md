# FBT INTENT AI — مرحلهٔ ۳: گزارش digest (شخص ثالث)

تاریخ: ۲۰۲۶-۰۸-۲۸

این پنج/شش شاهد **خودگواهی نمی‌شوند**. مسیر
`GET /api/intents/v1/stage3-digest` فقط digest وضعیت فعلی را می‌دهد تا اپراتور
بداند برای هر کدام چه چیزی کم است.

| شاهد | digest فعلی چیست | چرا هنوز evidence نیست |
|------|------------------|------------------------|
| `independent-security-review` | SHA-256 بستهٔ بازبینی (قراردادها + KMS + Guardian + drills) | reviewer باید مستقل و signed باشد |
| `production-signer` | SHA-256 آداپتر KMS | `DEPLOYER_KMS_KEY_ID` + `AWS_REGION` لازم است؛ کلید خام فقط testnet |
| `smart-wallet` | SHA-256 سیاست Smart Wallet | کیف پول Smart Account + guardian مستقل |
| `independent-guardian` | همان digest سیاست | هویت guardian نباید user باشد |
| `broker-provider` | SHA-256 `brokerAdapter.js` | handle فقط-trade؛ برداشت ممنوع |
| `bridge-provider` | digest نقل‌قول واقعی deBridge — **تنها مورد قابل‌کسب** | اگر quote عمومی جواب بدهد، evidence صادر می‌شود |

## مسیر زنده

```
GET /api/intents/v1/stage3-digest
```

و از CLI:

```bash
npm run ops:drill
```

پایین خروجی، بخش «stage-3 digest» همان جدول را با کد دلیل چاپ می‌کند.

## independent-security-review (ممیزی خریدنی)

فرمت شاهد پس از خرید ممیزی:

```json
{
  "kind": "independent-security-review",
  "providerId": "audit-firm-name",
  "digest": "<sha256 of the signed report>",
  "reviewerId": "audit-firm-name",
  "independent": true,
  "signed": true,
  "checkedAt": 0,
  "expiresAt": 0,
  "status": "verified",
  "attested": true,
  "health": "healthy"
}
```

بستهٔ بازبینی که reviewer باید امضا کند همان فایل‌هایی است که
`reviewPackageDigest()` hash می‌کند. تا وقتی گزارش signed از یک reviewer
غیر داخلی تزریق نشود (`POST /api/intents/v1/operator-evidence` با دو اپراتور)،
این kind در `missing` می‌ماند با کد `SECURITY_REVIEW_NOT_INDEPENDENT`.

RFP موجود: `docs/WAVE3-SECURITY-REVIEW-FA.md`.

## production-signer (KMS)

- آداپتر: `scripts/lib/kmsAdapter.mjs`
- production باید `DEPLOYER_KMS_KEY_ID` + `AWS_REGION` داشته باشد
- `DEPLOYER_PRIVATE_KEY` فقط برای chainIdهای testnet مجاز است
- تا وقتی signing policy-bound attest نشود: `SIGNER_WITHOUT_POLICY`

## smart-wallet + independent-guardian

Guardian یک نقش جداگانه است. اگر `guardian.identity === userId` باشد،
`GUARDIAN_MUST_NOT_BE_USER`. اگر guardian به‌جای کاربر confirm کند،
`GUARDIAN_CANNOT_REPLACE_USER`.

تا راه‌اندازی Safe/Smart Account + سرویس guardian مستقل:
`SMART_WALLET_WITHOUT_GUARDIAN`.

## broker-provider

آداپتر موجود است (`src/lib/intent-ai/brokerAdapter.js`) و برداشت را بدون
`extraPolicy` رد می‌کند. بدون `BROKER_HANDLE` (فقط-trade، نه withdrawal)
شاهد صادر نمی‌شود: `PROVIDER_HEALTH_FAILURE`.

## bridge-provider

تنها kind مرحلهٔ ۳ که این فرآیند می‌تواند **اندازه بگیرد**: یک quote واقعی از
deBridge DLN (USDC Arbitrum → USDC Ethereum، ۱ USDC). اگر شبکه برسد، evidence
با `providerId: debridge-dln` صادر می‌شود. اگر نرسد، کد
`BRIDGE_QUOTE_UNREACHABLE` یا خطای upstream — نه یک quote جعلی.

## تزریق پس از تهیهٔ شواهد شخص ثالث

```bash
curl -X POST $TARGET/api/intents/v1/operator-evidence \
  -H "Content-Type: application/json" \
  -H "X-Operator-1: alice.ops" \
  -H "X-Operator-2: bob.ops" \
  -d @stage3-evidence.json
```

هر رکورد باید `kind, providerId, digest (64 hex), checkedAt, expiresAt` داشته
باشد و هیچ secretی در payload نباشد.
