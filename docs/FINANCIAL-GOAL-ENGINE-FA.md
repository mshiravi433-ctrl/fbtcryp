# Financial Goal Engine — Outlook · Probability · What-If · Simulator · Health · Evidence

> این سند، لایه‌ی جدید **Goal Engine** را توصیف می‌کند که روی **Financial OS موجود**
> اضافه شده. Financial OS قبلاً «هدف → بازده لازم → تخصیص → Intent → تأیید → اجرا»
> را داشت. این لایه، بخش‌هایی را که نقشه‌ی «Intent OS → Goals» خواسته بود اضافه می‌کند:
> **احتمال رسیدن، رنج تخمینی، What-If، Goal Simulator، Goal Health و Evidence**.
>
> نکته‌ی مهم: این لایه فقط **محاسبه** است. هیچ اجرا، امضا، custody یا پیش‌بینیِ قیمت
> در آن نیست. UI و مسیرهای API برای بعد.

---

## ۱. مرزِ صداقت (قبل از هر عدد)

موتورِ `financialGoalEngine.js` از قبل یک **Honesty Contract** دارد:
«قیمت‌گذاریِ رمزارز پیش‌بینی نمی‌شود». این لایه همان مرز را حفظ می‌کند، **اما** با یک
تصمیم صریح که با شما تأیید شد:

- **احتمال رسیدن و رنج تخمینی، «پیش‌بینی» نیستند.** آن‌ها خروجیِ یک **مدل فرض‌محور**
  هستند؛ مدل، سه سناریوی Bear/Base/Bull را به‌عنوان صدکِ‌های ۱۰٪ / ۵۰٪ / ۹۰٪ از یک
  باندِ لگ‌نرمال می‌گیرد.
- **فرض‌ها قابل مشاهده و قابل‌تغییرند.** `percentiles` (پیش‌فرض `{bear:0.10, base:0.50, bull:0.90}`)
  پارامتر ورودی است و در خروجی برمی‌گردد. مهندس/UI می‌تواند آن را تغییر دهد، ولی هرگز
  پنهان نمی‌شود.
- **اگر یک سناریو گم باشد، احتمال `null` است.** فیدِ مرده به‌صورت «مرده» گزارش می‌شود،
  نه اینکه با یک عددِ محتمل پر شود.
- **هیچ‌کس نمی‌گوید «حتماً می‌رسی».** تمام خروجی‌ها `guaranteed:false` و
  `priceForecastIncluded:false` (در پلن موجود) و `isForecast:false` (در outlook) دارند.

---

## ۲. چه چیزی ساخته شد (توابع pure در `src/lib/financialGoalEngine.js`)

| تابع | چه می‌کند | اسکیما |
| --- | --- | --- |
| `goalProbabilityFromScenarios` | احتمال رسیدن به هدف از سه سناریو، با م‌دل لگ‌نرمال صدک‌محور | — |
| `buildGoalOutlook` | «احتمال + رنج + کیفیت داده + فرض‌ها»؛ همان Goal Probability card | `fbt.financial-goal-outlook.v1` |
| `simulateWhatIf` | «اگر BTC -30٪» یا «اگر +$500 در ماه» → قبل/بعد | `fbt.financial-goal-whatif.v1` |
| `simulateGoal` | اسلایدر/جدول «مبلغ ماهانه ← احتمال» | `fbt.financial-goal-simulator.v1` |
| `goalHealth` | امتیاز سلامت، وضعیت On-Track/Drifting، و سه پیشنهاد اصلاح | `fbt.financial-goal-health.v1` |
| `planEvidence` | «چرا این پلن؟» + کیفیت داده + زمان به‌روزرسانی | `fbt.financial-goal-evidence.v1` |
| `dataQualityScore` | امتیاز ۰–۱ کیفیت داده با دلیل | — |
| `buildRiskStrategies` | سه استراتژی (محافظه‌کار/متعادل/تهاجمی) با Expected Return و Max Drawdown | `fbt.financial-goal-strategies.v1` |
| `futuresExposure` | سقف پوشش آینده‌نگر (۰–۵٪ توصیه‌شده، حداکثر ۱۰٪) با هشدار صادقانه | `fbt.financial-goal-futures.v1` |

همه‌ی این توابع **pure** هستند: هیچ شبکه، storage، wallet یا secretی را لمس نمی‌کنند؛
بنابراین همان کدی که در UI تست می‌شود، دقیقاً همان کدی است که API می‌تواند سرو کند.

---

## ۳. خروجیِ نمونه (Goal Probability card)

برای هدف «۱۵٬۰۰۰ → ۱۰۰٬۰۰۰ در ۳۶ ماه» با داده‌ی زنده (بازدهی ۴٪ و کیفیت کامل):

```json
{
  "schema": "fbt.financial-goal-outlook.v1",
  "targetAmount": 100000,
  "currentValueUsd": 42000,
  "scenarios": [ { "id": "bear", "projectedUsd": 42000 }, { "id": "base", "projectedUsd": 42951 }, { "id": "bull", "projectedUsd": 279989 } ],
  "probabilityPct": 13,
  "range": { "bear": 42000, "base": 42952, "bull": 279989 },
  "dataQuality": { "score": 0.95, "scorePct": 95, "reasons": ["marketFeedLive", "yieldFeedLive"] },
  "assumptions": { "kind": "lognormal-quantile", "percentiles": {"bear":0.1,"base":0.5,"bull":0.9}, "rangeConfidence": 0.8 },
  "guaranteed": false,
  "isForecast": false,
  "note": "Estimate based on adjustable assumption bands (the three scenarios), not a forecast."
}
```

> این اعداد مربوط به **یک نمونه‌ی واقعی از موتور** است. احتمالِ ۱۳٪ برای یک هدفِ
> بسیار سخت (۱۵→۱۰۰ هزار در ۳ سال، بدون واریز ماهانه) کاملاً منطقی است. این دقیقاً
> همان چیزی است که نقشه‌ی شما می‌خواست: **به‌جای وعده‌ی «حتماً می‌رسی»، احتمال و
> رنج بده، نه عددِ جعلیِ خوش‌بینانه.**

---

## ۴. What-If

نمونه (هدفِ بالا، با سرمایه‌ی فعلی ۴۲٬۰۰۰):

```
What if crypto drops 30%?
  Goal Probability:  13% → 6%
  Expected Portfolio: −$10,206
  Risk:               ↑ up

What if I add $500/month?
  Goal Probability:  13% → 23%
```

تغییرات `{type:'market-shock', asset:'crypto'|'BTC'|'ETH', changePct:-30}` و
`{type:'contribution', monthlyDeltaUsd:500}` پشتیبانی می‌شوند. برای شوکِ بازار،
مواجهه‌یِ آن دسته (وزنِ BTC+ETH+OTHER برای `crypto`، یا وزنِ همان asset) از Allocation
خوانده می‌شود؛ بنابراین شوک فقط به همان سهمِ واقعیِ پرتفو اعمال می‌شود.

---

## ۵. Goal Simulator

```
Monthly → Target Probability
  $250 → 17%
  $500 → 23%
  $750 → 29%
  $1000 → 35%
  $1500 → 48%
```

تابع `simulateGoal` یک پاسِ واحد و پیاپی است؛ `rows[...]` به‌همراه `baseMonthlyUsd` و
`baseProbabilityPct` برمی‌گردد تا بتوانید اسلایدر را به حالتِ فعلی نقطه‌گذاری کنید.

---

## ۶. Goal Health

```
Goal Health  56/100   (path 40 + probability 35 + funded 25)
Status:  AHEAD   |   behind 0%
```

- **امتیاز ۰–۱۰۰** از سه عاملِ قابل‌اتکا: `path` (نسبت به مسیرِ مرکّبِ هدف)،
  `probability` (احتمال فرض‌محور)، `funded` (چقدر از هدف فعلاً پر شده). هر امتیاز در
  `factors` توضیح داده می‌شود.
- **اگر عقب افتاد** (`BEHIND` / `AT_RISK`)، `suggestions` سه گزینه‌ی محدود می‌دهد:
  `increaseMonthly` (چقدر واریزِ بیشتر لازم است)، `reduceTarget` (هدف را چقدر کم کند)،
  `extendTimeline` (چند ماه اضافه). هیچ‌کدام از این‌ها اجرا نمی‌کنند؛ فقط پیشنهادند.

---

## ۷. Evidence («چرا این پلن؟»)

`planEvidence` لیستی از حقایقِ محاسبه‌شده از خودِ پلن برمی‌گرداند (هیچ همبستگیِ ساختگی
یا دیدِ قیمتی ندارد):

```
 ✓ 36-month horizon
 ✓ Risk tolerance: MODERATE
 ✓ Required return: 89.82%/yr
 ✓ Stable reserve improves downside protection
 ✓ Portfolio concentration in BTC is elevated
 ✓ Yield gap: market yield below required return
 ✓ Goal probability: 13%
```

به‌همراه `dataQuality` و `dataUpdatedAt` (زمانِ به‌روزرسانی فید) و یک `caveats` که
یادآوری می‌کند «هیچ‌کدام پیش‌بینی قیمت نیست».

---

## ۸. تست

```bash
npm run test:goal-engine     # 54 بررسی: احتمال، outlook، what-if، simulator، health، evidence، strategies، futures
npm run test:financial-goals # 110 بررسی (شامل مسیرهای API و wiring جدید)
npm test                     # کل مجموعه
npm run build                # سبز
```

`test/financial-goal-engine-probe.mjs` قفل می‌کند:
1. **درستی** — احتمال با واریز بیشتر بالا می‌رود، با شوک بازار پایین می‌آید، simulator
   یکنواخت است.
2. **صداقت** — برچسب «assumption, not forecast»، سناریوی گم → `null`، و `guaranteed:false`.
3. **اتکاپذیری** — evidence از حقایقِ خود پلن ساخته می‌شود، نه از عددِ ساختگی.
4. **ریسک/آتی** — سه استراتژی (محافظه‌کار/متعادل/تهاجمی) به ۱۰۰٪ جمع می‌شوند و
   `futuresExposure` هرگز اهرم را به‌عنوان «بازده تضمینی» ارائه نمی‌کند.

---

## ۹. API و UI (اکنون ساخته شده‌اند)

موتور اکنون **از طریق HTTP و UI در دسترس است** و هر پاسخ `server-owned` است:

- **`POST /api/v1/financial-goals/:id/analyze`** → `{ outlook, health, evidence, strategies, futures }`،
  گوشه‌ی `meta` شامل `executed:false` و `nextStep:'REVIEW_AND_SIGN_IN_INTENT_OS'` است. هیچ‌چیز اجرا نمی‌شود.
- **`POST /api/v1/financial-goals/:id/what-if`** → `{ before, after, delta, warnings }`؛
  تغییرِ ناشناخته با `BAD_WHATIF_CHANGE` رد می‌شود.
- **`POST /api/v1/financial-goals/:id/simulate`** → `{ rows[], baseMonthlyUsd, baseProbabilityPct }`.

در UI (`src/components/FinancialGoals.jsx`) چهار کارت جدید روی پلن اضافه شده:
`GOAL HEALTH`، `PROFIT PLAN` (احتمال + رنج + سه استراتژی + سقف Futures)، `FORECAST`
(what-if + simulator). همه‌ی رشته‌های جدید در `src/i18n/locales/en.json` و `fa.json` موجودند.
هیچ‌کدام اجرا نمی‌کنند؛ مسیرِ اجرا همچنان «بررسی و امضا در Intent OS» است.

---

## ۱۰. عمداً انجام نشده (برای مرحله‌ی بعد)

- **اتصال به Wallet / Swap / Bridge / Lending / Farm/Futures** — این همان لایه‌ی
  Recommendation → Quote → Risk → Simulation → User Confirmation → Wallet Signature است و
  در Financial OS موجود به `Intent OS` سپرده می‌شود؛ این موتورِ pure هیچ‌کدام را اجرا نمی‌کند.
- **اجرای واقعی سقف Futures** — موتور عدد توصیه‌شده/حداکثر را می‌دهد؛ اعمالِ آن در
  لایه‌ی Execution است، نه این موتورِ pure.
