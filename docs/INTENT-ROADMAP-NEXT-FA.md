# وضعیت نقشهٔ راه Intent OS پس از نسخهٔ ۱.۳۵.۰

> این سند وضعیت **قابلیت پروتکل** را از **پیکربندی عملیاتی روی لایو** جدا می‌کند.
> وجود schema/endpoint به معنی وجود اپراتور مستقل، قرارداد deployشده، custody یا
> تسویهٔ خودکار نیست. مرجع runtime همیشه
> `GET /api/intents/v1/capabilities` است.

## جدول فازها

| فاز | خروجی | وضعیت کد در ۱.۳۵.۰ | شرط فعال‌سازی واقعی | حد صداقت |
|---|---|---|---|---|
| ۱ | Compiler محلی، Risk Engine، trace و receipt | انجام‌شده | بدون env ویژه | اجرای سرور/خرج خودکار ندارد |
| ۲a | Quote امضاشده + log غیرقابل‌جایگزینی + Merkle | انجام‌شده | `INTENT_SOLVER_KEYS` و Blob برای دوام | Merkle به‌تنهایی timestamp/کامل‌بودن نیست |
| ۲b | close امضاشده + anchor اختیاری close | انجام‌شده | Coordinator، close token و در صورت anchor قرارداد واقعی | close به‌تنهایی کامل‌بودن را ثابت نمی‌کند |
| ۲c | admission receipt + watcher completeness | انجام‌شده | کلید عمومی watcher واقعی | رجیستری استقلال سازمانی نمی‌سازد |
| ۳a | وثیقهٔ اعلامی، claim، dispute و adjudication | انجام‌شده | solver bond/verifier واقعی | custody و وصول جریمه خارج پروتکل است |
| ۳b | settlement report + re-grade مستقل | انجام‌شده | verifier واقعی | `onChainTxVerification:false` |
| ۴a | DAG تک‌زنجیره + batch با امضای کاربر | انجام‌شده | آدرس واقعی batch برای `contract.configured:true` | calldata برنامه‌ای است؛ output verify ندارد |
| **۴b** | **state machine میان‌زنجیره‌ای با امضای ترتیبی** | **انجام‌شده** | Blob برای دوام؛ کلیدهای دو طرف در هر state | **غیراتمیک، بدون escrow/custody؛ envelope هنوز draft-only** |
| **۴c** | **راستی‌آزمایی واقعی چند-RPC هر پا + account binding امضاشده + اثبات کیف پول EIP-191** | **انجام‌شده** | `INTENT_CROSS_CHAIN_RPC_NETWORKS` (quorum ≥۲، endpointهای HTTPS با hostname متفاوت در هر chain) + verifier ثبت‌شده + `binding-challenge` | **تأیید دو تراکنش جدا اتمیک نمی‌سازد؛ hostname متفاوت اثبات استقلال provider نیست؛ رسیدهای تاریخی بازنویسی نمی‌شوند؛ EIP-1271 unsupported** |
| ۵ | Outcome Marketplace + confidential transport | انجام‌شده | solver/bond/operator config واقعی | commit–reveal از FBT پنهان نیست؛ TEE ادعا نمی‌شود |
| **۶** | **operator attestation، rotation Coordinator، root anchor** | **انجام‌شده** | attestation واقعی همهٔ ناظران؛ rotation دوامضاشده؛ قرارداد root anchor deployشده | **استقلال سازمانی قابل‌اثبات با رجیستری نیست؛ anchor completeness/settlement نیست** |

## فاز ۴b — دقیقاً چه چیزی تمام شد؟

### استانداردها

- state: `fbt.cross-chain-state.v1`
- receipt: `fbt.cross-chain-leg-receipt.v1`
- mode: `sequential-user-signatures`

State منبع/مقصد (chain، token، amount)، initiator/counterparty، سه deadline و
مسیر refund را pin می‌کند. initiator رسید `source-transfer` را امضا می‌کند؛
counterparty پس از آن یکی از `destination-transfer` یا `refund` را امضا می‌کند.
هر رسید Ed25519، exact transfer، txHash و receipt قبلی را پوشش می‌دهد.

این یک **دفتر شواهد امضاشده** است. RPC receipt را بررسی نمی‌کند و هیچ انتقالی
را انجام یا اجبار نمی‌کند:

```json
{
  "atomic": false,
  "globalAtomicity": false,
  "custody": false,
  "escrow": false,
  "automaticSettlement": false,
  "onChainVerified": false
}
```

بنابراین Risk Engine و envelope همچنان:

```text
status: draft-only
code: ATOMIC_CROSS_CHAIN_UNAVAILABLE
unavailable.atomicCrossChainWorkflows: true
```

این رفتار bug نیست؛ مرز امنیتی تا زمان escrow/state machine آن‌چین حسابرسی‌شده
است. قرارداد escrow ساده نیز در ۱.۳۴.۰ اضافه نشده، پس ادعای timeout/refund
اجباری یا «اتمیک جهانی» وجود ندارد.

### API و CLI

```text
POST /api/intents/v1/cross-chain/states
GET  /api/intents/v1/cross-chain/states/:stateId
POST /api/intents/v1/cross-chain/states/:stateId/receipts

scripts/intent-cross-chain.mjs create|sign|verify-receipt|verify-state
```

`crossChain.configured` فقط با ذخیره‌سازی durable واقعی true است. بدون Blob،
قابلیت برای توسعه در حافظه کار می‌کند ولی `configured:false` و
`persistenceMode: process-memory-ephemeral` اعلام می‌شود.

## فاز ۴c — دقیقاً چه چیزی در ۱.۳۵.۰ اضافه شد؟

### استانداردها

- account binding: `fbt.cross-chain-account-binding.v1`
- گزارش راستی‌آزمایی: `fbt.cross-chain-tx-verification.v1`

در ۱.۳۴.۰، `txHash` داخل رسید فقط ادعای امضاشدهٔ طرف بود و
`onChainVerified:false` صحیح بود — و هنوز هم هست؛ رسید تاریخی هرگز تغییر
نمی‌کند. فاز ۴c یک **لایهٔ مشتق‌شدهٔ جدا** اضافه می‌کند:

1. **Binding امضاشدهٔ حساب + اثبات کیف پول EIP-191.** هر طرف آدرس آن‌چین خودش
   را با همان کلید Ed25519 که در state pin شده امضا می‌کند (`stateId`،
   `partyId`، `chainId`، آدرس، `partyPublicKey`، صدور/انقضا، `walletProof`).
   گذاشتن آدرس در body درخواست کافی نیست. دستور `binding-challenge` چالش عمومی
   و قطعی می‌سازد؛ کاربر آن را در کیف پول خودش با `personal_sign` امضا می‌کند
   و فقط امضای عمومی برمی‌گردد (کلید خصوصی کیف پول هرگز دریافت نمی‌شود).
   سرور با `ethers.verifyMessage` بازیابی می‌کند و آدرس باید دقیقاً یکی باشد.
   با اثبات واقعی: `walletSignatureScheme:"EIP-191"` و
   `walletSignatureVerified:true`. بدون اثبات، binding به‌صورت signed
   assertion ذخیره می‌شود (`walletSignatureScheme:null`) و هرگز برای
   `onchain-verified` کافی نیست. EIP-1271 صریحاً unsupported است و fallback
   ساختگی ندارد. claims همیشه: `addressControlSelfAttested:true`،
   `fundsAuthorityGranted:false` و `custody:false`.
2. **راستی‌آزمایی چند-RPC.** verifier ثبت‌شده هر پا را از quorum حداقل دو
   endpoint HTTPS با hostname متفاوت می‌خواند (per-network quorum، هرگز
   بیشتر از تعداد providerها). برای ERC-20: receipt موفق، رخداد `Transfer`
   دقیقاً از قرارداد token برنامه، و from/to/amount دقیق؛ رخداد مشابه از
   قرارداد دیگر، لاگ malformed و رخدادهای مبهم تکراری رد می‌شوند و
   fee-on-transfer/rebasing بدون policy صریح verified نمی‌شود. برای دارایی
   native: بررسی دقیق from/to/value تراکنش + receipt موفق. tx/block hash باید
   بین quorum توافق داشته باشد (`latestBlock - receiptBlock + 1`
   overflow-safe) و حداقل confirmation پیکربندی‌شده رعایت شود؛ هر transport
   زمان‌دار و با سقف اندازهٔ پاسخ و shape سخت‌گیرانه است.
3. **بازمحاسبهٔ سروری.** سرور پیش از ذخیره، کلید verifier را با registry چک
   می‌کند، bindingها را دوباره verify می‌کند، خودش زنجیره را از endpointهای
   خودش دوباره می‌خواند و verdict/quorum/فکت‌ها را بازمحاسبه می‌کند. گزارشی که
   دقیقاً بازتولید نشود با `VERIFICATION_NOT_RECOMPUTABLE` رد می‌شود.

### fail-closed

RPC disagreement، reorg (`REORG_DETECTED`: drift block-hash، تراکنش روی
blockهای متفاوت، یا اختلاف tx/receipt)، receipt ناموفق، پیدا نشدن tx،
confirmation ناکافی، قرارداد token/فرستنده/گیرنده/amount اشتباه، رخداد
اشتباه/malformed، binding منقضی یا با کلید اشتباه، wallet proof نامعتبر، و
فقط یک RPC زنده در برابر حد نصاب دو — همه رد می‌شوند. outage پاسخ
`verification-unavailable` می‌گیرد و هرگز به «verified» یا رد قطعی یا نتیجهٔ
خالی معتبر تبدیل نمی‌شود؛ snapshot موقت فقط با claims صادقانه ذخیره می‌شود.

### وضعیت مشتق‌شدهٔ هر پا

```text
signed-only → binding-required → wallet-proof-required → verification-pending
  ↘ confirmations-pending / rpc-disagreement / reorg-detected / verification-unavailable
  → verification-rejected / onchain-verified
```

اگر همهٔ پاهای ثبت‌شده verified شوند `allSubmittedLegsOnChainVerified:true`
می‌شود، اما حتی آن زمان `atomic`، `globalAtomicity`، `custody`، `escrow`،
`automaticSettlement` و `refundEnforcedByFbt` همگی false می‌مانند: تأیید دو
تراکنش جدا آن‌ها را اتمیک نمی‌کند و envelope با
`ATOMIC_CROSS_CHAIN_UNAVAILABLE` فقط پیش‌نویس می‌ماند.

### API و CLI

```text
POST     /api/intents/v1/cross-chain/states/:stateId/account-binding-challenge
POST/GET /api/intents/v1/cross-chain/states/:stateId/account-bindings
POST/GET /api/intents/v1/cross-chain/states/:stateId/verification-reports
POST/GET /api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports
GET      /api/intents/v1/cross-chain/states/:stateId   (اکنون با legVerification)

scripts/intent-cross-chain.mjs bind-account|verify-binding|verify-tx|sign-verification|verify-report
```

کلیدهای خصوصی (`INTENT_CROSS_CHAIN_PRIVATE_KEY`،
`INTENT_CROSS_CHAIN_VERIFIER_PRIVATE_KEY`) و RPCها
(`INTENT_CROSS_CHAIN_RPC_NETWORKS`) فقط در env محلی/سروری‌اند و هرگز چاپ یا
منتشر نمی‌شوند. capabilities فقط `multiRpcConfigured`، تعداد endpoint و
`distinctRpcHosts` را می‌گوید و همیشه `providerIndependenceProven:false` — دو
hostname متفاوت لوله‌کشی است، نه audit استقلال. RPC خصوصی «confidential» نامیده
نمی‌شود.

## فاز ۶ — دقیقاً چه چیزی تمام شد؟

### ۱. اپراتورهای ناظر/راستی‌آزما

هر کلید فعال watcher/verifier باید `fbt.operator-attestation.v1` معتبر، امضاشده
با همان کلید و منقضی‌نشده داشته باشد. status فاز ۶ فقط وقتی configured می‌شود که
همهٔ کلیدها bind شده و از کلید Coordinator/Solver جدا باشند.

اما این سه گزاره متفاوت‌اند:

1. امضا معتبر است → کنترل کلید ثابت است؛
2. attestation می‌گوید اپراتور مستقل است → self-attestation عمومی است؛
3. سازمان واقعاً مستقل است → فقط با اداره و audit بیرونی مشخص می‌شود.

به همین دلیل `organizationalIndependenceProven:false` همیشه درست است. اگر
`INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS` خالی/ناقص باشد،
`independentVerification.configured:false` می‌ماند؛ حتی اگر رجیستری watcher یا
verifier کلید داشته باشد.

**وضعیت لایو ۱.۳۵.۰:** برای دو کلید ثبت‌شدهٔ `watch01` و `verify-coop` هیچ
attestation واقعی امضاشده در environment موجود نیست، پس `configured:false`
عمداً حفظ شده است. FBT هرگز کلید جایگزین یا اپراتور ساختگی نمی‌سازد و private
key اپراتور را از هیچ‌کس نمی‌خواهد. `/api/intents/v1/operators` اکنون blocker
دقیق هر کلید را منتشر می‌کند:

```text
blocker: NO_CURRENT_SIGNED_OPERATOR_ATTESTATION
requiredSigner: صاحب واقعی همان کلید registry
offlineCommand:
  INTENT_OBSERVER_PRIVATE_KEY='…' node scripts/intent-operator.mjs attest <input.json>
thenSet: INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS (فقط سند عمومی امضاشده)
```

تا وقتی صاحب واقعی کلید این سند را در محیط امن خودش امضا نکرده و خروجی عمومی
آن در env قرار نگرفته، استقلال «انجام‌شده» اعلام نمی‌شود.

### ۲. چرخش Coordinator

استاندارد `fbt.coordinator-key-rotation.v1` از old و new signature هم‌زمان
استفاده می‌کند. فقط کلید active اسناد جدید را امضا می‌کند و keyring کلیدهای
بازنشسته را `signsNewDocuments:false` نشان می‌دهد. رسیدهای تاریخی registry را
برای verification لازم ندارند؛ کلید عمومی signer داخل سند امضاشده pin شده است.

بدون رکورد دوامضاشدهٔ واقعی در `INTENT_COORDINATOR_ROTATIONS`:
`coordinatorRotationConfigured:false`.

**وضعیت لایو ۱.۳۵.۰:** هیچ rotation واقعی برنامه‌ریزی نشده و هیچ رکورد
دوامضاشدهٔ old/new از مسیر امن موجود نیست، پس `configured:false` صادقانه حفظ
شده است. rotation نمایشی برای سبز کردن capability ساخته نمی‌شود. وقتی rotation
واقعی لازم شد، مراسم آفلاین `scripts/intent-coordinator.mjs`
(draft → sign-old → sign-new → verify) اجرا و فقط سند عمومی دوامضاشده در env
قرار می‌گیرد؛ کلید قدیمی فقط برای verification تاریخی می‌ماند.

### ۳. anchor اختیاری ریشهٔ Merkle

- manifest: `fbt.merkle-root-manifest.v1`
- claim: `fbt.merkle-root-anchor-claim.v1`
- contract: `contracts/IntentMerkleRootAnchor.sol`

سرور root را از entryها بازمحاسبه می‌کند، calldata عمومی می‌دهد و transaction
ارسال‌شده توسط هر publisher را از RPC بررسی می‌کند. فقط event دقیق قرارداد و
confirmation کافی، `externallyAnchored:true` می‌کند. هیچ anchor wallet یا private
key در FBT نیست.

بدون `INTENT_MERKLE_ANCHOR_NETWORKS` واقعی:

```text
merkleRootAnchors.configured: false
transparency.externalRootAnchorConfigured: false
log.externallyAnchored: false
```

Anchor فقط timestamp/set commitment است؛ `completenessProven:false`،
`executionProven:false`، `settlementProven:false` و `custody:false` باقی می‌ماند.

**وضعیت لایو ۱.۳۵.۰:** ابزار compile/deploy/verify اکنون کامل است
(Solidity دقیقاً 0.8.24):

```bash
node scripts/compile-merkle-anchor.mjs
DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://… CHAIN_ID=8453 \
  node scripts/deploy-merkle-anchor.mjs
RPC_URL=https://… CHAIN_ID=8453 \
  node scripts/deploy-merkle-anchor.mjs verify 0xDeployedAddress
```

اسکریپت deploy پس از استقرار، bytecode واقعی روی زنجیره را با artifact کامپایل
مقایسه و interface رخداد `MerkleRootAnchored` را با static call بررسی می‌کند.
اما deploy فقط جایی انجام می‌شود که deployer credential و RPC از قبل در
environment امن اپراتور موجود باشد؛ private key هرگز در چت، مخزن یا `VITE_*`
قرار نمی‌گیرد و FBT آن را از کاربر نمی‌خواهد. چون در environment فعلی چنین
credentialی موجود نیست، deployment انجام نشده و
`merkleRootAnchors.configured:false` / `externallyAnchored:false` صادقانه باقی
است. پس از deployment واقعی و تنظیم `INTENT_MERKLE_ANCHOR_NETWORKS`، اولین
root واقعی از مسیر `calldata → tx → POST /root-anchor` anchor می‌شود.

## چک فعال‌سازی لایو

> **راهنمای کامل هشت آیتم فاز ۶** (env، شکل JSON، مراسم آفلاین، curl، حد
> صداقت): [`docs/PHASE6-ACTIVATE-FA.md`](./PHASE6-ACTIVATE-FA.md).
> حلقهٔ اجرای ایجنت پس از کاتالوگ گواهی‌شده:
> [`docs/ECOSYSTEM-REGISTRY-FA.md`](./ECOSYSTEM-REGISTRY-FA.md) → مرحلهٔ ۵.

```bash
export FBT_URL=https://fbtswap.ir
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/bonds" | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/operators" | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/merkle-anchor-networks" | python3 -m json.tool
```

برای ادعای فعال‌بودن کامل فاز ۶ باید هم‌زمان این‌ها واقعاً برقرار باشند:

- `independentVerification.configured === true` و binding همهٔ کلیدها وجود دارد؛
- با وجود آن، `organizationalIndependenceProven === false` (مرز صادقانه)؛
- `auctions.coordinatorRotationConfigured === true` فقط پس از rotation واقعی؛
- `merkleRootAnchors.configured === true` فقط پس از deployment/RPC واقعی؛
- `workflows.contract.configured === true` فقط با آدرس mainnet واقعی
  (`INTENT_WORKFLOW_BATCH_ADDRESS`) — هرگز تست‌نت؛
- روی یک log مشخص، `externallyAnchored === true` فقط پس از tx تأییدشده.

اگر `operators.blockers` پر است، هر ردیف `offlineCommand` دقیق همان کلیدی را
می‌دهد که صاحبش باید امضا کند — سرور راه میان‌بر ندارد.

## چک فعال‌سازی فاز ۴c روی لایو

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['crossChainVerification'], indent=2))"
```

- بدون `INTENT_CROSS_CHAIN_RPC_NETWORKS`: `configured:false`،
  `configuredChains:0`، `onChainTxVerification:false` و همهٔ پاها
  `signed-only` می‌مانند — این صادقانه است، نه نقص.
- با env واقعی: `configured:true`، `configuredChains` و `distinctRpcHosts`
  منتشر می‌شود، اما هیچ URL برنمی‌گردد و `providerIndependenceProven:false`
  می‌ماند. `walletProof:"EIP-191"` و `eip1271Supported:false` همیشه منتشر
  می‌شوند.
- `crossChain.atomic`، `crossChain.custody` و `onChainTxVerification` (سطح
  schema رسید تاریخی) در هر حالتی false هستند.

## کارهای بعدی (خارج از ۱.۳۵.۰)

1. **انجام شد در ۱.۳۵.۰:** راستی‌آزمایی RPC چندمنبعی txHashهای cross-chain به
   عنوان لایهٔ مشتق‌شده؛ رسید تاریخی همچنان `onChainVerified:false`.
2. **انجام شد در ۱.۳۵.۰:** اثبات کیف پول EIP-191 با verify واقعی
   (`ethers.verifyMessage`) روی چالش قطعی؛ EIP-1271 همچنان unsupported.
3. escrow/state machine آن‌چین حسابرسی‌شده با custody و timeout/refund دقیق؛ تا
   آن زمان هیچ ادعای atomic cross-chain وجود ندارد.
4. audit عملیاتی اپراتورهای مستقل و انتشار گزارش بیرونی؛ schema این واقعیت را
   جایگزین نمی‌کند.
5. deployment واقعی `IntentMerkleRootAnchor` با credential امن اپراتور و سپس
   anchor یک root واقعی؛ قابلیت کد با پیکربندی لایو یکی نیست.
6. اجرای واقعی مراسم rotation فقط وقتی واقعاً برنامه‌ریزی شده باشد.
