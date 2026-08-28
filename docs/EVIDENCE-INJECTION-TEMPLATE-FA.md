# FBT INTENT AI — قالب تزریق شواهد عملیاتی

تاریخ: ۲۰۲۶-۰۸-۲۶

> ✅ **چهار شاهد از این ۲۱ تا را لازم نیست دستی پر کنید.**
> `certificate-authority`، `venue-health`، `slo-measurement` و
> `durable-immutable-audit` با اندازه‌گیری واقعی به دست می‌آیند:
> `npm run evidence:collect -- --target https://YOUR-APP.vercel.app`
> راهنمای گام‌به‌گام: [`docs/EVIDENCE-EARN-4-FA.md`](./EVIDENCE-EARN-4-FA.md)

## ⚠️ هشدار مهم

هر شاهد باید از یک **provider واقعی** به دست آمده باشد. این فایل فقط **قالب**
نشان می‌دهد. digest ها، providerId ها و timestamps باید از **verification واقعی**
بیایند.

## دستور تزریق

```bash
curl -X POST https://YOUR-APP.vercel.app/api/intents/v1/operator-evidence \
  -H "Content-Type: application/json" \
  -H "X-Operator-1: YOUR_OPERATOR_ID_1" \
  -H "X-Operator-2: YOUR_OPERATOR_ID_2" \
  -d @evidence.json
```

## قالب هر شاهد

```json
{
  "kind": "wallet-provider",
  "providerId": "walletconnect-adapter",
  "digest": "SHA256_HEX_64_CHARS_FROM_REAL_VERIFICATION",
  "checkedAt": 1724688000000,
  "expiresAt": 1724706000000,
  "status": "verified",
  "health": "healthy",
  "attested": true
}
```

## ۲۱ شاهد مورد نیاز

### فایل evidence.json (قالب — مقادیر واقعی را جایگزین کنید):

```json
{
  "evidence": [
    {
      "kind": "approved-durable-registry",
      "providerId": "vercel-blob-registry",
      "digest": "REPLACE_WITH_REAL_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "certificate-authority",
      "providerId": "lets-encrypt",
      "digest": "REPLACE_WITH_CERT_FINGERPRINT_SHA256",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_CERT_EXPIRY_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "sandbox-operator",
      "providerId": "gvisor-sandbox",
      "digest": "REPLACE_WITH_SANDBOX_ATTESTATION_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "simulator",
      "providerId": "local-simulator",
      "digest": "REPLACE_WITH_SIM_RESULT_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "monitor",
      "providerId": "system-monitor",
      "digest": "REPLACE_WITH_MONITOR_HEARTBEAT_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "scheduler-operator",
      "providerId": "intent-scheduler",
      "digest": "REPLACE_WITH_SCHEDULER_AUTH_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "smart-wallet",
      "providerId": "safe-wallet",
      "digest": "REPLACE_WITH_WALLET_ATTESTATION_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "independent-guardian",
      "providerId": "guardian-service",
      "digest": "REPLACE_WITH_GUARDIAN_ATTESTATION_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "production-signer",
      "providerId": "policy-bound-signer",
      "digest": "REPLACE_WITH_SIGNER_POLICY_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "wallet-provider",
      "providerId": "walletconnect-adapter",
      "digest": "REPLACE_WITH_WALLETCONNECT_HEALTH_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "broker-provider",
      "providerId": "broker-handle",
      "digest": "REPLACE_WITH_BROKER_HEALTH_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "bridge-provider",
      "providerId": "lifi-bridge",
      "digest": "REPLACE_WITH_BRIDGE_QUOTE_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "venue-health",
      "providerId": "binance",
      "digest": "REPLACE_WITH_VENUE_HEALTH_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "rpc",
      "providerId": "alchemy-arbitrum",
      "digest": "REPLACE_WITH_RPC_HEALTH_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "policy-contract",
      "providerId": "workflow-batch-contract",
      "digest": "REPLACE_WITH_CONTRACT_CODE_HASH",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "durable-immutable-audit",
      "providerId": "blob-audit-log",
      "digest": "REPLACE_WITH_AUDIT_ROOT_HASH",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "backup-restore-drill",
      "providerId": "backup-system",
      "digest": "REPLACE_WITH_BACKUP_VERIFICATION_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "independent-security-review",
      "providerId": "audit-firm",
      "digest": "REPLACE_WITH_REVIEW_SIGNED_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "reproducible-deployment",
      "providerId": "ci-build",
      "digest": "REPLACE_WITH_BUILD_HASH",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "rollback-drill",
      "providerId": "rollback-system",
      "digest": "REPLACE_WITH_ROLLBACK_VERIFICATION_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    },
    {
      "kind": "slo-measurement",
      "providerId": "slo-meter",
      "digest": "REPLACE_WITH_SLO_MEASUREMENT_DIGEST",
      "checkedAt": "REPLACE_WITH_TIMESTAMP_MS",
      "expiresAt": "REPLACE_WITH_FUTURE_TIMESTAMP_MS",
      "status": "verified",
      "health": "healthy",
      "attested": true
    }
  ]
}
```

## قوانین

- `digest` باید sha256 hex ۶۴ کاراکتر باشد — از verification واقعی provider
- `checkedAt` و `expiresAt` باید millisecond timestamps واقعی باشند
- `expiresAt` باید در آینده باشد
- هیچ secret/private key/seed phrase در payload نباشد
- `providerId` باید public identifier باشد

## تأیید

```bash
curl https://YOUR-APP.vercel.app/api/intents/v1/evidence-status | jq
# باید: storedCount: 21, missingCount: 0
```
