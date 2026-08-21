# چهار کار باقی‌مانده — با لینک مستقیم

سایت درست شد ✅ فقط چهار مقدار مانده.

سرور خودش الان می‌گوید چه چیزی کم است، پس حدس نمی‌زنیم:

```json
web  → missing: ["VITE_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]   ← ست نشده‌اند
fcm  → problem: "FIREBASE_PRIVATE_KEY is set (40 chars) but has
                 no BEGIN PRIVATE KEY header"                     ← غلط است
cron → cronSecretSet: false                                       ← ست نشده
```

**سه تا اضافه می‌کنی، یکی را تصحیح می‌کنی.**

---

# 📍 جایی که هر چهار مقدار می‌رود

**همین یک صفحه، چهار بار:**

🔗 **https://vercel.com/dashboard**

از آنجا: پروژهٔ **`fbtcryp-kkxi`** ← تب **Settings** ← منوی چپ **Environment Variables**

### نحوهٔ اضافه کردن یک متغیر نو

1. دکمهٔ **Add New** را بزن
2. کادر **Key** ← اسم متغیر (دقیقاً، حروف بزرگ، بدون فاصله)
3. کادر **Value** ← مقدار
4. **هر سه تیک** بخورد: `Production` ✅ `Preview` ✅ `Development` ✅
5. **Save**

### نحوهٔ تصحیح متغیری که از قبل هست

در لیست پیدایش کن ← **⋮** کنارش ← **Edit** ← مقدار را عوض کن ← **Save**

> ⚠️ **مهم‌ترین نکته:** اگر تیک **Production** نخورد، سایت اصلی آن متغیر را
> نمی‌بیند و **هیچ پیام خطایی هم نمی‌دهد** — فقط بی‌صدا کار نمی‌کند.

---

# ۱️⃣ تصحیح `FIREBASE_PRIVATE_KEY`

**برای نوتیفیکیشن اپ اندروید.** این تنها موردی است که ست شده ولی مقدارش غلط است.

## چرا غلط است

سرور می‌گوید مقدار فعلی **۴۰ کاراکتر** است. مقدار درست حدود **۱۷۰۰ کاراکتر** است.
۴۰ کاراکتر دقیقاً طول `private_key_id` است — یعنی خط بالایی را کپی کرده‌ای.

## 🔗 لینک

**https://console.cloud.google.com/iam-admin/serviceaccounts?project=fbtswap-36b13**

## قدم‌ها

1. اگر پروژه انتخاب نشده، بالای صفحه **`fbtswap-36b13`** را انتخاب کن
2. روی ردیف `firebase-adminsdk-fbsvc@fbtswap-36b13.iam.gserviceaccount.com` بزن
3. تب **KEYS**
4. کلیدی که با `dd3e2f8a` شروع می‌شود ← **🗑 Delete** ← تأیید
   *(چون در چت لو رفته و دسترسی کامل ادمین می‌دهد)*
5. **ADD KEY** ← **Create new key** ← نوع **JSON** ← **CREATE**
6. فایل در Downloads دانلود می‌شود — با ویرایشگر متن بازش کن

## کدام مقدار را بردار

این دو خط کنار هم‌اند:

```json
"private_key_id": "dd3e2f8a0523ec5103df0d304abfff716e70d976",     ← ❌ نه این
"private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq...   ← ✅ این
```

آن که با `-----BEGIN` شروع می‌شود و خیلی بلند است.

> **خبر خوب:** تست کردم سرور چه چیزهایی را تحمل می‌کند —
> `\n` تایپ‌شده ✅ ، Enter واقعی ✅ ، گیومهٔ اضافی ✅
> **تنها چیزی که مهم است: باید با `BEGIN PRIVATE KEY` شروع شود.**

## در ورسل

| Key | Value |
|---|---|
| `FIREBASE_PRIVATE_KEY` | کل مقدار `private_key` از فایل نو |

همان‌جا این دو را هم یک نگاه بینداز (سرور می‌گوید درست‌اند، ولی فایل عوض شده):

| Key | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | `fbtswap-36b13` |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-fbsvc@fbtswap-36b13.iam.gserviceaccount.com` |

---

# ۲️⃣ و ۳️⃣ دو کلید VAPID

**برای نوتیفیکیشن روی مرورگر.** هر دو از **یک صفحه** می‌آیند.

## 🔗 لینک

**https://console.firebase.google.com/project/fbtswap-36b13/settings/cloudmessaging**

*(اگر باز نشد: `console.firebase.google.com` ← پروژهٔ `fbtswap-36b13` ←
⚙️ کنار «Project Overview» ← **Project settings** ← تب **Cloud Messaging**)*

## قدم‌ها

1. اسکرول کن پایین تا بخش **Web Push certificates**
2. اگر ردیفی هست: **⋮** ← **Delete** *(در چت لو رفته)*
3. **Generate key pair** را بزن
4. حالا جدولی با دو ستون می‌بینی

## در ورسل

| Key | از کدام ستون | نشانه |
|---|---|---|
| `VITE_VAPID_PUBLIC_KEY` | **Key pair** | بلند، ۸۷ کاراکتر، با `B` شروع می‌شود |
| `VAPID_PRIVATE_KEY` | **Private key** | کوتاه‌تر، ۴۳ کاراکتر |

> ⚠️ به دومی **هرگز** پیشوند `VITE_` نده.
> هر متغیری که با `VITE_` شروع شود، داخل فایل جاوااسکریپتی که **همهٔ کاربران
> دانلود می‌کنند** کامپایل می‌شود. یعنی با آن پیشوند دیگر راز نیست، منتشر شده است.
> اولی عمداً `VITE_` دارد چون قرار است عمومی باشد — آن درست است.

**اختیاری ولی مفید:**

| Key | Value |
|---|---|
| `VAPID_SUBJECT` | `mailto:` + ایمیل خودت — مثلاً `mailto:mshiravi433@gmail.com` |

---

# ۴️⃣ ساختن `CRON_SECRET`

**این را هیچ‌جا پیدا نمی‌کنی — خودت می‌سازی.** لینکی ندارد.

## چرا لازم است

رمزی است که جلوی `/api/cron/daily` را می‌گیرد. بدون آن، هرکس آن آدرس را بداند
می‌تواند هر وقت خواست به **همهٔ کاربرانت** نوتیفیکیشن بفرستد.

## چطور بسازی

> من یکی ساختم ولی **عمداً اینجا نمی‌نویسمش** — هر چیزی که در این چت بیاید
> در تاریخچه ثبت می‌شود و دیگر راز نیست. همان قانونی که به تو گفتم،
> برای خودم هم صدق می‌کند.

قالب خاصی ندارد. یکی از این دو راه:

- **ساده‌ترین:** روی کیبورد حدود ۳۰ کاراکتر بی‌ربط تایپ کن — حروف بزرگ، کوچک، عدد، بدون فاصله
- یا در مرورگر برو به `random.org/passwords` و طولش را ۳۰ بگذار

شکلش باید چیزی شبیه این باشد (این را کپی نکن، فقط قالب است):
`k7Qm2xR9vT4nB8wL5pZ3hJ6yD1sF0g`

## در ورسل

| Key | Value |
|---|---|
| `CRON_SECRET` | رشته‌ای که ساختی |

**لازم نیست جایی یادداشتش کنی** — هیچ‌جای دیگری به آن نیاز نداری. اگر گمش کردی،
یکی نو بساز و همین متغیر را عوض کن.

---

# 🔴 قدم آخر — ریدیپلوی

**ورسل متغیرها را در زمان بیلد داخل خروجی می‌پزد.**
بدون این قدم، هر چهار کار بالا هیچ اثری ندارند و دقیقاً این‌طور به نظر می‌رسد
که بی‌فایده بوده‌اند.

🔗 **https://vercel.com/dashboard** ← `fbtcryp-kkxi` ← تب **Deployments**

1. روی **⋮** بالاترین ردیف بزن
2. **Redeploy**
3. تیک **«Use existing Build Cache»** را **بردار** ⚠️
4. دو تا سه دقیقه صبر کن تا سبز شود

---

# ✅ تست

🔗 **https://www.lawpoetics.ir/api/cron/status**

**باید این را ببینی:**

```json
{"web":{"configured":true,"subscribers":0,"missing":[]},
 "fcm":{"configured":true,"devices":0,"missing":[]},
 "cronSecretSet":true,"durableStorage":true,"canSend":false}
```

سه چیز را چک کن:

- `web.configured` → `true`
- `fcm.configured` → `true` **و فیلد `problem` ناپدید شده باشد**
- `cronSecretSet` → `true`

`subscribers` و `devices` صفر و `canSend` هم `false` می‌ماند — **طبیعی است.**
یعنی هنوز هیچ دستگاهی نوتیفیکیشن را روشن نکرده.

**تست واقعی:** در اپ برو تنظیمات ← نوتیفیکیشن ← روشن کن.
دوباره آدرس را باز کن — حالا `devices` باید `1` شود و `canSend` بشود `true`.

---

# اگر درست نشد

خروجی همان آدرس را برایم بفرست.

**فرستادنش کاملاً امن است** — این آدرس هیچ‌وقت مقدار کلیدها را نشان نمی‌دهد،
فقط اسم آن‌هایی که نیستند و توضیح مشکل.

خودِ فیلد `problem` مستقیم می‌گوید چه غلط است، همان‌طور که همین حالا گفت
«۴۰ کاراکتر است و هدر BEGIN ندارد».

---

# خلاصهٔ جدولی

| # | Key | Value از کجا | لینک |
|---|---|---|---|
| ۱ | `FIREBASE_PRIVATE_KEY` | فایل JSON نو ← `private_key` | [Google Cloud](https://console.cloud.google.com/iam-admin/serviceaccounts?project=fbtswap-36b13) |
| ۲ | `VITE_VAPID_PUBLIC_KEY` | ستون **Key pair** | [Firebase](https://console.firebase.google.com/project/fbtswap-36b13/settings/cloudmessaging) |
| ۳ | `VAPID_PRIVATE_KEY` | ستون **Private key** | همان لینک بالا |
| ۴ | `CRON_SECRET` | خودت تایپ کن، ۳۰ کاراکتر | — |

**همه در:** [vercel.com/dashboard](https://vercel.com/dashboard) ← `fbtcryp-kkxi` ← Settings ← Environment Variables ← هر سه تیک ← Save ← **Redeploy**
