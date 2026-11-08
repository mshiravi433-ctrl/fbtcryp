# موتور فرصت هوش مصنوعی — «صفحه به مشکل خورد» / رفع

**تاریخ:** ۲۰۲۶-۱۱-۰۸ · **برنچ:** `arena/d8f9dc1d-fbtcryp`

## درخواست

> «در موتور فرصت هوش مصنوعی وقتی میزنی روش میگه صفحه به مشگل خورده و دوباره
> تلاش کنید ببین مشگلش کجاست»

## دو علت واقعی، هر دو با بازتولید

صفحه `/opportunities` دو راه جدا برای خراب شدن داشت و هر دو بازتولید شدند:

### ۱ · کارت با یک فیلد غیرمتنی کل مسیر را می‌انداخت

```
Error: Objects are not valid as a React child (found: object with keys {name})
```

`{o.chain}` وقتی فید `chain` را به‌شکل `{ name: 'Base' }` می‌دهد (آداپترهایی که
رجیستری شبکه دارند، `url` به‌شکل آبجکت از پروکسی، `symbol: 7` عددی، `apy: '12%'`).
یک `.map()` روی کارت‌ها هیچ مرزی بین یک ردیف بد و مسیر ندارد، پس یک ردیف خراب
**همه** کارت‌های سالم را با خودش به `RouteBoundary` می‌برد — یعنی همان
«این صفحه به مشکل خورد». همین‌طور اسکن کش‌شده در `localStorage` چهار برابر TTL
عمر دارد: ردیفی که نسخه قدیمی نوشته، در نسخه جدید خوانده می‌شود و شکلش تأیید نشده.

### ۲ · یک `null` در آرایه فید، خودِ اسکن را می‌انداخت

```
TypeError: Cannot read properties of null (reading 'symbol')
  at normalizeEmergingRows (src/lib/opportunity/feed.js)
```

`normalizeEmergingRows` / `normalizeWhaleRows` / `normalizeYieldRows` روی هر
عضوی از آرایه map می‌کردند. آرایه‌های فید از چند آداپتر به هم چسبیده‌اند و یک
`null` وسطشان آن‌قدر عادی است که باید عادی فرض شود. نتیجه: `runScan` رد
می‌شد و UI «اسکن انجام نشد؛ دوباره تلاش کنید» را نشان می‌داد — نیمهٔ دیگر همان
شکایت.

## چه تغییر کرد

| فایل | کار |
|---|---|
| `src/lib/opportunity/sanitize.js` (جدید) | `text()` / `httpUrl()` / `sanitizeOpportunityRow()` / `sanitizeScannerRow()` / `sanitizeScan()` — قرارداد «چه چیزی قابل کشیدن است» |
| `src/lib/brain/opportunityEngine.js` | `label()` روی هر فیلدی که کارت می‌کشد (`title`, `symbol`, `chain`, `protocol`, `type`, `direction`, `evidence`, `ref`); `num()` حالا `'7.4%'` و `'1,000,000'` را می‌فهمد; فقط `http(s)` مطلق می‌تواند مقصد دکمه شود |
| `src/lib/opportunity/feed.js` | `rows()` — هر عضو غیرآبجکت قبل از خواندن حذف می‌شود; همان قاعده `num()` |
| `src/lib/opportunity/tokenMatch.js` | یک `null` در لیست بازارها دیگر به نماد `"NULL"` تبدیل نمی‌شود |
| `src/hooks/useOpportunityEngine.js` | اسکن تازه **و** اسکن خوانده‌شده از کش، هر دو از `sanitizeScan` عبور می‌کنند؛ `readStoredOpportunity` هم |
| `src/components/opportunity/OpportunityCard.jsx` | همه فیلدهای کشیده‌شده با `text()` — یک فیلد خراب حالا یک «—» روی یک کارت است |
| `src/pages/Opportunities.jsx` | هر کارت داخل `SectionGuard` جدا (خرابی یک ردیف، بقیه را پاک نمی‌کند و با اسکن بعدی خودش را ترمیم می‌کند); ردیف‌های اسکنر هوشمند سانیتایز می‌شوند |
| `src/pages/OpportunityDetail.jsx` | همان قانون روی صفحه تحلیل عمیق |
| `src/lib/intent-ai/os/opportunityDashboard.js` | کارت فرصت داخل چت هم سانیتایز می‌شود (یک ردیف خراب نباید `/intent` را ببرد) |

## قواعد صداقت (دست‌نخورده)

- هیچ عددی ساخته نمی‌شود: فیلدی که متن نیست به `null` می‌رود و UI «—» نشان می‌دهد.
- آبجکتی که خودش را نام می‌دهد (`{ name: 'Base' }`) همان نام را نشان می‌دهد؛
  آبجکت بی‌نام چیزی نشان نمی‌دهد — نه `[object Object]`.
- `'7.4%'` همان ۷٫۴ است: درصد علامت قالب است، نه اطلاعات. ردیفی که قبلاً NaN
  می‌شد و از اسکن می‌افتاد، حالا با نرخ واقعی‌اش دیده می‌شود.
- فقط `https?://` مطلق مقصد دکمه می‌شود؛ `javascript:` و مسیر نسبی هرگز.

## تست

```
npm run test:opportunities
```

- `test/opportunity-engine-crash.test.jsx` (جدید، ۹ تست): خود سانیتایزر; اسکن
  موتور روی ردیف‌های خراب (و اینکه `'7.4%'` به ۷٫۴ تبدیل می‌شود، نه null);
  و **کل اپ در jsdom** با فید خراب در سه شکل (`hostile`, `wrong-root`, `nulls`)
  به‌علاوهٔ دیپ‌لینک به ردیفی که نسخه قدیمی در کش نوشته — هیچ‌کدام نباید کارت
  «این صفحه به مشکل خورد» را نشان دهند.
- کل `test:opportunities`: ۲۶ تست node + ۲۲ تست UI، همه سبز.
- `app-boot` و `chat-intel-bubble` هم سبز؛ بیلد تولیدی موفق.
