# FBT Rewards — Production Upgrade (پیاده‌سازی واقعی)

> مسیر داده: **FBT UI → Rewards API → Reward Engine → رویدادهای واقعی FBT → Blockchain/RPC → کیف پول کاربر**
> سند تکمیلی اقتصاد توکن: `docs/FBT-TOKEN-FA.md` (۱ امتیاز = ۱ FBT در صورت انتشار واقعی توکن).

این ارتقا، صفحهٔ «امتیاز و پاداش» را از یک جدول امتیازِ محلی به یک محصول واقعی تبدیل می‌کند:
سرور یک دفتر امتیازِ تأییدشده به‌ازای هر حساب نگه می‌دارد، رویدادهای فعالیتِ واقعی را
(یکتا، محدود، و در جاهایی که مدرک زنجیره‌ای وجود دارد راستی‌آزمایی‌شده) می‌پذیرد و
Level / Mission / Achievement / Referral / Claim را از همان دفتر می‌سازد — نه از چیزی جعلی.
تمام قوانین در `server/rewards/config.js` متمرکز است؛ موتور (`engine.js`) خالص است و هر عدد از کانفیگ می‌آید.

---

## FOUND (یافته‌ها — زیرساخت موجود که محصول روی آن سوار شد)

| بخش | چیزی که پیدا شد |
|---|---|
| کیف پول EVM | `src/context/WalletContext.jsx` — `address/chainId/chain/nativeBalance/getSigner` + اتصال Injected/WalletConnect/محلی |
| کیف پول Solana | `src/lib/solanaWallet.js` + `src/hooks/useSolanaWallet.js` + رویداد `solana:wallet-change` |
| RPC/بلاکچین | `server/chainIntel.js` (`rpcCall`/`solanaRpc`) + رجیستری `chainsLite` — بدون provider جدید |
| اتصال تلگرام | `server/telegramAuth.js` — حساب تأییدشدهٔ `tg:` به‌عنوان هویت دوم |
| هویت دستگاه | هدر `x-fbt-device` همان الگوی `src/lib/financialGoals.js` / `server/financialGoals.js` |
| ذخیره‌سازی | KV موجود (`server/store.js` + `blobCache.js` + `cache.js`) — بدون دیتابیس کاربران |
| کتابخانه‌های UI | `TabbedPage`, `SegIndicator`, `PageTransition`, `AnimatedNumber`, `InfoBox`, آیکون‌ها، i18n |
| سیستم امتیاز محلی | `src/lib/ranks.js` (TIERS/POINT_VALUES) + دفتر محلی `useAppStore` |
| مزایای واقعی | `src/lib/perks.js` + `src/lib/venueReferral.js` — کد تخفیف واقعی GMX/Avantis/UTEX |
| کد دعوت محلی | `ensureRefCode()` در `useAppStore` + پارامتر شروع بات تلگرام (`telegramBotStartAppUrl`) |

## REUSED (بازاستفاده — بدون دوباره‌سازی)

- **کلاینت API**: `src/lib/rewards/rewardsApi.js` از `apiBase` و الگوی `financialGoals.js` (هدر دستگاه، پاسخ `{ok,data,meta}`).
- **گزارشگر رویداد**: `src/lib/rewards/rewardsReporter.js` — صف localStorage سقف‌دار (۳۰ مورد، ۴۸ ساعت)، شست‌وشو در visibility/online، ارسال `wallet/chainId/txHash/refCode` به‌همراه رویداد.
- **راستی‌آزمایی زنجیره‌ای**: `server/rewards/verify.js` از `chainIntel` برای receipt با وضعیت موفق، تطبیق `from` با کیف پول، و رد txهای قدیمی/تکراری.
- **ترجمه**: صفحهٔ جدید از کلیدهای موجود `rank.*`، `perks.*`، `toast.*`، `earn.*` استفاده می‌کند و کلیدهای `rewards.*` به en/fa اضافه شد (فایل‌های ۹ زبانِ پاره‌ای خودکار از en می‌گیرند).
- **طراحی**: همهٔ بخش‌ها با کارت/کلاس‌های موجود و `PageTransition` ساخته شد؛ تب‌ها با `TabbedPage` (URL-محور).

## FIXED (باگ‌هایی که این ارتقا اصلاح کرد)

1. **`src/context/WalletContext.jsx` نمی‌توانست build شود** — انتهای فایل (در خود `main`، کامیت 374f9e3) یک قطعهٔ تکراریِ ناقص داشت (`ession, attachLocal … shortAddress …` دوباره) که `vite build` را با `Unexpected "]"` می‌شکست. قطعهٔ تکراری حذف شد؛ build سبز است. (این باگ مستقل از Rewards بود ولی هر buildی را در main می‌شکست.)
2. **دو سیستم امتیازِ واگرا**: دفتر محلی حالا سقف روزانه را از کانفیگ سرور (`DAILY_CAPS` از `server/rewards/config.js`) می‌گیرد و `syncServerPoints` کل را فقط بالا می‌برد — عددِ لحظه‌ای و عددِ سرور دیگر نمی‌توانند از هم فاصله بگیرند.
3. **مأموریت‌های «خواب»**: موتور مأموریت‌ها/دستاوردهایی را که اکشن‌شان `live:false` است (dydx/futures/lp/securityAnalysis) برنمی‌گرداند؛ صفحه هم چیزی را که موتور اجرا نمی‌کند تبلیغ نمی‌کند.
4. **متن سطح در کارت Level** — نمایش از `summary.level` سرور می‌آید، نه حدس محلی.

## CREATED (ساخته‌شده)

- `server/rewards/config.js` — LEVELS، ACTIONS (امتیاز/سقف/نوع/verify/qualifiesReferral)، MISSIONS، ACHIEVEMENTS، REFERRAL، CLAIM، FBT، FBT_BENEFITS — یک منبع حقیقت.
- `server/rewards/engine.js` — موتور خالص: ingest یکتا (fingerprint)، سقف روزانه بر اساس روزِ محلیِ رویداد، missions/achievements مشتق از شمارنده‌ها، level، referral attribution، claim nonce (هش‌شده/یک‌بارمصرف/منقضی).
- `server/rewards/store.js` — ۶ کلید KV سقف‌دار (جدول زیر).
- `server/rewards/verify.js` — راستی‌آزمایی EVM/Solana از طریق RPC موجود.
- `server/rewards/index.js` — روتر Express + نرخ‌محدودیت درون‌حافظه + `meta` با durability صادقانه.
- `server/app.js` — mount روی `/api/v1/rewards`.
- `src/lib/rewards/` — rewardsApi.js + rewardsReporter.js (صف و ارسال).
- `src/components/RewardsDashboard.jsx` + بازنویسی `src/pages/Rewards.jsx` — سه تب: **Dashboard / Earn / Ranking**.
- پوشش صفحه‌ها — رویدادهای واقعی (جدول EVENTS).
- `test/rewards-engine-probe.mjs` (۴۲ تست) و `test/rewards-api-probe.mjs` (۱۳ تست) + اتصال به `test/run.mjs` و اسکریپت‌های npm.
- `docs/REWARDS-PRODUCTION-FA.md` (همین سند).

## APIS (روتر `/api/v1/rewards`)

| متد و مسیر | کار |
|---|---|
| `POST /events` | دریافت رویدادهای واقعی (دسته ≤۲۵)؛ پاسخ: `credited/duplicate/capped` + `missionBonuses` |
| `GET /summary` | کل داشبورد در یک پاسخ (امتیاز، fbt، level، streak، missions، achievements، history، claim، utilities، referral) |
| `GET /missions` | مأموریت‌های امروز + مایل‌ستون + دستاوردها |
| `GET /level` | وضعیت سطح |
| `GET /referral` | وضعیت کد این حساب (bound؟ به چه کیف پولی؟) |
| `POST /referral/bind` | فعال‌سازی کد: امضای EIP-191 با کیف پول EVM (یا سشن تلگرام) |
| `GET /eligibility` | وضعیت Claim صادقانه |
| `POST /claim/prepare` | صدور nonce یک‌بارمصرف (فقط وقتی distributor پیکربندی شده باشد) |
| `POST /claim/simulate` | مصرف nonce با محافظت replay |

نکات امنیتی: هویت = تلگرام تأییدشده یا هدر دستگاه (راز نیست)؛ هر POST نرخ‌محدود است؛ هر رویداد یک‌بار برای همیشه؛ مدرک زنجیره‌ای قبل از اعتبار money-moving بررسی می‌شود؛ سرور هیچ کلید خصوصی ندارد، چیزی امضا/پخش نمی‌کند (non-custodial).

## DB TABLES (همه KV با سقف — «دیتابیس بزرگ فعالیت» وجود ندارد)

| کلید | محتوا و سقف |
|---|---|
| `rewards:v1:ledger:<owner>` | دفتر تجمیعی هر حساب: points، byAction، روزهای ۴۵ روز اخیر، firsts، streak، missionsDone، history ≤۲۵، refCode، referrals |
| `rewards:v1:seen:<owner>` | اثر انگشت یکتایی رویدادها — سقف ۳۰۰ |
| `rewards:v1:refcode:<CODE>` | کد دعوت → کیف پول/حساب تأییدشدهٔ مالک |
| `rewards:v1:refattr:<CODE>` | کیف پول‌های دعوت‌شدهٔ منتسب (سقف ۵۰۰/کد، ۲۰/روز) |
| `rewards:v1:refbind:<wallet>` | ایندکس معکوس کیف پول → کد خودش |
| `rewards:v1:nonce:<owner>` | هش nonceهای claim — سقف ۱۰، عمر ۱۵ دقیقه |

durability = همان KV موجود (Vercel Blob وقتی پیکربندی شده باشد؛ وگرنه per-instance — در `meta.durable` گزارش می‌شود).

## EVENTS (رویدادهای واقعیِ متصل — هر کدام فقط از مسیر موفقِ واقعی)

| اکشن (امتیاز) | نقطهٔ صدور (فایل) |
|---|---|
| `swap` (۱) / `firstSwap` (۳۰۰، یک‌بار) | `Swap.jsx` هر دو مسیر موفق (EVM + gasless) و `SolanaSwap.jsx` بعد از تأیید — موجود بود، حالا گزارش می‌شود |
| `bridge` (۶۰، سقف ۲۰/روز) | `Bridge.jsx`: موفقیت سرویس کراس‌چین (`sourceTxHash`) و مسیر مستقیم DLN (`sent.hash`) |
| `lending` (۸۰) `borrow` (۱۰۰) `repay` (۳۰) `withdraw` (۲۰) — سقف ۱۰/روز | `Loan.jsx` بعد از COMPLETED، با هش آخرین قدم اجرا |
| `goals` (۴۰، سقف ۱۰/روز) | `FinancialGoals.jsx` بعد از ساخت واقعی هدف در سرور — `refId: goal:<id>` (یک‌بار به‌ازای هر هدف) |
| `lab` (۱۵، سقف ۱۰/روز) | `useLabStore.js` کامل‌کردن سناریو — `refId: scenario:<id>` |
| `tokenAnalysis` (۲۵، سقف ۱۰/روز، هر سکه/روز یک‌بار) | `Signals.jsx` وقتی verdict واقعی آماده می‌شود — `refId: coin:<id>`، `perDay` |
| `dailyCheckin` (۱۵) + استریک | `useAppStore.claimDaily` (موجود) |
| `shareApp` (۳۰، سقف ۱/روز) | صفحه‌های اشتراک (موجود) |
| `connectWallet/backupWallet/enable2fa` (یک‌بار) | کوئست‌های موجود از طریق alias |
| `intentAiPlan` (۱۰) `intentAiExecuted` (۲۵) | `IntentAIPanel.jsx` — پلن قطعی و broadcast واقعی با txHash |
| `referralShare` (یک‌بار) | کوئست `inviteFriend` (موجود) |
| `referral` (۲۵۰/دوست) | موتور: اولین فعالیتِ واجدِ کیف پولِ دعوت‌شده → اعتبار به دفتر مالک کد |

اکشن‌های خواب (`lp`, `dydx`, `futures`, `securityAnalysis`) در کانفیگ تعریف شده‌اند ولی `live:false`
هستند: هیچ صفحه‌ای آن‌ها را به‌عنوان قابل‌کسب نمایش نمی‌دهد و موتور نمی‌پذیردشان.

## SMART CONTRACTS

- **قرارداد جدید deploy نشده و نباید هم بشود.** FBT توکن منتشرشده نیست (`FBT.tokenLaunched=false`).
- Claim واقعی نیازمند `FBT_REWARDS_DISTRIBUTOR_ADDRESS/CHAIN/TOKEN_ADDRESS` است؛ تا آن روز
  `/claim/prepare` و `/claim/simulate` فقط مسیر nonce را اجرا و `NOT_LAUNCHED` برمی‌گردانند — هیچ ادعای جعلی.
- «برداشت» هرگز از سمت سرور broadcast نمی‌شود؛ امضای نهایی در کیف پول کاربر انجام می‌شود (non-custodial).

## TESTS

- `npm run test:rewards-engine` → **۴۲/۴۲** (یکتایی، سقف روز، once، missions/milestones، achievements، streak، referral: self/duplicate/cap/attribution، claim nonce/replay، سطح‌ها)
- `npm run test:rewards-api` → **۱۳/۱۳** (HTTP: events/summary/missions/referral/bind/eligibility/claim؛ جداسازی حساب‌ها؛ rate limit؛ NOT_LAUNCHED صادقانه)
- هر دو داخل `npm test` (test/run.mjs) هم اجرا می‌شوند.
- `npx vite build` سبز (پس از اصلاح دمِ خراب WalletContext).

## STORAGE IMPACT

- افزودهٔ خالص: ۶ کلید KV سقف‌دار؛ هر دفتر ≤ چند کیلوبایت؛ روزها پس از ۴۵ روز حذف می‌شوند؛
  history ≤۲۵ ردیف؛ fingerprint ها ≤۳۰۰؛ صف کلاینت localStorage ≤۳۰ مورد/۴۸ ساعت.
- «هیچ دیتابیس بزرگی از فعالیت کاربران» ساخته نشده — طبق محدودیت طراحی.

## KNOWN LIMITATIONS

- هویت حساب = دستگاه یا سشن تلگرام (ساختار بدون ثبت‌نام موجود)؛ کیف پول «مالکِ» کد دعوت است نه کلِ دفتر.
- `lenient` بدون txHash (وقتی شبکه در دسترس نیست) با سقف روزانه اعتبار می‌گیرد؛
  گزینهٔ `requiresWallet` برای سخت‌گیری بیشتر در کانفیگ تعریف شده.
- رتبه/جدول عمومی وجود ندارد (حریم خصوصی و «بدون کاربر واقعی» — `rank.available=false` صادقانه نمایش داده می‌شود).
- ۹ زبان پاره‌ای به en برمی‌گردند؛ عربی پوشش کامل ندارد (وضعیت پیشین).
- mission/streak/تاریخچه در تب Ranking هنوز دفتر محلی دستگاه است؛ سرویس، history سرور (≤۲۰) را می‌دهد.

## PRODUCTION BLOCKERS (برای روشن‌شدن کامل)

1. **توکن FBT + قرارداد توزیع‌کننده** — برای Claim و بازار؛ تا آن روز همه‌چیز به‌صورت صادقانه `NOT_LAUNCHED` می‌ماند.
2. **Vercel Blob (یا KV بادوام) پیکربندی‌شده** — در غیر این صورت دفترها per-instance هستند و `meta.durable=false` گزارش می‌شود.
3. **بستن اکشن‌های خواب** — LP درون‌برنامه‌ای، پر کردن واقعی dYdX/Futures و اسکن امنیتی فعال، هرکدام با `live:true` + نقطهٔ صدور واقعی.
4. **تأیید تیم برای ارقام** — امتیازها/سقف‌ها/مأموریت‌ها همه در `server/rewards/config.js` یک‌جا قابل تغییرند (نیاز به کد ندارد).
