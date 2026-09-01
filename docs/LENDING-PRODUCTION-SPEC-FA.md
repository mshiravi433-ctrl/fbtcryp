# FBT Lending — مشخصات یکپارچهٔ Production (v1.0)

> **Lending کاملاً مستقل از Intent OS، چندشبکه‌ای، غیرامانی، قابل اتصال به چند پروتکل، با داده زنده و مدیریت کامل Position داخل همان صفحه.**
>
> این سند مشخصات ۳۵بندی را با **وضعیت فعلی کد** یکپارچه می‌کند: هر بند به فایل واقعی در مخزن نگاشت شده و «چه چیز هست / چه چیز در همین تغییر ساخته شد / چه چیز مانده» مشخص است. تیم توسعه فقط با این سند + فایل‌های زیر باید بتواند ادامه بدهد.

---

## 0. اصل حاکم (بند ۳۵)

Lending Engine از UI مستقل است و Frontend فقط سه تب می‌بیند: **LEND | BORROW | MY POSITIONS**. اضافه‌کردن پروتکل/شبکهٔ جدید نباید صفحه را از نو بسازد.

نگاشت واقعی در کد:

| لایه | فایل |
|---|---|
| Lending Engine (مستقل از UI) | `src/lib/lending-engine/` — ۹ ماژول خالص، بدون وابستگی به React/Node |
| کلاینت زنجیرهٔ Aave V3 (خواندن + نوشتن) | `src/lib/lending.js` |
| صفحهٔ Lending (سه تب) | `src/pages/Loan.jsx` (route: `/loan`) |
| BFF (خواندن + ساخت تراکنش بدون امضا) | `server/lending.js` → `app.use('/api/lending', …)` در `server/app.js` |
| تست‌ها | `test/lending-engine-probe.mjs` (منطق خالص)، `test/lending-bff-probe.mjs` (HTTP)، `test/loan-execution-probe.jsx` (صفحه تا آخرین مرحله) |

---

## 1. نگاشت کامل ۳۵ بند

راهنما: ✅ موجود قبل از این تغییر · 🆕 ساخته‌شده در این تغییر · ⬜ باقی‌مانده (با مسیر دقیق)

### معماری و استقلال از Intent OS

| بند | وضعیت | واقعیت در کد |
|---|---|---|
| 1. معماری کلی، Intent OS در مسیر نیست | ✅ | `Loan.jsx` هیچ ارجاعی به Intent OS ندارد؛ پروب `loan-execution-probe.jsx` اثبات می‌کند هیچ کنترل صفحه به `#/intent` لینک نمی‌دهد و بعد از اجرا همچنان `#/loan` است. |
| 2. ساختار صفحه (Network, Wallet, Stats, سه تب, Alerts) | 🆕 | تب‌ها + HeroStats + ChainRail موجود بود؛ Alerts (`🔔` با شمارنده و پنل) در همین تغییر اضافه شد. |

### Frontend بدون Wallet (بند ۳)

✅ `Loan.jsx`: بدون Wallet، Market/APY/پارامترهای ریسک قابل مشاهده است؛ دکمهٔ عمل به `[Connect Wallet]` تبدیل می‌شود (پروب: `without a wallet the action is an honest connect gate`). هیچ Error‌ای رندر نمی‌شود.

### Wallet Manager (بند ۴) و Network Manager (بند ۵)

| بند | وضعیت | واقعیت در کد |
|---|---|---|
| 4. WalletAdapter abstraction | ✅ | `src/context/WalletContext.jsx` — اتصال EIP-1193 (MetaMask/Rabby/Injected) + WalletConnect/AppKit + کیف پول محلی؛ API هم‌ارز `connect/disconnect/getAddress/getChainId/getBalance/signTransaction/sendTransaction/switchNetwork` |
| 5. شبکه‌ها hard-code نشوند، Feature Flag | 🆕 | `src/lib/lending-engine/networkConfig.js`: ۱۰ شبکهٔ spec (Ethereum، BSC، Polygon، Arbitrum، Base، Optimism، Avalanche + Linea/Sonic/Solana با `enabled:false`). ChainRail از `enabledNetworks()` رندر می‌شود؛ پرچم خاموش = شبکه از صفحه حذف می‌شود بدون آنکه Lending بخوابد. نسخهٔ سرور: `GET /api/lending/networks` |

### Market API و Position API (بند ۶ و ۷)

| بند | وضعیت | واقعیت در کد |
|---|---|---|
| 6. `GET /api/lending/markets` | 🆕 | `server/lending.js`: APY از `getReserveData` روی زنجیره، LTV/Threshold/Bonus از بیت‌ماسک configuration رمزگشایی می‌شود، قیمت از Oracle Aggregator (CoinGecko → `providers.js`). `totalSupply/totalBorrow` صادقانه `null` + `meta.totals: 'unavailable-until-indexer'` — ساختگی نیست. کش ۲۰ ثانیه (`withCache`). |
| 7. `GET /api/lending/positions/:wallet` | 🆕 | همیشه fresh از زنجیره (بدون کش)؛ شامل `healthFactor`، `liquidationRisk`، و **`riskLevel` از Risk Engine** (بند ۱۲). |

### Protocol Adapter (بند ۸) و Router (بند ۹)

| بند | وضعیت | واقعیت در کد |
|---|---|---|
| 8. `LendingProtocolAdapter` interface | 🆕 | `src/lib/lending-engine/adapter.js`: هر ۱۴ متد spec با پیاده‌سازی base که `NotImplementedError` پرتاب می‌کند (یک آداپتور نیمه‌کاره بلند خطا می‌دهد، نه بی‌صدا). `AaveAdapter` مرجع است؛ `build*Transaction` تراکنش **بدون امضا** برمی‌گرداند. Compound/Morpho/Solana در registry ثبت‌اند ولی `enabled:false`. |
| 9. Router با امتیاز چندبعدی | 🆕 | `router.js`: امتیاز = APY (۰٫۳) + Liquidity (۰٫۲) + Utilization (۰٫۱) + Protocol Risk (۰٫۱۵) + Oracle Risk (۰٫۰۵) + Contract Risk (۰٫۱۰) + Gas (۰٫۰۵) + Reliability (۰٫۰۵) — همه قابل تنظیم. تست: پروتکل با APY بالاتر اما ریسک بدتر می‌بازد؛ در Borrow، APY کمتر برنده است. |

### جریان‌ها (بند ۱۰ و ۱۱)

| بند | وضعیت | واقعیت در کد |
|---|---|---|
| 10. Supply Flow | ✅+🆕 | مراحل Validate→Wallet→Network→Balance→Allowance→Market→Plan در `openExecution`؛ اجرای قدم‌به‌قدم با وضعیت زندهٔ هر قدم در `runLendingPlan`؛ پیش‌نمایش قبل از اولین امضا. Simulation/Estimate روی سرور در POST `/quote/*` (بند ۲۶). |
| 11. Borrow Flow | ✅+🆕 | Borrowing power از خود Pool؛ پیش‌بینی Health Factor بعد از وام (`projectHealthFactor`)؛ در سرور: سقف وام + ریسک لیکوئیدیشن قبل از ساخت تراکنش چک می‌شود (`BORROW_LIMIT_EXCEEDED`، `HEALTH_FACTOR_TOO_LOW`). |

### Health Factor (بند ۱۲)

| وضعیت | واقعیت در کد |
|---|---|
| 🆕 | `health.js`: آستانه‌ها **configuration** هستند (`DEFAULT_RISK_BANDS` مطابق جدول spec) و می‌توانند از پروتکل/سرور override شوند. Backend `riskLevel` برمی‌گرداند؛ رنگ فقط از همین خروجی. `assessPosition` تابع واحد UI + Alert + BFF است — «Health Factor درست باشد» نمی‌تواند بین صفحه‌ها drift کند. |

### Position Management (بند ۱۳)

✅ `PositionsTab` در `Loan.jsx`: کارت هر دارایی (Collateral، ارزش، بدهی) با دکمه‌های Add Collateral / Borrow More / Repay / Withdraw همان‌جا در Bottom Sheet — بدون Redirect (پروبها اثبات می‌کنند route هرگز عوض نمی‌شود).

### Error Handling (بند ۱۴)

🆕 `errors.js`:

- تمام ۱۶ کد spec + کدهای داخلی (۲۹ کد) با پرچم `retryable`؛
- `mapRawError`: خطای خام RPC/Wallet → کد پایدار؛ متن خام **هرگز** به کاربر نمی‌رسد (تست: hex پی‌لود revert حذف می‌شود)؛
- UI: کادر خطا با `loan.error.<CODE>` ترجمه‌شده (en/fa) + دکمهٔ `[Try Again]`؛
- نمونهٔ spec: `execution reverted: 0x12…` → «Transaction could not be completed. Your collateral value changed before confirmation.»

### Transaction State Machine (بند ۱۵) و Tracking (بند ۱۶)

🆕 `stateMachine.js`: نمودار دقیق spec پیاده شده — `IDLE→VALIDATING→READY→SIMULATING→AWAITING_SIGNATURE→SIGNED→BROADCASTING→PENDING→CONFIRMED→VERIFYING→COMPLETED`، با `ERROR→RETRY→VALIDATING` و `AWAITING_SIGNATURE→CANCELLED` و ردّ انتقال‌های غیرمجاز (تست‌شده). در `Loan.jsx` ماشین هر اجرا را می‌راند و در شیت نمایش داده می‌شود (چک‌لیست ۵مرحله‌ای بند ۱۶ + requestId). هش تراکنش با لینک Explorer از قبل موجود بود.

### جلوگیری از Duplicate Transaction (بند ۱۷)

🆕 `idempotency.js`:

- کلید idempotency قطعی (همان ورودی = همان کلید) — لایهٔ سرور هم همان کلید را می‌فهمد؛
- گارد in-flight: دابل‌تپ روی Confirm **در کد** مسدود است (نه فقط با دیزاین دکمه)؛ دکمه در حالت `[Transaction Pending…]`؛
- سرور: `Idempotency-Key` اجباری روی POSTها + replay پاسخ قبلی (`createIdempotencyStore`).

### داده زنده (۱۸)، Indexer (۱۹)، Database (۲۰)

| بند | وضعیت | مسیر |
|---|---|---|
| 18. WebSocket + RPC + Indexer | ⬜ | امروز: خواندن زندهٔ زنجیره + کش کوتاه + refresh خودکار بعد از هر تراکنش (`refresh()` پس از done) + APY-change alerts از snapshot قبلی. WebSocket/event-stream سرور هنوز نیست — فاز ۲. |
| 19. Indexer (Supply/Withdraw/Borrow/Repay/Liquidation/…) | ⬜ | جدول رویدادها در `docs/LENDING-PRODUCTION-SPEC-FA.md` (همین سند، پیوست A)؛ `server/lending.js` امروز منبع صادقانهٔ `memory` است. |
| 20. Database (۱۱ جدول spec) | ⬜ | شمای کامل در پیوست A. اصل «کلید خصوصی هرگز در DB» از امروز ساختاری است: سرور اصلاً نمی‌تواند امضا کند (بند ۳۰). |

### Oracle Engine (بند ۲۱)

🆕 (نسخهٔ اول) `server/lending.js → oraclePrices()`: تجمیع + قیمت‌های ناموجود/ناصفر اعتبارسنجی می‌شوند؛ شکست → `ORACLE_STALE` + گزارش به Circuit Breaker؛ `ORACLE_ANOMALY` در error taxonomy و alert rules هست. چند منبع مستقل (Chainlink/Pyth) + اعتبارسنجی انحراف بین منبع‌ها: فاز ۲ (پیوست B).

### Alert Engine (۲۲) و Alert UI (۲۳)

🆕 کامل: `alerts.js` — هر ۹ قانون spec به‌صورت تابع خالص (در UI و سرور یکسان اجرا می‌شود) + dedupe + severity. UI: زنگولهٔ `🔔 N` بدون border سفید، پنل با ردیف‌های رنگی، هشدار Critical با دکمهٔ `[Manage Position]` که به تب Positions می‌رود. سرور: `GET/POST/DELETE /api/lending/alerts*`.

### Refresh (۲۴)، Cache (۲۵)، Failover (۲۶)، Circuit Breaker (۲۷)، Read-Only UI (۲۸)

| بند | وضعیت | واقعیت در کد |
|---|---|---|
| 24. Initial→REST→refresh بعد از TX | ✅+🆕 | بعد از موفقیت: ماشین به `VERIFYING` می‌رود → `refresh()` موقعیت fresh را می‌خواند → `COMPLETED`. |
| 25. Redis برای Market + Position همیشه fresh | 🆕 | کش `withCache` (memory در dev، قابل تعویض با Redis). Position هیچ‌وقت کش نمی‌شود. |
| 26. RPC failover + verify قبل از تراکنش | 🆕 | `rpcWithFailover` لیست RPC هر شبکه را به‌ترتیب امتحان می‌کند؛ قبل از ساخت تراکنش، بازار و حساب از زنجیرهٔ سالم re-read می‌شود. |
| 27. NORMAL→DEGRADED→READ_ONLY | 🆕 | `circuitBreaker.js` پنج مؤلفه (rpc/oracle/protocol/data/reorg)، پنجرهٔ لغزشی، آستانهٔ باز شدن؛ تست‌شده (blip→DEGRADED، ۳ شکست→READ_ONLY، بهبود→NORMAL). |
| 28. بنر Read-Only | 🆕 | `ReadOnlyBanner` در `Loan.jsx` از `GET /api/lending/status` تغذیه می‌شود؛ فقط وقتی سرور می‌گوید READ_ONLY ظاهر می‌شود. در sandbox بدون egress عملاً دیده شد: ۹ شکست RPC → READ_ONLY → POSTها `READ_ONLY_MODE` گرفتند. |

### APIها (بند ۲۹) — همه ساخته شد

| Route | وضعیت |
|---|---|
| `GET /lending/networks` | 🆕 |
| `GET /lending/markets` | 🆕 |
| `GET /lending/markets/:market` | 🆕 |
| `GET /lending/positions/:wallet` (+`?network=`) | 🆕 |
| `POST /lending/quote/{supply,borrow,repay,withdraw}` | 🆕 |
| `POST /lending/transaction/{supply,borrow,repay,withdraw}` | 🆕 |
| `GET /lending/transactions/:wallet` | 🆕 |
| `GET /lending/alerts/:wallet` · `POST /lending/alerts` · `DELETE /lending/alerts/:id` | 🆕 |
| `GET /lending/status` (اضافه، برای بند ۲۷/۲۸) | 🆕 |

### امنیت API (بند ۳۰) و Security Layer (بند ۳۱)

🆕 ساختاری — نه توصیه‌ای:

- BFF فقط **می‌سازد**؛ payload خروجی `signed:false, broadcast:false, capabilities:{sign:'wallet-only', broadcast:'wallet-only'}` دارد و پروب HTTP آن را روی سیم assert می‌کند؛
- هیچ امضاکننده، کلید یا broadcastی در `server/lending.js` وجود ندارد (تست: موفقیت یا شکست، پاسخ هرگز فیلد کلید ندارد)؛
- Allowlist: آدرس Pool از جدول ثابت audited، توکن از رجیستری `chainsLite.TOKENS`؛ آدرس ناشناخته قبل از هر RPC رد می‌شود (`NOT_A_RESERVE` بدون دیال — تست‌شده)؛
- Chain ID validation، شبیه‌سازی (eth_estimateGas)، replay protection (idempotency)، rate limiting (زیر limiter عمومی `/api`).

### Test Matrix (بند ۳۲) و Definition of Done (بند ۳۳)

نگاشت کامل در پیوست C. خلاصه:

- **پوشش‌شده**: Connect/Disconnect، Wrong chain، رد امضا (کد `USER_REJECTED`)، Supply نرمال/insufficient balance/allowance/approval، Borrow valid/max/بالای سقف، موقعیت صفر/تک/چند، Repay/Withdraw، Duplicate click، Failover، Read-only، بدون Intent OS، بدون white border (تب‌ها `border:none`)، بدون Redirect، بدون کلید در Backend، Allowlist، Mobile responsive (صفحه در عرض موبایل تست می‌شود).
- **مانده برای فاز ۲**: Wallet locked/switched externally، Transaction dropped/pending مسیر کامل، Liquidation (رویداد واقعی)، Indexer/WebSocket، شبکهٔ Testnet واقعی، اسناد Mainnet flag.

### ساختار پروژه (بند ۳۴)

نگاشت به مونورپوی فعلی (بدون بازچینی — همان معماری، مسیرهای موجود):

| پیشنهاد spec | این مخزن |
|---|---|
| `/apps/web/lending` | `src/pages/Loan.jsx` |
| `/services/lending-api` | `server/lending.js` |
| `/services/risk-engine` | `src/lib/lending-engine/health.js` + `alerts.js` |
| `/services/oracle-engine` | `server/lending.js → oraclePrices()` (فاز ۲: ماژول جدا) |
| `/services/transaction-service` | `server/lending.js → build*` + `src/lib/lending.js → runLendingPlan` |
| `/packages/wallet-adapters` | `src/context/WalletContext.jsx` |
| `/packages/network-config` | `src/lib/lending-engine/networkConfig.js` |
| `/packages/protocol-adapters/*` | `src/lib/lending-engine/adapter.js` (+ `src/lib/lending.js` برای Aave) |
| `/packages/transaction-engine` | `src/lib/lending-engine/stateMachine.js` + `idempotency.js` |
| `/packages/risk-model` | `src/lib/lending-engine/health.js` + `router.js` |
| `/packages/lending-types` | ⬜ فاز ۲ (استخراج تایپ‌ها به `lending-types` مشترک) |

---

## 2. قراردادهای مهندسی (خلاصه برای تیم)

### Transaction State Machine (بند ۱۵)

```text
IDLE → VALIDATING → READY → SIMULATING → AWAITING_SIGNATURE → SIGNED
     → BROADCASTING → PENDING → CONFIRMED → VERIFYING → COMPLETED
SIMULATING → ERROR          AWAITING_SIGNATURE → CANCELLED (رد کاربر)
ERROR → RETRY → VALIDATING  CANCELLED → IDLE
```

انتقال غیرمجاز با `{ok:false, reason:'ILLEGAL_TRANSITION'}` رد می‌شود. `createTransactionMachine({action, meta})` در `stateMachine.js`.

### Error Contract (بند ۱۴)

- کدها فقط از `LENDING_ERRORS`؛ `mapRawError(raw)` تنها نقطهٔ ورود خطای خام؛
- `retryable` تعیین می‌کند دکمهٔ `[Try Again]` نمایش داده شود یا نه؛
- متن کاربر = `loan.error.<CODE>` (i18n) یا `describeError(code)`.

### Adapter Contract (بند ۸)

هر پروتکل جدید: کلاس `extends LendingProtocolAdapter` + ثبت در `registerAdapter` با `enabled` + تست در `test/lending-engine-probe.mjs`. UI هیچ تغییری نمی‌کند.

### Router Contract (بند ۹)

`scoreProtocol(candidate, {weights, riskTables, side})` → `{total, parts}`؛ `bestRoute(candidates, {circuit})`. کاندید غیر `active` یا circuit-broken هرگز رتبه نمی‌گیرد.

### Risk Contract (بند ۱۲)

آستانه‌ها همیشه به‌صورت آرایهٔ bands پاس داده می‌شوند؛ UI بدون bands پیش‌فرض را می‌گیرد. `assessPosition` خروجی واحد برای UI/BFF/Alerts.

### Security Contract (بند ۳۰/۳۱)

- Backend: `sign:'wallet-only'`, `broadcast:'wallet-only'` — هر payload جدید که این قرارداد را نشکند، پروب `lending-bff-probe.mjs` شکست می‌خورد؛
- هر آدرس قرارداد باید از `assertAllowedContract` (pool/token) بگذرد؛
- هر POST نیازمند `Idempotency-Key` معتبر.

---

## 3. فازبندی اجرا برای تیم توسعه

### فاز ۱ — همین تغییر (Done)

- [x] Engine خالص (errors, stateMachine, health, networkConfig, adapter, router, alerts, idempotency, circuitBreaker)
- [x] BFF کامل `/api/lending/*` با failover + cache + breaker + idempotency
- [x] اتصال UI: ماشین تراکنش، خطاهای انسانی، دابل‌کلیک، بنر Read-Only، Alerts، ChainRail پرچم‌دار
- [x] تست: ۴۸ assertion منطق خالص + ۱۶ assertion HTTP + پروب‌های موجود (۳۷ + ۸۷) سبز

### فاز ۲ — پیش از Production (به‌ترتیب)

1. **Indexer** (بند ۱۹) — پیوست A: جدول‌های `transactions`, `transaction_events`, `wallet_positions`, `position_snapshots`, `alerts` + listener رویدادها. خروجی: پر کردن `totalSupply/totalBorrow/availableLiquidity` در `/markets` و منبع `indexer` در `/positions`.
2. **Oracle Aggregator چندمنبعی** (بند ۲۱) — Chainlink/Pyth + انحراف‌سنج بین منابع → `ORACLE_ANOMALY` واقعی.
3. **WebSocket/SSE** (بند ۱۸) — push رویداد market/position به صفحه.
4. **آداپتور دوم** (Compound V3 یا Morpho) + فعال‌سازی Router در UI (نمایش «بهترین گزینه» با دلیل).
5. **Testnet واقعی** + گیت Mainnet با Feature Flag (بند ۵/۳۳).
6. **DB واقعی** (Postgres/Redis) به‌جای memory storeها؛ کلید خصوصی هرگز (ساختاری).

---

## پیوست A — Schema پایهٔ Database (بند ۲۰)

```sql
-- هرگز: private_key / seed در هیچ جدولی.
networks(chain_id PK, key, name, native_token, rpc_endpoints jsonb, explorer, enabled bool, flags jsonb)
protocols(id PK, name, kind, enabled bool, allowlisted_contracts jsonb)
assets(address PK, chain_id, symbol, decimals, oracle_feed, allowlisted bool)
markets(chain_id, protocol_id, asset_address, ltv_bps, liq_threshold_bps, liq_bonus_bps, is_active, PK(chain_id,protocol_id,asset_address))
market_snapshots(id PK, market_fk, supply_apy, borrow_apy, liquidity, price_usd, at)
wallet_positions(wallet PK, chain_id, protocol_id, asset_address, supplied_wei, borrowed_wei, is_collateral, PK(wallet,chain_id,protocol_id,asset_address))
position_snapshots(id PK, position_fk, health_factor, collateral_usd, debt_usd, at)
transactions(id PK, wallet, chain_id, protocol_id, kind, request_id, idempotency_key UNIQUE, status, tx_hash, built_payload jsonb, signed_at, broadcast_at, confirmed_at)
transaction_events(id PK, transaction_id, type, block_number, log_index, payload jsonb)
alerts(id PK, wallet, type, severity, value jsonb, read bool, at)
oracle_prices(id PK, asset, source, price, at, status)
risk_snapshots(id PK, wallet, circuit_state, risk_level, payload jsonb, at)
```

اصل ثابت: تراکنش‌ها فقط در کیف کاربر امضا می‌شوند؛ جدول `transactions` فقط **payload ساخته‌شده/امضاشده توسط کاربر** را ثبت می‌کند.

## پیوست B — Oracle Engine فاز ۲ (بند ۲۱)

```text
Chainlink Feed A ─┐
Pyth Feed B       ─┤→ Oracle Aggregator → Price Validation (انحراف بین منابع،
CoinGecko C       ─┘     تازگی، حدود منطقی) → Risk Engine
                                │ انحراف > X٪
                                ▼
                          ORACLE_ANOMALY → Circuit Breaker → توقف/محدودیت Borrow و Withdraw پرریسک
```

## پیوست C — Test Matrix → پروب‌ها (بند ۳۲/۳۳)

| حالت spec | پروب / فایل | وضعیت |
|---|---|---|
| Connect / Disconnect / Wrong chain | `loan-execution-probe.jsx` + `intentos-wiring-probe.jsx` | ✅ |
| Rejected signature | `errors.js → USER_REJECTED` + ماشین CANCELLED | 🆕 |
| Supply نرمال / نیاز به approval | `loan-execution-probe.jsx` (decode کال‌دیتا) | ✅ |
| Insufficient balance/allowance | `server/lending.js` (`INSUFFICIENT_BALANCE`/needsApproval) + probe | 🆕 |
| Borrow valid/max/بالای سقف | `server/lending.js` (`BORROW_LIMIT_EXCEEDED`) | 🆕 |
| Oracle failure / Market paused | `MARKET_PAUSED`/`ORACLE_STALE` + breaker | 🆕 |
| Position صفر/تک/چند/چندشبکه | `PositionsTab` + `/positions` | ✅/🆕 |
| Position updated externally / Liquidation | ⬜ (Indexer فاز ۲) | ⬜ |
| Partial/Full repay | `loan-execution-probe.jsx` | ✅ |
| Duplicate click | `idempotency.js` guard (تست) | 🆕 |
| RPC failover / Read-only fallback | `lending-bff-probe.mjs` + `circuitBreaker.js` (تست) | 🆕 |
| No Intent OS dependency / No redirect / No white borders | پروب‌های loan + intentos | ✅ |
| No private keys on backend / Contract allowlist | `lending-bff-probe.mjs` | 🆕 |
| Testnet fully tested / Mainnet flag | ⬜ فاز ۲ | ⬜ |

---

## دستورهای سریع

```bash
npm test                                   # کل سوئیت (engine + BFF + loan + intentos + ...)
node test/lending-engine-probe.mjs         # فقط منطق خالص engine
node -e "import('./test/lending-bff-probe.mjs').then(m=>console.table(m.default))"  # فقط BFF
npx vite build -c test/vite.loan.mjs && (cd test && node run-one-probe.mjs ./.out/loan/loan-execution-probe.js)  # فقط صفحه
```
