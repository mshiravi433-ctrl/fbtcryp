# فاز ۲۱۷ — تبدیل شدن RWA / سهام / فارکس / کالاها به «بومیِ هوش مصنوعی»

**تاریخ:** ۲۰۲۶-۰۹-۲۶
**شعبه:** `arena/01a0dc65-fbtcryp`
**پروب:** `node test/intent-ai/conditional-allocation-probe.mjs` → ۸۱/۸۱
**پرچم:** `CONDITIONAL_ALLOCATION_ENABLED` (پیش‌فرض: روشن)

---

## ۱. مسئله: صفحه داشتیم، زبان نداشتیم

جملهٔ پذیرش این فاز:

> «اگر طلا ۵٪ اصلاح کرد و BTC هم بالای ۶۵۰۰۰ بود، ۱۰٪ سرمایه را به طلا اختصاص بده.»

فهمیدن این یک جمله یعنی فهمیدنِ **شش چیزِ همزمان**:

| لایه | مثال از جمله |
|---|---|
| دارایی | GOLD (طلا) |
| داراییِ بین‌کلاسی | BTC (کلاس دیگر) |
| پرتفوی | «۱۰٪ **سرمایه**» — عددِ کاربر نیست، سهمی از دارایی اوست |
| ریسک | «۵٪ اصلاح» یعنی افتِ درصدی، نه یک قیمت |
| شرط | دو شرط، با AND، روی دو کلاس |
| تخصیص | «اختصاص بده» یک عمل است، نه سؤال |

وضعیتِ قبل از این فاز:

* واژگان داراییِ AI فقط کریپتو بود — `resolveAsset('طلا')` برمی‌گرداند `null`؛
* موتورِ پایش (`intentMonitoring.js`) فقط یک `coinId` از CoinGecko را می‌توانست تماشا کند،
  پس `GOLD` با خطای `UNKNOWN_ASSET` رد می‌شد؛
* آرایهٔ `conditions[]` روی رکوردِ مانیتور **ذخیره می‌شد و هرگز ارزیابی نمی‌شد**،
  یعنی یک دستورِ دوپایه بی‌سروصدا به یک پایگاه تک‌پایه تبدیل می‌شد؛
* RWA / سهام / فارکس / کالاها فقط در فاز ۲۱۵ واردِ **موتور تصمیم** شده بودند
  (قابل کشف، امتیازدهی و تخصیص) — اما هنوز نمی‌توانستند **موضوعِ یک Intent** باشند.

به عبارت دیگر: صفحه بود، اما زبانی که آن را براند نبود.

---

## ۲. معماری: پنج لایه، هر کدام با یک وظیفه

```
جملهٔ کاربر
   │
   ├─ 1. فهم          src/lib/intent-ai/conditionalIntent.js       (خالص، بدون شبکه)
   │                  + src/lib/intent-ai/crossAssetInstruments.js  (واژگان + منبعِ خواندن)
   │
   ├─ 2. خواندن        server/crossAssetPrice.js                    (crypto · macro · global)
   │
   ├─ 3. تصمیم         server/fios/conditionalAllocation.js         (TRIGGERED / WAITING /
   │                                                                 ARMING / UNREADABLE)
   ├─ 4. تخصیص         همان فایل: درصدِ سرمایهٔ واقعی → دلار
   │
   └─ 5. اجرا          همان دروازهٔ بروکر/آف‌رمپ که فاز ۲۱۵ ساخت
                       (بدون ارائه‌دهندهٔ تنظیم‌شده → فقط تحلیل)
```

### ۱) فهم — `conditionalIntent.js`

جمله به یک «چارچوب» (frame) تبدیل می‌شود:

```js
{
  logic: 'AND',
  conditions: [
    { asset: 'GOLD', assetClass: 'commodities',
      metric: 'PERCENT_CHANGE', operator: 'BELOW',
      threshold: -5, basis: 'DRAWDOWN_FROM_NOW' },
    { asset: 'BTC',  assetClass: 'crypto',
      metric: 'PRICE', operator: 'ABOVE',
      threshold: 65000, basis: 'ABSOLUTE' }
  ],
  action: { kind: 'ALLOCATE',
            target: { symbol: 'GOLD', assetClass: 'commodities' },
            sizePct: 10, sizeUsd: null, source: 'PORTFOLIO' },
  portfolio: { referenced: true, assumed: false },
  missing: []
}
```

**«۵٪ اصلاح کرد» یعنی `threshold: -5` و `operator: BELOW`** — نه «قیمت ≤ ۵».
این یکی از آن تبدیل‌هایی است که اگر برعکس نوشته شود، کل ویژگی غلط است.

### ۲) واژگان — `crossAssetInstruments.js`

هر سازه سه چیز دارد: نماد، کلاس، و **جایی که قیمتش از آن خوانده می‌شود**.

| کلاس | نمونه‌ها | مسیرِ خواندن |
|---|---|---|
| `crypto` | BTC, ETH, SOL, USDC, PAXG, XAUT | `providers.fetchSimplePrices` |
| `commodities` | GOLD, WTI (macro) · SILVER, BRENT, COPPER (global) | `macroData.js` · دامنهٔ global |
| `stocks` | SPX (macro) · AAPL, TSLA, NVDA, META, NDX … | دامنهٔ global (Avantis) |
| `forex` | DXY (macro) · EURUSD, GBPUSD, USDJPY | دامنهٔ global (Ostium) |
| `rwa` | RWA, TREAS, REALT | دامنهٔ global (Ostium) |
| `etf` | SPY, QQQ (global) · GLD, SLV, TLT (**بدون فید**) | `unreadable` |
| `funds` | MMF (**بدون فید**) | `unreadable` |

سازه‌ای که فید ندارد `read.kind === 'unreadable'` است. این یک نقص پنهان نیست؛
**همان چیزی است که اجازه می‌دهد موتور به‌جای شبیه‌سازی، رد کند.**

### ۳) خواندن — `crossAssetPrice.js`

سه مسیر، به ترتیبی که رجیستری اعلام می‌کند. هیچ عددی از «جایی» نمی‌آید:

* `crypto` → CoinGecko (همان ریلِ موجود)
* `macro` → `server/macroData.js` (stooq → yahoo → FRED؛ بدون کلید)
* `global` → دامنه‌های global-intel از طریق brain
* هیچ‌کدام → `{ ok: false, code: 'NO_FEED_FOR_INSTRUMENT' }` — هرگز عدد، هرگز مقدارِ دیروز

### ۴) تصمیم و تخصیص — `conditionalAllocation.js`

```
حالت‌ها:  TRIGGERED · WAITING · ARMING · UNREADABLE
```

* **یک فیدِ مرده کل دستور را `UNREADABLE` می‌کند.** «طلای ناخوانده را فرض کن اصلاح کرده»
  تصمیم نیست.
* **`PERCENT_CHANGE` بدون خط پایه مسلح (ARM) می‌شود و شلیک نمی‌کند.**
  خط پایه از اولین خواندنِ واقعی گرفته می‌شود؛ اختراعِ «قیمتِ دیروز» یعنی یک ماشهٔ ساختگی.
* **«۱۰٪ سرمایه» بدون خواندنِ سرمایه = `NO_CAPITAL_READ`.** درصد از یک مقدارِ
  ناشناخته، ۱۰٪ِ چیزی نیست؛ دعوتی است برای اختراعِ یک پرتفوی.
* **ریلِ ۴۰٪:** یک دستور بالای ۴۰٪ مسدود و علامت‌گذاری می‌شود
  (`ALLOCATION_ABOVE_RAIL`, `rail.blockedByRail`)، نه اینکه بی‌سروصدا اعمال شود.
* خروجی همیشه `requiresConfirmation: true, signs: false, simulated: false`.

### ۵) اجرا — همان دروازهٔ فاز ۲۱۵

بدون بروکرِ تنظیم‌شده:

> «این کلاس دارایی فقط تحلیل می‌شود، اجرا ندارد — broker/off-ramp provider برای commodities
> configure نشده است»

با بروکر: یک hand-off **امضا‌نشده** (`signed: false`). هیچ فیلِ شبیه‌سازی‌شده‌ای
در این ماژول وجود ندارد.

---

## ۳. اتصال‌ها

| لایه | تغییر |
|---|---|
| **مغز** (`src/lib/central/intent.js`) | نوعِ Intent جدید `CONDITIONAL_ALLOCATION` با مجوز `PREPARE` |
| **برنامه‌ریز** (`planner.js`) | قالبِ پلن: خواندن سرمایه + ریسک + هر کلاسی که جمله نام برده، و درِ تأیید |
| **طبقه‌بند کاربر** (`intentKinds.js`) | `CONDITIONAL_ALLOCATION` — و محافظِ «هر دو نیمه» که چه‌می‌شود و هشدار را نمی‌دزدد |
| **موتور پایش** (`intentMonitoring.js`) | `resolveMonitorAsset` (طلا دیگر `UNKNOWN_ASSET` نیست) + ارزیابیِ واقعیِ `conditions[]` با AND/OR |
| **چت** (`server/aiIntentOS.js`) | پاسخِ اختصاصی پیش از مسیریابِ سطح — با متنِ fa/en و کارت |
| **API** (`server/fios/router.js`) | ۵ مسیر تازه (پایین) |
| **رابط** (`IntentChatCards.jsx`) | کارتِ «تخصیص شرطی» که شرط‌ها و وضعیتِ هر کدام را نشان می‌دهد |

### مسیرهای تازه

```
GET  /api/ai/deep/instruments            رجیستری: چه چیزی قابل خواندن/پایش/تخصیص است
POST /api/ai/deep/conditional/parse      متن → چارچوب + پرسش‌های چیزی که کم است
POST /api/ai/deep/conditional/evaluate   چارچوب → TRIGGERED/WAITING/ARMING/UNREADABLE + پلن
POST /api/ai/deep/conditional/plan       «۱۰٪ سرمایه» الان چند دلار است
POST /api/ai/deep/conditional/watch      مسلح کردن در موتورِ پایش (دوپایه، AND/OR)
```

سرمایه از **خواندنِ مالیِ سمت سرور** می‌آید، نه از بدنهٔ درخواست — کلاینتی که بتواند
ارزش خالصِ خود را POST کند، می‌تواند هر اندازه‌ای را که بخواهد POST کند.

---

## ۴. آنچه این ماژول هرگز نمی‌کند

1. شرطی را که نتوانسته بخواند، شلیک نمی‌کند؛
2. درصد را بدون خواندنِ سرمایه به دلار تبدیل نمی‌کند؛
3. حد نصاب را حدس نمی‌زند — «اگر طلا اصلاح کرد» تبدیل به
   `missing: ['THRESHOLD']` و یک پرسش می‌شود، نه یک ۵٪ِ فرضی؛
4. امضا نمی‌کند، ارسال نمی‌کند، و ادعای پر شدن نمی‌کند؛
5. خط پایه نمی‌سازد — مسلح می‌کند و از خواندنِ بعدی مقایسه می‌کند.

---

## ۵. تست

```bash
npm run test:phase217        # ۸۱ بررسی
```

پروب این‌ها را اثبات می‌کند: رجیستری و صداقتِ فیدها؛ پارسِ فارسی و انگلیسیِ جملهٔ
پذیرش؛ عرضِ بین‌کلاسی (سهام+فارکس، RWA، OR)؛ پرسش به‌جای حدس؛ چهار حالتِ ارزیابی؛
تبدیل درصد به دلار از سرمایهٔ واقعی؛ ریلِ ۴۰٪؛ دروازهٔ بروکر (رد/باز، امضا‌نشده)؛
تبدیلِ دستور به **یک** مانیتورِ دوپایه که روی نیمی از دستور شلیک نمی‌کند؛
طبقه‌بندیِ مغز و اینکه چه‌می‌شود و هشدار جای خودشان می‌مانند؛ دروازهٔ پرچم؛
و اینکه چت پاسخ می‌دهد و غیرِ شرطی‌ها را نمی‌دزدد.

همچنین در `test/run.mjs` (به‌عنوان فرایندِ فرزند) ثبت شده است.

### عدم رگرسیون (اجرا شده)

`units` ۱۷۸۵/۱۷۸۵ · `quality-corpus` ۱۰۳۷/۱۰۳۷ · `fios-core` ۱۵۹/۱۵۹ ·
`fios-api` ۵۳/۵۳ · `phase212` ۶۸/۶۸ · `phase213` ۱۰۳/۱۰۳ · `upgrade7` ۱۵۵/۱۵۵ ·
`monitor-percent` ۱۸/۱۸ · `ops-center` ۵۰/۵۰ · `central-os` ۶۰/۶۰ ·
`loan-errors-l10n` ۲۱/۲۱ · `traditional-assets` (۲۱۵) ۲۴/۲۴

---

## ۶. یادداشت دربارهٔ «ارتقای IntentOS»

درخواست اولیه به «اپدیت هوش مصنوعی intentvos» اشاره داشت. چیزی به نام `intentvos`
در مخزن وجود ندارد؛ نزدیک‌ترین و به‌روشنی مقصود، **Intent OS** است
(`server/aiIntentOS.js` + `src/lib/intent-ai/`). این فاز همان لایه را ارتقا می‌دهد،
نه یک ماژولِ موازی.
