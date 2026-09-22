# ارزیابی QuantDinger برای FBT Swap — آیا اضافه شود؟ آیا هوش مصنوعی را قدرتمند می‌کند؟

> موضوع: <https://github.com/QuantDinger-Community/quantdinger>
> تاریخ ارزیابی: ۲۰۲۶-۰۹-۲۲ · وضعیت: **ارزیابی + نقشهٔ یکپارچه‌سازی** (هنوز هیچ کدی ادغام نشده)

---

## ۱ · جمع‌بندی در چند خط (TL;DR)

| پرسش | پاسخ کوتاه |
|---|---|
| می‌شود **کدش را** داخل FBT اضافه کرد؟ | **نه** به‌صورت ادغام/وندور کل پروژه. پشتهٔ کاملاً متفاوت (Python/Flask/Celery/PostgreSQL در برابر Node/Vite/edge ما) و مدل امنیتی متضاد در لایهٔ اجرا (سرور کلید صرافی نگه می‌دارد؛ FBT اصلاً کلید نگه نمی‌دارد). |
| می‌شود **به‌عنوان سرویس کناری** وصلش کرد؟ | **بله.** با یک آداپتر سبک در `server/central/adapters.js` می‌توان یک نمونهٔ self-hosted و **paper-only** آن را به‌عنوان «آزمایشگاه کوانت» مغز Intent OS وصل کرد. |
| برای قدرتمند کردن هوش مصنوعی مفید است؟ | **بله، ولی نه به آن معنا که مدل هوشمندتر شود.** چیزی که کم داریم «ابزار واقعیِ زیر دست AI» است: موتور بک‌تست، پیپر-تریدینگ، و تحقیق چند-ایجنتی. QuantDinger دقیقاً همین‌ها را دارد و از طریق REST و MCP تحویل ایجنت می‌دهد. AI ما (aiGateway + central/toolRouter) با این ابزارها «مسلط‌تر» می‌شود، نه «باهوش‌تر». |
| اگر فقط یک کار بکنیم؟ | ماژول `lab` در `server/central/adapters.js` (الان فقط یک کاتالوگِ placeholder است: `lab.backtest`, `lab.paperTrade`) را به QuantDinger وصل کنیم تا ابزارهای پشت‌تست و معاملهٔ کاغذی **واقعاً** کار کنند — بدون لمس لایهٔ امضای کاربر. |

---

## ۲ · QuantDinger چیست؟

یک **«AI Trading OS» متن‌باز** (Apache 2.0 برای کد بک‌اند، هویت برند جدا و تحت `TRADEMARKS.md`) با این خط لوله:

> تحقیق AI → تولید استراتژی پایتون → بک‌تست سمت سرور → معاملهٔ کاغذی/واقعی → مانیتورینگ

- **پشته:** Python 3.12 · Flask + Gunicorn · Celery · PostgreSQL 18 · دو Redis جدا (کش و jobs) · Docker Compose · (اختیاری) Prometheus/Grafana/Alertmanager
- **فرایندها:** `backend` (HTTP) · `trading-worker` (استراتژی‌های زنده) · `scheduler-worker` · `celery-worker/beat` · `migration`
- **استراتژی:** Strategy API V2 (intent, sizing, risk, backtest, runtime) + اندیکاتورهای پایتونی
- **اجرا:** صرافی‌های کریپتو (Binance، OKX، Bitget، Bybit، Gate، HTX از طریق CCXT) و بروکرهای سنتی (IBKR، Alpaca) — **یعنی سرور کلید API صرافی/بروکر را رمزنگاری‌شده نگه می‌دارد**
- **تحقیق AI:** چند پروایدر (OpenRouter، OpenAI-compatible، Google، DeepSeek، Grok، MiniMax، endpoint سفارشی)
- **سطح‌های اتصال ایجنت (این بخش برای ما جالب است):**
  - **Agent Gateway** زیر `/api/agent/v1` با توکن‌های scope-diff شده، hash شده، rate-limit و audit-log
  - **سرور MCP** (`quantdinger-mcp`) هم به‌صورت stdio محلی و هم HTTP دور — برای وصل کردن Cursor / Claude Code / Codex و ایجنت‌های بیرونی
  - تریدِ ایجنتی **به‌طور پیش‌فرض paper-only** است؛ ترید واقعی چهار قفل پشت هم دارد (scope توکن + `paper_only=false` + `AGENT_LIVE_TRADING_ENABLED=true` + limit/allowlist سمت اپراتور)
- **الگوهای عملیاتی قابل‌وام‌گرفتن:** lease/heartbeat/fencing-token برای رانتایم‌های بلند، لاگ JSON با request-id، قرارداد OpenAPI برای APIهای پرریسک

## ۳ · مقایسه با FBT Swap

| محور | FBT Swap (این ریپو) | QuantDinger |
|---|---|---|
| مأموریت | DEX غیرامانی روی ۱۷ زنجیره + Intent OS | پلتفرم کوانت برای CEX/بروکر (کریپتو، سهام، فارکس) |
| پشته | Node/JS · Vite · Vercel/edge-friendly | Python 3.12 · Flask · Celery · Postgres · Redis×2 · Docker |
| کلید و امضا | **هرگز** — سرور کلید ندارد؛ هر تراکنش را کیف پول کاربر امضا می‌کند | سرور **credentials صرافی/بروکر را نگه می‌دارد** (رمزنگاری‌شده با `CREDENTIAL_ENCRYPTION_KEY`) |
| مغز AI | `aiGateway.js` (۸ پروایدر + فالبک داخلی) + `central/` (planner, toolRouter, riskEngine, policy) + aiConsensus | تحقیق چند-ایجنتی + تولید/اجرای استراتژی پایتونی |
| ابزارهای AI | toolRouter ماژول‌محور؛ ماژول `lab` فعلاً **placeholder** (فقط کاتالوگ what-if / backtest / paper-trading) | **بک‌تست واقعی** + paper/live runtime + Agent Gateway + MCP |
| داده | CoinLore/CoinGecko/DexScreener/Solscan… + قاعدهٔ fail-closed «هیچ عددی اختراع نشود» | دادهٔ بازارِ CCXT/yfinance/AkShare + تاریخچه برای بک‌تست |
| بلوغ ریپو | پروژهٔ بزرگ در حال تولید | ریپوی **آینه‌ای تازه**: ۱ کامیتر، ۴ کامیت، ۳ star، بدون release؛ مسیر نصب CLI در README به `get.quantdinger.invalid` (دامنهٔ placeholder) اشاره دارد و کانال اصلی، بستهٔ دانلودی GitHub Pages است |

**نتیجهٔ مقایسه:** مکمل‌اند، نه جایگزین. QuantDinger دقیقاً «آزمایشگاه کوانت»‌ای است که ماژول `lab` و Opportunity Engine ما کم دارند؛ اما لایهٔ اجرای آن (نگهداری کلید صرافی) با «اصول مطلق امنیت» ما ناسازگار است و نباید هرگز به مسیر امضای کاربر نزدیک شود.

## ۴ · پاسخ دقیق به دو پرسش

### ۴.۱ «می‌شود اضافه کرد؟»

- **ادغام کد داخل این ریپو: نه.** دو محصول با دو پشتهٔ زبانی و دو مدل امنیتی متضاد. وندور کردن یک OS ترید پایتونی داخل مونوریپوی JS یعنی نگهداری دو محصول در یک ریپو، بدون هیچ برد فنی.
- **وصل کردن به‌عنوان سرویس بیرونی: بله، و راه درست همین است.** یک نمونهٔ QuantDinger روی سرور/VPS جدا (Docker Compose خودش) بالا بیاید، **برای همیشه paper-only** بماند، و FBT از طریق Agent Gateway (`/api/agent/v1`) یا MCP به آن وصل شود. کد ما فقط یک آداپتر کوچک در `server/central/adapters.js` لازم دارد (الگوی دقیقاً موجودِ همان ماژول‌های `markets`/`protection`).
- **اقتباس الگو/کد (cherry-pick): بله، با attribution.** Apache 2.0 اجازه می‌دهد؛ هویت برند QuantDinger را نباید استفاده کنیم (`TRADEMARKS.md`).

### ۴.۲ «برای پرقدرت کردن هوش مصنوعی به درد می‌خورد؟»

**بله — اما با تعریف درست «قدرت».** QuantDinger یک مدل زبانی نیست و مدل ما را باهوش‌تر نمی‌کند. آنچه می‌دهد **ابزار واقعیِ زیر دست AI** است و دقیقاً شکاف‌های فعلی ما را پر می‌کند:

1. **بک‌تست واقعی** → امروز Opportunity Engine ما «نرخ‌های پایهٔ تاریخی» را claim می‌کند اما موتور بک‌تست کامل ندارد؛ ماژول `lab` در `central/adapters.js` فقط برمی‌گرداند `modules: ['prediction', 'paper-trading', ...]`. با QuantDinger، ابزار `lab.backtest` **واقعاً** استراتژی را روی دادهٔ تاریخی می‌دود و خروجی (Sharpe، drawdown، نرخ برد) را به‌صورت `dataStatus: 'live'` به مغز برمی‌گرداند.
2. **معاملهٔ کاغذی (paper trading)** → «تمرین بدون ریسک» برای استراتژی‌هایی که AI پیشنهاد می‌کند، پیش از آنکه کاربر با کیف پولش امضا کند. هم برای آموزش کاربر، هم برای سنجش صادقانهٔ confidence.
3. **تحقیق چند-ایجنتی** → یک «صدای کوانت» دیگر ورودی `aiConsensus.js`/سیگنال‌ها؛ وقتی چند ایجنت روی یک نتیجه‌ی بک‌تست‌شده هم‌نظرند، agreement واقعی‌تر است.
4. **الگوی MCP** → هم می‌توانیم ابزارهای QuantDinger را به ایجنت‌های بیرونی بدهیم، هم (الگوبرداری از `mcp_server/` آن‌ها با attribution) قابلیت‌های Intent OS خودمان را به‌صورت MCP Tools دربیاوریم تا Cursor/Claude Code بتوانند FBT را با توکن‌های scope-diff شده و paper-only اداره کنند.
5. **انضباط عملیاتی** → الگوی lease + heartbeat + fencing-token برای watcherها و رانتایم‌های بلند ما (intentWatcher، scheduler) و قرارداد OpenAPI برای سطح‌های پرریسک.

## ۵ · گزینه‌های یکپارچه‌سازی (به ترتیب توصیه)

### گزینهٔ A — «آزمایشگاه کوانت کناری» (توصیه‌شده، ریسک کم) ✅

یک نمونهٔ QuantDinger self-hosted و **paper-only**، وصل‌شده از طریق آداپتر به مغز:

- **نقطهٔ اتصال ۱:** ماژول `lab` در `server/central/adapters.js` — عملیات‌های `backtest`، `paperStatus`، `research` اضافه شود و healthCheck آن واقعاً Agent Gateway را ping بزند (در غیر این صورت capability manager درست مثل بقیهٔ ماژول‌ها DEGRADED/UNAVAILABLE کند — انضباط موجودِ `dataStatus`).
- **نقطهٔ اتصال ۲:** Opportunity Engine / `signalEngine.js` — نتیجهٔ بک‌تست به‌صورت یک منبع شواهدِ «نرخ پایهٔ تاریخیِ اندازه‌گیری‌شده» تزریق شود (با همان قاعدهٔ fail-closed: هیچ عددی اختراع نشود؛ خاموشی سرویس = `dataStatus: 'unavailable'`).
- **نقطهٔ اتصال ۳:** History در `/#/intent` — «عملیات‌های آزمایشگاه» کنار مانیتورها نمایش داده شود.
- **قوانین سخت:**
  - `AGENT_LIVE_TRADING_ENABLED` روی نمونهٔ QuantDinger **هرگز** روشن نشود؛ توکن ایجنت حتماً `paper_only=true` و حداقل scope.
  - هیچ کلید صرافی/بروکری در آن وارد نشود (همان profile کاغذی خودش دادهٔ بازار زنده می‌گیرد).
  - QuantDinger هیچ مسیری به کیف پول کاربر، امضای تراکنش یا broadcast نداشته باشد — مسیر اجرا همچنان «دست کاربر، امضای کیف پول» بماند (اصول مطلق ما).
  - فقط از مسیر شبکهٔ خصوصی/loopback با reverse proxy و توکن؛ پورت‌های Postgres/Redis هرگز عمومی نشوند.

### گزینهٔ B — پل MCP دوطرفه (مکمل A) ✅ — **ضلع «عرضه» انجام شد (۲۰۲۶-۰۹-۲۲)**

- سمت بیرون: ابزارهای FBT (portfolio خواندنی، quote سواپ، مانیتورها) را به‌صورت MCP Tools با توکن‌های hash شده و audit-log عرضه کنیم تا ایجنت‌های بیرونی (Cursor/Claude) FBT را اداره کنند — الگوی `quantdinger-mcp` را reference می‌گیریم. → **انجام شد:** پکیج [`mcp/`](../mcp) (`fbt-mcp`) با ۲۶ ابزار read/quote/simulate، scopeهای `read_network`/`request_quote`/`request_simulation`/`manage_listings`، هویت سمت-سرور با `GET /api/developer/whoami`، پاک‌سازی رمز از خروجی‌ها، و تست `npm run test:mcp` (۴۰/۴۰). مستند: [MCP-BRIDGE-FA.md](MCP-BRIDGE-FA.md) · [mcp/README.md](../mcp/README.md). هیچ ابزار امضایی وجود ندارد و نام‌های اجرایی مصنوعی `POLICY_REFUSAL` می‌گیرند.
- سمت داخل: ابزارهای read-only آزمایشگاه (backtest، research) را به عنوان tool در `central/toolRouter.js` ثبت کنیم. → **هنوز انجام نشده** (وابسته به گزینهٔ A).

### گزینهٔ C — اقتباس الگو و قطعه‌کد (بدون وابستگی زمان اجرا)

از کد Apache 2.0 آن‌ها الگو برداریم: موتور بک‌تست (Pandas/NumPy) به‌عنوان مرجع برای یک ماژول بک‌تست بومی، الگوی token ایجنت، الگوی lease/fencing. با attribution در NOTICE. مناسب وقتی نمی‌خواهیم سرویس پایتونی نگه داریم.

### گزینهٔ D — ادغام کامل / سپردن اجرای ترید به آن ❌

**رد می‌شود:** نگهداری کلید صرافی روی سرور، ترید واقعی CEX و بروکر سنتی — همگی برخلاف مدل غیرامانی FBT و اصول مطلق امنیت («AI هرگز امضا یا broadcast نمی‌کند»، «سرور هرگز کلید نگه نمی‌دارد»). افزون بر آن، دو پشتهٔ زبانی در یک محصول = هزینهٔ نگهداری بی‌تناسب.

## ۶ · نقشهٔ راه پیشنهادی (فازبندی)

| فاز | کار | خروجی قابل‌سنجش |
|---|---|---|
| **Q0 — ارزیابی امنیتی** | بازبینی کد `mcp_server/` و مسیرهای credential در backend روی یک commit پین‌شده؛ اجرای isolated با profile کاغذی | گزارش امنیتی (سبک `*-SECURITY-REVIEW-FA.md` خودمان) |
| **Q1 — آزمایشگاه کناری** | بالا آوردن QuantDinger با Docker Compose روی سرور جدا، paper-only، توکن ایجنت حداقل‌scope | سلامت `/api/health` + یک بک‌تست نمونه از Agent Gateway |
| **Q2 — آداپتر lab** | عملیات‌های `backtest` / `paper` / `research` در `central/adapters.js` + ثبت در `ci/modules.js` با capability واقعی | `lab.backtest` از `/#/intent` واقعاً بک‌تست برمی‌گرداند |
| **Q3 — تغذیهٔ Opportunity Engine** | تزریق نتایج بک‌تست به‌عنوان نرخ پایهٔ تاریخی، با سطح اطمینان و data quality | کارت‌های فرصت، رتبه‌بندی‌شده با شواهد بک‌تست |
| **Q4 — پل MCP (اختیاری)** | عرضهٔ ابزارهای FBT به‌صورت MCP + مصرف ابزارهای آزمایشگاه | ✅ ضلع عرضه: `mcp/` (`fbt-mcp`) + `GET /api/developer/whoami` + `npm run test:mcp` — نگاه کنید به [MCP-BRIDGE-FA.md](MCP-BRIDGE-FA.md) · ⏳ ضلع مصرف: وابسته به Q2 |

## ۷ · ریسک‌ها و هشدارهای صادقانه

1. **بلوغ ریپو:** آینه‌ای با ۴ کامیت، ۱ مشارکت‌کننده، بدون release؛ مسیر نصب CLI در README به دامنهٔ placeholder (`*.invalid`) اشاره دارد. پیش از اعتماد: حتماً کد را ممیزی و commit را pin کنید؛ به بستهٔ باینری از پیش‌ساختهٔ GitHub Pages بدون ممیزی اعتماد نکنید.
2. **ناسازگاری فلسفهٔ اجرا:** مزیت اصلی آن‌ها (ترید واقعی با کلید صرافی روی سرور) دقیقاً همان چیزی است که FBT نباید لمس کند. مرز Q1 تا Q4 فقط «تحقیق، بک‌تست، کاغذ» است.
3. **انطباق/تحریم:** اتصال مستقیم به Binance/OKX/Bybit و بروکرهای سنتی ملاحظات تحریمی و شرایط استفادهٔ آن سرویس‌ها را دارد؛ حتی حالت کاغذی از endpoint همان صرافی‌ها داده می‌گیرد. استقرار واقعی را با مشورت حقوقی/انطباق بررسی کنید. (خودِ پروژهٔ QuantDinger هم مسئولیت انطباق را بر عهدهٔ اپراتور می‌گذارد.)
4. **اطمینان‌پذیری داده:** خروجی بک‌تست «تضمین عملکرد آینده» نیست — همان قاعدهٔ خودمان: هیچ‌چیز «تضمین‌شده» برچسب نخورد؛ confidence و data quality کنار هر عدد بیاید.
5. **پراکندگی مسئولیت:** با افزودن سرویس پایتونی، عملیات روزانه (مهاجرت Postgres، backup، ارتقای نسخه) سنگین‌تر می‌شود؛ برای همین فاز Q1 روی سرور **جدا** پیشنهاد شده تا FBT تولید وابستهٔ آن نشود (fail-closed مثل بقیهٔ ماژول‌ها).

## ۸ · نتیجه‌گیری

- **افزودنِ کد QuantDinger به FBT: نه.**
- **وصل کردن آن به‌عنوان «آزمایشگاه کوانتِ paper-only» در کنار مغز Intent OS: بله — و این بهترین کاری است که می‌تواند «قدرت» سیستم هوش مصنوعی ما را بالا ببرد**، چون ابزارهایی که AI امروز فقط ادعا می‌کند (بک‌تست، شبیه‌سازی، نرخ پایهٔ تاریخی) را واقعی می‌کند.
- مسیر اجرا و امضا همچنان دستِ کاربر و کیف پول غیرامانی او می‌ماند؛ QuantDinger هرگز کلید، امضا یا broadcast نخواهد داشت.

---

### پیوندها

- QuantDinger: <https://github.com/QuantDinger-Community/quantdinger>
- Agent / MCP: <https://github.com/QuantDinger-Community/quantdinger/blob/main/docs/agent/README.md>
- معماری Intent OS ما: [INTENT-OS-FA.md](INTENT-OS-FA.md) · [CENTRAL-INTELLIGENCE-OS-FA.md](CENTRAL-INTELLIGENCE-OS-FA.md) · [INTENT-AI-COMMAND-CENTER-FA.md](INTENT-AI-COMMAND-CENTER-FA.md)
