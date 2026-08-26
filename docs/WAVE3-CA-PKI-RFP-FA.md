# موج ۳ — بستهٔ RFP برای CA/PKI

تاریخ: ۲۰۲۶-۰۸-۲۶

## زمینه

سیستم FBT Intent AI برای فعال‌سازی عملیاتی نیاز به شاهد `certificate-authority` دارد.
این شاهد باید از یک CA/PKI معتبر با fingerprint قابل verification بیاید.

## فرمت شاهد مورد نیاز

```json
{
  "kind": "certificate-authority",
  "providerId": "lets-encrypt | digicert | custom-ca",
  "issuerIdentity": "string (public CA name)",
  "fingerprint": "64 hex chars (sha256 of certificate)",
  "signatureValid": true,
  "checkedAt": 1234567890000,
  "expiresAt": 1234567890000
}
```

## معیارهای پذیرش

1. `fingerprint` باید sha256 hex باشد (۶۴ کاراکتر)
2. `issuerIdentity` باید نام عمومی CA باشد
3. `signatureValid` باید `true` باشد
4. `expiresAt` باید در آینده باشد
5. `revoked` نباید `true` باشد

## تابع verification

```javascript
import { verifyCertificateAuthority } from '../src/lib/intent-ai/operationalActivation.js';

const result = verifyCertificateAuthority({
  issuerIdentity: 'lets-encrypt',
  fingerprint: 'abcdef...',
  signatureValid: true,
  providerId: 'lets-encrypt',
  checkedAt: Date.now(),
  expiresAt: Date.now() + 90 * 86400_000
});

// result.ok === true means evidence is verified
```

## مسیر ورود نتیجه

```bash
curl -X POST https://your-domain/api/intents/v1/operator-evidence \
  -H "Content-Type: application/json" \
  -H "X-Operator-1: operator-alpha" \
  -H "X-Operator-2: operator-beta" \
  -d '{
    "evidence": [{
      "kind": "certificate-authority",
      "providerId": "lets-encrypt",
      "digest": "<sha256-of-certificate>",
      "checkedAt": <timestamp>,
      "expiresAt": <timestamp>
    }]
  }'
```

## OPERATOR_REQUIRED

1. ثبت‌نام در CA معتبر (Let's Encrypt / DigiCert / etc.)
2. دریافت گواهی TLS
3. محاسبه sha256 fingerprint
4. تزریق شاهد از طریق operator-evidence endpoint
