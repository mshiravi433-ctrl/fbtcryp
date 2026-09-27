# ۲۰۲۶-۰۹-۲۷ — مدار dYdX: «اتصال dYdX» با خطای WALLET_RETURNED_UNSIGNED — ریشه و رفع

## گزارش

در اپلیکیشن، دکمهٔ «اتصال dYdX» کیف پول را باز می‌کرد اما هیچ صفحهٔ امضایی نمی‌آمد و بعد از برگشت:

```
could not coalesce error (error={ "code": "WALLET_RETURNED_UNSIGNED" … },
payload={ "method": "eth_signTypedData_v4", … "domain":{"name":"dYdX Chain","chainId":"0x1"} … })
```

## ریشه

- امضای آنبوردینگ dYdX یک EIP-712 است که دامنه‌اش **`chainId: 1` (اتریوم)** است. این عدد بخشی از چیزی است که امضا می‌شود؛ عوض‌کردنش یعنی حساب dYdX دیگری غیر از آن‌چه dydx.trade برای همان کیف پول نشان می‌دهد.
- شبکهٔ پیش‌فرض اپ **BNB Chain (56)** است. کیف پول روی 56 بود و WalletConnect درخواست را با برچسب `eip155:56` فرستاد، در حالی که داخل آن chainId = 1 بود.
- کیف‌پول‌ها این ناهمخوانی را رد می‌کنند (MetaMask: «Provided chainId must match the active chainId»؛ Trust و بیشتر کیف‌های موبایل بی‌صدا درخواست را دور می‌اندازند). کاربر کیف پول را بدون صفحهٔ امضا می‌دید، برمی‌گشت و گارد امضا درست گزارش می‌داد: `WALLET_RETURNED_UNSIGNED` — که ethers آن را در «could not coalesce error» پیچیده بود.
- خودِ dydx.trade قبل از این امضا کیف پول را به اتریوم می‌برد (`useMatchingEvmNetwork` در v4-web). ما این کار را نمی‌کردیم.

## رفع (`src/lib/dydx.js`, `src/pages/Dydx.jsx`)

1. **اول سوییچ به اتریوم:** اگر کیف پول روی شبکهٔ 1 نیست، `switchChain(1)` زده می‌شود و تا وقتی provider خودش `eth_chainId = 1` نگوید امضا درخواست نمی‌شود. در WalletConnect اگر اتریوم در session تأیید شده باشد، این سوییچ محلی است و **هیچ پنجرهٔ اضافه‌ای** باز نمی‌کند.
2. **payload خام، دقیقاً مثل dydx.trade:** `eth_signTypedData_v4` مستقیم روی EIP-1193 با `chainId` عددی `1` (همان شکلی که viem/wagmi برای dydx.trade می‌فرستد)، نه رشتهٔ هگزِ `"0x1"` ethers.
3. **امضا همان است:** تست نشان می‌دهد امضای جدید بایت‌به‌بایت با امضای قبلی ethers برابر است ⇒ **آدرس dYdX هیچ کاربری عوض نمی‌شود.**
4. **تأیید امضا:** قبل از مشتق‌کردن کلید، امضا باید به همان آدرس متصل برگردد؛ امضای ۶۵ بایتی نبودن (کیف قرارداد هوشمند) یا آدرس دیگر ⇒ خطای نام‌دار، نه حساب dYdX اشتباه.
5. **برگرداندن شبکه:** در WalletConnect بعد از امضا کیف پول به شبکهٔ قبلی (مثلاً BNB) برمی‌گردد (سوییچ محلی، بدون پنجره). کیف پول داخلی اپ اصلاً سوییچ نمی‌شود (امضای محلی، ناهمخوانی ندارد).
6. **اتصال بدون وابستگی به RPC:** آدرس dYdX فقط از امضا ساخته می‌شود؛ اتصال به validator در پس‌زمینه و هنگام سفارش انجام می‌شود، با fallback از kingnodes به polkachu (هر دو روی `dydx-mainnet-1` زنده بررسی شدند). دیگر کندیِ یک RPC «اتصال» را خراب نمی‌کند.
7. **پیام‌های فارسی روشن** به‌جای متن خام ethers: `RETURNED_UNSIGNED`، `NEEDS_ETHEREUM`، `SWITCH_REJECTED`، `SESSION_GONE`، `METHOD_UNSUPPORTED`، `BAD_SIGNATURE`، `SIGNER_MISMATCH`، `VALIDATOR_UNREACHABLE`؛ و دکمه مرحله را نشان می‌دهد: «انتقال کیف پول به اتریوم…» ← «در کیف پول امضا کن…» ← «ساخت حساب dYdX…».

## بررسی زندهٔ سرویس‌ها (production، fbtswap.ir)

| سرویس | endpoint | وضعیت |
|---|---|---|
| مدار dYdX — بازارها | `/api/dydx/markets` | زنده (BTC-USD، ETH-USD، … قیمت اوراکل لحظه‌ای) |
| افق جهانی (Ostium، Arbitrum) | `/api/ostium/prices` + `/api/v1/futures/providers` | زنده؛ `ostium: AVAILABLE`، ۷۳ بازار، `recentErrors: 0` |
| آن‌چین (Velocity، Solana) | `/api/v1/futures/markets` | زنده؛ `drift: AVAILABLE`، ۵ بازار، `dataStatus: live` |
| validator های dYdX | kingnodes / polkachu `/status` | هر دو سینک، `catching_up: false` |

## تست

- `test/dydx-onboarding-probe.mjs` (۱۲ بررسی، بدون شبکه) با یک کیف پول شبیه‌سازی‌شده که مثل MetaMask/Trust ناهمخوانی chainId را رد می‌کند: سوییچ قبل از امضا، payload عددی، برابری امضا با نسخهٔ قبل، آدرس معتبر `dydx1…`، برگرداندن شبکه، و نگاشت همهٔ خطاها (از جمله همان «could not coalesce error» گزارش). در `npm test` و `npm run test:dydx-onboarding`.
- `vite build` سبز؛ `test/derivatives-hall-width.test.jsx` سبز.
