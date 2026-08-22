# راهنمای فعال‌سازی فاز ۶ — هشت آیتم عملیاتی

> نسخهٔ هدف: **۱.۳۹.۰+** · مرجع runtime همیشه
> `GET /api/intents/v1/capabilities` است، نه این سند.
>
> **قانون طلایی:** هیچ قابلیتی را با کانفیگ فیک سبز نکن. `configured:false`
> صادقانه است. کلید خصوصی هرگز در چت، مخزن، یا `VITE_*` قرار نمی‌گیرد.

این سند برای کسی است که از موبایل و بدون خواندن سورس کار می‌کند. هر آیتم:
فیلد capabilities، نام env، شکل JSON، مراسم آفلاین، curl چک، و حد صداقت.

کد منبع هر آیتم:

| # | ماژول | نقش |
|---|---|---|
| ۱ | `server/intentOperators.js` | attestation ناظر/راستی‌آزما |
| ۲ | `server/intentAuctions.js` | rotation دوامضاشدهٔ Coordinator |
| ۳ | `server/intentRootAnchors.js` + `intentTransparency.js` | anchor ریشهٔ Merkle |
| ۴ | `server/intentWorkflow.js` | قرارداد IntentWorkflowBatch |
| ۵ | `server/intentBonds.js` | وثیقهٔ اعلامی سالور |
| ۶ | `server/intentSettlement.js` | گزارش تسویه + re-grade |
| ۷ | `server/intentCrossChain.js` | state machine میان‌زنجیره‌ای |
| ۸ | `server/intentCrossChainVerification.js` | راستی‌آزمایی چند-RPC + EIP-191 |

---

## چک سریع لایو

```bash
export FBT_URL=https://fbtswap.ir
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/operators"    | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/bonds"        | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/merkle-anchor-networks" | python3 -m json.tool
```

برای ادعای «فاز ۶ کامل فعال است» باید هم‌زمان:

- `independentVerification.configured === true` و همهٔ کلیدها bind شده باشند؛
- با وجود آن، `organizationalIndependenceProven === false` (مرز صادقانه)؛
- `auctions.coordinatorRotationConfigured === true` فقط پس از rotation واقعی؛
- `merkleRootAnchors.configured === true` فقط پس از deploy/RPC واقعی؛
- `workflows.contract.configured === true` فقط با آدرس mainnet واقعی؛
- روی یک log مشخص، `externallyAnchored === true` فقط پس از tx تأییدشده.

---

## ۱) attestation اپراتورهای ناظر/راستی‌آزما

| | |
|---|---|
| **capabilities** | `independentVerification.configured` |
| **env عمومی** | `INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS` |
| **env رجیستری** | `INTENT_WATCHER_KEYS`, `INTENT_VERIFIER_KEYS` |
| **کلید آفلاین** | `INTENT_OBSERVER_PRIVATE_KEY` (فقط secrets manager اپراتور) |
| **CLI** | `scripts/intent-operator.mjs` |

### شکل JSON attestation (خروجی عمومی امضاشده)

```json
[{
  "schema": "fbt.operator-attestation.v1",
  "attestationId": "…",
  "role": "watcher",
  "registryId": "watch01",
  "operatorId": "ops-watch-01",
  "operatorName": "Watcher Cooperative",
  "operatorUrl": "https://…",
  "publicKey": "<base64url-32>",
  "issuedAt": 1700000000,
  "expiresAt": 1820000000,
  "claims": {
    "keyControlSelfAttested": true,
    "organizationalIndependenceProven": false
  },
  "signature": "<base64url>"
}]
```

`configured` فقط وقتی `true` است که **هر** کلید active در watcher/verifier
یک attestation جاری با همان `publicKey` داشته باشد و از کلید
Coordinator/Solver جدا باشد.

### مراسم آفلاین

```bash
# input.json را اپراتور می‌سازد (بدون signature)
INTENT_OBSERVER_PRIVATE_KEY='…' \
  node scripts/intent-operator.mjs attest input.json > signed.json

node scripts/intent-operator.mjs verify signed.json
# خروجی عمومی را در INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS بگذار (آرایه)
```

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/operators" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('configured', d.get('configured'))
print('blockers', d.get('blockers'))
print('orgProven', d.get('organizationalIndependenceProven'))
"
```

### حد صداقت

- امضای معتبر = کنترل کلید، نه استقلال سازمانی.
- `organizationalIndependenceProven` **همیشه** `false` است مگر audit بیرونی.
- FBT هرگز attestation ساختگی یا کلید جایگزین نمی‌سازد.
- تمدید پیش از `expiresAt` (هدف عملیاتی: پیش از ۲۰۲۷-۰۸-۲۲ برای
  watch01/verify-coop فعلی). اگر کلید گم شد: کلید تازه + به‌روزرسانی
  `INTENT_WATCHER_KEYS` / `INTENT_VERIFIER_KEYS` + attestation جدید.

---

## ۲) چرخش دوامضاشدهٔ Coordinator

| | |
|---|---|
| **capabilities** | `auctions.coordinatorRotationConfigured` |
| **env** | `INTENT_COORDINATOR_ROTATIONS`, `INTENT_COORDINATOR_ID`, `INTENT_COORDINATOR_PRIVATE_KEY` (active) |
| **کلید آفلاین** | `INTENT_COORDINATOR_ROTATION_PRIVATE_KEY` (مراسم؛ هرگز روی سرور) |
| **CLI** | `scripts/intent-coordinator.mjs` |
| **schema** | `fbt.coordinator-key-rotation.v1` |

### مراسم آفلاین

```bash
node scripts/intent-coordinator.mjs draft <oldPub> <newPub> [activatedAtMs] > rot.json
INTENT_COORDINATOR_ROTATION_PRIVATE_KEY='<old-pk>' \
  node scripts/intent-coordinator.mjs sign-old rot.json > rot-old.json
INTENT_COORDINATOR_ROTATION_PRIVATE_KEY='<new-pk>' \
  node scripts/intent-coordinator.mjs sign-new rot-old.json > rot-dual.json
node scripts/intent-coordinator.mjs verify rot-dual.json
# فقط سند عمومی دوامضاشده → INTENT_COORDINATOR_ROTATIONS
```

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; a=json.load(sys.stdin)['auctions']
print({k:a[k] for k in a if 'oordinator' in k or 'otation' in k})
"
```

### حد صداقت

- بدون رکورد دوامضاشدهٔ واقعی: `coordinatorRotationConfigured:false`.
- رسیدهای تاریخی با کلید pin‌شده داخل سند verify می‌شوند؛ registry لازم نیست.
- rotation نمایشی برای سبز کردن capability ساخته نمی‌شود.

---

## ۳) anchor اختیاری ریشهٔ Merkle

| | |
|---|---|
| **capabilities** | `merkleRootAnchors.configured`, `transparency.externalRootAnchorConfigured` |
| **env** | `INTENT_MERKLE_ANCHOR_NETWORKS` |
| **قرارداد** | `contracts/IntentMerkleRootAnchor.sol` |
| **CLI** | `scripts/compile-merkle-anchor.mjs`, `deploy-merkle-anchor.mjs`, `intent-root-anchor.mjs` |

### شکل JSON env

```json
[{
  "chainId": 8453,
  "name": "Base",
  "contract": "0x…",
  "rpcUrl": "https://…",
  "explorerBaseUrl": "https://basescan.org",
  "minConfirmations": 2
}]
```

فقط `https://`؛ RPC در پاسخ عمومی برنمی‌گردد.

### مراسم deploy (فقط با gas واقعی)

```bash
node scripts/compile-merkle-anchor.mjs
DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://… CHAIN_ID=8453 \
  node scripts/deploy-merkle-anchor.mjs
RPC_URL=https://… CHAIN_ID=8453 \
  node scripts/deploy-merkle-anchor.mjs verify 0xDeployedAddress
# سپس INTENT_MERKLE_ANCHOR_NETWORKS را با آدرس واقعی پر کن
```

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/merkle-anchor-networks"
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('merkle', d['merkleRootAnchors'])
print('ext', d['transparency'].get('externalRootAnchorConfigured'))
"
```

### حد صداقت

- Anchor فقط timestamp/set commitment است.
- `completenessProven`، `executionProven`، `settlementProven`، `custody` همیشه
  در claims manifest باید `false` باشند وگرنه رد می‌شود.
- بدون wallet/private key داخل FBT؛ publisher هر کسی می‌تواند باشد.
- بدون credential واقعی: deploy نکن و `configured:false` بماند.

---

## ۴) قرارداد IntentWorkflowBatch

| | |
|---|---|
| **capabilities** | `workflows.contract.configured`, `workflows.contract.address` |
| **env** | `INTENT_WORKFLOW_BATCH_ADDRESS` |
| **کد** | `server/intentWorkflow.js`, `contracts/` (batch) |
| **CLI** | `scripts/compile-workflow.mjs`, `deploy-workflow.mjs` |

### فعال‌سازی

```bash
npm i solc   # در صورت نیاز
node scripts/compile-workflow.mjs
DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://… CHAIN_ID=42161 \
  node scripts/deploy-workflow.mjs
# INTENT_WORKFLOW_BATCH_ADDRESS=0x…  (فقط mainnet واقعی — هرگز تست‌نت)
```

یا Remix با همان artifact. بعد Redeploy روی Vercel.

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; w=json.load(sys.stdin)['workflows']
print(w['contract'])
print('crossChainAtomic', w['crossChainAtomic'])
print('executableByServer', w['executableByServer'])
"
```

### حد صداقت

- `liveRouterCalldata:false`، `verifiesCallOutputs:false`، `custody:false`.
- `crossChainAtomic:false`؛ envelope میان‌زنجیره‌ای `draft-only` با
  `ATOMIC_CROSS_CHAIN_UNAVAILABLE`.
- سرور اجرا نمی‌کند؛ فقط calldata برنامه‌ای می‌سازد تا **کاربر** امضا کند.
- آدرس تست‌نت نگذار — `configured:true` با قرارداد غیرتولیدی دروغ است.

---

## ۵) وثیقهٔ اعلامی سالور (Bonds)

| | |
|---|---|
| **capabilities** | `bonds.configured`, `bonds.bondedSolvers` |
| **env** | `INTENT_SOLVER_BONDS` (+ `INTENT_SOLVER_KEYS` برای `bonded:true`) |
| **کد** | `server/intentBonds.js` |

### شکل JSON

```json
[{
  "solverId": "mm-a",
  "bondUsd": "100000",
  "asset": "USDC",
  "expiresAt": 0,
  "terms": "MM desk A"
}]
```

`expiresAt: 0` = بدون انقضا. زیر ۱۰۰۰ دلار → `bonded:false`.

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/bonds" | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; print(json.load(sys.stdin)['bonds'])
"
```

### حد صداقت

- `enforcement: 'out-of-protocol-declared'`
- `custody:false`, `onChainEscrow:false` — FBT وجه نگه نمی‌دارد و جریمه وصول
  نمی‌کند؛ فقط جدول bps قطعی را امضا می‌کند.

---

## ۶) settlement report + re-grade مستقل

| | |
|---|---|
| **capabilities** | `settlement.registeredVerifiers`, `settlement.onChainTxVerification` |
| **env** | `INTENT_VERIFIER_KEYS`, `INTENT_EXECUTION_GRACE_SECONDS` |
| **endpoint** | `POST /api/intents/v1/auctions/{intentHash}/settlement-reports` |
| **CLI** | `scripts/intent-settler.mjs` |
| **کد** | `server/intentSettlement.js` |

### مراسم آفلاین (verifier)

```bash
INTENT_VERIFIER_PRIVATE_KEY='…' INTENT_VERIFIER_ID='verify-coop' \
  node scripts/intent-settler.mjs …   # مطابق --help اسکریپت
```

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; print(json.load(sys.stdin)['settlement'])
"
# پس از یک مزایدهٔ بسته:
# curl -s "$FBT_URL/api/intents/v1/auctions/$HASH/settlement-reports"
```

### حد صداقت

- `onChainTxVerification:false` در سطح settlement schema (تأیید آن‌چین در
  فاز ۴c لایهٔ جداست).
- `serverRecomputesBeforeStorage:true` — امضای verifier کافی نیست؛ اعداد باید
  بازتولید شوند.
- `custody:false`. برای Phase 6 status، attestation اپراتور (آیتم ۱) لازم است.

---

## ۷) state machine میان‌زنجیره‌ای (فاز ۴b)

| | |
|---|---|
| **capabilities** | `crossChain.configured`, `workflows.crossChainEnvelopeStatus` |
| **env** | `BLOB_READ_WRITE_TOKEN` (دوام) |
| **کد** | `server/intentCrossChain.js` |
| **CLI** | `scripts/intent-cross-chain.mjs` |

### API

```text
POST /api/intents/v1/cross-chain/states
GET  /api/intents/v1/cross-chain/states/:stateId
POST /api/intents/v1/cross-chain/states/:stateId/receipts
```

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; c=json.load(sys.stdin)['crossChain']
print({k:c[k] for k in c if k in ('configured','atomic','custody','escrow','persistenceMode','txVerification') or True})
" 2>/dev/null | head -40
```

### حد صداقت

همیشه:

```json
{
  "atomic": false,
  "globalAtomicity": false,
  "custody": false,
  "escrow": false,
  "automaticSettlement": false
}
```

Envelope: `draft-only` / `ATOMIC_CROSS_CHAIN_UNAVAILABLE`. این bug نیست؛ مرز
امنیتی تا زمان escrow آن‌چین حسابرسی‌شده است.

---

## ۸) راستی‌آزمایی چند-RPC + account binding EIP-191 (فاز ۴c)

| | |
|---|---|
| **capabilities** | `crossChainVerification.configured` |
| **env** | `INTENT_CROSS_CHAIN_RPC_NETWORKS`, `INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT` |
| **کد** | `server/intentCrossChainVerification.js` |
| **راهنمای کامل** | `docs/PHASE4C-ACTIVATE-FA.md` |

### شکل JSON RPC

```json
[{
  "chainId": 8453,
  "quorum": 2,
  "minConfirmations": 12,
  "providers": [
    { "id": "a", "rpcUrl": "https://…" },
    { "id": "b", "rpcUrl": "https://…" }
  ]
}]
```

حداقل دو HTTPS با hostname متفاوت per chain؛ `quorum ≥ 2`.

### curl چک

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -c "
import json,sys; print(json.dumps(json.load(sys.stdin)['crossChainVerification'], indent=2))
"
```

### حد صداقت

- `providerIndependenceProven:false` همیشه (hostname ≠ استقلال provider).
- `eip1271Supported:false`.
- تأیید دو پا اتمیک نمی‌سازد؛ پرچم‌های atomic/custody/escrow false می‌مانند.
- RPC URL هرگز در API عمومی برنمی‌گردد.
- جزئیات binding/verdict/fail-closed: `docs/PHASE4C-ACTIVATE-FA.md`.

---

## ترتیب پیشنهادی روشن‌کردن (عملیاتی)

1. Blob + solver keys + bonds (پایهٔ commitment) — آیتم ۵  
2. Coordinator + close token + watcher/verifier keys  
3. Operator attestations — آیتم ۱ (بدون این، Phase 6 status کامل نیست)  
4. Settlement path — آیتم ۶  
5. Cross-chain state (Blob) — آیتم ۷  
6. Multi-RPC verification وقتی RPC واقعی داری — آیتم ۸  
7. Merkle anchor وقتی gas/deploy داری — آیتم ۳  
8. Workflow batch وقتی gas داری — آیتم ۴  
9. Coordinator rotation فقط وقتی واقعاً لازم شد — آیتم ۲  

---

## امنیت

| هرگز | همیشه |
|---|---|
| کلید خصوصی در چت/ریپو/`VITE_*` | فقط سند عمومی امضاشده در env سرور |
| آدرس تست‌نت به‌عنوان configured | mainnet واقعی یا `configured:false` |
| attestation/rotation نمایشی | مراسم آفلاین با صاحب واقعی کلید |
| ادعای custody/atomic بدون قرارداد | پرچم‌های false در capabilities |

`npm test` پیش از هر PR که این سطح را لمس کند باید سبز بماند.
