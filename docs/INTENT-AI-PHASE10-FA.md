# FBT Intent AI — فاز ۱۰: Marketplace و Trust برای External Agent

تاریخ: ۲۰۲۶-۰۸-۲۶
مرجع: specification رسمی و authoritative محصول **FBT INTENT AI — NEXT-GENERATION AUTONOMOUS FINANCIAL AGENT OS**
شاخهٔ این تغییر: `arena/01a03e13-fbtcryp`

## نتیجهٔ کوتاه

فاز ۱۰ به‌صورت **قرارداد قابل‌اجرا و fail-closed** پیاده شده است، اما **فعال‌سازی عملیاتی live نیست**. در این فاز، مسیر زیر source واقعی دارد:

```text
discovery → passport → independent verification → sandbox
  → non-executable handshake → observed reputation/rating
  → scoped authorization → revoke/expiry
```

پیاده‌سازی کد و probe موجود است؛ با این حال نبود registry تأییدشده، Certificate Authority، sandbox operator، provider/session-key backend و External Agent runtime باعث می‌شود وضعیت این فاز فقط این باشد:

```text
implementation: implemented
configuration: partial
operational: unavailable / not activated
```

هیچ ادعایی دربارهٔ اتصال live به External Agent، صدور certificate واقعی یا اجرای مالی بیرونی در این سند وجود ندارد.

## مرز محصول: دقیقاً سه mode

Phase 10 mode جدیدی اضافه نمی‌کند. سه mode رسمی همچنان دقیقاً این‌ها هستند:

1. `HUMAN ↔ AI`
2. `AI ↔ AI INSIDE FBT`
3. `FBT AI ↔ EXTERNAL AI AGENT`

`ANALYSIS`، `PREPARATION` و `EXECUTION` مرحله/permission هستند، نه mode چهارم. Discovery، handshake، rating، strategy، research یا preparation هرگز authorization اجرای مالی نیستند. اجرای مالی فقط بعد از authorization screen و تأیید صریح کاربر، Guardian و تمام limitهای policy ممکن است.

## implementation واقعی

### ۱) Trust plane و Passport

فایل: `src/lib/intent-ai/externalAgentTrust.js`

قراردادهای versioned زیر اضافه شده‌اند:

- `fbt.external-agent-trust.v1`
- `fbt.external-agent-passport.v1`
- `fbt.external-agent-discovery.v1`
- `fbt.external-agent-security.v1`
- `fbt.external-agent-sandbox.v1`
- `fbt.external-agent-handshake.v1`
- `fbt.external-agent-reputation.v1`
- `fbt.external-agent-rating.v1`
- `fbt.external-agent-scope.v1`

`sanitizeExternalAgentPassport` فقط فیلدهای عمومی و محدود را وارد قرارداد می‌کند:

- identity، creator و capabilities؛
- chain، asset، protocol و financial function؛
- feeهای network، protocol، bridge، external، performance و execution در صورت ارائه؛
- verification، evidence و expiry؛
- reputation فقط به‌شکل aggregate و observed؛
- sandbox stage/evidence؛
- transaction/capital limit و required permissions.

`securityStatus: "verified"` که از خود Agent یا payload کاربر بیاید trusted محسوب نمی‌شود. `passportFromCatalog` فقط برای rowی استفاده می‌شود که از trusted server registry آمده باشد و verification آن با certificate active از مسیر server-derived به دست آمده باشد. حتی روش `reviewer_certified` بدون evidence link خودِ catalog، بدون trusted registry معتبر نیست.

کلیدها و مقادیر secret-shaped، از جمله seed phrase، mnemonic، private key، master password، raw secret، credential و signer خارج از قرارداد رد می‌شوند و هرگز در passport ذخیره نمی‌شوند.

### ۲) Discovery و compatibility

`discoverExternalAgents`:

- فقط sourceی را که واقعاً به آن داده شده گزارش می‌کند؛ source `unavailable` به `live` تبدیل نمی‌شود؛
- candidate ناسازگار یا unverified را می‌تواند برای نمایش برگرداند، اما `eligibleForAnalysis` و `eligibleForExecution` را سبز نمی‌کند؛
- chain، asset، protocol و capability را با match صریح می‌سنجد؛ نبود declaration، wildcard امن نیست؛
- `selectedAgentId` را خودکار پر نمی‌کند؛ `userChoiceRequired: true` و `automaticEnable: false` است؛
- `eligibleForExecution` همیشه در discovery false است؛
- reputation کم‌نمونه را score نمی‌کند و مقدار score را `null` نگه می‌دارد.

### ۳) Security و sandbox

`evaluateExternalAgentSecurity` برای execution همهٔ این موارد را fail-closed می‌کند:

- passport و verification معتبر و منقضی‌نشده؛
- security claimهای بدون custody، بدون unrestricted signer و بدون raw credential؛
- chain، asset، protocol و capability سازگار؛
- amount و capital معلوم و داخل limit Agent؛
- sandbox در `production`، با همهٔ stageهای کامل، evidence برای هر stage، و `operatorApproved`؛
- presence همهٔ هفت permission؛
- user authorization و Guardian approval.

`createExternalAgentSandbox` از `discovery` شروع می‌شود. `advanceExternalAgentSandbox` stage را فقط یک گام جلو می‌برد و بدون evidence یا با skip کردن stage رد می‌شود. مرحلهٔ production operator approval می‌خواهد و حتی پس از آن `executionAllowed` خودکار true نمی‌شود.

### ۴) Handshake، social message و rating

`createExternalAgentHandshake` و `externalAgentHandshakeTurn` فقط برای greeting، evidence، acknowledgement، disagreement، recalculate و goodbye هستند. transcript با `isExecutable: false` برمی‌گردد. command-like، secret-like و محتوای credential رد می‌شود؛ handshake به‌تنهایی نه signing دارد، نه transfer و نه execution.

`buildExternalAgentReputation` فقط از observed session evidence aggregate می‌سازد:

- کمتر از پنج sample تصمیم‌پذیر: `insufficient_data`، بدون sample count/rate قابل انتشار و بدون score؛
- sample کافی: `observed` با success rate، confidence و categoryهای محدود؛
- cancellation در denominator موفقیت قرار نمی‌گیرد؛
- address، wallet، tx hash و user id وارد reputation public نمی‌شود.

`createBidirectionalAgentRating` فقط پس از session کامل، همهٔ categoryهای محدود و evidence عمومی را قبول می‌کند. rating مشاهده/ممیزی است و `trustChanged`، `executionPermissionChanged` و authorization را تغییر نمی‌دهد.

### ۵) Scoped authorization و revoke

`authorizeExternalAgentScope` به‌جای secret، فقط handleهای bounded صادر می‌کند:

- Smart Wallet boundary؛
- capability token؛
- session key؛
- policy id؛
- chain و protocol scope غیرخالی و intersect‌شده با passport؛
- capability scope؛
- max transaction amount؛
- expiration محدود به کمترین expiry از requested TTL، passport و policy؛
- user authorization و Guardian approval.

`capabilityToken.js` و `sessionKeys.js` در این مسیر با API واقعی زیر استفاده می‌شوند:

- `issueCapabilityToken`
- `scopeCapabilityToken`
- `revokeCapabilityToken`
- `issueSessionKey`
- `scopeFor`
- `revokeSessionKey`

policy scope در صورت ارائه، Capital، Transaction، Risk، Fee، Time و Slippage را نیز unknown/over-limit رها نمی‌کند. chain و protocol خالی مجوز نمی‌گیرند. `revokeExternalAgentScope` هر دو handle را revoke می‌کند و expiry هم در هر scope check دوباره بررسی می‌شود. هیچ personality، sticker، social message، rating یا council vote نمی‌تواند Guardian، policy یا limit را bypass کند.

## Server و client integration

### Server

در `server/app.js` route خواندنی زیر اضافه شده است:

```http
GET /api/intents/v1/external-agents
```

این route فقط از `catalogList('agent')` می‌خواند. listing باید از approved ecosystem catalog بیاید؛ route هیچ token، session key، signer یا execution permission صادر نمی‌کند. چون registry تاریخی فعلاً listing حداقلی نگه می‌دارد، پاسخ candidateها را صریحاً `passportComplete: false` و `eligibleForExecution: false` نگه می‌دارد.

در `server/intents.js` نیز `externalAgentTrust`، `externalAgentDiscovery` و endpoint در capability metadata ثبت شده‌اند.

### Client و UI

- `src/lib/intentNetwork.js`: تابع read-only `getExternalAgents` با cache کوتاه؛
- `src/components/IntentAIPanel.jsx`: discovery هم‌زمان با activation/capability metadata خوانده می‌شود؛ mode خارجی source catalog را به session می‌دهد؛ data status، trust، compatibility و withheld score نمایش داده می‌شود؛
- `src/lib/intent-ai/humanAi.js`: start و هر chat turn discovery را refresh می‌کنند؛ External candidate فقط در صورت discovery معتبر وارد boundary می‌شود؛ discovery یا analysis execution authorization نمی‌سازد؛
- `src/lib/intent-ai/index.js`: schemaها و APIهای Trust plane export شده‌اند؛
- `src/i18n/locales/en.json` و `src/i18n/locales/fa.json`: متن‌های External Agent، compatibility، unavailable و score withheld اضافه شده‌اند.

## Test و probe

فایل رسمی:

```text
test/intent-ai/phase10-agent-trust-probe.mjs
```

اجرای مستقیم:

```bash
npm run test:phase10
```

این probe در `test/run.mjs` نیز اجرا می‌شود و **۴۹ assertion** را پوشش می‌دهد، از جمله:

- schema و sanitization؛
- رد self-reported verification؛
- رد raw private key؛
- trusted catalog conversion؛
- discovery source/status، compatibility و optional user choice؛
- unavailable status؛
- integration با `humanAi` در mode خارجی؛
- security analysis در برابر execution؛
- sandbox evidence، ترتیب stage و operator approval؛
- handshake اجتماعی و non-executable؛
- reputation thin-sample و observed-sample؛
- rating پس از completion؛
- user/Guardian authorization؛
- chain/protocol scope غیرخالی؛
- fee unknown fail-closed؛
- opaque capability/session handles؛
- chain/protocol/amount scope؛
- expiry و revoke؛
- HTTP route واقعی و عدم خروج token/session key.

`package.json` اسکریپت `test:phase10` دارد. نتیجهٔ آخرین اجرای probe در این تغییر: **۴۹/۴۹ موفق**.

## وضعیت configuration و operational activation

| لایه | وضعیت | توضیح |
|---|---|---|
| Source contracts | implemented | Passport، discovery، security، sandbox، handshake، reputation، rating و scope در source وجود دارد. |
| Server route | implemented / honest | route read-only است و status registry را همان‌طور که هست برمی‌گرداند. |
| Existing ecosystem catalog | configured only where durable store/certifier exist | draft/self-reported listing verified نیست؛ publish به certification فعال و evidence نیاز دارد. |
| External certificate authority | **not configured** | هیچ CA یا attestation واقعی در این تغییر متصل نشده است. |
| External sandbox runtime/operator | **not configured** | stageها contract و probe هستند، نه اجرای sandbox بیرونی. |
| Reputation feed | **not configured** | sampleهای probe synthetic و local هستند و reputation live محسوب نمی‌شوند. |
| Smart Wallet/session-key provider | **not operationally activated** | APIهای bounded local contract استفاده شده‌اند؛ provider/KMS/runtime signer production متصل نیست. |
| External Agent transport/handshake | **not configured** | handshake فقط local structured social transcript است. |
| Financial execution | **not activated** | scope output execution permission نهایی نیست؛ user authorization screen، Guardian و adapter واقعی جدا لازم‌اند. |
| Live external service evidence | **none** | نبود پاسخ معتبر بیرونی موفقیت یا live بودن محسوب نشده است. |

بنابراین response پیش‌فرض route، در محیطی که durable approved registry موجود نیست، به‌صورت `dataStatus: "unavailable"` است. این مقدار failure نیست که باید با UI به «هیچ Agentی وجود ندارد» تبدیل شود و success/live هم نیست.

## قواعد ایمنی که این فاز حفظ می‌کند

- External Agent هرگز seed phrase، private key، master password یا raw credential دریافت نمی‌کند؛
- analysis، research، marketplace discovery، preparation و handshake execution authorization نیستند؛
- هیچ اجرای مالی بدون authorization screen و تأیید روشن کاربر شروع نمی‌شود؛
- score بدون evidence کافی `null` است و return تضمین نمی‌شود؛
- feeهای شناخته‌شده باید قبل از scope معلوم باشند و fee unknown می‌تواند scope را block کند؛
- STOP، PAUSE، REVOKE، DISCONNECT و EMERGENCY EXIT در execution boundary برقرار می‌مانند؛
- نبود provider، credential، operator، certificate، قرارداد یا runtime evidence هرگز به `verified`، `ready` یا `live` تبدیل نمی‌شود؛
- Phaseهای ۱۱ تا ۲۰ اکنون source، export، probe و مستندات مستقل دارند؛ اما به‌دلیل نبود provider/runtime/evidence واقعی، operationally unavailable هستند و live/complete اعلام نمی‌شوند.
