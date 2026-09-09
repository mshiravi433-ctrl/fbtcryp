# PHASE 211 — FBT INTENT OS · GLOBAL AI INTELLIGENCE

**فاز ۲۱۱: ارتقای مغز هوش مصنوعی به هوش جهانی — بدون حذف هیچ صفحه و قابلیتی.**

> قانون مطلق این فاز اجرا شد و اثبات شد:
> `removedRoutes.length === 0` — در frontend، در navigation چت، در mountهای backend،
> در تمام routerهای `server/` و در مسیرهای Financial Intelligence.
> شاهد: `docs/phase211/routes-before.json` ← `docs/phase211/routes-after.json` +
> خروجی diff در `docs/phase211/phase211-route-diff.json`.

---

## ۱) این فاز چه شد؟

فاز ۲۱۰ به Intent OS یک «مغز مالی» روی دنیای **کاربر** داد: کیف پول، پرتفوی،
هدف، ریسک. فاز ۲۱۱ همان مغز را به **دنیای جهانی که پول کاربر در آن زندگی
می‌کند** وصل می‌کند — بدون ساخت سیستم AI دوم و بدون حذف هیچ چیز:

```text
FBT APP (Wallet · Swap · Trading · Farm · Lending · Futures · Bridge ·
         Orders · Portfolio · Goals · Monitoring · Smart Money · Research ·
         RWA · Markets · Stocks · Forex · Commodities · … همه سر جایشان)
        │
        ▼
FBT INTENT OS  ──Financial Intelligence OS (فاز ۲۱۰)──►  GLOBAL INTELLIGENCE (فاز ۲۱۱)
        │                                                   │
        │                                    smart money · whales · on-chain
        │                                    news · macro · stocks · forex
        │                                    commodities · RWA · cross-asset
        ▼                                                   ▼
   EXECUTION FIREWALL (برای همیشه بدون کلید و بدون امضا)   BRIEFING فعال
```

## ۲) معماری — Provider → Normalizer → Intelligence → World Model → Research → Strategy → Decision

هر قابلیت جدید اول در معماری AI نشست، بعد به UI وصل شد:

### ۲.۱ Global Intelligence Engine — `server/fios/globalIntel.js` (جدید)

نُه دامنهٔ هوش، هر کدام با پوشش honest-UNAVAILABLE:

| دامنه | منبع (همان ماژول‌های موجود repo) | مسیر |
|---|---|---|
| smart_money | `server/smartMoney/index.js` → `getOverview` | provider seam مثل research |
| whales | `server/whales.js` → `cachedWhales` | provider seam مثل research |
| onchain | `server/chainIntel.js` → health + activity | provider seam |
| news | سکشن `news` مغز مرکزی؛ fallback: `server/news.js` | اول state store |
| macro | **طبقه‌بندی** تیترهای واقعی خبر (Fed/ECB/CPI/GDP/…) | normalizer خالص |
| stocks | `brain.directToolCall('stocks','read')` → Avantis | **از خود مغز** |
| forex / commodities / rwa | `brain.directToolCall('forex'/'commodities'/'rwa','read')` → Ostium | **از خود مغز** |

نکتهٔ معماری: برای بازارهای جهانی **دومین gateway ساخته نشد** — موتور جهانی
از همان مغز مرکزی می‌خواند (همان `guarded` sources با health ledger و
stale-with-flag). سه دامنهٔ اول (که ماژول مغز ندارند) از همان seam ای
می‌خوانند که موتور research فاز ۲۱۰ ساخته بود.

هر دامنه: `{ status, reason, source, at, confidence, data }` — ارائه‌دهندهٔ
مرده = `UNAVAILABLE` با دلیل، هرگز عدد ساختگی.

### ۲.۲ World Model — دامنهٔ هفتم: GLOBAL (`server/fios/worldModel.js`)

شش دامنهٔ فاز ۲۱۰ دست‌نخورده ماند؛ دامنهٔ `global` اضافه شد:
`smartMoney · whales · onchain · macro · stocks · forex · commodities · rwa · crossAsset`
— همه با پاکت provenance (source + at + freshness + confidence)، و
`untrusted: true` برای محتوای بیرونی (§49). digest مدل همچنان bounded (<1400)
ماند — فهرست missing در digest سقف‌دار شد (فهرست کامل روی خود مدل است).

### ۲.۳ Cross-Asset Intelligence — `server/fios/crossAsset.js` (جدید)

- **breadth** هر کلاس از تغییر ۲۴ساعتهٔ واقعی تک‌تک ابزارها
- **regime**: RISK_ON / RISK_OFF / LEANING / MIXED — با «رأی» هر کلاس و basis
- **divergences**: جفت‌کلاس‌های خلاف جهت با فاصلهٔ مشخص
- **correlations**: فقط با سری جفتی واقعی (≥8 مشاهده)؛ با یک snapshot صادقانه
  `UNAVAILABLE` می‌گوید — r ساختگی تولید نمی‌کند
- کلاس‌های فقط‌خواندنی (stocks/forex/commodities/rwa) برچسب می‌خورند: AI
  تحلیل می‌کند، ادعای خرید نمی‌کند

### ۲.۴ Proactive Briefing — `server/fios/briefing.js` (جدید)

چیزی که OS فکر می‌کند کاربر باید **قبل از پرسیدن** بداند، از ورودی‌های واقعیِ
همان پاس: guardian (emergency > critical)، پرتفوی (drawdown، تمرکز،
liquidation)، اهداف، نُه دامنهٔ جهانی، رژیم کراس-است، کالیبراسیون learning.
هر آیتم: `{ id, kind, priority, title, detail, evidence, action, source, at, confidence }`
با `action` فقطِ ناوبری. `executionAuthorized: false` — همیشه.

### ۲.۵ اتصال به موتورهای موجود (extend، نه duplicate)

- **Research** (`research.js`): kinds جدید `whale · onchain · forex · commodity · global`
  از دامنهٔ globalِ world model می‌خوانند (نوع‌های evidence جدید هم additive اضافه شدند)
- **Strategy** (`strategy.js`): هر پروپوزال با `globalContext` (regime، کلاس‌های
  مشاهده‌شده، توجه کلان، net flow پول هوشمند) و `globalNotes` سفر می‌کند
- **Decision** (`decision.js`): رکورد تصمیم `globalContext` + `globalSnapshotId`
  دارد؛ رژیم risk-off در `conditions` می‌نشیند (مشاهده، نه وتو — وتو کار policy است)

### ۲.۶ Migration v3 (`migrations.js`) + دو کالکشن جدید (additive)

`global_intelligence` و `briefings` به کالکشن‌ها اضافه شدند (کلیدهای جدا،
سقف‌دار). v3 فقط فیلد اضافه می‌کند (`executionAuthorized:false` و
`proactive:true`)؛ idempotent و بدون حذف داده.

### ۲.۷ API — چهار مسیر جدید (فقطِ افزودنی)

```text
GET /api/ai/global/intelligence   اسنپ‌شات نُه دامنه (?refresh=1)
GET /api/ai/global/briefing       بریفینگ فعال (?refresh=1)
GET /api/ai/global/cross-asset    رژیم + breadth + واگرایی‌ها + digest
GET /api/ai/global/providers      پنج چراغ آمادگی هر دامنه
```

هیچ مسیر موجودی تغییر نکرد — فهرست کامل مسیرهای FI: 44 → 48.

### ۲.۸ تعمیر mount در سرور self-hosted (باگ قبلی، رفعِ حفظ‌کننده)

روی سرور محلی/self-hosted، mountهای async (`/api/ai` فاز ۲۱۰ و `/api/brain`)
بعد از fallback فایل SPA در `server/index.js` ثبت می‌شدند و **کل سطح AI با
404 جواب می‌داد** — روی درختِ قبل از این فاز هم همین بود (`api/index.js`
ورسل fallback ندارد، پس فقط در production کار می‌کرد). رفع: نقطهٔ mount با
placeholder router **همگام** ثبت می‌شود و router واقعی بعداً روی همان نقطه
سوار می‌شود. هیچ مسیری تغییر نکرد — فقط قابل دسترس شدند. با سرور واقعی
تست شد: `/api/ai/health` (migrations v3) و `/api/ai/global/*` همه زنده؛ در
sandbox بدون شبکهٔ بیرونی، دامنه‌ها صادقانه UNAVAILABLE گزارش می‌شوند
(smart money و on-chain که سرویس واقعی دارند، زنده‌اند).

## ۳) UI — فقط افزودنی

- **صفحهٔ جدید `/ai-global`** → `src/components/ai/AiGlobalIntelligence.jsx`:
  چهار تب (بریفینگ · دامنه‌ها · کراس-است · ارائه‌دهنده‌ها) با همان زبان بصری
  AI Control Center، دوزبانه، «خوانده نشد» = خوانده نشد
- **یک tile جدید** در MoreSheet (هیچ tileای حذف نشد)
- **`/ai-global` در ROUTED_PATHS** چت — AI می‌تواند به آن ناوبری کند
- کلیدهای i18n `aiGlobal.*` در هر ۱۲ زبان

## ۴) تست‌ها

```bash
npm run test:phase211   # هر سه probe
npm run test:fios       # زنجیرهٔ کامل شامل فاز ۲۱۱ (همه سبز)
```

| probe | چه چیزی را ثابت می‌کند |
|---|---|
| `phase211-global-intelligence-probe.mjs` (49/49) | کل زنجیره با composition root واقعی: ۹ دامنه، UNAVAILABLE صادقانه با provider مرده، macro طبقه‌بندی‌شده (تیتر و URL اصلی)، world model global + provenance، کراس-است (regime/divergence/correlate دقیق)، research kinds جدید، globalContext روی strategy و decision، بریفینگ با اولویت و بدون مجوز اجرا، migration v3، ۴ مسیر API، امنیت (بدون کلید/امضا/اجازهٔ اجرا) |
| `phase211-routes-inventory-probe.mjs` (12/12) | **removedRoutes = []** در همهٔ سطوح + lazy importها resolve می‌شوند + مسیرهای FI حفظ شدند |
| `phase211-ai-global-panel-probe.jsx` (10/10) | صفحهٔ واقعی render می‌شود: ۴ تب، دامنهٔ unread با دلیل، پنج چراغ، empty-state صادقانه با API مرده، بدون fatal error |

رگرسیون فازهای قبلی (همه سبز پس از تغییرات): fios-core **158/158**،
fios-autonomy **64/64**، fios-intelligence **54/54**، fios-api **53/53**،
phase210 **39/39**، chat-route-contract **18/18**. بیلد production هم سبز است.

## ۵) قوانین امنیتی که وراثت گرفتند (§36/§50)

- موتور جهانی **read-only** است؛ برای بازارها فقط از مغز می‌خواند، کلید ندارد،
  امضا ندارد، `executionAuthorized` هرگز true نمی‌شود
- محتوای بیرونی (خبر/کلان) data است نه authority — پرچم `untrusted` با داده سفر می‌کند
- رژیم risk-off **conditions** می‌سازد، وتو نمی‌سازد — مرز authority همچنان policy engine است

## ۶) فایل‌های تغییرکرده / جدید

**جدید:** `server/fios/globalIntel.js` · `crossAsset.js` · `briefing.js` ·
`src/components/ai/AiGlobalIntelligence.jsx` · `scripts/phase211-route-inventory.mjs` ·
سه probe + `test/vite.phase211.mjs` · این سند

**افزوده (تغییر افزودنی):** `fios/index.js` (سیم‌کشی + globalIntelFor/crossAssetFor/briefingFor/health) ·
`fios/router.js` (۴ مسیر) · `fios/worldModel.js` (دامنهٔ global + digest) ·
`fios/research.js` (kinds جهانی) · `fios/strategy.js` (globalContext) ·
`fios/decision.js` (globalContext + conditions) · `fios/collections.js` (۲ کالکشن) ·
`fios/evidence.js` (۵ نوع evidence) · `fios/migrations.js` (v3) ·
`app.js` (رفع رقابت mount async — §۲.۸) ·
`App.jsx` (مسیر /ai-global) · `MoreSheet.jsx` (tile) · `chatRoutes.js` (nav) ·
۱۲ فایل locales · `package.json` (test:phase211 + زنجیرهٔ test:fios)

**حذف‌شده:** هیچ فایل، هیچ صفحه، هیچ route، هیچ قابلیتی. 🔒
