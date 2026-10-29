# رفع خطای بالا نیامدن کل سایت — ۲۰۲۶-۱۰-۲۹

«برنامه کلا نمیاد بالا و میزنه خطای غیر منتظره … برای همهٔ سایت و صفحات، بعد از
آخرین تغییر و مرچ شدن (نوتیفیکیشن).»

همین بود. علت یکی بود و دقیقاً یکی.

---

## ۱) علت

در مرچ «سیستم طراحی نوتیفیکیشن» (PR #619) کامپوننت `<NotificationBar />` در
`src/App.jsx` **بیرون از `<HashRouter>`** مانت شده بود — کنار `<Toasts>` و
`<InstallPrompt>`:

```jsx
<Suspense fallback={<Loader />}>{screen}</Suspense>   {/* screen شامل <HashRouter> است */}
<ConnectivityAlert />
<Toasts />
<Suspense fallback={null}>
  <NotificationBar />        {/* ← اینجا هیچ Router ی بالای سرش نبود */}
</Suspense>
```

کارتِ نوتیفیکیشن یک لینک داخلی است و با `useNavigate()` ناوبری می‌کند. این هوک
بدون Router بالای خودش **throw** می‌کند:

```
useNavigate() may be used only in the context of a <Router> component.
```

و چون `<RouteBoundary>` داخل خودِ روت‌هاست، این خطا را نمی‌گرفت؛ تا
`BootBoundary` در `src/main.jsx` بالا می‌رفت و کل برنامه با صفحهٔ
«خطای غیرمنتظره» جایگزین می‌شد. یعنی:

- روی **همهٔ** مسیرها (هر صفحه‌ای که باز می‌کردی)؛
- **بلافاصله** بعد از لود شدن چانکِ همین نوار (چند صد میلی‌ثانیه بعد از بوت)؛
- و در حالی که `vite build` سبز بود و `check-first-paint` هم پاس می‌شد.

با یک تست بازتولید شد: همان فایل کامپوننت از کامیت `69cc0da` بدون Router مانت
شد و پیام بالا عیناً throw شد.

## ۲) ریشهٔ اینکه چرا تست‌ها نگرفتند

`test/notification-bar.test.jsx` خودش `react-router-dom` را کامل mock می‌کند
(`useNavigate` و بعداً `useInRouterContext`)، پس **امکان ندارد** جای نبودن Router
را ببیند. تست رندر یک کامپوننت نمی‌تواند ثابت کند کامپوننت در درخت واقعی سرِ
جای درستش وصل شده است.

پس دو لایه اضافه شد:

1. **تست بوت واقعی** — `test/app-boot.test.jsx` خودِ `App` را در jsdom بالا
   می‌آورد و سه چیز را می‌سنجد: `window.__FBT_BOOT_ERR__` تعریف نشده باشد،
   درخت واقعاً رندر شده باشد (`innerHTML > 5000`)، و رشتهٔ «خطای غیرمنتظره» در
   DOM نباشد. **با کد باگ‌دار fail می‌شود** (سابوتاژ تأیید شد) و با کد اصلاح‌شده
   پاس. اجرا: `npm run test:boot`.
2. **گارد ساختاری** — `test/wiring.mjs` حالا asserts می‌کند که
   `<NotificationBar />` (الف) وجود دارد، (ب) فقط یک بار، (ج) **داخل آخرین
   `<HashRouter>`** است، و (د) کامپوننت از `useInRouterContext` استفاده می‌کند.
   اگر فردا کسی جای آن را عوض کند، تست قبل از مرچ قرمز می‌شود.

## ۳) اصلاحات

### الف) جای درست در درخت

نوار به **داخل** `<HashRouter>` منتقل شد، بعد از `AnimatedRoutes`، با
`<Suspense fallback={null}>` مستقل خودش تا چانکِ کندش هیچ‌وقت جای صفحه را با
لودر عوض نکند. به شاخه‌های قفل/اسپلش/لندینگِ پرداخت اضافه نشد، چون آن
شاخه‌ها کل صفحه را جایگزین می‌کنند و کارتِ نوتیفیکیشن روی دستگاهِ قفل‌شده
نباید محتوای هشدار را نشان دهد.

### ب) دیگر هیچ‌وقت نمی‌تواند کل اپ را پایین بیاورد

`src/components/NotificationBar.jsx` سه‌لایه شد:

- `BarView` — فقط ظاهر (استور، زبان، استک).
- `RoutedBar` — مسیر نرمال: `useNavigate()`.
- `HashBar` — مسیر تنزل‌یافته، وقتی Router نیست: ناوبری با
  `window.location.hash` (اپ HashRouter است، پس همین ناوبری است) و فقط برای
  مسیرهای داخلی `/+…`.
- `BarBoundary` — یک error boundary کوچک دورِ کل نوار: این نوار یک overlay
  غیرحیاتی است؛ اگر خطا داد نتیجهٔ درست «این بار کارتی نشان نده» است، نه صفحهٔ
  «خطای غیرمنتظره».

`useInRouterContext()` یک بولین است و throw نمی‌کند، پس انتخاب بین دو حالت امن
است و قواعد hooks نقض نمی‌شود.

## ۴) اعتبارسنجی

| بررسی | نتیجه |
| --- | --- |
| `npm run build` (speculation + spot trade) | ✅ ۱۷۳۴ KB / بودجهٔ ۱۷۵۰ KB |
| `npm run test:boot` | ✅ |
| `npm run test:notifications` | ✅ (۱۷۷ assertion + ۱۱ تست) |
| `node test/wiring.mjs` | ✅ |
| `npx vitest run` | ۲۰۲۰ پاس / ۱۳ fail — **هر ۱۳ مورد روی کامیت پایه هم fail است** (farm feature-flag, orders copy, insurance sheet, derivatives css)؛ هیچ‌کدام مربوط به این تغییر نیست |

## ۵) قانونی که باید بماند

هر کامپوننتی که `useNavigate` / `useLocation` / `useParams` صدا می‌زند باید
**داخل** `<HashRouter>` رندر شود. `toast`، `install prompt` و `connectivity alert`
عمداً بیرون‌اند چون هیچ‌کدام از این هوک‌ها را صدا نمی‌زنند. `RadioDock` و
`NotificationBar` داخل‌اند چون هر دو ناوبری/مسیر می‌خوانند.
