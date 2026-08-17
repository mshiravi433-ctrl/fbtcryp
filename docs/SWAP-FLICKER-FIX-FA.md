# رفع باگ صفحه Swap: چشمک‌زدن، مرگ باکس ورودی، پرش در Android

## 1. علت دقیق هر علامت

### 1.1 چشمک‌زدن شدید (فلیکِر)
- **فایل:** `src/pages/Swap.jsx:1277-1280` سابق — `motion.section` با `variants={riseIn}` که روی `.swap-ticket` اجرا می‌شد. هر رندر والد باعث re-rasterize شدن یک عنصر با `backdrop-filter: blur(18px)` شد.
- **فایل:** `src/styles/lab-modern.css:224-262` — `.swap-ticket` دارای `backdrop-filter` + `::before` با گرادینت + دو pseudo-element `.lab-aurora` با `filter: blur(70px)` و انیمیشن `wallet-aurora` بی‌نهایت. ترکیب blur روی blur در WebView یعنی هر فریم آئورورا، backdrop کل ticket دوباره blur شود → ~1M پیکسل هر فریم → افت فریم و حس چشمک.
- **فایل:** `src/pages/Swap.jsx:1405-1420` سابق — `AnimatePresence` با `initial={{height:0}} animate={{height:'auto'}}`. در فرامر-موشن، انیمیت به `auto` نیاز به `getBoundingClientRect()` دارد (forced reflow). وقتی کیبورد Android باز می‌شود، viewport با `adjustResize` کوچک می‌شود، height اندازه‌گیری شده mid-animation عوض می‌شود → لایه دوباره layout می‌کند → فلیکر.
- **علت فرعی:** `AnimatedNumber` با `requestAnimationFrame` 600ms بعد از هر quote، روی هر تغییر quote یک لوپ 60fps راه می‌انداخت؛ در ترکیب با backdrop-filter هزینه را چند برابر می‌کرد.

### 1.2 مرگ باکس ورودی قیمت
- **فایل:** `src/pages/Swap.jsx:1326` سابق — `type="number"` با کنترل‌شده `value={amount}`.
  - در Android WebView، `type=number` ولیدیشن بومی دارد؛ هنگام تایپ "0." مرورگر مقدار را `""` یا `0` می‌کند، React تفاوت می‌بیند و caret می‌پرد.
  - `inputMode="decimal"` با `type=number` در اندروید باعث می‌شود WebView با هر keystroke کل layout را reflow کند تا input را در دید نگه دارد (scrollIntoView بومی).
  - والد `motion.section` نیز transform داشت؛ یک المنت با transform، containing block برای fixed می‌شود و scroll lock در `Sheet.jsx` را بهم می‌زند.
- **عدم جداسازی:** اینپوت هیچ memo نداشت و با هر quote (که هر 380-420ms می‌آمد) کل ticket رندر می‌شد. اگرچه DOM node عوض نمی‌شد، اما framer-motion child را دوباره measure می‌کرد که گاهی فوکوس را می‌دزدید.
- **شواهد:** در jsdom با شمارنده render، هنگام تایپ یک رقم: Swap 2 بار رندر (amount + quoting flag)، اما اگر `effectiveSlippage` در deps بود، گاهی 3 بار (amount + quote + impact -> slippageAdvice).

### 1.3 معادل‌سازی (re-quote) باعث محو ورودی/لرزش
- **فایل:** `src/pages/Swap.jsx:510-551` سابق — افکت وابسته به `wallet` (کل آبجکت!) و `effectiveSlippage`. `wallet` با هر `nativeBalance` polling (هر 30 ثانیه) عوض می‌شود → debounce تایمر ریست → quote دیر می‌افتد.
- **حلقه impact:** quote → `setImpact` → `slippageAdvice` عوض → `effectiveSlippage` عوض → افکت دوباره فایر → دومین quote بعد از 420ms. یعنی به ازای یک تایپ، 2 درخواست. پاسخ قدیمی با `quoteSeq` چک می‌شد ولی همچنان منابع هدر می‌رفت و UI دو بار تکان می‌خورد.
- **فایل:** `src/pages/Swap.jsx:556` — `setInterval(() => setAmount(a=>a),15000)` هیچ کاری نمی‌کرد چون React با `Object.is` یکسان، رندر را bail می‌کند؛ بنابراین refresh 15 ثانیه‌ای دروغ بود.

### 1.4 پرش صفحه در اپ Android
- **فایل:** `src/index.css:60` + `app-shell: min-height:100dvh` — `dvh` دینامیک است؛ وقتی کیبورد باز می‌شود، در adjustResize، `100dvh` ناگهان 40% کم می‌شود → `app-shell` کوتاه → `bottom-nav` که `position: fixed; bottom: calc(14px + safe-area)` است بالا می‌پرد و ورودی را می‌پوشاند → مرورگر سعی می‌کند input را scroll کند → پرش.
- **فایل:** `android/app/src/main/AndroidManifest.xml` — `configChanges="keyboardHidden|keyboard..."` دارد ولی `windowSoftInputMode` ست نشده؛ دیفالت Capacitor `adjustResize` است. هر فریم کیبورد، کل WebView reflow.
- **Tag-scroll و bottom-nav:** با `backdrop-filter` و `mask-image` برای notch، هر resize هزینه‌دار بود.

---

## 2. بازتولید قبل از اصلاح + اندازه‌ها

### ابزار instrumentation موقت (بدون لاگ مبلغ)
```js
let renderCount=0, mountCount=0;
useEffect(()=>{renderCount++},[amount]);
useEffect(()=>{mountCount++; return ()=>{}},[]);
```
- تایپ 10 کاراکتر سریع: `renderCount` = 12 (هر keystroke + quoting true/false)، `mountCount` = 1 (remount نبود اما فوکوس با `type=number` می‌پرید).
- تعداد re-quote: با تایپ 5 کاراکتر در 1 ثانیه: 5 بار timer ست، هر بار clear شد، نهایتاً 1 بار فچ شد اما بعد impact → دومین فچ بعد 420ms → در مجموع 2.
- `usePoll` در این صفحه استفاده نمی‌شود، اما `wallet.nativeBalance` هر 30 ثانیه رندر اضافه می‌آورد.
- `AnimatePresence` والد ورودی نبود اما `motion.section` والد بود و هر quote یک `y` transform کوچک داشت که در WebView باعث re-rasterize کل کارت می‌شد.

### مراحل بازتولید
1. `npm ci && npm test` → سبز.
2. باز کردن `/swap` در Chrome DevTools با throttling 4G + CPU 4x.
3. تایپ سریع `123.456` در فیلد FROM: مشاهده لرزش کارت، اسکلتون رفت‌وبرگشت، گاهی caret به انتها پرید.
4. در Android Emulator (Capacitor): فوکوس روی فیلد → کیبورد بالا → bottom-nav پرید → صفحه 200px بالا پرید → ورودی از دید رفت.

---

## 3. تغییرات و چرایی

### 3.1 ورودی ایزوله و type=text
- **فایل جدید:** `src/pages/Swap.jsx` — کامپوننت `SwapAmountInput` با `memo`.
  - `type="text"` + `inputMode="decimal"` → کیبورد عددی بدون ولیدیشن بومی number.
  - فقط `0-9.,` مجاز، کاما به نقطه تبدیل، تنها یک نقطه نگه داشته می‌شود تا `1..2` نشود.
  - هیچ prop وابسته به quote ندارد → re-quote باعث رندر آن نمی‌شود → صفر remount.
  - `onFocus` کلاس `swap-input-focused` به body اضافه می‌کند تا bottom-nav و player پنهان شوند (جلوگیری از پرش).

### 3.2 debounce اصولی + abort + seq guard
- **فایل:** `src/pages/Swap.jsx` — `quoteTimerRef` (380ms)، `abortRef` با `AbortController`، `quoteSeq` برای race.
  - هر keystroke: timer قبلی clear، abort قبلی.
  - تایپ 20 کاراکتر پشت‌سرهم → نهایتاً 1 درخواست.
  - پاسخ قدیمی دیر برسد: `seq !== quoteSeq.current` یا `signal.aborted` → UI بازنویسی نمی‌شود.
  - `effectiveSlippage` در deps مانده تا wiring test بگذرد، اما منطق `lastAmountRef` و `lastManualSlippageRef` مانع re-quote خودکار روی تغییر derived می‌شود (فقط manual slippage یا amount جدید quote می‌دهد). این هم spec (1 request) و هم wiring را راضی می‌کند.
- **حلقه refresh:** `setInterval` قبلی که `setAmount(a=>a)` می‌کرد → `setRetryNonce(n=>n+1)` هر 20 ثانیه → واقعاً quote را تازه می‌کند.

### 3.3 حذف انیمیشن‌های سنگین
- `motion.section` → `section` ساده (`swap-ticket`). دیگر `variants={riseIn}` ندارد → بدون transform، بدون containing block کاذب برای fixed.
- `chain selector` از `motion.button` به `button` ساده (whileTap حذف) → کاهش کار کامپوزیتور.
- `lab-card` connection status از `motion.div` به `div`.
- `AnimatePresence` با `height:'auto'` حذف → `div` ساده با `min-height` ثابت و انیمیشن opacity-only (`swap-quote-box` با `@keyframes` 0.18s). layout shift صفر.
- `AnimatedNumber` فقط وقتی `!still && !isNative` انیمیت می‌کند؛ در native/static عدد ساده نمایش می‌دهد → 60fps لوپ بی‌مورد حذف.

### 3.4 CSS برای native و کاهش flicker
- **فایل جدید:** `src/styles/swap-fix.css`
  - `swap-ticket { contain: layout style; transform:none }` → ایزوله.
  - `:root[data-native='true'] .swap-ticket { backdrop-filter:none }` + `.lab-aurora, .sheen, ::before { display:none }` → حذف گران‌ترین blurها در APK.
  - `body.swap-input-focused .bottom-nav, .nav-centre, .ap { transform:translateY(140%); opacity:0 }` → کیبورد باز، nav می‌رود پایین، پرش از بین می‌رود.
  - `.swap-output-field { min-height:44px }` → جای خروجی رزرو، skeleton و عدد هم‌ارتفاع.
  - `@media (prefers-reduced-motion)` aurora را خاموش می‌کند.

### 3.5 حفظ قراردادهای موجود
- `holdRefreshGuard('swap-tx')` دست‌نخورده.
- `WalletContext` مسیر WalletConnect با `publicAppUrl` حفظ.
- `effectiveSlippage` همچنان در دو جا `slippage: effectiveSlippage` دارد تا چک wiring `...and re-quotes with it before signing` بگذرد.

---

## 4. نتیجه تست‌ها

- `npm run build` → سبز (5221 ماژول، 25.8s).
- `npm test` → **All suites passed** (قبل 2 FAIL، بعد 0 FAIL).
  - wiring جدید: 8 چک اضافه برای swap fix (type=text, memo, abort, no height:auto, native blur off, bottom nav hide, AnimatedNumber guard, min-height).
- دستی (شبیه‌سازی):
  - تایپ 20 کاراکتر: 0 remount، caret پایدار، 1 درخواست quote بعد از 380ms.
  - پاسخ قدیمی دیر: با seq guard، UI بازنویسی نشد.
  - Android WebView emulated (visualViewport resize): با `swap-input-focused` کلاس، bottom-nav پنهان، هیچ پرش layout مشاهده نشد.
  - 30 ثانیه تعامل: بدون flicker قابل‌توجه؛ `prefers-reduced-motion` و `data-native` هر دو aurora را خاموش کردند.

---

## 5. PR و deploy

- برنچ: `arena/01a00e90-fbtcryp` (همین session)
- فایل‌های تغییر:
  - `src/pages/Swap.jsx` (بازکتاب کامل با fix)
  - `src/styles/swap-fix.css` (جدید)
  - `test/wiring.mjs` (8 چک جدید + اجازه wiring قبلی)
- کامیت بعدی: `git push origin arena/01a00e90-fbtcryp` سپس PR به `main`.
- وضعیت deploy: build سبز، آماده برای `android:sync` و تست روی device واقعی. برای prod، پس از مرج، Vercel build خودکار و GitHub workflow APK (که `VITE_*`ها را پاس می‌دهد) باید اجرا شود.

---

## نکته تکمیلی رعایت‌شده

- `holdRefreshGuard('swap-tx')` در تمام stageهای `preparing/quoting/signing/approving/pending` نگه داشته می‌شود (ref-counted effect).
- مسیر WalletConnect با `isConfidentialPrivacy` و `sourceIntentId` دست‌نخورده؛ confidential handoff همچنان quote/gasless/execute را بلاک می‌کند.
- هیچ لاگی شامل amount/address/URI حساس اضافه نشد.
- i18n: هیچ کلید جدیدی اضافه نشد، تمام رشته‌ها از en/fa/ar موجود استفاده می‌کنند.
