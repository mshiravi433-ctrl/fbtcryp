# بازطراحی صفحهٔ بازار — «نمای بازار»، سه باکس، بیت‌کوین شیشه‌ای (۲۰۲۶-۱۰-۳۱)

## خواسته

یک درخواست، شش بند، همه دربارهٔ همین یک صفحه:

1. باکس «نمای بازار» مدرن شود؛ یک فاصلهٔ کوچک.
2. سه باکس مدرن — «ارزها»، «بازارها»، «میانگین تغییر» — در یک خط افقی.
3. یک فاصلهٔ کوچک دیگر؛ باکس بیت‌کوین مدرن و شیشه‌ای.
4. بنر «ببین پول هوشمند کجا می‌رود» بسیار مدرن، با انیمیشن.
5. باکس «همه ارزها» از «نبض بازار» فاصله بگیرد؛ هر دو مدرن شوند.
6. باکس‌های دسته (میم‌کوین، …) از باکس بالای خود جدا شوند، مدرن، زیر تب، در یک راستای افقی و ریلی.
7. فهرست توکن‌ها جمع/باز شود؛ نمودار وسط؛ باکس توکن با فاصلهٔ کوچک از تب بالایی و شیشه‌ای؛ اندازه و فاصلهٔ درست؛ دکمهٔ سواپ با رنگ‌بندی درست.
8. بهترین و جذاب‌ترین UI/UX، و رسیدن به برنچ اصلی.

## ساختار نهایی

```
.mx-market
  .mx-overview                 ← «نمای بازار» (باکس ۱)
    .mx-deck        (#market-global-card)   ارزش کل، تغییر، سه متریک، دامیننس، نمودار ۷ روزه
    .mx-trio        (#market-trio)          سه باکس هم‌ارتفاع: ارزها · بازارها · میانگین تغییر
    .mx-btc-card    (#market-btc-hero-card) بیت‌کوین شیشه‌ای، وسط‌چین
  HotCoins                     (`market-hot-coins`)
  .mx-stories                  (`market-stories-rail`)
  SmartMoneyBanner             (`market-smart-money-banner`)
  .mx-lens         ← «نبض بازار» + ریل دسته‌ها (باکس ۲)
    .mx-lens-head              تازگی داده · رفرش · مقایسه
    .mx-sectors                ریل افقی snap، کاشی‌های ۴۲px، بدون ماسک
    .mx-breadth                نبض بازار
  .mx-terminal     ← «همه ارزها» (باکس ۳، با فاصلهٔ صفحه از لنز)
    .mx-list-hero              عنوان + شمارش + دکمهٔ جمع‌کردن
    MarketSearch
    .mx-controls               پنج چیپ نمایش + مرتب‌سازی
    #market-list-rows          ردیف‌ها
```

## تصمیم‌های طراحی

- **ریتم فاصله**: `--mx-gap` (۱۴px، روی موبایل ۱۲px) بین باکس‌های `mx-overview`، و همان
  فاصله بین `.mx-lens` و `.mx-terminal`. فاصله‌ها از padding داخلی کارت‌ها نمی‌آیند.
- **شیشه بدون blur**: هیچ `backdrop-filter`، هیچ `will-change` و هیچ `filter` زنده‌ای در
  شیت نیست. شیشه = چند لایه گرادیان + هایلایت داخلی + سایه.
- **بودجهٔ حرکت**: فقط `transform/opacity/scale/translate/rotate` در کی‌فریم‌ها. نور روی
  مسیر پول هوشمند با SMIL (`animateTransform` روی `gradientTransform`) حرکت می‌کند و در
  `prefers-reduced-motion`، `[data-native='true']` و `[data-lite='true']` پنهان می‌شود
  (نه pause).
- **جمع‌کردن فهرست**: یک چیپ روی خط عنوان، `aria-expanded` + `aria-controls`، ۱۲ ردیف در
  حالت جمع. شمارش سرصفحه همیشه تعداد واقعی است، پس فهرست جمع‌شده هرگز دربارهٔ طولش دروغ
  نمی‌گوید.
- **ریل دسته‌ها**: از داخل کارت «همه ارزها» بیرون آمد و زیر عنوان لنز نشست؛ اسکرول افقی با
  `scroll-snap-type: x proximity`، بدون mask، با محوشدگی رنگ‌شده در دو لبه.
- **RTL**: paddingهای افقی به `padding-inline` تبدیل شدند (کاشی دسته و ردیف توکن) تا در
  فارسی و انگلیسی هر دو درست بچینند.
- **تایپوگرافی/آیکن**: هیچ فلش یا تیک تایپ‌شده‌ای در این مجموعه نیست؛ همه نشانه‌ها SVG
  هستند (`MarketGlyphs.jsx`، شامل `GlyphSectorRail`).

## i18n

کلیدهای تازه در هر ۱۲ locale (ar en es fa fr hi id pt ru tr ur zh):

`marketIntel.deckEyebrow`, `statCoins`, `statMarkets`, `statAvg`, `allCoinsTitle`,
`sectorsTitle`, `railLabel`, `railTools`, `flowWallet`, `flowRouter`, `flowTarget`,
`smartLive`, `pool.{whales,institutions,newPools}`, `listCollapse`, `listExpand`;
همچنین `market.sector.{gold,meme,rwa,ai,gaming,solana}` و `market.showMore`.

## تست‌ها

- `test/market-deck-redesign.test.jsx` — ۲۴ تست: ترتیب سند، سه باکس هم‌عرض، شیشهٔ بدون
  blur، دامیننس، کارت بیت‌کوین، مسیر پول هوشمند، بودجهٔ حرکت، جمع‌کردن فهرست.
- `test/market-terminal.test.jsx`، `market-rail`، `market-intelligence`،
  `market-swap-dock`، `market-stories-and-aparat`، `market-decision-ui`،
  `market-pulse-dismissal` و `app-boot` — همه سبز.
- `node --test test/market-list.test.mjs test/market-speed.test.mjs test/market-search.test.mjs test/market-sector-regression.test.mjs` — ۲۸/۲۸.
- `test/responsive-layout-probe.mjs` به‌روزرسانی شد: دیگر انتظار داشبورد دوستونی
  `market-overview has-hero` ندارد (چون سه بخش حالا سه هم‌عرض پشت‌سرهم‌اند) و به‌جایش
  ساختار تک‌باکسی و شبکهٔ شیشه‌ای دوستونی ردیف‌ها را pin می‌کند.

## پیش‌نمایش محلی

بدون دسترسی به CoinGecko/CoinLore در این محیط:

```
node scripts/preview-market-demo.mjs                       # API قطعی روی :8799
API_TARGET=http://localhost:8799 npx vite --host 0.0.0.0   # اپ روی :5173
```

`test/fixtures/market-demo-feed.js` و `scripts/preview-market-demo.mjs` هیچ‌کدام از
`src/` ایمپورت نمی‌شوند و به باندل نمی‌رسند.
