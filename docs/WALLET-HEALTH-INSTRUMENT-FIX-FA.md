> ⚠️ **بایگانی‌شده (۲۰۲۶-۰۹-۱۷):** این سند یک راندِ رفعِ اشکالِ قدیمی را
> توصیف می‌کند. مسیرهایی که در آن آمده (`src/lib/wcWallets.js`،
> `src/lib/emailSocialWallet.js`، `src/lib/walletHealth.js` و همراهانشان)
> دیگر وجود ندارند: کلِ ستکِ والت‌کانکت در `src/lib/wc/` از نو نوشته شده
> است. **تحلیل و علتِ این گزارش همچنان معتبر است؛ فقط محلِ کد عوض شده.**
> معماریٔ فعلی: [`WALLET-CONNECT-STACK-FA.md`](./WALLET-CONNECT-STACK-FA.md)

---

# گزارش کاربر، ابزار را لو داد: «email=false» و «رله ❌» هر دو اشتباهِ خودِ دستگاه بودند

> گزارش کاربر (پنلِ «بررسی سلامت اتصال» روی گوشیِ خودش، `fbtswap.ir`):
> `✅ تنظیمات پروژه (Reown) — email=false socials=0` · `✅ دامنه‌های مجاز — 3` ·
> `❌ رلهٔ WalletConnect — SOCKET_ERROR` · `✅ صفحهٔ کیف پول سوشال — OK` و در JSON:
> `"relay": {"ok": false, "error": "SOCKET_ERROR"}`.

این سند همان گزارش را با **سورسِ نصب‌شدهٔ خودِ SDK** و **پاسخِ زندهٔ API** می‌سنجد.
نتیجه دو چیز است و هیچ‌کدام «حدس» نیست:

1. `email=false socials=0` **غلطِ خودِ ابزار** بود: ماژول، شکلِ payload را اشتباه
   می‌خواند. پاسخِ زندهٔ همین پروژه ایمیل و **۷ سوشال** را روشن نشان می‌دهد.
2. `❌ رله SOCKET_ERROR` **فقط یک میزبان از دو میزبانِ رله** را پرسیده بود — و
   میزبانِ پرسیده‌شده (`relay.walletconnect.com`) نه پیش‌فرضِ SDK است و نه آن
   میزبانی که خودِ Reown برای «رله بسته است» معرفی می‌کند (پیش‌فرضِ نصب‌شده:
   `relay.walletconnect.org`). پس آن ❌ نمی‌تواند ادعای «رله بسته است» را بسازد.

---

## ۱) خطای اول: شکلِ payload — همیشه `email=false socials=0` چاپ می‌شد

### آنچه ماژول انجام می‌داد

`src/lib/walletHealth.js` پیش از این اصلاح:

```js
const socialLogin = payload?.features?.social_login;   // ← روی آرایه، undefined است
```

### آنچه API واقعاً برمی‌گرداند (خوانده‌شده در همین بررسی)

```
GET https://api.web3modal.org/appkit/v1/config?projectId=8e36eccabebf5a4567f4e974fafd6b20&st=appkit&sv=html-appkit-1.8.19
→ {"features":[
     {"id":"multi_wallet","isEnabled":false,"config":null},
     {"id":"activity","isEnabled":true,"config":null},
     {"id":"swap","isEnabled":true,"config":null},
     {"id":"event_tracking","isEnabled":true,"config":null},
     {"id":"onramp","isEnabled":true,"config":null},
     {"id":"reown_authentication","isEnabled":true,"config":[]},
     {"id":"social_login","isEnabled":true,
      "config":["email","google","x","discord","farcaster","github","apple","facebook"]},
     {"id":"fund_from_exchange","isEnabled":false,"config":null},
     {"id":"headless","isEnabled":false,"config":null},
     {"id":"payments","isEnabled":true,"config":[]},
     {"id":"reown_branding","isEnabled":false,"config":null}]}
```

`features` **آرایه** است. روی آرایه، `.social_login` همیشه `undefined` است ⇒
`email:false`، `socials:[]`، `raw:null` — دقیقاً همان چیزی که در گزارش کاربر
دیده می‌شود، با یک ✅ کنارش (چون HTTP 200 بود). بدترین حالتِ ممکن: **عددِ غلطِ
مطمئن**، دربارهٔ تنها چیزی که داشبورد کنترلش می‌کند.

### خودِ SDK چطور می‌خواند (مرجعِ نهایی)

`@reown/appkit@1.8.19` → `dist/esm/src/utils/ConfigUtil.js`:

```js
getApiConfig(id, apiProjectConfig) { return apiProjectConfig?.find((f) => f.id === id); }
...
email:  { apiFeatureName: 'social_login',
          processApi: (apiConfig) => Boolean(apiConfig.isEnabled) && apiConfig.config.includes('email') }
socials:{ apiFeatureName: 'social_login',
          processApi: (apiConfig) => Boolean(apiConfig.isEnabled) && apiConfig.config.length > 0
              ? apiConfig.config.filter((s) => s !== 'email') : false }
```

و `@reown/appkit-controllers@1.8.19` → `ApiController.fetchProjectConfig()`:

```js
const response = await api.get({ path: '/appkit/v1/config', params: ApiController._getSdkProperties() });
return response.features;   // ← همان آرایه
```

یعنی قاعدهٔ درست، **`.find(f => f.id === 'social_login')`** است و ایمیل فقط وقتی
`true` است که `isEnabled` باشد و در `config` عیناً `'email'` باشد — همان چیزی که
حالا در `summarizeProjectConfig()` پیاده شده است، با تحملِ شکلِ قدیمیِ
شیء-نقشه‌ای برای payloadهای قدیمی‌تر، و با گزارشِ `shape` (که اگر روزی payload
عوض شود، `shape:"none"` می‌شود نه «ایمیل خاموش است»).

---

## ۲) خطای دوم: «رله» یک میزبان نیست

`probeRelay` فقط `wss://relay.walletconnect.com` را می‌پرسید و پنل همان نتیجه را
زیر برچسبِ «رلهٔ WalletConnect» چاپ می‌کرد. سه سندِ اندازه‌گیری‌شده در همین نسخهٔ
نصب‌شده:

| شاهد | مضمون |
|---|---|
| `@walletconnect/core@2.25.0` · `dist/types/constants/relayer.d.ts` | `RELAYER_DEFAULT_RELAY_URL = "wss://relay.walletconnect.org"` — تنها رشتهٔ `wss://` در آن باندل، و `Core` هرجا `relayUrl` نگیرد به همین برمی‌گردد (`relayUrl = t.relayUrl \|\| pt`) |
| docs.reown.com/advanced/faq | «The default relay endpoint is blocked. How can I get around this? … set `relayUrl` to `wss://relay.walletconnect.org`» |
| `grep -r relayUrl` روی `@reown/appkit@1.8.19` + `appkit-controllers` + `adapter-wagmi` | **صفر** مورد — سطحِ AppKit هیچ تنظیمِ رلهٔ مستقل ندارد؛ تنها رله‌ای که این اپ می‌تواند انتخاب کند همان است که به `EthereumProvider.init({ relayUrl })` می‌دهد |

یعنی `.com` میزبانِ **تاریخی** است، نه پیش‌فرض؛ و اپ ما آن را **اول** می‌گذاشت و
۸ ثانیه فیوزِ اولش را روی همان override خرج می‌کرد، بعد به میزبانی می‌رسید که
خودِ SDK با آن شروع می‌کند. روی شبکه‌ای که فقط `.com` فیلتر شده باشد، همان ۸
ثانیه تمام فاصلهٔ بین «وصل شد» و «رله در دسترس نیست» است.

### چرا این هم‌معنیِ «رله باز است» نیست

هیچ‌کدام از این دو میزبان از این ورک‌اسپیس قابلِ اندازه‌گیری نیست (خروجیِ شبکهٔ
اینجا به میزبان‌های `walletconnect`/`web3modal` بسته است: `curl` →
`OpenSSL SSL_connect: SSL_ERROR_SYSCALL`). پس حرف نهایی را **پنل روی گوشیِ
کاربر** می‌زند — با این تفاوت که حالا هر دو میزبان، هر دو در (سوکت + درِ HTTPS)
و زمانِ هر کدام اندازه‌گیری می‌شود و حکم از یک قاعدهٔ خالص می‌آید:

| حکم | شرطِ اندازه‌گیری‌شده | معنی |
|---|---|---|
| `OPEN` | حداقل یک میزبان سوکت را باز کرد | جفت‌سازی مسیر دارد (و نامِ همان میزبان و ms چاپ می‌شود) |
| `WS_REFUSED` | هیچ سوکتی باز نشد، ولی HTTPSِ یک میزبان رسید | میزبان زنده است؛ **فقط ارتقای WebSocket** بسته می‌شود (DPI) |
| `UNREACHABLE` | نه سوکت، نه HTTPS | نام/مسیر فیلتر است (DNS/SNI) |
| `TIMEOUT` | همهٔ سوکت‌ها بی‌صدا تا پایانِ مهلت | شبکه بسته‌ها را می‌بلعد |
| `NO_WEBSOCKET` / `NO_MEASUREMENT` | چیزی برای اندازه‌گیری نبود | این مرورگر WebSocket ندارد / نشانی‌ای نبود |

به‌علاوه `probeRelay` حالا `ms` و `closeCode` را هم برمی‌گرداند: شکستِ ۴۰ میلی‌ثانیه‌ای
(رد شدن) با مهلتِ تمام‌شده (فیلتر) یکی نیست، و کدِ `1006` مرورگر دیگر به‌عنوان
«میزبان تو را رد کرد» جا زده نمی‌شود — کدِ واقعیِ رله (مثل `3000`) هم قابلِ تشخیص
است.

---

## ۳) چه چیزی عوض شد

| فایل | تغییر |
|---|---|
| `src/lib/walletHealth.js` | `summarizeProjectConfig()` با شکلِ آرایه‌ای (قاعدهٔ `.find` خودِ SDK) + تحملِ شکلِ قدیمی + گزارشِ `shape` و `config` (لیستِ پس‌گرفته‌شده = `null`، نه لیستِ خالی). سوکت‌های **همهٔ** میزبان‌های رله + درِ HTTPS هر کدام + `ms`/`closeCode` + `relayVerdict()` به‌عنوان تابعِ خالص |
| `src/lib/wcTimeout.js` | `WC_RELAY_URLS` با ترتیبِ خودِ SDK: `relay.walletconnect.org` اوّل، `relay.walletconnect.com` دوم (با ارجاع به `RELAYER_DEFAULT_RELAY_URL` و FAQ) |
| `src/context/WalletContext.jsx` | توضیحاتِ failover هم‌راستا شد؛ منطقِ `initWcProvider()` دست‌نخورده (همان فیوزِ ۸s برای هر ورودی جز آخری) |
| `src/components/WalletHealthPanel.jsx` | یک ردیف برای **هر** میزبان با حکم و زمانش + جملهٔ حکم + «مسیرهایی که به رله نیاز ندارند» + لیستِ socials در ردیفِ پروژه |
| `src/i18n/locales/{fa,en,ar}.json` | ۱۱ رشتهٔ تازه برای حالت‌های رله (بقیهٔ localeها طبقِ قاعدهٔ همیشگی به انگلیسی fallback می‌کنند) |
| `test/wallet-health-probe.mjs` | ۳۶ → **۶۲** ادعا: payloadِ زندهٔ API به‌عنوان fixture، شکلِ قدیمی، لیستِ پس‌گرفته‌شده، هر پنج حکمِ رله، `ms`/`closeCode`/`1006` و `3000`، درِ HTTPS، و «یک میزبانِ بسته + یک میزبانِ باز = OPEN» |
| `test/wc-timeout-probe.mjs` | ادعای ترتیبِ رله با پیش‌فرضِ SDK هم‌راستا شد |

**اجرای واقعی (همین ورک‌اسپیس):**

```
✓ walletconnect-wiring: 18/18   ✓ wc-connect: 77/77     ✓ wc-timeout: 24/24
✓ wc-storage: 7/7               ✓ wc-chain: 12/12       ✓ wc-wallets: 37/37
✓ wc-deeplink: 37/37            ✓ wc-uri-hygiene: 32/32 ✓ wc-pairing-surface: 64/64
✓ wallet-health: 62/62          ✓ email-social: 49/49
                 ────────────────────────────────────────
                 419 assertion, 0 failure
```

---

## ۴) کاربرِ روی همان شبکه چه باید بکند

۱. پنل را **دوباره اجرا کن** (نسخهٔ جدید، پس از رسیدنِ bundle تازه). حالا ردیفِ
   پروژه باید `email=true socials=7 (google, x, discord, farcaster, github, apple,
   facebook)` بدهد. اگر همان `email=false socials=0` را دیدی، یعنی bundle عوض
   نشده (سرویس‌ورکر/cache) — نه اینکه داشبورد خاموش است.

۲. ردیفِ **هر میزبانِ رله** را بخوان:
   - اگر یکی ✅ شد ⇒ جفت‌سازی WalletConnect مسیر دارد؛ همان تلاش را تکرار کن.
   - اگر حکم `WS_REFUSED` بود ⇒ شبکه/VPN فقط ارتقای WebSocket را می‌بندد؛
     VPN را روی **کلِ دستگاه** روشن کن (کیف پول هم باید به رله برسد، نه فقط
     مرورگر) یا از مسیرهای بدونِ رله استفاده کن.
   - اگر حکم `UNREACHABLE`/`TIMEOUT` بود ⇒ همین: مسیرهای بدونِ رله.

۳. سه مسیری که **به رله نیاز ندارند** (هر سه روی همان شبکه کار می‌کنند):
   ساخت/ورودِ **کیف پول درون‌برنامه‌ای** (نون‌کاستودیال، کلید روی دستگاه)،
   اتصال **کیف پول تزریق‌شده** از مرورگرِ داخلیِ خودِ کیف پول
   (Trust/MetaMask ← تب Browser)، و **ورود با ایمیل/سوشال** (ناقلی که این SDK
   استفاده می‌کند فریمِ امنِ `secure.walletconnect.org` است؛ در
   `@reown/appkit-wallet@1.8.19` هیچ ارجاعی به رله وجود ندارد و تنها آدرسِ
   بیرونی‌اش همان فریم است — که در گزارشِ کاربر ✅ بود).

> مرزِ صادقانه: کدِ خودِ فریمِ امن از این ریپو قابلِ خواندن نیست، پس «این مسیر
> مستقل از رله است» بر پایهٔ همان چیزی است که این SDK نشان می‌دهد (نبودِ هر
> ارجاعِ رله در ماژولِ کیفِ درون‌سایتی + ✅ بودنِ فریم در گزارش) — نه بر پایهٔ
> یک فرض.
