# صفحهٔ وام، تب سولانا — چرا رلهٔ خودِ برنامه «پاسخی که نتوانستیم استفاده کنیم» می‌داد

تاریخ: ۲۰۲۶/۰۹/۲۳ (گزارش دوم همان روز) · شل سرویس‌ورکر به `fbt-shell-v24` رسید
(بدون این تغییر، دستگاهی که اپ را باز کرده همان کدِ قدیم را اجرا می‌کند و خطا
بایت‌به‌بایت تکرار می‌شود).

گزارش کاربر:

> در صفحه وام تب سولنا هنوز … «یک یا چند گره سولانا درخواست را رد کردند (۴۰۳ …)» ·
> «RPC سولانا یا بازار Kamino خوانده نشد. تا زمان دریافت دادهٔ زنده هیچ تراکنشی ارسال
> نمی‌شود.» · در فهرست گره‌ها: **«رلهٔ خود برنامه — آن گره پاسخ داد، ولی پاسخی که
> نتوانستیم استفاده کنیم.»**

آن خطِ آخر، خودِ اعترافِ باگ است: رلهٔ خودمان **جواب داده بود** و پاسخش
**قابل استفاده نبود**. این سند می‌گوید چرا و چه شد.

---

## ۰. خلاصهٔ یک‌خطی

`KaminoMarket.load()` بازار را با `getAccountInfo` می‌خواند (رله این را سرو
می‌کرد) و بعد **ذخایر** را با `connection.getMultipleAccountsInfo(...)` می‌خواند
(klend-sdk، `dist/classes/market.js:239`) — و `@solana/web3.js` برای آن متد، روی
سیم **`getMultipleAccounts`** می‌فرستد، نه `getMultipleAccountsInfo`. allowlist رله
از **سمت JS** نوشته شده بود: `getMultipleAccountsInfo` را داشت و
`getMultipleAccounts` را نه. پس رله دومین فراخوانی هر بارگذاری بازار را با
`-32601 … is not relayed` رد می‌کرد، بازار نیمه‌خوان می‌ماند و صفحه — درست —
هیچ تراکنشی نمی‌ساخت. جملهٔ روی صفحه هم «گره پاسخ داد ولی…» بود، چون یک
`-32601` در هیچ‌کدام از واژه‌های موجود نمی‌گنجید.

---

## ۱. اندازه‌گیری، نه حدس

هر سه حکم زیر با کدِ واقعیِ همین ریپو و `@solana/web3.js@1.98.4` +
`@kamino-finance/klend-sdk@5.15.4` گرفته شده‌اند:

**(الف) web3.js چه چیزی روی سیم می‌فرستد؟**

```
$ grep -o "_rpcRequest('[a-zA-Z]*'" node_modules/@solana/web3.js/lib/index.cjs.js | sort -u
…
_rpcRequest('getMultipleAccounts'
…

$ grep -n "getMultipleAccounts'" node_modules/@solana/web3.js/lib/index.cjs.js
6392:    const unsafeRes = await this._rpcRequest('getMultipleAccounts', args);
6410:    const unsafeRes = await this._rpcRequest('getMultipleAccounts', args);
```

یعنی `connection.getMultipleAccountsInfo(pks)` و `getMultipleParsedAccounts(pks)`
هر دو متدِ `getMultipleAccounts` را می‌فرستند. (همین‌طور
`getParsedTokenAccountsByOwner` → `getTokenAccountsByOwner`.)

**(ب) SDK کجا این را می‌خواهد؟**

```
$ grep -rno "connection\.[a-zA-Z]*" node_modules/@kamino-finance/klend-sdk/dist/ | sed 's/.*connection\.//' | sort | uniq -c | sort -rn
     14 getSlot
     14 getProgramAccounts
      9 getAccountInfo
      5 getMultipleAccountsInfo      ← چهارمیِ پرمصرف
      5 getLatestBlockhash
      3 getAddressLookupTable        ← (خودش از getAccountInfo رد می‌شود)
      2 getTokenAccountBalance
      2 getMinimumBalanceForRentExemption
      1 simulateTransaction
      1 sendTransaction
      1 getParsedProgramAccounts

$ sed -n 239,241p node_modules/@kamino-finance/klend-sdk/dist/classes/market.js
        const reserveAccounts = await this.connection.getMultipleAccountsInfo(addresses, 'processed');
```

`loadReserves()` همان چیزی است که بعد از خودِ بازار صدا زده می‌شود؛ بدون آن نه
APY ای هست، نه ظرفیت، نه قیمت.

**(ج) بازتولید واقعی روی همان رلهٔ همین ریپو** (هیچ شبکه‌ای لازم نیست؛ fetch داخل
پروسه به هندلرِ خودِ رله وصل می‌شود):

```
$ node /tmp/repro2.mjs
getAccountInfo (KaminoMarket.load): THREW → … StructError …   (شکلِ استابِ تست)
getMultipleAccountsInfo (loadReserves): THREW → failed to get info for accounts 7u3He…
   : method getMultipleAccounts is not relayed: this endpoint is read-only …
wire methods asked of the relay: getAccountInfo(HTTP 200), getMultipleAccounts(HTTP 200 -32601)
```

و همان اسکریپت بعد از اصلاح:

```
$ node /tmp/repro2.mjs
getMultipleAccountsInfo (loadReserves): SERVED
wire methods asked of the relay: getAccountInfo(HTTP 200), getMultipleAccounts(HTTP 200)
```

> — «StructError»ِ خط اول از استابِ تست است (`value: []`)، نه از اپ: `getAccountInfo`
> یک رشته/`null` برمی‌گرداند و استاب شکلِ دسته‌ای می‌داد. چیزی که سنجیده می‌شود
> متدهای روی سیم است.

---

## ۲. چرا این باگ این‌قدر گران تمام شد؟

چون **دقیقاً شبیه خرابیِ شبکه دیده می‌شد.** فهرست رویدادها:

1. allowlist از نام‌های JS نوشته شده بود، پس یک متدِ بی‌صاحب (`getMultipleAccountsInfo`)
   داشت و متدِ واقعی را نداشت؛
2. رله متدِ ناشناس را با `-32601` و متنِ «is not relayed» جواب می‌دهد؛
3. `classifyNodeFailure` (src/lib/solanaLending.js) status-first است: `-32601`
   نه ۴۰۱/۴۰۳/۴۵۱ است، نه ۴۲۹، نه خطای شبکه ⇒ `RPC_UNAVAILABLE`؛
4. `loan.error.RPC_UNAVAILABLE` در fa می‌گوید «آن گره پاسخ داد، ولی پاسخی که
   نتوانستیم استفاده کنیم» و در کنارش «RPC خودت را در تنظیمات ← شبکه‌ها وارد کن».

یعنی کاربرِ روی مسیری که همهٔ نودهای عمومی هم ردش می‌کنند، توصیه می‌گرفت که
یک RPC دیگر وارد کند — برای باگی که در همین ریپو بود. این بدترین حالتِ یک
پیامِ خطا است: **قابل باور، و اشتباه.**

---

## ۳. اصلاح‌ها

### ۳.۱ رله، متدِ روی سیم را سرو می‌کند — و نامِ JS را هم می‌فهمد

`server/solanaRpcRelay.js`:

* `getMultipleAccounts` به allowlist اضافه شد (weight ۳، کش ۲.۵ ثانیه — مثل بقیهٔ
  خواندن‌های بازار، چون حساب‌های Kamino سراسری‌اند).
* `RELAY_METHOD_ALIASES` + `resolveRelayMethod()`: نام‌های سطحِ JS
  (`getMultipleAccountsInfo`, `getParsedTokenAccountsByOwner`) به متدِ واقعی
  نگاشت می‌شوند تا **سرو شوند، نه رد**. اشتباهِ امروز از جنسِ «نام را از سمت
  اشتباهِ API برداشتن» بود؛ حالا هر دو املا به یک متد، یک کلیدِ کش، یک حافظهٔ
  رد به‌ازای متد و یک بودجه می‌رسند.
* ردِ allowlist حالا **ماشین‌خوان** هم هست:
  `error.data = { relay: true, stage: 'allowlist', method }` — تا کلاینت بتواند
  «این درخواست را رلهٔ خودمان عبور نمی‌دهد» را از «یک گره خراب شد» جدا کند،
  بدون خواندن انگلیسی.

### ۳.۲ گره‌ای که «پاسخ بی‌استفاده» می‌دهد، دیگر warm نیست

`src/lib/solanaRpc.js`:

* کلاسِ تازهٔ `UNUSABLE` در نقشهٔ cooldown (۱۰ دقیقه — کوتاه‌تر از ردِ ۳۰ دقیقه‌ای،
  بلندتر از ۴۲۹ سه‌دقیقه‌ای): پاسخی که ۲۰۰ است ولی JSON-RPC نیست (صفحهٔ WAF، پورتال
  کپتیو، پروکسیِ بدقلق). تا پیش از این، چنین گره‌ای **warm** می‌ماند و هر refresh
  دوباره اول از او می‌پرسید.
* `solanaPublicsBlocked()` حالا «هیچ‌کدام از عمومی‌ها نمی‌توانند» را از ترکیبِ
  BLOCKED **و** UNUSABLE می‌فهمد؛ و همان حکم در راهنمای persisted هم نوشته می‌شود
  (۶ ساعت)، چون گزارش امروز یک ترکیبِ مخلوط بود: سه ۴۰۳، یک ۴۲۹، یک خطای اتصال و
  دو پاسخِ بی‌استفاده — و قاعدهٔ قبلی («همه BLOCKED») از آن هیچ نمی‌آموخت، پس هر بار
  لود، هر ۹ نامزد یکی‌یکی امتحان می‌شدند.
* محدودیت‌های قبلی دست‌نخورده: **۴۲۹** حکمِ مسیر شبکه نیست (انتظار درمانش است) و
  **خطای شبکه‌ای** هم نیست (Wi-Fi مرده دلیلش نمی‌شود).

### ۳.۳ صفحه دیگر باگِ خودش را گردنِ شبکه نمی‌اندازد

`src/lib/solanaLending.js` + ۱۲ فایل زبان:

* `RELAY_METHOD_REFUSAL_RE` و پرچمِ `relayRefusedMethod` در `lendingRpcFailure`: ردیفی
  که **خودِ رله** متد را رد کرده (کد `-32601` یا متنِ refusal) حالا دلیلِ
  `RELAY_METHOD_UNAVAILABLE` می‌گیرد و اگر همهٔ تلاش‌ها از همان جنس باشند، **کدِ
  سرصفحه** هم همان است.
* جملهٔ ترجمه‌شده در همهٔ زبان‌ها اضافه شد (`loan.error.RELAY_METHOD_UNAVAILABLE`)،
  با همین معنی: «رلهٔ خودِ برنامه این درخواست را عبور نمی‌دهد — این نقصِ همین نسخهٔ
  اپ است، نه خرابی گره یا شبکه. چیزی ارسال نشد؛ اپ را به‌روزرسانی کن.»
* `noteRefusedCandidates()` حالا پاسخ‌های بی‌استفاده را هم به لایهٔ RPC یاد می‌دهد
  (به‌عنوان `UNUSABLE`)، و حکمِ «همهٔ عمومی‌ها بی‌فایده‌اند» را از ترکیبِ رد +
  بی‌استفاده می‌سازد — خطاهای شبکه‌ای همچنان نه.

---

## ۴. تست‌هایی که این را نگه می‌دارند

* `test/loan-solana-relay.test.js`
  * فهرستِ «خواندن‌های موردنیاز وام» از نام‌های JS به **نام‌های روی سیم** تغییر کرد
    (`getMultipleAccounts`, `getTokenAccountsByOwner`) — همان فهرستی که باگ را
    پنهان کرده بود.
  * سه تستِ تازه: (۱) یک `Connection` **واقعیِ** web3.js با fetch تزریقی، دقیقاً
    `connection.getMultipleAccountsInfo(...)` را صدا می‌زند و باید سرو شود، و متدی
    که به بالادست می‌رسد باید `getMultipleAccounts` باشد؛ (۲) فراخوانی با نامِ
    JS سطحِ بالا هم سرو می‌شود؛ (۳) ردِ واقعیِ رله `data.relay === true` دارد.
* `test/loan-solana-relay-client.test.js`
  * ردیفِ رله با `-32601` → `RELAY_METHOD_UNAVAILABLE` (و سرصفحه هم، وقتی تنها
    تلاش همان است)؛
  * همان متن از یک نودِ عمومی این برچسب را **نمی‌گیرد** (حرفِ خودمان را در دهانِ
    نود نمی‌گذاریم);
  * پاسخِ ۲۰۰ غیرِ JSON-RPC → `UNUSABLE` می‌شود و آن میزبان دیگر warm نیست؛
  * فهرستِ کاملِ پاسخ‌های بی‌استفاده = همان حکمی که فهرستِ کاملِ ردها دارد ⇒ رله
    جلوی صف می‌آید (و ۴۲۹ همچنان این حکم را نمی‌سازد).
* `test/loan-errors-l10n.test.js` — کدِ `RELAY_METHOD_UNAVAILABLE` به فهرستِ
  کدهای سطحِ وام اضافه شد، پس باید در en/fa/ar جمله داشته باشد و تستمتنِ خام
  چاپ نشود.

---

## ۵. چه چیزی عوض **نشد**

* رله همچنان **فقط-خواندنی** است: `sendTransaction` در allowlist نیست و هیچ‌وقت
  نمی‌شود؛ کیف پول امضا می‌کند **و** می‌فرستد (§۳۰) و `getSolanaRpcUrl()` — آدرسی که
  تراکنش از آن پخش می‌شود — هیچ‌وقت URL رله را برنمی‌گرداند.
* رله همچنان **پروکسیِ باز نیست**: پارامتر upstream وجود ندارد؛ caller متد
  انتخاب می‌کند، نه میزبان.
* اولین گزینه همچنان **RPC خودِ کاربر** است (تنظیمات ← شبکه‌ها) و بعد نودهای عمومی و
  بعد رله — رله فقط وقتی جلو می‌آید که این مسیرِ شبکه نشان داده باشد عمومی‌ها
  نمی‌توانند.

---

## ۶. برای اپراتور

* اگر ترافیک بالاست، `SOLANA_RPC_URL` را ست کنید (یک نودِ اختصاصی): رله آن را **اول**
  امتحان می‌کند و بقیهٔ فهرست fallback می‌ماند.
* وضعیتِ رله بدون هیچ رازی اینجا دیده می‌شود: `GET /api/solana/rpc/status`
  (بالادست‌ها با اعتبار پاک‌شده، حافظهٔ ردها به‌ازای host و host|method، بودجه‌ها،
  آمار کش).
* اگر ردیفی با کد `RELAY_METHOD_UNAVAILABLE` دیدید، یعنی SDK متدی می‌خواهد که
  allowlist ندارد: نامِ متد در `error.data.method` می‌آید و اصلاحش یک خط در
  `RELAY_METHODS` است — **نه** تغییرِ RPC کاربر.

---

## ۷. جمع‌بندی

| قبل | بعد |
| --- | --- |
| allowlist با نام‌های JS (`getMultipleAccountsInfo`) | نام‌های روی سیم + جدولِ alias برای نام‌های JS |
| دومین فراخوانی هر بارگذاری بازار `-32601` می‌گرفت | `getMultipleAccounts` سرو می‌شود (تستِ SDK-محور) |
| ردیفِ رله: «پاسخ داد ولی استفاده نشد» + توصیهٔ RPC دیگر | کد و جملهٔ `RELAY_METHOD_UNAVAILABLE`: «نقصِ همین نسخهٔ اپ» |
| گرهی که ۲۰۰ بی‌استفاده می‌دهد، هر بار اول امتحان می‌شد | `UNUSABLE` ثبت می‌شود؛ ترکیبِ رد+بی‌استفاده رله را جلو می‌آورد |
