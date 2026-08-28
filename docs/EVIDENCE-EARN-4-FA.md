# چهار شاهدی که خودتان می‌توانید «کسب» کنید — راهنمای گام‌به‌گام

تاریخ: ۲۰۲۶-۰۸-۲۸

از میان ۲۱ شاهد لازم برای فعال‌سازی، ۴ شاهد نیازی به شرکت ثالث، قرارداد یا
پرداخت ندارند؛ فقط باید واقعاً **اندازه گرفته شوند**:

| شاهد | چه چیزی را ثابت می‌کند | ابزار |
|------|------------------------|-------|
| `certificate-authority` | TLS سایت شما توسط یک CA معتبر امضا شده (ورسل خودکار می‌دهد) | TLS handshake واقعی |
| `venue-health` | یک بار probe سلامت صرافی زدید | درخواست HTTPS واقعی |
| `slo-measurement` | uptime و p95 را اندازه گرفتید | N درخواست واقعی |
| `durable-immutable-audit` | Blob فعال + root تأیید شده | خواندن audit-status |

## 📱 بدون کامپیوتر؟ کاری لازم نیست بکنید

اگر فقط موبایل دارید، مسیر CLI را **نادیده بگیرید**. خود دیپلوی این چهار شاهد را
اندازه می‌گیرد: موقع بوت و هر ۴ ساعت، و هر وقت این آدرس را باز کنید:

```
https://YOUR-APP.vercel.app/api/intents/v1/self-probe
```

با `?dry=1` فقط گزارش می‌دهد و چیزی ذخیره نمی‌کند. نمونهٔ خروجی:

```json
{
  "earnedCount": 3,
  "earned": [
    { "kind": "certificate-authority", "providerId": "Let-s-Encrypt", "digest": "3f9c…" },
    { "kind": "venue-health", "providerId": "binance", "digest": "8b21…" },
    { "kind": "durable-immutable-audit", "providerId": "blob-audit-log", "digest": "c704…" }
  ],
  "missing": [ { "kind": "slo-measurement", "code": "SLO_NOT_MEASURED" } ],
  "detail": { "slo": { "samples": 7, "reason": "INSUFFICIENT_SAMPLES" } }
}
```

سرور همان چهار probe را اجرا می‌کند که CLI اجرا می‌کرد — TLS handshake واقعی به
دامنهٔ خودش، درخواست واقعی به صرافی، متر SLO روی ترافیکی که واقعاً سرو کرده، و
append + verify روی لاگ audit. هیچ‌کدام «خودگواهی» نیست: اگر probe رد شود، هیچ
شاهدی صادر نمی‌شود.

نتیجهٔ مهم: **برای این چهار شاهد دیگر به `INTENT_OPERATIONAL_EVIDENCE` نیاز
ندارید.** با هر cold start دوباره اندازه گرفته می‌شوند؛ چیزی برای paste کردن
نمانده. (آن متغیر فقط برای ۱۷ شاهد بیرونی می‌ماند که به شخص ثالث نیاز دارند.)

### تنها نکته: `slo-measurement` به ترافیک نیاز دارد

متر SLO داخل همان instance زندگی می‌کند و حداقل **۲۰ درخواست واقعی** می‌خواهد.
روی موبایل: چند بار اپ را باز کنید یا چند بار همان URL را refresh کنید، بعد
`self-probe` را صدا بزنید. اگر instance سرد شود، شمارش از صفر شروع می‌شود —
این عمدی است: SLO یعنی اندازه‌گیری همین instance، نه یک عدد ذخیره‌شده.

### آیا متغیری لازم است؟

نه. ورسل خودش `VERCEL_URL` را ست می‌کند و probe از همان دامنهٔ عمومی استفاده
می‌کند. فقط اگر دامنهٔ اختصاصی دارید و می‌خواهید گواهی *آن* سنجیده شود:

```
PUBLIC_ORIGIN = https://your-custom-domain.com
```

---

## وضعیت قبل از این تغییر — کدام نبود

| شاهد | قبلاً | حالا |
|------|-------|------|
| `certificate-authority` | ❌ **هیچ probe ای وجود نداشت** — فقط RFP و قالب | ✅ `probeCertificateAuthority` (TLS واقعی) |
| `venue-health` | ⚠️ probe سمت سرور بود ولی راهی برای تبدیل به شاهد قابل تزریق نبود | ✅ در CLI |
| `slo-measurement` | ❌ **عدد ثابت تقلبی**: `uptime: 0.999, p99: 250` — هیچ‌وقت اندازه‌گیری نشده بود | ✅ متر واقعی روی ترافیک سرو‌شده |
| `durable-immutable-audit` | ⚠️ audit log بود ولی probe تأیید root نبود | ✅ در CLI |

مهم‌ترین نکته: `sloMeasurement()` در `server/intentDrill.js` سه عدد ثابت
برمی‌گرداند که هیچ‌کس اندازه نگرفته بود. آن حذف شد. حالا
`server/intentSloMeter.js` تأخیر و نتیجهٔ **هر درخواستی که خود پروسه سرو کرده**
را ثبت می‌کند و اگر نمونهٔ کافی نباشد صادقانه می‌گوید
`measured: false، reason: INSUFFICIENT_SAMPLES` — نه یک عدد پیش‌فرض.

## فایل‌های اضافه‌شده

- `scripts/lib/evidenceProbes.mjs` — چهار probe واقعی
- `scripts/collect-evidence.mjs` — CLI؛ فقط شواهدی که واقعاً کسب شده را می‌نویسد
- `server/intentSloMeter.js` — متر SLO روی ترافیک واقعی
- `GET /api/intents/v1/slo-status` — خروجی متر
- `test/intent-ai/earnable-evidence-probe.mjs` — ۳۰ تست (`npm run test:earnable-evidence`)

---

# مرحله به مرحله — کاری که شما باید انجام دهید

## گام ۰ — پیش‌نیاز

دیپلوی زنده روی HTTPS (ورسل خودت گواهی می‌دهد). آدرس آن را یادداشت کنید:

```bash
export TARGET=https://YOUR-APP.vercel.app
```

> ⚠️ این دستورها را روی **کامپیوتر خودتان** اجرا کنید، نه در محیط سندباکس؛
> probe ها به اینترنت واقعی نیاز دارند (TLS + صرافی).

## گام ۱ — یک اجرای خشک بگیرید (هیچ چیزی تغییر نمی‌کند)

```bash
npm run evidence:collect -- --target $TARGET
```

خروجی برای هر شاهد یا ✓ با digest واقعی است یا ✗ با کد دلیل. مثال:

```
✓ certificate-authority  (TLS of your site)
    providerId Let-s-Encrypt
    digest     3f9c...   ← همان SHA-256 گواهی سرور
    issuer     Let's Encrypt — valid to Nov 20 2026
✓ slo-measurement
    measured   uptime 100.00%  p50 61ms  p95 180ms  (20 samples)
✗ durable-immutable-audit
    code       DURABLE_STORE_NOT_CONFIGURED
```

دو فایل ساخته می‌شود: `evidence.json` (فقط شواهد کسب‌شده) و
`evidence-probe-detail.json` (جزئیات کامل اندازه‌گیری، برای بایگانی).

## گام ۲ — اگر `certificate-authority` ✗ بود

| کد | کار شما |
|----|---------|
| `TARGET_NOT_HTTPS` | آدرس را با `https://` بدهید |
| `CA_HANDSHAKE_FAILED` | دامنه/دیپلوی زنده نیست؛ ورسل را چک کنید |
| `CA_CHAIN_NOT_TRUSTED` | گواهی self-signed است؛ روی دامنهٔ ورسل تست کنید |
| `CA_EXPIRED` | گواهی را تمدید کنید |

روی دامنهٔ پیش‌فرض ورسل معمولاً بدون هیچ کاری ✓ می‌شود.

## گام ۳ — اگر `venue-health` ✗ بود

`NO_HEALTHY_VENUE` یعنی هیچ‌کدام از endpointهای عمومی جواب ندادند (فیلترینگ یا
قطعی شبکه). با VPN یا از یک سرور دیگر دوباره اجرا کنید، یا صرافی دیگری بدهید:

```bash
npm run evidence:collect -- --target $TARGET --venues kraken,bitfinex
```

## گام ۴ — اگر `slo-measurement` ✗ بود

این یکی «خرابیِ تنظیمات» نیست، **نتیجهٔ واقعی** است:

- `SLO_UPTIME_BELOW_TARGET` → سرویس واقعاً خطای 5xx می‌دهد. اول آن را درست کنید.
- `SLO_P95_ABOVE_TARGET` → p95 بالای ۲ ثانیه است. سرد بودن lambda را با یک اجرای
  گرم‌کننده کم کنید، بعد دوباره اندازه بگیرید.

نمونهٔ بیشتر = اندازه‌گیری معتبرتر:

```bash
npm run evidence:collect -- --target $TARGET --samples 100
```

## گام ۵ — `durable-immutable-audit` (دو نوبتی است)

این شاهد به یک root واقعی روی Blob نیاز دارد، پس ترتیب مهم است:

1. `BLOB_READ_WRITE_TOKEN` را در Vercel → Project → Settings → Environment
   Variables ست کنید و **redeploy** کنید.
2. تأیید کنید:
   ```bash
   curl -s $TARGET/api/intents/v1/audit-status | jq
   # باید: configured: true, durable: true
   ```
3. حالا سه شاهد دیگر را تزریق کنید (گام ۶). هر تزریق یک entry در audit log
   می‌نویسد، پس `rootHash` و `entryCount` ساخته می‌شوند.
4. CLI را دوباره اجرا کنید — این بار `durable-immutable-audit` هم ✓ می‌شود،
   چون digest آن **دقیقاً همان rootHash** است.

## گام ۶ — تزریق با احراز هویت دو اپراتور

دو شناسهٔ اپراتور متمایز لازم است (فقط شناسه، نه رمز و نه کلید):

```bash
export OPERATOR_1=alice.ops
export OPERATOR_2=bob.ops

npm run evidence:collect -- --target $TARGET --samples 50 --submit
```

یا دستی، با همان `evidence.json`:

```bash
curl -X POST $TARGET/api/intents/v1/operator-evidence \
  -H "Content-Type: application/json" \
  -H "X-Operator-1: $OPERATOR_1" \
  -H "X-Operator-2: $OPERATOR_2" \
  -d @evidence.json
```

پاسخ باید `accepted: 4, rejected: 0` باشد.

## گام ۷ — تأیید

```bash
curl -s $TARGET/api/intents/v1/evidence-status | jq '{stored, missing}'
curl -s $TARGET/api/intents/v1/slo-status | jq
```

باید هر چهار شاهد در `stored` باشند. ۱۷ شاهد باقی‌مانده هنوز
`OPERATOR_REQUIRED` هستند (CA سازمانی، sandbox، security review، signer، …) —
آن‌ها با هیچ اسکریپتی کسب نمی‌شوند و به شخص ثالث نیاز دارند.

## گام ۸ — تازه نگه داشتن (چون شاهد منقضی می‌شود)

TTL پیش‌فرض: ۶ ساعت (گواهی ۲۴ ساعت). یک cron هر ۴ ساعت:

```bash
0 */4 * * * cd /path/to/fbtcryp && \
  OPERATOR_1=alice.ops OPERATOR_2=bob.ops \
  node scripts/collect-evidence.mjs --target https://YOUR-APP.vercel.app \
  --samples 50 --submit >> /var/log/fbt-evidence.log 2>&1
```

با `--ttl-hours` و `--cert-ttl-hours` قابل تنظیم است. TTL کوتاه عمدی است:
شاهدی که هفتهٔ پیش گرفته شده دربارهٔ امروز چیزی نمی‌گوید.

## گزینه‌های CLI

```
--target <url>       آدرس عمومی (env: EVIDENCE_TARGET)
--out <file>         خروجی (پیش‌فرض evidence.json)
--samples <n>        تعداد نمونهٔ SLO (پیش‌فرض ۲۰)
--venues <list>      binance,kraken,coinbase,bitfinex
--slo-path <path>    مسیر اندازه‌گیری (پیش‌فرض /api/intents/v1/public-status)
--ttl-hours <n>      عمر شاهد (پیش‌فرض ۶)
--cert-ttl-hours <n> عمر شاهد گواهی (پیش‌فرض ۲۴)
--submit             ارسال به operator-evidence
--op1 / --op2        شناسهٔ اپراتورها
--json               خروجی ماشین‌خوان
```

کد خروج: `0` یعنی هر چهار شاهد کسب شد، `1` یعنی حداقل یکی نشد (برای CI مناسب است).

---

# متغیرهای Vercel — دقیقاً چه چیزی لازم است

## ۱. `BLOB_READ_WRITE_TOKEN` — **الزامی، فقط برای یکی از چهار شاهد**

تنها متغیری که برای این چهار شاهد واقعاً لازم است.

| برای | لازم است؟ |
|------|-----------|
| `certificate-authority` | ❌ خیر — ورسل خودش گواهی می‌دهد |
| `venue-health` | ❌ خیر — endpoint عمومی صرافی است |
| `slo-measurement` | ❌ خیر — از ترافیک خود سرویس اندازه گرفته می‌شود |
| `durable-immutable-audit` | ✅ **بله** — بدون Blob، لاگ ماندگار وجود ندارد |

روش:

```
Vercel Dashboard → Storage → Create → Blob
→ Connect to Project → روی fbtcryp
```

با اتصال Store، ورسل خودش `BLOB_READ_WRITE_TOKEN` را به پروژه تزریق می‌کند
(لازم نیست دستی بنویسید). بعدش حتماً **Redeploy** کنید — متغیر جدید فقط در
دیپلوی بعدی اعمال می‌شود. تأیید:

```bash
curl -s $TARGET/api/intents/v1/audit-status | jq '{configured, durable}'
# باید: { "configured": true, "durable": true }
```

## ۲. `INTENT_OPERATIONAL_EVIDENCE` — فقط اگر CLI را ترجیح می‌دهید

> از وقتی `self-probe` اضافه شد، این متغیر برای **این چهار شاهد لازم نیست** —
> سرور بعد از هر cold start دوباره اندازه‌شان می‌گیرد. بخش زیر برای کسی است که
> از کامپیوتر کار می‌کند یا می‌خواهد شواهد بیرونی (۱۷ تای دیگر) را ماندگار کند.

این نکته را از قلم نیندازید: روی ورسل API به‌صورت **stateless function** اجرا
می‌شود. شواهدی که با `POST /operator-evidence` تزریق می‌کنید در حافظهٔ همان
instance می‌مانند و با هر cold start **پاک می‌شوند**. یعنی ممکن است ساعتی بعد
دوباره ببینید `stored: 0`.

راه ماندگار: همان رکوردها را در این متغیر بگذارید. سرور موقع بوت هر رکورد را
دقیقاً مثل رکورد تزریق‌شده اعتبارسنجی می‌کند (منقضی یا خراب باشد، دور انداخته
می‌شود، نه اینکه باور شود).

### ⚠️ چرا کسی نمی‌تواند این مقدار را برای شما بنویسد

محتوای این متغیر باید digestهای **واقعی** باشد:

| رکورد | digest دقیقاً چیست |
|-------|--------------------|
| `certificate-authority` | fingerprint SHA-256 گواهی‌ای که سرور شما همین الان سرو می‌کند |
| `venue-health` | هش پاسخ واقعی صرافی + latency اندازه‌گیری‌شده |
| `slo-measurement` | هش اندازه‌گیری واقعی uptime و p95 |
| `durable-immutable-audit` | همان rootHash واقعی لاگ audit شما |

هیچ‌کدام از روی متن قابل حدس نیست؛ باید از ماشینی گرفته شود که واقعاً به دیپلوی
شما و به اینترنت وصل است. هر مقداری که کسی «آماده» به شما بدهد، جعلی است.

### ساختن مقدار — دو اجرا (چون audit دو‌نوبتی است)

`durable-immutable-audit` تا وقتی لاگ audit خالی است قابل کسب نیست، و لاگ با
**اولین تزریق موفق** پر می‌شود. پس ترتیب اجباری است:

```bash
export TARGET=https://YOUR-APP.vercel.app
export OPERATOR_1=alice.ops
export OPERATOR_2=bob.ops

# اجرای ۱ — CA + venue + SLO کسب و تزریق می‌شوند؛ همین تزریق، اولین entry
#           لاگ audit را می‌نویسد و rootHash می‌سازد
node scripts/collect-evidence.mjs --target $TARGET \
  --samples 50 --ttl-hours 24 --out evidence-1.json --submit

# اجرای ۲ — حالا rootHash وجود دارد، پس شاهد چهارم هم کسب می‌شود.
#           --merge سه رکورد اجرای اول را با آن ادغام می‌کند.
node scripts/collect-evidence.mjs --target $TARGET \
  --samples 50 --ttl-hours 24 --out evidence-2.json --submit \
  --env --merge evidence-1.json
```

خروجی اجرای دوم یک خط JSON با هر چهار رکورد است و در `evidence-2.env.txt` هم
ذخیره می‌شود. همان یک خط را در
`Vercel → Settings → Environment Variables → INTENT_OPERATIONAL_EVIDENCE`
بگذارید و **Redeploy** کنید (تغییر متغیر به دیپلوی در حال اجرا نمی‌رسد).

تأیید نهایی:

```bash
npm run evidence:check-env -- --target $TARGET
curl -s $TARGET/api/intents/v1/evidence-status | jq '.evidence'   # باید 11/21 شود
```

`--merge` رکوردهای منقضی را دور می‌اندازد و رکورد تازه‌تر همیشه برندهٔ رکورد
قدیمی‌ترِ هم‌نوع است؛ پس می‌توانید همین دستور را هفته‌ها پشت سر هم اجرا کنید.

## ۳. `ECOSYSTEM_CERTIFIERS` — مربوط به موج ۰، نه این چهار شاهد

فرمت `telegramUserId:Label`. برای گواهی‌دهندگان اکوسیستم است؛ هیچ‌کدام از این
چهار probe به آن نگاه نمی‌کند. اگر می‌خواهید `npm run validate:activation-env`
سبز شود لازم است.

## ۴. چیزی که **نباید** ست کنید

`INTENT_SECRET_MANAGER_PROVIDER`، `INTENT_SECRET_MANAGER_KEY_REF` — این‌ها به
KMS و ارائه‌دهندهٔ attested نیاز دارند (موج ۳). ست کردنشان بدون آن زیرساخت،
دقیقاً همان دروغی است که این کار برای حذفش انجام شد.

## چطور بفهمم روی ورسل واقعاً ست شده؟

دیدن داشبورد ورسل کافی نیست: متغیری که ذخیره شده ولی **redeploy** نشده، در
داشبورد «ست» نشان داده می‌شود ولی کد آن را نمی‌بیند. این دستور از خودِ دیپلوی
زنده می‌پرسد:

```bash
npm run evidence:check-env -- --target $TARGET
```

خروجی نمونه:

```
✗ BLOB_READ_WRITE_TOKEN
    observed  audit-status.configured=false durable=false
    fix       Vercel → Storage → Blob → Connect to Project, then REDEPLOY.
✗ INTENT_OPERATIONAL_EVIDENCE
    observed  0 externally-supplied evidence kind(s) live
──────────────────────────────────────────────────────────
evidence     4/21   (stored 4, missing 17)
audit log    entries 0, root none
slo meter    not yet measured (INSUFFICIENT_SAMPLES)
```

هیچ secret ای خوانده یا چاپ نمی‌شود؛ همهٔ سیگنال‌ها boolean و شمارنده‌های عمومی
هستند. کد خروج `0` یعنی متغیرهای الزامی فعال‌اند، `1` یعنی نه.

## جمع‌بندی

| متغیر | لازم؟ | چرا |
|-------|-------|-----|
| `BLOB_READ_WRITE_TOKEN` | ✅ | تنها پیش‌نیاز `durable-immutable-audit` |
| `INTENT_OPERATIONAL_EVIDENCE` | ➖ | برای این چهارتا لازم نیست (self-probe)؛ فقط برای شواهد بیرونی |
| `PUBLIC_ORIGIN` | ➖ | فقط اگر دامنهٔ اختصاصی دارید |
| `ECOSYSTEM_CERTIFIERS` | ➖ | موج ۰، ربطی به این چهارتا ندارد |
| بقیه | ❌ | موج‌های بعدی / نیاز به شخص ثالث |

---

## قوانینی که این ابزار نقض نمی‌کند

- هیچ digest ساختگی تولید نمی‌شود؛ اگر چک رد شود، هیچ رکوردی نوشته نمی‌شود.
- digest گواهی = fingerprint واقعی SHA-256؛ digest audit = همان rootHash.
- SLO فقط از نمونه‌های واقعی محاسبه می‌شود؛ زیر ۲۰ نمونه = `measured: false`.
- هیچ کلید، توکن یا secret در payload نمی‌رود (فقط شناسهٔ عمومی اپراتور).
