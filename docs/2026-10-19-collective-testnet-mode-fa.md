# حالت تست‌نت مجموعهٔ هوشمند FBT — ۲۰۲۶-۱۰-۱۹

## مرز امنیتی

شبکهٔ اصلی 4663 و تست‌نت 46630 رکوردهای مستقل دارند. قرارداد یا توکن حدس زده
نمی‌شود. USDG مین‌نت را برای تست‌نت وارد نکنید. تست‌نت **ارزش واقعی ندارد**؛
تراکنش‌ها گس مصرف می‌کنند و رایگان فقط به معنی دریافت ETH از فاست است.
تمرین Ganache هیچ تراکنشی در شبکهٔ عمومی نمی‌فرستد.

تنها رکورد activated + verified با chainId پشتیبانی‌شده برای خواندن خودکار پذیرفته
می‌شود. تست‌نت علاوه بر آن testnet:true می‌خواهد. COLLECTIVE_CHAIN_ID صریح اولویت
دارد و snapshot شبکهٔ دیگر را رد می‌کند؛ هیچ آدرسی از شبکهٔ دیگر قرض گرفته نمی‌شود.
RPC شاهد فقط endpoint عمومی همان شبکه است، نه URL محرمانهٔ اپراتور.

## نصب یک‌بارهٔ ورک‌فلو

مالک مخزن در GitHub UI محتوای `ci/collective-activation.yml` را در
`.github/workflows/collective-activation.yml` کپی و ذخیره کند. نسخهٔ قدیمی نصب‌شده
گزینه‌های testnet را ندارد. فایل آماده عمداً در ci نگهداری می‌شود؛ دسترسی workflow
ربات لازم نیست. هیچ کلیدی در فایل ورک‌فلو قرار ندهید.

Secret `COLLECTIVE_DEPLOYER_PRIVATE_KEY` را **فقط خود مالک** در Settings → Secrets
and variables → Actions ثبت کند. مقدار را در چت، کد، فایل env یا لاگ نفرستید.
این جلسه دسترسی فهرست Secretها ندارد (403)، بنابراین وجود آن تأیید نشده است.

Variables یا ورودی فرم: `COLLECTIVE_ASSET_ADDRESS` / `asset_address`،
`COLLECTIVE_GUARDIAN_ADDRESS` / `guardian_address`؛ ورودی فرم اولویت دارد.
`deployer_address` فقط آدرس عمومی است، برای preflight پیش‌فرض آن
`0xEfFEe508B69B8705F0AA3187aD9d28f1B95D39E9` است. مراحل تراکنش‌دار آدرس واقعی
دیپلویِر را داخل رانر از Secret استخراج می‌کنند و فقط همین آدرس عمومی منتشر می‌شود.

## ترتیب اجرا از Actions → FBT Collective Activation → Run workflow روی main

1. `phase=preflight`: بدون کلید، روی تست‌نت. جدول token-balances در Summary،
   symbol / address / decimals / balance خام را نمایش می‌دهد. اگر توکن مشخص نیست
   بار اول بدون asset اجرا کنید؛ جدول تولید می‌شود ولی اجرا عمداً fail می‌شود.
   خود کاربر توکن درست را انتخاب و با `asset_address` دوباره اجرا کند.
2. preflight باید chainId RPC، موجودی ETH، bytecode و symbol/decimals توکن را تأیید
   کند. قطع RPC یا Blockscout خطاست، نه مجوز حدس‌زدن. بودجهٔ فاز اول حدود
   23.66 میلیون گس است؛ 0.01 ETH در حدود 0.42 gwei سقف دارد و قیمت باید هنگام اجرا
   بررسی شود. برآورد اسکریپت تضمین کفایت موجودی نیست؛ فاز دوم هم گس لازم دارد.
3. `phase=testnet-deploy`, `acknowledge_gas=yes`، asset و guardian متمایز را بدهید.
   timelock_days عدد صحیح ۱ تا ۳۰ است (پیش‌فرض ۱). رکورد
   `deployments/collective-46630.json` پس از موفقیت کامیت می‌شود. استقرار مجدد روی
   رکورد موجود مسدود است. قطعی میان تراکنش‌ها ممکن است قرارداد بدون رکورد بگذارد؛
   در این حالت پیش از تلاش مجدد باید تراکنش‌های آدرس عمومی بررسی شوند.
4. حداقل ۲۴ ساعت واقعی (یا تأخیر انتخاب‌شده) صبر کنید. دورزدن تایم‌لاک نداریم.
5. `phase=testnet-activate`, `acknowledge_gas=yes`؛ بررسی read-only بلافاصله اجرا می‌شود.
6. `phase=testnet-check`؛ بدون کلید. فقط پس از موفقیت بررسی زنجیره، verified:true
   و testnet:true در رکورد و شاهد منتشر می‌شود. اجرای ناموفق نباید شاهد سبز بسازد.
7. موفقیت deployment تولیدی Vercel برای SHA کامیت شاهد را بررسی کنید؛ سپس
   `/#/collective`: شبکهٔ 46630، بنر قرمز TESTNET و «ارزش واقعی ندارد»، لینک explorer
   تست‌نت، و کارت فعال‌سازی را بررسی کنید. تنها سبز بودن rehearsal کافی نیست.

`deploy/activate/check` بدون پیشوند فقط مین‌نت هستند؛ برای این عملیات از آن‌ها
استفاده نکنید. preflight استثنائاً همیشه تست‌نت است. Secret فقط در قدم استخراج
هویت و دو قدم تراکنش به env پروسه می‌رسد، نه jobهای خواندنی یا artifact.

## اعتبارسنجی توسعه

- `npm run test:collective`
- `node scripts/collective-deploy.mjs --local --rehearse`
- `NODE_OPTIONS=--max-old-space-size=3072 npx vite build`
- `node scripts/gen-locales.mjs`

بیلد بدون افزایش heap در محیط محدود این جلسه OOM شد؛ همان vite build با heap
۳۰۷۲ مگابایت موفق شد. رکوردهای واقعی و verified:true نباید پیش از اجرای زنجیره
ساخته شوند. آدرس توکن، guardian، نصب ورک‌فلو جدید، و تایم‌لاک پیش‌نیازهای عملیاتی‌اند.
