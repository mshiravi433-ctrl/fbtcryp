# وضعیت اجرای Farm و برنامهٔ rollout

بازبینی کد: ۲۰۲۶-۰۹-۰۹. وجود آداپتور، تست با provider مصنوعی، PASS واقعی fork، و فعال‌بودن canary در deployment چهار وضعیت جدا هستند. این سند هیچ تراکنش mainnet یا فعال‌سازی public capital را ادعا نمی‌کند.

راهنمای اجرایی و متغیرهای build در [`farm-staged-rollout-fa.md`](./farm-staged-rollout-fa.md) است.

## محدودهٔ موجود

| اتصال | محدودهٔ کد | وضعیت ورود سرمایه |
|---|---|---|
| DefiLlama | discovery، APY/TVL، تاریخچه و freshness | فقط data/mapping؛ هرگز transaction target نیست |
| Aave v3 / Base / USDC بومی | supply، withdraw، position، exact approve، revoke، simulation و receipt/event/state proof | اولویت canary؛ پیش‌فرض خاموش |
| Compound v3 / Base / USDC بومی | supply، withdraw، position، exact approve، revoke و proof | مرحلهٔ مستقل بعدی؛ پیش‌فرض خاموش |
| Aave v3 / Arbitrum / USDC بومی | supply، withdraw، position، revoke و proof | مرحلهٔ مستقل بعدی؛ پیش‌فرض خاموش |
| Lido / Ethereum | stake، wrap/unwrap، request withdrawal، استخراج requestId و claim | مرحلهٔ مستقل؛ پیش‌فرض خاموش |
| Morpho Blue / Base | core، marketId پین‌شده، USDC loan و cbBTC collateral | probe مستقل لازم؛ پیش‌فرض خاموش |

## gate مرحله‌ای

`vite.config.js` سیاست `scripts/farm-rollout-policy.mjs` را برای همهٔ buildهای اصلی اجرا می‌کند.

- بدون flag فعال: build عمومی `capital-off` و مجاز است.
- با flag فعال: `FARM_ROLLOUT_PROTOCOLS` دقیق، `FARM_STRICT_FORK_EVIDENCE=true` و allowlist معتبر و غیرخالی همان protocol اجباری است.
- فعال‌کردن Aave Base، protocolهای دیگر را مطالبه یا فعال نمی‌کند.
- flag فعال بدون gate کامل، حتی با اجرای مستقیم `vite build`، build production را fail می‌کند.
- سقف‌های canary بالاتر از ۱۰۰/۵۰۰ USDC (و ۱/۱۰ ETH برای Lido) پذیرفته نمی‌شوند.

## خروج مستقل از feed و kill switch

position hub با descriptorهای ثابت و بدون APY/TVL، قراردادهای پین‌شدهٔ Aave Base، Compound Base، Aave Arbitrum و Lido را مستقیماً می‌خواند. بنابراین خرابی یا فیلتر DefiLlama مسیر position/withdraw/claim/revoke پشتیبانی‌شده را حذف نمی‌کند. خواندن cross-chain به شبکهٔ فعال wallet وابسته نیست؛ امضا همچنان تا network switch صریح مسدود است.

خاموش‌کردن money-in flag فقط supply/stake جدید را می‌بندد. خروج بر اساس owner و position واقعی تصمیم می‌گیرد، نه flag و نه allowlist.

## probeهای strict

```bash
BASE_RPC_URL="$BASE_RPC_URL" npm run test:aave-base-fork -- --strict
BASE_RPC_URL="$BASE_RPC_URL" npm run test:compound-base-fork -- --strict
ARBITRUM_RPC_URL="$ARBITRUM_RPC_URL" npm run test:aave-arbitrum-fork -- --strict
ETHEREUM_RPC_URL="$ETHEREUM_RPC_URL" npm run test:lido-mainnet-fork -- --strict
BASE_RPC_URL="$BASE_RPC_URL" npm run test:morpho-base-fork -- --strict
```

در strict mode نبود متغیر RPC صریح، نبود Anvil، خطای SSL/RPC، SKIP یا هر assertion ناموفق exit غیرصفر است. test واحد یا build موفق جای evidence واقعی fork را نمی‌گیرد.

Aave Base probe علاوه بر deployment/reserve، exact approval، `eth_call` و `estimateGas` برای هر step، بررسی account/network پیش از امضا، receipt/event/position transition، max withdraw، revert/cap و taxonomy مربوط به rejection/timeout/replacement را پوشش می‌دهد.

## وضعیت production

تا وقتی این سه مورد با هم موجود نباشند، public capital خاموش می‌ماند:

1. PASS واقعی strict fork برای همان protocol؛
2. allowlist عمومی و غیرخالی با رضایت صاحب wallet؛
3. canary کوچک و کامل شامل supply، proof و withdraw کامل.

وب و APK می‌توانند live و سالم باشند در حالی که money-in عمداً خاموش است. چنین وضعیتی production-safe است، اما «production-ready برای ورود سرمایه عمومی» نیست.
