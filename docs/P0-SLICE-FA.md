# P0 — Wealth Hub (Slice ۱): ریاضی قسط، Hub Wealth، بَج پوشش صادقانه، Goal Card

تاریخ: **۲۰۲۶/۰۸/۲۵** (چهارشنبه، ۴ شهریور ۱۴۰۵)

این slice کوچک‌ترین slice قابل‌تحویل از فاز P0 است که در یک سشن
تمیز تمام می‌شود. هیچ عدد ساختگی، هیچ فیچر غیرفعال، در انتها هم `npm test`
و هم `npm run build` سبز.

---

## خلاصه

| کار | وضعیت |
|---|---|
| ریاضی قسط ماهانهٔ هدف (pure logic) | ✅ انجام شد + ۳۲ تست یونیت |
| `src/pages/Portfolio.jsx` به Wealth Hub ارتقاء یافت | ✅ انجام شد + پاس شدن wiring test |
| بَج «X از Y خوانده/قیمت‌شده» وقتی چندزنجیره‌ای EVM خوانده می‌شود | ✅ انجام شد |
| Goal Card با progress واقعی از total زنده + ریاضی قسط | ✅ انجام شد |
| `npm test` و `npm run build` | ✅ هر دو سبز |
| گسترش واقعی به Solana / dYdX / Ostium | ⚠️ صادقانه در اسکوپ این slice نبود — `useMultiChainPortfolio` هنوز EVM-only است (مستند در `useMultiChainPortfolio.js`) |
| اتصال واقعی Goal → DCA / vault واقعی | ⚠️ صادقانه در اسکوپ این slice نبود — فقط ریاضی و نمایش؛ اجرای approval-only در slice بعدی |

---

## ۱) ریاضی قسط — `src/lib/goalMath.js`

### مسیر حل

صورت مسئله: «موجودی X، هدف Y تا تاریخ Z، با سود سالانهٔ W، چقدر در ماه
بگذارم تا به Y برسم؟». فرمول استاندارد ارزش آیندهٔ سرمایهٔ موجود +
پرداخت دوره‌ای:

```
FV = PV × (1 + r)^n + PMT × ((1 + r)^n − 1) / r
PMT = (FV − PV × (1 + r)^n) / ((1 + r)^n − 1) / r)
```

r = سود ماهانه (annualYield / ۱۲)، n = ماه‌های باقی‌مانده (به پایین گرد
تا ماه تقویمی، نه تقریب ۳۰ روزه).

### مرزهایی که ریاضی رعایت می‌کند (و تست‌ها ثابت می‌کنند)

* **۰ ≤ progress ≤ 1.** ضروری: وقتی قیمت‌ها بالا می‌روند ولی هدف دیرتر
  تنظیم شده، ممکن است پرتفوی > ۱۰۰٪ باشد. نوار HUD باید به ۱ کلامپ شود،
  ولی عدد خام برای دیباگ نگه داشته می‌شود (تابع `unclamped`).
* **۰ ≤ annualYield ≤ 1.** اگر کاربر «۵۰۰٪» تایپ کرد، ریاضی منفی نمی‌شود؛
  ریاضی `null` برمی‌گرداند. سقف ۱۰۰٪ APR بالاتر از هر APY واقعی در
  venueهای curated است.
* **۰ < monthsRemaining.** اگر مهلت گذشته، `null` — نه بی‌نهایت، نه تقسیم بر
  صفر. UI می‌تواند «missed» صادقانه نشان دهد.
* **NaN/Infinity در هر ورودی** → `null`. `Number(null)` در JS = 0 (نه
  NaN)، پس اگر کاربر فیلد را خالی بگذارد، ۰ می‌شود، نه crash.
* **هدف over-funded (current ≥ target).** فرمول خطی `(t − c) / n` عدد
  منفی می‌دهد — اما «برداشت از هدف تأمین‌شده» دروغ است. ریاضی عدد را به ۰
  کلامپ می‌کند (نه منفی، نه NaN).

### تست‌ها

* ۳۲ تست یونیت در `test/units.mjs`، همه پاس می‌دهند.
* پوشش: شکل خطی، شکل رشد‌یافته (8% APR)، مهلت گذشته، yield نامعتبر، هدف
  تأمین‌شده، round-trip (PMT محاسبه‌شده با projection دوباره به target
  می‌رسد)، و edge caseهای مهلت در همان ماه (تقویمی، نه تقریب ۳۰ روزه).

---

## ۲) Wealth Hub — `src/pages/Portfolio.jsx`

### Hook هوشمند

```
const useMulti = Boolean(wallet?.address && typeof wallet.getReadProvider === 'function');
const single = useWalletBalances(useMulti ? null : wallet);
const multi = useMultiChainPortfolio(useMulti ? wallet : null);
const source = useMulti ? multi : single;
```

دلیل: `useMultiChainPortfolio` به `getReadProvider` نیاز دارد (که فقط
EVM wallet دارد). اگر wallet متصل نیست یا Solana wallet است، به همان
تک‌زنجیره‌ای قبلی می‌افتد. **هیچ رفتار قبلی نشکسته نشد.**

### بَج پوشش صادقانه

وقتی hook چندزنجیره‌ای فعال است و همه چیز کامل نیست:

```
[Partial coverage]
X of Y chains read · M of N holdings priced
```

این بَج در سه حالت سرکوب می‌شود (نباید دو سیگنال صداقت همزمان باشد):
1. وقتی همه چیز کامل است (هیچ زنجیره‌ای fail نشده، همه قیمت‌گذاری شده).
2. وقتی از hook تک‌زنجیره‌ای استفاده می‌شود (تک‌زنجیره‌ای خودش از
   `intel.partial` صادقانه می‌گوید).

### Goal Card

ساختار:
- اگر هدف ثبت نشده: دکمهٔ «ثبت هدف» + یک خط توضیح.
- اگر در حال ویرایش: سه فیلد (هدف USD / مهلت روز / yield اختیاری) + Save
  + Remove.
- اگر ثبت شده: progress bar واقعی از total زنده + متن وضعیت.

متن وضعیت (به ترتیب اولویت):
1. **missed** — اگر مهلت گذشته. یک خط صادقانه بدون عدد ساختگی.
2. **reached** — اگر total ≥ target. تبریک می‌گوید.
3. **funded** — اگر PMT = 0 شد (over-funded).
4. **requiredMonthly: X** — عدد واقعی از `goalMath`.
5. **noSchedule** — اگر PMT = null (مهلت همین ماه، یا yield نامعتبر).

### ذخیره‌سازی

هدف در `localStorage` تحت کلید `fbt-wealth-goal-v1` ذخیره می‌شود. اگر
storage در دسترس نباشد، silent fail می‌کند (catch) — هدف ناپدید می‌شود ولی
هیچ exception به سمت UI نمی‌رود.

### RTL و 360px

- دکمه‌ها هر دو `flex: 1` دارند → wiring test 31 پاس می‌شود (نه نقض
  «mix full-width with flex:1»).
- همهٔ spacing با `marginInlineStart` (RTL-safe) یا `gap` در flexbox
  (`row`).
- `minHeight: 44` روی دکمه‌ها و inputها (touch target).

### تست‌ها

- wiring test همهٔ static t() keyهای جدید را در en.json می‌بیند (پاس).
- wiring test 31 (دکمه‌ها) پاس می‌شود.

---

## ۳) کلیدهای i18n

به `en.json` و `fa.json` اضافه شد، نه به ۱۰ زبان دیگر (coverage.json قبلاً
خراب بود و اسکریپت gen-locales خراب است — همان‌طور که خود پرامپت گفته
بود، «رهاش کن»).

- `wealth.title` / `wealth.netWorth`
- `wealth.coverage.partial` / `wealth.coverage.reads` / `wealth.coverage.priced`
- `wealth.goal.*` (۱۱ کلید برای set/edit/empty/targetLabel/deadlineLabel/yieldLabel/save/remove/progressLabel/reached/noSchedule/funded/requiredMonthly/missed)

---

## چه چیزهایی را هنوز جا نزدیم (و چرا)

۱. **خوانش واقعی Solana / dYdX / Ostium.** پرامپت P0 این‌ها را در
   acceptance criteria گنجانده، ولی `useMultiChainPortfolio` EVM-only است
   و داکیومنت خودش می‌گوید (`useMultiChainPortfolio.js` خط ۲-۸). ساختن
   feedهای جداگانه برای Solana (RPC) و dYdX / Ostium (subgraph) یک کار
   جداگانه است. در slice فعلی فقط بَج «X از Y خوانده» به کاربر می‌گوید
   چه چیزی خوانده شده، نه چه چیزی خوانده نشده.

۲. **اتصال واقعی Goal → DCA / vault.** ریاضی قسط می‌گوید «این ماه
   $X بگذار» ولی اجرای واقعی (sign کردن تراکنش DCA از کیف پول کاربر)
   نیاز به:
   - یکپارچه‌سازی با موتور order موجود (`src/lib/orders.js`)
   - ساخت draft intent
   - تأیید کاربر

   این کار در slice بعدی P0 (یا شاید فاز P2) می‌آید.

۳. **Time Machine / Simulator / Score / Opportunities.** این‌ها
   scope فاز P1 هستند (به صراحت در پرامپت).

۴. **Brain / Regime detection.** فاز P1.

۵. **Strategy Composer / Memory / DNA / Sharing.** فاز P2.

۶. **Global Router / Firewall / Guardrails.** فاز P3.

---

## تغییرات

```
modified:   src/i18n/locales/en.json
modified:   src/i18n/locales/fa.json
modified:   src/pages/Portfolio.jsx
modified:   test/units.mjs
new file:   src/lib/goalMath.js
new file:   docs/P0-SLICE-FA.md
```

---

## Definition of Done (این slice)

- [x] `npm test` سبز (با ۳۲ تست یونیت جدید برای goalMath)
- [x] `npm run build` سبز
- [x] wiring test پاس می‌شود (t() keyهای جدید در en.json هستند؛ دکمه‌ها قانون ۳۱ را نقض نمی‌کنند)
- [x] همهٔ عددها واقعی یا «—» هستند (هیچ ساختگی)
- [x] 360px + RTL رعایت شده (gap/marginInlineStart، minHeight: 44)
- [x] fa + en برای همهٔ رشته‌های جدید
- [x] این گزارش فارسی
- [ ] merge به main → سشن بعدی (سشن فعلی یک slice است، نه فاز کامل)
