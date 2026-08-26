# نقشهٔ راه FBT Intent AI — فازهای ۸ تا ۲۰

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع نسخه: branch `arena/01a03e13-fbtcryp` / PR #87 / Phase 8 commit `0b11a40`

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
| ۹ | هستهٔ Intent OS | سه mode رسمی، جداسازی permission تحلیل/اجرا، دو Agent داخلی، capability discovery، target reality، challenge/council و authorization UX | mode چهارم وجود نداشته باشد؛ score بدون evidence سبز نشود؛ execution فقط بعد از صفحهٔ تأیید | **در حال پیاده‌سازی؛ partial** |
| ۱۰ | marketplace و trust برای Agentها | capability passport، security، sandbox، reputation و انتخاب اختیاری capability | external Agent بدون verification/scope وارد نشود؛ decline باعث safe replan شود | **پیاده‌سازی قراردادها / partial در runtime** |
| ۱۱ | تولید و رقابت strategy | generation، competition، route simulation، switching و monitoring | proposal با evidence/risk قابل‌توضیح؛ سود هرگز تضمین نشود | Roadmap |
| ۱۲ | Smart Wallet و Guardian policy | scoped permissions، هفت limit، fee transparency، risk Guardian، pause/kill/emergency/exit | همهٔ limitها fail-closed؛ هیچ شخصیت یا Agentی Guardian را دور نزند | Roadmap |
| ۱۳ | live و recurring intents | live/recurring intent، monitoring، exit policy، timeline و final result | pending/partial/unavailable هرگز Completed نشود | Roadmap |
| ۱۴ | Intent Genome و local-first memory | DNA matching، evolution، structured memory و offline learning pipeline | memory secret ذخیره نکند؛ learning بدون opt-in upload نشود | Roadmap |
| ۱۵ | External Agent runtime | passport، scoped session key، expiration، disconnect و sandbox اجرایی | seed/private key/master password هرگز به external Agent داده نشود | Roadmap |
| ۱۶ | activation آداپترهای execution | wallet/broker/bridge، venue proof و recovery | نبود provider یا evidence success محسوب نشود؛ no-sign روی خطا | Roadmap |
| ۱۷ | enforcement آن‌چین | Smart Account policy، protocol/chain/fee limits و revoke خارج از localStorage | دورزدن policy با wallet دیگر به‌صورت honest گزارش شود | Roadmap |
| ۱۸ | observability و proof | audit timeline، why engine، receipt integrity، incident recovery و disaster resilience | history بازنویسی نشود؛ partial/reorg/outage قابل تشخیص باشد | Roadmap |
| ۱۹ | security/privacy/compliance | threat model، privacy، confidential runtime، independent review و compliance | blocker بحرانی صفر و گزارش مستقل قابل انتشار باشد | Roadmap |
| ۲۰ | launch و governance | public verification، versioning، migration، SLO و change control | deployment بازتولیدپذیر و status عمومی بدون ادعای ساختگی | Roadmap |

## مرجع authoritative specification

این جدول اکنون grouping اجرایی specification رسمی ۶۳بخشی است؛ roadmap قدیمی bridge/broker به‌عنوان source of truth ادامهٔ محصول استفاده نمی‌شود. endpoint activation برای compatibility آرایهٔ قدیمی را نیز نگه می‌دارد، اما `specificationRoadmap` و فیلد `intentOS` وضعیت جدید را گزارش می‌کنند. برای Phase 9 و Phase 10 فقط وضعیت `partial` معتبر است و نبود provider، attestation، registry یا runtime evidence هرگز با env یا label به `ready` تبدیل نمی‌شود.

## ترتیب اجرایی پیشنهادی

```text
۸ Secret Boundary
  → ۹ Intent OS Foundation
  → ۱۰ Agent Marketplace / Trust
  → ۱۱ Strategy Competition / Simulation
  → ۱۲ Smart Wallet / Guardian Policy
  → ۱۳ Live / Recurring Intents
  → ۱۴ Intent Genome / Memory
  → ۱۵ External Agent Runtime
  → ۱۶ Execution Adapter Activation
  → ۱۷ On-chain Policy Enforcement
  → ۱۸ Observability / Proof
  → ۱۹ Security / Privacy / Compliance
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
- فاز ۹: هستهٔ Intent OS، contracts، UI و probe پیاده شده اما به‌دلیل نبود runtime provider و trust plane کامل، **partial** است؛
- فاز ۱۰: trust-plane contracts، approved-catalog discovery، UI status، scope boundary و probe پیاده شده‌اند، اما به‌دلیل نبود registry/certificate-authority/sandbox/provider واقعی **partial** است؛ جزئیات authoritative در `INTENT-AI-PHASE10-FA.md` است؛
- فازهای ۱۱ تا ۲۰: هنوز انجام‌شده اعلام نشده‌اند.
