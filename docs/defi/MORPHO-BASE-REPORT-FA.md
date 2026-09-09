# Morpho Blue · Base · USDC/cbBTC — گزارش اجرایی و شواهد

تاریخ بازبینی: 2026-09-09 (UTC)
وضعیت کد: **آداپتور، پنل فارم، تاریخچه محلی، gate و probe پیاده‌سازی شد؛ public capital خاموش**

این سند شواهد عملیاتی Morpho در Farm را جمع می‌کند. هیچ تراکنش mainnet یا فعال‌سازی public capital را ادعا نمی‌کند.

## 1) محدودهٔ پین‌شده (immutable)

| فیلد | مقدار | منبع |
|---|---|---|
| Chain | Base 8453 | `src/lib/defi/morphoBlueBase.js` |
| Morpho Blue core | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | آدرس رسمی Morpho |
| Market ID | `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` | `idToMarketParams(bytes32)` |
| Loan token | USDC Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` 6 dec | توکن رسمی + پارامتر مارکت |
| Collateral token | cbBTC Base `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` 8 dec | توکن رسمی + پارامتر مارکت |
| Oracle | `0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9` | پارامتر immutable مارکت |
| IRM | `0x46415998764C29aB2a25CbeA6254146D50D22687` | پارامتر immutable مارکت |
| LLTV | `860000000000000000` = 86% | پارامتر immutable مارکت |
| DefiLlama UUID | `7d33d57d-36dc-414b-9538-22a223250468` | فقط شناسهٔ داده، هرگز target تراکنش نیست |

آداپتور فقط **USDC loan** را supply/withdraw می‌کند. cbBTC collateral را supply نمی‌کند، borrow نمی‌کند، debt باز نمی‌کند، reward claim ندارد. قبل از هر plan، `idToMarketParams` و `market` روی چین خوانده و همه فیلدها تطبیق داده می‌شود.

## 2) فایل‌های اجرایی

| لایه | فایل |
|---|---|
| Adapter | `src/lib/defi/morphoBlueBase.js` — verifyDeployment, getMarketState, getPosition, buildSupplyPlan, buildWithdrawPlan, buildRevokePlan, verifyMorphoReceipt, isMorphoBlueBaseMarket |
| Feature flags | `src/lib/features.js` — `MORPHO_BASE_SUPPLY_ENABLED`, caps 100/500, allowlist, `morphoBaseSupplyAllowedFor`, `morphoBaseWithdrawAllowedFor` |
| History | `src/lib/defi/morphoBlueHistory.js` — localStorage ledger + partial allowance recovery |
| Panel UI | `src/components/Farm/MorphoBaseUsdcPanel.jsx` — supply/withdraw/revoke, simulation قبل از امضا، receipt/event/position proof |
| Position Hub | `src/components/Farm/FarmPositionHub.jsx` — descriptor `morphoBase` با pool UUID فقط برای مچینگ |
| Fork probe | `test/morpho-base-fork-probe.mjs` — 0..5: scope, funding via masterMinter, on-chain verification, exact approve+supply, max withdraw via shares, fail-closed |
| Adapter build | `test/morpho-base-fork-adapter.mjs` + `test/vite.morphofork.mjs` |
| Unit tests | `test/morpho-defi.test.js` — market pinning, data UUID vs tx identity, flag off, withdraw independent, wrong chain, missing event, decimals |
| Gate tests | `test/farm-rollout-gate.test.js` — includes morpho-base RPC check |
| Hub tests | `test/farm-position-hub.test.jsx` — routes morpho descriptor to its adapter |

## 3) شواهد unit و build (این محیط)

```bash
npm run test:farm
# 14 files, 226 tests passed (شامل morpho-defi.test.js 6/6 و farm-position-hub 2/2)
NODE_OPTIONS=--max-old-space-size=3072 npm run build
# built in 39s, Farm chunk 191kB, capital-off
```

- build عمومی: `Farm rollout gate passed: no money-in protocol is enabled (capital-off build).`
- پنل Morpho وقتی flag خاموش است رندر نمی‌شود؛ وقتی position دارد (یا history) حتی با flag خاموش، withdraw دیده می‌شود (kill-switch فقط ورود را می‌بندد).

## 4) شواهد fork — چطور تولید می‌شود

probe در حالت `--strict` سه چیز را fail می‌کند اگر نباشد: `BASE_RPC_URL` صریح، باینری `anvil`، و همه assertionها. SKIP یا خطای RPC هم FAIL است.

در این sandbox `anvil` وجود ندارد و شبکهٔ release-assets مسدود است، بنابراین اجرای محلی عمداً fail-closed است:

```
FAIL BASE_RPC_URL provided (--strict) — missing
0/1 passed
```

این خودش evidence است که gate جعل نمی‌شود. اجرای واقعی باید در GitHub Actions انجام شود (جایی که Foundry از tarball رسمی نصب می‌شود).

### اجرای واقعی در GitHub

Workflow آماده است:

- Template دستی: `ci/morpho-base-fork-probe.yml`
- نسخهٔ فعال در ریپو: `.github/workflows/morpho-base-fork-probe.yml`

Steps داخل workflow:

1. checkout + node 22
2. نصب anvil از `https://github.com/foundry-rs/foundry/releases/download/v1.8.1/...`
3. `node ci/lock-platform-guard.mjs` (رفع مشکل fsevents روی Linux)
4. `npm ci`
5. `BASE_RPC_URL=${{ inputs.rpc_url }} npm run test:morpho-base-fork -- --strict`

خروجی در Summary و artifact `morpho-base-fork-probe.log` ذخیره می‌شود.

پس از PASS (مثال 18/18 یا بیشتر — تعداد دقیق در لاگ)، evidence ثبت می‌شود:

```bash
node test/morpho-base-fork-probe.mjs --strict | tee /tmp/morpho-base.probe.log
node scripts/record-farm-fork-evidence.mjs morpho-base < /tmp/morpho-base.probe.log
# → farm-fork-evidence/morpho-base.json
# { protocol: "morpho-base", result: "PASS", assertionsPassed: 18, totalAssertions: 18, fingerprint: { sha256(log) } }
```

فایل `farm-fork-evidence/morpho-base.json` anchor قابل audit است تا gate در CI/Vercel تازه‌کلون‌شده هم fail-closed بماند. این فایل باید commit شود (مثل `aave-base.json` و `compound-base.json` فعلی).

## 5) operationalization — چطور canary باز می‌شود

**پیش‌نیازها (همه باید با هم باشند):**

1. PASS واقعی strict fork برای `morpho-base` (لاگ و json)
2. review مستقل mapping مارکت مقابل Morpho API و address resource
3. allowlist عمومی و غیرخالی با رضایت صاحب wallet (هیچ private key در config نیست)

**env برای build canary محدود:**

```env
FARM_STRICT_FORK_EVIDENCE=true
FARM_ROLLOUT_PROTOCOLS=morpho-base

VITE_ENABLE_MORPHO_BASE_SUPPLY=true
VITE_MORPHO_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
VITE_MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX=100
VITE_MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL=500

VITE_ENABLE_AAVE_BASE_SUPPLY=false
VITE_ENABLE_COMPOUND_BASE_SUPPLY=false
VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=false
VITE_ENABLE_LIDO_STAKE=false
```

`0xaf5CE...` کیف fee-recipient فعلی پروژه است (همان که بقیه canaryها استفاده می‌کنند).

سپس:

```bash
npm run build:farm-rollout
# یا برای Vercel: همین env را در Project Settings بگذار؛ build:full gate را اجرا می‌کند
```

برای Android canary: همین env باید صریحاً به `ci/build-both.sh` پاس داده شود و محتوای bundle قبل از بسته‌بندی بررسی شود (workflow فعلی Farm vars را پاس نمی‌دهد، پس artifact عمومی capital-off می‌ماند).

## 6) خروج مستقل و kill switch

- `getPosition` و `getMarketState` قراردادهای پین‌شده را مستقیماً می‌خواند؛ خرابی DefiLlama مسیر withdraw/revoke را حذف نمی‌کند.
- خاموش کردن `VITE_ENABLE_MORPHO_BASE_SUPPLY` فقط supply جدید را می‌بندد؛ withdraw/revoke بر اساس owner و position واقعی تصمیم می‌گیرد، نه flag.
- `fromUsdcWei` دقیق 6-decimal است، بدون round-trip نمایشی.

## 7) چه چیزی در گیت‌فلو بگذارم (خلاصه برای شما)

1. **Workflow fork probe** را در `main` داشته باش:
   - فایل: `.github/workflows/morpho-base-fork-probe.yml` (از `ci/morpho-base-fork-probe.yml` کپی)
   - اگر GitHub push از agent را بلاک کرد، دستی در GitHub UI بساز: Actions → New workflow → paste content

2. **Run کن**:
   - GitHub → Actions → "Morpho Base fork probe" → Run workflow → rpc_url را بگذار `https://mainnet.base.org` (یا RPC شخصی)
   - منتظر PASS بمان؛ لاگ artifact را دانلود کن

3. **Evidence commit**:
   - `node scripts/record-farm-fork-evidence.mjs morpho-base < morpho-base-fork-probe.log`
   - `farm-fork-evidence/morpho-base.json` را commit و push کن به `main`

4. **Canary build** (فقط بعد از evidence):
   - در Vercel یا CI، envهای بخش 5 را set کن
   - build را اجرا کن؛ gate باید بگوید `limited canary for morpho-base (1 canary wallet, caps 100/500)`

5. **Canary زنده** (با wallet allowlist):
   - اتصال wallet → simulation clean → approve دقیق → supply کوچک → receipt + Supply event + position increase → withdraw max → Withdraw event + shares 0
   - tx hashها را بدون credential ثبت کن

تا قبل از 3 مرحلهٔ بالا، وضعیت فقط `canary-ready در کد` است، نه production-ready برای public capital.

## 8) چک‌لیست نهایی قبل از public

- [x] adapter با marketId و tuple پین‌شده
- [x] unit tests 6/6
- [x] panel + history + hub integration
- [x] rollout policy شامل `morpho-base` با caps 100/500
- [x] gate fail-closed روی missing RPC و missing anvil
- [x] workflow template در `ci/` و `.github/workflows/`
- [ ] strict fork PASS در CI (18/18+) + log artifact
- [ ] `farm-fork-evidence/morpho-base.json` commit شده
- [ ] allowlist عمومی تأییدشده توسط صاحب wallet
- [ ] canary زنده با supply + withdraw کامل
