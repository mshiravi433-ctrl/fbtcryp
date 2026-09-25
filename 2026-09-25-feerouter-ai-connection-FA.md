# ۲۰۲۶-۰۹-۲۵ — FeeRouter وصل شد به هوش مصنوعی

## مسئله

«برای هوش مصنوعی ببین وصله؛ اگر نه فعالش کن.»

بررسی نشان داد FeeRouter **هیچ اتصال مستقیمی به سطوح هوش مصنوعی نداشت**:

| سطح AI | قبل |
|---|---|
| Intent AI (داخل اپ، رجیستری ابزارهای یکپارچه `aiToolRegistry.js`) | هیچ ابزاری برای کارمزد/FeeRouter |
| پل `fbt-mcp` (ایجنت‌های خارجی: Cursor، Claude Code/Desktop، Codex) | هیچ ابزاری برای FeeRouter |
| routeٔ وضعیت در `server/app.js` | وجود نداشت |
| تنها نقطهٔ تماس | drill داخلیِ `policy-contract` در ops-probe (`/api/intents/v1/ops-probe`) — که فقط hashِ bytecode می‌گرفت؛ وضعیت دیپلوی، آدرس‌ها و stateٔ زنده را نمی‌گفت |

## راه‌حل

**یک منبعِ واحد + دو اتصال:**

1. **`server/feeRouterStatus.js` + `GET /api/fees/router-status`** (cache ۳۰ ثانیه):
   - `mode`: `aggregator` | `contract` (همان منطقِ per-chain `src/lib/chains.js`)
   - `routers`: آدرس‌های per-chain از `VITE_FEE_ROUTERS` (legacyِ تک‌آدرس فقط BSC) با info زنجیره و لینک explorer
   - `live`: برای هر زنجیرهٔ تنظیم‌شده، خوانش زندهٔ on-chain — `eth_getCode` + چهار getter عمومی (`dexRouter`, `feeRecipient`, `feeBps`, `owner`) روی فهرست RPCهای عمومیِ همان زنجیره
   - `artifact`: hashِ SHA-256 همان `deployedBytecode`ِ committed که drillِ ops-probe hash می‌کند (یک منبعِ واحد)
   - `audit`: افشای صادقانهٔ «ممیزی حرفه‌ای نشده» — همانی که صفحهٔ Security می‌گوید
2. **Intent AI**: ابزار `feeRouter.status` (read, live) در `aiToolRegistry.js` — به همان route نشسته، پس هرگز از دادهٔ زیرش جدا نمی‌شود.
3. **fbt-mcp**: ابزار `fbt_get_fee_router_status` (public، بدون ورودی) — داخلِ مرزِ never-sign (اسکن اسم/توضیحات probe تأیید می‌کند)؛ جدول README هم به‌روز شد.

## حقیقت‌گویی (قانونِ همین repo)

- زنجیره‌ای که RPCهایش جواب نمی‌دهند → `UNREACHABLE` با خطای هر RPC — نه okٔ خاموش.
- آدرسی که code ندارد → `NOT_DEPLOYED`.
- هیچ دیپلویی تنظیم نباشد → `mode: aggregator` + `note` با مسیرِ بعدی (deploy + `VITE_FEE_ROUTERS`).
- گزارش `ok:true` می‌ماند — زنجیرهٔ دست‌نیافتنی یک **حقیقت** است، نه شکستِ endpoint.

وضعیتِ فعلیِ واقعی (این deployment): FeeRouter در هیچ‌جا دیپلوی نشده → همهٔ سواپ‌ها مسیرِ aggregatorِ کارمزددار را نگه می‌دارند؛ حالا هر دو سطح AI همین را می‌گویند، نه اینکه خاموش جواب ندهند.

## تست

`test/fee-router-status-probe.mjs` — ۲۵ بررسی، در `npm test` ثبت شد:

- گزارش پیش‌فرض: aggregator صادقانه، hash آرتیفکت برابر با آنچه ops-probe hash می‌کند، افشای ممیزی
- گزارش تنظیم‌شده (child proc با envِ import-time): خوانش زنده روی stub RPC — چهار getter decode می‌شوند (feeBps=70، recipient، owner، dexRouter)، `deployedOn` درست
- `NOT_DEPLOYED` و `UNREACHABLE`: دو مسیرِ صداقت
- route واقعی روی `server/app.js` + رجیستری AI + wiringِ MCP (regexِ route literal، همان انضباط `test/mcp/mcp-probe.mjs`)

همسایه‌ها سبز: `fee-mode-perchain-probe` (بازگشتِ §2.1)، `ops-drill-probe`، `npm run test:mcp` (۴۰/۴۰).

## فایل‌ها

| فایل | تغییر |
|---|---|
| `server/feeRouterStatus.js` | **جدید** — گزارش + خوانش‌های زنده |
| `server/app.js` | routeٔ `GET /api/fees/router-status` کنارِ `/api/revenue/readiness` |
| `src/lib/intent-ai/aiToolRegistry.js` | ابزار `feeRouter.status` |
| `mcp/src/tools.mjs` | ابزار `fbt_get_fee_router_status` + ثبت در `TOOLS` |
| `mcp/README.md` | جدول ابزارها |
| `test/fee-router-status-probe.mjs` | **جدید** — ۲۵ بررسی |
| `test/run.mjs` | ثبتِ probe |
