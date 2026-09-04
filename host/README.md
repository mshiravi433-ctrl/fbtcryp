# FBT AI Host — چی روی سرور (VPS) اجرا می‌شه

این پوشه شامل تنظیماتیه که روی یک VPS کوچک (یا سرور خودت) اجرا می‌کنی تا
هوش مصنوعی Intent OS قدرتمندتر بشه. ورسل (frontend + API) از راه دور این
سرویس‌ها را با HTTPS صدا می‌زند.

> **نکته:** مدل محلی (Ollama) دیگر نیازی به VPS ندارد — به‌جایش از
> **Cloudflare Workers AI** (سرورلس، رایگان) استفاده کن که در `server/aiGateway.js`
> به‌عنوان provider `workersai` پیاده‌سازی شده است. پس اینجا فقط **SearXNG**
> (جستجوی وب بدون کلید) باقی می‌ماند که هنوز هاست می‌خواهد. اگر جستجوی وب
> لازم نیست، اصلاً به این پوشه نیازی نداری.

## چرا روی VPS و نه روی Vercel؟
تابع‌های serverless ورسل:
- فرآیند پایدار ندارن (هر درخواست یک بار اجرا می‌شه و بعد می‌میره)،
- GPU ندارن،
- دیسک پایدار برای وزن مدل ندارن.

پس **Ollama** (اجرای مدل محلی) و **SearXNG** (موتور جستجو) باید روی یک هاست
جداگانه باشن.

## روی هاست چی اجرا می‌شه؟
۱. **Ollama** — سرور مدل‌های باز (مثل llama3.1 / mistral). گوش می‌کنه روی
   پورت ۱۱۴۳۴. با `ollama pull llama3.1` مدل دانلود می‌شه.
۲. **SearXNG** — موتور متاجستجوی خصوصی که نتایج چند موتور را جمع می‌کنه و
   JSON برمی‌گرداند. گوش می‌کنه روی پورت ۸۰۸۰.
۳. **Caddy** — reverse proxy با HTTPS خودکار (Let's Encrypt) + محافظت از
   Ollama با توکن. جلوی ترافیک عمومی را می‌گیرد و فقط ورسل را راه می‌دهد.

## معماری
```
            ┌──────────────────────────────────────────┐
            │  VPS (این هاست)                           │
            │  Caddy :443  (HTTPS + Bearer Auth)        │
            │     │                          │           │
            │     ├─ /ollama/*  ─────────► Ollama :11434 │
            │     └─ /searxng/* ─────────► SearXNG :8080 │
            └──────────────────────────────────────────┘
                     ▲                  ▲
                     │ HTTPS            │ HTTPS
            ┌────────┴──────────┐  ┌────┴──────────────┐
            │  Vercel (API)     │  │  مرورگر کاربر       │
            │  server/aiGateway │  │  (فقط JSON اپ)      │
            └───────────────────┘  └─────────────────────┘
```

## پیش‌نیازها
- یک دامنه (مثلاً `ai.yourdomain.com`) که A-record آن به IP این VPS اشاره کند.
  (اگر دامنه نداری: با `cloudflared tunnel` یا `ngrok` یه آدرس HTTPS موقت بساز
  تا اول تست کنی — ولی برای production دامنه واجبه.)
- Docker + docker-compose روی VPS.
- برای Ollama با سرعت خوب: ۱۶GB+ RAM و ترجیحاً یک GPU. بدون GPU هم کار می‌کند
  ولی مدل‌های ۷B روی CPU کندترند (۳–۸ توکن/ثانیه). SearXNG خیلی سبک است
  (۱–۲GB RAM کافیه).

## راه‌اندازی
```bash
# ۱. متغیرهای محیطی را ست کن (توکن Ollama را عوض کن!)
export OLLAMA_TOKEN="$(openssl rand -hex 32)"

# ۲. دامنه را در Caddyfile اصلاح کن (ai.yourdomain.com را عوض کن)

# ۳. اجرا
docker compose up -d

# ۴. مدل Ollama را دانلود کن
docker exec fbt-ollama ollama pull llama3.1

# ۵. تست
curl -H "Authorization: Bearer $OLLAMA_TOKEN" \
  https://ai.yourdomain.com/ollama/api/tags
curl "https://ai.yourdomain.com/searxng/search?q=bitcoin&format=json"
```

## متغیرهایی که در Vercel ست می‌کنی
```
OLLAMA_BASE_URL=https://ai.yourdomain.com/ollama
OLLAMA_TOKEN=<همان توکن بالا>
OLLAMA_MODEL=llama3.1              # اختیاری

SEARXNG_BASE_URL=https://ai.yourdomain.com/searxng
```
کد (`server/aiGateway.js` + `aiToolRegistry.js`) این آدرس‌ها را می‌خواند و
provider `ollama` و ابزار `web_search` را فعال می‌کند.
