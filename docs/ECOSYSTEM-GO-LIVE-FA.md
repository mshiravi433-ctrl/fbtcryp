# روشن‌کردن رجیستری روی fbtswap.ir — گام‌به‌گام

این سند فقط دربارهٔ **زنده‌کردن** چیزی است که ساخته شده. کد کامل است؛ چیزی که
باقی مانده دو متغیر محیطی و پنج دقیقه کار در خود اپ است.

> چرا کاتالوگ الان خالی است؟ چون عمداً fail-closed است: بدون بازبینِ
> پیکربندی‌شده هیچ گواهی صادر نمی‌شود، و بدون گواهیِ فعال هیچ لیستینگی منتشر
> نمی‌شود. کاتالوگِ خالی، صادق است؛ کاتالوگِ پر از «تأییدشده»‌های خوداظهار، نه.

---

## گام ۰ — بررسی وضعیت فعلی (۱۰ ثانیه)

```bash
curl -s https://fbtswap.ir/api/ecosystem/status | jq
```

سه چیز را نگاه کن:

| فیلد | معنی اگر `false` باشد |
|---|---|
| `durableStore` | `BLOB_READ_WRITE_TOKEN` تنظیم نیست؛ نوشتن با ۵۰۳ رد می‌شود |
| `certificationIssuerConfigured` | `ECOSYSTEM_CERTIFIERS` تنظیم نیست؛ هیچ‌چیز منتشر نمی‌شود |
| `dataStatus` | `unavailable` یعنی رجیستری پایدار جواب نداده |

---

## گام ۰.۵ — تلگرام را با ربات جدید وصل کن

ربات رسمی فعلی این اپ:

- آدرس: [@fbtco_bot](https://t.me/fbtco_bot)
- Bot ID عمومی: `7837421575`

این مرحله برای خطای `AUTH_REQUIRED` داخل Mini App حیاتی است: `initData` باید
با **همین ربات** امضا شده باشد که توکنش در Vercel تنظیم شده است. خودِ Bot ID
راز نیست و به‌تنهایی نمی‌تواند نشست را تأیید کند؛ برای امضای Mini App حتماً
**توکن کامل و خصوصی BotFather** لازم است.

۱. بعد از دیپلوی، وضعیت را چک کن:

   ```bash
   curl -s https://fbtswap.ir/api/health | jq '.telegram'
   ```

   انتظار این است:

   ```json
   {
     "expectedBotId": "7837421575",
     "configuredBotId": "7837421575",
     "tokenConfigured": true,
     "identityMatches": true
   }
   ```

   `bot: true` به‌تنهایی فقط می‌گوید یک توکن وجود دارد؛ `identityMatches:
   true` ثابت می‌کند پیشوند همان توکن با ربات جدید یکی است.

۲. در [@BotFather](https://t.me/BotFather) → `/mybots` → **@fbtco_bot** توکن
   کامل ربات جدید را بگیر. اگر توکن قبلی در چت یا جای عمومی لو رفته، همان‌جا
   با `/revoke` باطلش کن. **توکن را در چت، کد، فایل `.env` کامیت‌شده، یا
   GitHub Variables قرار نده.**

۳. در **Vercel → پروژهٔ `fbtcryp-kkxi` → Settings → Environment Variables**
   این دو مقدار را در محیط Production (و اگر Preview را تست می‌کنی، Preview)
   بگذار و بعد **Redeploy** کن:

   | نام | مقدار |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | توکن کاملِ خصوصیِ @fbtco_bot |
   | `TELEGRAM_BOT_ID` | `7837421575` |

   مقدار دوم عمومی و فقط برای تشخیص ناسازگاری است؛ اولی راز است و تنها مقداری
   است که امضای Telegram را تأیید می‌کند. متغیرها در زمان بوت خوانده می‌شوند،
   بنابراین صرفِ Save کردن بدون Redeploy کافی نیست.

۴. در BotFather برای **@fbtco_bot** مسیر **`/mybots → Bot Settings → Menu
   Button`** (یا **Main Mini App**) را باز کن و `https://fbtswap.ir` را به‌عنوان
   Web App URL بگذار. سپس با [@fbtco_bot](https://t.me/fbtco_bot) ربات را باز
   و دکمهٔ Open/Menu را لمس کن. بازکردن یک لینک عادی در مرورگر داخلی تلگرام
   `initData` امضاشدهٔ Mini App را تضمین نمی‌کند.

۵. لینک‌های دعوت اکنون به شکل
   `https://t.me/fbtco_bot?startapp=<referral-code>` ساخته می‌شوند. Telegram
   پارامتر را به Mini App می‌رساند و اپ آن را یک‌بار ثبت می‌کند؛ در نتیجه
   referral در فاصلهٔ بازشدن ربات تا ورود به اپ گم نمی‌شود.

اگر همین ربات برای پست‌گذاری کانال GitHub Actions هم استفاده می‌شود، در
**GitHub → Settings → Secrets and variables → Actions → Secrets** مقدار
`TELEGRAM_BOT_TOKEN` را هم با توکن جدید عوض کن؛ آنجا باید **Secret** باشد، نه
Variable.

روی Vercel پردازهٔ polling ربات اجرا نمی‌شود و برای Mini App هم لازم نیست.
Mini App فقط `initData` را می‌فرستد و سرور امضای آن را با توکن بررسی می‌کند؛
polling برای پاسخ‌دادن به پیام‌های ربات است، نه برای احراز هویت Web App.

برای علت دقیق، بدون هدر به `/api/telegram/diagnose` برو و سپس همان درخواست را
از داخل Mini App با هدر واقعی `x-telegram-init-data` تکرار کن. این endpoint
هیچ توکنی برنمی‌گرداند و فقط وضعیت امضا، عمر نشست، Bot ID پیکربندی‌شده و
`botIdentityMatches` عمومی را نشان می‌دهد.

---

## گام ۱ — آیدی تلگرام خودت را بگیر

اپ را **داخل تلگرام** باز کن → صفحهٔ Developers. اگر بازبینی پیکربندی نشده
باشد، کارتی می‌بینی که دقیقاً همان خطی را که باید در Vercel بگذاری نشان می‌دهد،
با آیدی خودت که از پیش پر شده — مثلاً:

```
ECOSYSTEM_CERTIFIERS=123456789:FBT Review
```

دکمهٔ کپی هم کنارش هست. (این آیدی فقط به خودت نشان داده می‌شود؛ سرور هرگز
فهرست بازبین‌ها را عمومی نمی‌کند و آیدی تلگرام هم روی گواهی ذخیره نمی‌شود —
فقط برچسب عمومی.)

---

## گام ۲ — متغیرها را در Vercel بگذار

**Vercel → پروژه → Settings → Environment Variables**

| متغیر | مقدار | وضعیت فعلی |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | توکن Blob | ✅ از قبل تنظیم است |
| `ECOSYSTEM_CERTIFIERS` | `<آیدی‌تو>:FBT Review` | ⬅️ همین را اضافه کن |
| `ECOSYSTEM_WRITE_RATE_LIMIT` | اختیاری، پیش‌فرض `12` در دقیقه | — |

بعد **Redeploy** کن (متغیرها در زمان بوت خوانده می‌شوند).

چند بازبین؟ با کاما جدا کن:
`123456789:FBT Review,987654321:External Audit`

---

## گام ۳ — اولین لیستینگ (داخل تلگرام، صفحهٔ Developers)

۱. **پروژه بساز** — کنسول توسعه‌دهنده → نام پروژه → «ساخت». این پروژهٔ واقعیِ
   سمت سرور است (نه پیش‌نویس محلی).
۲. **کلید API** (اختیاری) — «کلید API جدید». راز فقط **یک‌بار** نشان داده
   می‌شود؛ سرور فقط هش دارد. برای اتوماسیون از هدر
   `Authorization: Bearer fbt_sandbox_...` استفاده کن؛ فقط اسکوپ
   `manage_listings` اجازهٔ تغییر می‌دهد.
۳. **پیش‌نویس لیستینگ** — «پیش‌نویس جدید»: شناسه، نام، توضیح، زنجیره‌ها و
   حالت اجرا (ایجنت) یا سقف مبلغ/لغزش (استراتژی).
۴. **ارسال برای بررسی** — دکمهٔ submit روی همان کارت.

## گام ۴ — گواهی و انتشار

۵. **گواهی بده** — حالا که آیدی‌ات در allowlist است، کنسول بازبین ظاهر می‌شود:
   صف بررسی → «همین را گواهی کن» → نوع گواهی و شواهد (لینک https یا هش
   sha256) → «صدور گواهی».
۶. **منتشر کن** — برگرد به کارت لیستینگ → «انتشار». اگر گواهی فعال نباشد یا
   بعد از گواهی محتوا را عوض کرده باشی، سرور با `CERTIFICATION_REQUIRED` یا
   `CERTIFICATION_STALE` رد می‌کند و کارت هم دلیلش را می‌نویسد.

## گام ۵ — تأیید نهایی

```bash
curl -s https://fbtswap.ir/api/ecosystem/agents | jq '.meta.dataStatus, .data[0].verification'
```

انتظار: `"live"` و `"status": "certified"` با نام بازبین. حالا در اپ،
Intent OS → تب Agents باید همان کارت را با نشان «گواهی‌شده» و دکمهٔ «نمایش
شواهد» نشان بدهد.

---

## بعد از زنده‌شدن

- **ابطال گواهی** لیستینگ را در همان درخواست بعدی از کاتالوگ حذف می‌کند؛ لازم
  نیست چیز دیگری را هم باطل کنی.
- **ویرایش** یک لیستینگِ منتشرشده ممکن نیست؛ اول باید باطلش کنی. دلیلش عمدی
  است: عوض‌کردن محتوایی که بازبین گواهی کرده در حالی که نشان سر جایش بماند،
  سودمندترین حملهٔ ممکن است.
- **اعتبار** فقط از مشاهدات اجرای opt-in ساخته می‌شود و زیر ۵ نمونهٔ قطعی هیچ
  عددی نشان نمی‌دهد. هیچ endpointای اعتبار نمی‌پذیرد.
- **کرون روزانه** گواهی‌های منقضی را جاروب و snapshot اعتبار را بازسازی می‌کند.
- **قرارداد ماشین‌خوان**: `https://fbtswap.ir/api/openapi.json` — شامل بلوک
  `x-fbt-boundary` که همان‌جا اعلام می‌کند هیچ endpointای امضا/اجرا/تسویه/برداشت
  ندارد.

## خطاهایی که ممکن است ببینی

| کد | HTTP | معنی | کار درست / env |
|---|---|---|---|
| `REGISTRY_STORE_UNAVAILABLE` | ۵۰۳ | رجیستری پایدار پیکربندی نشده؛ نوشتن fail-closed | `BLOB_READ_WRITE_TOKEN` |
| `CERTIFIER_NOT_CONFIGURED` | ۵۰۳ | allowlist بازبین خالی است؛ هیچ‌چیز گواهی/منتشر نمی‌شود | `ECOSYSTEM_CERTIFIERS` — گام ۲ |
| `CERTIFIER_NOT_AUTHORIZED` | ۴۰۳ | آیدی تلگرام تو در allowlist نیست | گام ۱ و ۲؛ خط `ECOSYSTEM_CERTIFIERS=<id>:Label` |
| `CERTIFICATION_REQUIRED` | ۴۰۹ | انتشار بدون گواهی فعال | گام ۴ — کنسول بازبین |
| `CERTIFICATION_STALE` | ۴۰۹ | محتوا بعد از گواهی عوض شده | دوباره submit + گواهی تازه |
| `CERTIFICATION_NOT_FOUND` | ۴۰۴ | شناسهٔ گواهی ناشناخته | id را از صف/لیست گواهی‌ها بردار |
| `ENTRY_NOT_EDITABLE` | ۴۰۹ | ویرایش لیستینگ published/revoked | اول revoke → draft |
| `ENTRY_NOT_FOUND` | ۴۰۴ | لیستینگ نیست یا مال تو نیست | id و type را چک کن |
| `NOT_ENTRY_OWNER` | ۴۰۳ | لیستینگ مال حساب دیگری است | با همان حساب سازنده وارد شو |
| `ENTRY_ID_TAKEN` / `DUPLICATE_ENTRY` | ۴۰۹ | این id قبلاً ثبت شده | id یکتا |
| `INVALID_TRANSITION` | ۴۰۹ | این جابه‌جایی چرخهٔ عمر مجاز نیست | جدول draft→submitted→published→revoked |
| `TYPE_NOT_WRITABLE` | ۴۰۵ | liquidity فقط‌خواندنی است | ایجنت/استراتژی بنویس |
| `SCOPE_NOT_ALLOWED` | ۴۰۳ | کلید API اسکوپ `manage_listings` ندارد | کلید تازه با آن اسکوپ |
| `API_KEY_INVALID` / `API_KEY_REVOKED` | ۴۰۱ | کلید بدشکل/ناشناخته یا باطل‌شده | کلید تازه؛ راز فقط یک‌بار نشان داده می‌شود |
| `IDEMPOTENCY_KEY_REQUIRED` | ۴۰۰ | هدر `idempotency-key` نیست/نامعتبر | کنسول خودش می‌گذارد؛ در curl فراموش نکن |
| `IDEMPOTENCY_CONFLICT` | ۴۰۹ | همان کلید با payload متفاوت | کلید تازه برای درخواست تازه |
| `ECOSYSTEM_WRITE_RATE_LIMITED` | ۴۲۹ | بیش از بودجهٔ نوشتن (پیش‌فرض ۱۲/دقیقه) | هدر `retry-after`؛ `ECOSYSTEM_WRITE_RATE_LIMIT` |
| `FORBIDDEN_PERMISSION` / `AUTOMATIC_EXECUTION_FORBIDDEN` | ۴۰۰ | `withdrawFunds` / `executeWithoutUser` / `automaticExecution` | این فیلدها هرگز پذیرفته نمی‌شوند |
| `EVIDENCE_REQUIRED` | ۴۰۰ | گواهی بدون شواهد قابل‌بررسی | لینک https یا هش sha256 |
| `AUTH_REQUIRED` داخل تلگرام | ۴۰۱ | نشست Mini App تأیید نشده | **گام ۰.۵** + `/api/telegram/diagnose` |
| `BAD_SIGNATURE` / `EXPIRED` / `NO_INIT_DATA_SENT` | — | تشخیص کلاینت از diagnose | Menu Button همان ربات؛ نشست تازه |

کنسول توسعه‌دهنده زیر هر کد ردشده یک **hint ترجمه‌شده** نشان می‌دهد
(`dev.console.hint.*`) تا لازم نباشد این جدول را حفظ باشی.

## مرحلهٔ ۵ — بعد از زنده‌شدن کاتالوگ

کاتالوگِ گواهی‌شده تازهٔ شروع است. حلقهٔ اجرای واقعی ایجنت/استراتژی
(لیستینگ گواهی‌دار → intent → commitment سالور → auction → امضای کاربر در
کیف پول خودش → execution-claim → reputation) و مرزهای ثابتِ بدون
اجرای‌خودکار/برداشت/کاستدی در:

- `docs/ECOSYSTEM-REGISTRY-FA.md` → بخش **«مرحلهٔ ۵ — واقعی‌شدن ایجنت و استراتژی»**
- `docs/PHASE6-ACTIVATE-FA.md` → هشت آیتم env/مراسم/curl فاز ۶
- `docs/INTENT-ROADMAP-NEXT-FA.md` → چک capabilities لایو

تا کاربر در کیف پول خودش امضا نکرده، هیچ ایجنتی روی زنجیره اثری ندارد —
عمدی است، نه نقص.
