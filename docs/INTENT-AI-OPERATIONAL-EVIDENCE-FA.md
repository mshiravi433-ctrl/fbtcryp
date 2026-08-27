# FBT INTENT AI — Evidence عملیاتی (فاز ۲۱)

تاریخ: ۲۰۲۶-۰۸-۲۶

## Source و implementation

ماژول `operationalActivation.js` هر رکورد evidence را نرمال و verify می‌کند. `intentOperationalEvidence.js` اسکن سرور را بدون ارتقای env به verified انجام می‌دهد.

## Provider و integration

Provider واقعی متصل‌شده در این محیط: هیچ‌کدام.  
نام configuration (مثلاً Blob یا certifier allowlist) فقط `configured-not-verified` است.

## Schema و API

هر evidence عمومی این شکل را دارد:

```json
{
  "kind": "provider-health",
  "providerId": "public-id-only",
  "digest": "public-digest-only",
  "checkedAt": 0,
  "expiresAt": 0,
  "status": "verified"
}
```

Statusهای `verified` و `operational` فقط با evidence جاری و قابل verification مجازند.

## Configuration

جدا از verification. وجود فایل، fixture یا flag محیط evidence نیست.

## Evidence و verification

مسیرهای fail-closed: missing، stale، malformed، timeout، outage، mismatch، replay، revoked، expired، unsigned review، unmeasured SLO، raw credential.

## Operational status

هیچ workstreamی operational یا live نیست.

## تست‌ها و نتیجه

Probe فاز ۲۱ مسیرهای شکست اجباری را پوشش می‌دهد. Success فقط وقتی evidence تزریق‌شده و جاری باشد؛ آن هم `live: false` و `executionActivated: false` می‌ماند.

## Blockerها

فهرست کامل در `GET /api/intents/v1/phase-status` فیلد `phase21.readiness.blockers`.

## Secret/privacy status

رد کامل seed phrase، private key، master password و raw secret.

## تصمیم

توقف launch. Evidence عملیاتی موجود نیست.

```text
System Active & Verified.
Execution Ready — wallet confirmation remains required.
Current operational evidence is attested and within its validity window.
```
