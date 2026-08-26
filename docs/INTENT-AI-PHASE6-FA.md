# FBT Intent AI — فاز ۶: اتصال زندهٔ Adapter (صادقانه، Fail-closed)

## هدف
اتصال واقعی به مسیرهای موجود اجرا (swap / bridge / dydx / perp / dca) **بدون ساختن مسیر موازی** و **بدون تظاهر به قابلیت پیکربندی‌نشده**. از `swap.js`, `bridge.js`, `dydx.js`, `perp.js`, `dcaExecution.js`, `smartWallet.js`, `preSignSimulation.js` استفاده می‌شود. router جدید نوشته نشد.

## ماژول‌ها (`src/lib/intent-ai/`)

### `liveRouterBridge.js`
انتخاب adapter موجود بر اساس `draft.kind/chain`. هر مقصد مشخص می‌کند کدام ماژول موجود استفاده می‌شود و چه ورودی (signer / provider / broker handle / dydx session) لازم دارد.
- **بدون اجرای موازی:** swap → `swap.executeSwap`، dydx → `dydx.placeDydxOrder`، broker → `brokerAdapter`، dca → `dcaExecution`، smartWallet → `smartWallet.checkPolicy`.
- **bridge صادقانه:** این مخزن فقط quote دارد؛ execute-bridge **wired نیست** (`implemented:false`, `configured:false`).
- `venueReadiness()` صادقانه می‌گوید کدام venue real است و کدام still `configured:false`.

### `venueHealth.js`
خواندن وضعیت پیکربندی بدون افشای secret. فقط `configured` (runtime inputs حاضر) یا `unavailable` (چیزی غایب). هرگز mock success.
- swap: نیازمند chain-supported + `provider` + `signer`.
- dydx: نیازمند `dydxConnected` + `signer`.
- broker: نیازمند `brokerHandle` محدود.
- bridge: همیشه `unavailable` (execution not wired).

### `submitPipeline.js`
خط لولهٔ الزامی: `sign → broadcast (موجود) → monitor → reconcile`.
- **preSignSimulation قبل از sign**؛ revert → **NO SIGN**؛ provider-busy → NO SIGN؛ بدون unsigned tx در مسیر swap → NO SIGN.
- venue پیکربندی‌نشده → `unavailable` (نه success).
- reconcile فقط COMPLETED واقعی؛ وگرنه pending / partial / unconfirmed.
- Emergency Stop در حلقهٔ monitor.
- هیچ ادعای gasless / sponsor (مگر مسیر موجود باشد؛ در این مخزن نیست).

## صداقت venueها
| venue | wired | configured |
|---|---|---|
| swap (DEX + aggregator) | ✅ | ✅ (روی EVM_CHAINS) |
| dYdX | ✅ | ✅ (با اتصال نشست + signer) |
| bridge | ❌ | ❌ (فقط quote) |
| dca | ✅ | ✅ (فعال‌سازی محلی) |
| broker | ✅ | ❌ (نیازمند broker handle) |
| smartWallet | ✅ | ✅ (سیاست محلی) |

## تست‌ها
- `test/intent-ai/phase6-live-wiring-probe.mjs`
- `test/intent-ai/phase6-unavailable-honest-probe.mjs` (بدون config → unavailable نه success؛ revert simulation → no sign)

همه از `npm test` اجرا می‌شوند.
