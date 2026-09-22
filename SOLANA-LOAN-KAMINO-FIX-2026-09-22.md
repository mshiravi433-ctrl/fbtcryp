# چرا وام سولانا به Kamino وصل نمی‌شد — و سه اشکالی که هم‌زمان باعثش بودند (2026-09-22)

> تاریخ: ۲۰۲۶-۰۹-۲۲ · شاخه: `arena/01a0ca5e-fbtcryp` · کامیت پایه: `7eb38f4` (= همان چیزی که روی `fbtswap.ir` لایو است)
> گزارش کاربر: «هنوز مشکل وام سولنا حل نشده … **داده‌های بازار در دسترس نیست KAMINO_SDK_FAILED** … انگار به کامینو وصل نیست درستش کن»
>
> هر حکم این سند **اندازه‌گیری‌شده** است: یا از کرومِ واقعی (Chromium در همین سندباکس)، یا از سرور زندهٔ `fbtswap.ir`، یا از خودِ `node_modules/@kamino-finance/klend-sdk@5.15.4` که همین حالا نصب می‌شود.

---

## ۰. خلاصهٔ یک‌خطی

**سه** اشکال مستقل روی هم افتاده بود و همه‌شان در یک صفحه ظاهر می‌شدند: (۱) باندلِ Kamino در **هر مرورگر واقعی** با `ReferenceError: Buffer is not defined` می‌مُرد و اسکریپت چکِ ما آن را پاس می‌کرد چون Node خودش `Buffer` دارد؛ (۲) همهٔ فراخوانی‌های `KaminoAction.build*Txns` با **امضای نسخهٔ قدیمی‌ترِ SDK** نوشته شده بودند در حالی که `klend-sdk@5` نصب می‌شود، و `getTransactions()` هم دیگر `{ preLendingTxn, … }` برنمی‌گرداند ⇒ لیست تراکنش‌ها **خالی** می‌شد و پنل «موفق» گزارش می‌کرد بدون اینکه چیزی به کیف پول برود؛ (۳) پنل هر تراکنش را با `versioned: true` به کیف پول می‌داد در حالی که v5 تراکنشِ **legacy** می‌سازد. سه‌تای‌شان رفع شد و در کروم واقعی تأیید شد.

---

## ۱. `KAMINO_SDK_FAILED` — بازتولید واقعی در مرورگر

سرور زنده **فایل را درست سرو می‌کند**، پس مشکل سرو نبود:

```
$ curl -sI https://fbtswap.ir/vendor/kamino-klend-sdk.js        (2026-09-22)
HTTP/1.1 200 OK
Content-Type: application/javascript; charset=utf-8
Content-Encoding: gzip
Last-Modified: Tue, 22 Sep 2026 18:28:16 GMT            ← آخرین دیپلوی
$ curl -s https://fbtswap.ir/api/version
{"version":"1.39.0","commit":"7eb38f401582460bff4075d50c0d05ec7704714d","ref":"main"}
```

پس بایت‌ها **می‌رسیدند** و باندل **اجرا نمی‌شد**. در کروم واقعی (Chromium از npm، سرو شده از روی HTTP، دقیقاً مثل خود اپ):

```
probe fetch → { ok: true, status: 200, type: 'application/javascript', bytes: 5807885 }
dynamic import → {
  "ok": false,
  "name": "ReferenceError",
  "message": "Buffer is not defined",
  "stack": "at /vendor/kamino-klend-sdk.js?v=2:13:362835 …"
}
```

**ریشه:** گرافِ `dist` پکیجِ klend در بدنهٔ ماژول‌هایش سراغ گلوبالِ **Node** یعنی `Buffer` می‌رود. `scripts/check-kamino-bundle.mjs` این را نمی‌دید چون **خودش زیر Node اجرا می‌شد** و Node همیشه `Buffer` دارد — یعنی چکِ سبز، باندلِ شکسته را امضا می‌کرد. تعمیر «`Fraction.MAX_F_BN`» در کامیت‌های قبلی هم از همین جنس بود: سیمپتومِ مرورگر، تست‌شده در Node.

**رفع:**

- `scripts/vendor-kamino.mjs` یک **Buffer shim** را به‌صورت `banner` **به ابتدای فایل** می‌چسباند (نه `import` داخل ماژول ورودی — چون importها hoist می‌شوند و انتساب دیر اجرا می‌شد). shim فقط وقتی نصب می‌کند که صفحه خودش Buffer نداشته باشد.
- `scripts/check-kamino-bundle.mjs` حالا گلوبال‌های Node را **قبل از import حذف** می‌کند (`Buffer`, `process.versions`, `require`) و وجود `Buffer` را بعد از لود **تأیید** می‌کند. با این چک، باندلِ معیوب در **بیلد** رد می‌شود، نه روی گوشی کاربر.
- `scripts/check-kamino-browser.mjs` (جدید، `npm run check:kamino-browser`) همان بایت‌ها را در **مرورگر واقعی** لود می‌کند — همان چیزی که این باگ را پیدا کرد.
- `KAMINO_VENDOR_REV` از `2` به `3` رفت تا دستگاه‌هایی که باندلِ خراب را در کش دارند، نسخهٔ سالم را بگیرند؛ و `public/sw.js` از `fbt-shell-v20` به `fbt-shell-v21` (قرارداد خودِ مخزن: هر اصلاحی که داخل باندل شِل است باید کشِ شِل را عوض کند).

**تأیید بعد از رفع (همان کروم، همان مسیر):**

```
✓ kamino bundle starts in a real browser: {"KaminoMarket":"function","KaminoAction":"function",
  "VanillaObligation":"function","PROGRAM_ID":"KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"}
```

---

## ۲. امضاهای `KaminoAction` با SDK نصب‌شده نمی‌خواند (و نتیجه‌اش «موفقیتِ خالی» بود)

از `node_modules/@kamino-finance/klend-sdk@5.15.4/dist/classes/action.d.ts` (یعنی قراردادِ نسخه‌ای که `^5.0.0` نصب می‌کند):

```
buildDepositTxns(market, amount, mint, owner, obligation, useV2Ixs, scopeRefreshConfig,
                 extraComputeBudget?, includeAtaIxs?, requestElevationGroup?, …)
buildRepayTxns  (market, amount, mint, owner, obligation, useV2Ixs, scopeRefreshConfig,
                 currentSlot, payer?, extraComputeBudget?, includeAtaIxs?, …)
getTransactions(): Promise<Transaction>      ← یک تراکنش، نه { preLendingTxn, lendingTxn, postLendingTxn }
```

و آنچه کد می‌فرستاد:

| اکشن | فراخوانی قبلی | مشکل |
|---|---|---|
| supply | `(…, 0, true, false, false)` | `scopeRefreshConfig = true` (باید object باشد) · `includeAtaIxs = false` ⇒ **سپردهٔ SOL امکان‌پذیر نیست** (ATA wSOL ساخته/بسته نمی‌شود) |
| borrow | همان | به‌علاوه compute-budget غیرفعال |
| withdraw | همان | `includeAtaIxs = false` |
| repay | `(…, slot, undefined, 0, true, false, false)` | `useV2Ixs = slot` (عددِ truthy!) · `currentSlot = 0` · `payer = true` (جای PublicKey) |

و در انتها:

```js
txs = await built.getTransactions();
transactions: [
  { id: 'preparing', transaction: encode(txs.preLendingTxn) },   // undefined
  { id: action,      transaction: encode(txs.lendingTxn) },      // undefined
  { id: 'cleanup',   transaction: encode(txs.postLendingTxn) }   // undefined
].filter((entry) => entry.transaction)                           // ⇒ []
```

یعنی حتی اگر SDK لود می‌شد، پنل یک لیست خالی را «موفق» می‌دید، حلقهٔ امضا **صفر بار** اجرا می‌شد و هیچ‌وقت پنجرهٔ کیف پول باز نمی‌شد. (این دقیقاً همان «انگار به کامینو وصل نیست» است.)

**رفع:** `buildKaminoActionTransactions()` (جدید و قابل تست با SDK جعلی) با ترتیبِ v5، `includeAtaIxs: true`، `scopeRefreshConfig: undefined` و `extraComputeBudget: 1_000_000`؛ `collectKaminoTransactions()` هر دو شکلِ خروجی را می‌فهمد و **اگر لیست خالی بماند** `KAMINO_TX_BUILD_EMPTY` می‌دهد (هرگز «موفقیتِ خالی»)؛ و تستِ `test/solana-lending-precision.test.js` **نامِ پارامترهای `.d.ts` نصب‌شده** را می‌خواند تا ارتقاءِ بعدیِ SDK در همان تست بشکند، نه روی گوشی کاربر.

---

## ۳. `versioned: true` روی تراکنشِ legacy

klend-sdk v5 تراکنشِ **legacy** می‌سازد (`new web3.js Transaction(...)`). لایهٔ کیف پول، `versioned: true` را به **version 0** و `false` را به `'legacy'` نگاشت می‌کند؛ دادنِ بایت‌های legacy به `VersionedTransaction.deserialize()` **قبل از هر تأییدی** خطا می‌دهد. حالا خودِ تراکنش حاملِ نسخهٔ خودش است (`tx.versioned`) و پنل همان را به کیف پول می‌دهد.

---

## ۴. دیگر پاک‌سازی‌ها در همین مسیر

- **`priceUsd` همیشه `null` بود**: `stats.priceUSD` در `ReserveDataType` نسخهٔ v5 **وجود ندارد** ⇒ چکِ «مبلغ وام از سقف دلاری بیشتر است؟» بی‌اثر بود. حالا `reserve.getOracleMarketPrice()` خوانده می‌شود.
- **APY با `slot = null`**: `totalSupplyAPY(null)` عددِ بی‌معنا می‌داد؛ حالا اگر slot معلوم نباشد «—» نمایش داده می‌شود.
- **`KAMINO_SDK_FAILED` دیگر جملهٔ پیش‌فرضِ همه‌چیز نیست.** لودر حالا با شواهد تشخیص می‌دهد:
  `KAMINO_SDK_MISSING` (۴۰۴، یا پاسخِ HTML: fallback د SPA، پورتالِ کپتیو، دیپلویِ کهنه) ·
  `KAMINO_SDK_TRUNCATED` (کمتر از بایت‌های مانیفست — دانلودِ نیمه‌کاره، **قابل تکرار**) ·
  `KAMINO_SDK_INIT_FAILED` (بایت‌ها درست، ماژول در شروع خطا داد — با متنِ خودِ خطا) ·
  `KAMINO_SDK_UNAVAILABLE` (هیچ‌چیز در دسترس نبود).
  هر سه کد جدید در **۱۲ زبان** ترجمه شدند (`scripts/add-loan-error-l10n.mjs`).
- **مانیفست یکپارچگی**: `public/vendor/kamino-klend-sdk.manifest.json` (bytes + sha256 + rev) کنار باندل ساخته می‌شود؛ کلاینت طول را مقایسه می‌کند، یک‌بار با `cache: 'reload'` دوباره می‌گیرد و اگر باز هم کوتاه بود `TRUNCATED` می‌گوید (به‌جای «اپ را به‌روزرسانی کن»).
- **مسیر دومِ اجرا**: اگر `import()` مستقیم به دلیلِ انتقال شکست بخورد (MIME اشتباه، بدنهٔ HTML، قطعِ گذرا) اما بایت‌ها سالم باشند، همان متن از طریق **Blob URL** به‌عنوان ماژول اجرا می‌شود. در همین سندباکس عملاً یک بار نجات داد و در کنسول `[kamino] KAMINO_SDK_RECOVERED` ثبت شد.
- هر شکست یک خط `[kamino] <CODE> {…}` در کنسول می‌گذارد (url/status/content-type/bytes/cause) تا گزارشِ کاربر قابل تشخیص باشد.

---

## ۵. آنچه اندازه‌گیری شد (و آنچه نشد)

| بررسی | نتیجه |
|---|---|
| کروم واقعی، باندل قبل از رفع | ✗ `ReferenceError: Buffer is not defined` |
| کروم واقعی، باندل بعد از رفع | ✓ ماژول بالا می‌آید، هر ۴ اکشن و `PROGRAM_ID` موجود |
| `npm run check:kamino` (شبیه‌سازِ مرورگر، بدون Buffer) | ✓ |
| `npm run check:kamino-browser` | ✓ |
| کروم واقعی + ماژولِ خودِ اپ روی سرورِ dev | ماژول لود می‌شود؛ `readSolanaLendingMarket` فقط با **`RPC_ERROR`** شکست می‌خورد (شبکهٔ این سندباکس به RPC سولانا دسترسی ندارد — انتظارِ درست) و مسیر ساختِ تراکنش آرگومان‌های v5 را می‌فرستد |
| `npx vitest run test/solana-lending-precision.test.js` | ✓ ۳۴ تست (شامل گاردِ امضای `.d.ts`) |
| `npm run test:lending` | ✓ ۳۸/۳۸ |
| `npm run build` (کل اپ) | ✓ ۵۳ ثانیه؛ `dist/vendor/kamino-klend-sdk.js` + مانیفست داخل dist |
| سرورِ پروداکشن، سروِ فایل | ✓ `Content-Type: text/javascript`, `Content-Length: 5835944` |
| فایلِ ناموجود زیر `/vendor/` | ۲۰۰ + `text/html` (fallback) ⇒ حالا `KAMINO_SDK_MISSING` با توضیحِ «HTML پاسخ داد»، نه `FAILED` |

**آنچه در این سندباکس قابل اندازه‌گیری نبود:** امضای واقعی روی مین‌نت سولانا — چون خروجیِ شبکه در این محیط بسته است (`api.mainnet-beta.solana.com` و `solana-rpc.publicnode.com` هر دو unreachable). آن بخش باید روی گوشیِ خودت با RPC واقعی امتحان شود؛ ولی دیگر خطِ `KAMINO_SDK_FAILED` نباید برگردد و اگر برگشت، دقیقاً می‌گوید کدام‌یک از چهار حالت است.

## ۶. دربارهٔ مستندِ Flash Loan / Multiply

مستندِ `kamino.com/docs/build/borrow/multiply/flash-loans` بررسی شد. مسیرِ همین اپ «سپرده/وام/برداشت/بازپرداخت» است که با `KaminoMarket` + `KaminoAction` انجام می‌شود؛ `getFlashLoanInstructions` هم در همان SDK هست، ولی فلش‌لوآن بدون یک استراتژیِ اتمی (مثلاً multiply) معنایی ندارد و به همین دلیل در این تغییرات یک قابلیتِ جدید ساخته **نشد** — فقط چیزی که خراب بود درست شد. اگر Multiply را می‌خواهی، آن یک تسکِ جداگانه است (ساختِ وامِ فلش + فراخوانی پروتکلِ مقصد + بازپرداخت در همان تراکنش، با تستِ محاسباتیِ سلامتِ پوزیشن قبل از امضا).
