# Financial OS — اهداف مالی (Financial Goals)

> تب «برنامه سود» (Profit plan) در Intent OS حالا **Financial OS** است:
> کاربر هدف مالی می‌نویسد، سیستم محاسبه می‌کند، تخصیص می‌سازد و بعد از تأیید،
> آن را به **Intent OS موجود** تحویل می‌دهد. هیچ Execution Engine جدیدی ساخته نشده.

```
Goal → Analysis → Strategy → Allocation → Intent → Approval → Execution → Monitoring
       └─────────────── سرور (Backend) ───────────────┘          └── Intent OS موجود ──┘
```

---

## ۱. چه چیزی ساخته شد

| لایه | فایل | نقش |
| --- | --- | --- |
| موتور محاسبه (Pure) | `src/lib/financialGoalEngine.js` | Required Return، Allocation، Risk Score، سناریوها، Monitoring، Intent Payload |
| ذخیره‌سازی و منطق مسیرها | `server/financialGoals.js` | سه collection، مالکیت، رویدادها، Market snapshot |
| مسیرهای API | `server/app.js` | ۷ مسیرِ مشخص‌شده |
| کلاینت مرورگر | `src/lib/financialGoals.js` | صدا زدن API، scope دستگاه، بدون هیچ کلید |
| تحویل به Intent OS | `src/lib/financialGoalIntent.js` | Intent Payload → draft معمولی Intent OS |
| رابط کاربر | `src/components/FinancialGoals.jsx` | سه صفحه: My Goals / Build My Plan / Review Plan |
| استایل | `src/styles/intent-os.css` (بخش `fg-*`) | همان زبان بصری Intent OS |
| تست | `test/financial-goals-probe.mjs` | ۱۰۴ بررسی: موتور، ذخیره‌سازی، HTTP، ایمنی |

---

## ۲. API (فقط همین ۷ مسیر)

```text
POST /api/v1/financial-goals           ایجاد هدف
GET  /api/v1/financial-goals           فهرست اهداف
GET  /api/v1/financial-goals/:id       هدف + آخرین برنامه
POST /api/v1/financial-goals/:id/build-plan
POST /api/v1/financial-goals/:id/approve
POST /api/v1/financial-goals/:id/pause
GET  /api/v1/financial-goals/:id/progress
```

نمونه پاسخ `build-plan`:

```json
{
  "data": {
    "goal": { "id": "goal_…", "status": "DRAFT", "targetAmount": 20000 },
    "plan": {
      "requiredReturnPct": 25.99,
      "riskScore": 38,
      "allocation": [
        { "asset": "BTC",    "percentage": 24 },
        { "asset": "ETH",    "percentage": 14 },
        { "asset": "STABLE", "percentage": 32 },
        { "asset": "OTHER",  "percentage": 30 }
      ],
      "scenarios": [
        { "id": "bear", "ratePct": 0,     "projectedUsd": 10000 },
        { "id": "base", "ratePct": 1.1,   "projectedUsd": 10333 },
        { "id": "bull", "ratePct": 25.99, "projectedUsd": 20000 }
      ],
      "guarantees": { "returnsGuaranteed": false, "priceForecastIncluded": false }
    }
  },
  "meta": { "durable": false, "dataStatus": "unavailable", "market": { "live": false } }
}
```

نمونه پاسخ `approve`:

```json
{
  "data": {
    "intent": {
      "schema": "fbt.financial-goal-intent.v1",
      "source": "FINANCIAL_GOAL",
      "goalId": "goal_123",
      "actions": [
        { "type": "ALLOCATE", "asset": "BTC", "percentage": 24, "amount": 2400 },
        { "type": "ALLOCATE", "asset": "ETH", "percentage": 14, "amount": 1400 },
        { "type": "ALLOCATE", "asset": "STABLE", "percentage": 32, "amount": 3200 },
        { "type": "ALLOCATE", "asset": "OTHER", "percentage": 30, "amount": 3000 }
      ],
      "requiresUserApproval": true,
      "autonomousExecution": false,
      "secretsIncluded": false
    }
  },
  "meta": { "executed": false, "nextStep": "REVIEW_AND_SIGN_IN_INTENT_OS" }
}
```

---

## ۳. پایگاه داده

پروژه **بانک SQL ندارد** (API یک لایه‌ی Stateless روی داده‌ی عمومی بازار است)؛
بنابراین به‌جای migration، سه جدولِ خواسته‌شده به‌صورت سه namespace در
`server/store.js` (همان KV store که Vercel Blob یا حافظه‌ی موقت پشت آن است)
پیاده شده‌اند:

```text
financial_goals:<owner>         یک ردیف برای هر هدف
financial_goal_plans:<owner>    آخرین برنامه‌ی هر هدف
financial_goal_events:<owner>   تایم‌لاینِ Append-only
```

ستون‌های Goal دقیقاً همان‌هایی است که مشخص شده:

```text
id · userId(owner) · startingCapital · targetAmount · currency
targetDate · riskProfile · monthlyContribution · status · createdAt · updatedAt
```

**صداقت درباره‌ی ماندگاری:** بدون `BLOB_READ_WRITE_TOKEN` ذخیره‌سازی فقط
در حافظه‌ی همان instance است و با cold start پاک می‌شود. پاسخ هر مسیر
`durable` و `dataStatus` را برمی‌گرداند تا UI بتواند حقیقت را بگوید.

**مالکیت:** `req.tgUser.id` (نشست تلگرام، بین دستگاه‌ها) وگرنه هدر
`x-fbt-device` — یک شناسه‌ی تصادفی هر نصب که سرور پیش از نوشتن آن را hash
می‌کند. این **Scope است نه احراز هویت**؛ فقط اهداف آدم‌ها را از هم جدا می‌کند.

---

## ۴. محاسبات (همه در Backend)

```js
requiredCagr(starting, target, years)  =  (target / starting) ^ (1 / years) − 1
```

* وقتی «واریز ماهانه» داریم، نرخ مورد نیاز با **بای‌سکشن** روی همان فرمول
  حل می‌شود (`requiredReturnWithContributions`)؛ اگر واریزها به‌تنهایی کافی
  باشند، پاسخ `0%` است — نه عددی که ترسناک‌تر از واقعیت باشد.
* **Allocation Validation** دقیقاً همان تابع مشخص‌شده است و در سه نقطه صدا
  زده می‌شود: ساخت تخصیص، ذخیره‌ی برنامه و ساخت intent. جمعِ غیرِ ۱۰۰٪
  استثنا می‌اندازد و هرگز ذخیره نمی‌شود.
* **Risk Score** (۰–۱۰۰) از پروفایل ریسک، نرخ مورد نیاز، افق زمانی، پوششِ
  واریزها و شکافِ بازده محاسبه می‌شود و هر امتیاز در `riskFactors` توضیح
  داده می‌شود (هیچ عددِ بی‌منبعی وجود ندارد).
* **سناریوها پیش‌بینی نیستند:**
  * Bear = هیچ رشدی (فقط اصل سرمایه + واریزها)
  * Base = ادامه‌ی بازده‌ی زنده و Haircut‌شده
  * Bull = همان نرخِ مورد نیازِ خودِ هدف (یعنی «اگر هدف محقق شود»)
* **قیمت‌گذاریِ رمزارز پیش‌بینی نمی‌شود.** سهم رمزارزی «مواجهه با بازار» است
  نه درآمد؛ فقط بازده‌ی زنده‌ی صرافی‌ها (با همان ضریب احتیاطِ
  `multiVenuePlanner.js`) روی بخش Stable اعمال می‌شود. اگر فید مرده باشد،
  بازده `null` است، نه حدس.

---

## ۵. اتصال به Intent OS (بدون Execution Engine جدید)

```
Financial Goal → Financial Plan → Existing Intent OS → Existing Risk Engine → Existing Execution
```

`src/lib/financialGoalIntent.js` همان payload را با **همان توابع موجود**
(`compileIntent` → `saveCompiledIntent` → `ensureLifecycle`) به یک پیش‌نویس
معمولی تبدیل می‌کند و کاربر را به تب Compose می‌فرستد، جایی که از قبل
بررسی، امضا و اجرا زندگی می‌کنند.

* `ALLOCATE BTC` / `ALLOCATE ETH` → گام‌های `swap` در یک workflow (یا یک
  intent از نوع swap وقتی فقط یک سهم قابل معامله باشد).
* `ALLOCATE STABLE` → معامله‌ای نیست؛ همان داراییِ مبدأ است و در یادداشت
  گفته می‌شود.
* `ALLOCATE OTHER` → تبدیل به تیکرِ جعلی نمی‌شود؛ فقط گزارش می‌شود.
* اگر گامِ قابل معامله‌ای باقی نماند، draft ساخته نمی‌شود و علت گفته می‌شود.

هیچ امضای سروری، زمان‌بند یا برادکستی وجود ندارد. تست‌ها دقیقاً همین را
بررسی می‌کنند (`autonomousExecution === false`, `nextStep: REVIEW_AND_SIGN_…`).

---

## ۶. Monitoring

`GET /:id/progress` شش واقعیت را برمی‌گرداند:

```text
Current Value · Target Value · Progress % · Expected Path · Actual Path · Status
```

Statusها: `ON_TRACK · AHEAD · BEHIND · AT_RISK · COMPLETED · PAUSED`

* مسیرِ انتظار، مسیرِ مرکّبِ هدف است (هندسی، نه خطی).
* مقداری که کاربر گزارش می‌کند به‌صورت `VALUE_SNAPSHOT` در
  `financial_goal_events` نوشته می‌شود؛ تکرارِ همان عدد، ردیفِ جدیدی نمی‌سازد.
* اگر هنوز مبلغی گزارش نشده باشد، پاسخ `valueReported: false` می‌دهد و UI
  وضعیت را «مبلغی ثبت نشده» نشان می‌دهد — نه اینکه وانمود کند عقب هستید.

---

## ۷. AI و امنیت

* پارسِ «جمله‌ی طبیعی هدف» با قوانینِ قطعی روی دستگاه انجام می‌شود
  (`parseGoalFromText`)؛ چیزی که کاربر در کادر هدف می‌نویسد برای هیچ مدلی
  فرستاده نمی‌شود.
* هیچ کلید خصوصی، Seed Phrase، رمز عبور یا API Secret در هیچ لایه‌ای از این
  قابلیت خوانده یا ارسال نمی‌شود (`secretsIncluded: false` در payload).
* AI نمی‌تواند تراکنش اجرا کند چون مسیری برای اجرا وجود ندارد؛ تنها مسیر،
  همان Intent OSِ موجود با امضای کیف پول است.
* جای خالی برای مرحله‌ی بعد (توضیحِ استراتژی/سناریو با مدل) مشخص است، اما
  فعلاً متن‌ها از موتور قطعی می‌آیند تا هیچ عددی ساخته‌نشده نمایش داده نشود.

---

## ۸. اجرا و تست

```bash
npm run dev            # وب (5173) + API (8787)
npm run test:financial-goals   # ۱۰۴ بررسی
npm test               # کل مجموعه (شامل این مورد)
```

---

## ۹. مراحل بعد (انجام نشده، عمداً)

* DCA و Rebalancing خودکار روی همین Plan
* روایتِ توضیحی با مدل (Strategy / Scenario / Recommendation) با همان مرزِ
  «هیچ secretی به مدل نمی‌رود»
* گزارشِ ارزش فعلیِ خودکار از کیف پول متصل (الان مقدار یا دستی است یا از
  API با پارامتر `currentValueUsd`)
* مهاجرت به دیتابیس SQL در صورت نیازِ محصول (namespaceها همین‌طور می‌مانند)
