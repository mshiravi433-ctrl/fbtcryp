# FBT INTENT AI — فاز ۱۱: تولید Strategy، رقابت و Simulation

تاریخ: ۲۰۲۶-۰۹-۱۰ (به‌روزرسانی live runtime)
مرجع: specification رسمی ۶۳بخشی **FBT INTENT AI — NEXT-GENERATION AUTONOMOUS FINANCIAL AGENT OS**

## وضعیت صادقانه

قرارداد source فاز ۱۱ از قبل وجود داشت. **از ۲۰۲۶-۰۹-۱۰ runtime واقعی متصل است:**

1. **Route simulator زنده** (`server/fios/routeSimulator.js`) به `simulateRoute` تزریق می‌شود.
2. **Evidence feed** از financial state + price series (CoinGecko) + smart-money overview.
3. **Strategy monitor provider** در composition root سیم‌کشی شده.
4. **Smart Money** دیگر فقط صفحهٔ Intelligence نیست — وارد generate / compete / decide می‌شود.

pipeline واقعی:

```
Strategy A  →  simulate (fees, slippage, drawdown, liquidity)
Strategy B  →  simulate
Strategy C  →  simulate
        ↓
 risk-adjusted return
   · probability (از simulation engine / Monte-Carlo)
   · drawdown
   · liquidity
   · fees
   · slippage
   · historical evidence (price series)
   · current market regime (cross-asset)
   · smart-money net / CEX↔DEX / whale activity
        ↓
 Best Strategy  (provisional, user choice still required)
```

هیچ winnerی مجوز execution نیست؛ `executionPermission: false` و `guaranteed: false` همیشه.

## Implementation

### قرارداد source (از قبل)

- `src/lib/intent-ai/strategyCompetition.js` — proposal / compare / simulateRoute / compete / monitor / switch / replan
- `src/lib/intent-ai/phaseBoundary.js` — عدم صدور permission
- `src/lib/intent-ai/smartMoneyAdapter.js` — evidence از whale events

### runtime زنده (جدید)

- `server/fios/routeSimulator.js`
  - `createRouteSimulator` — provider واقعی برای `simulateRoute`
  - `simulateAllStrategies` — A/B/C → simulate
  - `riskAdjustedScore` — return − risk − drawdown − fees/slippage ± liquidity ± SM ± regime
- `server/fios/smartMoneyIntel.js`
  - `fetchSmartMoneyIntel` / `buildSmartMoneyIntel` — overview → digest برای AI
  - `enrichStrategiesWithSmartMoney` — evidence + notes روی هر proposal
  - `smartMoneyKindBias` — bias مشاهده‌ای per kind (نه سیگنال خرید)
- `server/fios/strategy.js` — `smartMoney` + `globalContext.cexDexDirection` روی هر proposal
- `server/fios/competition.js`
  - نقش **SMART_MONEY_ANALYST**
  - ranking با live simulation + risk-adjusted score
  - `winnerStatus: live-simulated-provisional` وقتی sim زنده باشد
- `server/fios/decision.js` — `smartMoney` و `liveSimulation` روی decision record
- `server/fios/index.js` — `priceSeries` زنده، `routeSimulator`، `smartMoneyIntel`، `strategyMonitor`
- `server/fios/router.js`
  - `POST /api/ai/strategies` — با smart money
  - `POST /api/ai/strategies/compare` — simulate + compete
  - `POST /api/ai/strategies/simulate` — endpoint صریح live route sim
  - `POST /api/ai/decision` — pipeline کامل generate → simulate → compete → decide
- `server/intentMonitoring.js`
  - متریک‌های جدید: `VOLUME`, `WHALE`, `SMART_MONEY_NET`, `EXCHANGE_FLOW`
  - ارزیابی از feed واقعی (providers / smartMoney overview)

## API و schema

Schemaهای اصلی:

- `fbt.intent-strategy-proposal.v1`
- `fbt.intent-route-simulation.v1`
- `fbt.intent-strategy-competition.v1`
- `fbt.intent-strategy-monitor.v1`
- `fbt.intent-strategy-switch.v1`
- `fbt.fi.route-simulator.v1` *(runtime)*
- `fbt.fi.smart-money-intel.v1` *(runtime)*

Endpointها:

```http
POST /api/ai/strategies
POST /api/ai/strategies/compare
POST /api/ai/strategies/simulate
POST /api/ai/decision
GET  /api/intents/v1/phase-status
GET  /api/intents/v1/public-status
```

هیچ endpointی authorization یا auto-execution صادر نمی‌کند.

## Tests

- probe قرارداد: `test/intent-ai/phase11-strategy-competition-probe.mjs` — `npm run test:phase11`
- probe live: `test/intent-ai/phase11-live-strategy-probe.mjs` — `npm run test:phase11-live`
- موارد live: simulator connected، simulateAll، risk-adjusted score، competition live-simulated، smart-money conditions در decision، monitor VOLUME/WHALE، عدم execution permission.

## Configuration

- configured: source contract + **runtime route simulator + smart-money intel + price series + monitor metrics**.
- partially configured: production evidence persistence هنوز به launch-wide evidence gate وابسته است.
- not configured: هیچ signer/auto-execution (عمدی).

## Operational Status

- implemented: **true** (source + runtime).
- ready: وابسته به evidence gate سراسری launch (مثل بقیهٔ فازها)؛ providerهای فاز ۱۱ دیگر blocker اختصاصی نیستند.
- live runtime path: **true** وقتی FI composition root بالا باشد.
- blockers باقی‌ماندهٔ safety: `USER_CHOICE_REQUIRED` (عمدی — winner provisional است).

## Safety Confirmation

- raw secret expose شده؟ **خیر**.
- execution بدون user confirmation؟ **خیر**.
- Guardian/policy bypass؟ **خیر** — permission صادر نمی‌شود مگر همهٔ gateها.
- score بدون evidence؟ **خیر** — unscored نمی‌تواند برنده شود.
- نبود provider؟ **unavailable** گزارش می‌شود، نه zero-quote موفق.
- Smart money داخل تصمیم AI؟ **بله** — evidence + conditions + analyst role + risk-adjusted bias.

## Authority activation (`executionPermission` + `guaranteed`)

از ۲۰۲۶-۰۹-۱۰ این دو فلگ **دیگر همیشه false نیستند**. Resolver:

- `server/fios/executionAuthority.js`
- مصرف در `decision.js` و `POST /api/ai/decision` و `POST /api/ai/decision/:id/confirm`

| فلگ | کی true می‌شود | معنی |
|-----|----------------|------|
| `executionPermission` | همهٔ gateها | اجازهٔ **unsigned hand-off** (نه auto-sign) |
| `guaranteed` | همان gateها | **تضمین فرایند** (policy/guardian/limits) |
| `returnGuaranteed` | **هرگز** | سود/APY/PnL هیچ‌وقت تضمین نمی‌شود |
| `automaticExecution` | **هرگز** | کیف پول باید امضا کند |

Gateهای لازم:

1. `execute: true` / `executionRequested`
2. `userConfirmed: true`
3. `authorizationScreenShown: true`
4. `guardianApproved: true`
5. `policyVerdict.ok` با `ALLOW` یا `ALLOW_REVIEW_ONLY`
6. confidence actionable
7. risk ≠ CRITICAL
8. STOP/PAUSE/REVOKE/EMERGENCY غیرفعال

پیش‌فرض بدون این‌ها همچنان `false` / `false` است.

```http
POST /api/ai/decision
{ "execute": true, "userConfirmed": true, "authorizationScreenShown": true,
  "guardianApproved": true, "policyId": "pol_…" }

POST /api/ai/decision/:id/confirm
{ "userConfirmed": true, "authorizationScreenShown": true,
  "guardianApproved": true, "policyOk": true }
```

Probe: `npm run test:execution-authority`

## تصمیم

فاز ۱۱ از نظر runtime path کامل است: Strategy → simulate → risk-adjusted best (provisional). Smart Money وارد تصمیم می‌شود. Authority فقط با gateهای بالا فعال می‌شود؛ return هیچ‌وقت guaranteed نیست.
