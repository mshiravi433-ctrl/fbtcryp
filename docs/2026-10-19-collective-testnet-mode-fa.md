# حالت تست‌نت Robinhood برای مجموعهٔ هوشمند FBT

این سند مسیر امنِ پشتیبانی از Robinhood Chain Testnet با `chainId=46630` را توضیح می‌دهد. این تغییر فقط زیرساخت نرم‌افزاری و ورک‌فلو را آماده می‌کند؛ تا وقتی اپراتور آدرس دقیق توکن را انتخاب نکرده و اجرای دستی GitHub Actions را خودش آغاز نکند، هیچ تراکنشی ارسال و هیچ استقراری انجام نمی‌شود. مین‌نت `4663` در این تغییر هدف هیچ تراکنشی نیست.

## مرزهای شبکه و امنیت

- شبکهٔ اصلی: `4663`، RPC عمومی `https://rpc.mainnet.chain.robinhood.com`، مرورگر `https://robinhoodchain.blockscout.com`.
- تست‌نت: `46630`، RPC عمومی `https://rpc.testnet.chain.robinhood.com`، مرورگر `https://explorer.testnet.chain.robinhood.com`.
- هر chain ID دیگر رد می‌شود. رکوردها جدا هستند: `deployments/collective-4663.json` و `deployments/collective-46630.json`. مسیر تست‌نت به فایل مین‌نت نمی‌نویسد.
- انتخاب خودکار سایت از `chainId` رکوردِ تأییدشده می‌آید. اگر `COLLECTIVE_CHAIN_ID` صریح تنظیم شده باشد، همان اولویت دارد؛ بنابراین برای انتخاب خودکار تست‌نت باید این متغیر در محیط تولید خالی باشد، یا صریحاً `46630` باشد. `COLLECTIVE_READS_ENABLED=false` نیز همچنان یک خاموش‌کنندهٔ عمدی است.
- کلید فقط Secret مخزن است و فقط به فرایندهای کوتاه‌عمر `deploy`/`activate` در runner می‌رسد. آدرس عمومی از کلید مشتق می‌شود؛ خود کلید نه چاپ، نه در فایل نوشته و نه در شاهد منتشر می‌شود. `preflight` و `check` اصلاً کلید نمی‌خوانند.
- آدرس توکن، guardian، راهبرد یا اوراکل از روی نماد حدس زده نمی‌شود. USDG مین‌نت روی تست‌نت معتبر فرض نمی‌شود.
- تست‌نت به معنی «بدون گس روی زنجیره» نیست. تراکنش‌ها ETH تست‌نت مصرف می‌کنند؛ رایگان فقط به معنی ارزش نداشتن دارایی فاستی است. موجودی `0.01 ETH` به‌تنهایی تضمین نمی‌کند که deployment با قیمت گس جاری قابل انجام باشد. برآورد ناخالص محلیِ `23,658,989` گس، در قیمت `0.42 gwei` تقریباً کل `0.01 ETH` را مصرف می‌کند. preflight اکنون fee cap/gas price را از RPC می‌خواند و برای برآورد محافظه‌کارانهٔ محلی ۱۰٪ حاشیه می‌خواهد؛ در این موجودی، سقف عملی نزدیک `0.38 gwei` است. این فقط برآورد است و تضمین قطعی هزینه نیست؛ قیمت می‌تواند تغییر کند. فاز فعال‌سازی هم برآورد جداگانه دارد.

## یک‌بار نصب ورک‌فلو

فایل مرجعِ نسخهٔ جدید در `ci/collective-activation.yml` است. تلاش برای push فایل فعال `.github/workflows/collective-activation.yml` با خطای GitHub App `without workflows permission` رد شد؛ طبق سیاست مخزن دوباره برای نوشتن آن مسیر تلاش نمی‌کنیم و نسخهٔ فعال فعلی را دست‌نخورده نگه می‌داریم. پس از merge، مالک مخزن باید فقط یک‌بار متن کامل فایل `ci/collective-activation.yml` را از رابط GitHub در مسیر `.github/workflows/collective-activation.yml` جایگزین/کپی کند. این نصب دستی برای فعال‌شدن فازهای workflow جدید لازم است.

## آماده‌سازی در GitHub — خود اپراتور انجام دهد

در `Settings → Secrets and variables → Actions`:

- **Secret** `COLLECTIVE_DEPLOYER_PRIVATE_KEY`: کلید کیف پول اختصاصی اپراتور. آن را فقط در GitHub وارد کنید؛ در چت، issue، فایل، خروجی ترمینال یا Variable نگذارید.
- **Variables** (اختیاری؛ ورودی فرم Run workflow بر آن‌ها اولویت دارد):
  - `COLLECTIVE_ASSET_ADDRESS` — قرارداد ERC-20 دقیق روی شبکهٔ انتخاب‌شده.
  - `COLLECTIVE_GUARDIAN_ADDRESS` — کیف پول عمومی جداگانه از دیپلویِر.
  - `COLLECTIVE_DEPLOYER_ADDRESS` — آدرس عمومی؛ برای فاز read-only و کشف موجودی توکن.
  - `COLLECTIVE_TESTNET_RPC_URL` — اختیاری، فقط HTTPS بدون اعتبارنامه؛ اگر خالی باشد از RPC عمومی تست‌نت استفاده می‌شود.
  - `COLLECTIVE_POLICY_DELAY_SECONDS` — اختیاری، بین `86400` و `2592000`؛ پیش‌فرض یک روز.

فرم `Run workflow` ورودی‌های عمومی `asset_address`، `guardian_address` و `deployer_address` را می‌پذیرد. برای یک اجرا لازم نیست این مقادیر را در Settings ذخیره کنید. مقدارهای فرم بر Variableهای هم‌نام اولویت دارند. هیچ‌کدام از این ورودی‌ها نباید کلید خصوصی باشند.

## کشف آدرس دارایی — بدون انتخاب خودکار

در فازهای `testnet-*`، runner از Blockscout تست‌نت فهرست token balanceهای آدرس عمومی دیپلویِر را می‌خواند و جدول `symbol · address · decimals · balance` را در `GITHUB_STEP_SUMMARY` می‌گذارد. این فهرست فقط برای بررسی انسانی است؛ خود ورک‌فلو هیچ توکنی را انتخاب نمی‌کند.

برای دیدن جدول، از Actions فاز `testnet-preflight` را با `deployer_address=0xEfFEe508B69B8705F0AA3187aD9d28f1B95D39E9` اجرا کنید. اگر `asset_address` خالی باشد، فاز پس از نمایش جدول با پیام روشن fail می‌شود. از جدول، قرارداد ERC-20 مورد نظر را با منبع مستقل بررسی کنید و آدرس دقیقش را در اجرای بعدی در فیلد `asset_address` وارد کنید. نماد مشابه، به‌تنهایی مدرک اصالت نیست.

## ترتیب اجرای تست‌نت

همهٔ اجراهای دارای تراکنش را از شاخهٔ `main` پس از merge انجام دهید. ورک‌فلو شبکه را از پیشوند نام فاز تعیین می‌کند: `testnet-` یعنی فقط `46630`؛ فازهای بدون این پیشوند به `4663` متصل می‌شوند. در نتیجه `preflight` عادی مین‌نت‌محور است؛ برای کیف پول تست‌نت از `testnet-preflight` استفاده کنید.

1. **کشف/پیش‌بررسی:** `phase=testnet-preflight`، `deployer_address=0xEfFEe508B69B8705F0AA3187aD9d28f1B95D39E9`، و `asset_address` توکنِ صریح. این مرحله chain ID از RPC، موجودی ETH عمومی، `getCode`، `symbol()/decimals()` و fee cap/gas price را می‌خواند؛ هزینهٔ مرجع deployment را با ۱۰٪ حاشیه با موجودی مقایسه می‌کند. کلید و تراکنش لازم ندارد. برای فقط دیدن جدول، می‌توان بار اول asset را خالی گذاشت؛ پایان ناموفق آن عمدی است.
2. **استقرار فاز ۱:** `phase=testnet-deploy`، `acknowledge_gas=yes`، `asset_address=<آدرس دقیق انتخاب‌شده>`، `guardian_address=<کیف پول جدا از دیپلویِر>`. Secret باید از قبل در GitHub باشد. runner قبل از هر تراکنش chain، موجودی، metadata توکن و کفایت موجودی برای برآورد گس را دوباره preflight می‌کند. فاز اول قراردادها را deploy و allowlist/فعال‌سازی را در تایم‌لاک قرار می‌دهد و فقط رکورد `collective-46630.json` را می‌نویسد.
3. **انتظار تایم‌لاک:** دست‌کم ۲۴ ساعت (یا مقدار ثبت‌شدهٔ مجاز بین ۱ تا ۳۰ روز) صبر کنید. هیچ راهی برای دور زدن تایم‌لاک وجود ندارد.
4. **فعال‌سازی فاز ۲:** `phase=testnet-activate` و `acknowledge_gas=yes`. Secret همان کیف پول لازم است؛ آدرس deployer باید با رکورد و Secret منطبق باشد. فاز activate روی همان chain ID کار می‌کند و رکورد را هنوز `verified:false` نگه می‌دارد.
5. **تأیید نهایی:** `phase=testnet-check`؛ فقط‌خواندنی و بدون Secret/گس. پس از موفقیت بررسی on-chain، رکورد تست‌نت `verified:true` و `testnet:true` می‌شود، شاهد عمومی در `liveDeployments["46630"]` ثبت و `defaultChainId` روی `46630` قرار می‌گیرد. در صورت نبود override صریح، API و سایت از همین رکورد و RPC/مرورگر تست‌نت استفاده می‌کنند. بنر قرمز TESTNET در صفحه روشن می‌شود و صریحاً می‌گوید دارایی تست‌نت ارزش واقعی ندارد.

## فازهای مین‌نت و پیش‌بررسی

`preflight`، `deploy`، `activate` و `check` بدون پیشوند به chain ID `4663` متصل‌اند. `deploy` و `activate` فقط با `acknowledge_gas=yes`، Secret موجود، asset صریح، guardian جدا و تایم‌لاک معتبر اجرا می‌شوند. رکورد موجود شبکه هیچ‌گاه با آدرس شبکهٔ دیگر بازنویسی نمی‌شود. این تغییر، فاز مین‌نت را پیاده‌سازی و آماده می‌کند اما هیچ‌یک از این فازها را اجرا نمی‌کند.

## آزمون و محدودیت انتشار

پیش از ادعای عملیاتی‌بودن، این‌ها باید سبز شوند:

```sh
npm run test:collective
node scripts/collective-deploy.mjs --local --rehearse
NODE_OPTIONS=--max-old-space-size=3072 npx vite build
```

فایل `deployments/collective-46630.json` و شاهد `verified:true/testnet:true` فقط پس از اجرای واقعی `testnet-check` ساخته می‌شوند. آدرس قرارداد، موجودی توکن یا شاهد ساختگی/نمونه‌ای عمداً commit نمی‌شود. پس از merge، اگر Secret یا asset/guardian ورودی موجود نباشد، فقط خود مالک مخزن آن‌ها را در GitHub تنظیم می‌کند؛ مقادیر Secret را در چت نفرستید.
