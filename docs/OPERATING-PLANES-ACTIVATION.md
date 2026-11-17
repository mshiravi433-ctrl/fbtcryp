# راهنمای فعال‌سازی فازهای عملیاتی — Operating Planes Activation

> **این سند یک دستورالعمل عملیاتی است.** هر متغیری که اینجا نام برده می‌شود، یک
> نام سرویس یا نقش است — **نه کلید و نه رمز**. هیچ‌کدام از این متغیرها به‌تنهایی
> یک فاز را «جعلاً» زنده نمی‌کند؛ فقط وقتی که فاز واقعاً بتواند کارش را بکند،
> درجه‌بندی راست، زنده می‌شود.

---

## ۱) چه چیزی زنده است و چه چیزی نیست

وضعیت فازها **اندازه‌گیری** می‌شود، نه اینکه خودش را تأیید کند.

| لایه | چطور سنجیده می‌شود |
|---|---|
| **۳۰ پرتابل کنترلی (۲۱–۵۰)** | هر پرتابل سنجهٔ خودش را دارد: اجرای مش، هش، SBOM، git، اندازه‌گیری هزینه. نتیجهٔ اجرا = واقعی. |
| **۱۶۵ قوس محصول (۱–۱۶۵)** | هر قوس روی **پراب اختصاصی خودش** سنجیده می‌شود، نه به‌عنوان پیامد فازهای کنترلی. |
| **۲۰۶ فاز مشخصات (۱۰–۲۱۶)** | هر فاز وضعیت مستقل خودش را دارد: `live` یا `blocked` با کد blocker واقعی. |

### سه قانونی که این را صادق نگه می‌دارد

1. **اندازه‌گیری بر ادعا مقدم است.** اگر چیزی در همین پروسه قابل اندازه‌گیری
   باشد، نتیجهٔ اندازه‌گیری جای ادعا را می‌گیرد — حتی اگر ادعا «مثبت‌تر» باشد.
2. **پرتابل اندازه‌گیری‌نشده فقط از بستهٔ اپراتور ارث می‌برد.** بستهٔ داخلی
   (خودتأییدکننده) هرگز نمی‌تواند جای یک سنجش را بگیرد. منبع بسته باید
   دقیقاً `operator-attestation-endpoint` باشد.
3. **`operational` همیشه یک boolean است و همیشه برابر `live`.** رشتهٔ
   `'unavailable'` دیگر وجود ندارد — همین رشته قبلاً ۱۱ ردیف را می‌شکست.

### «نامعلوم» در برابر «ادعای منفی»

این تفاوت ظریف اما حیاتی است، و بیشترین خطاها از همین‌جا آمده‌اند:

* **اندازه‌گیری مثبت** (`isolated: true`) ⇒ جای ادعا را می‌گیرد.
* **اندازه‌گیری منفی** (چیزی امتحان شد و نبود) ⇒ جای ادعا را می‌گیرد.
* **نبودِ دانش** (`review: null` برای بازبینی مستقلِ امنیتی) ⇒ ادعا را
  **پاک نمی‌کند**. پروسه نمی‌تواند بازبینی مستقل تولید کند و نمی‌تواند
  هم اثبات کند که وجود ندارد؛ پس سکوت می‌کند.

کلید `null` در سطح فیلد یعنی «اندازه‌گیری نشد»، نه «وجود ندارد».

---

## ۲) متغیرهای محیطی — چه چیزی را واقعاً باز می‌کند

این‌ها همگی **نام سرویس یا نقش** هستند. هیچ‌کدام کلید نیستند.

| متغیر | فاز | چه چیزی را باز می‌کند |
|---|---|---|
| `INTENT_SECRET_MANAGER_PROVIDER` | ۳۲ | مدیر اسرار (Vault/KMS): چرخش کلید با dual control |
| `INTENT_FAILOVER_SECONDARY_REGION` | ۳۳ | ناحیهٔ دوم برای failover |
| `INTENT_DISCLOSURE_CHANNEL` | ۳۵ | کانال افشای اطلاعات (مثلاً نشانی عمومی) |
| `INTENT_DATA_RESIDENCY_REGION` | ۳۶ | محل نگهداری داده و اجباری‌سازی آن |
| `INTENT_SUSTAINMENT_OWNER` | ۴۰ | مالک مشخص نگهداری |
| `INTENT_SUPPORT_TICKET_ID` | ۴۲ | تیکت پشتیبانی (kanban/ticketing) |
| `INTENT_SPEND_CAP_USD` | ۴۳ | سقف خرج روزانه + kill-switch |
| `INTENT_WORKFORCE_SSO` | ۴۴ | SSO سازمانی + MFA |
| `INTENT_TELEMETRY_STREAM` | ۴۵ | جریان تله‌متری |
| `INTENT_TELEMETRY_OPT_IN=1` | ۴۵ | رضایت صریح کاربر (بدون آن، فاز بسته می‌ماند) |
| `INTENT_BOND_ID` | ۴۸ | اوراق قرضهٔ تضمین (bond) |
| `INTENT_REGULATORY_FILING_ID` | ۴۹ | شمارهٔ پروندهٔ نظارتی |
| `INTENT_INDEPENDENT_COUNSEL` | ۴۹ | مشاور حقوقی مستقل |

### نمونه

```bash
# نه کلید — فقط نام سرویس
INTENT_SECRET_MANAGER_PROVIDER=vault-production
INTENT_FAILOVER_SECONDARY_REGION=eu-central-1
INTENT_DISCLOSURE_CHANNEL=https://status.fbtswap.ir
INTENT_DATA_RESIDENCY_REGION=eu
INTENT_SUSTAINMENT_OWNER=platform-oncall
INTENT_SUPPORT_TICKET_ID=ZEN-1842
INTENT_SPEND_CAP_USD=250
INTENT_WORKFORCE_SSO=okta
INTENT_TELEMETRY_STREAM=datadog
INTENT_TELEMETRY_OPT_IN=1
INTENT_BOND_ID=BO-2026-11
INTENT_REGULATORY_FILING_ID=FCA-2026-114
INTENT_INDEPENDENT_COUNSEL=counsel-firm-a
```

---

## ۳) فازهایی که با **زیرساخت بیرونی** باز می‌شوند

این‌ها با یک متغیر باز نمی‌شوند. این‌ها یک سرویس یا یک تصمیم انسانی واقعی
می‌خواهند:

| فاز | blocker | چه چیزی لازم است |
|---|---|---|
| ۲۲ | `CA_INVALID` | یک **مرجع صدور گواهی (CA)** واقعی با گواهی معتبر |
| ۲۵ | `SMART_WALLET_UNAVAILABLE`, `SIGNER_WITHOUT_POLICY`, `FEE_CATEGORIES_INCOMPLETE` | کیف پول هوشمند + امضاکنندهٔ سیاست‌بندی‌شده + دسته‌های کارمزد |
| ۲۶ | `PROVIDER_HEALTH_FAILURE`, `VENUE_UNAVAILABLE` | آداپتور venue واقعی + سلامت provider |
| ۲۷ | `RPC_OUTAGE`, `POLICY_DIGEST_REQUIRED` | RPC زندهٔ mainnet + digest سیاست |
| ۲۸ | `BACKUP_RESTORE_FAILURE` | **واقعاً** یک backup و یک restore drill که جواب دهد |
| ۲۹ | `SECURITY_REVIEW_NOT_INDEPENDENT` | بازبینی مستقل، امضاشده، از سوی فرد/تیم دیگر |
| ۳۱ | `INCIDENT_UNDECLARED` | فرماندهٔ رخداد (incident commander) تعیین‌شده |
| ۳۳ | `PRIMARY_REGION_UNAVAILABLE` | ناحیهٔ دوم (با `INTENT_FAILOVER_SECONDARY_REGION`) |

---

## ۴) مراحل عملیاتی

### گام ۱ — وضعیت را ببینید

```bash
curl -s https://fbtswap.ir/api/intents/v1/phase-status | jq '{
  status, launchAllowed, operationalPhaseCount, phaseCount,
  criticalBlockers
}'
```

```bash
# کدام فازها مسدودند و چرا
curl -s https://fbtswap.ir/api/intents/v1/phase-status \
  | jq '.phases[] | select(.live == false) | { phase, blockers }'
```

### گام ۲ — بستهٔ اپراتور را تزریق کنید (اگر واقعاً امضاشده دارید)

این مسیر **دو اپراتور** می‌خواهد (`X-Operator-1` و `X-Operator-2`) و فقط
بسته‌ای را می‌پذیرد که واقعاً از endpoint اپراتور آمده باشد:

```
POST /api/intents/v1/plane-attestations
X-Operator-1: <op-a>
X-Operator-2: <op-b>
```

بدون این بسته، پرتابل‌هایی که در همین پروسه قابل سنجش نیستند
(۲۵، ۲۶، ۲۷، ۲۸، ۲۹، ۳۱، …) مسدود می‌مانند — و این **درست** است.

### گام ۳ — متغیرهای محیطی را ست کنید

در Vercel: Project Settings → Environment Variables → برای هر کدام، Production
را انتخاب کنید. بعد ** redeploy** کنید — متغیر env در build-time inject می‌شود.

### گام ۴ — دوباره بسنجید

```bash
curl -s https://fbtswap.ir/api/intents/v1/phase-status \
  | jq '.phases[] | select(.live == false) | { phase, blockers }'
```

هر فازی که blockerاش عوض شده، یعنی متغیرش واقعاً اثر کرده.

---

## ۵) چه چیزی را **نباید** بکنید

* ❌ **`attested: true` را دستی برندارید.** این دقیقاً همان عیبی است که این
  کار حذف کرد. یک ادعای جعلی، یک deploy را «زنده» نشان می‌دهد بی‌آنکه کاری
  کند.
* ❌ **متغیر را با یک نام ساختگی پر نکنید.** `INTENT_SECRET_MANAGER_PROVIDER=vault`
  وقتی Vault ندارید، فقط یک دروغ روی فاز ۳۲ می‌نویسد.
* ❌ **`INTENT_TELEMETRY_OPT_IN` را بدون رضایت کاربر ست نکنید.** رضایت صریح
  خودش یک کنترل است.
* ❌ **انتظار نداشته باشید یک متغیر، یک فاز بیرونی را باز کند.** فاز ۲۹ به
  بازبینی مستقل نیاز دارد؛ هیچ متغیری این را جایگزین نمی‌کند.

---

## ۶) چه چیزی را می‌توانید همین حالا بسنجید

```bash
# ۱۳۶ پرتابل کنترلی — نتیجهٔ واقعی سنجش
curl -s https://fbtswap.ir/api/intents/v1/phase-status | jq '.phases[] | select(.phase >= 21 and .phase <= 50) | { phase, live, blockers }'

# قوس‌های محصول — هر کدام روی پراب خودش
curl -s https://fbtswap.ir/api/intents/v1/phase-status | jq '[.phases[] | select(.live == false) | .blockers[]] | group_by(.) | map({ blocker: .[0], count: length })'

# وضعیت عمومی — بدون اطلاعات محرمانه
curl -s https://fbtswap.ir/api/intents/v1/public-status | jq '{ status, launchAllowed, claims }'
```

---

## ۷) مرجع کد

| فایل | نقش |
|---|---|
| `server/intentRealPlaneFacts.js` | سنجش واقعی پرتابل‌ها (`buildRealPlaneFacts`) |
| `server/intentPhaseRuntimeProbe.js` | پراب اجرای هر قوس محصول |
| `server/intentPhaseRuntimeProbeCache.js` | کش ۶۰ ثانیه‌ای پراب |
| `server/intentOperationalEvidence.js` | اسکن، کش اندازه‌گیری، ادغام measured/attested |
| `server/intentRuntimePlaneInputs.js` | `collectPlaneInputs` + ادغام عمقی measured/attested |
| `server/intentPhaseStatus.js` | گزارش وضعیت فاز |
| `server/intentPlaneAttestations.js` | اعتبارسنجی بستهٔ اپراتور |
| `src/lib/intent-ai/controlPlaneActivation.js` | ارزیابی ۳۰ پرتابل کنترلی |
| `test/intent-ai/real-plane-facts.test.mjs` | ۱۲ تست رگرسیون برای قرارداد سنجش |
| `test/intent-ai/phase-status-probe.mjs` | قرارداد وضعیت فاز |
