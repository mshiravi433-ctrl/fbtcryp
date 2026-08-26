# FBT INTENT AI — فاز ۱۷: On-Chain Policy Enforcement

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی ۶۳بخشی محصول

## وضعیت صادقانه

Contract برای deployment evidence، خواندن policy آن‌چین، version/migration و revoke provider-level اضافه شده است؛ قرارداد/Smart Account deployment و RPC proof واقعی در محیط فعلی configured نیست. فاز **implementation partial / operational unavailable** است.

## Implementation

فایل: `src/lib/intent-ai/onchainPolicy.js`

- deployment فقط با chain، address، code hash و provider evidence معتبر پذیرفته می‌شود؛
- localStorage یا local policy authoritative نیست؛
- version، limits و allowlist آن‌چین با local policy مقایسه می‌شوند و mismatch fail-closed است؛
- chain/protocol/fee و تمام limitها دوباره بررسی می‌شوند؛
- migration فقط با provider-confirmed result؛
- revoke فقط با provider/Smart Account receipt؛
- نبود deployment/RPC/policy خوانا `unavailable` است.

## API و schema

- `fbt.smart-account-policy.v1`
- `fbt.policy-deployment-evidence.v1`
- `fbt.onchain-policy-evaluation.v1`
- `fbt.policy-migration.v1`
- `fbt.onchain-session-revoke.v1`

Status فقط از endpointهای read-only فازها گزارش می‌شود؛ هیچ deployment یا policy write از UI صادر نمی‌شود.

## Tests

- probe: `test/intent-ai/phase17-onchain-policy-probe.mjs`
- assertions: **۱۲/۱۲ موفق**
- موارد: نبود evidence، provider verification، code hash، mismatch، limit، migration و revoke.
- اجرا: `npm run test:phase17`
- syntax/import: موفق.

## Configuration

- configured: source contract و verification seam.
- partially configured: fake provider فقط برای probe.
- not configured: Smart Account deployment، policy contract، RPC proof و on-chain revoke.

## Operational Status

- implemented: **true در source/test**.
- ready: **false**.
- live: **false**.
- unavailable: contract/deployment/RPC evidence.
- blockerها: `DEPLOYED_SMART_ACCOUNT_REQUIRED`، `POLICY_CONTRACT_REQUIRED`، `RPC_PROOF_REQUIRED`، `ONCHAIN_REVOKE_REQUIRED`.

## Safety Confirmation

- client یا wallet دیگر می‌تواند local policy را bypass کند؟ **این boundary local/on-chain mismatch را block می‌کند؛ deployment لازم است**.
- revoke فقط local است؟ **خیر؛ provider receipt لازم است**.
- نبود contract/deployment verified است؟ **خیر؛ unavailable**.
- fee/chain/protocol خالی مجاز است؟ **خیر**.
- execution بدون user/Guardian/adapter ممکن است؟ **خیر**.

## تصمیم

ادامهٔ فاز ۱۸ مجاز است، اما ادعای on-chain enforcement یا verified deployment تا evidence واقعی ممنوع است.
