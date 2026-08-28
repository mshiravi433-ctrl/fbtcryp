# FBT INTENT AI — digest ارائه‌دهندگان خارجی

تاریخ: ۲۰۲۶-۰۸-۲۸

این فرآیند ارائه‌دهندهٔ شخص‌ثالث را جعل نمی‌کند. هر ردیف غایب یک کد واقعی است.

## مسیر زنده

```
GET /api/intents/v1/external-providers
```

از CLI:

```bash
npm run ops:external-providers
npm run ops:external-providers -- --require-all --out docs/external-provider-digest.json --md docs/EXTERNAL-PROVIDER-DIGEST-FA.md
```

Schema: `fbt.external-provider-digest.v1`.
`selfIssuedReview` همیشه `false` است.
`--require-all` تا وقتی حتی یکی غایب باشد با کد خروج ۱ تمام می‌شود.

## کاتالوگ

| ارائه‌دهنده | چه چیزی لازم است | کد غایب |
|-------------|------------------|---------|
| `independent-security-review` | intake امضای Ed25519 از allowlist — هرگز خودگواهی نمی‌شود | `SECURITY_REVIEW_NOT_INDEPENDENT` |
| `workforce-sso` | IdP SSO + MFA | `WORKFORCE_SSO_UNATTESTED` |
| `regulatory-counsel` | filing + counsel مستقل | `INDEPENDENT_COUNSEL_REQUIRED` |
| `ca-pki` | CA/PKI داخلی فراتر از TLS عمومی | `CA_BEYOND_TLS_MISSING` |
| `browser-wallet-e2e` | کیف پول مرورگر متصل | `BROWSER_WALLET_REQUIRED` |
| `secondary-region` | منطقهٔ failover گواهی‌شده | `SECONDARY_REGION_UNREADY` |
| `model-attestation` | digest امضاشدهٔ مدل/پرامپت | `MODEL_ATTESTATION_MISSING` |
| `capital-escrow` | escrow شخص‌ثالث گواهی‌شده | `BOND_ESCROW_UNATTESTED` |
| `aws-kms` | AWS KMS `GetPublicKey` | `KMS_NOT_BOUND` |

`aws-kms` فقط وقتی `present:true` است که `productionSignerStatus().providerId === 'aws-kms'`.
`independent-security-review` فقط وقتی حاضر است که intake مرحلهٔ ۳ واقعاً کسب شده باشد.

## قوانین

- این فرآیند هیچ ردیف `present:true` جعل نمی‌کند.
- `--require-all` برای اثبات صداقت است، نه برای سبز کردن برد.
- هیچ kind جدیدی به برد ۲۱/۲۱ اضافه نمی‌شود.
