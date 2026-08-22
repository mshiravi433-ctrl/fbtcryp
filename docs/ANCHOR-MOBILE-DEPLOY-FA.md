# استقرار Anchor فقط با گوشی — بدون کامپیوتر

> این مسیر جایگزین `docs/ANCHOR-DEPLOYMENT-CHECKLIST-FA.md` نیست؛ همان
> چک‌لیست است برای کسی که فقط موبایل دارد. تا وقتی deploy واقعی انجام
> نشود، env ها خالی می‌مانند و `{"networks":[]}` صادقانه است.
>
> **قانون ثابت:** seed phrase و private key هرگز در چت، repo یا هیچ‌جای
> دیگری وارد نمی‌شود؛ کلید فقط داخل اپ کیف پول خود کاربر می‌ماند و
> امضاها داخل همان اپ انجام می‌شود.

## پیش‌نیازها (تنها هزینهٔ واقعی)

- گوشی + اپ **MetaMask** (یا هر کیف پول EVM با مرورگر داخلی/WalletConnect)
- **حدود ۲ تا ۵ دلار ETH روی شبکهٔ Base** در یک account تازهٔ MetaMask
  - خودِ deploy هر قرارداد روی Base معمولاً چند سنت است؛ بقیه حاشیهٔ امن
    و هزینهٔ anchorهای بعدی است (هر anchor tx معمولاً < ۱ سنت).
  - هنگام برداشت از صرافی حتماً Network = **Base** انتخاب شود، نه Ethereum.
- RPC رایگان و بدون ثبت‌نام: `https://mainnet.base.org` (برای env سرور
  کافی است؛ اکانت رایگان Alchemy/Infura اختیاری است، نه لازم).

## گزینهٔ جایگزین: deploy توسط شخص دیگر

هر دو قرارداد permissionless اند، owner ندارند و هرگز fund نمی‌گیرند؛
بنابراین **هر کسی** (دوست، همکار، عضو جامعه) می‌تواند آن‌ها را deploy کند
و هیچ قدرتی هم به‌دست نمی‌آورد. اعتبار deployment بعداً به‌صورت عمومی با
تطبیق دقیق bytecode + verified source روی Basescan بررسی می‌شود، نه با
اعتماد به deployer. اگر کسی حاضر به پرداخت gas بود، فقط آدرس قرارداد و
لینک tx لازم است.

## مراحل deploy با Remix از داخل گوشی

1. اپ MetaMask → تب Browser (مرورگر داخلی) → برو به `remix.ethereum.org`
2. یک فایل جدید بساز: `IntentAuctionAnchor.sol` و متن آن را عیناً از
   GitHub کپی کن (repo → `contracts/IntentAuctionAnchor.sol` → Raw).
3. تب **Solidity Compiler**:
   - Compiler: دقیقاً `0.8.24`
   - Advanced: EVM Version = `paris` · Enable optimization = روشن، `200`
   - Compile
4. تب **Deploy & Run**:
   - Environment: `Injected Provider - MetaMask`
   - مطمئن شو شبکهٔ MetaMask روی **Base (chainId 8453)** است
   - Deploy → تأیید tx در MetaMask (constructor آرگومان ندارد)
5. آدرس قرارداد deployشده را کپی و یادداشت کن + لینک tx در
   `basescan.org`.
6. همین ۴ مرحله را برای `contracts/IntentMerkleRootAnchor.sol` تکرار کن.

## بعد از deploy — دادهٔ عمومی که باید تحویل شود

```text
1. آدرس IntentAuctionAnchor:     0x…
2. آدرس IntentMerkleRootAnchor:  0x…
3. لینک هر دو deploy tx:          https://basescan.org/tx/…
4. آدرس عمومی کیف پول sender:    0x…   (می‌تواند همان deployer باشد؛
                                        چون قرارداد privilege ندارد،
                                        جداسازی این‌جا nice-to-have است)
```

سپس (توسط سشن agent، بدون هیچ کلیدی):

- راستی‌آزمایی مستقل: `getCode` از RPC عمومی و تطبیق دقیق bytecode با
  artifact کامپایل‌شده از همین repo + interface probe با `staticCall`
  (معادل `npm run deploy:auction-anchor verify 0x…`).
- آماده‌سازی Standard-JSON برای verify سورس روی Basescan (از گوشی هم
  قابل upload است: Basescan → Verify Contract → Standard-Json-Input).
- ساخت مقدار دقیق env:

```text
INTENT_ANCHOR_NETWORKS=[{"chainId":8453,"name":"Base","contract":"0x…","rpcUrl":"https://mainnet.base.org","explorerBaseUrl":"https://basescan.org","minConfirmations":12}]
INTENT_MERKLE_ANCHOR_NETWORKS=[{"chainId":8453,"name":"Base","contract":"0x…","rpcUrl":"https://mainnet.base.org","explorerBaseUrl":"https://basescan.org","minConfirmations":12}]
```

## تنظیم env از گوشی

مرورگر گوشی → `vercel.com` → پروژه → **Settings → Environment Variables**
→ دو متغیر بالا (فقط Production/Server؛ هرگز `VITE_*`) → Redeploy →
چک عمومی:

```
https://fbtswap.ir/api/intents/v1/anchor-networks
https://fbtswap.ir/api/intents/v1/merkle-anchor-networks
```

باید به‌جای `[]` شبکهٔ Base را با آدرس قرارداد نشان بدهد (بدون rpcUrl —
در کد strip می‌شود).

## اولین anchor واقعی (پس از مجوز صریح مالک)

1. `GET /api/intents/v1/auctions/{intentHash}/anchor-calldata/8453` →
   خروجی شامل `to` و `data`
2. در MetaMask یک tx به همان `to` با همان `data` بفرست (value = 0)
3. txHash را با `POST …/anchor` submit کن
4. فقط پس از receipt موفق + event دقیق + ۱۲ confirmation، رکورد
   `verified` ذخیره می‌شود. شکست در هر مرحله فقط anchor را pending/failed
   می‌گذارد؛ **signed close دست‌نخورده معتبر می‌ماند.**

## اگر فعلاً بودجه صفر است

هیچ کاری لازم نیست. وضعیت «deployment-ready، blocked on gas funds» است؛
هیچ قابلیتی نمایشی فعال نمی‌شود، هیچ regression ای وجود ندارد و این سند
هر زمان قابل اجراست.
