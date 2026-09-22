# پل MCP برای FBT Swap — دسترسی ایجنت‌های هوش مصنوعی به FBT (`fbt-mcp`)

> وضعیت: **پیاده‌سازی‌شده و سبز** (`npm run test:mcp` → ۴۰/۴۰)
> پیش‌زمینه: [QUANTDINGER-ASSESSMENT-FA.md](QUANTDINGER-ASSESSMENT-FA.md) — این پل همان **گزینهٔ B / فاز Q4** است.
> راهنمای انگلیسی (برای ابزارهای ایجنتی): [mcp/README.md](../mcp/README.md)

---

## ۱ · چیست و چرا

**MCP (Model Context Protocol)** استاندارد وصل کردن ابزارهای بیرونی به دستیارهای هوش مصنوعی مثل Cursor، Claude Code، Claude Desktop و Codex است. پکیج `mcp/` (نام npm: `fbt-mcp`) یک **سرور MCP بدون هیچ وابستگی** است که قابلیت‌های FBT را به‌صورت ابزار (Tool) در اختیار این دستیارها می‌گذارد:

- هوش مصنوعیِ داخل Cursor می‌تواند بازار را بخواند، سیگنال بگیرد، نقل‌قول (quote) بگیرد و شبیه‌سازی خشک (dry-run) اجرا کند — **روی دادهٔ واقعی FBT**، نه حدس و حافظهٔ مدل.
- در جهت دیگر، الگوی همین پل (سطح ابزار + توکن‌های scope-diff شده) الگوبرداری از سرور `quantdinger-mcp` پروژهٔ QuantDinger است (Apache 2.0) — همان چیزی که در ارزیابی QuantDinger گفتیم «برای قدرتمند کردن هوش مصنوعی» به درد می‌خورد: **ابزار واقعی زیر دست AI**.

## ۲ · مرز سخت امنیتی (اول همین، بعد هر چیز دیگر)

همان «اصول مطلق» محصول:

| | |
|---|---|
| امضا / اجرا / broadcast / تسویه / برداشت | **هرگز** — هیچ ابزاری با این فعل‌ها وجودندارد و نام‌های اجرایی مصنوعی (`sign_swap`, `execute`, `swap_now`…) با یک `POLICY_REFUSAL` ثابت پاسخ می‌گیرند |
| کلید، مnemonic، امضا | هرگز به سرور، پل یا مدل نمی‌رسد؛ امضا فقط در کیف پول کاربر |
| خروجی quote / plan | **مشاوره‌ای (advisory)** — گام بعدی همیشه «نشان بده به کاربر، اگر خواست در FBT امضا کند» |
| کلید API در ترنسکریپت مکالمه | هر payload قبل از رسیدن به مدل از `redactSecrets` رد می‌شود؛ حتی upstream خراب هم نمی‌تواند کلید را لو بدهد |
| ابزارهای public | هیچ هدر Authorization نمی‌فرستند — دقیقاً همان endpointهای ناشناس خود سایت |

این مرز در سه جا تکرار شده چون یک‌جای آن کافی نیست: توضیح هر ابزار، دستور `initialize` (دستورالعمل به مدل)، و `x-fbt-boundary` که `fbt_whoami` و `GET /api/openapi.json` برمی‌گردانند.

## ۳ · چه ابزارهایی دارد؟

Scopeها دقیقاً همان scopeهای کلید توسعه‌دهنده (`server/developerKeys.js`) هستند — و عمداً scopeای به نام sign/execute/withdraw/settle **وجود ندارد** تا چیزی نتواند رشد کند:

| گروه | ابزارها | Scope |
|---|---|---|
| همه‌چیز-خواندنی | `fbt_check_health`, `fbt_get_environments`, `fbt_get_markets`, `fbt_get_prices`, `fbt_get_coin`, `fbt_search_coins`, `fbt_get_trending`, `fbt_get_news`, `fbt_get_signals_pulse`, `fbt_explain_signal`, `fbt_get_network_overview`, `fbt_get_smart_money_overview`, `fbt_get_smart_money_flows`, `fbt_get_intent_capabilities`, `fbt_get_intent_status`, `fbt_browse_listings` | public (بدون کلید) |
| هویت | `fbt_whoami` | هر کلید معتبر |
| نقل‌قول | `fbt_get_cross_chain_quote`, `fbt_get_bridge_quote`, `fbt_get_dln_quote` | `request_quote` |
| شبیه‌سازی و برنامه | `fbt_scan_defi_opportunities`, `fbt_build_defi_plan`, `fbt_build_profit_plan` | `request_simulation` |
| فهرست اکوسیستم | `fbt_list_my_listings`, `fbt_save_listing`, `fbt_listing_action` | `manage_listings` (سرور هم جدا چک می‌کند) |

هر ابزار در `tools/list` فیلد `x-fbt-scope` دارد تا کلاینت قبل از صدا زدن بداند کلیدش چه می‌تواند بکند. صحت scope از **سرور** پرسیده می‌شود (`GET /api/developer/whoami` — همین پل یک endpoint کوچک هم به `server/app.js` اضافه کرد)، نه از ادعای پیکربندی محلی؛ کلید لغوشده بلافاصله fail-closed می‌شود.

## ۴ · راه‌اندازی (۵ دقیقه)

**گام ۱ — کلید بسازید (برای ابزارهای scope-diff شده):**
در خود اپ، صفحهٔ **Developers** → یک پروژه بسازید → کلید با scopeهای دلخواه (`request_quote`, `request_simulation`, `manage_listings`) صادر کنید. رمز فقط یک بار نمایش داده می‌شود (فقط hash آن ذخیره می‌شود).

**گام ۲ — کانفیگ ایجنت:** در تنظیمات MCP کلاینت‌تان (مثلاً `claude_desktop_config.json` یا `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "fbt": {
      "command": "node",
      "args": ["/مسیر/مطلق/fbtcryp/mcp/src/cli.mjs"],
      "env": {
        "FBT_BASE_URL": "https://fbtswap.ir",
        "FBT_API_KEY": "fbt_sandbox_…"
      }
    }
  }
}
```

بدون `FBT_API_KEY` فقط ابزارهای public کار می‌کنند (که برای شروع کافی‌ست).

**گام ۳ — تست:** `npm run test:mcp` (در ریشهٔ ریپو) باید `40/40 passed` بدهد.

### اتصال از راه دور (ترنسپورت http)

```bash
FBT_MCP_TRANSPORT=http FBT_MCP_HOST=127.0.0.1 FBT_MCP_PORT=7801 \
FBT_MCP_AUTH_TOKEN="یک-رمز-تصادفی-بلند-نه-همان-کلید" node mcp/src/cli.mjs
# POST /mcp  ·  GET /healthz
```

- bind روی `0.0.0.0` بدون `FBT_MCP_AUTH_TOKEN` **اجازهٔ استارت نمی‌گیرد** (fail-closed).
- `FBT_MCP_AUTH_TOKEN` نباید با `FBT_API_KEY` یکی باشد (پل هنگام استارت چک می‌کند و بیرون می‌رود) — این دو پای متفاوت اتصال را احراز هویت می‌کنند و باید مستقل بچرخند.
- TLS را reverse proxy خودتان terminate کند؛ برای دسترسی موقت هم `ssh -L` کافی‌ست.

## ۵ · چه چیزی تضمین و تست شده؟

`test/mcp/mcp-probe.mjs` (همان سبک probeهای خود پروژه) — ۴۰ ادعا از جمله:

- **wiring:** هر مسیرِ تبلیغ‌شدهٔ هر ابزار واقعاً در `server/app.js` ثبت است (همان انضباط صفحهٔ Developers: «endpoint مرده تبلیغ نکن»).
- هیچ نام/توضیحی ادعای امضا یا اجرا ندارد؛ نام اجرایی مصنوعی → `POLICY_REFUSAL`.
- رد شدن‌های scope بدون حتی یک تماس شبکه (NEEDS_API_KEY / SCOPE_NOT_ALLOWED).
- دادهٔ credential-شکل که upstream عمداً لو می‌دهد به مدل نمی‌رسد.
- هر دو ترنسپورت زنده تست می‌شوند: قاب‌بندی stdio فقط JSON-RPC، و http با 401 بدون توکن.

همچنین `GET /api/developer/whoami` (endpoint جدید) در `server/openapi.js` مستند شده تا قرارداد ماشین‌خوان (`/api/openapi.json`) هم به‌روز بماند.

## ۶ · قدم‌های بعدی (هنوز انجام نشده)

1. **گزینهٔ A از ارزیابی QuantDinger:** وصل کردن یک نمونهٔ paper-only آن به ماژول `lab` در `server/central/adapters.js` تا `lab.backtest` واقعی شود — این پل، ضلع «عرضهٔ FBT به ایجنت‌ها» است؛ آن یکی ضلع «عرضهٔ ابزار کوانت به AI داخلی».
2. عرضهٔ ابزارهای جدیدِ Intent OS وقتی ساخته شدند (مثلاً «ساخت مانیتور» با scope تازه — باز هم بدون هیچ ابزار اجرایی).
3. ثبت `fbt-mcp` در کاتالوگ اکوسیستم خودمان به‌عنوان یک ایجنتِ certified — با همان فرآیند reviewer.

---

### پیوندها

- کد: [`mcp/`](../mcp) · [`mcp/README.md`](../mcp/README.md) · تست: [`test/mcp/mcp-probe.mjs`](../test/mcp/mcp-probe.mjs)
- قرارداد API: `GET /api/openapi.json` · هویت کلید: `GET /api/developer/whoami`
- [ارزیابی QuantDinger](QUANTDINGER-ASSESSMENT-FA.md) · [معماری Intent OS](INTENT-OS-FA.md) · [مرکز فرماندهی AI](INTENT-AI-COMMAND-CENTER-FA.md)
