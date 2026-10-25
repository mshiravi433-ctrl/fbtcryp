# ارتقای Smart Money — فاز ۷ و ۸ (به‌روزرسانی — ۲۰۲۶-۱۰-۲۶)

## وضعیت فعلی

- **پوشش بازپخش واقعی**: ۷ از ۱۲ برنامه instruction-corroborated و ۷ از ۱۲ برنامه دارای balance replay هستند. پنج برنامه هنوز fixture corroborated ندارند: Jupiter v4، Raydium CPMM، Orca Whirlpools، Orca Token Swap و Meteora DAMM v2.
- **Corpus**: ۱۱ payload واقعی و pinشده با provenance و SHA-256؛ تمام fixtureها باید با `npm run test:smart-money-phase5` و `npm run test:smart-money-phase6` بازپخش شوند.
- **Promotion**: `SM_SOLANA_VERIFIED_PROMOTION` عمداً خاموش است. با وجود پیشرفت decoder و شواهد replay، corpus هنوز ۱۲/۱۲ نیست؛ دادهٔ shadow/observed وارد امتیاز، P&L یا consensus نمی‌شود.
- **فاز ۸ و اتصال chain-aware**: مسیرهای `consensus.js` و `intelligence.js` به‌روزرسانی شده‌اند تا وضعیت verified سولانا را به شکل chain-aware بررسی کنند؛ وجود این مسیر به‌تنهایی مجوز promotion نیست و کلید همچنان خاموش می‌ماند.

## تکمیل corroboration برای Raydium CLMM

یک تراکنش واقعی mainnet از fixture عمومی MIT در `Stan-lee13/graphite` با commit ثابت
`c087bfb502f5a5c13c12755c719faf54f6c4eec6` به corpus افزوده شد. دادهٔ اصلی
بدون تغییر در `test/fixtures/solana-replay/raydium-clmm-graphite.json` نگهداری
می‌شود و attribution و متن لایسنس در `test/fixtures/solana-replay/NOTICE.md`
و `LICENSE-MIT-graphite.txt` آمده است.

decoder اکنون علاوه بر instructionهای parsed، دادهٔ خام SPL `transfer` و
`transferChecked` را برای SPL Token و Token-2022 می‌خواند و انتقال‌های مرزی
wallet را با deltaهای خام balance تطبیق می‌دهد. شناسهٔ برنامهٔ Token-2022 نیز
در decoder، data source و probeها اصلاح شد. regression expectation برای signer
اول تراکنش چنین است:

- Raydium CLMM، `SELL`؛
- مقدار هدف خام `42552909` (۸ decimals)؛
- مقدار USDC خام `332216856` (۶ decimals)؛
- یک انتقال corroborated برای هر پا؛
- signature: `32CRDqR4Up49gPyg67VmqxAuJEYCtP7nYmRQUfjLbVgjs2e2YUev3StVDjPgsu72W7NRkfFJTk8iy5xUhPiT32yk`.

این شاهد، شکاف corroboration مربوط به Raydium CLMM را می‌بندد؛ جای پنج DEX
بی‌نمونه را پر نمی‌کند و هیچ دادهٔ ساختگی برای پوشش باقی‌مانده اضافه نشده است.

## ابزار دریافت fixture و مرز فاز ۸

اسکریپت `scripts/solana-replay-fetch.mjs` فقط با `--draft` فایل draft می‌نویسد؛
خروجی draft خودبه‌خود verified یا وارد corpus نمی‌شود. امضا، wallet و replay
باید با fixture و انتظار مستقل بررسی شوند.

در مسیر native-quote، قیمت واحد صریح حفظ شده است و `minUsd` نباید با مقدار خام
توکن مقایسه شود. مرز observed/shadow دست‌نخورده می‌ماند تا corpus کامل و
evidence کامل شود.

## اجرای اعتبارسنجی

- phase 2: **۱۱/۱۱**؛ phase 3: **۱۴/۱۴**؛ phase 4: **۱۵/۱۵**.
- phase 5: **۱۶/۱۶**، شامل replay موفق **۱۱/۱۱**؛ phase 6: **۹/۹**.
- phase 7–8: **۴/۴**؛ Smart Money intelligence evidence probe موفق؛ live-index: **۲۴/۲۴**؛ upgrade probe: **۹/۹**.
- `npm run build`: موفق؛ first-paint budget برابر `1708.91 KB / 1750 KB` و ۲۵۸ landing page تولید شد. هشدارهای bundle موجود باقی‌اند. `assetlinks.json` به دلیل نبود `FBT_ANDROID_SHA256` عمداً ساخته نشد؛ fingerprint حدس زده نشد.

این موفقیت‌ها پایداری پیاده‌سازی و replay را نشان می‌دهند، نه کامل بودن DEX coverage؛
۵ برنامه همچنان فاقد fixture corroborated هستند و promotion به همین علت خاموش است.

## قواعد ایمنی باقی‌مانده

- هیچ داده، قیمت یا سود ساختگی برای بستن شکاف corpus ساخته نمی‌شود.
- دادهٔ نامعلوم یا ناقص verified یا صفر فرض نمی‌شود.
- Promotion تنها پس از replay و تأیید شواهد کافی قابل بررسی است؛ در وضعیت فعلی
  `SM_SOLANA_VERIFIED_PROMOTION` خاموش می‌ماند.
