# ورود با ایمیل و سوشال (Reown AppKit Embedded Wallet)

سومین مسیرِ اتصال کیف پول — کنارِ WalletConnect جفت‌شدنی و کیفِ تزریقی —
از روی مستندات رسمی `docs.reown.com/appkit/react/core/socials` پیاده شد.

## معماری در یک نگاه

| قطعه | نقش |
|---|---|
| `src/lib/emailSocialWallet.js` | گزینه‌ها، ساختن lazy نمونهٔ AppKit، آتش‌بسِ features مشترک، مارکرِ بوت |
| `src/context/WalletContext.jsx` | `connectEmailSocial` / `restoreEmailSocial` / `attachEmailProvider` + فلگ `emailModalActive` |
| `src/components/WalletConnectSheet.jsx` | ردیفِ «ایمیل و ورود با سوشال» بین WalletConnect و کیف‌های تزریقی |
| `test/email-social-probe.mjs` | ۲۶ ادعا روی خودِ بستهٔ واقعی (`@reown/appkit@1.8.19`) |

قانونِ طلاییِ زندگیِ مشترک با سطحِ WalletConnect: مودال `<w3m-modal>` بین دو
نمونه **مشترک** است؛ سطح جفت‌شدنی پیش از open خودش features مشترک را مسطح
می‌کند و سطح ایمیل پیش از open خودش آن‌ها را برمی‌گرداند. کسی حق ندارد
نمونهٔ دوم را بیرون از این دو قانون open کند.

## چک‌لیست Reown Dashboard (cloud.reown.com → پروژهٔ 8e36eccabebf5a4567f4e974fafd6b20)

۱. **Email & Social** را در بخشِ features روشن کن (نیاز نسخهٔ AppKit ≥ 4.2 قبلاً با 1.8.19 برآورده است).
۲. سوشال‌های دلخواه (google، x، apple، …) را فعال کن.
۳. در تب **Domains / Allowed Origins** هر مقصدی که سایت روی آن سرو می‌شود را ثبت کن:
   - `https://fbtswap.ir`
   - هر دامنهٔ دیگرِ پیش‌نمایشی/آینه‌ای
   - مبداِ Capacitor اندروید: `https://localhost` (پلتفرم پیش‌فرضِ WebView اپ روی همین origin است)
4. رمزهای Dashboard Secret و AppKit Auth API‌ را **فقط سمت سرور** نگه دار —
   به‌هیچ‌وجه زیر متغیر `VITE_` یا در باندلِ فرانت‌اند قرار نگیرند. کدِ فعلی
   هیچ رمزی را مصرف نمی‌کند (فقط Project ID عمومی کافی است).
۵. اگر رمزها را در چت/گیت لو داده‌ای، از همان Dashboard آن‌ها را Rotate کن.

## رفتارِ مرزبندی با جریان‌های قبلی

- اتصالِ موفقِ تزریقی یا WalletConnect، مارکرِ ایمیل (`fbt_email_social_connected`) را پاک می‌کند.
- Cold-start: اگر vault محلی باشد مثل قبل همان برنده است؛ در غیر این‌صورت
  مارکرِ ایمیل بر بازیابی WalletConnect مقدم است.
- خروجِ صریح (disconnect) نشستِ ایمیل را هم هم‌زمان logout می‌کند.
- امضا/تراکنش از همان ChainController انتخاب‌شدهٔ کاربر می‌شود؛ شبکه‌ها از
  registry مشترک `src/lib/chains.js` ساخته می‌شوند (بدون لیستِ دوباره‌نویسی‌شده).

## آزمون

```bash
npm test            # شامل email-social-probe به‌عنوان آخرین سوئیت
node test/run.mjs   # خروجی: «email & social login — 26 assertions, 0 failures»
```

نکته: در محیط‌های بدون شبکه به `api.web3modal.org` پیامِ fallback به مقادیر
local چاپ می‌شود؛ این رفتارِ خودِ SDK است و گزینه‌های ما local اعمال می‌شوند.
