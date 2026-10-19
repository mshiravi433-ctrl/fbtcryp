# فعال‌سازی عمومی مجموعه هوشمند FBT (FBT AI Collective)

تاریخ: ۲۰۲۶-۱۰-۱۹ · دامنه: `contracts/collective/**`، `server/collective/**`،
`src/pages/Collective.jsx`، اسکریپت‌های استقرار و آزمون‌ها.

این سند دقیقاً می‌گوید چه چیزی برای «فعال و عمومی کردن» مجموعه ساخته شد،
چه چیزهایی روی زنجیره اجرا شد و چه چیزهایی **عمداً** انجام نشد. هیچ نشانی
قرارداد، توکن، اوراکل یا استراتژی در این مخزن یا در این تغییرات از خودمان
ساخته/حدس زده نشده است.

---

## ۰. خلاصهٔ وضعیت

| موضوع | وضعیت |
| --- | --- |
| قراردادهای مجموعه (۱۳ فایل + اوراکل و استراتژی جدید) | کامپایل با `solc 0.8.24`، همه زیر سقف EIP-170 |
| اسکریپت استقرار دومرحله‌ای (با تایم‌لاک واقعی ۱ روزه) | پیاده‌سازی شد |
| تمرین کامل روی زنجیرهٔ محلی (استقرار → تایم‌لاک → فعال‌سازی → واریز کاربر → سرمایه‌گذاری → خواندن API) | **موفق** (نتایج در بخش ۵) |
| خواندن عمومی روی Robinhood Chain | نیازمند استقرار واقعی + RPC + آدرس‌های تأییدشده |
| استقرار روی زنجیرهٔ واقعی در این پکیج | **انجام نشده** — کلید/گس و RPC تأییدشده در اختیار این محیط نبود |
| گس کاربر | همهٔ تراکنش‌ها با کیف پول خود کاربر امضا/پرداخت می‌شود؛ اسپانسر/پی‌مستر/ری‌لی‌ور وجود ندارد |
| ممیزی مستقل | انجام نشده — همچنان شرط انتشار گسترده است |

> **صداقت عملیاتی:** «فعال کردن» یک محصول روی زنجیره بدون استقرار واقعی و
> بدون تأیید مستقل، ادعای درستی نیست. کاری که این تغییرات انجام می‌دهند این
> است که مسیر استقرار و فعال‌سازی را کامل، قابل‌تکرار و قابل‌بازبینی می‌کند؛
> اجرای نهایی فقط با کلید و گس خود کاربر و آدرس‌های تأییدشده انجام می‌شود.

---

## ۱. مدل گس — «گس از کیف پول خود کاربر»

این تصمیم در سه لایه اعمال و آزمون می‌شود:

1. **قرارداد:** واریز، درخواست برداشت، برداشت از صف و claim درآمد همه
   `msg.sender`-محور هستند؛ هیچ نقش سرور یا relay در مسیر کاربر نیست. تابع
   `deposit` فقط از کاربر دارایی می‌کشد (با approve دقیق) و در `StrategyVault`
   هیچ تابعی وجود ندارد که به نمایندگی کاربر تراکنش بفرستد.
2. **سرور:** API فقط `GET` است. هیچ کلید خصوصی، endpoint امضا، broadcast یا
   paymaster در `server/collective/**` وجود ندارد. پاسخ عمومی اکنون صریحاً
   شامل این فیلدهاست:
   ```json
   "operations": {
     "gasPayer": "user-wallet",
     "gasSponsorshipEnabled": false,
     "relayerEnabled": false,
     "serverSigning": false,
     "privateKeysStoredByApi": false,
     "aiCanSign": false
   }
   ```
3. **رابط کاربری:** در بالای صفحهٔ `/collective` یک نوار «عمومی» اضافه شد که
   می‌گوید هر تراکنش با کیف پول متصل کاربر امضا و گس آن از همان کیف پول
   پرداخت می‌شود و هیچ اسپانسر/یارانهٔ شرکتی فعال نیست. متن ریسک و
   نقدشوندگی نیز همین را تکرار می‌کند (fa/en).

اسکریپت استقرار هم فقط با یک کیف پول (`COLLECTIVE_DEPLOYER_PRIVATE_KEY`) کار
می‌کند و در رکورد نهایی `gas.policy = "user-wallet-only"` و
`gas.sponsored = false` را ثبت می‌کند. کلید هیچ‌وقت روی دیسک نوشته یا چاپ
نمی‌شود.

---

## ۲. چه قراردادهایی اضافه شد و چرا

### `contracts/collective/oracles/DeclaredOracles.sol`

- **`DeclaredPriceOracle`**: یک قیمت ثابت اعلام‌شده برای همان یک دارایی
  حسابداری (معمولاً استیبل‌کوین دلاری = ۱ دلار) و یک قیمت اعلام‌شده برای
  گس توکن بومی. `updatedAt` را برابر زمان بلاک برمی‌گرداند، پس چک تازگی
  `RiskController` هرگز به‌خاطر کهنه‌شدن fail نمی‌شود.
  **این یک فید بازار نیست و مشاهدهٔ مستقل نیست.** فقط برای دارایی با پگ
  دلاری و با سقف‌های محافظه‌کارانه قابل قبول است. برای توکن پرنوسان یا مسیر
  معاملاتی مجاز نیست.
- **`DisabledLiquidityOracle`**: برای همهٔ جفت‌ها نقدینگی صفر برمی‌گرداند.
  مسیر stable-yield هیچ‌وقت آن را نمی‌خواند؛ وجودش فقط برای تکمیل وابستگی
  سازندهٔ `RiskController` است و تضمین می‌کند مسیر معاملاتیِ ازکارافتاده
  حتی در صورت پیکربندی اشتباه، در دروازهٔ نقدینگی fail-closed بماند.

### `contracts/collective/strategies/NoYield4626Strategy.sol`

یک ERC-4626 حداقلی و بدون ادمین/اوراکل/فراخوانی خارجی: دارایی را نگه
می‌دارد و سهم ۱:۱ می‌دهد. **بازدهی ندارد و نمی‌تواند اصل پول را (جز از طریق
خود دارایی) از دست بدهد.**

چرا لازم شد: هیچ هدف ERC-4626 تأییدشده‌ای در مخزن نبود و آدرس ساختن از
خودمان ممنوع است. سالت به یک هدف **تغییرناپذیر** بسته می‌شود؛ پس:

- اگر کاربر آدرس یک هدف واقعی و ممیزی‌شده را در `COLLECTIVE_STRATEGY_TARGET`
  بدهد، همان استفاده می‌شود؛
- در غیر این صورت، استقرار با هدف «بدون بازده» انجام می‌شود تا محصول بتواند
  به‌صورت عمومی و امن بالا بیاید. **بازده صفر است و این باید در متن محصول
  افشا شود.** رفتن به بازده واقعی نیازمند یک سالت جدید با هدف بررسی‌شده است.

> «هدف را خودت پیدا کن»: بدون دسترسی شبکه به Robinhood Chain و بدون فهرست
> تأییدشدهٔ ERC-4626 در مخزن، هر آدرسی که این‌جا نوشته می‌شد حدس بود. به
> جایش، ابزار دقیقاً همان ورودی را می‌گیرد و اگر داده نشود، مسیر امنِ
> بدون‌بازده را انتخاب می‌کند. این تنها انتخاب صادقانه بود.

---

## ۳. اسکریپت استقرار — دو فاز، چون تایم‌لاک واقعی است

`RiskController` اجازهٔ فعال‌سازی دارایی/پروتکل/نوع سالت را فقط پس از
`policyDelay` (حداقل ۱ روز) می‌دهد. پس استقرار در دو فاز انجام می‌شود:

```bash
npm run compile:collective
```

### فاز ۱ — استقرار + صف‌کردن سیاست‌ها

```bash
COLLECTIVE_DEPLOYER_PRIVATE_KEY=0x...        # کیف پول خودتان؛ گس از همین می‌رود
COLLECTIVE_RPC_URL=https://<verified-robinhood-rpc>
COLLECTIVE_ASSET_ADDRESS=0x...               # استیبل‌کوین حسابداری (تأییدشده)
COLLECTIVE_GOVERNOR_ADDRESS=0x...            # فقط همان کیف پول امضاکننده (فاز ۱)
COLLECTIVE_GUARDIAN_ADDRESS=0x...            # جدا از governor (پیشنهادی/الزامی)
COLLECTIVE_KEEPER_ADDRESS=0x...              # اختیاری
COLLECTIVE_STRATEGY_TARGET=0x...             # اختیاری؛ اگر ندهید هدف بدون‌بازده
node scripts/collective-deploy.mjs --network robinhood --phase deploy --execute
```

بدون `--execute` فقط «نقشه» چاپ می‌شود و هیچ تراکنشی ارسال نمی‌شود.

> در فاز ۱، امضاکننده **باید** همان governor باشد، چون تمام grantRoleها
> فقط با نقش governor انجام می‌شوند. انتقال به multisig بعداً و با جریان
> دومرحله‌ای `queueGovernorTransfer`/`acceptGovernorTransfer` انجام می‌شود.

اسکریپت:
1. آدرس‌ها را اعتبارسنجی و chain id را از RPC تأیید می‌کند.
2. موجودی گس کیف پول را چک می‌کند؛ اگر صفر باشد متوقف می‌شود (هیچ اسپانسری
   وجود ندارد).
3. قراردادها را به ترتیب وابستگی مستقر می‌کند، نقش‌ها را می‌دهد، دو
   دیپلویِر را به factory متصل می‌کند و allowlist دارایی/هدف + فعال‌سازی
   stable-yield را **صف** می‌کند.
4. رکورد عمومی `deployments/collective-4663.json` را می‌نویسد (شامل
   `timelockReadyAt`، فهرست تراکنش‌ها، گس مصرفی و `gas.policy`).

### فاز ۲ — اجرای سیاست و ساخت سالت

پس از `timelockReadyAt`:

```bash
COLLECTIVE_DEPLOYER_PRIVATE_KEY=0x... COLLECTIVE_RPC_URL=https://... \
node scripts/collective-deploy.mjs --network robinhood --phase activate --execute
```

اسکریپت اگر زودتر اجرا شود با پیام دقیق زمان آماده‌شدن متوقف می‌شود. سپس:
- سه تغییر صف‌شده را اجرا می‌کند؛
- سالت stable-yield را با سقف‌های پیش‌فرض (`DEFAULT_LIMITS`) می‌سازد:
  حداکثر سرمایه‌گذاری ۵۰٬۰۰۰ دلار، سقف هزینهٔ گس ۵۰ دلار، حداقل نقدینگی
  ۱ دلار، تخصیص/تمرکز ۸۰٪، اسلیپیج ۰٫۵٪، ذخیره ۱۰٪، حداکثر سن اوراکل
  ۱ ساعت؛
- آدرس سالت/آداپتور/epoch/queue را در همان رکورد ذخیره می‌کند.

همهٔ سقف‌ها با env قابل تغییرند (`COLLECTIVE_MAX_TRADE_USD_E8`،
`COLLECTIVE_MAX_ALLOCATION_BPS`، …) ولی **باید** در محدودهٔ `RiskController`
بمانند، وگرنه تراکنش revert می‌شود.

---

## ۴. فعال‌سازی خواندن عمومی و بررسی نهایی

```bash
node scripts/collective-activate.mjs --deployment deployments/collective-4663.json --env
node scripts/collective-activate.mjs --deployment deployments/collective-4663.json --env --write .env.collective.local
COLLECTIVE_RPC_URL=https://... node scripts/collective-activate.mjs \
  --deployment deployments/collective-4663.json --check
```

`--check` همان بررسی‌هایی را انجام می‌دهد که API قبل از سرو کردن داده لازم
دارد:

- chain id = ۴۶۶۳
- وجود bytecode برای factory، دارایی، سالت، هدف، آداپتور، epoch، صف،
  risk/access/emergency و اوراکل
- `factory.usdt()` برابر دارایی ثبت‌شده
- سالت در `factory.allVaults()` و در `risk.registeredVault`
- kind = 0، دارایی/پروتکل allowlist شده و kind فعال
- هدف آداپتور و دارایی آداپتور منطبق
- `emergency.paused() == false`
- سقف‌ها فعال و قیمت‌های اعلام‌شده غیرصفر و «تازه»
- نقش keeper برای آدرس ثبت‌شده (اگر تعیین شده باشد)

خروجی env تولیدشده فقط شامل مقادیر عمومی است:

```
COLLECTIVE_READS_ENABLED=true
COLLECTIVE_CHAIN_ID=4663
COLLECTIVE_RPC_URL=...
COLLECTIVE_FACTORY_ADDRESS=...
COLLECTIVE_ASSET_ADDRESS=...
COLLECTIVE_DEPLOYMENT_BLOCK=...
COLLECTIVE_EVENT_MAX_BLOCK_SPAN=20000
COLLECTIVE_KEEPER_ENABLED=false
```

فایل `.env.collective.local` با الگوی `.env.*.local` در `.gitignore` است و
نباید commit شود. `COLLECTIVE_RPC_URL` باید **HTTPS و read-only** باشد؛
credential داخل URL ممنوع است و هرگز در پاسخ عمومی ظاهر نمی‌شود.

پس از ری‌استارت API:

```bash
curl -s https://<host>/api/collective/status | jq
# ready:true, deployment.verifiedOnChain:true, operations.gasPayer:"user-wallet"
curl -s https://<host>/api/collective/vaults | jq
```

`/collective` از منوی More → Earn در دسترس است و برای همه (بدون کیف پول)
فقط-خواندنی است.

---

## ۵. نتیجهٔ تمرین محلی (اجرا شده)

دستور:

```bash
node scripts/collective-deploy.mjs --local --rehearse
```

این تمرین روی Ganache درون‌فرآیندی با `chainId=4663` و همان artifactهای
واقعی اجرا شد:

- استقرار کامل ۱۱ قرارداد (شامل دارایی و هدف آزمایشی)؛
- صف‌کردن allowlist/فعال‌سازی، سپس **عبور واقعی از تایم‌لاک ۸۶٬۴۰۰ ثانیه‌ای**
  با `evm_increaseTime` (نه دورزدن آن)؛
- اجرای سیاست و ساخت سالت با `Limits` پیش‌فرض؛
- واریز ۱۰۰ واحد توسط کیف پول کاربر (signer جدا) و اثبات کاهش موجودی گس
  همان کاربر؛
- شروع epoch اول و `invest` توسط keeper به هدف ثابت؛
- خواندن همان deployment با `createCollectiveReader` — همان کدی که API
  استفاده می‌کند — و تأیید `ready`, تعداد سالت و موجودی سهم کاربر.

نتیجه: **موفق** — ۲۳ تراکنش و حدود ۲۳٫۷ میلیون واحد گس؛ واریز کاربر
(`0x192d…3d18`) با گس پرداخت‌شده از همان کیف پول تأیید شد و reader وضعیت
`ready:true` و موجودی سهم ۱۰۰ واحد را برگرداند. خروجی کامل در
`test/.out/collective-deployment.local.json` (tracked نیست) و لاگ اجرا
نگه داشته می‌شود.

---

## ۶. بررسی «از همه نظر»

### ۶.۱ قرارداد و کنترل‌ها

- `AccessController`: نقش governor/guardian با توابع اختصاصی جابه‌جا می‌شود؛
  حذف عمومی `DEFAULT_ADMIN_ROLE`/governor/guardian مسدود است؛ انتقال
  governor دومرحله‌ای و تأخیری است.
- `EmergencyModule`: توقف فوری توسط guardian، ازسرگیری فقط با governor و
  فقط برای آخرین incident؛ هیچ `rescue/sweep` وجود ندارد.
- `RiskController`: allowlist دارایی/پروتکل/روتر و فعال‌سازی نوع، تأخیری؛
  سقف ارزش معامله، سقف هزینهٔ گس، حداقل نقدینگی هدف، سقف تخصیص/تمرکز،
  اسلیپیج و تازگی اوراکل؛ همه fail-closed.
- `StrategyVault`: approve دقیق، بررسی دقیق دریافت دارایی (fee-on-transfer
  رد می‌شود)، `withdraw/redeem` فوری عمداً غیرفعال و برداشت از صف FIFO؛
  تسویه فقط بعد از خروج کامل از استراتژی؛ snapshot تاریخی برای claim.
- `ExecutionRouter`: فقط keeper، فقط calldata محدود، deadline و nonce؛ در
  v1 عملاً فعال نیست چون نوع trading فعال نمی‌شود.
- سطح حمله: هیچ تابع generic `call`/`rescue`/`sweep`/`setAdapter`/`setTarget`
  در قراردادهای اصلی نیست (آزمون `contract-probe` این را بررسی می‌کند).
- اندازهٔ bytecode: `StrategyVaultDeployer` ۲۴٬۵۶۴ بایت در برابر سقف
  ۲۴٬۵۷۶ — حاشیهٔ ۱۲ بایت؛ کامپایلر/تنظیمات pin شده باید حفظ شود.

دو نقص واقعی که در همین بررسی پیدا و رفع شد:

1. **بررسی chain id در خواننده بی‌اثر بود:** `JsonRpcProvider(url, chainId,
   { staticNetwork: true })` شبکه را از configuration می‌پذیرد و
   `eth_chainId` را نمی‌پرسد؛ در نتیجه `CHAIN_ID_MISMATCH` هرگز رخ نمی‌داد.
   `staticNetwork` حذف شد تا RPC واقعاً بررسی شود (هم در سرور و هم در
   اسکریپت‌های استقرار/بررسی).
2. **ABI خواندن خواننده ناقص بود:** `getPastBalance`/`getPastTotalSupply` در
   `VAULT_ABI` نبودند؛ با اولین تسویهٔ epoch، خواندن claim کاربر شکست
   می‌خورد. هر دو اضافه شد و یک آزمون رگرسیون، هم‌خوانی «متدهایی که reader
   صدا می‌زند» با ABI را تضمین می‌کند.

### ۶.۲ کد سرور و API

- فقط GET؛ `no-store`؛ خطاهای عمومی کد ثابت دارند و RPC/کلید را لو نمی‌دهند.
- خواندن زنجیره فقط پس از تأیید chain id، bytecode و تطابق دارایی factory.
- اسکن رویدادها محدود به بازهٔ پیکربندی‌شده و حداکثر ۲۰٬۰۰۰ بلاک.
- `COLLECTIVE_KEEPER_ENABLED` پیش‌فرض false و کلید keeper فقط از env؛ API
  هرگز کلید نمی‌گیرد یا نگه نمی‌دارد.

### ۶.۳ اقتصاد و شفافیت

- هیچ سرمایهٔ شرکتی و هیچ سود تضمینی وجود ندارد؛ بازده صفر (با هدف idle)
  ممکن است و افشا می‌شود.
- گس: کاربر می‌پردازد؛ «صفر هزینه» ادعا نمی‌شود.
- برداشت فوری نیست؛ صف می‌تواند به‌خاطر نقدینگی هدف معطل بماند.
- قراردادها ممیزی مستقل نشده‌اند.

### ۶.۴ آزمون‌ها

```bash
node scripts/compile-collective.mjs          # همهٔ قراردادها، سقف EIP-170
node test/collective/contract-probe.mjs      # Ganache: حسابداری/مجوزها/صف/تسویه
node --test test/collective/api.test.mjs     # config، policy، indexer، HTTP، مدل گس
node scripts/collective-deploy.mjs --local --rehearse
```

`npm run test:collective` همین‌ها را به‌همراه `test/collective/activation.test.mjs`
اجرا می‌کند. نتایج اجراشده در این محیط:

| آزمون | نتیجه |
| --- | --- |
| کامپایل ۱۵ فایل Solidity | ✓ همه زیر EIP-170 |
| `api.test.mjs` | **۷/۷** (شامل سیاست گس، رکورد بدون راز، پوشش ABI) |
| `activation.test.mjs` | **۴/۴** (اوراکل اعلامی، اوراکل نقدینگی غیرفعال، هدف ۱:۱ بدون ادمین/بازده) |
| `collective-deploy.mjs --local --rehearse` | **موفق** (استقرار → تایم‌لاک → فعال‌سازی → واریز کاربر → سرمایه‌گذاری → خواندن API) |
| `contract-probe.mjs` | **۱۹/۱۹** (Ganache محلی؛ حدود ۱۲ دقیقه روی میزبان ۲ هسته‌ای) |

آزمون API شامل بررسی جدید «سیاست گس کاربر و نبود مسیر اسپانسر» است.

---

## ۷. چیزهایی که هنوز مانع انتشار گسترده‌اند (صادقانه)

1. **ممیزی مستقل Solidity** انجام نشده؛ این تغییرات جای آن را نمی‌گیرد.
2. **آدرس‌های واقعی**: دارایی حسابداری و هدف ERC-4626 باید توسط اپراتور
   مستقل تأیید شوند. اوراکل پیش‌فرض «اعلامی» است، نه فید بازار.
3. **multisig**: governor و guardian در استقرار واقعی باید کیف پول‌های جدا
   (ترجیحاً multisig) باشند، نه یک EOA. ابزار عمداً guardian هم‌آدرس را رد
   می‌کند مگر با override صریح.
4. **هدف بدون بازده**: تا انتخاب هدف ممیزی‌شده، محصول فعال است اما سود
   واقعی ندارد؛ این باید در متن عمومی بماند.
5. **حقوقی/ریسک**: افشاها باید توسط مالکان حقوقی/ریسک تأیید شوند.
6. **پایش**: هشدار برای `EmergencyPaused`، شکست خواندن RPC، کهنه‌شدن
   oracle (در حالت اعلامی عملاً رخ نمی‌دهد) و صف برداشت طولانی لازم است.

---

## ۸. پس از استقرار: پایش و واکنش

- `--check` را در CI/کرون روزانه اجرا کنید؛ شکست یعنی خواندن عمومی باید
  خاموش شود.
- در حادثه: guardian → `EmergencyModule.pause(code,evidenceHash)`؛ اجرای
  keeper را متوقف کنید؛ لاگ‌ها و نسخهٔ پیکربندی را نگه دارید؛ واریز جدید
  را تا حل حادثه باز نکنید.
- ازسرگیری فقط با governor و پس از بررسی چندامضایی؛ سند
  `docs/collective/RUNBOOK.md` مرجع اصلی است.
- برای تغییر سقف‌ها: `queueVaultLimits` سپس بعد از تایم‌لاک
  `executeVaultLimits` — هرگز مستقیم.

---

## ۹. فایل‌های این تغییر

```
contracts/collective/oracles/DeclaredOracles.sol
contracts/collective/strategies/NoYield4626Strategy.sol
scripts/lib/collectiveDeployment.mjs
scripts/collective-deploy.mjs
scripts/collective-activate.mjs
ci/collective-activation.yml               (کپی دستی به .github/workflows/)
deployments/README.md                      (فقط رکوردهای عمومی و بدون راز)
server/collective/config.js                  (مدل گس/عمومی در پاسخ API)
src/pages/Collective.jsx                     (نوار عمومی + گس)
src/styles/collective.css
src/i18n/locales/{fa,en}.json                (متن عمومی/گس، برچسب منو)
test/collective/api.test.mjs                 (آزمون مدل گس و رکورد بدون راز)
package.json                                 (اسکریپت‌های deploy/activate/check/env)
docs/collective/ACTIVATION-FA.md             (همین سند)
```


---

## ۱۰. مسیر بدون کلید و بدون گس (افزوده‌شده ۲۰۲۶-۱۰-۱۹)

از این تاریخ، هر چیزی که بدون کلید و بدون گس شدنی است، خودکار است:

| کار | ابزار | کلید؟ | گس؟ |
| --- | --- | --- | --- |
| کامپایل + پروب قرارداد + تست‌های API | `.github/workflows/collective-activation.yml` (job `rehearsal`) | نه | نه |
| تمرین کامل استقرار/تایم‌لاک/فعال‌سازی/واریز | همان job، Ganache درون‌فرآیندی | نه | نه |
| شاهد عمومی اجرا | `scripts/collective-evidence.mjs` → snapshot + `public/collective/activation.json` | نه | نه |
| نمایش وضعیت روی `/#/collective` | `GET /api/collective/activation` | نه | نه |
| استقرار روی Robinhood Chain | همان ورک‌فلو، job `live`، فقط با Secret و `acknowledge_gas=yes` | فقط داخل رانر | گس کیف پول اپراتور |
| روشن‌شدن خواندن عمومی بعد از استقرار | خودکار از رکورد تأییدشدهٔ CI | نه | نه |

دستورهای دقیق و توجیه «چرا استقرار روی زنجیره هرگز رایگان نیست» در
`docs/2026-10-19-collective-keyless-gasless-activation-fa.md` آمده است.
