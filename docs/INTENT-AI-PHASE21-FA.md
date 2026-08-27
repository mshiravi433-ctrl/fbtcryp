# FBT INTENT AI — فاز ۲۱: Operational Activation و Evidence Verification

تاریخ: ۲۰۲۶-۰۸-۲۶  
مرجع: قوانین غیرقابل‌مذاکره Intent OS و قراردادهای فازهای ۱۰ تا ۲۰

## Source و implementation

- `src/lib/intent-ai/operationalActivation.js`
- `server/intentOperationalEvidence.js`
- اتصال وضعیت: `server/intentPhaseStatus.js`، `GET /api/intents/v1/phase-status`

قرارداد evidence از mock، fixture، env flag و وجود source file جدا است. فقط attestation جاری با `providerId` عمومی، digest عمومی، `checkedAt` و `expiresAt` می‌تواند `verified` شود.

سه mode اولیه بدون mode چهارم حفظ شده‌اند: `HUMAN ↔ AI`، `AI ↔ AI INSIDE FBT`، `FBT AI ↔ EXTERNAL AI AGENT`.

## Provider و integration

اسکنر سرور فقط configuration را به‌صورت `configured-not-verified` گزارش می‌کند. در این checkout هیچ provider واقعی (CA، sandbox، simulator، signer/KMS، RPC policy، backup drill، review مستقل) متصل و verify نشده است. `connectedProviders` خالی می‌ماند.

## Schema و API

- `fbt.operational-evidence.v1`
- `fbt.operational-readiness.v1`
- `fbt.intent-ai-phase21.v1`
- `fbt.intent-ai-phase21-status.v1`

```http
GET /api/intents/v1/phase-status
GET /api/intents/v1/public-status
GET /api/intents/v1/activation
```

Public API فقط status، evidence ID، digest و metadata امن برمی‌گرداند.

## Configuration

Blob registry یا allowlist certifier اگر موجود باشند فقط configuration هستند، نه operational evidence.

## Evidence و verification

Workstreamهای ۱ تا ۱۰ به‌صورت fail-closed verify می‌شوند: registry، CA (expired/revoked/invalid)، sandbox، simulator timeout، monitor stale، scheduler بدون authorization، Smart Wallet بدون Guardian، signer بدون policy، provider/venue/RPC، code-hash و policy mismatch، audit tamper، backup restore، review غیرمستقل، build غیرقابل بازتولید، rollback بدون drill، SLO بدون measurement، و raw credential.

## Operational status

- implementation: implemented (source/test)
- configuration: not-configured یا partially-configured
- verification: unavailable
- operational: unavailable
- live: false
- launchAllowed: false

## تست‌ها و نتیجه

`npm run test:phase21-operational-activation`

## Blockerها

تمام evidenceهای critical فازهای ۱۰ تا ۲۰ و ۲۱.

## Secret/privacy status

هیچ secret واقعی در log، endpoint یا گزارش چاپ نمی‌شود. External Agent حق دریافت seed/private key ندارد.

## تصمیم

ادامهٔ implementation مجاز است. Launch متوقف می‌ماند.

```text
System Active & Verified.
Execution Ready — wallet confirmation remains required.
Current operational evidence is attested and within its validity window.
```
