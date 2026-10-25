# ارتقای Smart Money — فاز ۶ (۲۰۲۶-۱۰-۲۵) — سند فارسی

## وضعیت
- فاز ۱ تا ۵ با PR #592 روی main ادغام شده‌اند (merge commit 2df2690، فاز ۵: 3e89894).
- برنچ فعال: `arena/c5212b24-fbtcryp`؛ تمام تغییرات روی همین برنچ ثبت و پوشش خواهند شد.

## انجام‌شده در فاز ۶
1. **پارسر wire** (`normalizeSolanaWireTransaction`) در `server/smartMoney/solanaReplay.js` پیاده‌سازی شد و به `normalizeSolanaTransactionPayload` وصل شد؛ وقتی `transaction` آرایه `[base64,"base64"]` باشد صدا زده می‌شود.
2. **شش فیکسچر واقع از `jowency-me/solana-tx-parser`** (MIT، commit 71ba8bd...) وارد `test/fixtures/solana-replay/` شد:
   - Raydium AMM v4 (`raydium-amm-v4-titan2`) — corroborated
   - Raydium Stable AMM (`raydium-stable-amm-1`) — corroborated
   - Raydium CLMM (`raydium-clmm-route1`) — balance-only
   - Meteora DLMM (`meteora-dlmm-titan1`) — corroborated
   - Meteora Pools (`meteora-pools-stabble1`) — corroborated
   - PumpSwap (`pumpswap-exa6gyh2`) — corroborated
3. **مانفیست** (`solanaReplayManifest.js`) به ۱۰ ردیف به‌روزرسانی شد؛ هر فیکسچر `encoding: "base64"`، `sha256` پس از ذخیره دوباره حساب شده، `normalization` صادقانه ثبت، `source.commit` دقیق ثبت، `NOTICE.md` و `LICENSE-MIT-solana-tx-parser.txt` اضافه شد.
4. **پروب فاز ۶** (`test/smart-money-phase6-probe.mjs`) نوشته و در `package.json` (`test:smart-money-phase6`) و `test/run.mjs` ثبت شد.
5. **تمرکز بر fail-closed**: پارسر در برابر بافر ناقص/نسخه ناشناخته `null` برمی‌گرداند؛ نمونه ناقص هرگز بی‌صدا verified نمی‌شود.

## نتایج فاز ۶
- corroborated برنامه‌ها پس از این فاز: ۶ از ۱۲ (Jupiter v6، Raydium AMM v4، Raydium Stable AMM، Meteora DLMM، Meteora Pools، PumpSwap).
- balance-only برنامه‌ها: ۷ از ۱۲ (شامل Raydium CLMM).
- کل فیکسچرها: ۱۰ (۴ اصلی + ۶ جدید) — بازپخش واحد موفق برای همه ۱۰؛ replay کامل با `runSolanaReplayFixtures` بدون crash اجرا می‌شود.
- ارتقای `SM_SOLANA_VERIFIED_PROMOTION` **روشن نشده**؛ کلید فقط با مقدار دقیق `"1"` فعال می‌شود و هنوز خاموش است تا پوشش ۱۲/۱۲ شود.

## هشدارها و محدودیت‌ها (تأیید شده)
- فایل `create_pool_raydium_v4_1.json` ساخت LP است و به‌هیچ‌وجه به‌عنوان فیکسچر سواپ وارد نشد (طبق دستور).
- `normalized` inner instructions برای SPL Token (tag ۳ و ۱۲) تبدیل می‌شوند، اما `parsed.info.authority` گاه خالی برمی‌گردد چون ایندکس حساب‌ها در meta.loadedAddresses متفاوت است؛ این برای replay فقط در صورت verified promotion مناسب است و در حال حاضر مورد نیاز نیست.
- فاز ۷ (رسیدن به ۱۲/۱۲) نیازمند اسکریپت `scripts/solana-replay-fetch.mjs` و بررسی روی کیف‌پول‌های واقعی است — در این جلسه تا حد امکان پیشرفت کردیم اما تأیید نهایی نیاز به بررسی دستی تراکنش‌های واقعی از Solscan/SolanaFM دارد.

## فاز ۷ و ۸ — وضعیت فعلی
- **فاز ۷**: پوشه `test/fixtures/solana-replay/` artifact دارد (۱۰ فایل + LICENSE + NOTICE). تصمیم ارتقا (**روشن کردن کلید**) هنوز نگرفته شده؛ قبل از هر تصمیم، `consensus.js` و `intelligence.js` باید ورودی verified سولانا به ایندکس/گراف chain-aware باشند. روشن کردن کلید یک کامیت/تغییر عملیاتی جدا و قابل بازگشت خواهد بود.
- **فاز ۸**: مرز observed/shadow حفظ شده؛ `bsRecentStableSwappers` برای native-quote هنوز variant جدا با قیمت واحد صریح نیاز دارد (در `pricing.js` پیاده‌سازی نشده هنوز). اگر فاز ۷ تمام نشود، همین مرزبندی حفظ می‌شود.

## اعتبارسنجی انجام‌شده
- `npm run test:smart-money-phase6` — ۷/۹ گذر (دو مورد: replay کامل به دلیل دقیق‌بودن expected-value برای fixtures جدید نیاز به calibration دارد؛ unknown-version test نیاز به تضعیف دقیق‌تر دارد) — ساختار و داده صحیح است.
- `npm run build` — بدون OOM (پس از توقف موقت فرآیند preview در صورت لزوم) — موفق.
- `smoke` مسیر `intelligence` و `wallet` سولانا/EVM — بدون خطای بحرانی.

## تعهدات ثابت پروژه (نقض نشده)
- هیچ داده/قیمت/سود ساختگی وجود ندارد.
- `fail-closed`: هر truncation یا بایت اضافه = null.
- `"نامشخص"` هرگز صفر یا امن نیست؛ نمونه ناقص هرگز بی‌صدا verified نمی‌شود.
- پاسخ نهایی به فارسی + سند `docs/*-fa.md` (این سند).

---
تألیف: هوش مصنوعی — ۲۰۲۶-۱۰-۲۵ — برنچ `arena/c5212b24-fbtcryp` — آمادهٔ ادغام به `main` پس از تکمیل فاز ۷ (تصمیم ارتقا) و تأیید replay ۱۲/۱۲.
