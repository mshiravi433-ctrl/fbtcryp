# موج ۳ — بستهٔ RFP برای Sandbox Operator

تاریخ: ۲۰۲۶-۰۸-۲۶

## زمینه

سیستم FBT Intent AI نیاز به شاهد `sandbox-operator` دارد.
Sandbox باید isolation داشته باشد و هرگز به production/mainnet دسترسی نداشته باشد.

## فرمت شاهد مورد نیاز

```json
{
  "kind": "sandbox-operator",
  "providerId": "gvisor | firecracker | docker-isolated",
  "digest": "64 hex chars (sha256 of sandbox config)",
  "available": true,
  "attested": true,
  "mainnetAccess": false,
  "productionSigner": false,
  "realCustody": false,
  "checkedAt": 1234567890000,
  "expiresAt": 1234567890000
}
```

## معیارهای پذیرش

1. `available` و `attested` باید `true` باشند
2. `mainnetAccess` باید `false` باشد (sandbox هرگز به mainnet دسترسی ندارد)
3. `productionSigner` باید `false` باشد
4. `realCustody` باید `false` باشد
5. `isolation` باید verified باشد

## تابع verification

```javascript
import { verifySandboxOperator } from '../src/lib/intent-ai/operationalActivation.js';

const result = verifySandboxOperator({
  available: true,
  attested: true,
  mainnetAccess: false,
  productionSigner: false,
  realCustody: false,
  providerId: 'gvisor-sandbox',
  digest: 'abcdef...',
  checkedAt: Date.now(),
  expiresAt: Date.now() + 86400_000
});

// result.ok === true means sandbox is verified
// result.ok === false with SANDBOX_MUST_NOT_TOUCH_PRODUCTION if any production access is true
```

## چک‌لیست راه‌اندازی

- [ ] Firecracker یا gVisor نصب شده
- [ ] Isolation verified (sandbox نمی‌تواند به host network دسترسی داشته باشد)
- [ ] هیچ کلید production در sandbox نیست
- [ ] هیچ دسترسی mainnet از sandbox نیست
- [ ] Attestation record ایجاد شده

## OPERATOR_REQUIRED

1. راه‌اندازی sandbox (Firecracker/gVisor)
2. تأیید isolation
3. ایجاد attestation record
4. تزریق شاهد از طریق operator-evidence endpoint
