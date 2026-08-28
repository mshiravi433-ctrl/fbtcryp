# FBT INTENT AI — مرحلهٔ ۳: کار زنده (نه digest خالی)

تاریخ: ۲۰۲۶-۰۸-۲۸

پنج شاهد از شش شاهد مرحلهٔ ۳ را **همین فرآیند** با کار واقعی کسب می‌کند.
`independent-security-review` هرگز خودگواهی نمی‌شود.

| شاهد | چه کاری انجام می‌شود | providerId |
|------|----------------------|------------|
| `production-signer` | امضای Ed25519 روی envelope مجاز؛ envelope جهش‌یافته رد می‌شود. اگر `DEPLOYER_KMS_KEY_ID` + `AWS_REGION` به GetPublicKey جواب بدهند، `aws-kms` | `policy-bound-local` یا `aws-kms` |
| `smart-wallet` | سیاست زنده + guardian مستقل + تأیید کاربر | `policy-smart-wallet` |
| `independent-guardian` | هویت guardian ≠ user؛ guardian نمی‌تواند جای تأیید کاربر را بگیرد | `process-guardian` |
| `broker-provider` | handle فقط-trade؛ `withdraw` رد می‌شود و fill تأییدشده ادعا نمی‌شود | `trade-only-local` |
| `bridge-provider` | quote زندهٔ deBridge DLN (USDC Arb→Eth، ۱ USDC) — نه helper شبیه‌سازی‌شده | `debridge-dln` |
| `independent-security-review` | فقط intake امضای Ed25519 از allowlist | شناسهٔ بازبین |

## مسیرهای زنده

```
GET  /api/intents/v1/stage3-probe
GET  /api/intents/v1/stage3-probe?dry=1
GET  /api/intents/v1/stage3-digest
GET  /api/intents/v1/stage3-review-package
POST /api/intents/v1/stage3-review
```

Boot و هر ۴ ساعت همان کار را تکرار می‌کنند. `?dry=1` بدون ذخیره گزارش می‌دهد.

از CLI:

```bash
npm run ops:drill
npm run test:stage3
```

## independent-security-review (ممیزی خریدنی)

این فرآیند **هرگز** این kind را برای خودش صادر نمی‌کند.

۱. بسته را بگیرید:

```
GET /api/intents/v1/stage3-review-package
```

۲. بازبین allowlist‌شده با Ed25519 روی **بایت‌های خام digest** (۳۲ بایت، نه رشتهٔ hex) امضا می‌کند.

۳. امضا را بفرستید:

```json
POST /api/intents/v1/stage3-review
{
  "reviewerId": "acme-audit",
  "independent": true,
  "signed": true,
  "algorithm": "Ed25519",
  "signature": "<128 hex>"
}
```

Allowlist:

```
INTENT_INDEPENDENT_REVIEWERS=acme-audit:<base64-spki>
```

تا وقتی این intake نیاید، kind در `missing` می‌ماند با کد
`SECURITY_REVIEW_NOT_INDEPENDENT`. اگر بسته عوض شود، امضای قبلی `REVIEW_STALE`
است و باید از نو امضا شود.

RFP موجود: `docs/WAVE3-SECURITY-REVIEW-FA.md`.

## production-signer

- آداپتر: `scripts/lib/kmsAdapter.mjs` (کلید خام فقط testnet)
- مسیر محلی: Ed25519 داخل فرآیند، policy-bound، کلید هرگز export/log نمی‌شود
- مسیر KMS: فقط وقتی GetPublicKey واقعاً جواب بدهد
- `operateProductionSigner` هنوز به **هر دو** `policyBound` و `kmsBound` نیاز دارد

## smart-wallet + independent-guardian

Guardian یک نقش جداگانه است. اگر `guardian.identity === userId` باشد،
`GUARDIAN_MUST_NOT_BE_USER`. اگر guardian به‌جای کاربر confirm کند،
`GUARDIAN_CANNOT_REPLACE_USER`.

## broker-provider

آداپتر موجود است (`src/lib/intent-ai/brokerAdapter.js`) و برداشت را بدون
`extraPolicy` رد می‌کند. Probe یک handle فقط-trade می‌بندد و همین را ثابت می‌کند.

## bridge-provider

یک quote واقعی از deBridge DLN (USDC Arbitrum → USDC Ethereum، ۱ USDC). اگر
شبکه برسد، evidence با `providerId: debridge-dln` صادر می‌شود. اگر نرسد، کد
`BRIDGE_QUOTE_UNREACHABLE` — نه یک quote جعلی. `server/intentBridgeQuote.js`
شبیه‌سازی است و استفاده نمی‌شود.
