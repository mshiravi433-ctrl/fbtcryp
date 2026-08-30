# سواپ اتمیک میان‌زنجیره‌ای (HTLC) — فاز ۴د

> وضعیت سند: معماری + پیاده‌سازی کامل در این مخزن  
> اسکیما: `fbt.atomic-swap.v1`  
> قرارداد: `contracts/IntentAtomicSwap.sol`  
> ماژول سرور: `server/intentAtomicSwap.js`

## هدف

تا فاز ۴ب، هر ادعای «اتمیک» برای میان‌زنجیره‌ای در Intent OS **رد می‌شد** (کد
`ATOMIC_CROSS_CHAIN_UNAVAILABLE`) چون هیچ سازوکاری وجود نداشت که آن ادعا را
روی زنجیره پشتیبانی کند؛ مسیر موجود فقط شواهد امضاشدهٔ مرحله‌ای بود.

فاز ۴د اولین سازوکاری است که واژهٔ اتمیک را برای میان‌زنجیره‌ای **واقعی** می‌کند:
قرارداد HTLC (Hash-Timelocked Contract) روی هر دو زنجیره.

## چرا این نسخه واقعاً اتمیک است؟

اتمیکی یعنی: **یا هر دو پا تسویه می‌شوند، یا هر دو پا بازپرداخت می‌شوند.** این
ویژگی اینجا نه با ادعا، بلکه با سازوکار روی‌زنجیره تضمین می‌شود:

1. کاربر یک `secret` روی دستگاه خودش می‌سازد و `hashlock = keccak256(secret)` را
   محاسبه می‌کند. سرور هرگز secret را نمی‌بیند.
2. پای منبع: کاربر دارایی‌اش را در `IntentAtomicSwap` زنجیرهٔ A با آن hashlock
   قفل می‌کند؛ پس از انقضا به خودش برمی‌گردد (بازپرداخت).
3. پای مقصد: طرف مقابل دارایی معادل را در `IntentAtomicSwap` زنجیرهٔ B با
   **همان hashlock** قفل می‌کند؛ پس از انقضا به خودش برمی‌گردد.
4. کاربر پای مقصد را با افشای secret می‌گیرد — افشای روی‌زنجیره‌ای که خودش
   بخشی از سازوکار است؛ طرف مقابل همان secret را از زنجیرهٔ B می‌خواند و پای
   منبع را قبل از انقضایش می‌گیرد.
5. اگر کسی secret را افشا نکند، **هر دو** پا بعد از مهلت خودشان بازپرداخت
   می‌شوند. زنجیره‌ای نیست که «یک‌طرفه» تسویه شده باشد.

## قانون امنیتی مهلت‌ها (کد کد را اجرا می‌کند)

اگر مهلت پای مقصد دیرتر از پای منبع باشد، کاربر می‌تواند پای مقصد را بگیرد و
بگذارد پای منبعِ طرف مقابل بازپرداخت شود — یعنی جفتِ HTLC «اینجا بگیر، آنجا
بازپرداخت» می‌شود. کامپایلر قبل از تولید هر کال‌دیتایی این را رد می‌کند:

```text
destination.timeout + 3600s  ≤  source.timeout     (ATOMIC_SWAP_TIMELOCK_ORDER_UNSAFE)
```

تست اختصاصی دارد: `test/intent-atomic-swap-probe.mjs`.

## مرزهای صادقانه (در هر plan و status پین می‌شوند)

- **اسکرو واقعی است**: در طول سواپِ باز، دارایی نزد قرارداد اسکرو است — نه
  نزد کاربر و نه نزد FBT. این همان چیزی است که اتمیکی را می‌سازد و پنهان
  نمی‌شود (`custody: 'on-chain-contract-escrow-while-open'`).
- **FBT کلید ندارد**: قرارداد owner/پاز/رِسکیو ندارد؛ FBT نمی‌تواند دارایی را
  آزاد یا تغییر مسیر دهد. هر تراکنش را کاربر یا طرف مقابل امضا می‌کند؛ سرور
  هیچ‌وقت امضا یا ارسال نمی‌کند (`executableByServer: false`).
- **فقط EVM↔EVM**: پاها باید از زنجیره‌های EVM پشتیبانی‌شده باشند؛ سولانا رد
  می‌شود (`ATOMIC_SWAP_UNSUPPORTED_CHAIN`) چون برنامه‌ای وجود ندارد و
  «به‌زودی» هرگز اتمیک نیست.
- **بدون پیکربندی، ادعایی نیست**: تا وقتی `IntentAtomicSwap` روی **حداقل دو
  زنجیره** مستقر و `INTENT_ATOMIC_SWAP_ADDRESSES` تنظیم نشده باشد، قابلیت
  `unavailable` با کد `ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED` گزارش می‌شود و هرگز
  به حالت مرحله‌ای ساکت تنزل نمی‌کند.
- **مسیر مرحله‌ای قبلی دست‌نخورده می‌ماند**: `fbt.cross-chain-state.v1` همان
  غیراتمیکِ قبلی با `ATOMIC_CROSS_CHAIN_UNAVAILABLE` می‌ماند و هرگز توسط این
  سازوکار برچسب‌گذاری مجدد نمی‌شود.
- **اتمیکی مشروط به فرض‌های اعلام‌شده**: هر دو زنجیره در پنجرهٔ مهلت زنده و
  نهایی باشند؛ هر دو پا با یک hashlock و ترتیب مهلتِ اعمال‌شده قفل شوند.

## فعال‌سازی عملیاتی

### راه یک‌فرمانی (توصیه‌شده)

```bash
# کامپایل در صورت نیاز + استقرار روی هر هدف + چاپ/نوشتن env نهایی:
ATOMIC_SWAP_DEPLOY_TARGETS='[
  {"chainId":97,"rpcUrl":"https://data-seed-prebsc-1-s1.binance.org:8545/"},
  {"chainId":421614,"rpcUrl":"https://sepolia-rollup.arbitrum.io/rpc"}
]' DEPLOYER_PRIVATE_KEY=0x… node scripts/activate-atomic-swap.mjs --write-env .env.atomic.local

# یا با پرچم‌های تکرارشونده:
node scripts/activate-atomic-swap.mjs --chain 56 --rpc https://… --chain 137 --rpc https://… --key 0x…
```

اسکریپت هر دو زنجیره را مستقر می‌کند، مقدار دقیق `INTENT_ATOMIC_SWAP_ADDRESSES`
و `INTENT_ATOMIC_SWAP_RPC_NETWORKS` را می‌سازد (و با `--write-env` در یک فایل
env محلی می‌نویسد). سپس با بالا آوردن سرور:

```bash
node --env-file=.env.atomic.local server/index.js   # یا env را در Vercel بگذارید
```

`GET /api/intents/v1/atomic-swap/status` باید `available:true` بدهد و ردیف HTLC
در `/#/intent` «فعال» می‌شود. تست‌نت‌های عمومی (۹۷، ۸۰۰۰۲، ۸۴۵۳۲، ۴۲۱۶۱۴،
۱۱۱۵۵۱۱) هدف درجه‌یک فعال‌سازی‌اند؛ برای مین‌نت طبق سیاست مخزن از KMS
استفاده کنید، نه کلید خام.

### گام‌به‌گام (معادل دستی)

```bash
# ۱) کامپایل
node scripts/compile-atomic-swap.mjs

# ۲) استقرار روی «هر زنجیره» (حداقل دو زنجیره)
DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://… CHAIN_ID=42161 node scripts/deploy-atomic-swap.mjs

# ۳) یک متغیر محیطی برای همهٔ زنجیره‌ها
INTENT_ATOMIC_SWAP_ADDRESSES={"56":"0x…","42161":"0x…"}
```

پس از آن این نقاط روشن می‌شوند:

```text
GET  /api/intents/v1/atomic-swap/status     ← وضعیت صادقانهٔ قابلیت
POST /api/intents/v1/atomic-swap/plan       ← کامپایل دو پای امضاشده
POST /api/intents/v1/atomic-swap/verify     ← خواندن وضعیت یک پا از RPCهای خود سرور
GET  /api/intents/v1/capabilities           ← بلوک atomicSwap + آداپتور fbt-htlc-atomic-swap
```

صفحهٔ `/#/intent` هم ردیف وضعیت «سواپ اتمیک میان‌زنجیره‌ای (HTLC)» را نشان
می‌دهد که فقط با پیکربندی واقعی «اتمیک» می‌شود.

## تست‌ها

- `test/intent-atomic-swap-probe.mjs` — ۴۷ ادعا در دو جهت: ادعا وقتی واقعی
  است، و امتناع از ادعا وقتی سازوکار غایب است.
- `node scripts/compile-atomic-swap.mjs` — کامپایل solc و artifact.

## اثبات سرتاسری روی دو زنجیرهٔ محلی (اجرای واقعی)

کل چرخه با سرور زنده و قراردادهای واقعیِ مستقرشده روی دو زنجیرهٔ توسعه
(ganache با chainIdهای ۵۶ و ۱۳۷) اجرا و اثبات شده است:

1. `activate-atomic-swap.mjs` هر دو زنجیره را مستقر کرد و env را ساخت؛
2. `POST /atomic-swap/plan` → قفل هر دو پا با `newSwap` → `POST
   /atomic-swap/verify` هر دو پا `locked` با اجماع RPC؛
3. کاربر پای مقصد را با preimage گرفت؛ طرف مقابل **preimage را از رویداد
   آن‌چین `SwapClaimed`** خواند و پای منبع را با همان preimage گرفت → هر دو
   پا `claimed`: تسویهٔ اتمیک؛
4. سواپ دوم بدون claim → سفر زمانی از هر دو مهلت → `refund` هر دو پا →
   هر دو `refunded`: سقط اتمیک، بدون ضرر برای هیچ طرف.

خروجی نمونه:

```text
verify source leg → state=claimed   · consensus=true
verify destination leg → state=claimed
→ both legs claimed: value moved on BOTH chains. Atomic completion proven.
…
verify source leg → state=refunded  · consensus=true
verify destination leg → state=refunded
→ both legs refunded: nobody lost funds. Atomic abort proven.
```
