# QDRANT CLOUD — راهنمای گام‌به‌گام برای Vercel

> **این سند را کنار دست نگه دارید و دقیقاً به همین ترتیب اجرا کنید.**
>
> چرا این سند لازم است: کد پروژه **از قبل** Qdrant را کامل پشتیبانی می‌کند
> (`src/lib/intent-ai/orchestrator/vectorStore.js`). هیچ کدی نیاز نیست تغییر کند.
> فقط **دو متغیر محیطی** باید در Vercel ست شوند. اگر این دو ست نشوند، پروژه
> **خراب نمی‌شود** — به‌طور خودکار روی حافظهٔ محلی (local mirror) کار می‌کند.

---

## گام ۰ — قبل از هر چیز بدانید چه چیزی را از دست می‌دهید

این را اول بخوانید تا بعداً ناامید نشوید.

| | بدون Qdrant | با Qdrant |
|---|---|---|
| جست‌وجوی برداری | ✅ کار می‌کند (local) | ✅ کار می‌کند (remote + mirror محلی) |
| پاسخ‌گویی به سؤال | ✅ | ✅ |
| **ماندگاری حافظهٔ کاربر بین invocationها** | ❌ هر invocation تازه شروع می‌شود | ✅ بین همه instanceها مشترک |
| **پایداری index برداری** | ❌ هر بار از صفر | ✅ یک‌بار ساخته می‌شود |
| مصرف CPU | ۳۴۳ms | ۳۴۳ms (**تقریباً یکسان**) |
| مصرف فراخوانی پرووایدر | **بدون تغییر** | **بدون تغییر** |

**صادقانه:** Qdrant **CPU را کم نمی‌کند** و **فراخوانی پرووایدر را هم کم نمی‌کند**.
تنها چیزی که اضافه می‌کند **ماندگاری** است.

**اندازه‌گیری‌شده** (Cold start کل سرور): ۲۸۰ms wall / ۳۴۳ms CPU / ۹۷MB RSS.
Embeddingها از قبل آفلاین و همگام هستند (`embedSemanticSync`، ۰.۱۰۲ms per query).

> **قانون کلی:** اگر هدف شما «هوش بیشتر» یا «مصرف کمتر» است، Qdrant ابزار آن نیست.
> آن ابزار **دروازهٔ local-first** است (`server/aiLocalFirstGate.js`) که ۴۵٪ فراخوانی
> پرووایدر را حذف کرده. Qdrant را فقط برای **ماندگاری** روشن کنید.

---

## گام ۱ — کلید API را از پنل Qdrant بگیرید

۱. مرورگر را باز کنید و به این آدرس بروید:
   ```
   https://cloud.qdrant.io/accounts/7c00318d-0758-4c18-94df-97334f0f2728/clusters/b1d1d757-237a-46e5-b47b-967bc0b9fca3/configs
   ```
۲. با همان حسابی که کلاستر را ساخته **وارد شوید** (Google / GitHub / email).
۳. از منوی کلاستر بروید به:
   **Cloud Console → Cluster → API Keys** (یا «Data Access» بسته به نسخهٔ پنل).
۴. دکمهٔ **Create API Key** (یا **Add New API Key**) را بزنید.
۵. کلید را **کپی کنید** و جایی امن نگه دارید. (معمولاً یک رشتهٔ طولانی شبیه
   `qdrant-api-key-xxxxxxxxxxxx` است.)
۶. اگر پنل اجازهٔ انتخاب **Collection Access** می‌دهد، همه‌ی کالکشن‌ها یا
   کالکشن‌های موردنیاز را انتخاب کنید. (کد ما کالکشن‌ها را خودش می‌سازد، پس
   دسترسی کامل یا ساخت‌کالکشن لازم است.)

> ⚠️ **کلید را در چت، در commit، یا در `.env.example` ننویسید.** فقط در Vercel.

---

## گام ۲ — آدرس (Endpoint) را تأیید کنید

در همان صفحهٔ کلاستر، بخش **Cluster Endpoint** یا **Cluster URL** را پیدا کنید.
برای کلاستر شما باید این باشد:

```
https://b1d1d757-237a-46e5-b47b-967bc0b9fca3.europe-west3-0.gcp.cloud.qdrant.io
```

**قواعد مهم برای مقدار:**

| ✅ درست | ❌ غلط |
|---|---|
| `https://<cluster-id>.<region>.gcp.cloud.qdrant.io` | `.../collections/xyz` ← نگذارید |
| بدون اسلش انتهایی | `...io/` ← اسلش انتهایی هم لازم نیست |
| بدون `:6333` | `http://` باید حتماً `https` باشد |
| | پورت `:6333` ← **ندارد** |

> کد پروژه خودش `/collections/...` را به انتها اضافه می‌کند
> (`vectorStore.js:515, 529, 593, 652`). پس مقدار باید **فقط base URL** باشد.

---

## گام ۳ — وارد Vercel شوید

۱. بروید به: **https://vercel.com/dashboard**
۲. پروژهٔ **`fbtcryp-kkxi`** را انتخاب کنید.
   (Project ID: `prj_BfyPpFAA5ABtcBODxAWT4hFHo2YM` — اگر لازم شد از آدرس
   پروژه یا با `vercel link` پیدا کنید.)
۳. از منوی چپ: **Settings → Environment Variables**

> ⚠️ **توجه:** اگر پروژه paused است (پیام fair-use)، ممکن است دکمهٔ
> **Add Environment Variable** غیرفعال باشد. در آن حالت به **گام ۶** بروید
> و این دو متغیر را بعد از unpause (۲۰۲۶-۱۲-۱۰) اضافه کنید.

---

## گام ۴ — متغیر اول: `QDRANT_URL`

۱. **Add Environment Variable** را بزنید.
۲. **Key**: دقیقاً بنویسید
   ```
   QDRANT_URL
   ```
   (حروف بزرگ، با آندرلاین. اشتباه تایپی = بی‌اثر.)
۳. **Value**: آدرس مرحلهٔ ۲ را **بدون** `https` کپی نکنید — **با** `https`:
   ```
   https://b1d1d757-237a-46e5-b47b-967bc0b9fca3.europe-west3-0.gcp.cloud.qdrant.io
   ```
۴. **Environment Variables** (چند انتخابی): تیک **Production** را بزنید.
   اگر می‌خواهید در Preview هم تست شود، **Preview** را هم تیک بزنید.
۵. **Save**.

---

## گام ۵ — متغیر دوم: `QDRANT_API_KEY`

۱. دوباره **Add Environment Variable** را بزنید.
۲. **Key**:
   ```
   QDRANT_API_KEY
   ```
۳. **Value**: کلیدی که در **گام ۱** کپی کردید.
۴. **Environment Variables**: **Production** را تیک بزنید (و Preview اگر خواستید).
۵. **Save**.

> 🔒 **امنیت:** برای این یکی، اگر پنل Vercel اجازه دارد، نوع متغیر را روی
> **Sensitive** یا **Encrypted** بگذارید — نه Plain. کلید API است، نه یک URL.

---

## گام ۶ — متغیرها را بررسی کنید

در همان صفحهٔ Environment Variables باید این دو را ببینید:

```
QDRANT_URL         https://b1d1d757-...europe-west3-0.gcp.cloud.qdrant.io   [Production]
QDRANT_API_KEY     ••••••••••••••••••••••••••••••••••••••••••••••••       [Production]
```

---

## گام ۷ — دیپلوی کنید

متغیر محیطی فقط با **یک دیپلوی جدید** اثر می‌گذارد. deploymentهای قدیمی
متغیر تازه را نمی‌بینند.

۱. به **Deployments** بروید.
۲. یا **Redeploy** بزنید روی آخرین دیپلوی، یا از **main** یک دیپلوی تازه بسازید.

> 🔴 **نکتهٔ مهم:** `git.deploymentEnabled {"arena/*": false}` است — یعنی branch
> فعلی deploy نمی‌شود. برای دیپلوی واقعی باید **PR #748 را merge به `main`**
> بکنید، یا دستی از شاخهٔ `main` دیپلوی بسازید.

---

## گام ۸ — تست کنید که واقعاً وصل شده

پس از دیپلوی، این را صدا بزنید (روی دامنهٔ production):

```bash
curl -X POST https://<your-domain>/api/v1/ai/smart-memory/qdrant/test \
  -H 'content-type: application/json' \
  -d '{"dim":384}'
```

### ✅ جواب موفق (Qdrant وصل است):
```json
{
  "ok": true,
  "mode": "qdrant",
  "qdrantConfigured": true,
  "checks": {
    "collectionCreated": true,
    "upserted": true,
    "searchHit": true,
    "scrollOk": true,
    "deleteOk": true
  }
}
```

### ⚠️ جواب «هنوز local» (متغیرها اعمال نشده‌اند):
```json
{
  "ok": true,
  "mode": "embedded-operational-vector-db",
  "qdrantConfigured": false,
  "note": "QDRANT_URL is not set; embedded operational vector database verified..."
}
```
⇒ یعنی دیپلوی با متغیرهای جدید انجام نشده. به **گام ۷** برگردید.

### ❌ خطای دسترسی (کلید اشتباه است):
```json
{ "ok": false, "error": "QDRANT_HTTP_403: ..." }
```
⇒ کلید را دوباره از پنل Qdrant بگیرید (**گام ۱**). دقت کنید کلید را از خودِ
کلاستر بردارید، نه از یک کلاستر دیگر یا یک کلید منقضی.

---

## گام ۹ — اگر خواستید Qdrant را خاموش کنید

کافی است **مقدار** `QDRANT_URL` را **خالی** کنید (یا متغیر را **حذف** کنید).
پروژه بلافاصله به حافظهٔ محلی برمی‌گردد — چیزی نمی‌شکند.

`AI_ORCH_VECTOR` هم اگر لازم شد:
- `auto` (پیش‌فرض) — اگر `QDRANT_URL` باشد Qdrant، وگرنه local
- `qdrant` — فقط Qdrant
- `local` — فقط local (اجبار)

---

## گام ۱۰ — چیزهایی که نباید بگذارید

| متغیر | چرا نه |
|---|---|
| `QDRANT_API_KEY` در `VITE_*` | `VITE_*` داخل **باندل مرورگر** می‌رود ⇒ کلید لو می‌رود. حتماً `QDRANT_API_KEY` بدون پیشوند بماند. |
| `QDRANT_URL` با مسیر `/collections` | کد خودش اضافه می‌کند ⇒ آدرس خراب می‌شود |
| پورت `:6333` | کلاستر Cloud پورت ندارد |
| `http://` | باید `https://` باشد |

---

## خلاصهٔ یک‌خطی

```
QDRANT_URL     = https://b1d1d757-237a-46e5-b47b-967bc0b9fca3.europe-west3-0.gcp.cloud.qdrant.io
QDRANT_API_KEY = <کلیدی که در Cloud Console → Cluster → API Keys ساختید>
هر دو: Production + (اختیاری) Preview، نوع: Sensitive برای کلید
بعد: Redeploy، بعد: POST /api/v1/ai/smart-memory/qdrant/test
```

---

## اگر Vercel هنوز پایس است

این ترتیب را رعایت کنید:

1. **اول** تیک unpause (۲۰۲۶-۱۲-۱۰) را در پنل Vercel بزنید یا تیک
   [vercel.com/help](https://vercel.com/help) را ثبت کنید.
2. **بعد** دو متغیر را ست کنید (گام ۴ و ۵).
3. **بعد** merge به `main` و دیپلوی.
4. **بعد** تست (گام ۸).

**تا آن زمان** پروژه با حافظهٔ محلی کاملاً سالم کار می‌کند — هیچ چیزی
نیاز به بازکاری ندارد.
