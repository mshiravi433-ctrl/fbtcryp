# ممیزی پیش از لانچ — ۱۸ اوت ۲۰۲۶

پوشش: چهار بخش گزارش‌شده + ممیزی کامل کد و باندل. همه فیکس‌ها با `npm test`
قفل شده‌اند (تمام سوئیت‌ها سبز) و `npm run build` بدون خطا.

---

## ۱) پیام جعلی «Security risk / flagged unsafe» — ریشه پیدا و فیکس شد

**تشخیص (مبتنی بر کد SDK نصب‌شده، نه حدس):**

- `@walletconnect/sign-client@2.23.10` متادیتا را در constructor روی **خودش**
  ذخیره می‌کند (`this.metadata = populateAppMetadata(...)`) و engine پروپوزال
  را از `this.client.metadata` (یعنی SignClient) می‌سازد.
- تابع قبلی `repairSignClientMetadata()` مقدار را روی `wc.signer.client.metadata`
  اصلاح می‌کرد؛ اما `wc.signer.client` همان Core است که **اصلاً پراپرتی
  metadata ندارد**. نتیجه: repair همیشه no-op بود و `populateAppMetadata()`
  (که هر جا هاست فرق کند url را با `window.location.origin` جایگزین می‌کند)
  مقدار `https://localhost` را داخل APK در پروپوزال می‌گذاشت.
- کیف پول (Trust/MetaMask) dappای می‌دید که خودش را localhost معرفی کرده —
  و اسکنر امنیتی کیف پول دقیقاً همین را «domain flagged unsafe by multiple
  security providers» نمایش می‌دهد. یعنی پیام از Verify API نبود؛ از اسکنر
  امنیتی کیف پول روی هویت نادرست dapp بود.

**بررسی‌های جانبی انجام‌شده:**

- `fbtswap.ir` و `lawpoetics.ir` در `eth-phishing-detect` متامسک (config.json
  اصلی) و جستجوی عمومی **flag نیستند** — مشکل از لیست سیاه نبود.
- Verify API v2 در Core از `window.location.origin` برای ثبت attestation
  استفاده می‌کند (قابل تغییر از کد نیست — سمت داشبورد است، بخش ۲).
- `redirect.native` فقط داخل APK/اندروید و هم‌خوان با `custom_url_scheme`
  مانیفست؛ `redirect.universal` و آیکن همیشه `fbtswap.ir` — هیچ‌کدام عامل
  پرچم نبودند (مستند در `docs/WALLETCONNECT-VERIFY-FA.md`).

**فیکس کد:** `src/context/WalletContext.jsx:420` — repair حالا اول
`wc.signer.metadata` را درست می‌کند (شاخه Core به‌عنوان دفاع آینده)، نتیجه را
verify و در event trace ثبت می‌کند (`metadata_repaired`/`metadata_repair_failed`).
تست: `test/wc-connect-probe.mjs` بخش ۱۴.

**بدون projectId؟** غیرممکن است: `EthereumProvider.init()` بدون projectId رد
می‌کند (مدرک مسیریابی رله است). شناسه ذاتاً عمومی است؛ چیز امنیتیِ واقعی ثبت
دامنه در dashboard است که فقط owner دارد → مراحل دقیق در
`docs/WALLETCONNECT-VERIFY-FA.md` (Verify API + هشدار خالی ماندن Allowed
Domains به‌خاطر origin=localhost در APK + مسیرهای اعتراض MetaMask/Trust/PhishFort).

---

## ۲) موجودی توکن‌ها با Trust نمایش داده نمی‌شد (مثلاً بیت‌کوین)

**ریشه (تأییدشده از سورس SDK):** `EthereumProvider.connect()` با
`setChainIds(this.rpc.chains.length ? this.rpc.chains : accounts)` تمام می‌شود
و `rpc.chains` همان لیست required ماست — یعنی `DEFAULT_CHAIN=56` — **فارغ از
شبکه‌ای که کیف پول واقعاً روی آن است**. Trust روی اتریوم، chainId=56 گزارش
می‌داد؛ تب کیف پول به BSC فیلتر می‌شد و WBTC (توکن اتریوم) «غیب» می‌شد.
لایه مقصر: نه getBalances، نه priceMap، نه dust-filter — بلکه `chainId` دروغین
SDK که به `selectedChain` فیلتر لیست دارایی می‌رسید.

**فیکس:** `src/lib/wcChain.js` (جدید) + `WalletContext.jsx:640` و `:829` —
زنجیره واقعی از `session.namespaces.eip155.accounts` (چیزی که کیف پول واقعاً
امضا کرده) خوانده می‌شود؛ هم state ری‌اکت و هم `wc.chainId` داخلی SDK
(که هر RPC را با `eip155:<id>` تگ می‌کند) با آن هم‌راستا می‌شوند، وگرنه
تراکنش روی زنجیره درست هم با namespace اشتباه به کیف پول می‌رسید.
`chainChanged` هم در برابر املای hex/CAIP-2 مقاوم شد (`parseChainId`).

**UX تکمیلی:** `Wallet.jsx:320` — وقتی شبکه فعال خالی است ولی شبکه‌های دیگر
دارایی دارند، دکمه «نمایش همه شبکه‌ها» زیر لیست ظاهر می‌شود (کلید i18n
`wallet.showAllNetworks` در ۱۲ زبان).

**پاسخ سوالات فرعی:** بله، مشکل فقط Wallet tab نبود — Swap/Bridge/Send هم
`wallet.chainId` را می‌خوانند و همگی با همان chainId دروغین کار می‌کردند؛ فیکس
مشترک همه را درست می‌کند. BTCB روی BSC، WBTC روی اتریوم/آربیتروم و cbBTC روی
Base همگی در `TOKENS` هستند — چیزی کم نبود.

تست دستی روی دستگاه واقعی برای شما مانده (من دستگاه ندارم): Trust روی BNB
Chain و روی اتریوم، هر دو حالت، Wallet tab → همه شبکه‌ها.

---

## ۳) بعد از کیف پول درون‌اپی، WalletConnect مرده بود

**سناریو بازتولیدشده در کد (بدون دستگاه):**

1. ساخت vault → `attachCreatedLocal` — **هیچ ref مربوط به WC را پاک نمی‌کرد**؛
   اگر قبلش سشن WC وجود داشت، لیسنرها و `wcRef` زنده می‌ماندند و رویدادهایش
   می‌توانست UI را بین حساب WC و vault جابه‌جا کند (state-leak واقعی).
2. دکمه Disconnect → `disconnect()` refها را صفر می‌کرد ولی **آثار storage
   را پاک نمی‌کرد**: `wc@2:client:*//session`، `WALLETCONNECT_DEEPLINK_CHOICE`
   و `@appkit/recent_wallet(s)` می‌ماندند. `EthereumProvider.init()` بعدی سشن
   قدیمی را resurrect می‌کرد، AppKit جواب `isConnected()=true` می‌داد و
   `modal.open()` را رد می‌کرد («فقط وقتی connected نباشی باز می‌شود» — تأیید
   از سورس `@reown/appkit@1.8.19`)، و دیپ‌لینک موبایل ذخیره‌شده کاربر را با
   یک pairing مرده به MetaMask می‌فرستاد — دقیقاً همان ارور گزارش‌شده.
3. `forgetLocalWallet()` فقط signerRef/mode/address/locked/nativeBalance را
   پاک می‌کرد — هیچ‌کدام از موارد بالا را نه.

**فیکس:**

- `src/lib/wcStorage.js` (جدید): `purgeWcStorage()` — حذف دقیق کلیدهای
  connection (session/pairing/keychain `wc@2:*`، دیپ‌لینک چویس، recent
  wallets، connection_status) بدون دست زدن به کش‌های بی‌خطر.
- `WalletContext.jsx:913` `releaseWc()` — تیرآداون با تایم‌اوتِ کران‌دار
  (رله مرده هیچ‌وقت UI را نگه نمی‌دارد).
- `disconnect()` و `forgetLocalWallet()` (که حالا به disconnect دیلیگیت
  می‌کند) هر دو storage را پاک می‌کنند؛ `connectWalletConnect` هم **قبل از
  init** purge می‌کند و اگر init سشنی resurrect کرد آن را می‌اندازد — اتصال
  بعدی «دقیقاً مثل بار اول» است.
- ورود به حالت local (`attachCreatedLocal`/`unlockLocal`) سشن WC زنده را
  release می‌کند (فقط بعد از موفقیت، تا BAD_PASSWORD چیزی را خراب نکند).
- Race سرد: روی mount اگر vault باشد، restore اجرا نمی‌شود و commit guard
  داخل restore هم اجازه overwrite کیف پول تازه‌اتچ‌شده را نمی‌دهد.

تست: `test/wc-storage-probe.mjs` (runtime)، `test/wc-connect-probe.mjs`
بخش‌های ۱۴–۱۷.

---

## ۴) مستندات: رشد در ساختار فعلی، بدون صفحه جدید

- **Docs (SECTIONS در Docs.jsx):** ۵ بخش جدید `intentos`، `smartwallet`،
  `portfolio`، `p2p`، `orders` + برچسب سطح `تازه‌کار/متوسط/حرفه‌ای` روی هر ۱۴
  بخش، با ترتیب پیشنهادی security→start→swap→farm→signals/trade→حرفه‌ای.
  همه رشته‌ها در **هر ۱۲ زبان** ترجمه شد (۱۰ زبان که docs نداشتند حالا کامل
  دارند — نه فقط en/fa).
- **FAQ آفلاین (faqLocal.js):** ۲۲ سوال جدید با کلیدواژه و جواب en/fa/ar
  (پوشش IntentOS, SmartWallet, Portfolio, P2P, Orders, Signals, Bridge, Buy,
  Farm/Earn, Rewards/Leaderboard/Shop, Derivatives/Ostium/Perp/Invest/Predict,
  NFT, Solana, Stocks, Market/News/CoinDetail, About/Audit/Developers,
  Support/Legal/Contact, Settings/امنیت + سه سوال WalletConnect شامل پاسخ
  «بدون projectId نمی‌شود») + تیتر `help.q.*` برای هر ۲۲ در هر ۱۲ زبان.
- **ران‌بوک مالک:** `docs/WALLETCONNECT-VERIFY-FA.md` — قدم‌های dashboard که
  از کد قابل انجام نیست.
- تست wiring بخش ۱۰۷: کامل بودن ۱۲ زبان، سطوح، رشد FAQ، وجود ران‌بوک.

---

## باگ‌هایی که تو گزارش نداده بودی (پیداشده در ممیزی)

1. **Send/Swap/Bridge روی زنجیره اشتباه با WC** — معلول همان chainId دروغین
   بخش ۲؛ قبل از فیکس، تراکنش ساخته‌شده برای زنجیره واقعی با namespace
   `eip155:56` به کیف پول می‌رسید و رد می‌شد. (`WalletContext.jsx:640` و
   چک `wallet.chainId !== fromChain` در Bridge که قبلاً همیشه 56 بود.)
2. **Race سردِ mount: vault و سشن WC هم‌زمان** — restore آسنکرون، vault
   اتصال‌شده sync را overwrite می‌کرد و حساب WC روی کیف پول درون‌اپی فلش
   می‌زد. (`WalletContext.jsx` mount effect + commit guard `:812`)
3. **State-leak دو اتصاله:** ساخت/آنلاک vault وقتی WC متصل بود، لیسنرهای WC
   را زنده نگه می‌داشت. (`releaseWc()` در attachCreatedLocal/unlockLocal)
4. **لیبل اشتباه provider:** `Wallet.jsx` از `wallet.provider` (که هرگز در
   context وجود نداشت) می‌خواند؛ کیف پول‌های EIP-6963 مثل Rainbow اشتباه
   MetaMask/Trust لیبل می‌خوردند. → `injectedInfo` در context + `:255`.
5. **NaN در chainChanged:** `Number('eip155:1')` در بعضی والت‌ها NaN می‌شد و
   خواندن موجودی را بی‌صدا می‌شکست. → `parseChainId` (`wcChain.js`).

## تست و باندل

- سوئیت‌های جدید: `WalletConnect storage hygiene`، `WalletConnect chain
  resolution` (runtime) + بخش‌های ۱۴–۱۷ رفتار + wiring ۱۰۷ (docs/FAQ/i18n).
- باندل: `dist/assets` از ۶.۴MB به ۶.۵MB (~۱۰۰KB = متن مستندات/FAQ در ۱۲ زبان).
  هیچ chunk سنگین جدیدی اضافه نشده؛ هیچ وابستگی npm جدیدی هم نه.

## چک‌لیست دستی که فقط با دستگاه واقعی انجام می‌شود

- [ ] APK: Trust + MetaMask + Rainbow، با وای‌فای/همراه‌اول/ایرانسل/VPN،
      kill و resume وسط pairing، رد approve، بستن مودال با backdrop،
      دیس‌کانکت→reconnect پشت‌سرهم ×۳
- [ ] هویت dapp در صفحه تأیید کیف پول = «FBT Swap» و «https://fbtswap.ir»
- [ ] Trust روی BNB Chain و روی اتریوم: موجودی WBTC/cbBTC/BTCB در Wallet tab
- [ ] ساخت vault → دیس‌کانکت → Connect → مودال QR باید بیاید (نه باز شدن
      مستقیم MetaMask)
- [ ] تم روشن/تاریک در Docs (بج‌های سطح جدید) و Wallet (دکمه همه شبکه‌ها)
- [ ] Lighthouse روی /swap و /market و /signals؛ مقایسه با commit قبلی
- [ ] PWA نصب‌شده iOS و Telegram WebView: چرخه connect/disconnect کامل
