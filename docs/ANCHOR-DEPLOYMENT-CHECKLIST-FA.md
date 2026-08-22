# چک‌لیست استقرار Anchor — Track A (Auction Close + Merkle Root)

> وضعیت فعلی: **intentionally unconfigured** — هر دو endpoint
> `GET /api/intents/v1/anchor-networks` و
> `GET /api/intents/v1/merkle-anchor-networks` صادقانه `{"networks":[]}`
> برمی‌گردانند، چون هیچ قرارداد deployشدهٔ واقعی و هیچ مجوز production
> ارائه نشده است. این سند مسیر فعال‌سازی امن را ثبت می‌کند؛ **خودِ سند چیزی
> را فعال نمی‌کند.**
>
> **قانون طلایی:** هیچ آدرس placeholder، mock یا RPC ساختگی برای
> سبزکردن UI/API وارد env نمی‌شود. Anchor ≠ Atomic ≠ استقلال سازمانی.

## ۰. معماری فعلی (تغییری نکرده)

- قرارداد `contracts/IntentAuctionAnchor.sol` — permissionless، بدون owner،
  بدون custody؛ فقط event `AuctionRootAnchored` با کلید کامل
  `keccak256(closeId, intentHash, logRoot, logSize, closedAt)` (ضد
  front-running blocking و ضد duplicate).
- قرارداد `contracts/IntentMerkleRootAnchor.sol` — همان مدل با
  `MerkleRootAnchored(rootId, intentHash, merkleRoot, logSize, anchorer)`.
- سرور هرگز کیف پول anchor ندارد: هر کسی می‌تواند tx بفرستد و سپس txHash را
  از طریق `POST /api/intents/v1/auctions/{intentHash}/anchor` یا
  `POST /api/intents/v1/log/{intentHash}/root-anchor` submit کند.
- سرور فقط پس از این‌ها anchor را می‌پذیرد: receipt موفق (`status 0x1`)،
  آدرس دقیق قرارداد پیکربندی‌شده، event با tuple دقیقاً یکسان با سند
  امضاشده، chainId پیکربندی‌شده، و `minConfirmations` کافی.
- **fail-safe:** شکست anchor (RPC outage، revert، gas، mismatch) هیچ اثری
  روی signed close ندارد — close معتبر می‌ماند و anchor صرفاً ذخیره نمی‌شود.
  تست‌های `test/intent-anchor-probe.mjs` این مرز را قفل کرده‌اند.
- **idempotency:** ذخیرهٔ anchor با `allowOverwrite:false` + مسیر deterministic
  از `closeId`/`rootId` است؛ retry یا submit موازی به همان یک رکورد همگرا
  می‌شود (`alreadyAnchored:true`) و هرگز دو سند ناسازگار نمی‌سازد.

### وضعیت‌های anchor (مدل موجود، بدون تغییر)

| وضعیت | معنی در سیستم فعلی |
|---|---|
| `pending` | سند امضاشده هست، claim ای submit نشده یا `ANCHOR_NOT_MINED` |
| `submitted` | claim ارسال شده ولی هنوز تأیید نشده (`ANCHOR_NOT_FINAL`) |
| `anchored/verified` | receipt + event دقیق + confirmation کافی، رکورد ذخیره شد |
| `failed` | `ANCHOR_TX_FAILED` / mismatch / outage — signed close دست‌نخورده |

## ۱. Blockerهای فعلی (دادهٔ عمومی لازم — نه secret)

بدون این‌ها هیچ شبکه‌ای configure نمی‌شود:

- [ ] `ANCHOR_SCOPE` (Auction / Merkle / هر دو) — `[NOT PROVIDED]`
- [ ] `ANCHOR_ENVIRONMENT` (Testnet-first / Mainnet / plan-only) — `[NOT PROVIDED]`
- [ ] `ANCHOR_PRODUCTION_WRITE_APPROVAL` — **No** (هیچ مجوزی داده نشده)
- [ ] آدرس قرارداد deployشدهٔ واقعی + explorer URL + deploy tx URL
- [ ] verified source URL روی explorer (تنظیمات دقیق: solc `0.8.24`،
      evmVersion `paris`، optimizer on / runs `200`)
- [ ] آدرس عمومی sender/relayer + تأیید داشتن gas بومی روی همان chain
- [ ] نام RPC provider + تأیید اینکه credential فقط server-side است
- [ ] سیاست نهایی confirmation (پیش‌فرض verification فعلی: 12)
- [ ] سیاست retry (پیشنهاد: bounded exponential backoff، حداکثر N تلاش،
      idempotent — storage فعلی همین را تضمین می‌کند)

## ۲. انتخاب شبکهٔ pilot (مقایسه، نه تصمیم)

فقط شبکه‌های موجود در verification فعلی (`ALLOWED_CHAINS` هر دو ماژول شامل
1, 10, 8453, 42161 است):

| شبکه | chainId | هزینهٔ تقریبی هر anchor | finality عملی | ملاحظات |
|---|---:|---|---|---|
| Ethereum Mainnet | 1 | بالاترین (چند دلار در ازدحام) | قوی‌ترین (L1) | گران برای anchor دوره‌ای |
| Optimism | 10 | خیلی کم | وابسته به L1 + مدل fault-proof | خوب |
| Arbitrum One | 42161 | خیلی کم | وابسته به L1 | خوب |
| Base | 8453 | خیلی کم | وابسته به L1، OP Stack | **کاندیدای پیشنهادی pilot** — پشتیبانی‌شده در verification فعلی و ارزان؛ **فقط پیشنهاد، نه مجوز** |

نکته: برای رویداد timestamping، reorg-risk سطح L2 با `minConfirmations`
بالاتر (مثلاً 12+) و امکان re-verify جبران می‌شود؛ اما تصمیم نهایی
(از جمله Testnet مثل Base Sepolia — chainId آن باید در زمان اجرا از مستندات
رسمی تأیید شود، حدس زده نشود؛ ضمناً chainهای testnet الان در
`ALLOWED_CHAINS` نیستند و افزودن‌شان تغییر کد آگاهانه و جداگانه می‌خواهد)
با مالک پروژه است.

## ۳. تفکیک کیف پول‌ها

- **Deployer wallet:** throwaway، فقط gas برای یک deploy، بعد از deploy هیچ
  نقشی ندارد (قرارداد owner ندارد). کلیدش هرگز وارد repo/chat/VITE_* نمی‌شود.
- **Anchor sender/relayer wallet:** جدا از deployer. چون قرارداد permissionless
  است، این کیف پول هیچ privilege ای ندارد؛ فقط gas می‌سوزاند. compromise آن
  فقط می‌تواند gas هدر بدهد، نه سند جعل کند (event باید با سند امضاشده
  tuple-match شود).
- هر دو باید ETH بومی روی همان chain داشته باشند.
- **هیچ private key ای از کاربر/مالک درخواست نمی‌شود.** فقط آدرس‌های عمومی.

## ۴. مراحل استقرار (فقط پس از مجوز صریح)

```bash
# 1. compile قطعی و تکرارپذیر (solc 0.8.24 pinned در repo)
npm run compile:auction-anchor        # → src/lib/auctionAnchorArtifact.json
npm run compile:merkle-anchor         # → src/lib/merkleRootAnchorArtifact.json

# 2. deploy (فقط با مجوز صریح؛ کلید فقط env موقتِ همان shell)
DEPLOYER_PRIVATE_KEY=… RPC_URL=https://… CHAIN_ID=<id> npm run deploy:auction-anchor
DEPLOYER_PRIVATE_KEY=… RPC_URL=https://… CHAIN_ID=<id> npm run deploy:merkle-anchor

# 3. راستی‌آزمایی مستقل (بدون کلید): bytecode دقیق + interface probe
RPC_URL=https://… CHAIN_ID=<id> npm run deploy:auction-anchor verify 0x<address>
RPC_URL=https://… CHAIN_ID=<id> npm run deploy:merkle-anchor verify 0x<address>

# 4. source verification روی explorer (عمومی و قابل بررسی توسط همه)

# 5. فقط بعد از 3 و 4، env سرور (secret manager، هرگز Git):
# INTENT_ANCHOR_NETWORKS=[{"chainId":<id>,"name":"…","contract":"0x…","rpcUrl":"https://…","explorerBaseUrl":"https://…","minConfirmations":12}]
# INTENT_MERKLE_ANCHOR_NETWORKS=[…]

# 6. تأیید پس از استقرار config:
curl -s https://fbtswap.ir/api/intents/v1/anchor-networks
curl -s https://fbtswap.ir/api/intents/v1/merkle-anchor-networks
# خروجی باید فقط دادهٔ عمومی باشد (rpcUrl هرگز برنمی‌گردد — در کد strip می‌شود)

# 7. anchor واقعی اول (پس از مجوز production write):
#    GET  /api/intents/v1/auctions/{intentHash}/anchor-calldata/{chainId}
#    → ارسال tx توسط sender → POST …/anchor با {schema, chainId, txHash}
#    فقط پس از receipt+event+confirmations، رکورد verified ذخیره می‌شود.
```

## ۵. Rollback plan

- حذف/خالی‌کردن `INTENT_ANCHOR_NETWORKS` و `INTENT_MERKLE_ANCHOR_NETWORKS`
  → endpointها فوراً به `{"networks":[]}` برمی‌گردند؛ signed close و کل flow
  دست‌نخورده می‌ماند (anchor کاملاً additive است).
- رکوردهای anchor قبلاً ذخیره‌شده immutable می‌مانند ولی هیچ مسیر جدیدی
  از آن‌ها ساخته نمی‌شود؛ نیازی به پاک‌سازی نیست.
- قرارداد on-chain بدون owner است؛ چیزی برای pause/upgrade وجود ندارد و
  رها کردنش هیچ ریسک دارایی ندارد (هرگز fund نمی‌گیرد).

## ۶. پوشش تست (اجرا شده و سبز)

`test/intent-anchor-probe.mjs` (در `npm test` اجرا می‌شود) این سناریوها را
قفل می‌کند: config parsing / empty config / invalid chainId / wrong contract /
wrong event / tuple mismatch (root، logSize، closedAt) / receipt fail /
tx-hash mismatch / not mined / insufficient confirmations / RPC outage /
reorg-shape (head < receipt block، removed log، blockHash تهی) /
duplicate-retry idempotency / و اصل «failed anchor هرگز signed close را
fail نمی‌کند» — برای هر دو anchor (Auction و Merkle).

## ۷. مرزهای صداقت (غیرقابل‌مذاکره)

- Anchor فقط **timestamp عمومی یک سند امضاشده** است؛ اثبات completeness،
  execution، settlement، atomicity یا استقلال سازمانی نیست.
- `organizationalIndependenceProven:false` و `atomic:false` با هیچ anchorای
  تغییر نمی‌کنند.
- بدون قرارداد واقعی deployشده + verified source + receipt معتبر، هیچ
  capabilityای enabled/green اعلام نمی‌شود.
