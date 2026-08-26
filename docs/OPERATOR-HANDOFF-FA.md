# FBT INTENT AI — راهنمای کامل اپراتور برای لایو کردن

تاریخ: ۲۰۲۶-۰۸-۲۶

## خلاصه سریع

۷ مرحله تا لایو شدن. هر مرحله حدود ۵-۳۰ دقیقه.

---

## مرحله ۱ — Vercel Blob Token (۵ دقیقه)

1. بروید به [vercel.com/dashboard](https://vercel.com/dashboard)
2. پروژه `fbtcryp` را انتخاب کنید
3. **Storage** → **Blob** → **Create**
4. نام: `fbt-activation`
5. توکن را کپی کنید

### متغیر Vercel:
```
BLOB_READ_WRITE_TOKEN = vercel_blob_rw_...
```

### تأیید:
```bash
node scripts/validate-activation-env.mjs
# باید: BLOB_READ_WRITE_TOKEN: ✓ configured
```

---

## مرحله ۲ — Telegram User ID (۲ دقیقه)

1. تلگرام را باز کنید
2. جستجو: `@userinfobot`
3. `/start` بزنید
4. عدد ID را کپی کنید (مثلاً: `123456789`)

### متغیر Vercel:
```
ECOSYSTEM_CERTIFIERS = 123456789:YourName
```

### تأیید:
```bash
node scripts/validate-activation-env.mjs
# باید: ECOSYSTEM_CERTIFIERS: ✓ configured
# ✓ Wave 0 complete
```

---

## مرحله ۳ — RPC + Testnet Gas (۱۰ دقیقه)

### الف) حساب Alchemy:
1. [alchemy.com](https://www.alchemy.com/) → Sign Up
2. Create App → **Arbitrum Sepolia**
3. HTTPS URL را کپی کنید

### ب) Testnet Gas:
1. کیف پول MetaMask را باز کنید
2. Network: **Arbitrum Sepolia** (اگر نیست اضافه کنید)
3. آدرس کیف پول را کپی کنید
4. بروید به [faucets.chain.link/arbitrum-sepolia](https://faucets.chain.link/arbitrum-sepolia)
5. 0.1 ETH testnet دریافت کنید

### متغیر محلی (هرگز Vercel — فقط deploy):
```bash
export RPC_URL=https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY
export CHAIN_ID=421614
export DEPLOYER_PRIVATE_KEY=0x...
```

---

## مرحله ۴ — Deploy Contracts (۵ دقیقه)

```bash
node scripts/deploy-all.mjs
```

خروجی (مثال):
```
INTENT_WORKFLOW_BATCH_ADDRESS=0x1234...
INTENT_MERKLE_ANCHOR_ADDRESS=0x5678...
INTENT_ANCHOR_ADDRESS=0x9abc...
INTENT_FEE_ROUTER_ADDRESS=0xdef0...

INTENT_MERKLE_ANCHOR_NETWORKS=[{"chainId":421614,...}]
INTENT_ANCHOR_NETWORKS=[{"chainId":421614,...}]
```

### متغیرهای Vercel (همه آدرس‌ها):
```
INTENT_WORKFLOW_BATCH_ADDRESS=0x...
INTENT_MERKLE_ANCHOR_NETWORKS=[...]
INTENT_ANCHOR_NETWORKS=[...]
```

---

## مرحله ۵ — Safe Wallet + CEX (۱۵ دقیقه)

### الف) Safe Wallet:
1. [safe.wallet](https://safe.wallet/) → Create Safe
2. Network: **Arbitrum Sepolia**
3. 1-of-1 Safe بسازید
4. آدرس Safe را یادداشت کنید

### ب) CEX API Key:
1. Binance/Coinbase → API Management
2. Create API Key
3. **فقط Trade permission** — هرگز Withdrawal
4. API Key + Secret را secure نگه دارید

---

## مرحله ۶ — تزریق شواهد (۲۰ دقیقه)

### اسکریپت تزریق:
```bash
node scripts/inject-evidence.mjs
```

این اسکریپت ۲۱ شاهد عملیاتی را به صورت خودکار از سرویس‌های محلی
(شبیه‌ساز، مانیتور، scheduler، drill ها) جمع‌آوری و تزریق می‌کند.

### یا دستی:
```bash
curl -X POST https://YOUR-APP.vercel.app/api/intents/v1/operator-evidence \
  -H "Content-Type: application/json" \
  -H "X-Operator-1: operator-alpha" \
  -H "X-Operator-2: operator-beta" \
  -d @evidence.json
```

---

## مرحله ۷ — Unfreeze (۲ دقیقه)

```bash
curl -X POST https://YOUR-APP.vercel.app/api/intents/v1/unfreeze \
  -H "Content-Type: application/json" \
  -H "X-Operator-1: operator-alpha" \
  -H "X-Operator-2: operator-beta" \
  -d '{"reason": "All 21 evidence kinds verified and operational readiness confirmed"}'
```

### تأیید نهایی:
```bash
curl https://YOUR-APP.vercel.app/api/intents/v1/phase-status | jq '.launchAllowed'
# باید: true
```

---

## خلاصه متغیرهای Vercel

| # | Variable | Value | مرحله |
|---|----------|-------|--------|
| 1 | `BLOB_READ_WRITE_TOKEN` | `vercel_blob_rw_...` | ۱ |
| 2 | `ECOSYSTEM_CERTIFIERS` | `123456789:YourName` | ۲ |
| 3 | `INTENT_WORKFLOW_BATCH_ADDRESS` | `0x...` | ۴ |
| 4 | `INTENT_MERKLE_ANCHOR_NETWORKS` | `[...]` | ۴ |
| 5 | `INTENT_ANCHOR_NETWORKS` | `[...]` | ۴ |

---

## هرگز نکنید

- ❌ `DEPLOYER_PRIVATE_KEY` در Vercel set نکنید
- ❌ Seed phrase / mnemonic هیچ‌جا
- ❌ API key با withdrawal permission
- ❌ شاهد ساختگی یا mock

---

## Merge به Main

بعد از تأیید `launchAllowed: true`:

```bash
git checkout main
git merge arena/01a03f80-fbtcryp
git push origin main
```

بنر LaunchStatusStrip خودکار برداشته می‌شود.
