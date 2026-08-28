# فعّالسازی INTENT OS — مقادیر آمادهٔ کپی برای Vercel

این فایل فقط مقادیری را می‌دهد که یا خودم تولید کردم (امن برای انتشار عمومی)
یا برای تکمیل «دستگاه» لازم‌اند. **هیچ مقدار، کلیدِ خصوصی یا توکنی از پروژهٔ شما
در اینجا نیست مگر آنچه صریحاً «تولید شده برای شما» نوشته شده.**

---

## ۱) متغیرهایی که الان باید در Vercel باشند

در **Vercel → Project → Settings → Environment Variables → New**،
**Environment: Production** را انتخاب کنید و این‌ها را بگذارید:

### الف) مقادیر آماده — می‌توانید همین‌ها را کپی کنید (تولیدشده برای شما)

```bash
# 1) رمز cron — نگه داشتن تازهٔ شواهد (باید ≥۱۶ کاراکتر باشد؛ این یکی ۴۸ است)
CRON_SECRET=627a831324efe357583cf242de3cc3490b1c28729706ab4c

# 2) بازبین مستقل امنیت — کلید عمومی Ed25519 (فقط SPKI عمومی؛ رازی در کار نیست)
INTENT_INDEPENDENT_REVIEWERS=reviewer-1:MCowBQYDK2VwAyEAJY3vKKGrUeKcMEkZHO95SkT55MEWLQDZHZd/jvuZ2AE=
```

> 🔑 کلید **خصوصی**ِ همین بازبین را برایتان جدا ساختم:
> **`/home/user/fbt-reviewer-private.pem`** (خارج از گیت).
> فقط هنگام امضای attestation امنیت لازمش دارید؛ **هرگز در Vercel نگذارید**.

### ب) مقادیری که باید خودتان بسازید (از حساب‌های خودتان)

```bash
# 3) Blob — Vercel → Storage → Blob → Create → اتصال به همین پروژه
#    مقدار باید با vercel_blob_rw_ شروع شود
BLOB_READ_WRITE_TOKEN=<vercel_blob_rw_...>

# 4) RPC — هر endpoint HTTPS اتریوم/اربیتروم (برای شاهد rpc کافی است؛
#    برای تراکنش واقعی از Alchemy/QuickNode خودتان استفاده کنید)
RPC_URL=https://arb1.arbitrum.io/rpc

# 5) WalletConnect — cloud.reown.com → Projects → Project ID (رایگان)
VITE_WALLETCONNECT_PROJECT_ID=<project-id>

# 6) بازبین‌های کاتالوگ — شناسهٔ تلگرام خودتان از @userinfobot
ECOSYSTEM_CERTIFIERS=<TG-ID>:FBT-Ops
```

### ج) اختیاری برای «کامل بودنِ دستگاه» (۲ شاهد drill دیگر)

```bash
# 7) فرماندهٔ incident (در later-phase-probe خوانده می‌شود)
INTENT_INCIDENT_COMMANDER=fbt-ops-1

# 8) مالک پاسخگو (Sustainment Owner)
INTENT_ACCOUNTABLE_OWNER=fbt-ops-1
```

---

## ۲) کدام از ۹ شاهد گم‌شده با کدام متغیر حل می‌شود

| شاهد | با چه چیزی حل می‌شود | بعد از چه‌چیزی ظاهر می‌شود |
|---|---|---|
| `approved-durable-registry` | `BLOB_READ_WRITE_TOKEN` | بوت بعدی (auto-evidence) |
| `durable-immutable-audit` | `BLOB_READ_WRITE_TOKEN` | `/api/intents/v1/self-probe?force=1` |
| `rpc` | `RPC_URL` | بوت بعدی (auto-evidence) |
| `wallet-provider` | `VITE_WALLETCONNECT_PROJECT_ID` | بوت بعدی (auto-evidence) |
| `certificate-authority` | `PUBLIC_ORIGIN` (فقط دامنهٔ سفارشی، وگرنه خودکار) | `/api/intents/v1/self-probe?force=1` |
| `independent-security-review` | `INTENT_INDEPENDENT_REVIEWERS` + امضای Ed25519 | `/api/intents/v1/stage3-review` |
| `venue-health` | — (نیاز به egress سرور، نه متغیر) | `/api/intents/v1/self-probe?force=1` |
| `bridge-provider` | — (نیاز به quote زندهٔ deBridge، نه متغیر) | `/api/intents/v1/stage3-probe?force=1` |
| `slo-measurement` | — (نیاز به ≥۲۰ درخواست واقعی/۲۴ ساعت) | `/api/intents/v1/self-probe?force=1` |

---

## ۳) بعد از گذاشتن متغیرها — چطور مطمئن شویم هیچ‌کدام جا نمانده

یک endpoint جدید برای همین سؤال ساختم؛ **خود سرورِ Vercel به شما می‌گوید چه چیزی
گم است** (فقط بولی، هیچ مقداری لو نمی‌رود):

```bash
curl -s https://YOUR-APP.vercel.app/api/intents/v1/activation-config | python3 -m json.tool
```

- `variables.<NAME>.configured: true/false` → دقیقاً مشخص است کدام متغیر ست شده.
- `requiredForActivation[]` → فهرست kinds که هنوز پوشش ندارند.
- `externalOnly[]` → سه شاهد که با هیچ متغیری حل نمی‌شوند (egress و ترافیک).
- `evidence` → وضعیت فعلی 21/21.

اگر `BLOB_READ_WRITE_TOKEN` ست باشد ولی `configured: false`، یعنی مقدار با
`vercel_blob_rw_` شروع نمی‌شود — از **Vercel → Storage → Blob → Settings → Token**
بگیرید، نه از جای دیگر.

---

## ۴) ترتیب پیشنهادی

1. **شروع:** بگذارید و Redeploy کنید (بعد از Set، در Deployments زدن Redeploy کافی است).
2. **بررسی:** `activation-config` را باز کنید؛ باید `blob=true`، `rpc=true`، `wallet=false←true`، `reviewers=true`، `cron=true` باشد.
3. **شاهدهای خود-پروب:** `self-probe?force=1` → انتظار: `certificate-authority` و `durable-immutable-audit` اضافه شوند؛ `venue-health` از egress؛ `slo-measurement` بعد از چند دقیقه ترافیک واقعی.
4. **شاهد بریج:** `stage3-probe?force=1` → `bridge-provider` اگر quote زنده برسد.
5. **امضای امنیت مستقل:** digest را از `stage3-review-package` بگیرید، با
   `/home/user/fbt-reviewer-private.pem` امضا کنید و به `stage3-review` بفرستید
   (دستور دقیق در `docs/VERCEL-ACTIVATION-STEP-BY-STEP-FA.md` گام ۵).
6. **اسمبل نهایی:** `npm run activate:release -- --target https://YOUR-APP.vercel.app --env`
   → مقدار `INTENT_OPERATIONAL_EVIDENCE` را در Vercel بگذارید (یا `--submit` بزنید).
7. **تأیید:** `phase-status` → `launchAllowed:true`، `evidence:"21/21"`، `phaseCount:91`.

---

## ۵) چیزهایی که نباید بگذارید (فعلاً)

| متغیر | دلیل |
|---|---|
| `INTENT_SECRET_MANAGER_PROVIDER` / `KEY_REF` | نیاز به KMS معتبر — ثبت آن‌ها بدون provider واقعی فقط وضعیت را دروغ می‌کند |
| `INTENT_COORDINATOR_PRIVATE_KEY` | کلید خصوصی — در Vercel هرگز؛ فقط در محیط امن deploy |
| `VITE_INTENT_BROADCAST_ENABLED` | قبل از تست testnet روشن نکنید؛ «فعال» یعنی زیرساخت آماده، نه ارسال خودکار وجوه |
