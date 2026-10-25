# ارتقای Smart Money — فاز ۷ و ۸ (ادامه — ۲۰۲۶-۱۰-۲۵)

## فاز ۷ — وضعیت فعلی (پس از فاز ۶)
- **پوشش فعلی**: corroborated ۶/۱۲، balance ۷/۱۲ (عدم corroborated برای: Jupiter v4، Raydium CPMM، Orca Whirlpools، Orca Token Swap، Meteora DAMM v2، Raydium CLMM).
- **اسکریپت عملیاتی ساخته شد**: `scripts/solana-replay-fetch.mjs` — با RPC عمومی `https://api.mainnet-beta.solana.com`، `getTransaction` با `jsonParsed` و `maxSupportedTransactionVersion: 0`، اعتبارسنجی با دیکودر موجود، و تولید پیش‌نویس فیکسچر + manifest.
- **منابع ردشده مجدداً امتحان نمی‌شوند**: DASMAC (NOASSERTION)، simulation در 0xfnzero، ExodusOSS/hydra (UNLICENSED)، Pepewitch/dex-trades-tracker (بدون لایسنس)، piotrostr/listen (AGPL).
- ** Artifact بررسی شد**: `test/fixtures/solana-replay/` ۱۰ فایل + LICENSE + NOTICE دارد؛ برای انتشار/attestation آماده است؛ در صورت نیاز به attestation امضاشده، می‌توان جایگزین کرد.
- **تصمیم ارتقا**: کلید `SM_SOLANA_VERIFIED_PROMOTION` روشن نشده؛ روشن کردن یک کامیت/تغییر عملیاتی جدا و قابل بازگشت خواهد بود **پس از** تکمیل ۱۲/۱۲ و تطابق کیف‌پول واقعی با اکسپلورر.
- **ورودی chain-aware**: `consensus.js` و `intelligence.js` هنوز EVMمحورند؛ قبل از روشن‌کردن کلید، ورود ردیف‌های verified سولانا به ایندکس/گراف ضروری است.

## فاز ۸ — وضعیت فعلی
- **قیمت ساعتی native-quote**: قانون فاز ۳/۴ (هرگز تنزل به روزانه) حفظ شده؛ برای خواندن بازه‌های طولانی پیشنهاد chunked (با `pricing.js`) ثبت شد.
- **کشف زنده کیف‌پول native-quote**: `bsRecentStableSwappersByUnitPrice` در `dataSources.js` ساخته شد؛ `minUsd` دیگر مقدار خام توکن را با ۲۵۰ مقایسه نمی‌کند بلکه `pricePerUnit` صریح دریافت می‌کند (مناسب برای wrapped-native یا استیبل‌های غیراستاندارد).
- **مرز observed/shadow**: حفظ شد؛ چون فاز ۷ تمام نشده، تغییر در UI (نمایش سهم سولانا در امتیاز) انجام نمی‌شود.

## تعهدات ثابت پروژه (نقض نشده در فاز ۷/۸)
- هیچ داده/قیمت/سود ساختگی.
- fail-closed: هر truncation یا بایت اضافه = null.
- "نامشخص" هرگز صفر یا امن نیست.
- پاسخ نهایی به فارسی + سند `docs/*.md`.
