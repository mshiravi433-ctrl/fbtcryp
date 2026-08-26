# نقشهٔ راه FBT Intent AI — فازهای ۸ تا ۲۰

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع نسخه: `main` / PR #86 / commit `a3c685a`

## قانون وضعیت

فازهای ۱ تا ۷ Intent AI در `main` پیاده و منتشر شده‌اند. این سند ادامهٔ roadmap
را تعریف می‌کند؛ **تعریف یک فاز به معنی انجام‌شدن آن نیست**. هر فاز فقط وقتی
کامل اعلام می‌شود که کد، تست، integration واقعی و گزارش fail-closed آن موجود
باشد.

فاز ۸ در همین مرحله اجرا شد، اما چون provider واقعی Secret Manager هنوز در
environment نصب و attested نشده، وضعیت آن دو لایه دارد:

```text
implementation: implemented
operational: partial
```

## جدول فازهای ۸ تا ۲۰

| فاز | عنوان | خروجی اصلی | معیار پذیرش | وضعیت فعلی |
|---:|---|---|---|---|
| ۸ | فعال‌سازی تولید و مرز Secret Manager | activation report عمومی، provider boundary، handle scope و secret hygiene | بدون secret leak؛ provider فقط با health + durable + attestation سبز شود | **انجام‌شده از نظر کد / partial در runtime** |
| ۹ | اجرای bridge با fail-closed | adapter واقعی برای یک مسیر bridge انتخاب‌شده، preflight، monitor، reconcile و refund policy | quote بدون execution باقی بماند؛ no-sign روی خطا؛ تست mainnet-like با signer کاربر | Roadmap |
| ۱۰ | Broker/CEX scoped adapter | broker handle، sub-account، idempotency، policy جدا برای withdrawal | هیچ master credential به agent نرسد؛ withdrawal پیش‌فرض ممنوع | Roadmap |
| ۱۱ | چرخهٔ عمر dYdX | اتصال، expiry، reconnect، revoke و recovery session در UI | session stale/unavailable هرگز success نشود؛ secrets فقط سمت provider | Roadmap |
| ۱۲ | Cross-chain atomicity واقعی | escrow/state machine آن‌چین حسابرسی‌شده، timeout، refund و replay protection | atomicity فقط بعد از اثبات قرارداد؛ در غیر این صورت draft-only | Roadmap |
| ۱۳ | اپراتور مستقل | attestation زمان‌دار، registry binding، rotation اپراتور و گزارش audit بیرونی | key control از organizational independence جدا گزارش شود | Roadmap |
| ۱۴ | Rotation و anchor خارجی | rotation دوامضاشدهٔ Coordinator و Merkle root anchor واقعی | historical receipts معتبر بمانند؛ anchor هرگز completeness/settlement جعلی نگوید | Roadmap |
| ۱۵ | Bond و settlement enforcement | escrow یا enforcement قابل‌حسابرسی برای bond، claim، dispute و settlement | جریمه فقط از evidence قابل‌بازمحاسبه؛ FBT بدون مجوز وجوه را نگه ندارد | Roadmap |
| ۱۶ | Confidential compute عملیاتی | commit–reveal بسته، threshold release، KMS و در صورت امکان TEE attestation | metadata/privacy فقط با proof واقعی؛ ادعای hide-from-FBT بدون proof ممنوع | Roadmap |
| ۱۷ | Policy آن‌چین و Smart Account | enforce کردن سقف‌ها، مقصد، protocol و emergency stop خارج از localStorage | دورزدن policy با wallet دیگر صادقانه گزارش شود؛ no fake enforcement | Roadmap |
| ۱۸ | Reliability و disaster recovery | queue/idempotency، observability، replay-safe recovery، backup/restore و incident runbook | partial/reorg/outage قابل تشخیص؛ receipt تاریخی بازنویسی نشود | Roadmap |
| ۱۹ | Security و compliance review | threat model نهایی، penetration test، privacy review، key ceremony و release gate | blocker بحرانی صفر؛ گزارش مستقل قابل انتشار | Roadmap |
| ۲۰ | Launch و governance عمومی | versioned protocol، migration، public verifier، SLO، change control و post-launch monitoring | deployment قابل بازتولید و status عمومی بدون ادعای ساختگی | Roadmap |

## ترتیب اجرایی پیشنهادی

```text
۸ Secret Boundary
  → ۹ Bridge
  → ۱۰ Broker
  → ۱۱ dYdX Session
  → ۱۲ Cross-chain Escrow
  → ۱۳ Operator Independence
  → ۱۴ Rotation / Anchor
  → ۱۵ Bond Enforcement
  → ۱۶ Confidential Compute
  → ۱۷ On-chain Policy
  → ۱۸ Reliability
  → ۱۹ Security Review
  → ۲۰ Launch Governance
```

ترتیب بالا عمداً از «مرز credential و فعال‌سازی» شروع می‌شود و قبل از custody،
atomicity یا confidential claim به audit و proof می‌رسد. اضافه‌کردن UI یا env به
تنهایی فازهای ۹ تا ۲۰ را سبز نمی‌کند.

## مرزهای غیرقابل‌مذاکره در همهٔ فازها

- Guardian، Risk و Confirmation Gate قابل خاموش‌کردن نیستند.
- هیچ Agent یا API key اختیار برداشت یا اجرای بدون امضای کاربر ندارد.
- raw private key، seed، mnemonic، password و broker master credential به agent
  یا frontend داده نمی‌شود.
- `configured` فقط با configuration واقعی و `operational` فقط با health/proof
  واقعی `true` می‌شود.
- partial، pending، outage، reorg و unavailable هرگز به `COMPLETED` تبدیل
  نمی‌شوند.
- هیچ سود، استقلال سازمانی، confidentiality، atomicity یا settlement بدون
  evidence قابل‌بازمحاسبه ادعا نمی‌شود.

## endpoint مرجع

برای وضعیت واقعی runtime از این endpoint استفاده شود، نه از این سند:

```http
GET /api/intents/v1/activation
GET /api/intents/v1/capabilities
```

## وضعیت این commit

- فازهای ۱ تا ۷: تکمیل‌شده در سطح product scope؛
- فاز ۸: کد boundary، گزارش activation، API، UI و probe اضافه شد؛
- فازهای ۹ تا ۲۰: فقط تعریف‌شده و هنوز انجام‌شده اعلام نشده‌اند.
