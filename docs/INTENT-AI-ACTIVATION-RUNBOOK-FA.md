# FBT INTENT AI — Runbook فعال‌سازی عملیاتی

تاریخ: ۲۰۰۲۶-۰۸-۲۶

## پیش‌نیازها

- Node.js ≥ 18
- npm install انجام شده
- دسترسی به Vercel dashboard
- دسترسی به Alchemy/QuickNode
- کیف پول testnet با gas

## موج ۰ — Configuration

### Agent (تکمیل‌شده)
- [x] چک‌اسکریپت `scripts/validate-activation-env.mjs`
- [x] نمایش وضعیت env در phase-status
- [x] probe موج ۰

### Operator (دستی)

1. **BLOB_READ_WRITE_TOKEN:**
   - Vercel Dashboard → Storage → Blob → Create
   - توکن را در Vercel Environment Variables اضافه کنید
   - Scope: Production + Preview
   ```
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
   ```

2. **ECOSYSTEM_CERTIFIERS:**
   - از @userinfobot در تلگرام، userId خود را بگیرید
   - فرمت: `telegramUserId:Label`
   ```
   ECOSYSTEM_CERTIFIERS=123456789:FBT Review Team
   ```

3. **تأیید:**
   ```bash
   node scripts/validate-activation-env.mjs
   ```
   باید `BLOB_READ_WRITE_TOKEN: ✓ configured` و `ECOSYSTEM_CERTIFIERS: ✓ configured` ببینید.

## موج ۱ — زیرساخت زنجیره

### Operator (دستی)

1. **RPC endpoint:**
   - Alchemy: یک اپ برای Arbitrum Sepolia (chainId 421614) بسازید
   - RPC URL را یادداشت کنید

2. **فاست testnet:**
   - از https://faucets.chain.link یا faucet Arbitrum Sepolia
   - 0.1 ETH testnet به deployer wallet ارسال کنید

3. **Deploy:**
   ```bash
   # اول Arbitrum Sepolia
   DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... CHAIN_ID=421614 \
     node scripts/deploy-all.mjs
   ```
   خروجی سه env:
   ```
   INTENT_WORKFLOW_BATCH_ADDRESS=0x...
   INTENT_MERKLE_ANCHOR_NETWORKS=[...]
   INTENT_ANCHOR_NETWORKS=[...]
   ```

4. **Smart Wallet + Session Key:**
   - Safe wallet روی testnet
   - Session key scoped ایجاد کنید

5. **CEX کلید فقط-trade:**
   - فقط دسترسی trade، نه withdrawal

## موج ۲ — عملیات و اثبات‌پذیری

### Agent (تکمیل‌شده)
- [x] سرویس simulator
- [x] Monitor heartbeat
- [x] Scheduler با signs:false
- [x] Audit append-only روی Blob
- [x] Backup/restore drill harness
- [x] Reproducible build
- [x] SLO metering

### Operator
- مقصد backup تأیید
- اجرای drill ها تأیید

## موج ۳ — شخص ثالث

### Agent (تکمیل‌شده)
- [x] بستهٔ RFP برای CA/PKI
- [x] Sandbox operator template
- [x] Security review template
- [x] مسیر ورود نتایج

### Operator
- خرید CA/PKI از provider معتبر
- تأیید sandbox
- سفارش security review مستقل

## موج ۴ — Unfreeze

### Agent (تکمیل‌شده)
- [x] POST /api/intents/v1/operator-evidence
- [x] Cron تمدید freshness
- [x] فرمان unfreeze
- [x] Dashboard بلوکرهای عمومی
- [x] ذخیرهٔ خودکار شواهد در Blob (`intent-evidence/v1/operator-evidence.json`)
      و بازیابی در cold start — `npm run test:durable-evidence`
- [x] اسمبلر one-command: `npm run activate:release -- --target https://YOUR-APP.vercel.app
      --external operator-evidence.json --env [--submit --op1 A --op2 B]`
      (همهٔ ۲۱ رکورد را جمع، اعتبارسنجی و در یک مقدار INTENT_OPERATIONAL_EVIDENCE
      ادغام می‌کند؛ هیچ digest ای را جعل نمی‌کند؛ خروجی ۰ فقط با ۲۱/۲۱)

### Operator
- تزریق شواهد واقعی از طریق operator-evidence یا `npm run activate:release`
- صدور فرمان unfreeze با تأیید دو اپراتور

## معیار موفقیت نهایی

- `GET /api/intents/v1/phase-status`:
  - `launchAllowed: true` و `evidence.status: "21/21"` (سند Reviewed)
  - `specificationImplementedThrough: 100` و `phaseCount: 91` (فازهای ۱۰–۱۰۰)
  - `blockers: []` در دروازهٔ release؛ «زنده» فقط در فازهایی که verdict خودشان را دارند
  - فازهای محصول (۱۱–۲۰ و ۵۱–۱۰۰) و فاز ۲۱ `operational/live: true`
  - فازهای کنترل/تحقیق ۲۲–۵۰ طبق ارزیاب خودشان منتشر می‌شوند — هیچ ردی `live` با
    blocker حل‌نشده ندارد
- صفحهٔ «وضعیت فعال‌سازی» (Settings → Intent AI Activation) ۹۱/۹۱ پیاده‌سازی و تعداد
  فازهای live را نمایش می‌دهد؛ `workspace` نوار وضعیت پنهان‌کاری نمی‌کند
- شواهد تزریق‌شده در Blob ذخیره و در cold start برمی‌گردند
  (`intent-evidence/v1/operator-evidence.json`) — «سیو کشی» شواهد بخشی از موفقیت است
- `npm run test:spec65` و کل سوئیت probe سبز
- `vite build` سبز
