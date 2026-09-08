# وضعیت اجرای فارم و برنامهٔ مرحلهٔ بعد

بررسی کد در ۲۰۲۶-۰۹-۰۸. وجود آداپتور، تست موفق با provider مصنوعی، آزمون fork و فعال‌بودن نسخهٔ مستقر چهار موضوع جدا هستند. این گزارش هیچ تراکنش واقعی یا فعال‌سازی در استقرار را ادعا نمی‌کند.

## چه چیزی وجود دارد؟

| اتصال | محدودهٔ کد فعلی | وضعیت |
|---|---|---|
| DefiLlama | دریافت فهرست، APY/TVL، فیلتر، تاریخچه و مدیریت خطا | منبع داده، نه قرارداد سرمایه‌گذاری؛ smoke زندهٔ این محیط با ECONNRESET شکست خورده است |
| Aave v3 / Base / USDC بومی | واریز، برداشت، موقعیت، تأیید محدود، لغو مجوز و شبیه‌سازی | آداپتور و تست واحد/پنل و fork probe موجود؛ اولویت اول برای rollout کنترل‌شده پس از رفع موانع پایین |
| Aave v3 / Arbitrum One / USDC بومی | واریز، برداشت، موقعیت و لغو مجوز | آداپتور، تست پنل و fork probe موجود؛ همان شروط rollout |
| Compound v3 (Comet) / Base / USDC | supply، withdraw، موقعیت و revoke | آداپتور، تست واحد/پنل و fork probe موجود؛ این محدوده شامل claim پاداش COMP نیست |
| Lido / Ethereum | stake ETH، wrap/unwrap stETH/wstETH، درخواست خروج و claim | کد و پنل موجود؛ آمادهٔ اعلام production نیست. `test/lido-fork-probe.mjs` و `test:lido-fork` که مستندات به‌عنوان future ذکر کرده‌اند وجود ندارند |

پرچم‌های ورود سرمایه در کد به‌صورت پیش‌فرض خاموش‌اند:

- `VITE_ENABLE_AAVE_BASE_SUPPLY`
- `VITE_ENABLE_AAVE_ARBITRUM_SUPPLY`
- `VITE_ENABLE_COMPOUND_BASE_SUPPLY`
- `VITE_ENABLE_LIDO_STAKE`

مقدار واقعی تنظیمات میزبان استقرار در این بررسی تأیید نشده است. صرف ثبت متغیر در GitHub Variables کافی نیست؛ workflow ساخت APK فعلی این متغیرها را صریحاً به مرحلهٔ build منتقل نمی‌کند. وب و APK باید جدا بررسی شوند.

## موانع مشترک پیش از فعال‌سازی

1. **استقلال خروج از DefiLlama:** پنل‌های اجرایی اکنون در `PoolDetails` نصب می‌شوند؛ خرابی feed، حذف استخر توسط فیلتر ایمنی یا قرار نگرفتن در فهرست رتبه‌بندی‌شده ممکن است ورودی پنل را ناپدید کند. `PositionPanel` عمومی هنوز پیام unavailable است. موقعیت و خروج باید با خواندن قراردادهای ثابت و مستقل از feed قابل دسترسی باشند؛ نرخ بازدهٔ ساختگی ممنوع است.
2. **آزمون fork سخت‌گیرانه:** آزمون Aave Base با `--strict` در این محیط به علت نبود `anvil` شکست خورد. نبود ابزار یا RPC نباید PASS گزارش شود. دو probe دیگر نیز در این نوبت تأیید شبکه‌ای نشده‌اند.
3. **rollout محدود:** فقط بعد از fork موفق، پرچم مشخص، allowlist غیرخالی از آدرس‌های عمومی مجاز، سقف محافظه‌کارانه و wallet confirmation. خاموش‌کردن ورود نباید برداشت/claim/revoke را از دسترس خارج کند.
4. **اثبات پس از تراکنش:** receipt موفق به‌تنهایی جای بررسی تغییر موقعیت و رویداد مورد انتظار را نمی‌گیرد. در Lido، ثبت requestId هنوز placeholder دارد (`receipt?.logs ? undefined : undefined`) و نیازمند parse رویداد و آزمون است.
5. **ایمنی Lido:** ABI، مالکیت NFT خروج، وضعیت finalized/claimed، rounding مربوط به shares و rebase، انقضای quote، تغییر حساب/شبکه بین شبیه‌سازی و امضا و بازیابی partial approval باید با تست پوشش داده شوند.

## چه چیزی هنوز آداپتور مستقیم فارم ندارد؟

در `src/lib/defi` فقط چهار اتصال بالا وجود دارد. سایر slugهای allow-list فایل `server/yields.js` در Farm آداپتور سرمایه‌گذاری مستقیم ندارند؛ ممکن است خرید توکن یا دادهٔ تحلیلی داشته باشند:

- وام‌دهی: Morpho Blue، Venus، Spark/SparkLend، Aave v2، Benqi، Kamino.
- نقدینگی/LP: Uniswap v3/v4، Curve، PancakeSwap، Balancer، Aerodrome Slipstream، Raydium، Orca، SushiSwap و GMX.
- vault و محصولات بازده: Yearn، Beefy، Convex، Pendle، Stargate، Sky، Ethena، Maple و Frax.
- staking/restaking: Rocket Pool، Binance Staked ETH، Ether.fi، Jito، Marinade، Jupiter Staked SOL و EigenLayer.
- دارایی‌ها و شبکه‌های دیگر Aave/Compound، و عملیات reward-claim یا compound که آداپتور فعلی صریحاً پیاده نکرده است.

خرید rETH/stETH یا LST سولانا با swap، سپرده‌گذاری مستقیم در قرارداد، ساخت LP و claim پاداش نیست. ورود یک slug به allow-list نیز اثبات سازگاری تراکنش نیست.

## اولویت پیشنهادی

۱. مسیر مستقل موقعیت/خروج و فعال‌سازی محدود **Aave Base USDC**.
۲. همان استاندارد برای **Compound Base USDC** و **Aave Arbitrum USDC**.
۳. تکمیل تست‌ها، ABI و اثبات اجرای **Lido**.
۴. آداپتور جدید **Morpho** برای یک بازار یا یک vault مشخص و تأییدشده روی یک شبکه؛ تطبیق DefiLlama UUID با marketId/vault از رجیستری معتبر، نه حدس بر اساس symbol. Morpho Blue و ERC-4626 را یک رابط واحد فرض نکنید.
۵. یک vault مشخص Yearn/Beefy پس از تأیید استاندارد و شرایط خروج؛ سپس LPهای متمرکز. Uniswap v4 با hooks و مسیرهای چندمرحله‌ای را مرحلهٔ اول نگذارید.

## آزمون‌های قابل تکرار

```sh
npm run test:farm
NODE_OPTIONS=--max-old-space-size=3072 npm run build
npm run test:farm:live
npm run test:aave-base-fork -- --strict
npm run test:compound-base-fork -- --strict
npm run test:aave-arbitrum-fork -- --strict
```

`test:farm` اکنون ۱۸۱ تست (۸۸ تست داده/معماری + ۹۳ تست موجود آداپتور و پنل) را پوشش می‌دهد. مرز شبکه در این تست‌ها مصنوعی است. Fork باید فقط روی Anvil محلی و بدون کلید اصلی یا سرمایهٔ واقعی اجرا شود.
