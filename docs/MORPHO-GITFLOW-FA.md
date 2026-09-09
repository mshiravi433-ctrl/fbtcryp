# گیت‌فلو GitHub برای Morpho — چی بذارم کجا

این راهنما دقیقاً می‌گوید برای عملیاتی کردن Morpho چه فایل‌هایی را کجا بگذاری و چه مراحلی را در GitHub طی کنی. همه چیز fail-closed است؛ یعنی اگر چیزی جا بیفتد build می‌شکند، نه اینکه پول باز شود.

## 1) فایل‌هایی که همین الان آماده‌اند (در این branch)

| فایل | کجاست | کاربرد |
|---|---|---|
| `src/lib/defi/morphoBlueBase.js` | کد اصلی | آداپتور با marketId پین‌شده |
| `src/lib/defi/morphoBlueHistory.js` | جدید | ledger محلی + recovery |
| `src/components/Farm/MorphoBaseUsdcPanel.jsx` | جدید | پنل supply/withdraw/revoke |
| `src/components/Farm/FarmPositionHub.jsx` | ویرایش | descriptor `morphoBase` اضافه شد |
| `test/morpho-base-fork-probe.mjs` | موجود | probe اصلی |
| `ci/morpho-base-fork-probe.yml` | جدید | template دستی workflow |
| `.github/workflows/morpho-base-fork-probe.yml` | جدید | workflow فعال |
| `scripts/record-farm-fork-evidence.mjs` | ویرایش | الان `morpho-base` را هم می‌فهمد |
| `docs/defi/morpho-blue-base-market.md` | موجود | spec مارکت |
| `docs/defi/MORPHO-BASE-REPORT-FA.md` | جدید | همین گزارش شواهد |

## 2) گیت‌فلو — شاخه‌ها

- `main` : همیشه capital-off. هیچ env rollout ندارد. امن برای Vercel و APK عمومی.
- `arena/01a083c1-fbtcryp` (این branch): کار فعلی. بعد از review، PR به `main`.
- تگ‌ها `vX.Y.Z` : فقط برای release APK/AAB. workflow `build-apk.yml` هر دو variant را می‌سازد.

**قانون:** هیچ‌وقت `VITE_ENABLE_MORPHO_BASE_SUPPLY=true` را مستقیم روی `main` بدون evidence کامیت نکن. gate جلویش را می‌گیرد، اما عمداً این کار را نکن.

## 3) چی را دستی در GitHub بگذاری (چون agent بلاک می‌شود)

GitHub توکن agent را از نوشتن زیر `.github/workflows/` بلاک می‌کند. اگر push این branch با خطای `refusing to allow a GitHub App to create or update workflow` شکست خورد، این کار را دستی کن:

1. برو `github.com/mshiravi433-ctrl/fbtcryp`
2. `Add file → Create new file`
3. مسیر را بنویس: `.github/workflows/morpho-base-fork-probe.yml`
4. محتوای `ci/morpho-base-fork-probe.yml` را paste کن (دقیقاً همان فایل)
5. Commit مستقیم به `main` یا به همین branch.

همین کار را برای بقیه probeها قبلاً انجام داده‌ای؛ این یکی هم همان است.

## 4) اجرای fork probe در GitHub Actions

- تب Actions → "Morpho Base fork probe" → Run workflow
- `rpc_url` را بگذار `https://mainnet.base.org` یا RPC اختصاصی (Alchemy/Infura). RPC عمومی اگر rate-limit شد، دوباره با RPC دیگر run کن.
- منتظر بمان تا job تمام شود. باید ببینی:

```
PASS Anvil fork is serving
PASS marketId is the pinned selected market
...
18/18 passed
```

- اگر FAIL دیدی، لاگ را بخوان: معمولاً یا RPC archive نیست یا rate-limit است. دوباره run کن.

## 5) ثبت evidence

بعد از PASS:

```bash
# لاگ را از Artifacts دانلود کن (morpho-base-fork-probe.log)
cat /path/to/morpho-base-fork-probe.log | node scripts/record-farm-fork-evidence.mjs morpho-base
# خروجی: farm-fork-evidence/morpho-base.json
```

فایل JSON شبیه این می‌شود:

```json
{
  "protocol": "morpho-base",
  "result": "PASS",
  "assertionsPassed": 18,
  "totalAssertions": 18,
  "fingerprint": { "algo": "sha256", "digest": "<sha256 log>" },
  "recordedAt": "2026-09-09T..."
}
```

این فایل را commit کن:

```bash
git add farm-fork-evidence/morpho-base.json
git commit -m "chore: record morpho-base strict fork evidence"
git push origin main
```

از این لحظه gate در Vercel هم می‌تواند canary را بپذیرد (چون evidence روی دیسک هست).

## 6) فعال‌سازی canary محدود (Vercel / CI)

در Vercel → Project Settings → Environment Variables:

```
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

- `ALLOWLIST` باید آدرس عمومی کیف خودت باشد (fee-recipient فعلی). هیچ seed/private key نذار.
- caps بالاتر از 100/500 را gate رد می‌کند.

سپس deploy کن. در لاگ build باید ببینی:

```
Farm rollout gate passed: limited canary for morpho-base (1 canary wallet, caps 100/500)
```

اگر این را ندیدی، build fail شده و چیزی deploy نشده — همین مطلوب است.

## 7) برای APK canary

`ci/build-both.sh` فعلاً Farm vars را نمی‌گیرد، پس APK عمومی capital-off می‌ماند. برای APK canary باید workflow `build-apk.yml` را موقتاً ویرایش کنی و همان envهای بالا را به `env:` اضافه کنی، بعد build بگیری و bundle را چک کنی (grep برای `morpho-blue` یا `MORPHO`).

## 8) canary زنده (روی Base mainnet، با پول کم)

1. کیف allowlist را وصل کن
2. Farm → Position Hub → Morpho panel باید دیده شود
3. amount مثلاً 5 USDC → plan می‌گوید `approve exact 5` + `supply 5`
4. simulation باید `simulated-clean` باشد، وگرنه sign نکن
5. approve → receipt + Approval event
6. supply → receipt + Supply event با marketId و owner، و position افزایش
7. withdraw max → Withdraw event + shares 0

همه tx hashها را بدون credential یادداشت کن.

## 9) چه زمانی public کنیم

فقط وقتی این سه با هم هستند:

1. `farm-fork-evidence/morpho-base.json` با PASS در `main`
2. allowlist عمومی تأییدشده
3. canary زنده کامل (supply + withdraw)

تا قبل از آن، `npm run build` بدون env (capital-off) امن است و می‌تواند production باشد، ولی نه برای ورود سرمایه عمومی.

## 10) دستورات سریع

```bash
# تست واحد
npm run test:farm

# بیلد عمومی امن
npm run build

# بیلد canary (نیاز به env بالا)
npm run build:farm-rollout

# probe محلی (نیاز به anvil + BASE_RPC_URL)
BASE_RPC_URL="https://mainnet.base.org" npm run test:morpho-base-fork -- --strict
```
