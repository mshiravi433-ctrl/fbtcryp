# دیپ‌لينک سولانا (فانتوم) — پرومپت و تشخیص

برنچ کاری جلسه را حفظ کن. هرگز به برنچ دیگری سوئیچ نکن.

گزارش کاربر، بدون تغییر:

> «نه درست نشده و دیپ لينک کار نمی‌ده یعنی وقتی میزنی روی فانتوم میره داخل اپ خود
> فانتوم نصب شده روی گوشی اما هیچ صفحه‌ای نمیاره برای تأیید وصل شدن.
> و سایت ما را هم فانتوم مثلاً مخرب شناخته، ریسک تراکنش می‌ذاره. یک پرومپت بذار که
> دیپ لينک کار بده و چرا ارور می‌ذاره بخصوص وقتی بخواد امضا کنی.»

---

## تشخیص — چرا فانتوم باز می‌شد ولی صفحهٔ تأیید نمی‌آمد

درخواستِ اتصال فانتوم **خودِ query string است**:

```
https://phantom.app/ul/v1/connect?app_url=…&dapp_encryption_public_key=…&redirect_link=…&cluster=mainnet-beta
```

پس هر مسیری که این URL را «رندر» کند به‌جای این‌که به **اپ** فانتوم تحویل بدهد،
دقیقاً همان چیزی می‌شود که کاربر دید: فانتوم جلویشان باز است و داخلش هیچ چیزی برای
تأیید نیست. دو مسیر ما این‌طور بودند:

| محیط | کاری که کد می‌کرد | نتیجه |
|---|---|---|
| **اپ خودمان (APK)** | `@capacitor/browser` یعنی **Chrome Custom Tab** | Custom Tab آدرس‌های http/https را خودش رندر می‌کند و **هرگز** App Link را به اپ دیگری نمی‌دهد (فقط custom scheme). پس صفحهٔ phantom.app داخل اپ خودمان باز می‌شد؛ آن «Open in Phantom» هم که بعداً زده می‌شد، **بدون query** به اپ می‌رسید ⇒ فانتوم روی خانه باز می‌شد و صفحهٔ تأیید نبود. |
| **مرورگر موبایل** | `location.assign(universal link)` | فانتوم درست درخواست را می‌گرفت، ولی **همین سند** به آدرس کیف پول می‌رفت. سندِ نگه‌دارندهٔ promise از بین می‌رفت ⇒ امضا برمی‌گشت به صفحه‌ای که دیگر یادش نبود منتظر چه چیزی بوده. از بیرون: «ارور می‌ده / هیچ‌چی نشد». |

نکتهٔ کلیدی Custom Tab (مستند گوگل و رفتار شناخته‌شدهٔ Chromium):
Custom Tab فقط scheme های اختصاصی را به اپ می‌دهد؛ App Link های https را نه.

## تشخیص — چرا فانتوم «ریسک / مخرب» می‌گذارد

فانتوم **سه** هشدار مختلف دارد که همه با یک جمله توصیف می‌شوند
(منبع: `docs.phantom.com` → *Domain and transaction warnings*):

| هشدار | علت | با کد ما درست می‌شود؟ |
|---|---|---|
| «This domain is new or has not been reviewed yet» | دامنهٔ تازه، خودکار نمایش داده می‌شود و بعد از بررسی دامنه **خودش** می‌رود | ❌ هیچ کدی خاموشش نمی‌کند. اگر بیش از یک هفته ماند: فرم domain review فانتوم |
| «This app's identity could not be verified. It may be impersonating another app» | نبودِ `/.well-known/assetlinks.json` روی دامنه + نبودِ `identity.uri` درست در درخواست MWA | ✅ بله — `scripts/assetlinks.mjs` و اصلاح `identity.uri` |
| «This dApp could be malicious. Do not proceed unless you are certain it is safe» | **هشدار شبیه‌سازی تراکنش**: فانتوم نتوانسته نتیجهٔ تراکنش را پیش‌بینی کند. ربطی به دامنه ندارد | ✅ تا حد زیاد — `src/lib/solana/signGuard.js` |

راه‌حل‌های خودِ فانتوم برای سومی (که ما پیاده کردیم):
۱) تراکنش فقط **یک امضا** داشته باشد؛ ۲) اگر چند امضا لازم دارد، اول با
`signTransaction` (فقط امضا) از فانتوم امضا بگیر و بعد بقیهٔ امضاها را جمع کن؛
۳) اگر به سقف حجم سولانا نزدیک است، تقسیمش کن یا از Address Lookup Table استفاده کن؛
۴) قبل از درخواست امضا، تراکنش را با `sigVerify: false` شبیه‌سازی کن.

---

## الزامات این پرومپت

۱) **تحویل درست درخواست** — `src/lib/solana/deeplinkUri.js`, `src/lib/solana/deeplink.js`:
   - برای هر کیف پول، **پکیج اندروید** ثبت شود: `app.phantom`, `com.solflare.mobile`,
     `app.backpack.mobile`.
   - در **مرورگر اندروید**: درخواست به‌صورت `intent://…#Intent;scheme=https;package=…;S.browser_fallback_url=…;end`
     و **in-place** باز شود؛ یعنی هم URL کامل به اپ می‌رسد، هم صفحهٔ ما زنده می‌ماند،
     هم اگر کیف پول نصب نبود کاربر به صفحهٔ نصب می‌رود.
   - در **APK**: یک bridge نیتیو (`window.FBTSolanaLink.openWalletLink`) که
     `ACTION_VIEW` را **package-scoped** به اپ کیف پول می‌فرستد. Custom Tab فقط
     fallback است.
   - در **iOS / بقیه**: همان universal link.

۲) **راست‌گویی دربارهٔ امضا** — اگر مسیرِ باز کردن کیف پول، همین صفحه را به آدرس
   کیف پول ببرد (iOS و مرورگرهای بدون `intent://`)، کد `IN_WALLET` برگردد نه
   `SIGN_FAILED`؛ و نتیجهٔ امضا که به‌صورت **page load** برمی‌گردد در
   `SolanaWalletTab` نمایش داده شود (نه سکوت).

۳) **هشدار شبیه‌سازی، قبل از باز کردن کیف پول** — `src/lib/solana/signGuard.js`
   هدر تراکنشِ کامپایل‌شده را بخواند (`numRequiredSignatures`، با در نظر گرفتن
   پیشوند versioned) و `MULTI_SIGNER` / `TX_OVERSIZE` را برگرداند؛ این‌ها تا نتیجهٔ
   نهایی همراه بمانند و به کاربر توضیح داده شوند.

۴) **هویت اپ** — `identity.uri` در MWA باید **origin** باشد نه URL با path، و
   `scripts/assetlinks.mjs` فایل `public/.well-known/assetlinks.json` را از
   **اثر انگشت واقعی keystore** بسازد (placeholder ممنوع؛ `--check` برای CI).

۵) **پاسخ روی صفحه** — در شیت اتصال، یک InfoBox که هر سه هشدار فانتوم را توضیح دهد
   و صریح بگوید ما هرگز نمی‌گوییم «به هر حال ادامه بده».

۶) تست: `npm run test:solana-connect` (پروب + mount واقعی `SolanaWalletTab` و
   `SolanaConnectSheet`) و `npx vite build` سبز بمانند.

۷) Commit و PR به `main` از همین برنچ.

## کارهایی که بیرون از این repo باید انجام شود

- `npm run assetlinks -- --keystore=<release.jks> --storepass=… --alias=…`
  سپس commit و deploy؛ با Play App Signing، اثر انگشت **app signing key** از
  Play Console (نه upload key).
- اگر هشدار «دامنهٔ جدید» بیش از یک هفته ماند: فرم domain review فانتوم.
- `npm run wallet:reputation` — اکنون `assetlinks.json` و صفحهٔ metadata که فانتوم
  برای دیالوگ اتصال می‌خواند را هم چک می‌کند.
