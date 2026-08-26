# FBT INTENT AI — فاز ۱۸: Observability و Proof

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی محصول

## وضعیت صادقانه

Audit hash-chain، why engine، receipt integrity و recovery boundary در source و probe موجودند؛ durable immutable audit store، backup drill و independent incident operator متصل نیستند. فاز **operationally unavailable** است.

## Implementation

فایل: `src/lib/intent-ai/observabilityProof.js`

- audit event دارای actor، action، reason، policyVersion و timestamp است؛
- append-only hash chain با SHA-256 و seal/verify؛
- receipt فقط با provider evidence و confirmation ساخته می‌شود؛ `COMPLETED` علاوه بر integrity به reorg/finality check نیاز دارد؛
- tamper در proof رد می‌شود؛
- incident typeهای reorg، outage، partial-fill و retry جدا هستند؛
- recovery ابتدا existing transaction را observe می‌کند و برای وضعیت ambiguous transaction دوم نمی‌سازد؛
- disaster resilience بدون durable immutable backup/drill unavailable است.

## API و schema

- `fbt.audit-timeline.v1`
- `fbt.audit-event.v1`
- `fbt.receipt-integrity.v1`
- `fbt.execution-proof.v2`
- `fbt.intent-incident.v1`
- `fbt.intent-recovery.v2`

Status عمومی از `/api/intents/v1/public-status` می‌آید و receipt جعلی را live اعلام نمی‌کند.

## Tests

- probe: `test/intent-ai/phase18-observability-proof-probe.mjs`
- assertions: **۱۴/۱۴ موفق**
- موارد: hash chain، seal، rewrite detection، receipt/finality، tamper، why، incident و no-second-transaction recovery.
- اجرا: `npm run test:phase18`
- syntax/import: موفق.

## Configuration

- configured: source proof contract.
- partially configured: process-local audit فقط برای diagnostics/probe.
- not configured: durable immutable store، backup، recovery drill و incident operator.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: durable audit/backup/runtime proof.
- blockerها: `DURABLE_IMMUTABLE_AUDIT_REQUIRED`، `RECEIPT_VERIFIER_REQUIRED`، `BACKUP_DRILL_REQUIRED`.

## Safety Confirmation

- history قابل بازنویسی است؟ **تغییر hash-chain detect و reject می‌شود؛ store durable هنوز فعال نیست**.
- receipt ناقص Completed می‌شود؟ **خیر**.
- reorg/outage/partial تشخیص دارد؟ **بله در contract؛ live detector متصل نیست**.
- recovery transaction دوم ناخواسته می‌سازد؟ **خیر**.
- raw secret در event/receipt است؟ **خیر**.

## تصمیم

ادامهٔ فاز ۱۹ مجاز است؛ تا اتصال durable proof و recovery drill، operational completion ممنوع است.
