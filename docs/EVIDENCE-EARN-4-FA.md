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

## قوانینی که این ابزار نقض نمی‌کند

- هیچ digest ساختگی تولید نمی‌شود؛ اگر چک رد شود، هیچ رکوردی نوشته نمی‌شود.
- digest گواهی = fingerprint واقعی SHA-256؛ digest audit = همان rootHash.
- SLO فقط از نمونه‌های واقعی محاسبه می‌شود؛ زیر ۲۰ نمونه = `measured: false`.
- هیچ کلید، توکن یا secret در payload نمی‌رود (فقط شناسهٔ عمومی اپراتور).
