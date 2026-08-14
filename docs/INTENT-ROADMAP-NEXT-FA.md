# وضعیت نقشهٔ راه Intent OS پس از نسخهٔ ۱.۳۴.۰

> این سند وضعیت **قابلیت پروتکل** را از **پیکربندی عملیاتی روی لایو** جدا می‌کند.
> وجود schema/endpoint به معنی وجود اپراتور مستقل، قرارداد deployشده، custody یا
> تسویهٔ خودکار نیست. مرجع runtime همیشه
> `GET /api/intents/v1/capabilities` است.

## جدول فازها

| فاز | خروجی | وضعیت کد در ۱.۳۴.۰ | شرط فعال‌سازی واقعی | حد صداقت |
|---|---|---|---|---|
| ۱ | Compiler محلی، Risk Engine، trace و receipt | انجام‌شده | بدون env ویژه | اجرای سرور/خرج خودکار ندارد |
| ۲a | Quote امضاشده + log غیرقابل‌جایگزینی + Merkle | انجام‌شده | `INTENT_SOLVER_KEYS` و Blob برای دوام | Merkle به‌تنهایی timestamp/کامل‌بودن نیست |
| ۲b | close امضاشده + anchor اختیاری close | انجام‌شده | Coordinator، close token و در صورت anchor قرارداد واقعی | close به‌تنهایی کامل‌بودن را ثابت نمی‌کند |
| ۲c | admission receipt + watcher completeness | انجام‌شده | کلید عمومی watcher واقعی | رجیستری استقلال سازمانی نمی‌سازد |
| ۳a | وثیقهٔ اعلامی، claim، dispute و adjudication | انجام‌شده | solver bond/verifier واقعی | custody و وصول جریمه خارج پروتکل است |
| ۳b | settlement report + re-grade مستقل | انجام‌شده | verifier واقعی | `onChainTxVerification:false` |
| ۴a | DAG تک‌زنجیره + batch با امضای کاربر | انجام‌شده | آدرس واقعی batch برای `contract.configured:true` | calldata برنامه‌ای است؛ output verify ندارد |
| **۴b** | **state machine میان‌زنجیره‌ای با امضای ترتیبی** | **انجام‌شده** | Blob برای دوام؛ کلیدهای دو طرف در هر state | **غیراتمیک، بدون escrow/custody؛ envelope هنوز draft-only** |
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

### ۲. چرخش Coordinator

استاندارد `fbt.coordinator-key-rotation.v1` از old و new signature هم‌زمان
استفاده می‌کند. فقط کلید active اسناد جدید را امضا می‌کند و keyring کلیدهای
بازنشسته را `signsNewDocuments:false` نشان می‌دهد. رسیدهای تاریخی registry را
برای verification لازم ندارند؛ کلید عمومی signer داخل سند امضاشده pin شده است.

بدون رکورد دوامضاشدهٔ واقعی در `INTENT_COORDINATOR_ROTATIONS`:
`coordinatorRotationConfigured:false`.

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

## چک فعال‌سازی لایو

```bash
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
- روی یک log مشخص، `externallyAnchored === true` فقط پس از tx تأییدشده.

## کارهای بعدی (خارج از ۱.۳۴.۰)

1. راستی‌آزمایی RPC چندمنبعی txHashهای cross-chain؛ تا آن زمان
   `onChainVerified:false`.
2. escrow/state machine آن‌چین حسابرسی‌شده با custody و timeout/refund دقیق؛ تا
   آن زمان هیچ ادعای atomic cross-chain وجود ندارد.
3. audit عملیاتی اپراتورهای مستقل و انتشار گزارش بیرونی؛ schema این واقعیت را
   جایگزین نمی‌کند.
4. deployment اختیاری `IntentMerkleRootAnchor` و تنظیم env عمومی/RPC در صورت
   تصمیم اپراتور؛ قابلیت کد با پیکربندی لایو یکی نیست.
