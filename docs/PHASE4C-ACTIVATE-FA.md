# فعال‌سازی فاز ۴ث (Phase 4c) — راستی‌آزمایی واقعی چند-RPC تراکنش‌های میان‌زنجیره‌ای

نسخهٔ هدف: **۱.۳۵.۰** — این سند راهنمای کامل فعال‌سازی فاز ۴ث است.

> **خط قرمز اول:** فاز ۴ث ادعای اتمیک بودن نمی‌کند. رسید
> `fbt.cross-chain-leg-receipt.v1` برای همیشه یک *ادعای امضاشدهٔ طرف* است
> (`onChainVerified:false`) و راستی‌آزمایی آن‌چین فقط در لایهٔ مشتق‌شدهٔ
> `fbt.cross-chain-tx-verification.v1` انجام می‌شود. تأیید دو تراکنش جدا آن‌ها را
> اتمیک نمی‌کند؛ `atomic`، `globalAtomicity`، `custody`، `escrow`،
> `automaticSettlement` و `refundEnforcedByFbt` همیشه `false` می‌مانند و envelope
> بیرونی همچنان `draft-only` با `ATOMIC_CROSS_CHAIN_UNAVAILABLE` است.

---

## ۱. اسکيماها

| اسکيما | نقش | امضا |
|---|---|---|
| `fbt.cross-chain-state.v1` | برنامهٔ غیرقابل‌تغییر منبع/مقصد/بازپرداخت (فاز ۴ب) | بدون تغییر از ۱.۳۴.۰ |
| `fbt.cross-chain-leg-receipt.v1` | ادعای امضاشدهٔ هر پا توسط طرف (فاز ۴ب) | Ed25519 طرف |
| `fbt.cross-chain-account-binding.v1` | اتصال هویت Ed25519 طرف به آدرس EVM + اثبات کیف پول EIP-191 | Ed25519 همان طرف pinشده در state |
| `fbt.cross-chain-tx-verification.v1` | گزارش راستی‌آزمایی یک پا توسط verifier ثبت‌شده | Ed25519 verifier |

Backward compatibility: state و receiptهای ۱.۳۴.۰ دست‌نخورده و byte-identical باقی
می‌مانند؛ رکوردهای قدیمی binding/report (قبل از این بازبینی) هنگام خواندن
normalize و با همان قواعد قبلی خودشان بازراستی‌آزمایی می‌شوند.

### فیلدهای binding (`fbt.cross-chain-account-binding.v1`)

`schema`, `bindingId`, `stateId`, `partyId`, `chainId`, `address`,
`partyPublicKey`, `issuedAt`, `expiresAt`, `walletProof`, `claims`,
`signature`.

- `partyPublicKey` باید دقیقاً کلید Ed25519 همان party در state باشد
  (base64url canonical، دقیقاً ۳۲ بایت).
- unknown field → fail-closed (`UNKNOWN_ACCOUNT_BINDING_FIELD`).
- همهٔ رشته‌ها/زمان‌ها/آرایه‌ها bounded هستند؛ صدور بیش از
  clock-skew مجاز در آینده رد می‌شود.

### فیلدهای گزارش (`fbt.cross-chain-tx-verification.v1`)

`schema`, `verificationId`, `stateId`, `receiptId`, `leg`, `txHash`, `chainId`,
`token`, `amount`, `fromBindingId`, `toBindingId`, `fromAddress`, `toAddress`,
`blockNumber`, `blockHash`, `receiptStatus`, `confirmations`, `minConfirmations`,
`observations`, `quorum`, `verdict`, `reasonCodes`, `evaluatedAt`, `verifier`,
`claims`, `signature`.

---

## ۲. Binding و اثبات کیف پول EIP-191

### چالش قطعی (بدون private key)

کلید خصوصی کیف پول **هرگز** دریافت نمی‌شود. CLI فقط چالش عمومی می‌سازد؛ کاربر
آن را در کیف پول خودش با `personal_sign` (EIP-191) امضا می‌کند و **امضای عمومی**
را برمی‌گرداند:

```bash
node scripts/intent-cross-chain.mjs binding-challenge state.json \
  --party <partyId> --chain <chainId> --address <0x...> \
  --expires-at <epochSeconds> [--issued-at <epochSeconds>] [--nonce <challengeId>]
```

پیام چالش همهٔ این‌ها را bind می‌کند: domain
(`fbt.cross-chain-account-binding.v1/wallet-challenge`)، schema، `stateId`،
`partyId`، `chainId`، آدرس، کلید عمومی Ed25519، `issuedAt`، `expiresAt` و
`nonce/challengeId`. سرور با `ethers.verifyMessage` امضا را بازیابی می‌کند و
آدرس بازیابی‌شده باید دقیقاً با `address` داخل binding یکی باشد.

### ساخت binding امضاشدهٔ Ed25519

```bash
INTENT_CROSS_CHAIN_PRIVATE_KEY=... node scripts/intent-cross-chain.mjs bind-account state.json \
  --party <partyId> --chain <chainId> --address <0x...> --expires-at <s> \
  --wallet-signature <0x...> --nonce <challengeId> --issued-at <s>
```

claims پس از verify واقعی EIP-191:

```json
{
  "addressControlSelfAttested": true,
  "walletSignatureScheme": "EIP-191",
  "walletSignatureVerified": true,
  "fundsAuthorityGranted": false,
  "custody": false
}
```

بدون `--wallet-signature` binding به‌صورت signed assertion ذخیره می‌شود:

```json
{
  "addressControlSelfAttested": true,
  "walletSignatureScheme": null,
  "walletSignatureVerified": false,
  "fundsAuthorityGranted": false,
  "custody": false
}
```

چنین bindingای معتبر و قابل ذخیره است اما **هرگز برای `onchain-verified` کافی
نیست**؛ وضعیت پا `wallet-proof-required` می‌ماند.

**EIP-1271 (کیف پول قرارداد هوشمند) صریحاً unsupported است**
(`WALLET_PROOF_SCHEME_UNSUPPORTED`) و هیچ fallback ساختگی وجود ندارد؛ در
capabilities نیز `eip1271Supported:false` اعلام می‌شود.

### راستی‌آزمایی آفلاین

```bash
node scripts/intent-cross-chain.mjs verify-binding state.json binding.json
```

---

## ۳. پیکربندی چند-RPC (فقط سرور)

متغیر **server-only** — هرگز در `VITE_*`، API عمومی، log یا UI:

```json
[
  {
    "chainId": 8453,
    "quorum": 2,
    "minConfirmations": 12,
    "providers": [
      { "id": "base-provider-a", "rpcUrl": "https://..." },
      { "id": "base-provider-b", "rpcUrl": "https://..." }
    ]
  }
]
```

قواعد سخت‌گیرانه:

- فقط `https://`؛ URL دارای username/password رد می‌شود.
- برای configured شدن هر chain حداقل **دو endpoint با hostname متفاوت** لازم است.
- `quorum` حداقل ۲ و هرگز بیشتر از تعداد providerها؛ خلاف آن کل chain رد می‌شود.
- تعداد providerها bounded (حداکثر ۸)؛ provider id و URL sanitize و bounded.
- هر RPC timeout محدود دارد و response از نظر اندازه (حداکثر 512KiB) و shape
  (strict) محدود است؛ پاسخ خام و نامحدود هرگز ذخیره نمی‌شود.
- RPC خصوصی هیچ‌جا «confidential» نامیده نمی‌شود.

**hostname متفاوت اثبات استقلال provider نیست.** capabilities همیشه می‌گوید:

```json
{
  "multiRpcConfigured": true,
  "distinctRpcHosts": 2,
  "providerIndependenceProven": false
}
```

اگر env خالی یا ناقص باشد: `configured:false`، `multiRpcConfigured:false`،
`configuredChains:0`، `onChainTxVerification:false`،
`providerIndependenceProven:false`.

سقف هزینهٔ RPC جداگانه است: `INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT`
(پیش‌فرض ۱۰ ارسال گزارش در دقیقه به‌ازای هر فراخواننده — هر ارسال ۳ تماس RPC
به‌ازای هر provider، دو بار).

### تست محلی بدون RPC عمومی

تست‌ها هرگز به RPC عمومی وابسته نیستند؛ RPC در تست mock می‌شود
(`test/units.mjs` — بخش Phase 4c).

```bash
npm test
```

---

## ۴. راستی‌آزمایی هر پا — verdict و fail-closed

برای هر RPC خوانده می‌شود: `eth_getTransactionByHash`،
`eth_getTransactionReceipt`، `eth_blockNumber` (و در صورت نیاز
`eth_getBlockByHash`). quorum باید روی tx hash، block number، block hash،
receipt status، `from`/`to` و توکن/مقدار توافق کند.

- **ERC-20:** receipt موفق + رخداد `Transfer(address,address,uint256)` دقیقاً از
  قرارداد token برنامه + log address دقیق + from/to/amount دقیق. رخداد مشابه از
  قرارداد دیگر پذیرفته نمی‌شود؛ چند رخداد مبهم به‌عنوان موفقیت حدس زده نمی‌شود
  (`AMBIGUOUS_TRANSFER_EVENT`)؛ fee-on-transfer/rebasing بدون policy صریح هرگز
  verified نمی‌شود (به‌صورت `WRONG_AMOUNT` رد می‌شود).
- **Native:** `from`/`to`/`value` دقیق تراکنش + receipt موفق + توافق block hash.
- **confirmations:** `latestBlock - receiptBlock + 1` (overflow-safe)؛ کمتر از
  `minConfirmations` → `confirmations-pending`، نه verified.
- **reorg:** block hash عوض‌شده، تراکنش روی blockهای متفاوت، یا اختلاف
  tx/receipt در یک endpoint → `reorg-detected` و fail-closed.
- **disagreement:** اختلاف بقیهٔ فکت‌ها → `rpc-disagreement`، هرگز verified.
- **outage:** `verification-unavailable` — هرگز به verified یا رد قطعی تبدیل
  نمی‌شود.

نقش‌های هر پا (هیچ‌کدام از body درخواست قابل اعتماد نیستند؛ همه از state
immutable مشتق می‌شوند):

| leg | sender | recipient | chain/token/amount |
|---|---|---|---|
| `source-transfer` | initiator | counterparty | `state.source` |
| `destination-transfer` | counterparty | initiator | `state.destination` |
| `refund` | counterparty | initiator | `state.refund` |

### وضعیت هر پا

`signed-only` → `binding-required` → `wallet-proof-required` →
`verification-pending` → `confirmations-pending` / `rpc-disagreement` /
`reorg-detected` / `verification-unavailable` → `verification-rejected` /
`onchain-verified` (دو وضعیت آخر terminal).

اگر همهٔ receiptهای ثبت‌شده واقعاً verified باشند
`allSubmittedLegsOnChainVerified:true` می‌شود — اما حتی آن زمان همهٔ پرچم‌های
اتمیک/نگهداری false می‌مانند.

---

## ۵. گزارش verifier و recompute سرور

```bash
INTENT_VERIFIER_PRIVATE_KEY=... INTENT_CROSS_CHAIN_RPC_NETWORKS=... \
  node scripts/intent-cross-chain.mjs sign-verification state.json \
  --receipt receipt.json --from-binding fb.json --to-binding tb.json \
  --verifier-id <id> [--prior prior-receipt.json]
```

- سرور پیش از هر RPC پرهزینه ساختار bounded گزارش، عضویت و active بودن verifier
  در `INTENT_VERIFIER_KEYS`، تطابق کلید عمومی با registry و امضای Ed25519 را
  چک می‌کند و گزارش باید به state/receipt/binding واقعی متصل باشد.
- سپس سرور خودش state و receipt و bindingها و wallet proofها را دوباره verify
  می‌کند، RPCها را از endpointهای خودش دوباره می‌خواند، quorum و فکت‌ها و
  verdict/reasonCodes/confirmations/observations را بازمحاسبه می‌کند.
  گزارش non-recomputable رد می‌شود (`VERIFICATION_NOT_RECOMPUTABLE`).
- صرف امضای verifier برای ذخیره کافی نیست. رکورد ذخیره‌شده
  `serverRecomputedBeforeStorage:true` را به‌عنوان attestation سرور حمل می‌کند.

claims گزارش verified:

```json
{
  "serverRecomputedBeforeStorage": false,
  "multiRpcQuorumReached": true,
  "walletBindingsVerified": true,
  "transactionObservedOnChain": true,
  "atomicSettlement": false,
  "globalAtomicity": false,
  "custody": false,
  "escrow": false,
  "automaticSettlement": false,
  "providerIndependenceProven": false
}
```

(`serverRecomputedBeforeStorage` در claims امضاشدهٔ verifier همیشه false است —
verifier نمی‌تواند رفتار سرور را پیش‌بینی کند؛ رکورد ذخیره‌شده این واقعیت را
در سطح record و با `serverRecomputedBeforeStorage:true` attest می‌کند.)

در گزارش‌های pending/disagreement claims صادقانه‌اند:
`multiRpcQuorumReached:false`، `transactionObservedOnChain:false` و بقیهٔ
پرچم‌های اتمیک/نگهداری false. snapshot موقت فقط وقتی ذخیره می‌شود که سرور هنوز
نتیجهٔ نهایی نداشته باشد؛ با ظهور نتیجهٔ نهایی `VERIFICATION_SUPERSEDED` داده
می‌شود.

راستی‌آزمایی آفلاین گزارش:

```bash
node scripts/intent-cross-chain.mjs verify-report state.json \
  --report report.json --receipt receipt.json \
  --from-binding fb.json --to-binding tb.json \
  [--verifier-public-key <base64url>]
```

### استقلال verifier (صادقانه)

- `registryProvesOrganizationalIndependence:false`
- `organizationalIndependenceProven:false`
- اگر `fbt.operator-attestation.v1` معتبر وجود داشته باشد فقط
  `operatorAttestationVerified:true` قابل گفتن است؛ استقلال سازمانی همچنان
  false می‌ماند مگر audit بیرونی واقعی وجود داشته باشد.

---

## ۶. ذخیره‌سازی و public state

- bindingها و گزارش‌ها immutable و bounded؛ replay byte-identical idempotent؛
  drift روی همان binding/report ID conflict می‌شود؛ overwrite ممنوع.
- برای هر receipt حداکثر ۳ گزارش (`VERIFICATION_REPORT_LIMIT`).
- Blob outage fail-closed است: نه write ساختگی، نه empty معتبر
  (`CROSS_CHAIN_STORE_UNAVAILABLE` / `CROSS_CHAIN_WRITE_FAILED`).
- public read همهٔ گزارش‌ها را دوباره با کلید embedded verifier
  cryptographically verify می‌کند؛ چرخش registry گزارش تاریخی معتبر را حذف
  نمی‌کند (گزارش تاریخی با کلید تعبیه‌شده verify می‌شود).
- state و receipt تاریخی هرگز بازنویسی نمی‌شوند.

---

## ۷. API

```
POST /api/intents/v1/cross-chain/states/:stateId/account-binding-challenge
POST /api/intents/v1/cross-chain/states/:stateId/account-bindings
GET  /api/intents/v1/cross-chain/states/:stateId/account-bindings
POST /api/intents/v1/cross-chain/states/:stateId/verification-reports
GET  /api/intents/v1/cross-chain/states/:stateId/verification-reports
POST /api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports
GET  /api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports
```

- binding با Ed25519 همان party احراز می‌شود؛ گزارش با Ed25519 verifier.
- signature و registry **قبل از** RPC بررسی می‌شوند.
- rate limit مخصوص RPC (`INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT`).
- RPC URL هیچ‌جا عمومی نمی‌شود؛ خطاهای upstream sanitize می‌شوند؛ هیچ stack
  trace یا credential نشت نمی‌کند؛ body size و CORS مثل قبل.

---

## ۸. Capabilities و تست آن

بلوک `crossChainVerification` در `GET /api/intents/v1/capabilities`:

```json
{
  "available": true,
  "configured": false,
  "bindingSchema": "fbt.cross-chain-account-binding.v1",
  "verificationSchema": "fbt.cross-chain-tx-verification.v1",
  "walletProof": "EIP-191",
  "eip1271Supported": false,
  "multiRpcRequired": true,
  "minimumQuorum": 2,
  "configuredChains": 0,
  "providerIndependenceProven": false,
  "serverRecomputesBeforeStorage": true,
  "onChainTxVerification": false,
  "atomic": false,
  "custody": false
}
```

بدون env واقعی: `configured:false`، `configuredChains:0`،
`onChainTxVerification:false`. Configured بودن یک chain یعنی فقط RPC پیکربندی
شده، نه verified بودن receiptها — وضعیت verification همیشه per-receipt است.

تست زنده:

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities"
curl -s "$FBT_URL/api/intents/v1/cross-chain/states/:stateId/account-bindings"
curl -s "$FBT_URL/api/intents/v1/cross-chain/states/:stateId/verification-reports"
```

UI (fa/en) صریح نشان می‌دهد: رسید امضاشده ≠ راستی‌آزمایی آن‌چین؛ multi-RPC
استفاده می‌شود؛ استقلال provider اثبات نشده؛ راستی‌آزمایی تراکنش atomicity
نمی‌سازد؛ بدون config واقعی قابلیت unconfigured است.

---

## ۹. تنظیم Vercel

فقط server-side (هرگز `VITE_*`):

```
INTENT_CROSS_CHAIN_RPC_NETWORKS          (JSON دقیق بخش ۳)
INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT=10
```

متغیرهای CLI-only که **هرگز** در Vercel قرار نمی‌گیرند:

```
INTENT_CROSS_CHAIN_PRIVATE_KEY
INTENT_VERIFIER_PRIVATE_KEY
INTENT_OBSERVER_PRIVATE_KEY
INTENT_COORDINATOR_ROTATION_PRIVATE_KEY
```

متغیرهای موجود را دست نزنید: `BLOB_READ_WRITE_TOKEN`، `INTENT_SOLVER_KEYS`،
`INTENT_WATCHER_KEYS`، `INTENT_VERIFIER_KEYS`، `INTENT_COORDINATOR_ID`،
`INTENT_COORDINATOR_PRIVATE_KEY`، `INTENT_SOLVER_BONDS`،
`INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS`، `INTENT_COORDINATOR_ROTATIONS`،
`INTENT_MERKLE_ANCHOR_NETWORKS`.

---

## ۱۰. مرز غیراتمیک (غیرقابل‌نقض)

- تأیید دو تراکنش جدا، آن‌ها را اتمیک نمی‌کند.
- `atomic:false`، `globalAtomicity:false`، `custody:false`، `escrow:false`،
  `automaticSettlement:false`، `refundEnforcedByFbt:false` همیشه.
- envelope همچنان `draft-only` و `ATOMIC_CROSS_CHAIN_UNAVAILABLE`.
- `POST /bids` بسته می‌ماند.
- on-chain verification فقط برای receipt مشخص و پس از quorum واقعی true می‌شود.
- هیچ private key در کد/مخزن/docs/log/چت/`VITE_*`؛ کلید خصوصی کیف پول هرگز
  دریافت نمی‌شود؛ Ed25519 و base64url سخت‌گیرانه؛ unknown fieldها fail-closed؛
  همهٔ ورودی‌ها bounded؛ RPC URL عمومی نمی‌شود؛ RPC خصوصی «confidential» نامیده
  نمی‌شود؛ outage به verified یا empty معتبر تبدیل نمی‌شود.

## ۱۱. دستورها

```bash
npm test                        # واحد + probeها، بدون وابستگی به RPC عمومی
npm run build
npm run compile:contract        # Solidity 0.8.24
npm run compile:merkle-anchor
```

اگر دسترسی RPC واقعی یا تنظیم Vercel موجود نیست: implementation کامل است،
`configured:false` حفظ می‌شود، و نبود credential به‌عنوان موفقیت عملیاتی اعلام
نمی‌شود.
