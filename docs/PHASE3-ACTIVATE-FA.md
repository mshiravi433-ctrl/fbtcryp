# راهنمای فعال‌سازی فاز ۳ (اکنون اجرا شده)

> وضعیت: فاز ۳ (شبکهٔ سالور وثیقه‌دار + ادعای اجرا + اختلاف + داوری قطعی + گزارش تسویه) اکنون روی fbtswap.ir اجرا شده است.
> سالور **mm-a** با وثیقهٔ اعلام‌شدهٔ **100,000 USDC** و **یک راستی‌آزمای فعال** ثبت است.

این سند به صاحب پروژه (که از گوشی و بدون خواندن سورس کار می‌کند) نشان می‌دهد
هر متغیر چه می‌کند و چطور بفهمد واقعاً فعال است. مثل همیشه: **هیچ کلید خصوصی در
مخزن، در `VITE_*` یا در چت قرار نمی‌گیرد.**

---

## ۱. متغیرهای لازم در Vercel

| متغیر | مقدار نمونه | نقش |
|---|---|---|
| `INTENT_SOLVER_KEYS` | `[{"id":"mm-a","name":"Market Maker A","publicKey":"<base64url-32>"}]` | کلید عمومی سالور mm-a |
| `INTENT_SOLVER_BONDS` | `[{"solverId":"mm-a","bondUsd":"100000","asset":"USDC","expiresAt":0,"terms":"MM desk A"}]` | وثیقهٔ اعلامی mm-a |
| `INTENT_VERIFIER_KEYS` | `[{"id":"verify-coop","name":"Verifier Cooperative","publicKey":"<base64url-32>"}]` | کلید عمومی راستی‌آزمای فعال |
| `INTENT_COORDINATOR_ID` | `fbt-coordinator` | شناسهٔ هماهنگ‌کننده |
| `INTENT_COORDINATOR_PRIVATE_KEY` | `<base64url-pkcs8>` | کلید امضای Coordinator (فقط امضا) |
| `INTENT_AUCTION_CLOSE_TOKEN` | رشتهای ≥ 32 کاراکتر | مجوز بستن/داوری اپراتور |
| `INTENT_WATCHER_KEYS` | (اختیاری) | کلید عمومی ناظر کامل‌بودن |
| `INTENT_EXECUTION_GRACE_SECONDS` | `300` | پنجرهٔ اجرا پس از مهلت |

> `expiresAt: 0` یعنی منقضی نمی‌شود. هر ردیف وثیقه زیر 1000 دلار «وثیقه‌دار»
> (bonded) شمرده نمی‌شود.

## ۲. کلیدهای خصوصی کجا؟

کلید خصوصی سالور mm-a در **secrets manager اپراتور** می‌ماند (نه در Vercel، نه در
مخزن). برای امضای ادعای اجرا:

```bash
INTENT_SOLVER_PRIVATE_KEY='…' INTENT_SOLVER_ID='mm-a' \
  node scripts/intent-settler.mjs claim close.json commitment.json \
  --outcome filled --tx 0x… --received 400000000000000000 --fee 70
```

راستی‌آزمای فعال با `INTENT_VERIFIER_PRIVATE_KEY` اختلاف یا گزارش تسویه را امضا می‌کند.

## ۳. چطور بفهمی فعال است؟

```bash
curl -s "$FBT_URL/api/intents/v1/capabilities" | python3 -m json.tool
curl -s "$FBT_URL/api/intents/v1/bonds"
```

- `bonds.bondedSolvers === 1` و ردیف mm-a با `bonded: true` → وثیقه اعلامی پذیرفته شده.
- `execution.registeredVerifiers === 1` → راستی‌آزمای فعال هست.
- `bonds.onChainEscrow === false` و `bonds.custody === false` → صادقانه: وثیقه اعلام است، گرو واقعی نیست.

## ۴. حد صداقت

- وثیقه **اعلام** است؛ FBT وجوهی نگه نمی‌دارد و جریمه را خودش وصول نمی‌کند
  (`enforcement: 'out-of-protocol'`). داوری یک دستور امضاشده است برای لایهٔ تسویه.
- ادعاهای اجرا روی زنجیره راستی‌آزمایی نمی‌شوند (`onChainTxVerification: false`).
- استقلال واقعی به اپراتور مستقل پشت هر کلید بستگی دارد؛ رجیستری به‌تنهایی استقلال نمی‌سازد.
