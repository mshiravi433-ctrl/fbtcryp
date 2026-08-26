# FBT INTENT AI — Wave 1 Runbook (زیرساخت زنجیره)

تاریخ: ۲۰۲۶-۰۸-۲۶

## خلاصه

موج ۱ شواهد زیرساخت زنجیره را آماده می‌کند:
- `rpc` (۱۴): RPC quorum
- `policy-contract` (۱۵): deployed bytecode match
- `production-signer` (۹): policy-bound signer
- `smart-wallet` (۷): Smart Wallet با guardian
- `wallet-provider` (۱۰): adapter سالم
- `broker-provider` (۱۱): broker env
- `bridge-provider` (۱۲): bridge quote
- `venue-health` (۱۳): verifyProviderHealth

## Agent کارها (تکمیل‌شده)

### ۱. KMS adapter
- `scripts/lib/kmsAdapter.mjs` — AWS KMS interface با fallback به DEPLOYER_PRIVATE_KEY
- فقط testnet، keccak recovery، کلید هرگز لاگ نمی‌شود

### ۲. deployedBytecode در outputSelection
- هر سه compile script (compile, compile-workflow, compile-merkle-anchor, compile-auction-anchor)
- `deployedBytecode.object` در outputSelection

### ۳. Deploy orchestrator
- `scripts/deploy-all.mjs` — preflight (chainId, balance, gas) → ۴ قرارداد

### ۴. Adapter های فقط-تحلیل
- `server/intentVenueHealth.js` — verifyProviderHealth
- `server/intentBridgeQuote.js` — bridge quote رسمی

### ۵. WalletConnect project ID
- فرمت `VITE_WALLETCONNECT_PROJECT_ID` قفل با walletAdapter

## Operator کارها (HANDOFF)

### گام ۱: Alchemy + QuickNode
```
OPERATOR_REQUIRED: ثبت‌نام در Alchemy و QuickNode
- Alchemy: ساخت app برای Arbitrum Sepolia (chainId 421614)
- QuickNode: endpoint مشابه
- نتیجه: دو RPC URL
```

### گام ۲: فاست testnet
```
OPERATOR_REQUIRED: دریافت gas testnet
- از https://faucets.chain.link/arbitrum-sepolia
- ارسال 0.1 ETH به آدرس deployer
```

### گام ۳: Deploy
```bash
# اول Arbitrum Sepolia (421614)
DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://arb-sepolia.g.alchemy.com/v2/... CHAIN_ID=421614 \
  node scripts/deploy-all.mjs

# سپس Arbitrum One (42161) — فقط وقتی تستnet موفق شد
DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://arb-mainnet.g.alchemy.com/v2/... CHAIN_ID=42161 \
  node scripts/deploy-all.mjs
```

خروجی deploy-all:
```
INTENT_WORKFLOW_BATCH_ADDRESS=0xDeployedWorkflowBatch
INTENT_MERKLE_ANCHOR_NETWORKS=[{"chainId":421614,"name":"Arbitrum Sepolia","contract":"0xMerkle","rpcUrl":"https://...","minConfirmations":2}]
INTENT_ANCHOR_NETWORKS=[{"chainId":421614,"name":"Arbitrum Sepolia","contract":"0xAuction","rpcUrl":"https://...","explorerBaseUrl":"https://sepolia.arbiscan.io","minConfirmations":12}]
```

### گام ۴: Safe + Session Key
```
OPERATOR_REQUIRED: ساخت Safe wallet
- روی testnet یک Safe 1-of-1 بسازید
- Session key scoped ایجاد کنید (محدود به intent contract ها)
```

### گام ۵: CEX کلید فقط-trade
```
OPERATOR_REQUIRED: API key از CEX
- فقط دسترسی trade
- هیچ‌گاه withdrawal فعال نشود
```

## معیار موفقیت موج ۱

```bash
node scripts/wave1-probe.mjs
```
شواهد زیر باید پاس شوند:
- rpc ✓
- policy-contract ✓
- production-signer ✓
- smart-wallet ✓
- wallet-provider ✓
- broker-provider ✓
- bridge-provider ✓
- venue-health ✓
