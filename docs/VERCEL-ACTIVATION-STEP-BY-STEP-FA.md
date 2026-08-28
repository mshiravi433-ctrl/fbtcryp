# FBT INTENT AI — فعالسازی کامل روی Vercel (گامبهگام)

تاریخ: ۲۰۲۶-۰۸-۲۸
وضعیت فعلی کد: ۹۱ فاز (۱۰–۱۰۰) پیادهسازی شده و منتشر میشود؛ ذخیرهٔ شواهد در Blob وصل است؛
پروبها ۱۳۳/۱۳۳ سبز هستند. **تنها چیزی که مانده ۹ شاهد عملیاتی است که باید از استقرار Vercel شما
بیایند.** این فایل دقیقاً همان چیزی است که باید وارد Vercel کنید.

---

## ۱) الان کدام وصل است و کدام نه؟

### ✅ از قبل وصل است (با deploy همین کد کار میکند — نیازی به تنظیم نیست)

| بخش | وضعیت |
|---|---|
| `GET /api/intents/v1/phase-status` — ۹۱ فاز ۱۰–۱۰۰، `specificationImplementedThrough: 100` | وصل |
| `GET /api/intents/v1/public-status` + `activation` + `freeze-status` | وصل |
| `GET /api/intents/v1/evidence-status` (با رکوردهای عمومی + `durable` + `storeKey`) | وصل |
| ذخیرهٔ خودکار شواهد در `intent-evidence/v1/operator-evidence.json` و بازیابی در cold start | وصل |
| خود-پروبها: `self-probe`، `ops-probe`، `stage3-probe`، `later-phase-probe` | وصل |
| تزریق شواهد اپراتور (dual-operator) + امضای امنیت مستقل (`stage3-review`) | وصل |
| کد UI: چت Intent OS (`/intent-ai`)، صفحهٔ Intent OS و نوار وضعیت، داشبورد فعّالسازی در Settings، «خروج شما» (فاز ۱۰۰)، Developer API | وصل |
| **تمدید خودکار شواهد در cron روزانه** (`/api/cron/daily` + نیاز به `CRON_SECRET`) | وصل (جدید) |

### ❌ وصل نیست — باید در Vercel وارد کنید (۹ شاهد باقیمانده)

| شاهد گمشده | چه چیزی لازم دارد | نوع |
|---|---|---|
| `approved-durable-registry` | `BLOB_READ_WRITE_TOKEN` | محیطی |
| `durable-immutable-audit` | `BLOB_READ_WRITE_TOKEN` (نوشتن و راستیآزمایی همین Blob) | محیطی |
| `rpc` | `RPC_URL` (HTTPS) | محیطی |
| `wallet-provider` | `VITE_WALLETCONNECT_PROJECT_ID` | محیطی |
| `certificate-authority` | دامنهٔ عمومی deploy (خودکار: `VERCEL_PROJECT_PRODUCTION_URL` یا `PUBLIC_ORIGIN`) + یک بار اجرای self-probe | خود-پروب |
| `venue-health` | دسترسی خروجی Vercel به binance/kraken/coinbase (معمولاً آزاد) | خود-پروب |
| `slo-measurement` | ≥۲۰ درخواست واقعی ترافیک در ۲۴ ساعت + uptime ≥ ۹۹٪ و p95 ≤ ۲ ثانیه | ترافیک |
| `bridge-provider` | یک quote واقعی deBridge DLN از سرور (egress آزاد) یا اجرای محلی و merge | ادغام |
| `independent-security-review` | کلید Ed25519 مستقل + امضای digest پکیج | خارجی |

> نکته: ۱۲ شاهد دیگر (سیمولاتور، مانیتور، شجولر، build، صیغور/کیف هوشمند/گاردین/بروکر، دریلهای بکاپ/رولبک/سندباکس/قرارداد) همین الان خودکار به دست میآیند.

---

## ۲) گامبهگام در Vercel

### گام ۰ — کد را deploy کنید (مهم!)

در `vercel.json` خط `"deploymentEnabled": { "arena/*": false }` وجود دارد؛ یعنی شاخهٔ
`arena/...` بهصورت خودکار deploy نمیشود.

- یا این تغییرات را به `main` مرج کنید (پیشنهادی)،
- یا در Vercel: `Deployments → … → Redeploy` از یک شاخهٔ دیگر/دستور `vercel --prod` از روی این کد.

بعد از deploy، این آدرس را باز کنید تا مطمئن شوید API بالا آمده:
`https://YOUR-APP.vercel.app/api/intents/v1/phase-status`

---

### گام ۱ — Environment Variables

در Vercel: **Project → Settings → Environment Variables → New** و برای هر مورد
**Environment: Production** را انتخاب کنید (Preview اختیاری است).

**الف) الزامی برای فعالسازی** (۴ متغیر):

| نام | مقدار/نحوهٔ ساخت | مثال |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel → **Storage → Blob → Create** → توکن را کپی کنید (با `vercel_blob_rw_` شروع میشود). | `vercel_blob_rw_...` |
| `RPC_URL` | یک endpoint از Alchemy/QuickNode (testnet: Arbitrum Sepolia `421614`؛ برای زنده: mainnet و بهروزرسانی شبکهها). | `https://arb1.arbitrum.io/rpc` |
| `VITE_WALLETCONNECT_PROJECT_ID` | از [WalletConnect Cloud](https://cloud.reown.com) → Project ID. | `a1b2c3...` |
| `CRON_SECRET` | هر رشتهٔ تصادفی ≥ ۱۶ کاراکتر — Vercel آن را بهصورت خودکار به کرونها میفرستد؛ بدون آن `/api/cron/daily` (که شواهد را تازه نگه میدارد) 401 میدهد. | `s3cr3t-random-...` |

**ب) اختیاری اما خیلی کمککننده:**

| نام | مقدار |
|---|---|
| `PUBLIC_ORIGIN` | اگر دامنهٔ سفارشی دارید: `https://your-domain.com`؛ اگر ندارید نگذارید (Vercel خودش production URL را تزریق میکند). |
| `ECOSYSTEM_CERTIFIERS` | `telegramUserId:Label` (از [@userinfobot](https://t.me/userinfobot)) برای فعال شدن کاتالوگ Agent/Strategy. |
| `INTENT_OPERATIONAL_EVIDENCE` | **فعلاً خالی بگذارید** — بعد از گامهای ۳–۶ با دستور اسمبلر پر میشود. |

**ج) هرگز الان نگذارید:**

| نام | چرا |
|---|---|
| `VITE_INTENT_BROADCAST_ENABLED` | ارسال واقعی تراکنش — فقط بعد از تست روی testnet و با تأیید صریح کاربر؛ بدون آن محصول همچنان «authorized» و امن است. |

---

### گام ۲ — Save و Redeploy

`Settings → Environment Variables → Save` را بزنید، سپس **Deployments → Redeploy**.
صبر کنید build تمام شود (دستور build فایل `build:full` است و شامل `vite build` + landing است).

---

### گام ۳ — بررسی اولیه

```bash
curl -s https://YOUR-APP.vercel.app/api/intents/v1/evidence-status | jq '.evidence, .durable, .missing'
```

انتظار دارید: `durable: true` و تعداد ذخیرهها بیشتر از ۱۲ (بلافاصله بعد از boot حداقل
`approved-durable-registry` و `rpc` و `wallet-provider` باید اضافه شوند چون env ها را گذاشتهاید).
برای «اجباری» دوباره اجرا کردن خود-پروبها:

```bash
curl -s "https://YOUR-APP.vercel.app/api/intents/v1/self-probe?dry=1" | jq '.missing'
curl -s "https://YOUR-APP.vercel.app/api/intents/v1/ops-probe?dry=1" | jq '.missing'
curl -s "https://YOUR-APP.vercel.app/api/intents/v1/stage3-probe?dry=1" | jq '.missing'
```

---

### گام ۴ — سنجش واقعی (SLO و CA و Venue)

- **certificate-authority**: با اولین اجرای self-probe روی دامنهٔ واقعی به دست میآید.
- **venue-health**: به egress Vercel نیاز دارد؛ اگر `VENUE_UNAVAILABLE` بود، از کامپیوتر خودتان
  اجرا کنید (گام ۶).
- **slo-measurement**: حداقل ۲۰ نمونهٔ واقعی در ۲۴ ساعت + uptime ≥ ۹۹٪ + p95 ≤ ۲۰۰۰ms.
  کافی است چند دقیقه سایت را باز کنید/خزش کنید. سپس:

```bash
curl -s "https://YOUR-APP.vercel.app/api/intents/v1/self-probe?force=1" | jq '.earned, .missing'
```

(عملکرد cron روزانهٔ جدید هم همین را هر روز تکرار میکند؛ فقط SLO به ترافیک واقعی نیاز دارد.)

---

### گام ۵ — امنیت مستقل (`independent-security-review`)

این شاهد **خودگواهی نمیشود**؛ باید با کلید Ed25519 مستقل امضا شود:

۱) کلید بسازید و فقط **public SPKI** را ذخیره کنید (private را محرمانه نگه دارید):

```bash
node -e "
const { generateKeyPairSync, createPublicKey } = require('node:crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
console.log('INTENT_INDEPENDENT_REVIEWERS=reviewer-1:' + spki);
console.log('PRIVATE_PEM:'); console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
"
```

۲) `INTENT_INDEPENDENT_REVIEWERS=reviewer-1:<spki>` را در Vercel بگذارید و redeploy کنید.

۳) digest پکیج را بگیرید:

```bash
curl -s https://YOUR-APP.vercel.app/api/intents/v1/stage3-review-package | jq -r '.digest'
```

۴) همان ۳۲ بایت digest را (نه رشتهٔ hex) امضا کنید (با private PEM خودتان در `sign.mjs`):

```bash
node -e "
const { createPrivateKey, sign } = require('node:crypto');
const key = createPrivateKey(process.env.REVIEW_PRIVATE_KEY_PEM);
const digest = Buffer.from(process.env.PACKAGE_DIGEST, 'hex');
console.log(sign(null, digest, key).toString('hex'));
"
```

۵) ارسال:

```bash
curl -X POST https://YOUR-APP.vercel.app/api/intents/v1/stage3-review \
  -H 'content-type: application/json' \
  -d '{"reviewerId":"reviewer-1","signature":"<hex>","algorithm":"Ed25519","independent":true,"signed":true}'
```

۶) بررسی: `stage3-probe?force=1` باید `independent-security-review` را نشان دهد.

---

### گام ۶ — اسمبل نهایی و فعالسازی (یک دستور)

از کامپیوتر خودتان (که شبکه دارد و `npm install` انجام شده):

```bash
npm run activate:release -- --target https://YOUR-APP.vercel.app --env
```

- همهٔ رکوردهای موجود (شامل `evidence-status`، self/ops/stage3) را جمع میکند؛
- اگر `bridge-provider` از سرور نگرفت، `--external bridge.json` (رکورد از اجرای محلی
  `npm run evidence:collect -- --target https://YOUR-APP.vercel.app` یا stage3 محلی) اضافه کنید؛
- چیزی جعل نمیکند و فقط وقتی ۲۱/۲۱ شد exit code صفر میدهد.

خروجی: یک مقدار `INTENT_OPERATIONAL_EVIDENCE=[...]`. آن را در Vercel بگذارید و **Redeploy** کنید
(اختیاری اما تضمینی؛ راه جایگزین بدون env: اجرای `--submit --op1 A --op2 B` که رکوردها در Blob ذخیره میشوند).

---

### گام ۷ — تأیید نهایی

```bash
curl -s https://YOUR-APP.vercel.app/api/intents/v1/phase-status | jq '.launchAllowed, .evidence.status, .specificationImplementedThrough, .phaseCount'
# انتظار: true · "21/21" · 100 · 91

curl -s https://YOUR-APP.vercel.app/api/intents/v1/evidence-status | jq '.storedCount, .durable'
# انتظار: 21 · true
```

در اپ:
- صفحهٔ Intent AI: «System Active & Verified».
- Settings → Intent AI Activation: ۹۱/۹۱ implemented و «live» روشن.
- `executionActivated: false` و `rawCredentialsAllowed: false` **عمداً** همینطور میمانند؛
  هر تراکنش همچنان تأیید صریح کیف پول کاربر را میخواهد.

---

## ۳) نگهداری بعد از فعالسازی

- **شاهدها تاریخ انقضا دارند (۵–۶ ساعت برای رکوردهای محلی).** کرون روزانهٔ جدید
  (`/api/cron/daily`، ساعت ۰۹:۰۰ UTC) خود-پروبها را دوباره اجرا و snapshot را تازه میکند؛
  پس تا وقتی `CRON_SECRET` ست شده و سرویسها سالماند، ۲۱/۲۱ میماند.
- اگر provider ای از دسترس خارج شود، status صادقانه پایین میآید (fail-closed) — این درست است.
- هیچ کلید خصوصی، seed phrase یا رازی در هیچ پایانهای ذخیره/نمایش داده نمیشود.

## ۴) متغیرهایی که برای فعالسازی لازم نیستند

AI چت (`OPENROUTER_API_KEY`/`GEMINI_API_KEY`/`GROQ_API_KEY`)، پوش (`VAPID_*`/`FIREBASE_*`)،
بات تلگرام (`TELEGRAM_BOT_TOKEN`)، HODLHODL/CHANGENOW/DYDX و … محصولات جانبیاند و روی
فعالسازی Intent OS اثر ندارند.
