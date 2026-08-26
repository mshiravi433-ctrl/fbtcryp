# موج ۳ — بستهٔ RFP برای Independent Security Review

تاریخ: ۲۰۲۶-۰۸-۲۶

## زمینه

سیستم FBT Intent AI نیاز به شاهد `independent-security-review` دارد.
Review باید مستقل (non-internal) و signed باشد.

## فرمت شاهد مورد نیاز

```json
{
  "kind": "independent-security-review",
  "reviewerId": "string (public reviewer identifier)",
  "independent": true,
  "signed": true
}
```

## معیارهای پذیرش

1. `independent` باید `true` باشد (reviewer نباید internal باشد)
2. `signed` باید `true` باشد (review باید signed باشد)
3. `reviewerId` باید فرمت `^[a-z0-9][a-z0-9._:-]{1,95}$` داشته باشد

## تابع verification

```javascript
import { verifyIndependentReview } from '../src/lib/intent-ai/operationalActivation.js';

const result = verifyIndependentReview({
  independent: true,
  signed: true,
  reviewerId: 'audit-firm-abc-2026'
});

// result.ok === true means review is verified
// result.ok === false with SECURITY_REVIEW_NOT_INDEPENDENT if not independent
```

## RFP Template برای شرکت‌های Audit

### موضوع: درخواست Security Review مستقل

ما به دنبال یک security review مستقل از کد و معماری سیستم FBT Intent AI هستیم.

**Scope:**
- Smart contracts (FeeRouter, IntentWorkflowBatch, IntentMerkleRootAnchor, IntentAuctionAnchor)
- Server-side code (Node.js/Express)
- Client-side code (React/Vite)
- Cryptographic operations (signing, hashing, key management)

**Deliverables:**
1. گزارش vulnerabilities با severity rating
2. تأیید independence (reviewer نباید سهامدار یا ذینفع باشد)
3. امضای دیجیتال گزارش

**معیارهای reviewer:**
- سابقه audit حداقل ۳ پروژه crypto مشابه
-独立 از تیم توسعه (internal نباشد)
- توانایی امضای دیجیتال گزارش

**Timeline:** ۴-۶ هفته

**Budget:** بر اساس scope و reputation شرکت

## Guardian مستقل (شاهد ۸)

علاوه بر security review، سیستم نیاز به `independent-guardian` دارد:

```json
{
  "kind": "independent-guardian",
  "providerId": "guardian-service",
  "guardianIndependent": true,
  "guardianApproved": true
}
```

Guardian یک نقش جداگانه است که هر تراکنش مالی را بررسی می‌کند.

## OPERATOR_REQUIRED

1. انتخاب شرکت audit مستقل
2. سفارش security review
3. دریافت گزارش signed
4. تزریق شاهد از طریق operator-evidence endpoint
5. راه‌اندازی guardian service مستقل
